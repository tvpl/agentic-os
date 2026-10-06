import fs from "node:fs";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./db/migrations.js";
import path from "node:path";
import type { MordomoPaths } from "./paths.js";
import type { Db } from "./db/db.js";
import { events } from "./events.js";
import type { BackupInfo } from "@mordomo/contracts";

export type { BackupInfo };

/**
 * Backup / restore of everything that defines this MordomoOS installation:
 * settings, DB, skills, memory routers, routines, connectors. Artifacts and
 * logs are excluded by default (large, reproducible); pass includeArtifacts.
 * Dependency-free directory copies — restorable by hand with `cp -r` too.
 *
 * The database is copied with SQLite's online backup API (`db.backup()`), so
 * the copy is a consistent snapshot even while the WAL holds un-checkpointed
 * pages and other writers are active. Never copy `mordomo.db` with `cp` while
 * the service runs: a WAL-mode file copied that way can be missing every table.
 */

const BACKUP_SETS = ["skills", "memory", "routines", "connectors"] as const;

export interface BackupOptions {
  includeArtifacts?: boolean;
}

export async function createBackup(
  paths: MordomoPaths,
  db: Db,
  opts: BackupOptions = {},
): Promise<BackupInfo> {
  const { dest, dbFile } = snapshotFiles(paths, opts);
  try {
    if (db.open) {
      await db.backup(dbFile);
    } else if (fs.existsSync(paths.dbFile)) {
      // Closed handle: the file is quiescent and WAL checkpointed on close.
      fs.copyFileSync(paths.dbFile, dbFile);
    }
    const info = finalize(dest);
    events.emit("backup.created", info);
    return info;
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

/** Copy every file set except the database into a fresh backup directory. */
function snapshotFiles(paths: MordomoPaths, opts: BackupOptions): { dest: string; dbFile: string } {
  const prefix = `.pending-full-${new Date().toISOString().replace(/[:.]/g, "-")}-`;
  fs.mkdirSync(paths.backups, { recursive: true });
  const dest = fs.mkdtempSync(path.join(paths.backups, prefix));
  try {
    for (const set of BACKUP_SETS) {
      const src = paths[set];
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, set), { recursive: true });
    }
    if (fs.existsSync(paths.settingsFile)) {
      fs.mkdirSync(path.join(dest, "config"), { recursive: true });
      fs.copyFileSync(paths.settingsFile, path.join(dest, "config", "settings.json"));
    }
    if (fs.existsSync(paths.syncManifest)) {
      fs.mkdirSync(path.join(dest, "config"), { recursive: true });
      fs.copyFileSync(paths.syncManifest, path.join(dest, "config", "sync-manifest.json"));
    }
    const dbDir = path.join(dest, "config", "db");
    fs.mkdirSync(dbDir, { recursive: true });
    if (opts.includeArtifacts && fs.existsSync(paths.artifacts)) {
      fs.cpSync(paths.artifacts, path.join(dest, "artifacts"), { recursive: true });
    }
    return { dest, dbFile: path.join(dbDir, "mordomo.db") };
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

function finalize(dest: string): BackupInfo {
  const sizeBytes = dirSize(dest);
  const published = path.join(path.dirname(dest), path.basename(dest).replace(/^\.pending-/, ""));
  fs.renameSync(dest, published);
  return { name: path.basename(published), path: published, createdAt: Date.now(), sizeBytes };
}

export function listBackups(paths: MordomoPaths): BackupInfo[] {
  if (!fs.existsSync(paths.backups)) return [];
  return fs
    .readdirSync(paths.backups, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("full-"))
    .map((e) => {
      const full = path.join(paths.backups, e.name);
      return { name: e.name, path: full, createdAt: fs.statSync(full).mtimeMs, sizeBytes: dirSize(full) };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Restore a backup. A pre-restore safety backup is created first, so a restore
 * can itself be undone.
 *
 * File-based by design and synchronous. THE DATABASE MUST BE CLOSED before
 * calling this: it overwrites `mordomo.db` and removes the `-wal`/`-shm`
 * sidecars, and the safety backup copies the DB file directly (safe only when
 * no handle is open). The CLI and the API are responsible for stopping runs,
 * closing the DB, calling this, then reopening.
 */
export function restoreBackup(paths: MordomoPaths, name: string): { safetyBackup: BackupInfo } {
  const src = path.join(paths.backups, name);
  if (!/^full-[A-Za-z0-9-]{1,80}$/.test(name) || !fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) {
    throw new Error(`Backup not found: ${name}`);
  }
  // Validate before touching live files or publishing a safety snapshot.
  let candidate: Database.Database | undefined;
  try {
    candidate = new Database(path.join(src, "config", "db", "mordomo.db"), {
      readonly: true,
      fileMustExist: true,
    });
    const version = candidate.pragma("user_version", { simple: true }) as number;
    if (
      version < 1 ||
      version > Math.max(...MIGRATIONS.map((migration) => migration.version)) ||
      candidate.pragma("quick_check", { simple: true }) !== "ok"
    )
      throw new Error("Unsupported or damaged database");
  } catch {
    throw new Error(
      "Invalid backup database. Choose a complete, compatible backup; current files were not changed.",
    );
  } finally {
    candidate?.close();
  }
  // Safety backup by plain copy: valid only because the DB is closed.
  const includeArtifacts = fs.existsSync(path.join(src, "artifacts"));
  const { dest, dbFile } = snapshotFiles(paths, { includeArtifacts });
  let safetyBackup: BackupInfo;
  try {
    if (fs.existsSync(paths.dbFile)) fs.copyFileSync(paths.dbFile, dbFile);
    safetyBackup = finalize(dest);
  } catch (error) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw error;
  }

  // Prepare every replacement before moving live data. In particular ENOSPC
  // during copying must not leave an emptied skills/memory directory behind.
  const staging = fs.mkdtempSync(path.join(paths.home, ".restore-"));
  const entries: Array<{
    source: string | null;
    target: string;
    staged: string;
    old: string;
    moved: boolean;
    installed: boolean;
  }> = [];
  const add = (source: string | null, target: string) => {
    if (source && !fs.existsSync(source)) return;
    const index = entries.length;
    entries.push({
      source,
      target,
      staged: path.join(staging, `new-${index}`),
      old: path.join(staging, `old-${index}`),
      moved: false,
      installed: false,
    });
  };
  for (const set of BACKUP_SETS) add(path.join(src, set), paths[set]);
  if (includeArtifacts) add(path.join(src, "artifacts"), paths.artifacts);
  add(path.join(src, "config", "settings.json"), paths.settingsFile);
  add(path.join(src, "config", "sync-manifest.json"), paths.syncManifest);
  add(path.join(src, "config", "db", "mordomo.db"), paths.dbFile);
  for (const suffix of ["-wal", "-shm"]) add(null, paths.dbFile + suffix);
  let preserveStaging = false;
  try {
    for (const entry of entries) {
      if (entry.source) fs.cpSync(entry.source, entry.staged, { recursive: true });
    }
    for (const entry of entries) {
      fs.mkdirSync(path.dirname(entry.target), { recursive: true });
      if (fs.existsSync(entry.target)) {
        fs.renameSync(entry.target, entry.old);
        entry.moved = true;
      }
      if (entry.source) {
        fs.renameSync(entry.staged, entry.target);
        entry.installed = true;
      }
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.installed) fs.rmSync(entry.target, { recursive: true, force: true });
        if (entry.moved) fs.renameSync(entry.old, entry.target);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length) {
      preserveStaging = true;
      throw new AggregateError(
        [error, ...failures],
        `Restore rollback requires recovery. Preserved files: ${staging}; safety backup: ${safetyBackup.name}`,
      );
    }
    throw error;
  } finally {
    if (!preserveStaging) fs.rmSync(staging, { recursive: true, force: true });
  }
  return { safetyBackup };
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

// ---- Staged restore (applied at boot, before the database opens) ----------

/** Marker + copy written by the API when a restore cannot run against the open DB. */
export interface RestorePending {
  name: string;
  stagedAt: number;
  stagedPath: string;
}

export const RESTORE_PENDING_DIR = "restore-pending";
const RESTORE_MARKER = "PENDING.json";

export function restorePendingDir(paths: MordomoPaths): string {
  return path.join(paths.config, RESTORE_PENDING_DIR);
}

export function readRestorePending(paths: MordomoPaths): RestorePending | null {
  const marker = path.join(restorePendingDir(paths), RESTORE_MARKER);
  try {
    const raw = JSON.parse(fs.readFileSync(marker, "utf8")) as Partial<RestorePending>;
    if (typeof raw.name !== "string" || typeof raw.stagedAt !== "number") return null;
    return {
      name: raw.name,
      stagedAt: raw.stagedAt,
      stagedPath: path.join(restorePendingDir(paths), raw.name),
    };
  } catch {
    return null;
  }
}

export function writeRestorePending(paths: MordomoPaths, name: string): RestorePending {
  const dir = restorePendingDir(paths);
  const stagedPath = path.join(dir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(paths.backups, name), stagedPath, { recursive: true });
  const info: RestorePending = { name, stagedAt: Date.now(), stagedPath };
  fs.writeFileSync(
    path.join(dir, RESTORE_MARKER),
    JSON.stringify({ name, stagedAt: info.stagedAt }, null, 2) + "\n",
  );
  return info;
}

export function clearRestorePending(paths: MordomoPaths): void {
  fs.rmSync(restorePendingDir(paths), { recursive: true, force: true });
}

/**
 * Apply a staged restore. Must be called with NO database handle open
 * (i.e. before `openDb`). If the original backup directory is gone the
 * staged copy is moved back into `backups/` first.
 */
export function applyPendingRestore(paths: MordomoPaths): { applied: RestorePending | null } {
  const pending = readRestorePending(paths);
  if (!pending) return { applied: null };
  const original = path.join(paths.backups, pending.name);
  if (!fs.existsSync(original) && fs.existsSync(pending.stagedPath)) {
    fs.cpSync(pending.stagedPath, original, { recursive: true });
  }
  try {
    restoreBackup(paths, pending.name);
  } finally {
    clearRestorePending(paths);
  }
  return { applied: pending };
}

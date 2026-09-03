import fs from "node:fs";
import path from "node:path";
import type { MordomoPaths } from "./paths.js";
import type { Db } from "./db/db.js";
import { events } from "./events.js";

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

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
}

export interface BackupOptions {
  includeArtifacts?: boolean;
}

export async function createBackup(
  paths: MordomoPaths,
  db: Db,
  opts: BackupOptions = {},
): Promise<BackupInfo> {
  const { dest, dbFile } = snapshotFiles(paths, opts);
  if (db.open) {
    await db.backup(dbFile);
  } else if (fs.existsSync(paths.dbFile)) {
    // Closed handle: the file is quiescent and any WAL was checkpointed on close.
    fs.copyFileSync(paths.dbFile, dbFile);
  }
  const info = finalize(dest);
  events.emit("backup.created", info);
  return info;
}

/** Copy every file set except the database into a fresh backup directory. */
function snapshotFiles(paths: MordomoPaths, opts: BackupOptions): { dest: string; dbFile: string } {
  const name = `full-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dest = path.join(paths.backups, name);
  fs.mkdirSync(dest, { recursive: true });

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
}

function finalize(dest: string): BackupInfo {
  return { name: path.basename(dest), path: dest, createdAt: Date.now(), sizeBytes: dirSize(dest) };
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
  if (!fs.existsSync(src) || !path.resolve(src).startsWith(path.resolve(paths.backups))) {
    throw new Error(`Backup not found: ${name}`);
  }
  // Safety backup by plain copy: valid only because the DB is closed.
  const { dest, dbFile } = snapshotFiles(paths, {});
  if (fs.existsSync(paths.dbFile)) fs.copyFileSync(paths.dbFile, dbFile);
  const safetyBackup = finalize(dest);

  for (const set of BACKUP_SETS) {
    const from = path.join(src, set);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(paths[set], { recursive: true, force: true });
    fs.cpSync(from, paths[set], { recursive: true });
  }
  const settingsBackup = path.join(src, "config", "settings.json");
  if (fs.existsSync(settingsBackup)) fs.copyFileSync(settingsBackup, paths.settingsFile);
  const manifestBackup = path.join(src, "config", "sync-manifest.json");
  if (fs.existsSync(manifestBackup)) fs.copyFileSync(manifestBackup, paths.syncManifest);
  const dbBackup = path.join(src, "config", "db", "mordomo.db");
  if (fs.existsSync(dbBackup)) {
    fs.copyFileSync(dbBackup, paths.dbFile);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = paths.dbFile + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
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

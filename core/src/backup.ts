import fs from "node:fs";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./db/migrations.js";
import path from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, tightenMode, type MordomoPaths } from "./paths.js";
import type { Db } from "./db/db.js";
import { events } from "./events.js";
import type { BackupInfo } from "@mordomo/contracts";
import {
  MANIFEST_NAME,
  buildManifest,
  buildManifestAsync,
  readManifest,
  verifyMounts,
  verifyMountsAsync,
  writeManifest,
  type BackupManifest,
  type BackupProblem,
  type Mount,
} from "./backupManifest.js";
import { atomicWrite } from "./config/atomicWrite.js";
import { lockIsStale, realProbe } from "./ownerLock.js";
import { processStartMarker } from "./processIdentity.js";

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
 *
 * A backup is SEALED when it is published: `manifest.json` at its root lists the SHA-256 and size of every file
 * and the target of every link (`backupManifest.ts`). A restore compares what it is about to install with it and
 * refuses a backup that is truncated, edited, short of a file or carries one more; a backup from before this
 * existed has no manifest ("unsealed") and is restored only on request.
 */

const BACKUP_SETS = ["skills", "memory", "routines", "connectors"] as const;

/** Everything a restore can install, by path inside the backup (a manifest line outside these is not judged). */
const RESTORABLE = [
  ...BACKUP_SETS,
  "artifacts",
  "config/settings.json",
  "config/ui-preferences.json",
  "config/sync-manifest.json",
  "config/db/mordomo.db",
] as const;

const BACKUP_NAME = /^full-[A-Za-z0-9-]{1,80}$/;

export interface BackupOptions {
  includeArtifacts?: boolean;
  /** Backups to keep: after this one is published, the sealed ones beyond the `keep` newest are deleted. */
  keep?: number;
}

export interface RestoreOptions {
  /** Restore a backup that has no manifest, trusting it as it is (the checks of the database still run). */
  allowUnverified?: boolean;
}

/** A backup that cannot be trusted: nothing was changed. `statusCode` is what an API answers. */
export class BackupVerificationError extends Error {
  readonly statusCode = 422;
  constructor(
    readonly code: "backup_invalid" | "backup_unsealed",
    message: string,
    readonly problems: BackupProblem[] = [],
  ) {
    super(message);
    this.name = "BackupVerificationError";
  }
}

const invalidBackup = (name: string, problems: BackupProblem[]) =>
  new BackupVerificationError(
    "backup_invalid",
    `Backup ${name} failed verification (${problems.length} problem(s): ` +
      `${problems
        .slice(0, 5)
        .map((p) => `${p.kind} ${p.path}`)
        .join("; ")}${problems.length > 5 ? "; …" : ""}). Current files were not changed.`,
    problems,
  );

const unsealedBackup = (name: string) =>
  new BackupVerificationError(
    "backup_unsealed",
    `Backup ${name} has no manifest.json (it was made before backups were sealed), so it cannot be verified. ` +
      "Restore it with --allow-unverified to trust it as it is. Current files were not changed.",
  );

export async function createBackup(
  paths: MordomoPaths,
  db: Db,
  opts: BackupOptions = {},
): Promise<BackupInfo> {
  if (opts.keep !== undefined && !(Number.isInteger(opts.keep) && opts.keep >= 1)) {
    throw new RangeError(`keep must be an integer of at least 1 (got ${String(opts.keep)})`);
  }
  // A home with a restore half done is not a state to seal: undo what a dead restore left, refuse a live one.
  assertNoRestoreInProgress(paths);
  const { dest, dbFile } = snapshotFiles(paths, opts);
  try {
    if (db.open) {
      await db.backup(dbFile);
    } else if (fs.existsSync(paths.dbFile)) {
      // Closed handle: the file is quiescent and WAL checkpointed on close.
      fs.copyFileSync(paths.dbFile, dbFile);
    }
    const info = finalize(dest, await buildManifestAsync(dest));
    if (opts.keep !== undefined) {
      try {
        pruneBackups(paths, opts.keep, [info.name, readRestorePending(paths)?.name ?? ""]);
      } catch {
        /* the backup exists; a retention pass that lost a race with another process runs again next time */
      }
    }
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
  fs.mkdirSync(paths.backups, { recursive: true, mode: PRIVATE_DIR_MODE });
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
    if (fs.existsSync(paths.uiPreferencesFile)) {
      fs.mkdirSync(path.join(dest, "config"), { recursive: true });
      fs.copyFileSync(paths.uiPreferencesFile, path.join(dest, "config", "ui-preferences.json"));
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

function finalize(dest: string, manifest: BackupManifest): BackupInfo {
  // The online-backup API and plain copies create the database file with the process mask or the source's mode.
  tightenMode(dest, PRIVATE_DIR_MODE);
  tightenMode(path.join(dest, "config", "db", "mordomo.db"), PRIVATE_FILE_MODE);
  writeManifest(dest, manifest);
  const sizeBytes = dirSize(dest);
  const published = path.join(path.dirname(dest), path.basename(dest).replace(/^\.pending-/, ""));
  fs.renameSync(dest, published);
  return { name: path.basename(published), path: published, createdAt: Date.now(), sizeBytes };
}

/**
 * When a backup was made, from its name (`full-<ISO time with dashes>-<random>`, which sorts the way time does and
 * survives `cp -r`, rsync and an archive that reset every modification time); for a name that does not carry one,
 * the manifest's `createdAt`, and last the folder's modification time.
 */
function backupCreatedAt(name: string, folder: string): number {
  const stamped = /^full-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/.exec(name);
  if (stamped) {
    const ms = Date.parse(`${stamped[1]}:${stamped[2]}:${stamped[3]}.${stamped[4]}`);
    if (!Number.isNaN(ms)) return ms;
  }
  const manifest = readManifest(folder);
  if (typeof manifest === "object") return manifest.createdAt;
  return fs.statSync(folder).mtimeMs;
}

export function listBackups(paths: MordomoPaths): BackupInfo[] {
  if (!fs.existsSync(paths.backups)) return [];
  const found: BackupInfo[] = [];
  for (const e of fs.readdirSync(paths.backups, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith("full-")) continue;
    const full = path.join(paths.backups, e.name);
    try {
      found.push({
        name: e.name,
        path: full,
        createdAt: backupCreatedAt(e.name, full),
        sizeBytes: dirSize(full),
      });
    } catch {
      /* removed by another process (a retention pass) while it was being read: it is not there any more */
    }
  }
  return found.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
}

/** Does this backup folder carry a manifest (was it sealed when it was made)? */
export function isSealed(backupPath: string): boolean {
  return fs.existsSync(path.join(backupPath, MANIFEST_NAME));
}

/**
 * Keep the `keep` newest backups and delete the sealed ones beyond them. Never deleted: a backup named in
 * `protect` (the one just made, the one a staged restore points at), a legacy backup without a manifest (the
 * owner's, from before this existed) and anything that is not a real `full-…` folder. Returns what it deleted.
 */
export function pruneBackups(paths: MordomoPaths, keep: number, protect: readonly string[] = []): string[] {
  if (!(Number.isInteger(keep) && keep >= 1)) {
    throw new RangeError(`keep must be an integer of at least 1 (got ${String(keep)})`);
  }
  const newest = listBackups(paths);
  const kept = new Set([...newest.slice(0, keep).map((b) => b.name), ...protect]);
  const removed: string[] = [];
  for (const backup of newest) {
    if (kept.has(backup.name) || !BACKUP_NAME.test(backup.name) || !isSealed(backup.path)) continue;
    fs.rmSync(backup.path, { recursive: true, force: true });
    removed.push(backup.name);
  }
  return removed;
}

/** `name` as a backup folder, or "Backup not found": the name must be `full-…` and a real folder, not a link. */
function backupFolder(paths: MordomoPaths, name: string): string {
  const src = path.join(paths.backups, name);
  if (!BACKUP_NAME.test(name) || !fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) {
    throw new Error(`Backup not found: ${name}`);
  }
  return src;
}

/**
 * Check a backup in place against its manifest, without restoring: throws `BackupVerificationError`
 * (`backup_unsealed` when there is no manifest, `backup_invalid` for anything that does not match). Yields to the
 * event loop between files, so a service can ask before it stages a restore.
 */
export async function verifyBackup(paths: MordomoPaths, name: string): Promise<void> {
  const src = backupFolder(paths, name);
  const manifest = readManifest(src);
  if (manifest === "absent") throw unsealedBackup(name);
  if (manifest === "invalid") throw invalidBackup(name, [{ path: MANIFEST_NAME, kind: "checksum" }]);
  const mounts: Mount[] = RESTORABLE.map((rel) => ({ rel, actual: path.join(src, ...rel.split("/")) }));
  const problems = await verifyMountsAsync(manifest, mounts);
  if (problems.length > 0) throw invalidBackup(name, problems);
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
 *
 * Order, and why: the backup's parts are copied to a staging folder; the COPIES are checked against the manifest
 * (what is installed is what was checked, a file changed after the copy cannot get in); only then are the safety
 * backup made and a journal written; then each target is moved aside and its copy moved in, the database's
 * `-wal`/`-shm` first so a new database is never opened with an old WAL. A failure puts every target back; a
 * process that dies half way leaves the journal for `recoverInterruptedRestore`.
 */
export function restoreBackup(
  paths: MordomoPaths,
  name: string,
  options: RestoreOptions = {},
): { safetyBackup: BackupInfo } {
  const src = backupFolder(paths, name);
  recoverInterruptedRestore(paths);
  const manifest = readManifest(src);
  if (manifest === "invalid") throw invalidBackup(name, [{ path: MANIFEST_NAME, kind: "checksum" }]);
  if (manifest === "absent" && options.allowUnverified !== true) throw unsealedBackup(name);
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
    throw new BackupVerificationError(
      "backup_invalid",
      "Invalid backup database. Choose a complete, compatible backup; current files were not changed.",
    );
  } finally {
    candidate?.close();
  }
  const includeArtifacts = fs.existsSync(path.join(src, "artifacts"));

  // Prepare every replacement before moving live data. In particular ENOSPC
  // during copying must not leave an emptied skills/memory directory behind.
  // The name carries the pid: a folder that dies before its journal exists still says whose it was.
  const staging = fs.mkdtempSync(path.join(paths.home, `.restore-${process.pid}-`));
  const journal: RestoreJournal = {
    pid: process.pid,
    procStart: processStartMarker(process.pid),
    phase: "staging",
    entries: [],
  };
  const entries: Array<{
    rel: string | null;
    source: string | null;
    target: string;
    staged: string;
    old: string;
    moved: boolean;
    installed: boolean;
  }> = [];
  const add = (rel: string | null, source: string | null, target: string) => {
    if (source && !fs.existsSync(source)) return;
    const index = entries.length;
    entries.push({
      rel,
      source,
      target,
      staged: path.join(staging, `new-${index}`),
      old: path.join(staging, `old-${index}`),
      moved: false,
      installed: false,
    });
  };
  const inBackup = (rel: string) => path.join(src, ...rel.split("/"));
  for (const set of BACKUP_SETS) add(set, inBackup(set), paths[set]);
  if (includeArtifacts) add("artifacts", inBackup("artifacts"), paths.artifacts);
  add("config/settings.json", inBackup("config/settings.json"), paths.settingsFile);
  if (fs.existsSync(inBackup("config/ui-preferences.json")))
    add("config/ui-preferences.json", inBackup("config/ui-preferences.json"), paths.uiPreferencesFile);
  // A backup from before ui-preferences.json (settings version 1) keeps its
  // preferences inside settings.json: drop the live file so the next load
  // migrates the backup's own values instead of keeping the current ones.
  else if (fs.existsSync(inBackup("config/settings.json"))) add(null, null, paths.uiPreferencesFile);
  add("config/sync-manifest.json", inBackup("config/sync-manifest.json"), paths.syncManifest);
  for (const suffix of ["-wal", "-shm"]) add(null, null, paths.dbFile + suffix);
  add("config/db/mordomo.db", inBackup("config/db/mordomo.db"), paths.dbFile);
  let preserveStaging = false;
  try {
    writeJournal(staging, journal);
    for (const entry of entries) {
      if (entry.source) fs.cpSync(entry.source, entry.staged, { recursive: true });
    }
    if (manifest !== "absent") {
      const mounts: Mount[] = RESTORABLE.map((rel) => ({
        rel,
        actual: entries.find((e) => e.rel === rel)?.staged ?? null,
      }));
      const problems = verifyMounts(manifest, mounts);
      if (problems.length > 0) throw invalidBackup(name, problems);
    }
    // Safety backup by plain copy: valid only because the DB is closed.
    const { dest, dbFile } = snapshotFiles(paths, { includeArtifacts });
    let safetyBackup: BackupInfo;
    try {
      if (fs.existsSync(paths.dbFile)) fs.copyFileSync(paths.dbFile, dbFile);
      safetyBackup = finalize(dest, buildManifest(dest));
    } catch (error) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw error;
    }
    journal.phase = "installing";
    journal.entries = entries.map((e) => ({
      target: e.target,
      old: e.old,
      staged: e.staged,
      hadTarget: fs.existsSync(e.target),
    }));
    writeJournal(staging, journal);
    try {
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
    }
    // Everything is installed: the restore has happened. Marking it done only keeps a later recovery from undoing
    // it, and failing to write the mark must not turn a finished restore into an error.
    journal.phase = "done";
    try {
      writeJournal(staging, journal);
    } catch {
      /* see above */
    }
    return { safetyBackup };
  } finally {
    if (!preserveStaging) fs.rmSync(staging, { recursive: true, force: true });
  }
}

// ---- Restore journal: a restore that dies half way is undone, never left half applied -----------------------

interface RestoreJournal {
  pid: number;
  procStart: string | null;
  /** `staging`: nothing live was touched; `installing`: targets may have been moved; `done`: all installed. */
  phase: "staging" | "installing" | "done";
  entries: Array<{ target: string; old: string; staged: string; hadTarget: boolean }>;
}

const JOURNAL = "JOURNAL.json";

function writeJournal(staging: string, journal: RestoreJournal): void {
  atomicWrite(path.join(staging, JOURNAL), JSON.stringify(journal));
}

function readJournal(staging: string): RestoreJournal | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(staging, JOURNAL), "utf8")) as Partial<RestoreJournal>;
    if (typeof raw.pid !== "number" || !Array.isArray(raw.entries)) return null;
    return {
      pid: raw.pid,
      procStart: typeof raw.procStart === "string" ? raw.procStart : null,
      phase: raw.phase === "installing" || raw.phase === "done" ? raw.phase : "staging",
      entries: raw.entries,
    };
  } catch {
    return null;
  }
}

/**
 * Before anything seals the home (a backup): undo restores whose process is gone, and refuse while one is running.
 */
function assertNoRestoreInProgress(paths: MordomoPaths): void {
  recoverInterruptedRestore(paths);
  let running: string[] = [];
  try {
    running = fs.readdirSync(paths.home).filter((n) => n.startsWith(".restore-"));
  } catch {
    return;
  }
  if (running.length > 0) {
    throw new Error(
      `A restore is in progress (${running[0]}): its files are not all in place yet. Try again when it has finished.`,
    );
  }
}

/**
 * Undo restores whose process is gone: for each `.restore-*` folder in the home whose journal names a process that
 * is no longer running (or that is not this one), put every target that was moved aside back, remove what was
 * installed from the staging, and remove the folder. A restore that finished (`done`) only has its folder
 * removed. One whose process is alive is left alone. Returns the folders it dealt with.
 */
export function recoverInterruptedRestore(paths: MordomoPaths): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(paths.home).filter((n) => n.startsWith(".restore-"));
  } catch {
    return [];
  }
  const recovered: string[] = [];
  for (const name of names) {
    const staging = path.join(paths.home, name);
    const journal = readJournal(staging);
    if (journal === null) {
      // No journal: nothing live was touched. It is still being made by a live process (its pid is in the name),
      // or its process died before writing it and the folder is only debris.
      const owner = /^\.restore-(\d+)-/.exec(name);
      if (owner && !lockIsStale({ pid: Number(owner[1]) }, realProbe, process.pid)) continue;
      fs.rmSync(staging, { recursive: true, force: true });
      recovered.push(name);
      continue;
    }
    if (!lockIsStale({ pid: journal.pid, procStart: journal.procStart }, realProbe, process.pid)) continue;
    const failures: unknown[] = [];
    if (journal.phase === "installing") {
      for (const entry of [...journal.entries].reverse()) {
        try {
          if (fs.existsSync(entry.old)) {
            fs.rmSync(entry.target, { recursive: true, force: true });
            fs.renameSync(entry.old, entry.target);
          } else if (!entry.hadTarget && !fs.existsSync(entry.staged)) {
            fs.rmSync(entry.target, { recursive: true, force: true });
          }
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `An interrupted restore could not be undone. Preserved files: ${staging}`,
      );
    }
    fs.rmSync(staging, { recursive: true, force: true });
    recovered.push(name);
  }
  return recovered;
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.lstatSync(full).size; // a link counts as itself: a dangling one must not fail the listing
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
  recoverInterruptedRestore(paths);
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

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
import { RestoreInProgressError, RestoreLock, withRestoreLock } from "./restoreLock.js";

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

/** How long a backup waits for the restore lock: other backups hold it for an instant, a restore for minutes. */
const BACKUP_GUARD_WAIT_MS = 3000;

const RESTORE_WAIT_MS = 15_000;

const BACKUP_NAME = /^full-[A-Za-z0-9-]{1,80}$/;

export interface BackupOptions {
  includeArtifacts?: boolean;
  /** Backups to keep: after this one is published, the sealed ones beyond the `keep` newest are deleted. */
  keep?: number;
}

export interface RestoreOptions {
  /** How long to wait for the restore lock before refusing (ms, default 15 000; 0 refuses at once). */
  waitMs?: number;
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
  // The files of the home must stay as they are from the first copy to the published manifest: a restore that
  // starts half way would leave a backup with some of the old files and some of the new. So the backup holds the
  // shared restore lock throughout (restores are refused meanwhile; other backups are not), after the leftovers
  // of a dead restore have been undone - a home half restored is not a state to seal.
  const lock = await lockHomeForBackup(paths);
  try {
    return await createBackupLocked(paths, db, opts);
  } finally {
    lock.release();
  }
}

async function createBackupLocked(paths: MordomoPaths, db: Db, opts: BackupOptions): Promise<BackupInfo> {
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
  // One restore at a time, and none while a backup runs or another process undoes a dead restore or is starting:
  // a short wait (an engine being built holds the lock for milliseconds), then refused.
  return withRestoreLock(paths, options.waitMs ?? RESTORE_WAIT_MS, () =>
    restoreBackupLocked(paths, name, options),
  );
}

/** `restoreBackup` for a caller that already holds the restore lock. */
export function restoreBackupLocked(
  paths: MordomoPaths,
  name: string,
  options: RestoreOptions = {},
): { safetyBackup: BackupInfo } {
  const src = backupFolder(paths, name);
  recoverLocked(paths);
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
    phase: "staging",
    entries: [],
  };
  const entries: Array<{
    slot: RestoreSlot;
    rel: string | null;
    source: string | null;
    target: string;
    staged: string;
    old: string;
    moved: boolean;
    installed: boolean;
  }> = [];
  const slots = restoreSlots(paths);
  const add = (rel: string | null, source: string | null, slot: RestoreSlot) => {
    const target = slots[slot];
    if (source && !fs.existsSync(source)) return;
    const index = entries.length;
    entries.push({
      slot,
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
  for (const set of BACKUP_SETS) add(set, inBackup(set), set);
  if (includeArtifacts) add("artifacts", inBackup("artifacts"), "artifacts");
  add("config/settings.json", inBackup("config/settings.json"), "settings");
  if (fs.existsSync(inBackup("config/ui-preferences.json")))
    add("config/ui-preferences.json", inBackup("config/ui-preferences.json"), "uiPreferences");
  // A backup from before ui-preferences.json (settings version 1) keeps its
  // preferences inside settings.json: drop the live file so the next load
  // migrates the backup's own values instead of keeping the current ones.
  else if (fs.existsSync(inBackup("config/settings.json"))) add(null, null, "uiPreferences");
  add("config/sync-manifest.json", inBackup("config/sync-manifest.json"), "syncManifest");
  add(null, null, "dbWal");
  add(null, null, "dbShm");
  add("config/db/mordomo.db", inBackup("config/db/mordomo.db"), "db");
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
      slot: e.slot,
      target: e.target,
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

/**
 * The eleven things a restore replaces, by name. The journal says WHICH of them, never where: the place is always
 * derived from the paths of the process that reads it, so a home reached by another spelling (a link, a moved
 * folder, `/tmp` against `/private/tmp`) is undone like any other, and a journal cannot point anywhere else.
 */
const RESTORE_SLOTS = [
  "skills",
  "memory",
  "routines",
  "connectors",
  "artifacts",
  "settings",
  "uiPreferences",
  "syncManifest",
  "dbWal",
  "dbShm",
  "db",
] as const;
type RestoreSlot = (typeof RESTORE_SLOTS)[number];

function restoreSlots(paths: MordomoPaths): Record<RestoreSlot, string> {
  return {
    skills: paths.skills,
    memory: paths.memory,
    routines: paths.routines,
    connectors: paths.connectors,
    artifacts: paths.artifacts,
    settings: paths.settingsFile,
    uiPreferences: paths.uiPreferencesFile,
    syncManifest: paths.syncManifest,
    dbWal: `${paths.dbFile}-wal`,
    dbShm: `${paths.dbFile}-shm`,
    db: paths.dbFile,
  };
}

interface RestoreJournal {
  /** Whose restore it was (for a human reading the folder; the lock is what says it is over). */
  pid: number;
  /** `staging`: nothing live was touched; `installing`: targets may have been moved; `done`: all installed. */
  phase: "staging" | "installing" | "done";
  /**
   * In order; the entry at index N owns `old-N` and `new-N` of the staging folder. `target` is informational (what
   * a person reading the file sees): it is never acted upon, the slot is.
   */
  entries: Array<{ slot: RestoreSlot; target: string; hadTarget: boolean }>;
}

const JOURNAL = "JOURNAL.json";

function writeJournal(staging: string, journal: RestoreJournal): void {
  atomicWrite(path.join(staging, JOURNAL), JSON.stringify(journal));
}

/** `absent`: there is none; `damaged`: it is there but is not a journal this code wrote. */
function readJournal(staging: string): RestoreJournal | "absent" | "damaged" {
  let text: string;
  try {
    text = fs.readFileSync(path.join(staging, JOURNAL), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "damaged";
  }
  try {
    const raw = JSON.parse(text) as Partial<RestoreJournal> | null;
    if (typeof raw !== "object" || raw === null) return "damaged";
    if (typeof raw.pid !== "number" || !Array.isArray(raw.entries)) return "damaged";
    if (raw.phase !== "staging" && raw.phase !== "installing" && raw.phase !== "done") return "damaged";
    // A journal is a list of things to delete and rename, so one that names anything but the eleven slots of a
    // restore, twice, or without saying whether the target existed, is not acted upon (anyone who can write to
    // the home could plant one).
    const seen = new Set<string>();
    for (const entry of raw.entries as unknown[]) {
      const e = entry as { slot?: unknown; hadTarget?: unknown } | null;
      if (typeof e !== "object" || e === null) return "damaged";
      if (typeof e.slot !== "string" || !(RESTORE_SLOTS as readonly string[]).includes(e.slot))
        return "damaged";
      if (seen.has(e.slot) || typeof e.hadTarget !== "boolean") return "damaged";
      seen.add(e.slot);
    }
    return {
      pid: raw.pid,
      phase: raw.phase,
      entries: (raw.entries as RestoreJournal["entries"]).map((e) => ({
        slot: e.slot,
        target: typeof e.target === "string" ? e.target : "",
        hadTarget: e.hadTarget,
      })),
    };
  } catch {
    return "damaged";
  }
}

/** The only names a restore's staging folder has, and it is a direct child of the home. */
const STAGING_NAME = /^\.restore-\d+-[A-Za-z0-9]+$/;

/** An interrupted restore that cannot be put back: where its files are, why, and what to do by hand. */
export class RestoreRecoveryError extends Error {
  readonly code = "restore_recovery_failed";
  constructor(staging: string, causes: unknown[]) {
    const first = causes[0] instanceof Error ? causes[0].message : String(causes[0]);
    super(
      `An interrupted restore could not be undone (${first}). Its files are in ${staging}: for each entry of ` +
        `${JOURNAL} there, move old-N back over its target, then delete the folder. Nothing else was touched.`,
      { cause: causes[0] },
    );
    this.name = "RestoreRecoveryError";
  }
}

/**
 * A `.restore-*` folder that MordomoOS will not delete or act on: it is not a folder, its journal is damaged or
 * was not written by a restore, or it holds files (`old-N`) a damaged journal can no longer place. Whatever is
 * asked of the home (a backup, a restore, an engine) is refused while it is there: nothing is changed.
 */
export class RestoreLeftoverError extends Error {
  readonly code = "restore_leftover";
  /** What an API answers. */
  readonly statusCode = 409;
  constructor(
    readonly leftovers: Array<{ name: string; folder: string; reason: string }>,
    /** What was undone in the same pass. */
    readonly recovered: string[] = [],
  ) {
    const list = leftovers.map((l) => `${l.folder} (${l.reason})`).join("; ");
    super(
      `The home holds ${leftovers.length} leftover(s) of a restore that cannot be undone safely by itself: ${list}. ` +
        "Nothing was changed. Look inside (JOURNAL.json, old-N): move back by hand whatever belongs to the home " +
        "(old-N is the original of the Nth entry), then delete the folder and try again.",
    );
    this.name = "RestoreLeftoverError";
  }
}

/** Is there a `.restore-*` folder in the home? (Shared holders may look: nothing creates one without the exclusive lock.) */
export function hasStagingFolders(paths: MordomoPaths): boolean {
  try {
    return fs.readdirSync(paths.home).some((n) => STAGING_NAME.test(n));
  } catch {
    return false;
  }
}

/**
 * The shared restore lock for a backup: any number of backups at once, none while a restore runs (it waits for it
 * a few seconds without blocking the event loop, then is refused). Leftovers of a dead restore are undone first
 * (that takes the exclusive lock, so the shared one is let go and taken again); leftovers that cannot be undone
 * refuse the backup (`RestoreLeftoverError`).
 */
async function lockHomeForBackup(paths: MordomoPaths): Promise<RestoreLock> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const lock = await RestoreLock.acquireAsync(paths, BACKUP_GUARD_WAIT_MS, "shared");
    if (!hasStagingFolders(paths)) return lock;
    lock.release();
    withRestoreLock(paths, 10_000, () => recoverLocked(paths));
  }
  throw new RestoreInProgressError();
}

/**
 * Undo restores that died: for each `.restore-*` folder in the home, put every target that was moved aside back,
 * remove what was installed from the staging, and remove the folder. A restore that finished (`done`) only has its
 * folder removed; a folder with no journal and nothing of the home inside (its process died before the journal)
 * touched nothing and is removed.
 *
 * What it cannot place it keeps: a folder that is a link or a file, a journal that is damaged or not a restore's,
 * a folder with `old-N` and no journal. Those are left exactly as they are and, after everything else was dealt
 * with, `RestoreLeftoverError` says so - a caller never goes on over them.
 *
 * It takes the restore lock, so it is one process at a time and never while a restore is running: when it has the
 * lock, no restore is alive, and every folder it finds is debris. Several commands finding the same dead restore
 * at once therefore queue up, and the later ones find nothing left. Waits up to `waitMs` for the lock, then
 * throws `RestoreInProgressError`. Returns the folders it dealt with.
 */
export function recoverInterruptedRestore(paths: MordomoPaths, waitMs = 10_000): string[] {
  return withRestoreLock(paths, waitMs, () => recoverLocked(paths));
}

/** `recoverInterruptedRestore` for a caller that holds the restore lock. */
export function recoverLocked(paths: MordomoPaths): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(paths.home).filter((n) => STAGING_NAME.test(n));
  } catch {
    return [];
  }
  const slots = restoreSlots(paths);
  const recovered: string[] = [];
  const leftovers: RestoreLeftoverError["leftovers"] = [];
  for (const name of names) {
    const staging = path.join(paths.home, name);
    const keep = (reason: string) => leftovers.push({ name, folder: staging, reason });
    try {
      // A direct child of the home that is a real folder, never a link to somewhere else.
      if (!fs.lstatSync(staging).isDirectory()) {
        keep("not a folder");
        continue;
      }
    } catch {
      continue; // gone meanwhile
    }
    const journal = readJournal(staging);
    if (journal === "damaged") {
      keep("its JOURNAL.json is damaged or was not written by a restore");
      continue;
    }
    if (journal === "absent") {
      let holdsOriginals = false;
      try {
        holdsOriginals = fs.readdirSync(staging).some((n) => /^old-\d+$/.test(n));
      } catch {
        holdsOriginals = true; // cannot tell: do not delete what cannot be seen
      }
      if (holdsOriginals) {
        keep("it holds old-N and has no JOURNAL.json");
        continue;
      }
      fs.rmSync(staging, { recursive: true, force: true });
      recovered.push(name);
      continue;
    }
    const failures: unknown[] = [];
    if (journal.phase === "installing") {
      for (let index = journal.entries.length - 1; index >= 0; index--) {
        const entry = journal.entries[index]!;
        const target = slots[entry.slot];
        const old = path.join(staging, `old-${index}`);
        const staged = path.join(staging, `new-${index}`);
        try {
          if (fs.existsSync(old)) {
            fs.rmSync(target, { recursive: true, force: true });
            fs.renameSync(old, target);
          } else if (!entry.hadTarget && !fs.existsSync(staged)) {
            fs.rmSync(target, { recursive: true, force: true });
          }
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0) throw new RestoreRecoveryError(staging, failures);
    fs.rmSync(staging, { recursive: true, force: true });
    recovered.push(name);
  }
  if (leftovers.length > 0) throw new RestoreLeftoverError(leftovers, recovered);
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
  return withRestoreLock(paths, 10_000, () => applyPendingRestoreLocked(paths));
}

/** `applyPendingRestore` for a caller that holds the restore lock (the engine, while it builds). */
export function applyPendingRestoreLocked(paths: MordomoPaths): { applied: RestorePending | null } {
  recoverLocked(paths);
  const pending = readRestorePending(paths);
  if (!pending) return { applied: null };
  const original = path.join(paths.backups, pending.name);
  if (!fs.existsSync(original) && fs.existsSync(pending.stagedPath)) {
    fs.cpSync(pending.stagedPath, original, { recursive: true });
  }
  try {
    restoreBackupLocked(paths, pending.name);
  } finally {
    clearRestorePending(paths);
  }
  return { applied: pending };
}

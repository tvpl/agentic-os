import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, tightenMode, type MordomoPaths } from "./paths.js";
import { RestoreInProgressError } from "./errors.js";

export { RestoreInProgressError };

/** `config/run/restore.lock` cannot be used as a lock: it is not a file, or not a database file. */
export class RestoreLockError extends Error {
  readonly code = "restore_lock_unusable";
  /** What an API answers. */
  readonly statusCode = 409;
  constructor(file: string, reason: string) {
    // Named from the home (`config/run/restore.lock`), never by its absolute path: an API sends this to a client.
    super(
      `${file} cannot be used as the restore lock (${reason}). If no MordomoOS process is running, remove it by ` +
        "hand and try again; never remove it while one is, that is what the lock is made of.",
    );
    this.name = "RestoreLockError";
  }
}

/**
 * `exclusive`: a restore, the undoing of a dead one, the application of a staged one - nothing else may be
 * working on the files of the home. `shared`: something that needs the files to stay as they are while it works
 * (a backup, the construction of an engine up to its database being open); any number of these at once, none
 * while an exclusive one is held or waiting for.
 */
export type RestoreLockMode = "shared" | "exclusive";

/** What this process holds, by lock file: a second lock on a file closes the first one's (POSIX), so it is refused. */
const heldHere = new Map<string, { exclusive: number; shared: number }>();

/**
 * Every lock that is held, strongly: a lock nobody keeps a reference to (a caller that dropped it) is still a
 * lock, and the garbage collector closing its connection would silently release it.
 */
const live = new Set<RestoreLock>();

/** The lock file, as the messages name it: from the home. */
const LOCK_NAME = "config/run/restore.lock";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The lock restores, recoveries and backups take so that they never work on the files of the home at the same
 * time (and an engine does not open the database while a restore is replacing it).
 *
 * It is the file lock of a small SQLite file, `config/run/restore.lock` (`BEGIN EXCLUSIVE`, or a read inside `BEGIN`
 * for the shared kind). The kernel owns it: it is released the moment the process holding it dies, however it
 * dies, so there is no stale lock to judge and no pid to mistake for another. This file exists, and is not the
 * home's own database, because that one may be moved aside, or not yet there, while a restore runs.
 *
 * Limits, stated: the lock belongs to the INODE of the file. Deleting or replacing `restore.lock`, or removing
 * `config/run`, while it is held lets a second process in (the owner is told to clean `config/run` by hand in
 * another message, so this matters): after taking the lock the path is checked to still name the file that was
 * locked, which narrows that window to the instant between the two, no more. A process that holds the lock
 * must not ask for it again (a second connection of one process would close the first one's locks): that is an
 * error, not a wait.
 */
export class RestoreLock {
  private released = false;

  private constructor(
    private readonly db: Database.Database,
    private readonly key: string,
    private readonly mode: RestoreLockMode,
  ) {}

  /** Wait up to `waitMs` (0: not at all, the wait blocks this thread). Not obtained: `RestoreInProgressError`. */
  static acquire(paths: MordomoPaths, waitMs: number, mode: RestoreLockMode = "exclusive"): RestoreLock {
    return RestoreLock.attempt(paths, waitMs, mode);
  }

  /** The same, waiting without blocking the event loop (a service answering requests). */
  static async acquireAsync(
    paths: MordomoPaths,
    waitMs: number,
    mode: RestoreLockMode = "shared",
  ): Promise<RestoreLock> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        return RestoreLock.attempt(paths, 0, mode);
      } catch (error) {
        if (!(error instanceof RestoreInProgressError) || Date.now() >= deadline) throw error;
      }
      await sleep(25);
    }
  }

  private static attempt(paths: MordomoPaths, waitMs: number, mode: RestoreLockMode): RestoreLock {
    const file = path.join(paths.run, "restore.lock");
    const held = heldHere.get(file);
    if (mode === "exclusive" && held?.exclusive) {
      throw new Error("The restore lock is not reentrant: this process holds it already.");
    }
    // This process holds the other kind: waiting for it would wait for ourselves.
    if ((mode === "exclusive" && held?.shared) || (mode === "shared" && held?.exclusive)) {
      throw new RestoreInProgressError();
    }

    fs.mkdirSync(paths.run, { recursive: true, mode: PRIVATE_DIR_MODE });
    let created = false;
    try {
      // Created only when absent (and owner-only): opening and closing a descriptor on a file this process
      // holds a lock on would release that lock.
      fs.closeSync(fs.openSync(file, "wx", PRIVATE_FILE_MODE));
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!created && held === undefined) tightenMode(file, PRIVATE_FILE_MODE);
    if (!fs.lstatSync(file).isFile()) throw new RestoreLockError(LOCK_NAME, "it is not a regular file");

    for (let again = 0; again < 3; again++) {
      const before = fs.statSync(file);
      const db = RestoreLock.open(file, waitMs);
      try {
        db.pragma("journal_mode = MEMORY"); // no journal file: taking the lock creates and removes nothing
        db.pragma(`busy_timeout = ${Math.max(0, Math.floor(waitMs))}`);
        if (mode === "exclusive") {
          db.exec("BEGIN EXCLUSIVE");
        } else {
          db.exec("BEGIN");
          db.prepare("SELECT count(*) FROM sqlite_master").get(); // the read takes the shared lock
        }
      } catch (error) {
        db.close();
        const code = (error as { code?: unknown }).code;
        if (code === "SQLITE_BUSY") throw new RestoreInProgressError();
        if (typeof code === "string" && code.startsWith("SQLITE_")) {
          throw new RestoreLockError(LOCK_NAME, (error as Error).message);
        }
        throw error;
      }
      // Still the file we locked? (It was deleted or replaced while we waited: lock the one that is there now.)
      let after: fs.Stats | null = null;
      try {
        after = fs.statSync(file);
      } catch {
        /* gone */
      }
      if (after !== null && after.ino === before.ino && after.dev === before.dev) {
        const entry = heldHere.get(file) ?? { exclusive: 0, shared: 0 };
        entry[mode]++;
        heldHere.set(file, entry);
        const lock = new RestoreLock(db, file, mode);
        live.add(lock);
        return lock;
      }
      db.exec("ROLLBACK");
      db.close();
      if (after === null) fs.closeSync(fs.openSync(file, "a", PRIVATE_FILE_MODE));
    }
    throw new RestoreLockError(LOCK_NAME, "it kept being replaced while it was being locked");
  }

  private static open(file: string, waitMs: number): Database.Database {
    try {
      // The wait is given at open: the driver's own default (5 s) would otherwise apply to the first statement.
      return new Database(file, { timeout: Math.max(0, Math.floor(waitMs)) });
    } catch (error) {
      throw new RestoreLockError(LOCK_NAME, (error as Error).message);
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    live.delete(this);
    const entry = heldHere.get(this.key);
    if (entry) {
      entry[this.mode]--;
      if (entry.exclusive <= 0 && entry.shared <= 0) heldHere.delete(this.key);
    }
    try {
      this.db.exec("ROLLBACK");
    } finally {
      this.db.close();
    }
  }
}

/** Run `work` holding the lock. */
export function withRestoreLock<T>(
  paths: MordomoPaths,
  waitMs: number,
  work: () => T,
  mode: RestoreLockMode = "exclusive",
): T {
  const lock = RestoreLock.acquire(paths, waitMs, mode);
  try {
    return work();
  } finally {
    lock.release();
  }
}

/**
 * Look at `config/run/restore.lock` without taking it, opening it with SQLite or changing anything: why it cannot
 * be the lock (a folder, a link, bytes that are not a SQLite file), or `null` when it is fine or absent. For the
 * commands that must work when nothing else does (`doctor`, `status`, `stop`, `backup --list`). Not for a process
 * that holds the lock: reading the file opens and closes a descriptor on it, which would release the lock.
 */
export function inspectLockFile(paths: MordomoPaths): string | null {
  const file = path.join(paths.run, "restore.lock");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return "it is not a regular file";
  if (stat.size === 0) return null; // what this code creates: SQLite makes it a database when it is first used
  try {
    const fd = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(16);
      const read = fs.readSync(fd, header, 0, 16, 0);
      if (read < 16 || header.toString("latin1") !== "SQLite format 3\0") return "it is not a SQLite file";
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "it cannot be read";
  }
  return null;
}

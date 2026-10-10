import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, tightenMode, type MordomoPaths } from "./paths.js";

/** A restore (or the undoing of one that died) is running in another process: nothing may touch the home now. */
export class RestoreInProgressError extends Error {
  readonly code = "restore_in_progress";
  /** What an API answers. */
  readonly statusCode = 409;
  constructor() {
    super(
      "A restore is in progress in another process (config/run/restore.lock is held), so the home is not in a " +
        "state anything may build on. Try again when it has finished.",
    );
    this.name = "RestoreInProgressError";
  }
}

/**
 * The lock every restore, every undoing of a dead restore and every construction of the engine takes, so that
 * exactly one of them works on the files of the home at a time.
 *
 * It is the write lock of a small SQLite file, `config/run/restore.lock` (`BEGIN IMMEDIATE`, held until
 * `release`). The kernel owns it: it is released the moment the process holding it dies, however it dies, so
 * there is no stale lock to judge, no pid to mistake for another, and nobody can take over a lock that is live.
 * That is the same reason `OwnerLock` takes its critical section inside the database; this file exists because
 * the home's own database may be moved aside, or not yet there, while a restore runs.
 *
 * `waitMs` is how long to wait for a holder to finish (0: not at all). Not obtained in time: `RestoreInProgressError`.
 */
export class RestoreLock {
  private constructor(private readonly db: Database.Database) {}

  static acquire(paths: MordomoPaths, waitMs: number): RestoreLock {
    fs.mkdirSync(paths.run, { recursive: true, mode: PRIVATE_DIR_MODE });
    const file = path.join(paths.run, "restore.lock");
    // Created owner-only and tightened BEFORE the connection exists (closing a descriptor on a file SQLite has
    // open would drop its locks, see tightenMode).
    fs.closeSync(fs.openSync(file, "a", PRIVATE_FILE_MODE));
    tightenMode(file, PRIVATE_FILE_MODE);
    const db = new Database(file);
    try {
      // No journal file: taking the lock creates and removes nothing in `config/run`.
      db.pragma("journal_mode = MEMORY");
      db.pragma(`busy_timeout = ${Math.max(0, Math.floor(waitMs))}`);
      db.exec("BEGIN IMMEDIATE");
      return new RestoreLock(db);
    } catch (error) {
      db.close();
      if ((error as { code?: unknown }).code === "SQLITE_BUSY") throw new RestoreInProgressError();
      throw error;
    }
  }

  release(): void {
    try {
      this.db.exec("ROLLBACK");
    } finally {
      this.db.close();
    }
  }
}

/** Run `work` holding the lock. */
export function withRestoreLock<T>(paths: MordomoPaths, waitMs: number, work: () => T): T {
  const lock = RestoreLock.acquire(paths, waitMs);
  try {
    return work();
  } finally {
    lock.release();
  }
}

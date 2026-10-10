import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, tightenMode, type MordomoPaths } from "../paths.js";
import { MIGRATIONS, type Migration } from "./migrations.js";

export type Db = Database.Database;

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
}

/** The database was written by a newer MordomoOS than this one: nothing was changed. */
export class DbNewerVersionError extends Error {
  readonly code = "db_newer";
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `This database is at schema version ${found}, newer than the ${supported} this MordomoOS understands. ` +
        "Use that version or restore a compatible backup.",
    );
    this.name = "DbNewerVersionError";
  }
}

/** A migration threw: the whole run was rolled back and the database is at `fromVersion`. */
export class MigrationError extends Error {
  readonly code = "db_migration_failed";
  constructor(
    readonly version: number,
    readonly migration: string,
    readonly fromVersion: number,
    readonly backupPath: string | null,
    cause: unknown,
  ) {
    super(
      `Migration ${version} "${migration}" failed: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `Everything this run changed was rolled back; the database is still at version ${fromVersion}.` +
        (backupPath ? ` A copy of it from before this attempt is at ${backupPath}.` : ""),
      { cause },
    );
    this.name = "MigrationError";
  }
}

export function openDb(
  paths: MordomoPaths,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): { db: Db; migration: MigrationResult } {
  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true, mode: PRIVATE_DIR_MODE });
  // SQLite gives the -wal and -shm files the mode of the database file, so the
  // file is created owner-only before SQLite opens it.
  fs.closeSync(fs.openSync(paths.dbFile, "a", PRIVATE_FILE_MODE));
  // A file left by an older release is tightened BEFORE the connection opens: once SQLite holds the file, a
  // descriptor opened and closed on it would drop this process's locks (see `tightenMode`). Files SQLite creates
  // from here on take the mode of the database file.
  for (const suffix of ["", "-wal", "-shm"]) tightenMode(paths.dbFile + suffix, PRIVATE_FILE_MODE);
  const db = new Database(paths.dbFile);
  try {
    // A CLI command and the service write to the same file: wait for the other writer instead of failing.
    // Set before anything that needs the file free, and switching to WAL does.
    db.pragma("busy_timeout = 5000");
    assertNotNewer(currentVersion(db), latestVersion(migrations));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const migration = runMigrations(db, paths, migrations);
    return { db, migration };
  } catch (error) {
    db.close();
    throw error;
  }
}

function currentVersion(db: Db): number {
  return db.pragma("user_version", { simple: true }) as number;
}

function latestVersion(migrations: ReadonlyArray<Migration>): number {
  return Math.max(0, ...migrations.map((migration) => migration.version));
}

function assertNotNewer(found: number, supported: number): void {
  if (found > supported) throw new DbNewerVersionError(found, supported);
}

/**
 * Bring the open database up to the newest of `migrations`, once, however many processes open it together.
 *
 * What is decided under the lock is what counts: the migrations run in an EXCLUSIVE transaction that reads
 * `user_version` again after the lock is taken, so a process that waited for another finds nothing left to
 * apply. The version it read before is only a shortcut for the common case (up to date: no lock, no write).
 * Version and schema change in the same transaction, so a migration that throws leaves the file as it was.
 *
 * Before applying anything to a database that has data, a snapshot is written to `config/backups/`. It is made
 * with `VACUUM INTO`, which is consistent while another process writes the WAL (a file copy is not) and keeps
 * `user_version`; one that turned out not to be needed (another process migrated first) is removed.
 */
export function runMigrations(
  db: Db,
  paths: MordomoPaths,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): MigrationResult {
  const latest = latestVersion(migrations);
  const seen = currentVersion(db);
  assertNotNewer(seen, latest);
  if (seen >= latest) return { fromVersion: seen, toVersion: seen, backupPath: null };

  let backupPath = seen > 0 ? snapshotBefore(db, paths, seen) : null;
  const applied = db
    .transaction(() => {
      const from = currentVersion(db);
      assertNotNewer(from, latest);
      for (const migration of migrations.filter((m) => m.version > from)) {
        try {
          if (migration.sql) db.exec(migration.sql);
          if (migration.up) migration.up(db);
        } catch (error) {
          throw new MigrationError(migration.version, migration.name, from, backupPath, error);
        }
        db.pragma(`user_version = ${migration.version}`);
      }
      return { from, to: currentVersion(db) };
    })
    .exclusive();

  if (applied.from === applied.to && backupPath) {
    fs.rmSync(backupPath, { force: true });
    backupPath = null;
  }
  return { fromVersion: applied.from, toVersion: applied.to, backupPath };
}

function snapshotBefore(db: Db, paths: MordomoPaths, version: number): string {
  fs.mkdirSync(paths.backups, { recursive: true, mode: PRIVATE_DIR_MODE });
  // Processes opening together can snapshot within the same millisecond: the name carries a random part.
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const target = path.join(paths.backups, `mordomo.db.v${version}.${stamp}.bak`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  tightenMode(target, PRIVATE_FILE_MODE);
  return target;
}

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, tightenMode, type MordomoPaths } from "../paths.js";
import { DbNewerVersionError, MigrationError } from "./errors.js";
import { MIGRATIONS, type Migration } from "./migrations.js";

export { DbNewerVersionError, MigrationError };

export type Db = Database.Database;

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
}

export function openDb(
  paths: MordomoPaths,
  migrations: ReadonlyArray<Migration> = MIGRATIONS,
): { db: Db; migration: MigrationResult } {
  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true, mode: PRIVATE_DIR_MODE });
  // A database from a newer version is refused before this process touches it in any way: no mode change, no
  // connection that could checkpoint its WAL when it closes (the bytes of the file stay as they were).
  const peeked = peekVersion(paths.dbFile);
  if (peeked !== null) assertNotNewer(peeked, latestVersion(migrations));
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

/**
 * `user_version` of the database file as it stands, without opening it for writing and, when it can be avoided,
 * without opening it with SQLite at all (a connection creates `-shm`, and closing the last one checkpoints):
 *  - no file, or an empty one: 0 (the only errors that mean "no database yet");
 *  - no WAL waiting: the 4 bytes at offset 60 of the header, which is where SQLite keeps it;
 *  - a WAL with frames in it (what a service killed mid-flight leaves; the version may live only there): a
 *    read-only connection, which never checkpoints.
 * `null` is "cannot tell" (not a SQLite file, unreadable): the normal open then reports it with its own message.
 */
function peekVersion(file: string): number | null {
  try {
    if (fs.statSync(file).size === 0) return 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? 0 : null;
  }
  let walFrames = false;
  try {
    walFrames = fs.statSync(`${file}-wal`).size > 0;
  } catch {
    /* no WAL */
  }
  if (!walFrames) {
    try {
      const fd = fs.openSync(file, "r");
      try {
        const header = Buffer.alloc(64);
        const read = fs.readSync(fd, header, 0, 64, 0);
        if (read < 64 || header.toString("latin1", 0, 16) !== "SQLite format 3\0") return null;
        return header.readUInt32BE(60);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }
  }
  let db: Db | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    return currentVersion(db);
  } catch {
    return null;
  } finally {
    db?.close();
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

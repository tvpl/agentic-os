import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, tightenMode, type MordomoPaths } from "../paths.js";
import { MIGRATIONS } from "./migrations.js";

export type Db = Database.Database;

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
}

export function openDb(paths: MordomoPaths): { db: Db; migration: MigrationResult } {
  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true, mode: PRIVATE_DIR_MODE });
  // SQLite gives the -wal and -shm files the mode of the database file, so the
  // file is created owner-only before SQLite opens it.
  fs.closeSync(fs.openSync(paths.dbFile, "a", PRIVATE_FILE_MODE));
  const db = new Database(paths.dbFile);
  try {
    if (currentVersion(db) > Math.max(...MIGRATIONS.map((migration) => migration.version))) {
      throw new Error(
        "This database was created by a newer MordomoOS version. Use that version or restore a compatible backup.",
      );
    }
    db.pragma("journal_mode = WAL");
    for (const suffix of ["", "-wal", "-shm"]) tightenMode(paths.dbFile + suffix, PRIVATE_FILE_MODE);
    db.pragma("foreign_keys = ON");
    // A CLI command and the service write to the same file: wait for the other writer instead of failing.
    db.pragma("busy_timeout = 5000");
    const migration = migrate(db, paths);
    return { db, migration };
  } catch (error) {
    db.close();
    throw error;
  }
}

function currentVersion(db: Db): number {
  return db.pragma("user_version", { simple: true }) as number;
}

function migrate(db: Db, paths: MordomoPaths): MigrationResult {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (pending.length === 0) {
    return { fromVersion: from, toVersion: from, backupPath: null };
  }

  // Backup before migrating — only when the DB already has content.
  let backupPath: string | null = null;
  if (from > 0 && fs.existsSync(paths.dbFile)) {
    fs.mkdirSync(paths.backups, { recursive: true, mode: PRIVATE_DIR_MODE });
    backupPath = path.join(
      paths.backups,
      `mordomo.db.v${from}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`,
    );
    // better-sqlite3 backup API is async; a plain copy is safe because WAL is
    // checkpointed first and migrations run before any writer starts.
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(paths.dbFile, backupPath);
    tightenMode(backupPath, PRIVATE_FILE_MODE);
  }

  const apply = db.transaction(() => {
    for (const m of pending) {
      if (m.sql) db.exec(m.sql);
      if (m.up) m.up(db);
      db.pragma(`user_version = ${m.version}`);
    }
  });
  apply();

  return { fromVersion: from, toVersion: currentVersion(db), backupPath };
}

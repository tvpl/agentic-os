import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { MordomoPaths } from "../paths.js";
import { MIGRATIONS } from "./migrations.js";

export type Db = Database.Database;

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
}

export function openDb(paths: MordomoPaths): { db: Db; migration: MigrationResult } {
  fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });
  const db = new Database(paths.dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const migration = migrate(db, paths);
  return { db, migration };
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
    fs.mkdirSync(paths.backups, { recursive: true });
    backupPath = path.join(
      paths.backups,
      `mordomo.db.v${from}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`,
    );
    // better-sqlite3 backup API is async; a plain copy is safe because WAL is
    // checkpointed first and migrations run before any writer starts.
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(paths.dbFile, backupPath);
  }

  const apply = db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    }
  });
  apply();

  return { fromVersion: from, toVersion: currentVersion(db), backupPath };
}

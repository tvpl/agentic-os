import type { Db } from "../db/db.js";

/**
 * Tiny JSON accessor over the `meta` key/value table, the same one the indexer
 * and the recall stats use. Sentinels keep their "what did I see last time"
 * marks here so a restart does not replay yesterday's findings.
 */

export function readMetaJson<T>(db: Db, key: string): T | null {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

export function writeMetaJson(db: Db, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

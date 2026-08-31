import type { Db } from "../db/db.js";
import { fileRowFromDb, type FileRow } from "./indexer.js";

export interface SearchFilters {
  query: string;
  area?: string;
  ext?: string;
  dir?: string;
  tag?: string;
  modifiedAfter?: number;
  limit?: number;
}

export interface SearchHit extends FileRow {
  snippet: string | null;
  score: number;
}

/** Escape user input for FTS5: quote each term so no query syntax leaks through. */
function toFtsQuery(input: string): string {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t}"*`).join(" ");
}

export function searchFiles(db: Db, filters: SearchFilters): SearchHit[] {
  const limit = Math.min(filters.limit ?? 50, 200);
  const fts = toFtsQuery(filters.query);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.area) {
    clauses.push("f.area = ?");
    params.push(filters.area);
  }
  if (filters.ext) {
    clauses.push("f.ext = ?");
    params.push(filters.ext.startsWith(".") ? filters.ext : `.${filters.ext}`);
  }
  if (filters.dir) {
    clauses.push("f.dir LIKE ?");
    params.push(`${filters.dir}%`);
  }
  if (filters.tag) {
    clauses.push("f.tags LIKE ?");
    params.push(`%"${filters.tag.replace(/["%_]/g, "")}"%`);
  }
  if (filters.modifiedAfter) {
    clauses.push("f.mtime > ?");
    params.push(filters.modifiedAfter);
  }

  if (!fts) {
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT f.* FROM files f ${where} ORDER BY f.mtime DESC LIMIT ?`)
      .all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...fileRowFromDb(r), snippet: null, score: 0 }));
  }

  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT f.*, bm25(files_fts) AS score,
              snippet(files_fts, 2, '<mark>', '</mark>', '…', 12) AS snip
       FROM files_fts
       JOIN files f ON f.id = files_fts.rowid
       WHERE files_fts MATCH ? ${where}
       ORDER BY score
       LIMIT ?`,
    )
    .all(fts, ...params, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ...fileRowFromDb(r),
    snippet: (r.snip as string | null) ?? null,
    score: r.score as number,
  }));
}

export function listFacets(db: Db): {
  areas: Array<{ area: string; count: number }>;
  exts: Array<{ ext: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  total: number;
} {
  const areas = db
    .prepare("SELECT area, COUNT(*) count FROM files WHERE area IS NOT NULL GROUP BY area ORDER BY count DESC")
    .all() as Array<{ area: string; count: number }>;
  const exts = db
    .prepare("SELECT ext, COUNT(*) count FROM files WHERE ext != '' GROUP BY ext ORDER BY count DESC LIMIT 30")
    .all() as Array<{ ext: string; count: number }>;
  const tagRows = db.prepare("SELECT tags FROM files WHERE tags != '[]'").all() as Array<{ tags: string }>;
  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    for (const tag of JSON.parse(row.tags) as string[]) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const total = (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
  return { areas, exts, tags, total };
}

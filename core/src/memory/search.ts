import type { Db } from "../db/db.js";
import { fileRowFromDb, type FileRow } from "./indexer.js";
import { extractKeywords } from "./recall.js";

export interface SearchFilters {
  query: string;
  area?: string;
  ext?: string;
  dir?: string;
  tag?: string;
  modifiedAfter?: number;
  limit?: number;
  /** Read-time policy over stored rows (`MemoryIndexer.rowFilter`): rows it refuses are not returned. */
  allow?: (row: { root: string; rel: string }) => boolean;
}

/** Which half of the search found a file: the words (`text`), the vectors (`semantic`), or both. */
export type SearchVia = "text" | "semantic" | "both";

export interface SearchHit extends FileRow {
  snippet: string | null;
  /** `text` hits: the BM25 of FTS5 (lower is better). Fused hits: the reciprocal-rank score (higher is better). */
  score: number;
  via: SearchVia;
}

/** A word for FTS5: quoted, so no query syntax leaks through, as a prefix. A NUL byte is dropped (FTS5 fails on it). */
const ftsWord = (word: string): string => `"${word.replace(/["*\0]/g, "")}"*`;

/** The words as typed, every one required, at most 8: the strict query of `cerebro-v2` (AD-037). */
function strictQuery(input: string): string {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/["*\0]/g, "").trim())
    // a term with no letter or digit holds no token for FTS5: it is not a word to require
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 8);
  return terms.map(ftsWord).join(" ");
}

/** Rows read past the first page of matches before a search gives up filling `limit` with allowed ones. */
const SCAN_CAP = 5000;
/** How many rows of the "any word" query are ranked by how many words they hold. */
const ANY_DEPTH = 500;

/** The `WHERE` clauses the facets of a search add, over `files f`: shared by the words and the vectors. */
export function searchFilters(filters: Omit<SearchFilters, "query">): { clauses: string[]; params: unknown[] } {
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
  return { clauses, params };
}

type Row = Record<string, unknown>;

const hitOf = (r: Row): SearchHit => ({
  ...fileRowFromDb(r),
  snippet: (r.snip as string | null | undefined) ?? null,
  score: (r.score as number | undefined) ?? 0,
  via: "text" as const,
});

/** The rows of one FTS query in BM25 order, today's policy applied before the cut (`allow`), at most `limit`. */
function matches(db: Db, fts: string, filters: SearchFilters, limit: number, skip?: ReadonlySet<number>): SearchHit[] {
  const { clauses, params } = searchFilters(filters);
  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const out: SearchHit[] = [];
  let read = 0;
  for (const row of db
    .prepare(
      `SELECT f.*, bm25(files_fts) AS score,
              snippet(files_fts, 2, '<mark>', '</mark>', '…', 12) AS snip
       FROM files_fts
       JOIN files f ON f.id = files_fts.rowid
       WHERE files_fts MATCH ? ${where}
       ORDER BY score`,
    )
    .iterate(fts, ...params) as IterableIterator<Row>) {
    if (++read > SCAN_CAP || out.length >= limit) break;
    const hit = hitOf(row);
    if (skip?.has(hit.id) || !(filters.allow?.(hit) ?? true)) continue;
    out.push(hit);
  }
  return out;
}

/** No words: the most recent rows, today's policy applied before the cut. */
function recent(db: Db, filters: SearchFilters, limit: number): SearchHit[] {
  const { clauses, params } = searchFilters(filters);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const out: SearchHit[] = [];
  let read = 0;
  for (const row of db
    .prepare(`SELECT f.* FROM files f ${where} ORDER BY f.mtime DESC`)
    .iterate(...params) as IterableIterator<Row>) {
    if (++read > SCAN_CAP || out.length >= limit) break;
    const hit = hitOf(row);
    if (filters.allow?.(hit) ?? true) out.push(hit);
  }
  return out;
}

/**
 * The words as typed, every one required (the search of `cerebro-v2`). Kept as the first half of `searchFiles` and as
 * the baseline the semantic corpus is measured against (AD-037).
 */
export function strictWordsSearch(db: Db, filters: SearchFilters): SearchHit[] {
  const limit = Math.min(filters.limit ?? 50, 200);
  const fts = strictQuery(filters.query);
  return fts ? matches(db, fts, filters, limit) : recent(db, filters, limit);
}

/**
 * The words that matter (`extractKeywords`: no stopwords, folded), every one first, then any of them
 * (.specs/features/cerebro-correcoes, door 3): the files that hold every word come first in BM25 order, then the ones
 * that hold some, more words first and BM25 after. A question that is only stopwords is searched as typed; one with no
 * word at all is the listing of the most recent files. Each file once.
 */
export function searchFiles(db: Db, filters: SearchFilters): SearchHit[] {
  const limit = Math.min(filters.limit ?? 50, 200);
  const keywords = extractKeywords(filters.query);
  if (keywords.length === 0) return strictWordsSearch(db, filters);

  const all = matches(db, keywords.map(ftsWord).join(" "), filters, limit);
  if (all.length >= limit || keywords.length === 1) return all;

  const seen = new Set(all.map((hit) => hit.id));
  const some = matches(db, keywords.map(ftsWord).join(" OR "), filters, ANY_DEPTH, seen);
  if (some.length === 0) return all;
  const ids = some.map((hit) => hit.id);
  const marks = ids.map(() => "?").join(",");
  const count = new Map<number, number>();
  const holds = db.prepare(`SELECT rowid AS id FROM files_fts WHERE files_fts MATCH ? AND rowid IN (${marks})`);
  for (const word of keywords) {
    for (const { id } of holds.all(ftsWord(word), ...ids) as Array<{ id: number }>) count.set(id, (count.get(id) ?? 0) + 1);
  }
  // Array.prototype.sort is stable: rows with the same count keep the BM25 order of the query.
  some.sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
  return [...all, ...some].slice(0, limit);
}

export interface Facets {
  areas: Array<{ area: string; count: number }>;
  exts: Array<{ ext: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  total: number;
}

/**
 * The facets of the index. With `within` (the files of a work context, .specs/features/cerebro-contextos), counted only
 * over the rows it accepts, in the same order and with the same cuts as the counts of the whole index.
 */
export function listFacets(db: Db, within?: (row: { root: string; rel: string }) => boolean): Facets {
  if (within) return facetsWithin(db, within);
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

function facetsWithin(db: Db, within: (row: { root: string; rel: string }) => boolean): Facets {
  const areaCounts = new Map<string, number>();
  const extCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  let total = 0;
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const row of db.prepare("SELECT root, rel, area, ext, tags FROM files").iterate() as IterableIterator<{
    root: string;
    rel: string;
    area: string | null;
    ext: string;
    tags: string;
  }>) {
    if (!within(row)) continue;
    total++;
    if (row.area !== null) bump(areaCounts, row.area);
    if (row.ext !== "") bump(extCounts, row.ext);
    if (row.tags !== "[]") for (const tag of JSON.parse(row.tags) as string[]) bump(tagCounts, tag);
  }
  const ranked = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  return {
    areas: ranked(areaCounts).map(([area, count]) => ({ area, count })),
    exts: ranked(extCounts)
      .slice(0, 30)
      .map(([ext, count]) => ({ ext, count })),
    tags: ranked(tagCounts)
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count })),
    total,
  };
}

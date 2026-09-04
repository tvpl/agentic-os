import type { Db } from "../db/db.js";
import { fileRowFromDb, type FileRow } from "./indexer.js";

/**
 * Dataview-style inline fields: a markdown line of the form `key:: value`
 * (optionally as a list item, `- key:: value`). Keys are lower-cased and
 * slugified so `Due Date:: 2026-09-10` and `due_date:: …` collide on purpose;
 * the first occurrence of a key wins. Parsed at index time and stored as a
 * JSON object on the `files` row, so widgets can query notes by attribute
 * without opening them.
 */

export const MAX_FIELDS_PER_FILE = 50;
const MAX_VALUE_CHARS = 500;
const FIELD_LINE = /^\s*(?:[-*+]\s+)?([\p{L}\d][\p{L}\d _.-]{0,60}?)\s*::\s*(.+?)\s*$/u;

export function normalizeFieldKey(raw: string): string {
  return raw
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseInlineFields(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes("://") && !line.includes(":: ")) continue; // URLs are not fields
    const m = FIELD_LINE.exec(line);
    if (!m) continue;
    const key = normalizeFieldKey(m[1]!);
    if (!key || key in out) continue;
    out[key] = m[2]!.slice(0, MAX_VALUE_CHARS);
    if (++count >= MAX_FIELDS_PER_FILE) break;
  }
  return out;
}

export function fieldsFromDb(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || raw === "" || raw === "{}") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export interface FieldQuery {
  /** `key` alone (any value), `key:value` (exact, case-insensitive) or `key:~value` (substring). */
  where: string;
  limit?: number;
}

export interface FieldHit extends FileRow {
  fields: Record<string, string>;
}

/** Parse a `where` clause into its parts; null when it is not a field query. */
export function parseWhere(where: string): { key: string; value: string | null; contains: boolean } | null {
  const trimmed = where.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  const rawKey = idx === -1 ? trimmed : trimmed.slice(0, idx);
  const key = normalizeFieldKey(rawKey);
  if (!key) return null;
  if (idx === -1) return { key, value: null, contains: false };
  let value = trimmed.slice(idx + 1).trim();
  const contains = value.startsWith("~");
  if (contains) value = value.slice(1).trim();
  return { key, value: value === "" ? null : value, contains };
}

/**
 * Files whose inline fields satisfy `where`. Uses SQLite's JSON functions to
 * narrow on the key, then compares values in JS (case-insensitive) so the
 * semantics are the same on every SQLite build.
 */
export function queryFilesByField(db: Db, q: FieldQuery): FieldHit[] {
  const parsed = parseWhere(q.where);
  if (!parsed) return [];
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE fields != '{}' AND json_extract(fields, ?) IS NOT NULL
       ORDER BY mtime DESC LIMIT 5000`,
    )
    .all(`$."${parsed.key.replace(/"/g, "")}"`) as Array<Record<string, unknown>>;
  const out: FieldHit[] = [];
  const wanted = parsed.value?.toLowerCase() ?? null;
  for (const row of rows) {
    const fields = fieldsFromDb(row.fields);
    const actual = fields[parsed.key];
    if (actual === undefined) continue;
    if (wanted !== null) {
      const lower = actual.toLowerCase();
      if (parsed.contains ? !lower.includes(wanted) : lower !== wanted) continue;
    }
    out.push({ ...fileRowFromDb(row), fields });
    if (out.length >= limit) break;
  }
  return out;
}

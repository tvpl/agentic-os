import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { isInside, realpathLenient } from "../security/paths.js";
import { contextMembership, contextNotesDir } from "./contexts.js";
import { fieldsFromDb, normalizeFieldKey } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import {
  readEscopo,
  readNatureza,
  readReviewEvery,
  suggestNatureza,
  type Escopo,
  type Natureza,
} from "./natureza.js";

/**
 * The review queue (.specs/features/cerebro-natureza, doors 4 to 6): which files fell due, from the index rows and the
 * owner's stored decisions alone. Nothing here opens or writes a file, or writes a row (C62): the decisions that write
 * are `reviewDecisions.ts`.
 *
 * Days are local `AAAA-MM-DD`, the day `sentinelDay` writes. A file's base is the later of its header's
 * `last_reviewed` (a real calendar day) and the stored `review_state.last_reviewed`, and without either its `mtime`;
 * it is due when today ≥ base + its cadence (amendment 6).
 */

export interface ReviewsEnv {
  paths: MordomoPaths;
  settings: Settings;
  /** Whether a decision may write this file as a note (the route passes the notes' own rule); false without it. */
  editable?: (file: string) => boolean;
}

export type ReviewsKind = "due" | "unclassified";

export interface ReviewsQuery {
  kind?: ReviewsKind;
  /** A work context (its `ok` paths and `memory/notes/<id>/`), or null / absent for the whole brain. */
  context?: WorkContext | null;
  natureza?: readonly Natureza[];
  escopo?: readonly Escopo[];
  /** At most this many items (the total counts them all); `memory.reviews.maxPerDay` by default. */
  limit?: number;
  now?: number;
}

export interface ReviewItem {
  path: string;
  name: string;
  natureza: Natureza | null;
  type: string | null;
  escopo: Escopo | null;
  lastReviewed: string | null;
  dueSince: string | null;
  editable: boolean;
  mtime: number;
  suggested?: Natureza | null;
}

export interface ReviewsResult {
  items: ReviewItem[];
  total: number;
  nextDue: string | null;
}

/** One file's stored decisions (door 6), as the routes answer them. */
export interface ReviewStateView {
  lastReviewed: number | null;
  snoozeUntil: number | null;
  never: 0 | 1;
}

export type Cadence = number | "never";
export type ReviewSettings = Settings["memory"]["reviews"];

// ---- days --------------------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const format = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The local day of an instant. */
export function localDay(at: number): string {
  return format(new Date(at));
}

/** A real calendar day as `AAAA-MM-DD`, or null. */
function calendarDay(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? format(date) : null;
}

/** `day` plus `n` local days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return format(new Date(y, m - 1, d + n));
}

// ---- the rules ---------------------------------------------------------------------------------------------------

/**
 * A file's cadence (door 5, amendment 18): its own `review_every`, else the `byType` entry of its `type` (keys compared
 * after `normalizeFieldKey`), else the `cadence` of its nature, else none.
 */
export function reviewCadence(fields: Readonly<Record<string, string>>, reviews: ReviewSettings): Cadence | null {
  const own = readReviewEvery(fields);
  if (own !== null) return own;
  const type = fields.type !== undefined ? normalizeFieldKey(fields.type) : "";
  if (type !== "") {
    for (const [key, value] of Object.entries(reviews.byType)) {
      if (normalizeFieldKey(key) === type) return readReviewEvery({ review_every: value });
    }
  }
  const natureza = readNatureza(fields);
  return natureza !== null ? readReviewEvery({ review_every: reviews.cadence[natureza] }) : null;
}

/** The day a review was last made: the later of the header's `last_reviewed` and the stored one; null for neither. */
export function lastReviewedDay(
  fields: Readonly<Record<string, string>>,
  state: ReviewStateView | null,
): string | null {
  const header = calendarDay(fields.last_reviewed);
  const stored = state?.lastReviewed != null ? localDay(state.lastReviewed) : null;
  if (header === null) return stored;
  if (stored === null) return header;
  return header > stored ? header : stored;
}

/** The day a file falls due under `cadence`, counted from its last review or else its `mtime`; null with no cadence. */
export function dueDay(
  fields: Readonly<Record<string, string>>,
  state: ReviewStateView | null,
  mtime: number,
  cadence: Cadence | null,
): string | null {
  if (cadence === null || cadence === "never") return null;
  return addDays(lastReviewedDay(fields, state) ?? localDay(mtime), cadence);
}

/** One file's stored decisions, or null when it has none. */
export function readReviewState(db: Db, file: string): ReviewStateView | null {
  const row = db
    .prepare("SELECT last_reviewed, snooze_until, never FROM review_state WHERE path = ?")
    .get(file) as { last_reviewed: number | null; snooze_until: number | null; never: number } | undefined;
  return row ? stateOf(row) : null;
}

const stateOf = (row: { last_reviewed: number | null; snooze_until: number | null; never: number }): ReviewStateView => ({
  lastReviewed: row.last_reviewed,
  snoozeUntil: row.snooze_until,
  never: row.never === 1 ? 1 : 0,
});

// ---- the queue ---------------------------------------------------------------------------------------------------

interface Row {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  mtime: number;
  fields: string | null;
}

/** Whether a row is the context's: one of its `ok` paths, or its notes folder (amendment 5). */
function contextFilter(env: ReviewsEnv, context: WorkContext): (row: Row) => boolean {
  const member = contextMembership(env, context);
  const notes = realpathLenient(path.resolve(contextNotesDir(env.paths, context.id)));
  const realRoots = new Map<string, string>();
  return (row) => {
    let real = realRoots.get(row.root);
    if (real === undefined) {
      real = realpathLenient(row.root);
      realRoots.set(row.root, real);
    }
    return isInside(notes, path.join(real, row.rel)) || member(row);
  };
}

/**
 * The queue (AC 17 to AC 23, AC 46, amendment 6). `due`: every Markdown file today's policy shows, outside
 * `memory/archive/` and not `status: archived`, that has a cadence other than `never`, is not marked `never` and is not
 * snoozed, and whose due day is today or before, oldest due day first, then by path. `unclassified`: the Markdown
 * notes under `memory/notes/` with no nature (read through the closed list), not snoozed, oldest `mtime` first, then
 * by path, each with the nature its stored text suggests. `total` counts every match; `nextDue` is the first day
 * after the listed ones that something falls due (`due` only).
 */
export function reviewsDue(db: Db, env: ReviewsEnv, query: ReviewsQuery = {}): ReviewsResult {
  const now = query.now ?? Date.now();
  const today = localDay(now);
  const kind = query.kind ?? "due";
  const reviews = env.settings.memory.reviews;
  const limit = query.limit ?? reviews.maxPerDay;
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const within = query.context ? contextFilter(env, query.context) : null;
  const archive = path.resolve(env.paths.memory, "archive");
  const notes = path.resolve(env.paths.memory, "notes");
  const states = new Map(
    (
      db.prepare("SELECT path, last_reviewed, snooze_until, never FROM review_state").all() as Array<{
        path: string;
        last_reviewed: number | null;
        snooze_until: number | null;
        never: number;
      }>
    ).map((row) => [row.path, stateOf(row)]),
  );
  const rows = db
    .prepare("SELECT id, root, rel, path, name, mtime, fields FROM files WHERE ext IN ('.md', '.markdown')")
    .all() as Row[];

  const matched: Array<ReviewItem & { id: number }> = [];
  let nextDue: string | null = null;
  for (const row of rows) {
    if (isInside(archive, row.path)) continue;
    if (kind === "unclassified" && !isInside(notes, row.path)) continue;
    const fields = fieldsFromDb(row.fields);
    const natureza = readNatureza(fields);
    const escopo = readEscopo(fields);
    if (kind === "unclassified" && natureza !== null) continue;
    if (query.natureza && (natureza === null || !query.natureza.includes(natureza))) continue;
    if (query.escopo && (escopo === null || !query.escopo.includes(escopo))) continue;
    if (fields.status !== undefined && normalizeFieldKey(fields.status) === "archived") continue;
    if (!policy(row) || (within && !within(row))) continue;
    const state = states.get(row.path) ?? null;
    const snoozed = state?.snoozeUntil != null && state.snoozeUntil >= now;
    const cadence = reviewCadence(fields, reviews);
    const due = state?.never === 1 ? null : dueDay(fields, state, row.mtime, cadence);
    if (kind === "due") {
      if (due === null) continue;
      if (snoozed || due > today) {
        const next = snoozed && localDay(state!.snoozeUntil!) > due ? localDay(state!.snoozeUntil!) : due;
        if (nextDue === null || next < nextDue) nextDue = next;
        continue;
      }
    } else if (snoozed) continue;
    matched.push({
      id: row.id,
      path: row.path,
      name: row.name,
      natureza,
      type: fields.type ?? null,
      escopo,
      lastReviewed: lastReviewedDay(fields, state),
      dueSince: due,
      editable: env.editable?.(row.path) ?? false,
      mtime: row.mtime,
    });
  }
  const byPath = (a: ReviewItem, b: ReviewItem) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (kind === "due") matched.sort((a, b) => (a.dueSince! < b.dueSince! ? -1 : a.dueSince! > b.dueSince! ? 1 : byPath(a, b)));
  else matched.sort((a, b) => a.mtime - b.mtime || byPath(a, b));
  const listed = matched.slice(0, limit);
  const text = db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const items = listed.map(({ id, ...item }) => {
    if (kind === "due") return item;
    const stored = text.get(id) as { content: string } | undefined;
    return { ...item, suggested: suggestNatureza(stored?.content ?? "") };
  });
  return { items, total: matched.length, nextDue: kind === "due" ? nextDue : null };
}

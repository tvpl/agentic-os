import crypto from "node:crypto";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { normalizeFieldKey } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { foldName } from "./linkParser.js";
import {
  NoteMissingError,
  NoteNotEditableError,
  appendTask,
  classifyNotePath,
  createNote,
  readNote,
  type NoteContext,
} from "./notes.js";
import { generatedFileKind } from "./recall.js";
import { addDays, localDay } from "./reviews.js";

/**
 * The open loops of the weekly review (.specs/features/cerebro-rituais, S1, doors 1 and 2): every bullet of the level-2
 * `## Open loops` of the journal days in the window and of `MEMORY.md`, one loop per normalized text, and the owner's
 * decision on each, stored in `loop_decisions` by that key. Nothing here writes a file but `project` (a note made by
 * `createNote`) and `task` (a line added by `appendTask`).
 */

export const LOOP_ACTIONS = ["close", "keep", "someday", "project", "task", "restore"] as const;
export type LoopAction = (typeof LOOP_ACTIONS)[number];
export const LOOP_STATES = ["closed", "keep", "someday", "project", "task"] as const;
export type LoopState = (typeof LOOP_STATES)[number];
/** The states that take a loop out of every list for good (until a restore): `keep` holds for its week only. */
const DECIDED: ReadonlySet<LoopState> = new Set(["closed", "someday", "project", "task"]);
/** AC 8: a project's title is the loop's text cut at this many characters. */
export const PROJECT_NAME_MAX = 120;
/** Door 3: what a task line takes of a loop's text (G6). */
const TASK_CHARS = 300;

export interface LoopSource {
  path: string;
  line: number;
}

export interface LoopItem {
  key: string;
  text: string;
  day: string;
  ageDays: number;
  sources: LoopSource[];
}

/** One stored decision, as the route answers it in `previous` and `restore` takes it back. */
export interface LoopDecisionView {
  action: LoopState;
  week: string;
  target: string | null;
  decidedAt: number;
}

interface DecisionRow {
  key: string;
  text: string;
  action: LoopState;
  week: string;
  target: string | null;
  decided_at: number;
}

// ---- the week and the key ----------------------------------------------------------------------------------------

/** The Monday (`AAAA-MM-DD`, local) of the week of `now`: the week of the dashboards (`weekDays`). */
export function weekOf(now: number): string {
  const d = new Date(now);
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime());
}

/** Whole local days from `day` to `today` (both `AAAA-MM-DD`). */
export function daysBetween(day: string, today: string): number {
  const at = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((at(today) - at(day)) / 86_400_000);
}

/** Door 1's normalization: trimmed, whitespace collapsed, `foldName`, accents dropped (G1). */
export function normalizeLoopText(text: string): string {
  return foldName(text.trim().replace(/\s+/g, " "))
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");
}

/** A loop's key: the SHA-256 hex of its normalized text. */
export function loopKey(text: string): string {
  return crypto.createHash("sha256").update(normalizeLoopText(text)).digest("hex");
}

// ---- reading the sections ----------------------------------------------------------------------------------------

/**
 * The bullets of the level-2 section `heading` of a text: a `### heading`, or a bullet after any other heading, never
 * counts. Each with its 1-based line and its body, trimmed.
 */
export function sectionBullets(text: string, heading: string): Array<{ body: string; line: number }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ body: string; line: number }> = [];
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      inside = h[1]!.length === 2 && h[2] === heading;
      continue;
    }
    if (!inside) continue;
    const bullet = /^(?:>[ \t]*)?[-*][ \t]+(.+)$/.exec(line);
    if (bullet) out.push({ body: bullet[1]!.trim(), line: i + 1 });
  }
  return out;
}

const CLOSED = /→\s*closed\s+\d{4}-\d{2}-\d{2}\s*$/;
/** The provenance marks of a line an agent wrote (`fonte::`, `autor::`, `em::`), at its end (G2). */
const MARKS = /(?:\s*\((?:fonte|autor|em)::[^)]*\))+\s*$/;
const ORIGIN = /\s*\(journal (\d{4}-\d{2}-\d{2})\)\s*$/;

/** A loop line's text without the `HH:MM ` of the journal and the provenance marks. */
export function loopText(body: string, kind: "journal" | "memory"): string {
  let text = body.replace(MARKS, "").trim();
  if (kind === "journal") text = text.replace(/^\d{2}:\d{2}\s+/, "");
  return text.trim();
}

// ---- the collector -----------------------------------------------------------------------------------------------

export interface LoopsEnv {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
}

interface Occurrence {
  text: string;
  day: string;
  path: string;
  line: number;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every open loop the index holds today (AC 1 to AC 4), grouped by key, each with the oldest day, the text as written
 * there and every place, oldest first: the journal days from today back to `loopsWindowDays - 1` days before (a day
 * after today is not read), and every line of `MEMORY.md` but a closed one (`→ closed AAAA-MM-DD`), whose day is its
 * `(journal AAAA-MM-DD)` or else the local day of the file's `mtime`. Undecided or not, sorted oldest day first.
 */
export function collectLoops(env: LoopsEnv, now: number): LoopItem[] {
  const today = localDay(now);
  const first = addDays(today, -(env.settings.memory.weeklyReview.loopsWindowDays - 1));
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const rows = env.db
    .prepare("SELECT id, root, rel, path, name, mtime FROM files WHERE ext IN ('.md', '.markdown')")
    .all() as Array<{ id: number; root: string; rel: string; path: string; name: string; mtime: number }>;
  const textOf = env.db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const found: Occurrence[] = [];
  for (const row of rows) {
    const kind = generatedFileKind(env.paths, row.path);
    if (kind === null || !policy(row)) continue;
    const fileDay = kind === "journal" ? row.name.slice(0, 10) : localDay(row.mtime);
    if (kind === "journal" && (fileDay < first || fileDay > today)) continue;
    const text = (textOf.get(row.id) as { content: string } | undefined)?.content ?? "";
    for (const { body, line } of sectionBullets(text, "Open loops")) {
      let day = fileDay;
      let rest = body;
      if (kind === "memory") {
        if (CLOSED.test(rest)) continue;
        rest = rest.replace(MARKS, "");
        const origin = ORIGIN.exec(rest);
        if (origin) {
          day = origin[1]!;
          rest = rest.slice(0, origin.index);
        }
      }
      const clean = loopText(rest, kind);
      if (clean === "") continue;
      found.push({ text: clean, day, path: row.path, line });
    }
  }
  found.sort((a, b) => byText(a.day, b.day) || byText(a.path, b.path) || a.line - b.line);
  const loops = new Map<string, LoopItem>();
  for (const o of found) {
    const key = loopKey(o.text);
    const item = loops.get(key);
    if (item) item.sources.push({ path: o.path, line: o.line });
    else
      loops.set(key, {
        key,
        text: o.text,
        day: o.day,
        ageDays: daysBetween(o.day, today),
        sources: [{ path: o.path, line: o.line }],
      });
  }
  return [...loops.values()].sort((a, b) => byText(a.day, b.day) || byText(a.text, b.text) || byText(a.key, b.key));
}

function decisionRows(db: Db): Map<string, DecisionRow> {
  const rows = db.prepare("SELECT key, text, action, week, target, decided_at FROM loop_decisions").all() as DecisionRow[];
  return new Map(rows.map((r) => [r.key, r]));
}

/** Whether a stored decision takes a loop out of `loops` in the week `week`. */
export function hidesLoop(state: { action: LoopState; week: string } | undefined, week: string): boolean {
  if (state === undefined) return false;
  return DECIDED.has(state.action) || (state.action === "keep" && state.week === week);
}

/** The keys the dashboards' `openLoops` widget no longer counts (AC 5): decided `closed`, `project`, `task`, `someday`. */
export function decidedLoopKeys(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT key FROM loop_decisions WHERE action IN ('closed', 'someday', 'project', 'task')")
    .all() as Array<{ key: string }>;
  return new Set(rows.map((r) => r.key));
}

export interface LoopLists {
  /** Undecided (or kept in an earlier week), oldest first, uncut. */
  open: LoopItem[];
  /** Decided `someday`, uncut (G27). */
  someday: LoopItem[];
}

/** `loops` and `someday.loops` (AC 1, AC 6, AC 7, AC 28, G3). */
export function loopLists(env: LoopsEnv, now: number): LoopLists {
  const today = localDay(now);
  const week = weekOf(now);
  const stored = decisionRows(env.db);
  const collected = collectLoops(env, now);
  const open = collected.filter((l) => !hidesLoop(stored.get(l.key), week));
  const byKey = new Map(collected.map((l) => [l.key, l]));
  const someday = [...stored.values()]
    .filter((r) => r.action === "someday")
    .map(
      (r): LoopItem =>
        byKey.get(r.key) ?? { key: r.key, text: r.text, day: r.week, ageDays: daysBetween(r.week, today), sources: [] },
    )
    .sort((a, b) => byText(a.day, b.day) || byText(a.text, b.text) || byText(a.key, b.key));
  return { open, someday };
}

// ---- the decisions -----------------------------------------------------------------------------------------------

export interface LoopDecisionInput {
  key: string;
  action: LoopAction;
  name?: string | undefined;
  project?: string | undefined;
  baseVersion?: string | undefined;
  previous?: LoopDecisionView | null | undefined;
  /** The active context: a project made from the loop goes to its notes folder (G4). */
  context?: WorkContext | null | undefined;
}

export interface LoopDecisionResult {
  key: string;
  state: LoopState | null;
  previous: LoopDecisionView | null;
  created?: { path: string; version: string };
}

export interface LoopDecisionDeps extends LoopsEnv {
  /** Told the bytes a decision wrote to a note, with what made it, so the history records a version. */
  history?: NoteContext["history"];
}

/** `400 validation`: a decision this route does not take. Nothing is stored. */
export class LoopValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "LoopValidationError";
  }
}

/** `404 loop_not_found`: the key is in neither list and has no stored decision (G7). Nothing is stored. */
export class LoopNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "loop_not_found";
  constructor() {
    super("No open loop, someday loop or stored decision has this key.");
    this.name = "LoopNotFoundError";
  }
}

const viewOf = (row: DecisionRow | undefined): LoopDecisionView | null =>
  row ? { action: row.action, week: row.week, target: row.target, decidedAt: row.decided_at } : null;

function validate(input: LoopDecisionInput): void {
  if (!(LOOP_ACTIONS as readonly string[]).includes(input.action)) {
    throw new LoopValidationError(`action: one of ${LOOP_ACTIONS.join(", ")}`);
  }
  if (input.name !== undefined && ([...input.name].length < 1 || [...input.name].length > PROJECT_NAME_MAX)) {
    throw new LoopValidationError(`name: 1 to ${PROJECT_NAME_MAX} characters`);
  }
  if (input.action === "task" && (input.project === undefined || input.baseVersion === undefined)) {
    throw new LoopValidationError("task: project and baseVersion");
  }
  if (input.action === "restore") {
    const p = input.previous;
    if (p === undefined) throw new LoopValidationError("previous: the previous a decision answered, or null");
    if (
      p !== null &&
      (!(LOOP_STATES as readonly string[]).includes(p.action) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.week) ||
        !Number.isSafeInteger(p.decidedAt))
    ) {
      throw new LoopValidationError(`previous: { action: one of ${LOOP_STATES.join(", ")}, week, target, decidedAt }`);
    }
  }
}

function store(db: Db, key: string, text: string, state: LoopDecisionView): void {
  db.prepare(
    `INSERT INTO loop_decisions (key, text, action, week, target, decided_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET text = excluded.text, action = excluded.action, week = excluded.week,
       target = excluded.target, decided_at = excluded.decided_at`,
  ).run(key, text, state.action, state.week, state.target, state.decidedAt);
}

const firstChars = (text: string, n: number) => [...text].slice(0, n).join("");

/**
 * Decide one loop (door 2). Checked in this order, storing nothing on a refusal: the body (`400 validation`), the key
 * (`404 loop_not_found` when it is in neither list and has no row, G7), then for `task` the project (`403
 * note_not_editable` unless an editable `type: project` note of `memory/`) and its version (`409 edit_conflict`).
 * The same `close`, `keep` or `someday` again leaves the row as it was (G8); `keep` of an earlier week is stored again
 * for this one. `project` on a key already `project` answers the note it made. Synchronous from the read of the row to
 * its write, so two posts at once cannot both create.
 */
export function decideLoop(deps: LoopDecisionDeps, input: LoopDecisionInput, now: number = Date.now()): LoopDecisionResult {
  validate(input);
  const stored = decisionRows(deps.db).get(input.key);
  const lists = loopLists(deps, now);
  const listed = lists.open.find((l) => l.key === input.key) ?? lists.someday.find((l) => l.key === input.key);
  if (!listed && !stored) throw new LoopNotFoundError();
  const text = listed?.text ?? stored!.text;
  const previous = viewOf(stored);
  const week = weekOf(now);
  const notes: NoteContext = { paths: deps.paths, settings: deps.settings, history: deps.history };

  if (input.action === "restore") {
    if (input.previous === null) deps.db.prepare("DELETE FROM loop_decisions WHERE key = ?").run(input.key);
    else store(deps.db, input.key, stored?.text ?? text, input.previous!);
    return { key: input.key, state: input.previous?.action ?? null, previous };
  }

  if (input.action === "project") {
    if (stored?.action === "project" && stored.target !== null) {
      try {
        const note = readNote(notes, stored.target);
        return { key: input.key, state: "project", previous, created: { path: note.path, version: note.version } };
      } catch (err) {
        // The note made before is gone: make it again.
        if (!(err instanceof NoteMissingError) && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    const made = createNote(notes, {
      title: input.name ?? firstChars(text, PROJECT_NAME_MAX),
      frontMatter: true,
      properties: { type: "project", status: "active", natureza: "plano", last_reviewed: localDay(now) },
      ...(input.context ? { folder: input.context.id } : {}),
    }, new Date(now));
    store(deps.db, input.key, text, { action: "project", week, target: made.path, decidedAt: now });
    return { key: input.key, state: "project", previous, created: { path: made.path, version: made.version } };
  }

  if (input.action === "task") {
    const target = projectNote(notes, input.project!);
    const written = appendTask(notes, {
      path: target,
      text: firstChars(text, TASK_CHARS),
      baseVersion: input.baseVersion!,
    });
    store(deps.db, input.key, text, { action: "task", week, target: written.path, decidedAt: now });
    return { key: input.key, state: "task", previous, created: { path: written.path, version: written.version } };
  }

  const action: LoopState = input.action === "close" ? "closed" : input.action;
  const same = stored?.action === action && (action !== "keep" || stored.week === week);
  if (!same) store(deps.db, input.key, text, { action, week, target: null, decidedAt: now });
  return { key: input.key, state: action, previous };
}

/** The note of a `task` (AC 14): an editable note of `memory/` whose front matter says `type: project`. */
function projectNote(notes: NoteContext, candidate: string): string {
  const classified = classifyNotePath(notes, path.resolve(notes.paths.memory, candidate));
  if (!classified.editable) throw new NoteNotEditableError(classified.reason ?? "This file cannot be edited.");
  let note: ReturnType<typeof readNote>;
  try {
    note = readNote(notes, classified.logical);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new NoteNotEditableError("The project note does not exist.");
    throw err;
  }
  const type = note.properties.find((p) => p.key === "type")?.value;
  if (typeof type !== "string" || normalizeFieldKey(type) !== "project") {
    throw new NoteNotEditableError("A task from a loop goes to a note with type: project.");
  }
  return classified.logical;
}

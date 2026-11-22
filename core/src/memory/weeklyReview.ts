import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { projectHealth, type ProjectHealth } from "../dashboards/sources.js";
import { isInside } from "../security/paths.js";
import { fieldsFromDb, normalizeFieldKey } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { daysBetween, loopLists, weekOf, type LoopItem } from "./loops.js";
import { moveToArchive, type CleanupApplyResult, type CleanupMoveDeps } from "./cleanupApply.js";
import { appendJournal, journalPath } from "./journal.js";
import { readReviewEvery } from "./natureza.js";
import { classifyNotePath, readNote } from "./notes.js";
import {
  addDays,
  contextFilter,
  lastReviewedDay,
  localDay,
  readReviewState,
  reviewsDue,
  type ReviewStateView,
} from "./reviews.js";
import { calendarDay } from "./tasks.js";

/**
 * The list of the weekly review (.specs/features/cerebro-rituais, door 2): the open loops (`loops.ts`), the projects with
 * their next action and review day, what is set aside for someday, what ended and what waits in `memory/inbox/`. From the
 * index rows, `note_tasks`, `review_state` and `loop_decisions`; a file is opened only to give an editable project the
 * version the screen sends back (G20).
 */

export interface WeeklyReviewEnv {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
}

export interface ProjectItem {
  path: string;
  title: string;
  status: string | null;
  due: string | null;
  health: ProjectHealth;
  nextAction: { line: number; text: string } | null;
  lastReviewed: string | null;
  reviewBy: string | null;
  reviewDue: boolean;
  editable: boolean;
  version: string | null;
}

export interface ArchiveItem {
  path: string;
  title: string;
  editable: boolean;
  doneSince: string;
}

export interface InboxItem {
  path: string;
  title: string;
  ageDays: number;
}

export interface WeeklyReview {
  week: string;
  finishedAt: number | null;
  /** The week so far, or as stored when it was finished (G22). */
  counts: WeekCounts;
  /** The epoch ms of the next weekly reminder, or null when it is off (G23). */
  nextReminder: number | null;
  loops: { items: LoopItem[]; total: number };
  projects: { items: ProjectItem[]; total: number };
  someday: { loops: LoopItem[]; projects: ProjectItem[] };
  archive: { items: ArchiveItem[]; total: number };
  inbox: { items: InboxItem[]; total: number };
  reviewsDue: number;
}

interface Row {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  ext: string;
  mtime: number;
  title: string | null;
  fields: string | null;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const titleOf = (row: Row): string => row.title ?? row.name.replace(/\.(md|markdown)$/i, "");
const fieldOf = (fields: Record<string, string>, key: string): string | null =>
  fields[key] !== undefined ? normalizeFieldKey(fields[key]!) : null;

/** A project's review day (AC 18 to AC 20): its last review day (else its `mtime`'s) plus its cadence; null for never. */
export function projectReviewBy(
  fields: Readonly<Record<string, string>>,
  state: ReviewStateView | null,
  mtime: number,
  projectEvery: string,
): string | null {
  if (state?.never === 1) return null;
  const cadence = readReviewEvery(fields) ?? readReviewEvery({ review_every: projectEvery });
  if (cadence === null || cadence === "never") return null;
  return addDays(lastReviewedDay(fields, state) ?? localDay(mtime), cadence);
}

/** The order of `projects` (AC 21, G12): review due first, then `due` (none last), then title, then path. */
export function compareProjects(a: ProjectItem, b: ProjectItem): number {
  return (
    Number(b.reviewDue) - Number(a.reviewDue) ||
    byText(a.due ?? "￿", b.due ?? "￿") ||
    byText(a.title, b.title) ||
    byText(a.path, b.path)
  );
}

/** The next action of a note (door 3): its first unchecked task in `note_tasks`, by line; null with none. */
export function nextAction(db: Db, fileId: number): { line: number; text: string } | null {
  const row = db
    .prepare("SELECT line, text FROM note_tasks WHERE src_id = ? AND done = 0 ORDER BY line LIMIT 1")
    .get(fileId) as { line: number; text: string } | undefined;
  return row ? { line: row.line, text: row.text } : null;
}

/** Which list a `type: project` note belongs to by its `status` (AC 16, AC 28, AC 31); null for none. */
export function projectList(status: string | null): "projects" | "someday" | "archive" | null {
  if (status === null || status === "active" || status === "draft") return "projects";
  if (status === "paused") return "someday";
  if (status === "done") return "archive";
  return null;
}

/** The four lists of projects and files, uncut and in order, of the whole brain or of one context. */
interface Lists {
  projects: ProjectItem[];
  someday: ProjectItem[];
  archive: ArchiveItem[];
  inbox: InboxItem[];
}

/**
 * `projects`, `someday.projects`, `archive` and `inbox` (AC 16 to AC 21, AC 27, AC 28, AC 31, AC 32), uncut, from the
 * index rows: no file is opened, so a project's `version` is null here (the list fills it for what it answers).
 */
function reviewLists(env: WeeklyReviewEnv, now: number, context: WorkContext | null): Lists {
  const today = localDay(now);
  const { projectEvery } = env.settings.memory.weeklyReview;
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const within = context ? contextFilter(env, context) : null;
  const archiveDir = path.resolve(env.paths.memory, "archive");
  const inboxDir = path.resolve(env.paths.memory, "inbox");
  const rows = (
    env.db.prepare("SELECT id, root, rel, path, name, ext, mtime, title, fields FROM files").all() as Row[]
  ).filter((row) => policy(row));
  const editable = (file: string): boolean => {
    try {
      return classifyNotePath(env, file).editable;
    } catch {
      return false;
    }
  };

  const projects: ProjectItem[] = [];
  const someday: ProjectItem[] = [];
  const archive: ArchiveItem[] = [];
  const inbox: Array<InboxItem & { mtime: number }> = [];
  for (const row of rows) {
    if (isInside(inboxDir, row.path)) {
      inbox.push({ path: row.path, title: titleOf(row), ageDays: daysBetween(localDay(row.mtime), today), mtime: row.mtime });
    }
    if (row.ext !== ".md" && row.ext !== ".markdown") continue;
    if (isInside(archiveDir, row.path)) continue;
    const fields = fieldsFromDb(row.fields);
    if (fieldOf(fields, "type") !== "project") continue;
    const status = fieldOf(fields, "status");
    const list = projectList(status);
    if (list === null || (within && !within(row))) continue;
    const canEdit = editable(row.path);
    if (list === "archive") {
      archive.push({ path: row.path, title: titleOf(row), editable: canEdit, doneSince: localDay(row.mtime) });
      continue;
    }
    const state = readReviewState(env.db, row.path);
    const due = calendarDay(fields.due);
    const reviewBy = projectReviewBy(fields, state, row.mtime, projectEvery);
    const item: ProjectItem = {
      path: row.path,
      title: titleOf(row),
      status,
      due,
      health: projectHealth(status, due, today),
      nextAction: nextAction(env.db, row.id),
      lastReviewed: lastReviewedDay(fields, state),
      reviewBy,
      reviewDue: reviewBy !== null && reviewBy <= today,
      editable: canEdit,
      version: null,
    };
    (list === "projects" ? projects : someday).push(item);
  }
  projects.sort(compareProjects);
  someday.sort(compareProjects);
  archive.sort((a, b) => byText(a.doneSince, b.doneSince) || byText(a.path, b.path));
  inbox.sort((a, b) => a.mtime - b.mtime || byText(a.path, b.path));
  return { projects, someday, archive, inbox: inbox.map(({ mtime: _mtime, ...item }) => item) };
}

/**
 * The weekly review's list (AC 1, AC 16 to AC 21, AC 27, AC 28, AC 31, AC 32). `context` narrows `projects`,
 * `someday.projects` and `archive` to its files; `loops` and `inbox` are the whole brain's. `loops`, `projects`,
 * `archive` and `inbox` are cut at `memory.weeklyReview.maxItems` with `total` counting all (G27). The header gives the
 * week's `counts` (so far, or as stored once finished, G22) and the next reminder (G23).
 */
export function weeklyReview(
  env: WeeklyReviewEnv,
  query: { context?: WorkContext | null; now?: number } = {},
): WeeklyReview {
  const now = query.now ?? Date.now();
  const week = weekOf(now);
  const { maxItems } = env.settings.memory.weeklyReview;
  const versionOfNote = (item: ProjectItem): ProjectItem => {
    if (!item.editable) return item;
    try {
      const note = readNote(env, item.path);
      return { ...item, version: note.editable ? note.version : null };
    } catch {
      return item;
    }
  };
  const lists = reviewLists(env, now, query.context ?? null);
  const loops = loopLists(env, now);
  const stored = storedWeek(env.db, week);
  return {
    week,
    finishedAt: stored.finishedAt,
    counts: stored.counts ?? weekCounts(env, week),
    nextReminder: nextReminder(env.settings.sentinels.weeklyReview, stored.finishedAt !== null, now),
    loops: { items: loops.open.slice(0, maxItems), total: loops.open.length },
    projects: { items: lists.projects.slice(0, maxItems).map(versionOfNote), total: lists.projects.length },
    someday: { loops: loops.someday, projects: lists.someday.map(versionOfNote) },
    archive: { items: lists.archive.slice(0, maxItems), total: lists.archive.length },
    inbox: { items: lists.inbox.slice(0, maxItems), total: lists.inbox.length },
    reviewsDue: reviewsDue(env.db, env, { kind: "due", context: query.context ?? null, now }).total,
  };
}

// ---- the week's record (S4, S6) ----------------------------------------------------------------------------------

export interface WeekCounts {
  /** The loop decisions stored this week. */
  loops: number;
  /** The projects whose last review day falls in this week. */
  projects: number;
  /** The files the week's archive calls moved (an undo does not take them back). */
  archived: number;
}

/** `409 week_mismatch`: the `week` named is not the Monday of the current local week. Nothing is written. */
export class WeekMismatchError extends Error {
  readonly statusCode = 409;
  readonly code = "week_mismatch";
  constructor(week: string, current: string) {
    super(`The current week is ${current}, not ${week}.`);
    this.name = "WeekMismatchError";
  }
}

/** `400 validation`: a path the archive does not take. Nothing moves. */
export class WeeklyArchiveValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "WeeklyArchiveValidationError";
  }
}

function assertWeek(week: string, now: number): void {
  const current = weekOf(now);
  if (week !== current) throw new WeekMismatchError(week, current);
}

/** The row of `weekly_reviews` for a week: when it was finished and the counts stored then, or nulls. */
function storedWeek(db: Db, week: string): { finishedAt: number | null; counts: WeekCounts | null; archived: number } {
  const row = db.prepare("SELECT archived, finished_at, counts FROM weekly_reviews WHERE week = ?").get(week) as
    | { archived: number; finished_at: number | null; counts: string | null }
    | undefined;
  return {
    finishedAt: row?.finished_at ?? null,
    counts: row?.finished_at != null && row.counts !== null ? (JSON.parse(row.counts) as WeekCounts) : null,
    archived: row?.archived ?? 0,
  };
}

/**
 * The week's counts so far (AC 51, G28): the loop decisions stored with this `week`, every `type: project` note
 * outside `memory/archive/` whose last review day (else the local day of its `mtime`) falls in the week, and the files
 * archived this week.
 */
export function weekCounts(env: WeeklyReviewEnv, week: string): WeekCounts {
  const loops = (env.db.prepare("SELECT COUNT(*) AS n FROM loop_decisions WHERE week = ?").get(week) as { n: number }).n;
  const last = addDays(week, 6);
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const archiveDir = path.resolve(env.paths.memory, "archive");
  let projects = 0;
  const rows = env.db
    .prepare("SELECT root, rel, path, mtime, fields FROM files WHERE ext IN ('.md', '.markdown')")
    .all() as Array<Pick<Row, "root" | "rel" | "path" | "mtime" | "fields">>;
  for (const row of rows) {
    if (!policy(row) || isInside(archiveDir, row.path)) continue;
    const fields = fieldsFromDb(row.fields);
    if (fieldOf(fields, "type") !== "project") continue;
    const day = lastReviewedDay(fields, readReviewState(env.db, row.path)) ?? localDay(row.mtime);
    if (day >= week && day <= last) projects += 1;
  }
  return { loops, projects, archived: storedWeek(env.db, week).archived };
}

/** The local instant of (`weekday`, `hour`) in the week that starts on `monday` (`AAAA-MM-DD`). */
export function reminderIn(monday: string, weekday: number, hour: number): number {
  const [y, m, d] = monday.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + ((weekday + 6) % 7), hour).getTime();
}

/**
 * The next weekly reminder (G23): the first (`weekday`, `hour`) local instant strictly after `now`, skipping this
 * week's when its review is finished; null when the reminder is off.
 */
export function nextReminder(
  cfg: { enabled: boolean; weekday: number; hour: number },
  finished: boolean,
  now: number,
): number | null {
  if (!cfg.enabled) return null;
  const monday = weekOf(now);
  const here = reminderIn(monday, cfg.weekday, cfg.hour);
  if (!finished && here > now) return here;
  return reminderIn(addDays(monday, 7), cfg.weekday, cfg.hour);
}

/**
 * What the weekly reminder counts (AC 55, G32): every open loop (`loops.total`) and every project of `projects` with
 * its review due, of the whole brain, uncut.
 */
export function reminderCounts(env: WeeklyReviewEnv, now: number): { loops: number; projects: number } {
  const loops = loopLists(env, now).open.length;
  const projects = reviewLists(env, now, null).projects.filter((p) => p.reviewDue).length;
  return { loops, projects };
}

/**
 * The week's archive (AC 33 to AC 37, door 5): every path must be listed in `archive` or `inbox` of the list with no
 * context (G31), or nothing moves (`400 validation`); `week` must be the current one (`409 week_mismatch`). Then the
 * cleanup's mover moves each file as it is now (G9) under `memory/archive/` with a manifest of scope `weekly:<week>`,
 * lists what lies outside `memory/` as proposals, and the week's `archived` grows by what moved. Synchronous from the
 * check to the count, so two calls naming one file move it once.
 */
export function archiveWeek(
  deps: CleanupMoveDeps,
  input: { week: string; paths: readonly string[] },
  now: number = Date.now(),
): CleanupApplyResult {
  assertWeek(input.week, now);
  const lists = reviewLists(deps, now, null);
  const listed = new Map<string, string>([
    ...lists.archive.map((i): [string, string] => [i.path, "projeto concluído"]),
    ...lists.inbox.map((i): [string, string] => [i.path, "caixa de entrada"]),
  ]);
  const named = [...new Set(input.paths.map((p) => path.resolve(p)))];
  const unlisted = named.filter((p) => !listed.has(p));
  if (unlisted.length > 0) {
    throw new WeeklyArchiveValidationError(
      `Not in archive or inbox of this week's list: ${unlisted.slice(0, 5).join(", ")}${unlisted.length > 5 ? ", …" : ""}`,
    );
  }
  const scope = `weekly:${input.week}`;
  const result = moveToArchive(
    deps,
    named.map((p) => ({ path: p, proposal: `arquivar — ${listed.get(p)!}` })),
    { now, scope, heading: `Revisão semanal: propostas de ${localDay(now)}` },
  );
  if (result.moved.length > 0) {
    deps.db
      .prepare(
        `INSERT INTO weekly_reviews (week, archived) VALUES (?, ?)
         ON CONFLICT(week) DO UPDATE SET archived = archived + excluded.archived`,
      )
      .run(input.week, result.moved.length);
  }
  return result;
}

export interface FinishResult {
  week: string;
  finishedAt: number;
  counts: WeekCounts;
  journal: { path: string; line: string };
}

const two = (n: number) => String(n).padStart(2, "0");

/** The journal bullet of a finished week (AC 51, G10), stamped with the local hour of `at`. */
function finishLine(week: string, counts: WeekCounts, at: number): string {
  const d = new Date(at);
  return (
    `- ${two(d.getHours())}:${two(d.getMinutes())} Revisão semanal de ${week}: ${counts.loops} laços decididos, ` +
    `${counts.projects} projetos revisados, ${counts.archived} arquivados.`
  );
}

/**
 * Finish the week (AC 51 to AC 53): `409 week_mismatch` unless `week` is the current one; else, the first time, its
 * counts are stored with `finished_at` and a bullet goes under `## Today` of today's journal (made when missing). A week
 * already finished answers what was stored then and writes nothing (G29): the row is the record, not the journal line
 * (L-060). Synchronous, so two calls at once finish once.
 */
export function finishWeek(env: WeeklyReviewEnv, input: { week: string }, now: number = Date.now()): FinishResult {
  assertWeek(input.week, now);
  const stored = storedWeek(env.db, input.week);
  if (stored.finishedAt !== null && stored.counts !== null) {
    const line = finishLine(input.week, stored.counts, stored.finishedAt);
    return {
      week: input.week,
      finishedAt: stored.finishedAt,
      counts: stored.counts,
      journal: { path: journalPath(env.paths, localDay(stored.finishedAt)), line },
    };
  }
  const counts = weekCounts(env, input.week);
  const line = finishLine(input.week, counts, now);
  const day = appendJournal(env.paths, { date: localDay(now), section: "Today", text: line.slice(2), timestamp: false });
  env.db
    .prepare(
      `INSERT INTO weekly_reviews (week, finished_at, counts) VALUES (?, ?, ?)
       ON CONFLICT(week) DO UPDATE SET finished_at = excluded.finished_at, counts = excluded.counts`,
    )
    .run(input.week, now, JSON.stringify(counts));
  return { week: input.week, finishedAt: now, counts, journal: { path: day.path, line } };
}

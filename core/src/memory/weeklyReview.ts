import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { projectHealth, type ProjectHealth } from "../dashboards/sources.js";
import { isInside } from "../security/paths.js";
import { fieldsFromDb, normalizeFieldKey } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { daysBetween, loopLists, weekOf, type LoopItem } from "./loops.js";
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

/**
 * The weekly review's list (AC 1, AC 16 to AC 21, AC 27, AC 28, AC 31, AC 32). `context` narrows `projects`,
 * `someday.projects` and `archive` to its files; `loops` and `inbox` are the whole brain's. `loops`, `projects`,
 * `archive` and `inbox` are cut at `memory.weeklyReview.maxItems` with `total` counting all (G27).
 */
export function weeklyReview(
  env: WeeklyReviewEnv,
  query: { context?: WorkContext | null; now?: number } = {},
): WeeklyReview {
  const now = query.now ?? Date.now();
  const today = localDay(now);
  const week = weekOf(now);
  const { maxItems, projectEvery } = env.settings.memory.weeklyReview;
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const within = query.context ? contextFilter(env, query.context) : null;
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
  const versionOfNote = (file: string): string | null => {
    try {
      const note = readNote(env, file);
      return note.editable ? note.version : null;
    } catch {
      return null;
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
      version: canEdit ? versionOfNote(row.path) : null,
    };
    (list === "projects" ? projects : someday).push(item);
  }
  projects.sort(compareProjects);
  someday.sort(compareProjects);
  archive.sort((a, b) => byText(a.doneSince, b.doneSince) || byText(a.path, b.path));
  inbox.sort((a, b) => a.mtime - b.mtime || byText(a.path, b.path));

  const loops = loopLists(env, now);
  const finished = env.db.prepare("SELECT finished_at FROM weekly_reviews WHERE week = ?").get(week) as
    | { finished_at: number | null }
    | undefined;
  return {
    week,
    finishedAt: finished?.finished_at ?? null,
    loops: { items: loops.open.slice(0, maxItems), total: loops.open.length },
    projects: { items: projects.slice(0, maxItems), total: projects.length },
    someday: { loops: loops.someday, projects: someday },
    archive: { items: archive.slice(0, maxItems), total: archive.length },
    inbox: { items: inbox.slice(0, maxItems).map(({ mtime: _mtime, ...item }) => item), total: inbox.length },
    reviewsDue: reviewsDue(env.db, env, { kind: "due", context: query.context ?? null, now }).total,
  };
}

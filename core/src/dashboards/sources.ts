import path from "node:path";
import type { DashboardSource, SourceKind } from "@mordomo/contracts";
import type { Settings, WorkContext } from "../config/schema.js";
import type { ConnectorRegistry } from "../connectors/registry.js";
import { fetchConnectorData, setupChecklist, type ConnectorDataCache } from "../connectors/client.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import { dailyPoints, type MetricsHistory } from "../metrics/history.js";
import type { CleanupScope } from "../memory/cleanup.js";
import { queryFacts } from "../memory/facts.js";
import { fieldsFromDb, normalizeFieldKey } from "../memory/fields.js";
import { storedRowFilter } from "../memory/indexer.js";
import { parsePassages, readEscopo, readNatureza, type Natureza } from "../memory/natureza.js";
import { generatedFileKind } from "../memory/recall.js";
import { addDays, localDay, reviewsDue } from "../memory/reviews.js";
import { calendarDay } from "../memory/tasks.js";
import { isInside, realpathLenient } from "../security/paths.js";

/**
 * The eleven sources of door 1 (.specs/features/cerebro-paineis, S2). Each reads the index (`files`, `files_fts`,
 * `note_tasks`), the stores of the system or a connector through its cache, never a file (door 2), and applies today's
 * policy (`storedRowFilter`) to every row it reads and the context's scope to every memory row (amendment 4).
 */

/** What a source is handed for one widget. */
export interface SourceCall {
  now: number;
  /** The widget's `limit` (default 8). */
  limit: number;
  /** The context's scope (its `ok` paths and `memory/notes/<id>/`), or null for the whole brain. */
  scope: CleanupScope | null;
  context: WorkContext | null;
  /** Pass over the connectors' cache (the "Atualizar" button). */
  fresh: boolean;
}

export type SourceOutput =
  | { status: "ok"; data: Record<string, unknown>; syncedAt?: number | null }
  | { status: "not_configured"; message: string; data: Record<string, unknown> }
  | { status: "error"; message: string };

export type DashboardSourceFn = (
  source: DashboardSource,
  call: SourceCall,
) => SourceOutput | Promise<SourceOutput>;
export type DashboardSourceMap = Partial<Record<SourceKind, DashboardSourceFn>>;

export interface SourceDeps {
  db: Db;
  paths: MordomoPaths;
  settings: () => Settings;
  metricsHistory: MetricsHistory;
  connectors: ConnectorRegistry;
  connectorCache: ConnectorDataCache;
  /** C6's queue (amendment 8); replaced in a test to prove the source follows it. */
  reviewsDue?: typeof reviewsDue;
}

// ---- days --------------------------------------------------------------------------------------------------------

/** The local days of the week of `now`, Monday to Sunday. */
export function weekDays(now: number): string[] {
  const d = new Date(now);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const first = localDay(monday.getTime());
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The local midnight that opens the week of `now`. */
function weekStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

// ---- the rows ----------------------------------------------------------------------------------------------------

interface NoteRow {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  ext: string;
  mtime: number;
  title: string | null;
  tags: string | null;
  fields: string | null;
}

/** A note as the sources hand it on: the index id (`/brain?sel=<id>`), its path, title and nature. */
interface NoteView {
  row: NoteRow;
  fields: Record<string, string>;
  title: string;
  natureza: Natureza | null;
}

const titleOf = (row: NoteRow): string => row.title ?? row.name.replace(/\.(md|markdown)$/i, "");

/** The Markdown rows today's policy shows and the scope holds, outside `memory/archive/`. */
function noteRows(deps: SourceDeps, call: SourceCall): NoteView[] {
  const settings = deps.settings();
  const policy = storedRowFilter(settings.excludes, { homeDir: deps.paths.home });
  const archive = path.resolve(deps.paths.memory, "archive");
  const rows = deps.db
    .prepare(
      "SELECT id, root, rel, path, name, ext, mtime, title, tags, fields FROM files WHERE ext IN ('.md', '.markdown') ORDER BY path",
    )
    .all() as NoteRow[];
  return rows
    .filter(
      (row) => !isInside(archive, row.path) && policy(row) && (call.scope === null || call.scope.within(row)),
    )
    .map((row) => {
      const fields = fieldsFromDb(row.fields);
      return { row, fields, title: titleOf(row), natureza: readNatureza(fields) };
    });
}

const field = (fields: Record<string, string>, key: string): string | null =>
  fields[key] !== undefined ? normalizeFieldKey(fields[key]!) : null;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---- notes (AC 20) -----------------------------------------------------------------------------------------------

/** The order of `groupBy: "status"` (C29): the vocabulary, then other values alphabetically, then none. */
const STATUS_ORDER = ["active", "draft", "paused", "done", "archived"];

function tagsOf(row: NoteRow): string[] {
  try {
    const parsed = JSON.parse(row.tags ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function notesSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "notes") throw new Error("not a notes source");
    const monday = weekStart(call.now);
    const mondayDay = localDay(monday);
    const folder = source.folder !== undefined ? realpathLenient(path.resolve(source.folder)) : null;
    const realRoots = new Map<string, string>();
    const realOf = (row: NoteRow) => {
      let real = realRoots.get(row.root);
      if (real === undefined) {
        real = realpathLenient(row.root);
        realRoots.set(row.root, real);
      }
      return path.join(real, row.rel);
    };
    const wanted = (list: readonly string[] | undefined) => (list ? list.map(normalizeFieldKey) : null);
    const types = wanted(source.type);
    const statuses = wanted(source.status);
    const tags = source.tags ? source.tags.map((t) => t.replace(/^#/, "").toLowerCase()) : null;
    const matched = noteRows(deps, call).filter((note) => {
      const { fields, row } = note;
      if (types && !types.includes(field(fields, "type") ?? "")) return false;
      if (statuses && !statuses.includes(field(fields, "status") ?? "")) return false;
      if (tags && !tagsOf(row).some((t) => tags.includes(t.toLowerCase()))) return false;
      if (source.natureza && (note.natureza === null || !source.natureza.includes(note.natureza)))
        return false;
      const escopo = readEscopo(fields);
      if (source.escopo && (escopo === null || !source.escopo.includes(escopo))) return false;
      if (folder !== null && !isInside(folder, realOf(row))) return false;
      if (source.changed === "week") {
        const updated = calendarDay(fields.updated);
        if (!(row.mtime >= monday || (updated !== null && updated >= mondayDay))) return false;
      }
      return true;
    });
    const updatedOf = (note: NoteView) => calendarDay(note.fields.updated) ?? "";
    matched.sort(
      (a, b) =>
        byText(updatedOf(b), updatedOf(a)) || b.row.mtime - a.row.mtime || byText(a.row.path, b.row.path),
    );
    const items = matched.slice(0, call.limit).map((note) => ({
      fileId: note.row.id,
      path: note.row.path,
      title: note.title,
      type: note.fields.type ?? null,
      status: note.fields.status ?? null,
      updated: calendarDay(note.fields.updated),
      mtime: note.row.mtime,
      natureza: note.natureza,
      escopo: readEscopo(note.fields),
    }));
    const data: Record<string, unknown> = { items, total: matched.length };
    if (source.groupBy !== undefined) {
      const key = source.groupBy;
      const counts = new Map<string | null, number>();
      for (const note of matched) {
        const value = field(note.fields, key);
        const label = value === null || value === "" ? null : value;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const rank = (label: string | null) => {
        if (label === null) return [2, ""] as const;
        const known = key === "status" ? STATUS_ORDER.indexOf(label) : -1;
        return known >= 0 ? ([0, String(known).padStart(2, "0")] as const) : ([1, label] as const);
      };
      data.categories = [...counts.entries()]
        .sort(([a], [b]) => {
          const [ra, ka] = rank(a);
          const [rb, kb] = rank(b);
          return ra - rb || byText(ka, kb);
        })
        .map(([label, count]) => ({ label, count }));
    }
    return { status: "ok", data };
  };
}

// ---- tasks (AC 17) -----------------------------------------------------------------------------------------------

interface TaskRow {
  src_id: number;
  line: number;
  done: number;
  text: string;
  due: string | null;
  priority: number;
}

function tasksSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "tasks") throw new Error("not a tasks source");
    const today = localDay(call.now);
    const last = source.window === "week" ? addDays(today, 6) : today;
    const notes = new Map(noteRows(deps, call).map((note) => [note.row.id, note]));
    const rows = deps.db
      .prepare(
        "SELECT src_id, line, done, text, due, priority FROM note_tasks WHERE due IS NOT NULL AND due <= ?",
      )
      .all(last) as TaskRow[];
    let dueToday = 0;
    let doneDueToday = 0;
    const open: Array<TaskRow & { note: NoteView }> = [];
    for (const row of rows) {
      const note = notes.get(row.src_id);
      if (!note || calendarDay(row.due) === null) continue;
      if (row.due === today) {
        dueToday++;
        if (row.done === 1) doneDueToday++;
      }
      if (row.done === 0) open.push({ ...row, note });
    }
    open.sort(
      (a, b) =>
        Number(b.due! < today) - Number(a.due! < today) ||
        b.priority - a.priority ||
        byText(a.due!, b.due!) ||
        byText(a.note.row.path, b.note.row.path) ||
        a.line - b.line,
    );
    const items = open.slice(0, call.limit).map((t) => ({
      path: t.note.row.path,
      line: t.line,
      fileId: t.note.row.id,
      text: t.text,
      done: false,
      due: t.due,
      overdue: t.due! < today,
      priority: t.priority,
      title: t.note.title,
      natureza: t.note.natureza,
    }));
    return { status: "ok", data: { items, total: open.length, dueToday, doneDueToday } };
  };
}

// ---- decisions and open loops (AC 18, amendment 7) ---------------------------------------------------------------

const OPEN_NATURES: ReadonlySet<Natureza> = new Set(["plano", "hipotese", "opiniao"]);
const stateOf = (natureza: Natureza | null): "open" | "decided" =>
  natureza !== null && OPEN_NATURES.has(natureza) ? "open" : "decided";

interface SectionItem {
  text: string;
  day: string;
  natureza: Natureza | null;
  line: number;
}

/**
 * The bullets of the level-2 section `heading` of a generated file's stored text: a `### heading` or the section in
 * another file never counts. A journal bullet loses its `HH:MM `; a `MEMORY.md` line keeps only an origin in `days`.
 */
function sectionItems(
  text: string,
  heading: string,
  kind: "memory" | "journal",
  day: string,
  days: readonly string[],
) {
  const lines = text.split(/\r?\n/);
  const passages = parsePassages(text);
  const out: SectionItem[] = [];
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      // Only the level-2 section's own bullets: any heading ends them, a `### heading` never starts them.
      inside = h[1]!.length === 2 && h[2] === heading;
      continue;
    }
    if (!inside) continue;
    const bullet = /^(?:>[ \t]*)?[-*][ \t]+(.+)$/.exec(line);
    if (!bullet) continue;
    let body = bullet[1]!.trim();
    let itemDay = day;
    if (kind === "journal") body = body.replace(/^\d{2}:\d{2}\s+/, "");
    else {
      const origin = /\s*\(journal (\d{4}-\d{2}-\d{2})\)\s*$/.exec(body);
      if (!origin || !days.includes(origin[1]!)) continue;
      itemDay = origin[1]!;
      body = body.slice(0, origin.index).trim();
    }
    if (body === "") continue;
    const passage = passages.find((p) => p.startLine <= i + 1 && i + 1 <= p.endLine);
    out.push({ text: body, day: itemDay, natureza: passage?.natureza ?? null, line: i + 1 });
  }
  return out;
}

/** The generated rows (the week's journal days and `MEMORY.md`), with their stored text, as the policy and scope allow. */
function generatedSections(deps: SourceDeps, call: SourceCall, heading: string) {
  const days = weekDays(call.now);
  const notes = noteRows(deps, call);
  const textOf = deps.db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const items: Array<SectionItem & { note: NoteView; from: "journal" | "memory" }> = [];
  for (const note of notes) {
    const kind = generatedFileKind(deps.paths, note.row.path);
    if (kind === null) continue;
    let day = "";
    if (kind === "journal") {
      day = note.row.name.slice(0, 10);
      if (!days.includes(day)) continue;
    }
    const text = (textOf.get(note.row.id) as { content: string } | undefined)?.content ?? "";
    for (const item of sectionItems(text, heading, kind, day, days))
      items.push({ ...item, note, from: kind });
  }
  // A MEMORY.md line and a journal bullet of the same day with the same text count once (the journal's).
  const seen = new Set(items.filter((i) => i.from === "journal").map((i) => `${i.day}\u0000${i.text}`));
  return {
    notes,
    items: items.filter((i) => i.from === "journal" || !seen.has(`${i.day}\u0000${i.text}`)),
  };
}

function decisionsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "decisions") throw new Error("not a decisions source");
    const { notes, items } = generatedSections(deps, call, "Decisions");
    const all = [
      ...items.map((i) => {
        // `fato` is what door 3 of cerebro-natureza gives the section; a passage around the item wins.
        const natureza = i.natureza ?? "fato";
        return {
          text: i.text,
          state: stateOf(natureza),
          natureza,
          day: i.day,
          path: i.note.row.path,
          fileId: i.note.row.id,
          line: i.line,
          title: i.note.title,
          from: i.from,
        };
      }),
      ...notes
        .filter((n) => field(n.fields, "type") === "decision")
        .map((n) => ({
          text: n.title,
          state: stateOf(n.natureza),
          natureza: n.natureza,
          day: calendarDay(n.fields.updated) ?? localDay(n.row.mtime),
          path: n.row.path,
          fileId: n.row.id,
          line: null,
          title: n.title,
          from: "note" as const,
        })),
    ].filter((d) => source.state === undefined || d.state === source.state);
    all.sort((a, b) => byText(b.day, a.day) || byText(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0));
    const open = all.filter((d) => d.state === "open").length;
    return { status: "ok", data: { items: all.slice(0, call.limit), total: all.length, open } };
  };
}

function openLoopsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "openLoops") throw new Error("not an openLoops source");
    const { items } = generatedSections(deps, call, "Open loops");
    const all = items
      .map((i) => ({
        text: i.text,
        natureza: "plano" as const,
        day: i.day,
        path: i.note.row.path,
        fileId: i.note.row.id,
        line: i.line,
        from: i.from,
      }))
      .sort((a, b) => byText(b.day, a.day) || byText(a.path, b.path) || a.line - b.line);
    return { status: "ok", data: { items: all.slice(0, call.limit), total: all.length } };
  };
}

// ---- projects (AC 19) --------------------------------------------------------------------------------------------

export type ProjectHealth = "done" | "paused" | "behind" | "due_today" | "in_review" | "on_track";

/** A project's health, in this precedence (AC 19): done, paused, behind, due today, in review, on track. */
export function projectHealth(status: string | null, due: string | null, today: string): ProjectHealth {
  if (status === "done") return "done";
  if (status === "paused") return "paused";
  if (due !== null && due < today) return "behind";
  if (due !== null && due === today) return "due_today";
  if (status === "draft") return "in_review";
  return "on_track";
}

function projectsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "projects") throw new Error("not a projects source");
    const today = localDay(call.now);
    const projects = noteRows(deps, call)
      .filter((n) => field(n.fields, "type") === "project" && field(n.fields, "status") !== "archived")
      .map((n) => {
        const status = field(n.fields, "status");
        const due = calendarDay(n.fields.due);
        return {
          fileId: n.row.id,
          path: n.row.path,
          title: n.title,
          status,
          due,
          health: projectHealth(status, due, today),
          natureza: n.natureza,
          mtime: n.row.mtime,
        };
      });
    const counts = {
      onTrack: projects.filter((p) => p.health === "on_track").length,
      active: projects.filter((p) => p.health !== "done" && p.health !== "paused").length,
      behind: projects.filter((p) => p.health === "behind").length,
    };
    const matched = projects.filter((p) => !source.health || source.health.includes(p.health));
    matched.sort(
      (a, b) => byText(a.due ?? "￿", b.due ?? "￿") || byText(a.title, b.title) || byText(a.path, b.path),
    );
    return { status: "ok", data: { items: matched.slice(0, call.limit), total: matched.length, ...counts } };
  };
}

// ---- reviews and facts (amendment 8) -----------------------------------------------------------------------------

function reviewsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "reviews") throw new Error("not a reviews source");
    const queue = deps.reviewsDue ?? reviewsDue;
    const result = queue(
      deps.db,
      { paths: deps.paths, settings: deps.settings() },
      { kind: "due", context: call.context, limit: call.limit, now: call.now },
    );
    return { status: "ok", data: { items: result.items, total: result.total } };
  };
}

function factsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "facts") throw new Error("not a facts source");
    const settings = deps.settings();
    const policy = storedRowFilter(settings.excludes, { homeDir: deps.paths.home });
    const rowOf = deps.db.prepare("SELECT root, rel FROM files WHERE path = ?");
    const allowed = (sourcePath: string | null): boolean => {
      if (sourcePath === null) return call.scope === null;
      const row = rowOf.get(sourcePath) as { root: string; rel: string } | undefined;
      const asRow = row ?? { root: path.dirname(sourcePath), rel: path.basename(sourcePath) };
      if (row && !policy(row)) return false;
      return call.scope === null || call.scope.within(asRow);
    };
    const facts = queryFacts(deps.db, { limit: 2000 }).filter((f) => allowed(f.sourcePath));
    const items = facts.slice(0, call.limit).map((f) => ({
      id: f.id,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      validFrom: f.validFrom,
      sourcePath: f.sourcePath,
    }));
    return { status: "ok", data: { items, total: facts.length } };
  };
}

// ---- runs, approvals and metrics (AC 21, AC 22) ------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ACTIVE = ["queued", "running", "waiting_approval"];

function runsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "runs") throw new Error("not a runs source");
    const rows = deps.db
      .prepare(
        `SELECT id, skill_slug, status, created_at, started_at, finished_at, duration_ms FROM runs
         WHERE status IN ('queued', 'running', 'waiting_approval') OR (finished_at IS NOT NULL AND finished_at >= ?)`,
      )
      .all(call.now - DAY_MS) as Array<{
      id: string;
      skill_slug: string | null;
      status: string;
      created_at: number;
      started_at: number | null;
      finished_at: number | null;
      duration_ms: number | null;
    }>;
    const active = rows.filter((r) => ACTIVE.includes(r.status)).sort((a, b) => b.created_at - a.created_at);
    const finished = rows
      .filter((r) => !ACTIVE.includes(r.status))
      .sort((a, b) => b.finished_at! - a.finished_at! || b.created_at - a.created_at);
    const all = [...active, ...finished].map((r) => ({
      id: r.id,
      skill: r.skill_slug,
      state: r.status,
      durationMs:
        r.duration_ms ?? (r.started_at !== null ? (r.finished_at ?? call.now) - r.started_at : null),
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    }));
    return {
      status: "ok",
      data: { items: all.slice(0, call.limit), total: all.length, active: active.length },
    };
  };
}

function approvalsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "approvals") throw new Error("not an approvals source");
    const rows = deps.db
      .prepare(
        "SELECT id, kind, description, created_at FROM approvals WHERE status = 'pending' ORDER BY created_at ASC, id ASC",
      )
      .all() as Array<{ id: string; kind: string; description: string; created_at: number }>;
    const items = rows.slice(0, call.limit).map((r) => ({
      id: r.id,
      kind: r.kind,
      description: r.description,
      createdAt: r.created_at,
      ageMs: call.now - r.created_at,
    }));
    return { status: "ok", data: { items, total: rows.length } };
  };
}

/** The field of `dailyPoints` each series is drawn from (amendment 9). */
const DAILY_FIELD = {
  runs24h: "runs",
  failed24h: "failed",
  costTodayUsd: "spendUsd",
  tokensToday: "tokens",
  inboxUnread: "inboxUnread",
  approvalsPending: "approvalsPending",
} as const;

function metricsSource(deps: SourceDeps): DashboardSourceFn {
  return (source, call) => {
    if (source.kind !== "metrics") throw new Error("not a metrics source");
    const samples = deps.metricsHistory.series(14, call.now);
    const newest = samples.at(-1);
    const points = dailyPoints(samples).map((p) => ({ day: p.day, value: p[DAILY_FIELD[source.series]] }));
    return {
      status: "ok",
      data: { value: newest ? newest[source.series] : null, points },
    };
  };
}

// ---- connectors (AC 23, amendment 10) ----------------------------------------------------------------------------

function connectorSource(deps: SourceDeps): DashboardSourceFn {
  return async (source, call) => {
    if (source.kind !== "connector") throw new Error("not a connector source");
    const settings = deps.settings();
    const connector = deps.connectors.get(source.id);
    const options = {
      allowedCommands: settings.connectors.allowedCommands,
      timeoutMs: settings.connectors.dataTimeoutMs,
      cwd: deps.paths.home,
      tz: settings.timezone,
    };
    if (!connector) {
      return {
        status: "not_configured",
        message: `No connector is called ${source.id}.`,
        data: { connector: { id: source.id, name: source.id }, setup: [] },
      };
    }
    const info = { id: connector.id, name: connector.name };
    if (!connector.dataMapping) {
      return {
        status: "not_configured",
        message: "This connector has no read-only data mapping yet.",
        data: { connector: info, setup: setupChecklist(connector, options) },
      };
    }
    const read = await deps.connectorCache.read(
      source.id,
      () => fetchConnectorData(connector, options),
      call.fresh,
    );
    if (read.status === "not_configured") {
      return {
        status: "not_configured",
        message: read.message ?? "This connector is not configured.",
        data: { connector: info, setup: read.setup ?? setupChecklist(connector, options) },
      };
    }
    if (read.status === "error")
      return { status: "error", message: read.message ?? "The connector could not be read." };
    if (source.read === "summary") {
      const value = source.key !== undefined ? read.summary?.[source.key] : undefined;
      return { status: "ok", syncedAt: read.syncedAt, data: { connector: info, value: value ?? null } };
    }
    const kept = source.read === "flagged" ? read.items.filter((i) => i.flagged === true) : read.items;
    // Only what the widget shows, and of each item only these keys: the snapshot is stored (AC 58).
    const items = kept.slice(0, call.limit).map((i) => ({
      id: i.id,
      title: i.title,
      ...(i.subtitle !== undefined ? { subtitle: i.subtitle } : {}),
      ...(i.ts !== undefined ? { ts: i.ts } : {}),
      ...(i.flagged !== undefined ? { flagged: i.flagged } : {}),
      ...(i.href !== undefined ? { href: i.href } : {}),
    }));
    return { status: "ok", syncedAt: read.syncedAt, data: { connector: info, items, total: kept.length } };
  };
}

/** The eleven sources over the engine's stores (amendment 11: all exist in this build). */
export function dashboardSources(deps: SourceDeps): DashboardSourceMap {
  return {
    notes: notesSource(deps),
    tasks: tasksSource(deps),
    decisions: decisionsSource(deps),
    openLoops: openLoopsSource(deps),
    projects: projectsSource(deps),
    reviews: reviewsSource(deps),
    facts: factsSource(deps),
    runs: runsSource(deps),
    approvals: approvalsSource(deps),
    metrics: metricsSource(deps),
    connector: connectorSource(deps),
  };
}

import path from "node:path";
import {
  QUESTION_RESULT_MAX_BYTES,
  type DashboardKind,
  type DashboardSnapshot,
  type DashboardSpec,
  type Highlight,
  type SnapshotSource,
} from "@mordomo/contracts";
import type { Settings, WorkContext } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { EventBus } from "../events.js";
import { findContext } from "../memory/contexts.js";
import { localDay } from "../memory/reviews.js";
import { DashboardEvaluator, snapshotStatus, type EvaluatorEnv } from "./evaluator.js";
import { dashboardHighlights } from "./highlights.js";
import { deliverReminders, reminderCandidates, type ReminderSink } from "./reminders.js";
import { refreshDue, snapshotStale } from "./schedule.js";
import type { DashboardSourceMap } from "./sources.js";
import { CleanupContextNotFoundError, resolveCleanupScope, type CleanupScope } from "../memory/cleanup.js";
import { homeReadScope, readWorkspaceFile } from "../security/safeFs.js";
import { QUESTION_RUN_CARD, checkQuestionResult } from "./question.js";
import {
  DashboardSkillUnavailableError,
  RefreshInProgressError,
  type DashboardProblem,
  type DashboardStore,
  type StoredDashboard,
} from "./store.js";
import { templateBaseId, templateDefinition, type TemplateInput } from "./templates.js";

/**
 * The dashboards of one service (.specs/features/cerebro-paineis, S1): the store, the evaluator over the eleven
 * sources, one refresh at a time per dashboard (AC 9) and the clock's tick (AC 10). Its state - the dashboards being
 * refreshed - lives on the instance, never in the module.
 */

export interface DashboardServiceDeps {
  store: DashboardStore;
  sources: DashboardSourceMap;
  env: EvaluatorEnv;
  events: EventBus;
  /** Where the reminders of door 5 go (the inbox) and the database whose rows count them. */
  db: Db;
  notifications: ReminderSink;
  /**
   * The skill a question dashboard runs (door 7, amendment 19): whether it can run now (it exists, is enabled and is a
   * memory skill), and its start, which answers the run's id (`409 budget_exhausted` when its day is spent).
   */
  question?: {
    available: () => boolean;
    start: (input: { question: string; contextId?: string }) => string;
  };
}

/** The source a question dashboard's snapshot reports to (amendment 19). */
const QUESTION_SOURCE = { id: "question", kind: "question" } as const;

export interface DashboardListItem {
  id: string;
  title: string;
  kind: DashboardKind;
  contextId: string | null;
  refresh: string;
  generatedAt: number | null;
  stale: boolean;
}

const KIND_ORDER: Readonly<Record<DashboardKind, number>> = { overview: 0, area: 1, question: 2 };
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export class DashboardService {
  readonly store: DashboardStore;
  private readonly evaluator: DashboardEvaluator;
  /** The dashboards whose refresh is running, by id. */
  private readonly running = new Map<string, Promise<DashboardSnapshot>>();
  /** The question dashboards whose skill runs, by id: the run's id. */
  private readonly asking = new Map<string, string>();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: DashboardServiceDeps) {
    this.store = deps.store;
    this.evaluator = new DashboardEvaluator(deps.sources, deps.env);
    this.unsubscribe = deps.events.subscribe((e) => {
      if (e.type !== "run.finished") return;
      const { runId, status } = e.payload as { runId: string; status: string };
      for (const [id, asked] of this.asking) {
        if (asked !== runId) continue;
        this.asking.delete(id);
        this.answered(id, runId, status);
      }
    });
  }

  /** Stop listening to the bus (the service's context closes). */
  close(): void {
    this.unsubscribe();
  }

  private settings(): Settings {
    return this.deps.env.settings();
  }

  /** The dashboards by kind, title and id, with their snapshot's age (amendment 13), and the files that are none. */
  list(now = Date.now()): { dashboards: DashboardListItem[]; problems: DashboardProblem[] } {
    const { dashboards, problems } = this.store.list();
    const items = dashboards.map(({ id, definition }) => {
      const generatedAt = this.store.snapshot(id)?.generatedAt ?? null;
      return {
        id,
        title: definition.title,
        kind: definition.kind,
        contextId: definition.contextId ?? null,
        refresh: definition.refresh,
        generatedAt,
        stale: snapshotStale(definition, generatedAt, now),
      };
    });
    items.sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byText(a.title, b.title) || byText(a.id, b.id),
    );
    return { dashboards: items, problems };
  }

  /** A dashboard from a template (AC 1 to AC 4); `404 context_not_found` for an area of a context that does not exist. */
  create(input: Omit<TemplateInput, "context"> & { contextId?: string | undefined }): StoredDashboard {
    let context: WorkContext | undefined;
    if (input.template === "area") {
      context = this.settings().contexts.find((c) => c.id === input.contextId);
      if (!context) throw new CleanupContextNotFoundError(input.contextId!);
    }
    const template: TemplateInput = {
      template: input.template,
      title: input.title,
      context,
      question: input.question,
    };
    return this.store.create(templateBaseId(template), templateDefinition(template));
  }

  /**
   * The stored dashboard with its snapshot and the highlights of door 5 over it; no source is read (AC 11, AC 44).
   * `since` is the last visit (ms), for `new_since_visit`.
   */
  get(
    id: string,
    now = Date.now(),
    since?: number,
  ): StoredDashboard & { snapshot: DashboardSnapshot | null; stale: boolean; highlights: Highlight[] } {
    const stored = this.store.require(id);
    const snapshot = this.store.snapshot(id);
    return {
      ...stored,
      snapshot,
      stale: snapshotStale(stored.definition, snapshot?.generatedAt ?? null, now),
      highlights: dashboardHighlights(stored.definition, snapshot, { now, since }),
    };
  }

  isRefreshing(id: string): boolean {
    return this.running.has(id) || this.asking.has(id);
  }

  /**
   * Start the skill of a question dashboard (AC 51, door 7): `409 refresh_in_progress` while its run is running,
   * `409 skill_unavailable` when the skill cannot run; the stored snapshot stays until the run's answer is accepted.
   */
  ask(id: string): { runId: string } {
    const stored = this.store.require(id);
    if (stored.definition.kind !== "question") throw new Error(`${id} is not a question dashboard.`);
    if (this.asking.has(id)) throw new RefreshInProgressError(id);
    const question = this.deps.question;
    if (!question || !question.available()) throw new DashboardSkillUnavailableError();
    const runId = question.start({
      question: stored.definition.question ?? stored.definition.title,
      ...(stored.definition.contextId !== undefined ? { contextId: stored.definition.contextId } : {}),
    });
    this.asking.set(id, runId);
    return { runId };
  }

  /** The run of a question dashboard ended: its answer becomes the snapshot, or the snapshot stays with the reason. */
  private answered(id: string, runId: string, status: string): void {
    const stored = this.store.read(id);
    if (stored === null || "problem" in stored) return;
    const now = Date.now();
    const verdict =
      // "succeeded" of amendment 19 is the run's `done`
      status === "done"
        ? this.checkAnswer(stored.definition, runId)
        : ({ ok: false, reason: `The run of the question finished ${status}.` } as const);
    let snapshot: DashboardSnapshot;
    if (verdict.ok) {
      snapshot = {
        v: 1,
        dashboardId: id,
        generatedAt: now,
        sources: [{ ...QUESTION_SOURCE, status: "ok", syncedAt: now }],
        widgets: [
          ...verdict.widgets,
          { id: QUESTION_RUN_CARD, kind: "note", status: "ok", data: { runId, finishedAt: now } },
        ],
      };
    } else {
      // A refused answer keeps the snapshot as it was; only its question source says why (AC 53).
      const failed: SnapshotSource = {
        ...QUESTION_SOURCE,
        status: "error",
        syncedAt: null,
        message: verdict.reason,
      };
      const before = this.store.snapshot(id);
      snapshot = before
        ? { ...before, sources: [...before.sources.filter((src) => src.id !== QUESTION_SOURCE.id), failed] }
        : { v: 1, dashboardId: id, generatedAt: now, sources: [failed], widgets: [] };
    }
    this.store.saveSnapshot(snapshot);
    this.deps.events.emit("dashboard.refreshed", {
      id,
      generatedAt: snapshot.generatedAt,
      status: verdict.ok ? snapshotStatus(snapshot) : "error",
    });
  }

  private checkAnswer(definition: DashboardSpec, runId: string): ReturnType<typeof checkQuestionResult> {
    const { paths } = this.deps.env;
    const settings = this.settings();
    let bytes: Buffer;
    try {
      bytes = readWorkspaceFile(
        homeReadScope(paths.home, [paths.artifacts], settings.excludes),
        path.join(paths.artifacts, runId, "dashboard.json"),
        { maxBytes: QUESTION_RESULT_MAX_BYTES, strict: true },
      ).bytes;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { ok: false, reason: "The run wrote no dashboard.json." };
      if (code === "file_too_large") {
        return { ok: false, reason: `The answer is larger than ${QUESTION_RESULT_MAX_BYTES} bytes.` };
      }
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    let scope: CleanupScope | null = null;
    if (definition.contextId !== undefined) {
      try {
        scope = resolveCleanupScope({ paths, settings }, { context: definition.contextId });
      } catch (err) {
        if (!(err instanceof CleanupContextNotFoundError)) throw err;
        return { ok: false, reason: "O contexto deste painel não existe mais." };
      }
    }
    return checkQuestionResult(bytes, { db: this.deps.db, paths, settings, scope });
  }

  /**
   * Evaluate every widget, store the snapshot and the KPIs' points, and announce `dashboard.refreshed` (AC 7). A second
   * refresh of the same dashboard while one runs is `409 refresh_in_progress` (AC 9); the lock goes with the refresh,
   * whatever its end.
   */
  async refresh(
    id: string,
    options: { fresh?: boolean; now?: () => number } = {},
  ): Promise<DashboardSnapshot> {
    const stored = this.store.require(id);
    if (stored.definition.kind === "question") {
      // A question dashboard is never evaluated: its skill answers it (`ask`, door 7).
      throw new Error(`${id} is a question dashboard: it is asked, not evaluated.`);
    }
    if (this.running.has(id)) {
      throw new RefreshInProgressError(id);
    }
    const work = this.evaluate(stored, options);
    this.running.set(id, work);
    try {
      return await work;
    } finally {
      this.running.delete(id);
    }
  }

  private async evaluate(
    stored: StoredDashboard,
    options: { fresh?: boolean; now?: () => number },
  ): Promise<DashboardSnapshot> {
    const now = (options.now ?? Date.now)();
    const { definition } = stored;
    const context =
      definition.contextId !== undefined
        ? (findContext(this.settings(), definition.contextId) ?? null)
        : null;
    const snapshot = await this.evaluator.evaluate(
      { ...definition, id: stored.id },
      {
        now,
        context,
        fresh: options.fresh === true,
        history: (widgetId) => this.store.points(stored.id, widgetId),
      },
    );
    this.store.saveSnapshot(snapshot);
    this.store.savePoints(stored.id, kpiPoints(definition, snapshot), now);
    deliverReminders(
      { db: this.deps.db, notifications: this.deps.notifications, settings: this.settings() },
      reminderCandidates(definition, snapshot, now),
      now,
    );
    this.deps.events.emit("dashboard.refreshed", {
      id: stored.id,
      generatedAt: snapshot.generatedAt,
      status: snapshotStatus(snapshot),
    });
    return snapshot;
  }

  /**
   * A stale snapshot is answered first and refreshed after (AC 10, amendment 13): this starts that refresh, unless one
   * runs already or the dashboard is never refreshed but by hand.
   */
  refreshIfStale(id: string, now = Date.now()): boolean {
    const stored = this.store.read(id);
    if (stored === null || "problem" in stored || this.running.has(id)) return false;
    const generatedAt = this.store.snapshot(id)?.generatedAt ?? null;
    if (!snapshotStale(stored.definition, generatedAt, now)) return false;
    this.refresh(id).catch(() => undefined);
    return true;
  }

  /** One beat of the service's clock: every dashboard whose interval has passed is refreshed through the cache. */
  async tick(now = Date.now()): Promise<string[]> {
    const started: Array<Promise<unknown>> = [];
    const ids: string[] = [];
    for (const { id, definition } of this.store.list().dashboards) {
      if (this.running.has(id)) continue;
      if (!refreshDue(definition, this.store.snapshot(id)?.generatedAt ?? null, now)) continue;
      ids.push(id);
      started.push(this.refresh(id).catch(() => undefined));
    }
    await Promise.all(started);
    return ids;
  }

  /** Archive a dashboard (AC 14) under the local day of `now`. */
  archive(id: string, now = Date.now()): string {
    return this.store.archive(id, localDay(now));
  }

  update(id: string, definition: DashboardSpec, baseVersion: string): StoredDashboard {
    return this.store.update(id, definition, baseVersion);
  }
}

/** The value of each KPI of a snapshot that has one: what the series keeps (door 4). */
function kpiPoints(
  definition: DashboardSpec,
  snapshot: DashboardSnapshot,
): Array<{ widgetId: string; value: number }> {
  const out: Array<{ widgetId: string; value: number }> = [];
  definition.widgets.forEach((widget, i) => {
    const result = snapshot.widgets[i];
    if (widget.kind !== "kpi" || result?.status !== "ok") return;
    const value = (result.data as { value?: unknown } | undefined)?.value;
    if (typeof value === "number") out.push({ widgetId: widget.id, value });
  });
  return out;
}

import type { DashboardKind, DashboardSnapshot, DashboardSpec, Highlight } from "@mordomo/contracts";
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
import { CleanupContextNotFoundError } from "../memory/cleanup.js";
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
}

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

  constructor(private readonly deps: DashboardServiceDeps) {
    this.store = deps.store;
    this.evaluator = new DashboardEvaluator(deps.sources, deps.env);
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
    return this.running.has(id);
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
      // S6 starts the dashboard-answer skill here; this build has no such skill (amendment 19).
      throw new DashboardSkillUnavailableError();
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

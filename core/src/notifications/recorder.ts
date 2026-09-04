import type { EventBus, OsEvent } from "../events.js";
import type { SentinelFiredPayload, SentinelSeverity } from "../sentinels/types.js";
import type { NotificationInput, NotificationStore, NotificationTone } from "./store.js";

/**
 * Bus → inbox. The recorder is the only thing that writes notification rows in
 * normal operation: it listens on the process event bus and persists the few
 * events a human actually needs to see after closing the tab.
 *
 * What is NOT recorded is as important as what is: successful runs, run
 * progress, routine fires and settings saves stay live-only (the Command Centre
 * shows them from the SSE stream) — persisting them would flood the table for
 * no benefit. Only things that need attention later survive a restart:
 * approvals, failed runs, heartbeat alerts, budget thresholds, sentinel
 * findings, plus two informational rows (index and backup) that start read.
 *
 * Titles are plain English: the UI does not translate server rows.
 *
 * Registration (apps/api/src/context.ts, end of the constructor):
 *   `installNotificationRecorder(events, this.notifications, { … })`
 */

/** Just enough of a run to label a failure (RunManager satisfies it). */
export interface RecorderRunLookup {
  get(id: string): { skillSlug: string | null; promptSummary: string } | null;
}

/** Just enough of a routine to title an alert (RoutineStore satisfies it). */
export interface RecorderRoutineLookup {
  get(id: string): { name: string } | null;
}

export interface NotificationRecorderOptions {
  runs?: RecorderRunLookup;
  routines?: RecorderRoutineLookup;
  /** Rows kept after each write (see `NotificationStore.prune`). */
  keep?: number;
}

/** Payload of `budget.crossed` (emitted by the hourly budget check). */
export interface BudgetCrossedPayload {
  /** Percentage of the daily budget that was crossed. */
  level: 80 | 100;
  /** Local day the spend belongs to, `YYYY-MM-DD`. */
  day: string;
  spentUsd: number;
  budgetUsd: number;
}

const FAILED_STATUSES = new Set(["failed", "timed_out"]);

/** `sentinel.fired` severity → inbox tone. */
const SEVERITY_TONE: Record<SentinelSeverity, NotificationTone> = {
  info: "info",
  warn: "warn",
  danger: "danger",
};

/** Installed recorders per bus, keyed by store — so a second install is a no-op. */
const installed = new WeakMap<EventBus, Map<NotificationStore, () => void>>();

/**
 * Subscribe the inbox to the event bus. Returns the unsubscribe function;
 * installing twice on the same (bus, store) pair returns the first disposer so
 * the API and a CLI path may both call it.
 */
export function installNotificationRecorder(
  bus: EventBus,
  store: NotificationStore,
  opts: NotificationRecorderOptions = {},
): () => void {
  const perBus = installed.get(bus) ?? new Map<NotificationStore, () => void>();
  installed.set(bus, perBus);
  const already = perBus.get(store);
  if (already) return already;

  const record = (input: NotificationInput): void => {
    try {
      store.add(input);
      store.prune(opts.keep);
    } catch (err) {
      // The inbox must never break the emitter (a full disk, a closed db).

      console.error("[notifications] failed to record", err);
    }
  };

  const unsubscribe = bus.subscribe((event: OsEvent) => {
    const input = toNotification(event, opts);
    if (input) record(input);
  });
  const dispose = () => {
    perBus.delete(store);
    unsubscribe();
  };
  perBus.set(store, dispose);
  return dispose;
}

/**
 * Map one bus event to a row, or null when the event is not worth persisting.
 * Exported for tests and so the mapping can be read in one place.
 */
export function toNotification(
  event: OsEvent,
  opts: NotificationRecorderOptions = {},
): NotificationInput | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const ts = event.ts || Date.now();
  switch (event.type) {
    case "approval.requested": {
      return {
        kind: "approval",
        tone: "warn",
        title: "Approval requested",
        body: str(payload.description),
        href: "/settings?tab=security",
        approvalId: str(payload.id),
        runId: str(payload.runId),
        ts,
      };
    }
    case "run.finished": {
      const status = str(payload.status) ?? "";
      if (!FAILED_STATUSES.has(status)) return null; // successes stay live-only
      const runId = str(payload.runId);
      const run = runId ? (opts.runs?.get(runId) ?? null) : null;
      return {
        kind: "run",
        tone: "danger",
        title: status === "timed_out" ? "Run timed out" : "Run failed",
        body: run?.skillSlug ?? run?.promptSummary ?? runId,
        href: runId ? `/runs/${runId}` : "/runs",
        runId,
        ts,
      };
    }
    case "routine.alert": {
      const routineId = str(payload.routineId);
      const routine = routineId ? (opts.routines?.get(routineId) ?? null) : null;
      return {
        kind: "routine",
        tone: "warn",
        title: routine?.name || routineId || "Routine alert",
        body: str(payload.summary),
        href: "/routines",
        runId: str(payload.runId),
        ts,
      };
    }
    case "index.finished": {
      const stats = (payload.stats ?? {}) as Record<string, unknown>;
      return {
        kind: "index",
        tone: "ok",
        title: "Index finished",
        body: indexBody(stats),
        href: "/brain",
        read: true, // informational: never carries a badge
        ts,
      };
    }
    case "backup.created": {
      return {
        kind: "system",
        tone: "ok",
        title: "Backup created",
        body: str(payload.name),
        href: "/settings?tab=backups",
        read: true,
        ts,
      };
    }
    case "sentinel.fired": {
      // Sentinels (Onda 2) already decided what a human should read; the
      // recorder only maps severity to tone and carries the dedupe key over.
      const p = payload as unknown as Partial<SentinelFiredPayload>;
      if (typeof p.title !== "string" || !p.title) return null;
      return {
        kind: "system",
        tone: SEVERITY_TONE[p.severity ?? "info"] ?? "info",
        title: p.title,
        body: str(p.body),
        href: str(p.href) ?? "/",
        dedupeKey: str(p.dedupeKey),
        ts,
      };
    }
    case "budget.crossed": {
      const p = payload as unknown as Partial<BudgetCrossedPayload>;
      const level = p.level === 100 ? 100 : 80;
      const exceeded = level === 100;
      return {
        kind: "system",
        tone: exceeded ? "danger" : "warn",
        title: exceeded ? "Daily budget exceeded" : "Daily budget 80% used",
        body: budgetBody(p),
        href: "/settings?tab=security",
        // Once per day per level: the hourly check also skips when this key is
        // already on file, so a long day never repeats the warning.
        dedupeKey: budgetDedupeKey(p.day ?? localDay(ts), level),
        ts,
      };
    }
    default:
      return null;
  }
}

/** Dedupe key of the once-per-day-per-level budget row. */
export function budgetDedupeKey(day: string, level: 80 | 100): string {
  return `budget:${day}:${level}`;
}

/** Local `YYYY-MM-DD` (the budget resets at local midnight, like `cost.todayUsd`). */
export function localDay(at = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function budgetBody(p: Partial<BudgetCrossedPayload>): string | null {
  if (typeof p.spentUsd !== "number" || typeof p.budgetUsd !== "number") return null;
  return `$${p.spentUsd.toFixed(2)} of $${p.budgetUsd.toFixed(2)} spent today`;
}

function indexBody(stats: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const push = (key: string, label: string) => {
    const value = stats[key];
    if (typeof value === "number" && value > 0) parts.push(`${value} ${label}`);
  };
  push("scanned", "scanned");
  push("added", "added");
  push("updated", "updated");
  push("removed", "removed");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

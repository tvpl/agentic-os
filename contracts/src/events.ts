/**
 * The typed event map: every event the engine announces on its bus (and the
 * API relays over SSE at `/api/events`), with the payload each one carries.
 * Every envelope carries `v`; changing a payload's shape bumps it.
 */
import type { ApprovalKind } from "./policy.js";
import type { EventVersionOf } from "./eventRegistry.js";
import type { Approval, NotificationRecord } from "./records.js";
import type { RunEvent, RunOrigin, RunStatus } from "./runs.js";
import type { ProviderId, Settings } from "./settings.js";

/** The names of the events an engine announces. */
export type OsEventType =
  | "run.created"
  | "run.started"
  | "run.event"
  | "run.finished"
  | "routine.fired"
  | "routine.alert"
  | "routine.changed"
  | "index.started"
  | "index.progress"
  | "index.finished"
  | "index.failed"
  | "index.cancelled"
  /** A cleanup scan of a scope advanced, finished or failed (.specs/features/cerebro-faxina-guiada, door 6). */
  | "cleanup.progress"
  | "cleanup.finished"
  | "cleanup.failed"
  /** A dashboard was refreshed and its snapshot stored (.specs/features/cerebro-paineis, door 6). */
  | "dashboard.refreshed"
  | "approval.requested"
  | "approval.resolved"
  | "approval.expired"
  | "session.created"
  | "session.updated"
  | "objective.changed"
  | "settings.changed"
  | "backup.created"
  /** A row was appended to the persisted inbox (payload: the notification). */
  | "notification.created"
  | "notification.read"
  /** Today's spend passed a share of `settings.limits.dailyBudgetUsd`. */
  | "budget.crossed"
  /**
   * A sentinel observed something worth a look (Onda 2, item 1). Payload:
   * `SentinelFiredPayload` (core/src/sentinels/types.ts). The notification
   * recorder turns it into an inbox row; the triage listener may answer it
   * with a short, cheap run when `triage` is set.
   */
  | "sentinel.fired"
  /**
   * The resume point the client sent is ahead of this process's last id (the service
   * restarted and event ids start over). Sent by `GET /api/events` only, as the first
   * frame of that response and never through the bus; payload: the process's last id.
   */
  | "stream.reset";

/**
 * The first version of every event. The version of one event is `v` in its envelope, from the list of its type
 * (`EVENT_VERSIONS`, `./eventRegistry.ts`); this stays for the code that stamped `1` before there was a list.
 */
export const OS_EVENT_VERSION = 1 as const;

export interface IndexStats {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  skippedExcluded: number;
  /** Files whose bytes were not indexed because they looked binary (NUL in first 8 KiB). */
  skippedBinary: number;
  /** Related-by-content edges (re)computed for the files that changed. */
  related: number;
  durationMs: number;
  /** Vectors (re)computed by the pass; present only while the semantic search is on. */
  embedded?: number;
}

/** The phases of an index pass, in order (`index.progress`). */
export const INDEX_PHASES = ["scan", "index", "prune", "related", "vectors"] as const;
export type IndexPhase = (typeof INDEX_PHASES)[number];

/** The phases of a cleanup scan, in order (`cleanup.progress`, .specs/features/cerebro-faxina-guiada, door 6). */
export type CleanupPhase = "inventory" | "signatures" | "links" | "findings";

/** Where an index pass runs: a `worker_thread` of the service, or the service's own thread (no worker script). */
export type IndexMode = "worker" | "inline";

/** Payload of `index.progress` events and of the `indexAllAsync` callback. */
export interface IndexProgress {
  /** The pass this belongs to (`index.started`). */
  runId?: string;
  phase?: IndexPhase;
  scanned: number;
  /** Known once the scan phase finished. */
  total?: number;
  added: number;
  updated: number;
  removed: number;
}

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
}

export interface BudgetCrossedPayload {
  /** Percentage of the daily budget that was crossed. */
  level: 80 | 100;
  /** Local day the spend belongs to, `YYYY-MM-DD`. */
  day: string;
  spentUsd: number;
  budgetUsd: number;
}

export type SentinelId = "fsWatch" | "repeatedFailure" | "silentRoutine" | "connectorDelta" | "reviewDue";

export const SENTINEL_IDS: readonly SentinelId[] = [
  "fsWatch",
  "repeatedFailure",
  "silentRoutine",
  "connectorDelta",
  /** The notes whose review fell due, once a day (.specs/features/cerebro-natureza, door 5). */
  "reviewDue",
];

export type SentinelSeverity = "info" | "warn" | "danger";

/** Payload of `sentinel.fired`. */
export interface SentinelFiredPayload {
  sentinel: SentinelId;
  messageParams?: Record<string, string | number | boolean>;
  title: string;
  body: string;
  severity: SentinelSeverity;
  /** Where the Command Centre should send the reader. */
  href?: string;
  /** Rows sharing this key collapse (see `NotificationStore.hasDedupeKey`). */
  dedupeKey?: string;
  /** Ask the triage run to decide what this means (costs money — see `triage.ts`). */
  triage?: boolean;
}

/** Payload of each event type. Events emitted from more than one place carry a union, one member per shape. */
export interface OsEventMap {
  "run.created": { runId: string; origin: RunOrigin; provider: ProviderId; sessionId?: string };
  "run.started": { runId: string; pid: number | null };
  "run.event": { runId: string; event: RunEvent };
  "run.finished": { runId: string; status: RunStatus; durationMs: number | null };
  "routine.fired": { routineId: string; runId: string };
  "routine.alert":
    | {
        routineId: string;
        runId: null;
        summary: string;
        reason: "budget";
        spentUsd: number;
        budgetUsd: number;
      }
    | { routineId: string; runId: string; status: RunStatus; summary: string };
  "routine.changed": { id: string; action: string; reason?: string | null };
  "index.started": { runId: string; mode: IndexMode };
  "index.progress": IndexProgress;
  "index.finished": { stats: IndexStats; runId?: string };
  "index.failed": { code: string; previousIndexPreserved: boolean; runId?: string };
  "index.cancelled": { runId: string };
  "cleanup.progress": { scanId: string; phase: CleanupPhase; done: number; total: number };
  "cleanup.finished": { scanId: string; findings: number };
  "cleanup.failed": { scanId: string; code: string };
  "dashboard.refreshed": { id: string; generatedAt: number; status: "ok" | "partial" | "error" };
  "approval.requested": { id: string; kind: ApprovalKind; description: string; runId?: string | null };
  "approval.resolved": { id: string; kind: ApprovalKind; status: Approval["status"]; runId: string | null };
  "approval.expired": { count: number };
  "session.created": { sessionId: string; provider: ProviderId; title: string };
  "session.updated":
    | { sessionId: string; providerSessionId: string }
    | { sessionId: string; lastRunId: string | null; turns: number; costUsd: number }
    | { sessionId: string; title: string }
    | { sessionId: string; deleted: true; runsKept: number };
  "objective.changed":
    | { objectiveId: string | undefined; status: string | undefined }
    | { objectiveId: string; deleted: true }
    | { objectiveId: string | undefined; stepId: string; status?: string | undefined };
  "settings.changed": { settings: Settings };
  "backup.created": BackupInfo;
  "notification.created": NotificationRecord;
  "notification.read": { ids: readonly string[] } | { all: true };
  "budget.crossed": BudgetCrossedPayload;
  "sentinel.fired": SentinelFiredPayload;
  "stream.reset": { lastId: number };
}

/** One event as the bus delivers it: a union over the event types, discriminated by `type`. */
export type OsEvent<K extends OsEventType = OsEventType> = {
  [P in K]: {
    /** Monotonic id (per process) so SSE clients can resume with Last-Event-ID. */
    id: number;
    type: P;
    ts: number;
    v: EventVersionOf<P>;
    payload: OsEventMap[P];
  };
}[K];

/** Runs as they cross the wire: the record, its request, its events and its usage. */
import type { EffortLevel, ProviderId, SecurityProfile } from "./settings.js";

/** Whether a run may change files. */
export type RunMode = "read_only" | "write";

export type RunOrigin = "manual" | "skill" | "routine" | "api" | "sentinel";
/** Where a run is in its life. */
export type RunStatus =
  "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled" | "timed_out" | "interrupted";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "done",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);

/** Complete local request used to reproduce a run without relying on its UI summary. */
export type RunRequestSpec =
  | { version: 1; kind: "prompt"; prompt: string; mode: RunMode }
  | { version: 1; kind: "skill"; skillSlug: string; inputs: Record<string, string>; mode: RunMode }
  | { version: 1; kind: "system"; prompt: string; mode: RunMode };

export interface RunFailure {
  code:
    | "authentication"
    | "permission"
    | "budget"
    | "timeout"
    | "cancelled"
    | "interrupted"
    | "provider"
    | "unknown"
    /** The run's folder (door 5 of cerebro-organizar) stopped being one a run may be handed before it launched. */
    | "folder_not_indexed"
    /** The run's provider cannot keep a folder read-only (door 5 of cerebro-organizar). */
    | "folder_protection_unsupported";
  message: string;
  recoverable: boolean;
  effectsUncertain: boolean;
}

/** A run as stored: its status, provider, working folder, asker, usage and outcome. */
export interface RunRecord {
  id: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  origin: RunOrigin;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  status: RunStatus;
  exitCode: number | null;
  durationMs: number | null;
  cwd: string | null;
  promptSummary: string;
  /** Complete typed request. Null for runs created before migration 14. */
  request: RunRequestSpec | null;
  skillSlug: string | null;
  routineId: string | null;
  /** Spend cap for this run (remaining routine/skill budget at launch); null = none. */
  maxCostUsd: number | null;
  /** First run of a retry chain (null for the first attempt). */
  parentRunId: string | null;
  /** Conversation this run belongs to (`sessions.id`), or null for a one-shot run. */
  sessionId: string | null;
  pid: number | null;
  error: string | null;
  failure: RunFailure | null;
  artifacts: string[];
  filesChanged: string[];
  attempts: number;
  timeoutMs: number | null;
  permissionProfile: SecurityProfile | null;
  /**
   * Who started it, by the names `Approval.resolvedBy` uses: `"owner"` (the local token), `"device:<deviceId>"`, or
   * null for what no request started (a routine, a sentinel, the CLI) and for runs created before this was recorded.
   */
  startedBy: string | null;
  /** Token usage and provider-reported cost; null until a provider reports it. */
  usage: RunUsage | null;
  /**
   * The work context the run was started in (.specs/features/cerebro-contextos, door 4), kept as it was when the context
   * is deleted later; null for a run without one and for runs created before migration 23.
   */
  contextId: string | null;
}

/** One thing a provider reported while a run was going. */
export type RunEvent = (
  | { type: "started"; ts: number; pid: number | null }
  | { type: "text"; ts: number; stream: "stdout" | "stderr"; text: string }
  | { type: "assistant"; ts: number; text: string }
  | {
      type: "tool_use";
      ts: number;
      tool: string;
      detail: string;
      /**
       * Files the tool wrote, when the adapter knows them structurally (a Codex
       * `file_change` lists every path of its patch). Additive: absent for tools
       * whose files only appear inside `detail`, which the run manager then reads
       * as before. Paths are verbatim (never JSON-escaped), at most 200 per event.
       */
      paths?: string[];
      callId?: string;
      phase?: "start" | "end";
      durationMs?: number;
      outcome?: "ok" | "error" | "denied";
    }
  | { type: "permission"; ts: number; detail: string }
  /**
   * The provider told us which conversation this run belongs to (Claude's
   * `session_id`, Codex's `thread_id`). Emitted up front when the adapter
   * chose the id itself and again from the stream as confirmation — the last
   * one wins, which is also how a resumed conversation that forks into a new
   * provider session gets recorded.
   */
  | { type: "session"; ts: number; providerSessionId: string }
  | {
      type: "result";
      ts: number;
      exitCode: number | null;
      summary: string;
      durationMs: number;
      timedOut: boolean;
      /** True when the process ended because cancellation was requested (or was never spawned because of it). */
      cancelled?: boolean;
    }
  | { type: "error"; ts: number; message: string }
  | ({ type: "usage"; ts: number } & RunUsageEvent)
) & {
  /** Stable execution attempt id. */ attemptId?: string;
  /** Monotonic within this attempt. */ sequence?: number;
};

/**
 * Token/cost usage reported by a provider. `scope` tells the RunManager how to
 * fold several events into the run's usage: a `total` snapshot replaces
 * everything seen so far (Claude's `result`, Codex's `turn.completed`),
 * while `turn` events (one per assistant message) are summed until a total
 * arrives. Missing scope means `turn`.
 */
export interface RunUsageEvent {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Provider-reported cost in USD; null when the provider gives tokens but no price. */
  costUsd?: number | null;
  model?: string;
  scope?: "turn" | "total";
}

/** Usage persisted on the run row (sum of turns, or the provider's total). */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number | null;
  model?: string;
}

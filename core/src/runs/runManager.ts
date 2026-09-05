import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { PermissionBroker } from "../agents/types.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings, ProviderId, EffortLevel, SecurityProfile } from "../config/schema.js";
import type { AgentAdapter, AgentRun, RunEvent, RunMode, RunUsage, RunUsageEvent } from "../agents/types.js";
import { JsonlLogger } from "../logs/jsonl.js";
import { redactSecrets } from "../security/redact.js";
import { killProcessGroup } from "../spawn/safeSpawn.js";
import { events } from "../events.js";
import { SessionStore } from "./sessionStore.js";
import { emulatedPrompt } from "./emulatedSession.js";

export type RunOrigin = "manual" | "skill" | "routine" | "api" | "sentinel";
export type RunStatus =
  "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled" | "timed_out" | "interrupted";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "done",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);

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
  skillSlug: string | null;
  routineId: string | null;
  /** First run of a retry chain (null for the first attempt). */
  parentRunId: string | null;
  /** Conversation this run belongs to (`sessions.id`), or null for a one-shot run. */
  sessionId: string | null;
  pid: number | null;
  error: string | null;
  artifacts: string[];
  filesChanged: string[];
  attempts: number;
  timeoutMs: number | null;
  permissionProfile: SecurityProfile | null;
  /** Token usage and provider-reported cost; null until a provider reports it. */
  usage: RunUsage | null;
}

/** `Metrics.cost` — spend and token throughput derived from the runs table. */
export interface CostMetrics {
  /** Cost of runs created since local midnight. */
  todayUsd: number;
  /** Cost of runs created in the last 7 days. */
  weekUsd: number;
  /** Input + output + cache tokens of runs created since local midnight. */
  tokensToday: number;
  /** Cost of runs that finished (or started) in the last 60 minutes. */
  burnRatePerHour: number;
  /**
   * Only present when a usage budget is configured in settings
   * (`settings.usage.blockBudgetTokens`); the schema has no such setting
   * today, so this is omitted.
   */
  block5h?: { usedPct: number; resetsAt: number };
}

/** Hourly buckets (oldest first) for the tokens sparkline in the Runs header. */
export interface UsageSeriesPoint {
  ts: number;
  tokens: number;
  usd: number;
}

export interface CreateRunInput {
  origin: RunOrigin;
  provider: ProviderId;
  prompt: string;
  cwd: string;
  model: string | null;
  effort: EffortLevel;
  mode: RunMode;
  timeoutMs: number;
  profile: SecurityProfile;
  skillSlug?: string | null;
  routineId?: string | null;
  parentRunId?: string | null;
  /**
   * Continue a conversation: the run inherits the session's provider-side id
   * (so the adapter resumes instead of starting over) and folds its usage back
   * into the session's counters when it finishes.
   */
  sessionId?: string | null;
  attempts?: number;
  /**
   * Initial status. `waiting_approval` makes a write run gated by an approval
   * visible in the Runs list; `markApproved()` moves it to `queued`.
   */
  status?: Extract<RunStatus, "queued" | "waiting_approval">;
}

export interface PruneOptions {
  /** Delete events older than this many days (default: settings.limits.logRetentionDays). */
  keepDays?: number;
  /** Max events kept per run: the first 500 plus the most recent ones (default 5000). */
  keepEvents?: number;
  /** Delete finished runs older than this many days (default: settings.limits.runRetentionDays). */
  keepRunDays?: number;
  /** Keep at most this many finished runs, newest first; 0 = no cap (default: settings.limits.runRetentionMax). */
  keepRuns?: number;
  /** Delete routine_history rows older than this many days (default: settings.limits.routineHistoryRetentionDays). */
  keepHistoryDays?: number;
  /** Force (true) or skip (false) the weekly `PRAGMA optimize` + `VACUUM`. */
  vacuum?: boolean;
}

export interface PruneResult {
  eventsExpired: number;
  eventsCapped: number;
  /** Runs whose event log was capped (head + tail kept). */
  runsCapped: number;
  /** Finished runs deleted by age or by the newest-N cap. */
  runsDeleted: number;
  /** `routine_history` rows deleted by age. */
  historyDeleted: number;
  /** Whether this call ran `PRAGMA optimize` + `VACUUM`. */
  vacuumed: boolean;
}

/** Events kept per run (first HEAD_KEEP + tail). Applied live and on prune(). */
const DEFAULT_EVENT_CAP = 5000;
const HEAD_KEEP = 500;
/** Queue depth allowed before create() refuses with 429 = maxConcurrentRuns * this. */
const QUEUE_DEPTH_FACTOR = 10;
/** How often prune() may compact the database file. */
const VACUUM_INTERVAL_MS = 7 * 86_400_000;
/** `meta` key holding the last `VACUUM` timestamp. */
const LAST_VACUUM_KEY = "last_vacuum";
/** Runs whose rows and events retention must never touch. */
const LIVE_STATUSES = "('queued','running','waiting_approval')";

/** Fallback when an adapter carries no manifest (tests with stubs). */
const WRITE_TOOLS = /^(write|edit|multiedit|notebookedit|create_file|apply_patch|str_replace)/i;

interface ActiveRun {
  controller: AbortController;
  pid: number | null;
  promise: Promise<RunRecord>;
  /** Set when the abort came from shutdown(): final status is `interrupted`, not `cancelled`. */
  shutdown: boolean;
  persistedEvents: number;
}

/**
 * Owns the lifecycle of runs: persistence, concurrency, cancellation registry,
 * explicit state transitions and retention. Adapters only stream events; every
 * status change goes through `transition()` with an allowed set of sources so
 * a late event can never overwrite a terminal status.
 */
/** Builds the permission MCP command for a run, or null to let the CLI decide alone. */
export type PermissionBrokerFactory = (run: RunRecord) => PermissionBroker | null;

export class RunManager {
  private readonly permissionBroker: PermissionBrokerFactory | null;
  /** Conversations these runs may belong to (`runs.session_id`). */
  readonly sessions: SessionStore;
  private readonly emitter = new EventEmitter();
  private readonly logger: JsonlLogger;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly activeRuns = new Map<string, ActiveRun>();
  private shuttingDown = false;
  private readonly eventCap: number;

  constructor(
    private readonly db: Db,
    private readonly paths: MordomoPaths,
    private readonly getSettings: () => Settings,
    private readonly getAdapter: (id: ProviderId) => AgentAdapter,
    opts: { eventCap?: number; pruneOnBoot?: boolean; permissionBroker?: PermissionBrokerFactory } = {},
  ) {
    this.permissionBroker = opts.permissionBroker ?? null;
    const s = getSettings();
    this.sessions = new SessionStore(db);
    this.logger = new JsonlLogger(paths.logs, "runs", s.limits.logMaxFileBytes, s.limits.logRetentionDays);
    this.emitter.setMaxListeners(100);
    this.eventCap = opts.eventCap ?? DEFAULT_EVENT_CAP;
    if (opts.pruneOnBoot !== false) {
      try {
        this.prune();
      } catch (err) {
        this.log({ event: "prune_failed", error: (err as Error).message });
      }
    }
  }

  /** Logging must never throw, even after the logs dir is gone (late background tasks). */
  private log(record: Record<string, unknown>): void {
    try {
      this.logger.append(record);
    } catch {
      /* best effort */
    }
  }

  // ------------------------------------------------------------ retention --

  /**
   * Retention: expire old events, cap events per run, delete finished runs
   * past `runRetentionDays`/`runRetentionMax`, trim `routine_history` and —
   * at most once a week — `PRAGMA optimize` + `VACUUM`. Runs that are live or
   * still referenced by a pending approval are never deleted. Called on
   * construction; safe to call anytime.
   */
  prune(opts: PruneOptions = {}): PruneResult {
    const limits = this.getSettings().limits;
    const keepDays = opts.keepDays ?? limits.logRetentionDays;
    const keepEvents = Math.max(opts.keepEvents ?? this.eventCap, HEAD_KEEP + 1);
    const cutoff = Date.now() - keepDays * 86_400_000;
    const eventsExpired = this.db
      .prepare(
        `DELETE FROM run_events WHERE ts < ? AND run_id NOT IN (SELECT id FROM runs WHERE status IN ${LIVE_STATUSES})`,
      )
      .run(cutoff).changes;

    const heavy = this.db
      .prepare("SELECT run_id, COUNT(*) c FROM run_events GROUP BY run_id HAVING c > ?")
      .all(keepEvents) as Array<{ run_id: string; c: number }>;
    const tail = keepEvents - HEAD_KEEP;
    let eventsCapped = 0;
    const capOne = this.db.transaction((runId: string) => {
      const headEnd = this.db
        .prepare("SELECT id FROM run_events WHERE run_id = ? ORDER BY id ASC LIMIT 1 OFFSET ?")
        .get(runId, HEAD_KEEP) as { id: number } | undefined;
      const tailStart = this.db
        .prepare("SELECT id FROM run_events WHERE run_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?")
        .get(runId, tail - 1) as { id: number } | undefined;
      if (!headEnd || !tailStart) return 0;
      const removed = this.db
        .prepare("DELETE FROM run_events WHERE run_id = ? AND id >= ? AND id < ?")
        .run(runId, headEnd.id, tailStart.id).changes;
      if (removed > 0) {
        this.db.prepare("INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, ?, ?)").run(
          runId,
          Date.now(),
          "text",
          JSON.stringify({
            type: "text",
            ts: Date.now(),
            stream: "stderr",
            text: `[mordomo] ${removed} intermediate events pruned by retention (kept first ${HEAD_KEEP} and last ${tail}).`,
          }),
        );
      }
      return removed;
    });
    for (const row of heavy) eventsCapped += capOne(row.run_id);

    const runsDeleted = this.pruneRuns(
      opts.keepRunDays ?? limits.runRetentionDays,
      opts.keepRuns ?? limits.runRetentionMax,
    );
    const historyDeleted = this.db
      .prepare("DELETE FROM routine_history WHERE fired_at < ?")
      .run(Date.now() - (opts.keepHistoryDays ?? limits.routineHistoryRetentionDays) * 86_400_000).changes;
    const vacuumed = this.maybeVacuum(opts.vacuum);

    const result = {
      eventsExpired,
      eventsCapped,
      runsCapped: heavy.length,
      runsDeleted,
      historyDeleted,
      vacuumed,
    };
    if (eventsExpired || eventsCapped || runsDeleted || historyDeleted || vacuumed) {
      this.log({ event: "pruned", ...result, keepDays, keepEvents });
    }
    return result;
  }

  /**
   * Delete finished runs (and their events) older than `keepDays`, then keep
   * only the newest `keepMax` of the ones that remain. A run linked to a
   * pending approval stays, whatever its age.
   */
  private pruneRuns(keepDays: number, keepMax: number): number {
    // Payload link written by the API when a write run is gated (`payload.runId`).
    const pinned = `
      SELECT json_extract(payload, '$.runId') FROM approvals
      WHERE status = 'pending' AND json_extract(payload, '$.runId') IS NOT NULL`;
    const deletable = `
      SELECT id FROM runs
      WHERE status NOT IN ${LIVE_STATUSES} AND id NOT IN (${pinned})`;
    const ids = [
      ...(this.db
        .prepare(`${deletable} AND COALESCE(finished_at, created_at) < ?`)
        .all(Date.now() - keepDays * 86_400_000) as Array<{ id: string }>),
      ...(keepMax > 0
        ? (this.db.prepare(`${deletable} ORDER BY created_at DESC LIMIT -1 OFFSET ?`).all(keepMax) as Array<{
            id: string;
          }>)
        : []),
    ].map((r) => r.id);
    if (ids.length === 0) return 0;
    const unique = [...new Set(ids)];
    const deleteRun = this.db.transaction((batch: string[]) => {
      const placeholders = batch.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM run_events WHERE run_id IN (${placeholders})`).run(...batch);
      return this.db.prepare(`DELETE FROM runs WHERE id IN (${placeholders})`).run(...batch).changes;
    });
    let deleted = 0;
    // SQLite caps the number of bound parameters; delete in chunks.
    for (let i = 0; i < unique.length; i += 400) deleted += deleteRun(unique.slice(i, i + 400));
    return deleted;
  }

  /**
   * `PRAGMA optimize` + `VACUUM`, at most once every `VACUUM_INTERVAL_MS`. The
   * timestamp lives in the `meta` key/value table; a database that never
   * vacuumed only records "now" so a fresh install does not compact an empty file.
   */
  private maybeVacuum(force?: boolean): boolean {
    if (force === false) return false;
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(LAST_VACUUM_KEY) as
      { value: string } | undefined;
    const last = row ? Number(row.value) : NaN;
    const now = Date.now();
    const due = force === true || (Number.isFinite(last) && now - last >= VACUUM_INTERVAL_MS);
    const stamp = () =>
      this.db
        .prepare(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(LAST_VACUUM_KEY, String(now));
    if (!due) {
      if (!row) stamp();
      return false;
    }
    try {
      this.db.pragma("optimize");
      this.db.exec("VACUUM");
    } catch (err) {
      this.log({ event: "vacuum_failed", error: (err as Error).message });
      return false;
    }
    stamp();
    return true;
  }

  // ------------------------------------------------------------- recovery --

  /**
   * Mark runs orphaned by a crash/restart. If the recorded pid still points at
   * a live provider process from the previous service instance, its process
   * group gets SIGTERM before the row is marked `interrupted`.
   */
  recoverInterrupted(): number {
    const rows = this.db
      .prepare("SELECT id, pid, provider, error FROM runs WHERE status IN ('running', 'queued')")
      .all() as Array<{ id: string; pid: number | null; provider: string; error: string | null }>;
    let changed = 0;
    for (const row of rows) {
      if (this.activeRuns.has(row.id)) continue; // owned by this process
      let note = "Interrupted by service restart";
      if (row.pid != null && isAlive(row.pid) && looksLikeProvider(row.pid, row.provider)) {
        const signalled = killProcessGroup(row.pid, "SIGTERM");
        note = signalled
          ? `Interrupted by service restart; orphaned process ${row.pid} was sent SIGTERM`
          : note;
        this.log({ event: "orphan_terminated", runId: row.id, pid: row.pid, signalled });
      }
      if (
        this.transition(row.id, ["running", "queued"], "interrupted", {
          finished_at: Date.now(),
          error: row.error ?? note,
        })
      ) {
        changed++;
      }
    }
    return changed;
  }

  // -------------------------------------------------------------- create --

  create(input: CreateRunInput): RunRecord {
    const settings = this.getSettings();
    const maxQueued = settings.limits.maxConcurrentRuns * QUEUE_DEPTH_FACTOR;
    const queued = (
      this.db.prepare("SELECT COUNT(*) c FROM runs WHERE status = 'queued'").get() as { c: number }
    ).c;
    if (queued >= maxQueued) {
      throw Object.assign(
        new Error(
          `Too many queued runs (${queued}); limit is ${maxQueued}. Wait for running work to finish.`,
        ),
        { statusCode: 429 },
      );
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const status = input.status ?? "queued";
    const promptSummary = redactSecrets(input.prompt.slice(0, 500));
    this.db
      .prepare(
        `INSERT INTO runs (id, created_at, origin, provider, model, effort, status, cwd, prompt_summary, skill_slug, routine_id, parent_run_id, session_id, attempts, timeout_ms, permission_profile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        now,
        input.origin,
        input.provider,
        input.model,
        input.effort,
        status,
        input.cwd,
        promptSummary,
        input.skillSlug ?? null,
        input.routineId ?? null,
        input.parentRunId ?? null,
        input.sessionId ?? null,
        input.attempts ?? 1,
        input.timeoutMs,
        input.profile,
      );
    const record = this.get(id);
    if (!record) throw new Error("run insert failed");
    events.emit("run.created", {
      runId: id,
      origin: input.origin,
      provider: input.provider,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    this.emit(id, {
      type: "text",
      ts: now,
      stream: "stdout",
      text: status === "waiting_approval" ? "[waiting for approval]" : "[queued]",
    });
    return record;
  }

  // ------------------------------------------------------------- execute --

  /**
   * Execute a queued run through its provider adapter. Resolves when the run
   * reaches a terminal state; never rejects. Concurrency-limited by settings.
   * The cancellation registry entry exists from this call on, before any
   * adapter code runs, so cancel() cannot miss the buildInvocation window.
   */
  execute(runId: string, prompt: string, mode: RunMode): Promise<RunRecord> {
    const record = this.get(runId);
    if (!record) return Promise.reject(new Error(`unknown run ${runId}`));
    const existing = this.activeRuns.get(runId);
    if (existing) return existing.promise;
    if (record.status !== "queued") {
      this.log({ event: "execute_ignored", runId, status: record.status });
      return Promise.resolve(record);
    }
    const active: ActiveRun = {
      controller: new AbortController(),
      pid: null,
      promise: Promise.resolve(record),
      shutdown: false,
      persistedEvents: 0,
    };
    this.activeRuns.set(runId, active);
    active.promise = this.run(runId, record, prompt, mode, active)
      .catch((err: Error) => {
        this.log({ event: "run_crashed", runId, error: redactSecrets(err.message) });
        return this.safeGet(runId) ?? { ...record, status: "failed" as RunStatus, error: err.message };
      })
      .finally(() => this.activeRuns.delete(runId));
    return active.promise;
  }

  private async run(
    runId: string,
    record: RunRecord,
    prompt: string,
    mode: RunMode,
    active: ActiveRun,
  ): Promise<RunRecord> {
    await this.acquireSlot();
    const startedAt = Date.now();
    const signal = active.controller.signal;
    try {
      if (this.shuttingDown) active.shutdown = true;
      if (this.shuttingDown || signal.aborted) {
        this.settle(runId, ["queued"], active.shutdown ? "interrupted" : "cancelled", {
          duration_ms: 0,
          error: active.shutdown ? "Interrupted by service shutdown" : "Cancelled before start",
        });
        return this.get(runId)!;
      }
      if (!this.transition(runId, ["queued"], "running", { started_at: startedAt })) {
        // Cancelled (or otherwise settled) from the DB side in the meantime.
        return this.get(runId)!;
      }
      this.log({ event: "run_started", runId, provider: record.provider, origin: record.origin });

      const adapter = this.getAdapter(record.provider);
      const artifactsDir = path.join(this.paths.artifacts, runId);
      fs.mkdirSync(artifactsDir, { recursive: true });
      // A run that continues a conversation hands the adapter the id the
      // provider itself uses; the first run of a session has none yet, so the
      // adapter starts (and names) a fresh provider conversation.
      const session = record.sessionId ? this.sessions.get(record.sessionId) : null;
      // A provider that cannot resume natively (cursor-agent; an old codex)
      // still keeps the thread: the earlier turns are folded into the prompt.
      let effectivePrompt = prompt;
      let resume = session?.providerSessionId ? { providerSessionId: session.providerSessionId } : null;
      let emulatedTurns = 0;
      if (record.sessionId && session) {
        const native =
          adapter.manifest.capabilities.resume !== "none" &&
          (adapter.supportsResume ? await adapter.supportsResume() : true);
        if (!native) {
          resume = null;
          const prior = this.list({ sessionId: record.sessionId, limit: 50 })
            .filter((r) => r.id !== runId && r.status === "done")
            .reverse();
          const turns = prior.map((r) => ({ prompt: r.promptSummary, reply: this.lastAssistantText(r.id) }));
          if (turns.length > 0) {
            effectivePrompt = emulatedPrompt(turns, prompt);
            emulatedTurns = turns.length;
          }
        }
      }
      const agentRun: AgentRun = {
        runId,
        prompt: effectivePrompt,
        cwd: record.cwd ?? this.paths.home,
        model: record.model,
        effort: record.effort,
        mode,
        timeoutMs: record.timeoutMs ?? this.getSettings().limits.defaultTimeoutMs,
        profile: record.permissionProfile ?? this.getSettings().securityProfile,
        artifactsDir,
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
        ...(resume ? { resume } : {}),
        ...(this.permissionBroker && mode === "write" ? brokerFor(this.permissionBroker, record) : {}),
        signal,
      };

      if (emulatedTurns > 0) {
        this.persistEvent(
          runId,
          {
            type: "text",
            ts: Date.now(),
            stream: "stderr",
            text: `[mordomo] session emulated: ${emulatedTurns} earlier turn(s) folded into the prompt (the provider cannot resume natively).`,
          },
          active,
        );
      }

      const filesChanged = new Set<string>();
      let resultEvent: Extract<RunEvent, { type: "result" }> | null = null;
      let errorEvent: Extract<RunEvent, { type: "error" }> | null = null;
      const usage = new UsageFolder();

      for await (const event of adapter.execute(agentRun)) {
        if (event.type === "started") {
          active.pid = event.pid;
          this.db.prepare("UPDATE runs SET pid = ? WHERE id = ?").run(event.pid, runId);
          events.emit("run.started", { runId, pid: event.pid });
        }
        if (event.type === "session" && record.sessionId) {
          // Last one wins: a resumed conversation may fork into a new id.
          this.sessions.captureProviderSessionId(record.sessionId, event.providerSessionId);
        }
        if (event.type === "usage") {
          usage.fold(event);
          // Live cost on the row so the list/badges update while the run is going.
          this.writeUsage(runId, usage.value());
        }
        this.persistEvent(runId, event, active);
        if (
          event.type === "tool_use" &&
          (adapter.manifest?.writeToolPattern ?? WRITE_TOOLS).test(event.tool)
        ) {
          const m = event.detail.match(/(?:^|[\s"'])(\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/);
          if (m?.[1]) filesChanged.add(m[1]);
        }
        if (event.type === "result") resultEvent = event;
        if (event.type === "error") errorEvent = event;
      }

      const artifacts = listFilesRecursive(artifactsDir).map((f) => path.join(runId, f));
      if (artifacts.length === 0) {
        try {
          fs.rmdirSync(artifactsDir);
        } catch {
          /* not empty or already gone */
        }
      }

      const durationMs = resultEvent?.durationMs ?? Date.now() - startedAt;
      const timedOut = resultEvent?.timedOut ?? false;

      // Final status comes from what actually happened to the process, never
      // from the cancel request alone: a process that exited 0 before the
      // SIGTERM landed is `done`.
      let status: RunStatus;
      let error: string | null = null;
      if (errorEvent) {
        status = "failed";
        error = errorEvent.message;
      } else if (timedOut) {
        status = "timed_out";
        error = `Timed out after ${agentRun.timeoutMs} ms. Increase the timeout or reduce the task scope.`;
      } else if (resultEvent?.cancelled) {
        status = active.shutdown ? "interrupted" : "cancelled";
        error = active.shutdown ? "Interrupted by service shutdown" : "Cancelled by user";
      } else if (resultEvent && resultEvent.exitCode === 0) {
        status = "done";
      } else {
        status = "failed";
        error = resultEvent
          ? `Provider exited with code ${resultEvent.exitCode}. Check the run events for the underlying message.`
          : "Provider produced no result event.";
      }

      this.settle(runId, ["running"], status, {
        exit_code: resultEvent?.exitCode ?? null,
        duration_ms: durationMs,
        error,
        artifacts_json: JSON.stringify(artifacts),
        files_changed_json: JSON.stringify([...filesChanged]),
        ...usagePatch(usage.value()),
      });
      if (record.sessionId) this.foldIntoSession(record.sessionId, runId, usage.value());
      this.emit(runId, {
        type: "result",
        ts: Date.now(),
        exitCode: resultEvent?.exitCode ?? null,
        summary: resultEvent?.summary ?? error ?? "",
        durationMs,
        timedOut,
        cancelled: resultEvent?.cancelled ?? false,
      });
      return this.get(runId)!;
    } catch (err) {
      const message = redactSecrets((err as Error).message);
      const status: RunStatus = signal.aborted ? (active.shutdown ? "interrupted" : "cancelled") : "failed";
      this.settle(runId, ["running", "queued"], status, {
        duration_ms: Date.now() - startedAt,
        error: message,
      });
      this.persistEvent(runId, { type: "error", ts: Date.now(), message }, active);
      return this.get(runId)!;
    } finally {
      this.releaseSlot();
    }
  }

  // ------------------------------------------------------------ sessions --

  /**
   * Move the conversation forward: one more turn, the run's tokens/cost added
   * to the session accumulators and `last_run_id`/`updated_at` refreshed.
   * Never fatal — a missing session must not fail an otherwise good run.
   */
  private foldIntoSession(sessionId: string, runId: string, usage: RunUsage | null): void {
    try {
      this.sessions.recordRun(sessionId, { runId, usage });
    } catch (err) {
      this.log({ event: "session_update_failed", runId, sessionId, error: (err as Error).message });
    }
  }

  // --------------------------------------------------------------- usage --

  /** Persist the folded usage on the run row (no status change). */
  private writeUsage(runId: string, usage: RunUsage | null): void {
    if (!usage) return;
    const patch = usagePatch(usage);
    const columns = Object.keys(patch);
    this.db
      .prepare(`UPDATE runs SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .run(...columns.map((c) => patch[c] ?? null), runId);
  }

  // ---------------------------------------------------------- transitions --

  /**
   * The only way a status changes. Applies `patch` together with the new status
   * in one UPDATE guarded by `status IN (from)`; returns false (and logs) when
   * the run was not in an allowed source state, so late writers lose.
   */
  private transition(
    runId: string,
    from: RunStatus[],
    to: RunStatus,
    patch: Record<string, string | number | null> = {},
  ): boolean {
    const columns = Object.keys(patch);
    const sets = ["status = ?", ...columns.map((c) => `${c} = ?`)].join(", ");
    const placeholders = from.map(() => "?").join(", ");
    const result = this.db
      .prepare(`UPDATE runs SET ${sets} WHERE id = ? AND status IN (${placeholders})`)
      .run(to, ...columns.map((c) => patch[c] ?? null), runId, ...from);
    if (result.changes === 0) {
      const current = this.safeGet(runId)?.status ?? "missing";
      this.log({ event: "transition_rejected", runId, from, to, current });
      return false;
    }
    return true;
  }

  /** Terminal transition: stamps finished_at, logs and announces on the bus. */
  private settle(
    runId: string,
    from: RunStatus[],
    to: RunStatus,
    patch: Record<string, string | number | null>,
  ): boolean {
    const ok = this.transition(runId, from, to, { finished_at: Date.now(), ...patch });
    if (ok) {
      const durationMs = typeof patch.duration_ms === "number" ? patch.duration_ms : null;
      this.log({
        event: "run_finished",
        runId,
        status: to,
        durationMs,
        exitCode: patch.exit_code ?? null,
        error: patch.error ?? null,
      });
      events.emit("run.finished", { runId, status: to, durationMs });
    }
    return ok;
  }

  // -------------------------------------------------------------- cancel --

  /**
   * Request cancellation. Returns true only when something was actually acted
   * on: a live run got its abort signal (the process group is terminated, or
   * the spawn is skipped if it had not happened yet), or a queued row was
   * settled as cancelled. False when the run is unknown, already finished, or
   * already being cancelled.
   */
  async cancel(runId: string, reason?: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (active) {
      if (active.controller.signal.aborted) return false;
      active.controller.abort({ reason: "user" });
      this.persistEvent(
        runId,
        { type: "permission", ts: Date.now(), detail: reason ?? "Cancellation requested by user" },
        active,
      );
      return true;
    }
    const record = this.get(runId);
    if (!record || (record.status !== "queued" && record.status !== "waiting_approval")) return false;
    // Created but execute() not yet called (a stale queued row, or a write run
    // whose approval was denied/expired).
    const summary =
      reason ??
      (record.status === "waiting_approval"
        ? "Cancelled while waiting for approval"
        : "Cancelled while queued");
    const ok = this.settle(runId, ["queued", "waiting_approval"], "cancelled", {
      duration_ms: 0,
      error: summary,
    });
    if (ok) {
      this.emit(runId, {
        type: "result",
        ts: Date.now(),
        exitCode: null,
        summary,
        durationMs: 0,
        timedOut: false,
        cancelled: true,
      });
    }
    return ok;
  }

  /**
   * Release a run created as `waiting_approval` (a human approved the gated
   * write). False when the row is gone or no longer waiting.
   */
  markApproved(runId: string): boolean {
    return this.transition(runId, ["waiting_approval"], "queued");
  }

  /**
   * Stop accepting work, cancel every active run (SIGTERM to the process
   * group, SIGKILL after `graceMs`), wait for their execute() promises and
   * leave them marked `interrupted`. Call before closing the database.
   */
  async shutdown(graceMs = 10_000): Promise<void> {
    this.shuttingDown = true;
    const entries = [...this.activeRuns.values()];
    for (const a of entries) {
      a.shutdown = true;
      if (!a.controller.signal.aborted) a.controller.abort({ reason: "shutdown", graceMs });
    }
    // Wake queued waiters so their run() settles as interrupted immediately.
    for (const wake of this.waiting.splice(0)) wake();
    const hardKill = setTimeout(() => {
      for (const a of entries) if (a.pid != null) killProcessGroup(a.pid, "SIGKILL");
    }, graceMs + 250);
    hardKill.unref();
    await Promise.allSettled(entries.map((a) => a.promise));
    clearTimeout(hardKill);
    this.log({ event: "shutdown", interrupted: entries.length, graceMs });
  }

  /** Ids of runs currently owned by this process (queued for a slot or running). */
  activeRunIds(): string[] {
    return [...this.activeRuns.keys()];
  }

  // -------------------------------------------------------------- events --

  private persistEvent(runId: string, event: RunEvent, active?: ActiveRun): void {
    const safe = JSON.parse(redactSecrets(JSON.stringify(event))) as RunEvent;
    const insert = this.db.prepare("INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, ?, ?)");
    if (active) {
      active.persistedEvents++;
      const streamy = safe.type === "text" || safe.type === "assistant" || safe.type === "tool_use";
      if (streamy && active.persistedEvents > this.eventCap) {
        if (active.persistedEvents === this.eventCap + 1) {
          insert.run(
            runId,
            safe.ts,
            "text",
            JSON.stringify({
              type: "text",
              ts: safe.ts,
              stream: "stderr",
              text: `[mordomo] event log capped at ${this.eventCap} events; further output is streamed live but not persisted.`,
            }),
          );
        }
        this.emit(runId, safe);
        return;
      }
    }
    const info = insert.run(runId, safe.ts, safe.type, JSON.stringify(safe));
    this.emit(runId, safe, Number(info.lastInsertRowid));
  }

  /**
   * Subscribe to one run's events. `eventId` is the `run_events` row id when
   * the event was persisted (undefined for live-only events such as
   * `[queued]`), so a listener can stream it without querying the database
   * and still dedupe against a `Last-Event-ID` replay.
   */
  /**
   * Record an event on a live run from outside the adapter stream (a brokered
   * permission prompt, an approval answer). Persisted and emitted like any
   * other event; ignored for runs that are not active.
   */
  annotate(runId: string, event: RunEvent): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    this.persistEvent(runId, event, active);
    return true;
  }

  onEvent(runId: string, listener: (event: RunEvent, eventId?: number) => void): () => void {
    const key = `run:${runId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  private emit(runId: string, event: RunEvent, eventId?: number): void {
    this.emitter.emit(`run:${runId}`, event, eventId);
    this.emitter.emit("run:*", { runId, event });
    events.emit("run.event", { runId, event });
  }

  onAny(listener: (payload: { runId: string; event: RunEvent }) => void): () => void {
    this.emitter.on("run:*", listener);
    return () => this.emitter.off("run:*", listener);
  }

  // ------------------------------------------------------------- queries --

  /** The last assistant message persisted for a run (null when none / capped away). */
  lastAssistantText(id: string): string | null {
    const row = this.db
      .prepare("SELECT data FROM run_events WHERE run_id = ? AND type = 'assistant' ORDER BY id DESC LIMIT 1")
      .get(id) as { data: string } | undefined;
    if (!row) return null;
    try {
      const ev = JSON.parse(row.data) as { text?: unknown };
      return typeof ev.text === "string" && ev.text.trim() ? ev.text : null;
    } catch {
      return null;
    }
  }

  get(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RawRun | undefined;
    return row ? fromRow(row) : null;
  }

  private safeGet(id: string): RunRecord | null {
    try {
      return this.get(id);
    } catch {
      return null;
    }
  }

  list(
    opts: {
      limit?: number;
      offset?: number;
      status?: RunStatus;
      origin?: RunOrigin;
      parentRunId?: string;
      /** Only the runs of one conversation (newest first, like every other listing). */
      sessionId?: string;
    } = {},
  ): RunRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts.origin) {
      clauses.push("origin = ?");
      params.push(opts.origin);
    }
    if (opts.parentRunId) {
      clauses.push("(parent_run_id = ? OR id = ?)");
      params.push(opts.parentRunId, opts.parentRunId);
    }
    if (opts.sessionId) {
      clauses.push("session_id = ?");
      params.push(opts.sessionId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit ?? 50, Math.max(0, opts.offset ?? 0)) as RawRun[];
    return rows.map(fromRow);
  }

  /** Total rows matching the same filters as `list()` (for pagination). */
  count(opts: { status?: RunStatus; origin?: RunOrigin } = {}): number {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.status) {
      clauses.push("status = ?");
      params.push(opts.status);
    }
    if (opts.origin) {
      clauses.push("origin = ?");
      params.push(opts.origin);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (this.db.prepare(`SELECT COUNT(*) c FROM runs ${where}`).get(...params) as { c: number }).c;
  }

  eventsFor(runId: string, afterId = 0): Array<{ id: number; event: RunEvent }> {
    const rows = this.db
      .prepare("SELECT id, data FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT 2000")
      .all(runId, afterId) as Array<{ id: number; data: string }>;
    return rows.map((r) => ({ id: r.id, event: JSON.parse(r.data) as RunEvent }));
  }

  metrics(): {
    total: number;
    last7d: number;
    successRate: number | null;
    avgDurationMs: number | null;
    byProvider: Array<{ provider: string; count: number; success: number }>;
    running: number;
    failedRecent: number;
    cost: CostMetrics;
    usageSeries: UsageSeriesPoint[];
  } {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const total = (this.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
    const last7d = (
      this.db.prepare("SELECT COUNT(*) c FROM runs WHERE created_at > ?").get(weekAgo) as { c: number }
    ).c;
    const finished = this.db
      .prepare(
        "SELECT COUNT(*) c, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) ok, AVG(duration_ms) avg FROM runs WHERE status IN ('done','failed','cancelled','timed_out') AND created_at > ?",
      )
      .get(weekAgo) as { c: number; ok: number | null; avg: number | null };
    const byProvider = this.db
      .prepare(
        "SELECT provider, COUNT(*) count, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) success FROM runs WHERE created_at > ? GROUP BY provider",
      )
      .all(weekAgo) as Array<{ provider: string; count: number; success: number }>;
    const running = (
      this.db.prepare("SELECT COUNT(*) c FROM runs WHERE status IN ('running','queued')").get() as {
        c: number;
      }
    ).c;
    const failedRecent = (
      this.db
        .prepare("SELECT COUNT(*) c FROM runs WHERE status IN ('failed','timed_out') AND created_at > ?")
        .get(Date.now() - 86_400_000) as { c: number }
    ).c;
    return {
      total,
      last7d,
      successRate: finished.c > 0 ? (finished.ok ?? 0) / finished.c : null,
      avgDurationMs: finished.avg,
      byProvider,
      running,
      failedRecent,
      cost: this.costMetrics(),
      usageSeries: this.usageSeries(),
    };
  }

  /** Spend/token aggregates; every value is 0 when no provider reported usage. */
  costMetrics(now = Date.now()): CostMetrics {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const sum = (sql: string, ...params: unknown[]) =>
      this.db.prepare(sql).get(...params) as { usd: number | null; tokens: number | null };
    const today = sum(
      "SELECT SUM(cost_usd) usd, SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0) + COALESCE(cache_read_tokens,0) + COALESCE(cache_write_tokens,0)) tokens FROM runs WHERE created_at >= ?",
      midnight.getTime(),
    );
    const week = sum(
      "SELECT SUM(cost_usd) usd, 0 tokens FROM runs WHERE created_at >= ?",
      now - 7 * 86_400_000,
    );
    const hour = sum(
      "SELECT SUM(cost_usd) usd, 0 tokens FROM runs WHERE COALESCE(finished_at, started_at, created_at) >= ?",
      now - 3_600_000,
    );
    return {
      todayUsd: round6(today.usd ?? 0),
      weekUsd: round6(week.usd ?? 0),
      tokensToday: today.tokens ?? 0,
      burnRatePerHour: round6(hour.usd ?? 0),
    };
  }

  /** Last 24 hourly buckets of tokens/cost (oldest first; empty hours are zero). */
  usageSeries(now = Date.now(), hours = 24): UsageSeriesPoint[] {
    const bucketMs = 3_600_000;
    const start = Math.floor(now / bucketMs) * bucketMs - (hours - 1) * bucketMs;
    const rows = this.db
      .prepare(
        "SELECT created_at ts, COALESCE(input_tokens,0) + COALESCE(output_tokens,0) + COALESCE(cache_read_tokens,0) + COALESCE(cache_write_tokens,0) tokens, COALESCE(cost_usd,0) usd FROM runs WHERE created_at >= ? AND (input_tokens IS NOT NULL OR cost_usd IS NOT NULL)",
      )
      .all(start) as Array<{ ts: number; tokens: number; usd: number }>;
    const series: UsageSeriesPoint[] = Array.from({ length: hours }, (_, i) => ({
      ts: start + i * bucketMs,
      tokens: 0,
      usd: 0,
    }));
    for (const row of rows) {
      const idx = Math.floor((row.ts - start) / bucketMs);
      const point = series[idx];
      if (!point) continue;
      point.tokens += row.tokens;
      point.usd = round6(point.usd + row.usd);
    }
    return series;
  }

  // --------------------------------------------------------- concurrency --

  /**
   * Take a slot. The limit is re-read on every attempt, so a waiter woken
   * after `limits.maxConcurrentRuns` was lowered goes back to waiting instead
   * of running over the new limit. Shutdown always wins, otherwise the
   * waiters it wakes could never settle.
   */
  private async acquireSlot(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.shuttingDown || this.active < this.getSettings().limits.maxConcurrentRuns) {
        this.active++;
        return;
      }
      await new Promise<void>((resolve) => {
        // A retry keeps its place at the head of the queue (still FIFO).
        if (attempt === 0) this.waiting.push(resolve);
        else this.waiting.unshift(resolve);
      });
    }
  }

  /** Free a slot; wake one waiter only if the CURRENT limit has room for it. */
  private releaseSlot(): void {
    this.active = Math.max(0, this.active - 1);
    let max = Number.POSITIVE_INFINITY;
    try {
      max = this.getSettings().limits.maxConcurrentRuns;
    } catch {
      /* unreadable settings must not stall the queue */
    }
    if (this.active < max) this.waiting.shift()?.();
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Guard against pid reuse before signalling an orphan: on Linux the command
 * line must mention a provider binary (or node, which hosts the CLIs). Where
 * /proc is unavailable we trust the recorded pid.
 */
function looksLikeProvider(pid: number, provider: string): boolean {
  if (process.platform !== "linux") return true;
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    return [provider, "claude", "cursor-agent", "codex", "node"].some((n) => cmdline.includes(n));
  } catch {
    return true;
  }
}

interface RawRun {
  id: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  origin: string;
  provider: string;
  model: string | null;
  effort: string;
  status: string;
  exit_code: number | null;
  duration_ms: number | null;
  cwd: string | null;
  prompt_summary: string;
  skill_slug: string | null;
  routine_id: string | null;
  parent_run_id: string | null;
  session_id?: string | null;
  pid: number | null;
  error: string | null;
  artifacts_json: string;
  files_changed_json: string;
  attempts: number;
  timeout_ms: number | null;
  permission_profile: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  cost_usd?: number | null;
  usage_model?: string | null;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Folds `usage` events into one figure: `total` snapshots replace the sum of
 * previous `turn` events (Claude reports both per-message usage and a final
 * total; Codex reports a total per turn). Exported for tests.
 */
export class UsageFolder {
  private turns: RunUsage | null = null;
  private total: RunUsage | null = null;

  fold(event: RunUsageEvent): void {
    const piece: RunUsage = {
      inputTokens: num(event.inputTokens),
      outputTokens: num(event.outputTokens),
      ...(event.cacheReadTokens != null ? { cacheReadTokens: num(event.cacheReadTokens) } : {}),
      ...(event.cacheWriteTokens != null ? { cacheWriteTokens: num(event.cacheWriteTokens) } : {}),
      ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
      ...(event.model ? { model: event.model } : {}),
    };
    if (event.scope === "total") {
      this.total = piece;
      return;
    }
    const prev = this.turns;
    this.turns = prev
      ? {
          inputTokens: prev.inputTokens + piece.inputTokens,
          outputTokens: prev.outputTokens + piece.outputTokens,
          ...(prev.cacheReadTokens != null || piece.cacheReadTokens != null
            ? { cacheReadTokens: (prev.cacheReadTokens ?? 0) + (piece.cacheReadTokens ?? 0) }
            : {}),
          ...(prev.cacheWriteTokens != null || piece.cacheWriteTokens != null
            ? { cacheWriteTokens: (prev.cacheWriteTokens ?? 0) + (piece.cacheWriteTokens ?? 0) }
            : {}),
          ...(prev.costUsd != null || piece.costUsd != null
            ? { costUsd: round6((prev.costUsd ?? 0) + (piece.costUsd ?? 0)) }
            : piece.costUsd === null || prev.costUsd === null
              ? { costUsd: null }
              : {}),
          ...((piece.model ?? prev.model) ? { model: piece.model ?? prev.model } : {}),
        }
      : piece;
  }

  value(): RunUsage | null {
    if (!this.total) return this.turns;
    // A total without a model still benefits from the model seen on turns.
    if (!this.total.model && this.turns?.model) return { ...this.total, model: this.turns.model };
    return this.total;
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Row patch for the usage columns (all null when usage is null). */
function usagePatch(usage: RunUsage | null): Record<string, number | string | null> {
  return {
    input_tokens: usage ? usage.inputTokens : null,
    output_tokens: usage ? usage.outputTokens : null,
    cache_read_tokens: usage?.cacheReadTokens ?? null,
    cache_write_tokens: usage?.cacheWriteTokens ?? null,
    cost_usd: usage?.costUsd ?? null,
    usage_model: usage?.model ?? null,
  };
}

function usageFromRow(row: RawRun): RunUsage | null {
  if (row.input_tokens == null && row.output_tokens == null && row.cost_usd == null) return null;
  return {
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    ...(row.cache_read_tokens != null ? { cacheReadTokens: row.cache_read_tokens } : {}),
    ...(row.cache_write_tokens != null ? { cacheWriteTokens: row.cache_write_tokens } : {}),
    costUsd: row.cost_usd ?? null,
    ...(row.usage_model ? { model: row.usage_model } : {}),
  };
}

function fromRow(row: RawRun): RunRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    origin: row.origin as RunOrigin,
    provider: row.provider as ProviderId,
    model: row.model,
    effort: row.effort as EffortLevel,
    status: row.status as RunStatus,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    cwd: row.cwd,
    promptSummary: row.prompt_summary,
    skillSlug: row.skill_slug,
    routineId: row.routine_id,
    parentRunId: row.parent_run_id ?? null,
    sessionId: row.session_id ?? null,
    pid: row.pid ?? null,
    error: row.error,
    artifacts: JSON.parse(row.artifacts_json) as string[],
    filesChanged: JSON.parse(row.files_changed_json) as string[],
    attempts: row.attempts,
    timeoutMs: row.timeout_ms,
    permissionProfile: row.permission_profile as SecurityProfile | null,
    usage: usageFromRow(row),
  };
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, "");
  return out;
}

function brokerFor(
  factory: PermissionBrokerFactory,
  record: RunRecord,
): { permissionBroker?: PermissionBroker } {
  try {
    const broker = factory(record);
    return broker ? { permissionBroker: broker } : {};
  } catch {
    return {};
  }
}

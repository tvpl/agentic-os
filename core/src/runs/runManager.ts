import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings, ProviderId, EffortLevel, SecurityProfile } from "../config/schema.js";
import type { AgentAdapter, AgentRun, RunEvent, RunMode } from "../agents/types.js";
import { JsonlLogger } from "../logs/jsonl.js";
import { redactSecrets } from "../security/redact.js";
import { killProcessGroup } from "../spawn/safeSpawn.js";
import { events } from "../events.js";

export type RunOrigin = "manual" | "skill" | "routine" | "api";
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "done"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

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
  pid: number | null;
  error: string | null;
  artifacts: string[];
  filesChanged: string[];
  attempts: number;
  timeoutMs: number | null;
  permissionProfile: SecurityProfile | null;
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
  attempts?: number;
}

export interface PruneOptions {
  /** Delete events older than this many days (default: settings.limits.logRetentionDays). */
  keepDays?: number;
  /** Max events kept per run: the first 500 plus the most recent ones (default 5000). */
  keepEvents?: number;
}

export interface PruneResult {
  eventsExpired: number;
  eventsCapped: number;
  runsCapped: number;
}

/** Events kept per run (first HEAD_KEEP + tail). Applied live and on prune(). */
const DEFAULT_EVENT_CAP = 5000;
const HEAD_KEEP = 500;
/** Queue depth allowed before create() refuses with 429 = maxConcurrentRuns * this. */
const QUEUE_DEPTH_FACTOR = 10;

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
export class RunManager {
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
    opts: { eventCap?: number; pruneOnBoot?: boolean } = {},
  ) {
    const s = getSettings();
    this.logger = new JsonlLogger(
      paths.logs,
      "runs",
      s.limits.logMaxFileBytes,
      s.limits.logRetentionDays,
    );
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

  /** Expire old events and cap events per run. Called on construction; safe to call anytime. */
  prune(opts: PruneOptions = {}): PruneResult {
    const keepDays = opts.keepDays ?? this.getSettings().limits.logRetentionDays;
    const keepEvents = Math.max(opts.keepEvents ?? this.eventCap, HEAD_KEEP + 1);
    const cutoff = Date.now() - keepDays * 86_400_000;
    const eventsExpired = this.db
      .prepare(
        "DELETE FROM run_events WHERE ts < ? AND run_id NOT IN (SELECT id FROM runs WHERE status IN ('queued','running'))",
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
        this.db
          .prepare("INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, ?, ?)")
          .run(
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
    const result = { eventsExpired, eventsCapped, runsCapped: heavy.length };
    if (eventsExpired || eventsCapped) this.log({ event: "pruned", ...result, keepDays, keepEvents });
    return result;
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
        new Error(`Too many queued runs (${queued}); limit is ${maxQueued}. Wait for running work to finish.`),
        { statusCode: 429 },
      );
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const promptSummary = redactSecrets(input.prompt.slice(0, 500));
    this.db
      .prepare(
        `INSERT INTO runs (id, created_at, origin, provider, model, effort, status, cwd, prompt_summary, skill_slug, routine_id, parent_run_id, attempts, timeout_ms, permission_profile)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        now,
        input.origin,
        input.provider,
        input.model,
        input.effort,
        input.cwd,
        promptSummary,
        input.skillSlug ?? null,
        input.routineId ?? null,
        input.parentRunId ?? null,
        input.attempts ?? 1,
        input.timeoutMs,
        input.profile,
      );
    const record = this.get(id);
    if (!record) throw new Error("run insert failed");
    events.emit("run.created", { runId: id, origin: input.origin, provider: input.provider });
    this.emit(id, { type: "text", ts: now, stream: "stdout", text: "[queued]" });
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
      const agentRun: AgentRun = {
        runId,
        prompt,
        cwd: record.cwd ?? this.paths.home,
        model: record.model,
        effort: record.effort,
        mode,
        timeoutMs: record.timeoutMs ?? this.getSettings().limits.defaultTimeoutMs,
        profile: record.permissionProfile ?? this.getSettings().securityProfile,
        artifactsDir,
        signal,
      };

      const filesChanged = new Set<string>();
      let resultEvent: Extract<RunEvent, { type: "result" }> | null = null;
      let errorEvent: Extract<RunEvent, { type: "error" }> | null = null;

      for await (const event of adapter.execute(agentRun)) {
        if (event.type === "started") {
          active.pid = event.pid;
          this.db.prepare("UPDATE runs SET pid = ? WHERE id = ?").run(event.pid, runId);
          events.emit("run.started", { runId, pid: event.pid });
        }
        this.persistEvent(runId, event, active);
        if (event.type === "tool_use" && WRITE_TOOLS.test(event.tool)) {
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
      });
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
  async cancel(runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (active) {
      if (active.controller.signal.aborted) return false;
      active.controller.abort({ reason: "user" });
      this.persistEvent(runId, { type: "permission", ts: Date.now(), detail: "Cancellation requested by user" }, active);
      return true;
    }
    const record = this.get(runId);
    if (!record || record.status !== "queued") return false;
    // Created but execute() not yet called (or a stale queued row).
    const ok = this.settle(runId, ["queued"], "cancelled", { duration_ms: 0, error: "Cancelled while queued" });
    if (ok) {
      this.emit(runId, {
        type: "result",
        ts: Date.now(),
        exitCode: null,
        summary: "Cancelled while queued",
        durationMs: 0,
        timedOut: false,
        cancelled: true,
      });
    }
    return ok;
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
    insert.run(runId, safe.ts, safe.type, JSON.stringify(safe));
    this.emit(runId, safe);
  }

  onEvent(runId: string, listener: (event: RunEvent) => void): () => void {
    const key = `run:${runId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }

  private emit(runId: string, event: RunEvent): void {
    this.emitter.emit(`run:${runId}`, event);
    this.emitter.emit("run:*", { runId, event });
    events.emit("run.event", { runId, event });
  }

  onAny(listener: (payload: { runId: string; event: RunEvent }) => void): () => void {
    this.emitter.on("run:*", listener);
    return () => this.emitter.off("run:*", listener);
  }

  // ------------------------------------------------------------- queries --

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

  list(opts: { limit?: number; status?: RunStatus; origin?: RunOrigin; parentRunId?: string } = {}): RunRecord[] {
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
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, opts.limit ?? 50) as RawRun[];
    return rows.map(fromRow);
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
      this.db.prepare("SELECT COUNT(*) c FROM runs WHERE status IN ('running','queued')").get() as { c: number }
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
    };
  }

  // --------------------------------------------------------- concurrency --

  private acquireSlot(): Promise<void> {
    const max = this.getSettings().limits.maxConcurrentRuns;
    if (this.active < max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
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
  pid: number | null;
  error: string | null;
  artifacts_json: string;
  files_changed_json: string;
  attempts: number;
  timeout_ms: number | null;
  permission_profile: string | null;
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
    pid: row.pid ?? null,
    error: row.error,
    artifacts: JSON.parse(row.artifacts_json) as string[],
    filesChanged: JSON.parse(row.files_changed_json) as string[],
    attempts: row.attempts,
    timeoutMs: row.timeout_ms,
    permissionProfile: row.permission_profile as SecurityProfile | null,
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

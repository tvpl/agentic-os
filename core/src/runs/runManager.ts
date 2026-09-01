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

export type RunOrigin = "manual" | "skill" | "routine" | "api";
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "done"
  | "failed"
  | "cancelled"
  | "interrupted";

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
  attempts?: number;
}

const WRITE_TOOLS = /^(write|edit|multiedit|notebookedit|create_file|apply_patch|str_replace)/i;

export class RunManager {
  private readonly events = new EventEmitter();
  private readonly logger: JsonlLogger;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly cancelRequested = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly paths: MordomoPaths,
    private readonly getSettings: () => Settings,
    private readonly getAdapter: (id: ProviderId) => AgentAdapter,
  ) {
    const s = getSettings();
    this.logger = new JsonlLogger(
      paths.logs,
      "runs",
      s.limits.logMaxFileBytes,
      s.limits.logRetentionDays,
    );
    this.events.setMaxListeners(100);
  }

  /** Mark runs orphaned by a crash/restart, so history stays truthful. */
  recoverInterrupted(): number {
    const result = this.db
      .prepare(
        "UPDATE runs SET status = 'interrupted', finished_at = ?, error = COALESCE(error, 'Interrupted by service restart') WHERE status IN ('running', 'queued')",
      )
      .run(Date.now());
    return result.changes;
  }

  create(input: CreateRunInput): RunRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    const promptSummary = redactSecrets(input.prompt.slice(0, 500));
    this.db
      .prepare(
        `INSERT INTO runs (id, created_at, origin, provider, model, effort, status, cwd, prompt_summary, skill_slug, routine_id, attempts, timeout_ms, permission_profile)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
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
        input.attempts ?? 1,
        input.timeoutMs,
        input.profile,
      );
    const record = this.get(id);
    if (!record) throw new Error("run insert failed");
    this.emit(id, { type: "text", ts: now, stream: "stdout", text: "[queued]" });
    return record;
  }

  /**
   * Execute a queued run through its provider adapter. Resolves when the run
   * reaches a terminal state. Concurrency-limited by settings.
   */
  async execute(runId: string, prompt: string, mode: RunMode): Promise<RunRecord> {
    const record = this.get(runId);
    if (!record) throw new Error(`unknown run ${runId}`);
    await this.acquireSlot();
    const startedAt = Date.now();
    try {
      if (this.cancelRequested.has(runId)) {
        this.finish(runId, "cancelled", null, Date.now() - startedAt, "Cancelled before start");
        return this.get(runId)!;
      }
      this.db
        .prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?")
        .run(startedAt, runId);
      this.logger.append({ event: "run_started", runId, provider: record.provider, origin: record.origin });

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
      };

      const filesChanged = new Set<string>();
      let resultEvent: Extract<RunEvent, { type: "result" }> | null = null;
      let errorEvent: Extract<RunEvent, { type: "error" }> | null = null;

      for await (const event of adapter.execute(agentRun)) {
        this.persistEvent(runId, event);
        if (event.type === "tool_use" && WRITE_TOOLS.test(event.tool)) {
          const m = event.detail.match(/(?:^|[\s"'])(\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/);
          if (m?.[1]) filesChanged.add(m[1]);
        }
        if (event.type === "result") resultEvent = event;
        if (event.type === "error") errorEvent = event;
      }

      const artifacts = listFilesRecursive(artifactsDir).map((f) => path.join(runId, f));
      if (artifacts.length === 0) {
        // No artifacts produced: remove the empty per-run dir to keep artifacts/ clean.
        try {
          fs.rmdirSync(artifactsDir);
        } catch {
          /* not empty or already gone */
        }
      }

      const durationMs = resultEvent?.durationMs ?? Date.now() - startedAt;
      const cancelled = this.cancelRequested.has(runId);
      const timedOut = resultEvent?.timedOut ?? false;

      let status: RunStatus;
      let error: string | null = null;
      if (errorEvent) {
        status = "failed";
        error = errorEvent.message;
      } else if (cancelled) {
        status = "cancelled";
        error = "Cancelled by user";
      } else if (timedOut) {
        status = "failed";
        error = `Timed out after ${agentRun.timeoutMs} ms. Increase the timeout or reduce the task scope.`;
      } else if (resultEvent && resultEvent.exitCode === 0) {
        status = "done";
      } else {
        status = "failed";
        error = resultEvent
          ? `Provider exited with code ${resultEvent.exitCode}. Check the run events for the underlying message.`
          : "Provider produced no result event.";
      }

      this.db
        .prepare(
          `UPDATE runs SET status = ?, finished_at = ?, exit_code = ?, duration_ms = ?, error = ?, artifacts_json = ?, files_changed_json = ? WHERE id = ?`,
        )
        .run(
          status,
          Date.now(),
          resultEvent?.exitCode ?? null,
          durationMs,
          error,
          JSON.stringify(artifacts),
          JSON.stringify([...filesChanged]),
          runId,
        );
      this.logger.append({ event: "run_finished", runId, status, durationMs, exitCode: resultEvent?.exitCode ?? null });
      this.emit(runId, {
        type: "result",
        ts: Date.now(),
        exitCode: resultEvent?.exitCode ?? null,
        summary: resultEvent?.summary ?? error ?? "",
        durationMs,
        timedOut,
      });
      return this.get(runId)!;
    } catch (err) {
      const message = redactSecrets((err as Error).message);
      this.finish(runId, "failed", null, Date.now() - startedAt, message);
      this.persistEvent(runId, { type: "error", ts: Date.now(), message });
      return this.get(runId)!;
    } finally {
      this.cancelRequested.delete(runId);
      this.releaseSlot();
    }
  }

  private finish(
    runId: string,
    status: RunStatus,
    exitCode: number | null,
    durationMs: number,
    error: string | null,
  ): void {
    this.db
      .prepare(
        "UPDATE runs SET status = ?, finished_at = ?, exit_code = ?, duration_ms = ?, error = ? WHERE id = ?",
      )
      .run(status, Date.now(), exitCode, durationMs, error, runId);
    this.logger.append({ event: "run_finished", runId, status, durationMs, error });
  }

  async cancel(runId: string): Promise<boolean> {
    const record = this.get(runId);
    if (!record) return false;
    this.cancelRequested.add(runId);
    if (record.status === "queued") {
      this.finish(runId, "cancelled", null, 0, "Cancelled while queued");
      this.emit(runId, { type: "error", ts: Date.now(), message: "Cancelled while queued" });
      return true;
    }
    if (record.status !== "running") return false;
    const adapter = this.getAdapter(record.provider);
    await adapter.cancel(runId);
    this.persistEvent(runId, { type: "permission", ts: Date.now(), detail: "Cancellation requested by user" });
    return true;
  }

  private persistEvent(runId: string, event: RunEvent): void {
    const safe = JSON.parse(redactSecrets(JSON.stringify(event))) as RunEvent;
    this.db
      .prepare("INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, ?, ?)")
      .run(runId, safe.ts, safe.type, JSON.stringify(safe));
    this.emit(runId, safe);
  }

  onEvent(runId: string, listener: (event: RunEvent) => void): () => void {
    const key = `run:${runId}`;
    this.events.on(key, listener);
    return () => this.events.off(key, listener);
  }

  private emit(runId: string, event: RunEvent): void {
    this.events.emit(`run:${runId}`, event);
    this.events.emit("run:*", { runId, event });
  }

  onAny(listener: (payload: { runId: string; event: RunEvent }) => void): () => void {
    this.events.on("run:*", listener);
    return () => this.events.off("run:*", listener);
  }

  get(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RawRun | undefined;
    return row ? fromRow(row) : null;
  }

  list(opts: { limit?: number; status?: RunStatus; origin?: RunOrigin } = {}): RunRecord[] {
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
        "SELECT COUNT(*) c, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) ok, AVG(duration_ms) avg FROM runs WHERE status IN ('done','failed','cancelled') AND created_at > ?",
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
        .prepare("SELECT COUNT(*) c FROM runs WHERE status = 'failed' AND created_at > ?")
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

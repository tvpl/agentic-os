import crypto from "node:crypto";
import type { Db } from "../db/db.js";
import type { ProviderId, SecurityProfile } from "../config/schema.js";
import type { RunUsage } from "../agents/types.js";
import { redactSecrets } from "../security/redact.js";
import { events } from "../events.js";

/**
 * Conversations (Onda 1).
 *
 * A session is the MordomoOS side of a provider conversation: it remembers
 * which provider it belongs to, where it runs, and — once the first run tells
 * us — the id the CLI itself uses (`claude --resume <id>`,
 * `codex exec resume <id>`). Runs point at it through `runs.session_id`; the
 * RunManager keeps the counters in step as each run finishes.
 *
 * The store never spawns anything and never reads provider credentials; it is
 * pure SQLite plus two bus announcements (`session.created`, `session.updated`).
 */

export interface SessionRecord {
  id: string;
  provider: ProviderId;
  /** Id the provider CLI resumes; null until the first run of the session reports one. */
  providerSessionId: string | null;
  cwd: string | null;
  profile: SecurityProfile | null;
  /** Short, redacted label (the first prompt of the conversation). */
  title: string;
  createdAt: number;
  updatedAt: number;
  lastRunId: string | null;
  /** Finished runs folded into this conversation. */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** One row of `GET /api/sessions`: the session plus a summary of its last run. */
export interface SessionSummary extends SessionRecord {
  runCount: number;
  lastRun: LastRunSummary | null;
}

export interface LastRunSummary {
  id: string;
  status: string;
  createdAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  model: string | null;
  promptSummary: string;
}

export interface CreateSessionInput {
  provider: ProviderId;
  cwd: string | null;
  profile: SecurityProfile | null;
  /** Free text (usually the first prompt); truncated and redacted before it is stored. */
  title: string;
  /** Only set when the caller already knows the provider-side id (rare). */
  providerSessionId?: string | null;
}

/** How a finished run moves a session forward. */
export interface RecordRunInput {
  runId: string;
  usage?: RunUsage | null;
  /** Defaults to now. */
  at?: number;
}

const TITLE_MAX = 160;

export class SessionStore {
  constructor(private readonly db: Db) {}

  create(input: CreateSessionInput): SessionRecord {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, provider, provider_session_id, cwd, profile, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.provider,
        input.providerSessionId ?? null,
        input.cwd,
        input.profile,
        sessionTitle(input.title),
        now,
        now,
      );
    const record = this.get(id);
    if (!record) throw new Error("session insert failed");
    events.emit("session.created", { sessionId: id, provider: record.provider, title: record.title });
    return record;
  }

  get(id: string): SessionRecord | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as RawSession | undefined;
    return row ? fromRow(row) : null;
  }

  /** Newest first (by last activity), each with its run count and last run. */
  list(opts: { limit?: number; offset?: number; provider?: ProviderId } = {}): SessionSummary[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.provider) {
      clauses.push("provider = ?");
      params.push(opts.provider);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM sessions ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit ?? 50, Math.max(0, opts.offset ?? 0)) as RawSession[];
    const counts = this.db.prepare("SELECT COUNT(*) c FROM runs WHERE session_id = ?");
    const lastRun = this.db.prepare(
      `SELECT id, status, created_at, finished_at, duration_ms, model, prompt_summary
       FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
    );
    return rows.map((row) => {
      const record = fromRow(row);
      const raw = lastRun.get(row.id) as RawLastRun | undefined;
      return {
        ...record,
        runCount: (counts.get(row.id) as { c: number }).c,
        lastRun: raw
          ? {
              id: raw.id,
              status: raw.status,
              createdAt: raw.created_at,
              finishedAt: raw.finished_at,
              durationMs: raw.duration_ms,
              model: raw.model,
              promptSummary: raw.prompt_summary,
            }
          : null,
      };
    });
  }

  count(opts: { provider?: ProviderId } = {}): number {
    const where = opts.provider ? "WHERE provider = ?" : "";
    const params = opts.provider ? [opts.provider] : [];
    return (this.db.prepare(`SELECT COUNT(*) c FROM sessions ${where}`).get(...params) as { c: number }).c;
  }

  /**
   * Record the provider-side conversation id reported by a run. Called for
   * every `session` event, so a resumed conversation that forks into a new
   * provider session ends up pointing at the newest id. No-op (returns false)
   * when nothing changed or the session is gone.
   */
  captureProviderSessionId(id: string, providerSessionId: string): boolean {
    const changed = this.db
      .prepare(
        "UPDATE sessions SET provider_session_id = ?, updated_at = ? WHERE id = ? AND COALESCE(provider_session_id, '') <> ?",
      )
      .run(providerSessionId, Date.now(), id, providerSessionId).changes;
    if (changed === 0) return false;
    events.emit("session.updated", { sessionId: id, providerSessionId });
    return true;
  }

  /**
   * Fold a finished run into the session: one more turn, its tokens and cost
   * added to the accumulators, `last_run_id`/`updated_at` refreshed.
   */
  recordRun(id: string, input: RecordRunInput): SessionRecord | null {
    const at = input.at ?? Date.now();
    const usage = input.usage ?? null;
    const changed = this.db
      .prepare(
        `UPDATE sessions
            SET turns = turns + 1,
                last_run_id = ?,
                updated_at = ?,
                input_tokens = input_tokens + ?,
                output_tokens = output_tokens + ?,
                cost_usd = cost_usd + ?
          WHERE id = ?`,
      )
      .run(
        input.runId,
        at,
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        usage?.costUsd ?? 0,
        id,
      ).changes;
    if (changed === 0) return null;
    const record = this.get(id);
    if (record) {
      events.emit("session.updated", {
        sessionId: id,
        lastRunId: record.lastRunId,
        turns: record.turns,
        costUsd: record.costUsd,
      });
    }
    return record;
  }

  /** Rename a conversation (title is redacted and truncated like on create). */
  rename(id: string, title: string): boolean {
    const changed = this.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(sessionTitle(title), Date.now(), id).changes;
    if (changed > 0) events.emit("session.updated", { sessionId: id, title: sessionTitle(title) });
    return changed > 0;
  }

  /**
   * Forget a conversation. The runs it grouped are kept (history stays
   * auditable); only their `session_id` link is cleared.
   */
  delete(id: string): { deleted: boolean; runsKept: number } {
    const runsKept = this.db
      .prepare("UPDATE runs SET session_id = NULL WHERE session_id = ?")
      .run(id).changes;
    const deleted = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
    if (deleted) events.emit("session.updated", { sessionId: id, deleted: true, runsKept });
    return { deleted, runsKept };
  }
}

/** A prompt makes a title: redacted, single line, bounded. */
export function sessionTitle(raw: string): string {
  const text = redactSecrets(raw).replace(/\s+/g, " ").trim();
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

interface RawSession {
  id: string;
  provider: string;
  provider_session_id: string | null;
  cwd: string | null;
  profile: string | null;
  title: string;
  created_at: number;
  updated_at: number;
  last_run_id: string | null;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface RawLastRun {
  id: string;
  status: string;
  created_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  model: string | null;
  prompt_summary: string;
}

function fromRow(row: RawSession): SessionRecord {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    providerSessionId: row.provider_session_id,
    cwd: row.cwd,
    profile: (row.profile as SecurityProfile | null) ?? null,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunId: row.last_run_id,
    turns: row.turns,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Math.round((row.cost_usd ?? 0) * 1e6) / 1e6,
  };
}

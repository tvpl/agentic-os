import type { Db } from "../db/db.js";
import { emitSentinel, sentinelDedupeKey, type DedupeLookup, type SentinelFiredPayload } from "./types.js";
import type { EventBus } from "../events.js";

/**
 * "This keeps breaking" — the same skill (or the same kind of prompt) failing
 * again and again inside a window. Cheap: one indexed query over the runs
 * table when a run finishes badly, no LLM.
 *
 * The finding is worth triaging (`triage: true`): what a human wants is not
 * "it failed twice" but "it failed twice because the folder moved".
 */

const FAILED_STATUSES = new Set(["failed", "timed_out"]);

/** Just enough of a run to group failures. */
export interface FailureRun {
  id: string;
  skillSlug: string | null;
  promptSummary: string;
  createdAt: number;
}

/** How many words of a free prompt make up its identity. */
const PROMPT_HEAD_WORDS = 6;

/**
 * What "the same failure" means: the skill slug when there is one, otherwise
 * the head of the prompt summary (lowercased, punctuation dropped). Two ad-hoc
 * prompts that start the same way are the same recurring intent.
 */
export function failureKey(run: Pick<FailureRun, "skillSlug" | "promptSummary">): string {
  if (run.skillSlug) return `skill:${run.skillSlug}`;
  const head = run.promptSummary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, PROMPT_HEAD_WORDS)
    .join(" ");
  return `prompt:${head}`;
}

/** Human label for a key (what the inbox row says failed). */
export function failureLabel(run: Pick<FailureRun, "skillSlug" | "promptSummary">): string {
  return run.skillSlug ?? run.promptSummary.slice(0, 80);
}

export interface RepeatedFailureOptions {
  /** Failures needed inside the window (default 2). */
  threshold?: number;
  now?: number;
}

/**
 * Pure rule: given the failures of the window and the run that just failed,
 * decide whether to fire. Returns null when the group is still below the
 * threshold. Dedupe is per day and per key, so a bad afternoon produces one
 * row, not forty.
 */
export function repeatedFailureAlert(
  trigger: Pick<FailureRun, "skillSlug" | "promptSummary">,
  windowFailures: readonly FailureRun[],
  opts: RepeatedFailureOptions = {},
): SentinelFiredPayload | null {
  const threshold = Math.max(2, opts.threshold ?? 2);
  const key = failureKey(trigger);
  const matching = windowFailures.filter((r) => failureKey(r) === key);
  if (matching.length < threshold) return null;
  const label = failureLabel(trigger);
  return {
    sentinel: "repeatedFailure",
    title: `${label} failed ${matching.length} times`,
    body: `The same work failed ${matching.length} times in the last 24 hours. The last attempt was ${label}.`,
    severity: "warn",
    href: "/runs?status=failed",
    dedupeKey: sentinelDedupeKey("repeatedFailure", key, opts.now),
    triage: true,
  };
}

/** Failed/timed-out runs created since `since` (newest first). */
export function recentFailures(db: Db, since: number, limit = 200): FailureRun[] {
  const rows = db
    .prepare(
      `SELECT id, skill_slug, prompt_summary, created_at FROM runs
       WHERE status IN ('failed','timed_out') AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(since, limit) as Array<{
    id: string;
    skill_slug: string | null;
    prompt_summary: string;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    skillSlug: r.skill_slug,
    promptSummary: r.prompt_summary,
    createdAt: r.created_at,
  }));
}

export interface RepeatedFailureDeps {
  db: Db;
  bus: EventBus;
  /** The inbox, so a key already written today is not written again. */
  dedupe?: DedupeLookup;
  threshold?: number;
  windowHours?: number;
  now?: () => number;
}

/**
 * React to one `run.finished` event. Returns the payload it emitted, or null.
 * Safe to call for every finished run: successes leave immediately.
 */
export function checkRepeatedFailure(
  deps: RepeatedFailureDeps,
  event: { runId?: unknown; status?: unknown },
): SentinelFiredPayload | null {
  const status = typeof event.status === "string" ? event.status : "";
  const runId = typeof event.runId === "string" ? event.runId : null;
  if (!runId || !FAILED_STATUSES.has(status)) return null;
  const now = deps.now?.() ?? Date.now();
  const windowMs = Math.max(1, deps.windowHours ?? 24) * 3_600_000;
  const failures = recentFailures(deps.db, now - windowMs);
  const trigger = failures.find((r) => r.id === runId);
  if (!trigger) return null; // the row is gone (pruned) — nothing to say
  const payload = repeatedFailureAlert(trigger, failures, { threshold: deps.threshold, now });
  if (!payload) return null;
  if (payload.dedupeKey && deps.dedupe?.hasDedupeKey(payload.dedupeKey)) return null;
  return emitSentinel(deps.bus, payload);
}

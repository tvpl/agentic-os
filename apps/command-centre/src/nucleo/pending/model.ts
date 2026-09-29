/**
 * Pendências (immersive shell): everything the agentic system is waiting on
 * the human for, in one list and one order. The conversation never shows an
 * approval box; the hub in the top-left corner counts these, and a click
 * turns the whole OS toward resolving them (the focus mode).
 *
 * Pure: the hook gathers the inputs, this decides what is pending, how
 * loud it is and in what order.
 */
import type { ApprovalRecord, ProviderSnapshot, RoutineStatus, RunRecord } from "../../api";
import type { NotificationItem } from "../../hooks/useNotifications";
import type { ProviderProblem } from "../../components/providerReadiness";
import { isQuestion } from "../question";

export type PendingKind = "question" | "decision" | "provider" | "budget" | "failure" | "routine" | "notice";
/**
 * `decide`: only you can unblock it (an approval, a budget already over).
 * `fix`: something is broken and has a known way out.
 * `look`: worth a look, nothing is stuck.
 * `info`: an unread notice; listed, never counted.
 */
export type PendingLevel = "decide" | "fix" | "look" | "info";

export interface PendingItem {
  /** Stable across refetches: `<kind>:<source id>`. */
  id: string;
  kind: PendingKind;
  level: PendingLevel;
  /** When it started waiting, for ordering and "há 3 min". */
  at: number;
  approval?: ApprovalRecord;
  run?: RunRecord;
  routine?: RoutineStatus;
  provider?: { snapshot: ProviderSnapshot; problem: Exclude<ProviderProblem, null> };
  budget?: { tone: "warn" | "over"; ratio: number };
  notice?: NotificationItem;
  /**
   * The same cause said again, folded into this item: a routine's failed
   * runs, or notices with this one's title. Resolving this item resolves them.
   */
  also?: PendingItem[];
  /** How many notices this row stands for (itself included), when more than one. */
  count?: number;
}

export interface PendingInput {
  approvals?: readonly ApprovalRecord[];
  runs?: readonly RunRecord[];
  routines?: readonly RoutineStatus[];
  /** The default provider and its problem, when it has one. */
  provider?: { snapshot: ProviderSnapshot; problem: ProviderProblem } | null;
  budget?: { tone: string; ratio: number };
  notifications?: readonly NotificationItem[];
  /** Failures the user silenced (attentionMute). */
  muted?: ReadonlySet<string>;
  now: number;
}

/** A failure younger than this asks for a look; older is history. */
export const FRESH_MS = 24 * 60 * 60 * 1000;

const RANK: Record<PendingLevel, number> = { decide: 0, fix: 1, look: 2, info: 3 };

export function buildPending(input: PendingInput): PendingItem[] {
  const out: PendingItem[] = [];
  const covered = new Set<string>();
  for (const a of input.approvals ?? []) {
    if (a.status !== "pending") continue;
    // A question the agent asked is its own kind: answered, never approved blind.
    const kind = isQuestion(a) ? "question" : "decision";
    out.push({ id: `${kind}:${a.id}`, kind, level: "decide", at: a.createdAt, approval: a });
    covered.add(a.id);
    const runId = typeof a.payload?.runId === "string" ? a.payload.runId : null;
    if (runId) covered.add(runId);
  }
  const p = input.provider;
  if (p && p.problem && p.problem !== "unverified")
    out.push({
      id: `provider:${p.snapshot.id}`,
      kind: "provider",
      level: "fix",
      at: input.now,
      provider: { snapshot: p.snapshot, problem: p.problem },
    });
  if (input.budget && (input.budget.tone === "over" || input.budget.tone === "warn"))
    out.push({
      id: `budget:${input.budget.tone}`,
      kind: "budget",
      level: input.budget.tone === "over" ? "decide" : "look",
      at: input.now,
      budget: { tone: input.budget.tone, ratio: input.budget.ratio },
    });
  const muted = input.muted ?? new Set<string>();
  // An unhealthy routine is the cause; its failed runs are that cause again.
  const routines = new Map<string, PendingItem>();
  for (const r of input.routines ?? []) {
    if (r.healthy || !r.enabled) continue;
    routines.set(r.id, {
      id: `routine:${r.id}`,
      kind: "routine",
      level: "fix",
      at: r.lastFiredAt ?? input.now,
      routine: r,
    });
  }
  for (const r of input.runs ?? []) {
    if (r.status !== "failed" && r.status !== "timed_out") continue;
    if (muted.has(r.id) || covered.has(r.id)) continue;
    const at = r.finishedAt ?? r.createdAt;
    if (input.now - at > FRESH_MS) continue;
    const failure: PendingItem = { id: `failure:${r.id}`, kind: "failure", level: "fix", at, run: r };
    covered.add(r.id);
    const routine = r.routineId ? routines.get(r.routineId) : undefined;
    if (routine) (routine.also ??= []).push(failure);
    else out.push(failure);
  }
  for (const item of routines.values()) {
    item.also?.sort((a, b) => b.at - a.at);
    out.push(item);
  }
  const byTitle = new Map<string, PendingItem>();
  const notices = [...(input.notifications ?? [])].sort((a, b) => b.ts - a.ts);
  for (const n of notices) {
    if (n.read) continue;
    // A notice about something already listed says it twice.
    if ((n.approvalId && covered.has(n.approvalId)) || (n.runId && covered.has(n.runId))) continue;
    // An approval's notice is about the decision: once the decision is no
    // longer pending (resolved elsewhere, or expired), it is history — and
    // before the decision is listed, the decision is what will say it.
    if (n.kind === "approval" && n.approvalId && input.approvals) continue;
    // A loud notice asks for a look while it is fresh; after a day it is history.
    const loud = (n.tone === "danger" || n.tone === "warn") && input.now - n.ts <= FRESH_MS;
    const item: PendingItem = {
      id: `notice:${n.id}`,
      kind: "notice",
      level: loud ? "look" : "info",
      at: n.ts,
      notice: n,
    };
    // The same title again is the same cause: one row, "×N".
    const first = byTitle.get(n.title);
    if (first) {
      (first.also ??= []).push(item);
      first.count = (first.count ?? 1) + 1;
      if (RANK[item.level] < RANK[first.level]) first.level = item.level;
      continue;
    }
    byTitle.set(n.title, item);
    out.push(item);
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level] || b.at - a.at);
}

/** What the hub counts: everything but plain notices. */
export function pendingCount(items: readonly PendingItem[]): number {
  return items.filter((i) => i.level !== "info").length;
}

/** The loudest level present, for the hub's colour; `null` when all is quiet. */
export function loudest(items: readonly PendingItem[]): PendingLevel | null {
  let best: PendingLevel | null = null;
  for (const i of items) if (best === null || RANK[i.level] < RANK[best]) best = i.level;
  return best;
}

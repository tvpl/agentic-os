import type { Db } from "../db/db.js";
import type { EventBus, OsEvent } from "../events.js";
import type { Settings } from "../config/schema.js";
import type { CreateRunInput, RunRecord } from "../runs/runManager.js";
import type { NotificationInput } from "../notifications/store.js";
import type { SentinelFiredPayload } from "./types.js";

/**
 * Triage (Onda 2, item 2).
 *
 * A sentinel is deliberately dumb: it says "the same skill failed twice", not
 * "your credentials expired". Triage is the one place where a *small* amount
 * of model time is spent turning a finding into a decision — a cheap model, a
 * read-only profile, a 90-second timeout and a hard daily budget, because a
 * proactive OS that quietly spends money is worse than one that says nothing.
 *
 * The run is asked for strict JSON:
 *   {"action":"ignore"|"notify"|"propose","summary":"…","proposal":"…"}
 * `ignore` writes nothing at all. `notify` and `propose` become one inbox row
 * that links back to the triage run, so the reasoning is inspectable.
 */

export type TriageAction = "ignore" | "notify" | "propose";

export interface TriageDecision {
  action: TriageAction;
  summary: string;
  proposal: string;
}

export interface TriageOutcome {
  /** Why nothing happened, or null when a run was launched. */
  skipped:
    null | "disabled" | "not_requested" | "budget_exhausted" | "provider_unavailable" | "launch_failed";
  runId: string | null;
  decision: TriageDecision | null;
  notificationId: string | null;
}

/** Just the slice of the RunManager triage needs (the real one satisfies it). */
export interface TriageRunner {
  create(input: CreateRunInput): RunRecord;
  execute(runId: string, prompt: string, mode: "read_only" | "write"): Promise<RunRecord>;
  lastAssistantText(id: string): string | null;
}

/** Just the slice of the inbox triage needs. */
export interface TriageInbox {
  add(input: NotificationInput): { id: string };
}

export interface TriageDeps {
  db: Db;
  bus: EventBus;
  runs: TriageRunner;
  notifications: TriageInbox;
  getSettings: () => Settings;
  /** Working directory of the triage run (the MordomoOS home). */
  cwd: string;
  now?: () => number;
  onError?: (err: unknown) => void;
}

const MAX_TEXT = 600;

/** Spend of today's triage runs in USD (runs table, origin "sentinel"). */
export function triageSpendToday(db: Db, now = Date.now()): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const row = db
    .prepare("SELECT SUM(cost_usd) usd FROM runs WHERE origin = 'sentinel' AND created_at >= ?")
    .get(midnight.getTime()) as { usd: number | null };
  return Math.round((row.usd ?? 0) * 1e6) / 1e6;
}

/** The question put to the cheap model. Strict, short, and answer-only. */
export function buildTriagePrompt(payload: SentinelFiredPayload): string {
  return [
    'You are the triage step of a local agentic OS. An observer (a "sentinel") noticed something.',
    "Decide what the human should see. Do not run any tool, do not read files, do not write anything.",
    "",
    `Sentinel: ${payload.sentinel}`,
    `Severity: ${payload.severity}`,
    `Title: ${payload.title}`,
    `Detail: ${payload.body}`,
    "",
    "Answer with STRICT JSON and nothing else, on one line:",
    '{"action":"ignore"|"notify"|"propose","summary":"one sentence","proposal":"one concrete next step, or empty"}',
    "",
    'Use "ignore" when this is routine noise, "notify" when a human should know,',
    '"propose" when there is a concrete action worth suggesting.',
  ].join("\n");
}

/**
 * Parse the model's answer. Tolerates a fenced block or prose around the JSON
 * (models add both); anything that is not a usable decision returns null, and
 * a null decision writes nothing.
 */
export function parseTriageDecision(text: string | null | undefined): TriageDecision | null {
  if (!text) return null;
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let m = fenced.exec(text); m; m = fenced.exec(text)) if (m[1]) candidates.push(m[1]);
  const braced = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (braced.startsWith("{")) candidates.push(braced);
  candidates.push(text);
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.trim());
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    const action = typeof obj.action === "string" ? obj.action.toLowerCase().trim() : "";
    if (action !== "ignore" && action !== "notify" && action !== "propose") continue;
    return {
      action,
      summary: clamp(obj.summary),
      proposal: clamp(obj.proposal),
    };
  }
  return null;
}

function clamp(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** The inbox row a decision produces (null for `ignore`). */
export function triageNotification(
  payload: SentinelFiredPayload,
  decision: TriageDecision,
  runId: string,
): NotificationInput | null {
  if (decision.action === "ignore") return null;
  const body = decision.proposal
    ? `${decision.summary || payload.body} → ${decision.proposal}`
    : decision.summary || payload.body;
  return {
    kind: "system",
    tone: decision.action === "propose" ? "warn" : "info",
    title: payload.title,
    body,
    href: `/runs/${runId}`,
    runId,
    dedupeKey: payload.dedupeKey ? `triage:${payload.dedupeKey}` : null,
  };
}

/**
 * Run triage for one finding. Never throws: every failure path resolves with
 * a `skipped` reason so the caller (a bus listener) stays quiet.
 */
export async function triageSentinel(
  deps: TriageDeps,
  payload: SentinelFiredPayload,
): Promise<TriageOutcome> {
  const none = (skipped: TriageOutcome["skipped"]): TriageOutcome => ({
    skipped,
    runId: null,
    decision: null,
    notificationId: null,
  });
  if (payload.triage !== true) return none("not_requested");
  const settings = deps.getSettings();
  const triage = settings.sentinels.triage;
  if (!triage.enabled || !(triage.dailyBudgetUsd > 0)) return none("disabled");
  const now = deps.now?.() ?? Date.now();
  if (triageSpendToday(deps.db, now) >= triage.dailyBudgetUsd) return none("budget_exhausted");
  const provider = settings.defaultProvider;
  if (!settings.providers[provider]?.enabled) return none("provider_unavailable");

  const prompt = buildTriagePrompt(payload);
  let run: RunRecord;
  try {
    run = deps.runs.create({
      origin: "sentinel",
      provider,
      prompt,
      cwd: deps.cwd,
      model: triage.model || null,
      effort: "low",
      mode: "read_only",
      timeoutMs: triage.timeoutMs,
      profile: "read_only",
    });
  } catch (err) {
    deps.onError?.(err);
    return none("launch_failed");
  }
  try {
    await deps.runs.execute(run.id, prompt, "read_only");
  } catch (err) {
    deps.onError?.(err);
  }
  const decision = parseTriageDecision(deps.runs.lastAssistantText(run.id));
  if (!decision) return { skipped: null, runId: run.id, decision: null, notificationId: null };
  const input = triageNotification(payload, decision, run.id);
  if (!input) return { skipped: null, runId: run.id, decision, notificationId: null };
  try {
    const row = deps.notifications.add(input);
    return { skipped: null, runId: run.id, decision, notificationId: row.id };
  } catch (err) {
    deps.onError?.(err);
    return { skipped: null, runId: run.id, decision, notificationId: null };
  }
}

/**
 * Subscribe triage to the bus. Returns the unsubscribe function; findings
 * without `triage: true` cost nothing (the listener leaves at once).
 */
export function installSentinelTriage(deps: TriageDeps): () => void {
  return deps.bus.subscribe((event: OsEvent) => {
    if (event.type !== "sentinel.fired") return;
    const payload = event.payload as SentinelFiredPayload;
    if (!payload || payload.triage !== true) return;
    void triageSentinel(deps, payload).catch((err: unknown) => deps.onError?.(err));
  });
}

/**
 * A run's trace as a chain of steps (Runs scene): what it did, in the
 * order it did it, in plain words — started, read a file, ran a command,
 * said something, hit an error, finished. Built from the run's events with
 * the same sentences the console narrates (`humanizeEvent`), repeats folded
 * into one step with a count, the failing step marked with its error, and a
 * long trace compacted to what matters: the start, the failure, the end.
 */
import type { TKey } from "../../i18n";
import { humanizeEvent, type Translate } from "../../runs/humanize";
import { isRunActive, isRunFailed } from "../../runs/status";
import type { RunEventView } from "../../runs/useRunStream";

export type StepTone = "ok" | "fail" | "run" | "skip" | "warn";

export interface TraceStep {
  key: string;
  /** The sentence ("ran", "read", "hit an error"), translated. */
  text: string;
  /** What it was about (a path, a command, a quote). */
  subject: string | null;
  tone: StepTone;
  ts: number;
  durationMs: number | null;
  /** The same sentence about the same thing, this many times in a row. */
  count: number;
  error: string | null;
}

/** The run fields the chain needs. */
export interface TraceRun {
  status: string;
  error: string | null;
  failure?: { message?: string } | null;
  createdAt: number;
  startedAt?: number | null;
}

const STARTED: TKey = "scene.runs.step.started";
const QUEUED: TKey = "scene.runs.step.queued";
const WORKING: TKey = "scene.runs.step.working";
const WAITING: TKey = "scene.runs.step.waiting";
const STOPPED: TKey = "scene.runs.step.stopped";

export function extractSteps(
  events: readonly RunEventView[],
  run: TraceRun,
  t: Translate,
  cwd?: string | null,
): TraceStep[] {
  const steps: TraceStep[] = [];
  const byCall = new Map<string, TraceStep>();
  const push = (s: Omit<TraceStep, "key" | "count">) => {
    const last = steps[steps.length - 1];
    if (last && last.text === s.text && last.subject === s.subject && last.tone === s.tone && !s.error) {
      last.count += 1;
      if (s.durationMs != null) last.durationMs = (last.durationMs ?? 0) + s.durationMs;
      return last;
    }
    const step: TraceStep = { ...s, key: `s${steps.length}`, count: 1 };
    steps.push(step);
    return step;
  };

  for (const e of events) {
    switch (e.type) {
      case "started":
        push({ text: t(STARTED), subject: null, tone: "ok", ts: e.ts, durationMs: null, error: null });
        break;
      case "tool_use": {
        const tool = String(e.tool ?? "");
        const callId = typeof e.callId === "string" ? e.callId : null;
        const outcome = e.outcome;
        // The end of a call we already have: its time and how it went.
        if (e.phase === "end" && callId && byCall.has(callId)) {
          const step = byCall.get(callId)!;
          if (typeof e.durationMs === "number") step.durationMs = e.durationMs;
          if (outcome === "error" || outcome === "denied") step.tone = "warn";
          break;
        }
        // A tool's result only matters when it went wrong, and then it belongs to the call before it.
        if (tool.toLowerCase() === "tool_result") {
          if (outcome === "error") {
            const prev = steps[steps.length - 1];
            if (prev && prev.tone === "ok") prev.tone = "warn";
          }
          break;
        }
        const h = humanizeEvent(e, t, cwd);
        if (!h || h.tone === "muted") break;
        const step = push({
          text: h.text,
          subject: h.subject,
          tone: outcome === "error" || outcome === "denied" ? "warn" : "ok",
          ts: e.ts,
          durationMs: typeof e.durationMs === "number" ? e.durationMs : null,
          error: null,
        });
        if (callId) byCall.set(callId, step);
        break;
      }
      case "assistant":
      case "permission": {
        const h = humanizeEvent(e, t, cwd);
        if (!h) break;
        push({
          text: h.text,
          subject: h.subject,
          tone: h.tone === "warn" ? "warn" : "ok",
          ts: e.ts,
          durationMs: null,
          error: null,
        });
        break;
      }
      case "error": {
        const message = typeof e.message === "string" ? e.message : null;
        push({
          text: t("trace.error"),
          subject: null,
          tone: "fail",
          ts: e.ts,
          durationMs: null,
          error: message,
        });
        break;
      }
      case "result": {
        if (e.cancelled) {
          push({ text: t(STOPPED), subject: null, tone: "skip", ts: e.ts, durationMs: null, error: null });
          break;
        }
        const h = humanizeEvent(e, t, cwd);
        if (!h) break;
        push({
          text: h.text,
          subject: null,
          tone: h.tone === "danger" ? "fail" : "ok",
          ts: e.ts,
          // The result's duration is the whole run's, already in the header.
          durationMs: null,
          error: null,
        });
        break;
      }
      default:
        break;
    }
  }

  const start = run.startedAt ?? run.createdAt;
  if (steps.length === 0 && run.status === "queued") {
    steps.push({
      key: "queued",
      text: t(QUEUED),
      subject: null,
      tone: "run",
      ts: run.createdAt,
      durationMs: null,
      count: 1,
      error: null,
    });
    return steps;
  }
  if (steps.length === 0) {
    steps.push({
      key: "s0",
      text: t(STARTED),
      subject: null,
      tone: "ok",
      ts: start,
      durationMs: null,
      count: 1,
      error: null,
    });
  }

  if (isRunActive(run.status)) {
    const waiting = run.status === "waiting_approval";
    steps.push({
      key: "now",
      text: t(waiting ? WAITING : WORKING),
      subject: null,
      tone: waiting ? "warn" : "run",
      ts: Date.now(),
      durationMs: null,
      count: 1,
      error: null,
    });
    return steps;
  }

  if (isRunFailed(run.status)) {
    const message = run.failure?.message ?? run.error ?? null;
    let failing = steps.find((s) => s.tone === "fail");
    if (!failing) {
      failing = steps[steps.length - 1]!;
      failing.tone = "fail";
    }
    if (!failing.error && message) failing.error = message;
  }
  return steps;
}

/** A run of steps folded out of a long chain. */
export interface StepGap {
  key: string;
  gap: number;
}

export type ChainItem = TraceStep | StepGap;
export const isGap = (x: ChainItem): x is StepGap => "gap" in x;

/**
 * At most `max` steps: always the first, the failing one with a neighbour
 * each side, and the latest; what is left out becomes "… n steps …".
 */
export function compactSteps(steps: readonly TraceStep[], max = 7): ChainItem[] {
  if (steps.length <= max) return [...steps];
  const keep = new Set<number>([0, steps.length - 1]);
  const fail = steps.findIndex((s) => s.tone === "fail");
  if (fail >= 0) for (const i of [fail - 1, fail, fail + 1]) if (i >= 0 && i < steps.length) keep.add(i);
  for (let i = steps.length - 2; keep.size < max && i > 0; i--) keep.add(i);
  const out: ChainItem[] = [];
  let skipped = 0;
  steps.forEach((s, i) => {
    if (keep.has(i)) {
      if (skipped) out.push({ key: `gap${i}`, gap: skipped });
      skipped = 0;
      out.push(s);
    } else skipped += 1;
  });
  return out;
}

/** The last thing the run said in its result — the answer, for a finished run. */
export function resultSummary(events: readonly RunEventView[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "result" && typeof e.summary === "string" && e.summary.trim()) return e.summary.trim();
  }
  return null;
}

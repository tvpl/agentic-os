/**
 * The signal contract (redesign F1, `docs/plans/desktop-agentico-redesign.md`;
 * refined by `docs/plans/desktop-jarvis-refino.md` items 21 and 30).
 *
 * A widget answers two questions with two different renderers. The *signal* is
 * the permanent one: an icon, one number and a level. It never scrolls and
 * never clips, so it has to fit in a glyph — which is only possible if the
 * widget decides, in one place, what "worth looking at" means.
 *
 * Two rules make the desktop quiet:
 *
 * - **`idle` never lights up.** Only `warn` and `critical` earn colour.
 * - **Signal has a half-life.** A failure older than `ATTENTION_FRESH_MS` is
 *   listed, never lit; `critical` is reserved for what only a human can
 *   resolve (an approval, a budget that is already over). Twenty failures
 *   from last week must not paint the HUD red today.
 *
 * Labels are i18n keys, not sentences: the tooltip a pod shows must follow the
 * UI language. `withLabel` resolves them; every derivation below stays pure so
 * the desktop, the tests and the surfaces share one definition of severity.
 */
import type { TKey, TVars } from "../i18n";
import { budgetState } from "./budget";

export type SignalLevel = "idle" | "info" | "warn" | "critical";

export interface SignalValue {
  level: SignalLevel;
  /**
   * One number or glyph — never a sentence. Rendered at ~10 px inside the
   * pod, so anything longer than ~5 characters is a surface, not a signal.
   */
  value: string;
  /** Read by assistive tech and the tooltip; resolved by `withLabel`. */
  labelKey: TKey;
  labelVars?: TVars;
}

/** A signal with its label resolved for the current language. */
export type LabelledSignal = SignalValue & { label: string };

export function withLabel<S extends SignalValue>(
  signal: S,
  t: (key: TKey, vars?: TVars) => string,
): S & { label: string } {
  return { ...signal, label: t(signal.labelKey, signal.labelVars) };
}

/** Only `warn` and above take colour; everything below stays muted. */
const RANK: Record<SignalLevel, number> = { idle: 0, info: 1, warn: 2, critical: 3 };

/** `true` when the signal must be drawn with colour rather than muted. */
export function isLit(level: SignalLevel): boolean {
  return RANK[level] >= RANK.warn;
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/**
 * Success rate over the sampled window. Below half the runs failing is a
 * warning; below a quarter the desktop is telling the user something is
 * broken. A window with no runs is idle, not perfect.
 */
export function pulseSignal(succeeded: number, total: number): SignalValue {
  if (total <= 0) return { level: "idle", value: "—", labelKey: "desktop.signal.pulse.none" };
  const ratio = Math.max(0, Math.min(1, succeeded / total));
  const level: SignalLevel = ratio < 0.25 ? "critical" : ratio < 0.5 ? "warn" : "info";
  return {
    level,
    value: pct(ratio),
    labelKey: "desktop.signal.pulse.rate",
    labelVars: { ok: succeeded, total },
  };
}

/** A failure younger than this still asks for a look; older ones are history. */
export const ATTENTION_FRESH_MS = 24 * 60 * 60 * 1000;

/** `true` when a run that finished (or was created) at `ts` still counts as fresh. */
export function isFreshFailure(ts: number | null | undefined, now: number): boolean {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
  return now - ts < ATTENTION_FRESH_MS;
}

export interface AttentionInput {
  /** Failed or timed-out runs younger than `ATTENTION_FRESH_MS`. */
  failures: number;
  /** Failed or timed-out runs older than that: listed, never lit. */
  staleFailures?: number;
  unhealthyRoutines: number;
  /** Decisions only a human can take: pending approvals. */
  approvals: number;
  /** Budget past 80 % — a warning. */
  budgetHot: boolean;
  /** Budget at or past 100 % — runs are blocked until a human raises it. */
  budgetOver?: boolean;
}

const count = (n: number | undefined) => Math.max(0, Math.floor(n ?? 0));

/**
 * What "needs attention" counts as, in one place. The strip and the widget
 * read the same definition, so the strip can never say 3 while the panel
 * lists 2 — the kind of disagreement that teaches users to distrust a HUD.
 *
 * Runs in progress are deliberately absent: attention means failure, approval
 * or an unhealthy routine, never "something is happening". Stale failures are
 * absent too: they are on the list, not on the counter.
 */
export function attentionItems(input: AttentionInput): number {
  return (
    count(input.failures) +
    count(input.unhealthyRoutines) +
    count(input.approvals) +
    (input.budgetHot || input.budgetOver ? 1 : 0)
  );
}

/** The part of the count only a human can clear: approvals and an exhausted budget. */
export function attentionHuman(input: AttentionInput): number {
  return count(input.approvals) + (input.budgetOver ? 1 : 0);
}

/**
 * Items that need a look are `warn`; items that need a *decision* are
 * `critical`; a desk whose only failures are older than a day is `idle` and
 * says so, so the pod goes dark instead of counting history.
 */
export function attentionSignal(input: AttentionInput | number): SignalValue & { count: number } {
  const source: AttentionInput =
    typeof input === "number"
      ? { failures: input, unhealthyRoutines: 0, approvals: 0, budgetHot: false }
      : input;
  const n = attentionItems(source);
  const human = attentionHuman(source);
  const stale = count(source.staleFailures);
  if (n === 0) {
    return stale > 0
      ? {
          level: "idle",
          value: "0",
          count: 0,
          labelKey: "desktop.signal.attention.stale",
          labelVars: { n: stale },
        }
      : { level: "idle", value: "0", count: 0, labelKey: "desktop.signal.attention.none" };
  }
  return {
    level: human > 0 ? "critical" : "warn",
    value: String(n),
    count: n,
    labelKey: human > 0 ? "desktop.signal.attention.decide" : "desktop.signal.attention.items",
    labelVars: { n, human },
  };
}

/** Reuses the existing budget rule so the strip and the widget cannot disagree. */
export function costSignal(
  budgetUsd: number | undefined,
  spentUsd: number | undefined,
  /** Money formatter for the label; defaults to two plain decimals. */
  money: (usd: number) => string = (n) => n.toFixed(2),
): SignalValue {
  const state = budgetState(budgetUsd, spentUsd);
  if (state.tone === "off") return { level: "idle", value: "—", labelKey: "desktop.signal.cost.none" };
  const level: SignalLevel = state.tone === "over" ? "critical" : state.tone === "warn" ? "warn" : "info";
  return {
    level,
    value: pct(state.ratio),
    labelKey: "desktop.signal.cost.spent",
    labelVars: { spent: money(state.spentUsd), budget: money(state.budgetUsd) },
  };
}

/** Work in flight is information, never an alarm: the user started it. */
export function runsSignal(active: number): SignalValue {
  const n = count(active);
  return n === 0
    ? { level: "idle", value: "0", labelKey: "desktop.signal.runs.none" }
    : { level: "info", value: String(n), labelKey: "desktop.signal.runs.active", labelVars: { n } };
}

/** A routine that was due and did not fire is the only interesting case. */
export function routinesSignal(fired: number, due: number): SignalValue {
  const total = count(due);
  const ok = Math.max(0, Math.min(total, Math.floor(fired)));
  if (total === 0) return { level: "idle", value: "0/0", labelKey: "desktop.signal.routines.none" };
  const missed = total - ok;
  return {
    level: missed === 0 ? "info" : missed >= total ? "critical" : "warn",
    value: `${ok}/${total}`,
    labelKey: "desktop.signal.routines.fired",
    labelVars: { ok, total },
  };
}

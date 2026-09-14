/**
 * The signal contract (redesign F1, `docs/plans/desktop-agentico-redesign.md`).
 *
 * A widget answers two questions with two different renderers. The *signal* is
 * the permanent one: an icon, one number and a level. It never scrolls and
 * never clips, so it has to fit in a glyph — which is only possible if the
 * widget decides, in one place, what "worth looking at" means.
 *
 * The rule that makes the desktop quiet: **`idle` never lights up.** Today the
 * clock and a 23 %-success pulse glow the same; with this, only `warn` and
 * `critical` earn colour. Every derivation below is pure so the desktop, the
 * tests and (later) the surfaces share one definition of severity.
 */
import { budgetState } from "./budget";

export type SignalLevel = "idle" | "info" | "warn" | "critical";

export interface SignalValue {
  level: SignalLevel;
  /**
   * One number or glyph — never a sentence. Rendered at ~10 px inside the
   * pod, so anything longer than ~5 characters is a surface, not a signal.
   */
  value: string;
  /** Read by assistive tech and the tooltip; not drawn while idle. */
  label: string;
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
  if (total <= 0) return { level: "idle", value: "—", label: "no runs yet" };
  const ratio = Math.max(0, Math.min(1, succeeded / total));
  const level: SignalLevel = ratio < 0.25 ? "critical" : ratio < 0.5 ? "warn" : "info";
  return { level, value: pct(ratio), label: `${succeeded} of ${total} runs succeeded` };
}

/**
 * What "needs attention" counts as, in one place. The strip and the widget
 * read the same definition, so the strip can never say 3 while the panel
 * lists 2 — the kind of disagreement that teaches users to distrust a HUD.
 *
 * Runs in progress are deliberately absent: attention means failure, approval
 * or an unhealthy routine, never "something is happening".
 */
export function attentionItems(input: {
  failures: number;
  unhealthyRoutines: number;
  approvals: number;
  budgetHot: boolean;
}): number {
  return (
    Math.max(0, Math.floor(input.failures)) +
    Math.max(0, Math.floor(input.unhealthyRoutines)) +
    Math.max(0, Math.floor(input.approvals)) +
    (input.budgetHot ? 1 : 0)
  );
}

/** Items that need a decision. Any of them is worth colour; five is worth alarm. */
export function attentionSignal(count: number): SignalValue {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return { level: "idle", value: "0", label: "nothing needs attention" };
  return {
    level: n >= 5 ? "critical" : "warn",
    value: String(n),
    label: `${n} item${n === 1 ? "" : "s"} need a decision`,
  };
}

/** Reuses the existing budget rule so the strip and the widget cannot disagree. */
export function costSignal(budgetUsd: number | undefined, spentUsd: number | undefined): SignalValue {
  const state = budgetState(budgetUsd, spentUsd);
  if (state.tone === "off") return { level: "idle", value: "—", label: "no daily budget set" };
  const level: SignalLevel = state.tone === "over" ? "critical" : state.tone === "warn" ? "warn" : "info";
  return {
    level,
    value: pct(state.ratio),
    label: `${state.spentUsd.toFixed(2)} of ${state.budgetUsd.toFixed(2)} USD today`,
  };
}

/** Work in flight is information, never an alarm: the user started it. */
export function runsSignal(active: number): SignalValue {
  const n = Math.max(0, Math.floor(active));
  return n === 0
    ? { level: "idle", value: "0", label: "nothing running" }
    : { level: "info", value: String(n), label: `${n} run${n === 1 ? "" : "s"} in flight` };
}

/** A routine that was due and did not fire is the only interesting case. */
export function routinesSignal(fired: number, due: number): SignalValue {
  const total = Math.max(0, Math.floor(due));
  const ok = Math.max(0, Math.min(total, Math.floor(fired)));
  if (total === 0) return { level: "idle", value: "0/0", label: "no routines due today" };
  const missed = total - ok;
  return {
    level: missed === 0 ? "info" : missed >= total ? "critical" : "warn",
    value: `${ok}/${total}`,
    label: `${ok} of ${total} routines fired today`,
  };
}

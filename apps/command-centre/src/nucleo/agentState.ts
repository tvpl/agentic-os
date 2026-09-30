/**
 * The agent's state and the budget's voice, as the shell hears them from the
 * event stream (moved here from the old desktop with the immersive shell).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useOsMetrics, useOsSettings } from "../queries";
import { playCue, useNotifications } from "../hooks/useNotifications";
import { useOsEvent } from "../hooks/useEventStream";
import { budgetState } from "../desktop/budget";
import { baseCoreState, type CoreState } from "../desktop/coreState";
import { LISTENING_EVENT } from "../desktop/console/Console";

/**
 * Budget crossings (plan Onda 2 §5) land in the inbox once per day per level:
 * 80 % warns, 100 % flags the day as over budget. The rule itself is pure
 * (`budgetState`); this only decides when to speak.
 */
export function useBudgetNotifications() {
  const t = useT();
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const settings = useOsSettings();
  const { notify } = useNotifications();
  const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
  const tone = budget.tone;
  const pct = Math.round(budget.ratio * 100);
  useEffect(() => {
    if (tone !== "warn" && tone !== "over") return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `budget:${day}:${tone}`;
    try {
      if (localStorage.getItem(`mordomo.${key}`)) return;
      localStorage.setItem(`mordomo.${key}`, "1");
    } catch {
      /* private mode: notify every load, which is still correct */
    }
    notify({
      kind: "system",
      tone: tone === "over" ? "danger" : "warn",
      title: t(tone === "over" ? "dash.budgetOver" : "dash.budgetWarn", { pct }),
      href: "/settings?tab=security",
      dedupeKey: key,
    });
  }, [tone, pct, notify, t]);
}

/** Short-lived overrides (ms) for the finer core states fed by `run.event`. */
const TOOL_HOLD_MS = 1600;
const RESPOND_HOLD_MS = 1400;
const ALERT_HOLD_MS = 4000;
const DONE_HOLD_MS = 1300;

/**
 * Derives the core state from the event stream: an active run means
 * thinking; tool calls, streamed text, failures, approvals and completions
 * override it for a moment and then fall back.
 */
export function useCoreState(runs: ReadonlyArray<{ status: string }>): CoreState {
  const [override, setOverride] = useState<{ state: CoreState; until: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hold = useCallback((state: CoreState, ms: number) => {
    const until = Date.now() + ms;
    setOverride({ state, until });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setOverride((o) => (o && o.until <= Date.now() ? null : o)),
      ms + 20,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useOsEvent("run.event", (e) => {
    const ev = (e.payload as { event?: { type?: string; stream?: string } } | undefined)?.event;
    if (!ev) return;
    if (ev.type === "tool_use") hold("tool", TOOL_HOLD_MS);
    else if (ev.type === "assistant") hold("responding", RESPOND_HOLD_MS);
    else if (ev.type === "error") hold("alert", ALERT_HOLD_MS);
  });
  useOsEvent("run.started", () => playCue("ack"));
  useOsEvent("run.finished", (e) => {
    const status = (e.payload as { status?: string } | undefined)?.status;
    playCue(status === "done" || status === "cancelled" ? "done" : "alert");
    hold(
      status === "done"
        ? "done"
        : status === "cancelled"
          ? "cancelled"
          : status === "interrupted"
            ? "interrupted"
            : "alert",
      status === "done" ? DONE_HOLD_MS : ALERT_HOLD_MS,
    );
  });
  useOsEvent("approval.requested", () => {
    playCue("decide");
    hold("waiting", ALERT_HOLD_MS);
  });
  useOsEvent("routine.alert", () => hold("alert", ALERT_HOLD_MS));
  const [listening, setListening] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setListening(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(LISTENING_EVENT, on);
    return () => window.removeEventListener(LISTENING_EVENT, on);
  }, []);

  if (listening) return "listening";
  if (override && override.until > Date.now()) return override.state;
  return baseCoreState(runs);
}

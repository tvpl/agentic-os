/**
 * The ambient strip (redesign G5): the prototype's top line. The brand, the
 * provider and its state, then the day's readings — cost, runs in flight,
 * what needs attention — the bell and the clock. Every segment carries its
 * `data-level` from `signal.ts`, so the rule that keeps the desktop quiet
 * holds here too: `idle` never lights up. A segment with somewhere to go is
 * a button that opens its surface on the stage.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Bell } from "lucide-react";
import type { Meta, ProviderSnapshot } from "../api";
import { useLocale, useT } from "../i18n";
import { providerProblem } from "../components/providerReadiness";
import type { CoreState } from "./coreState";
import type { DesktopSignals } from "./useSignals";
import type { SignalLevel } from "./signal";

/** The prototype's levels are shorter than ours; the tokens map one to one. */
function stripLevel(level: SignalLevel): "idle" | "info" | "warn" | "crit" {
  return level === "critical" ? "crit" : level;
}

function Segment({
  level,
  label,
  value,
  onOpen,
  title,
  testId,
}: {
  level: SignalLevel;
  label: string;
  value: ReactNode;
  onOpen?: () => void;
  title?: string;
  testId?: string;
}) {
  const body = (
    <>
      <span className="dt" aria-hidden />
      <span className="k">{label}</span>
      <span className="v" data-testid={testId}>
        {value}
      </span>
    </>
  );
  if (!onOpen)
    return (
      <span className="sg" data-l={stripLevel(level)} title={title}>
        {body}
      </span>
    );
  return (
    <button type="button" className="sg" data-l={stripLevel(level)} data-open title={title} onClick={onOpen}>
      {body}
    </button>
  );
}

function Clock() {
  const locale = useLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="sg" data-l="idle">
      <span className="v">{now.toLocaleTimeString(locale, { hour12: false })}</span>
    </span>
  );
}

export interface AmbientStripProps {
  meta: Meta;
  provider: ProviderSnapshot | undefined;
  coreState: CoreState;
  signals: DesktopSignals;
  unread: number;
  bellOpen: boolean;
  onBell: (anchor: HTMLElement) => void;
  onOpenProvider: () => void;
  onOpenCost: () => void;
  onOpenRuns: () => void;
  onOpenAttention: () => void;
}

export default function AmbientStrip({
  meta,
  provider,
  coreState,
  signals,
  unread,
  bellOpen,
  onBell,
  onOpenProvider,
  onOpenCost,
  onOpenRuns,
  onOpenAttention,
}: AmbientStripProps) {
  const t = useT();
  const problem = provider ? providerProblem(provider) : null;
  const providerLevel: SignalLevel = !provider
    ? "idle"
    : problem
      ? "warn"
      : coreState === "idle"
        ? "idle"
        : coreState === "alert"
          ? "critical"
          : "info";
  const brand = meta.name.replace(/\s*os$/i, "");
  return (
    <header className="strip" aria-label={t("dash.brand")}>
      <span className="bd">
        {brand.toUpperCase()}
        <b>·</b>OS
      </span>
      <Segment
        level={providerLevel}
        label={provider?.id ?? t("desktop.strip.provider")}
        value={
          problem ? (
            <span className="warn-text" data-testid="provider-state">
              {t(`gate.state.${problem}`)}
            </span>
          ) : coreState === "idle" ? (
            t("desktop.strip.ready")
          ) : (
            t(`desktop.core.${coreState}`)
          )
        }
        title={t("dash.activeProvider")}
        onOpen={onOpenProvider}
      />
      <span className="gap" />
      <Segment
        level={signals.cost.level}
        label={t("desktop.strip.day")}
        value={`US$ ${signals.cost.todayUsd.toFixed(2)}`}
        title={signals.cost.label}
        onOpen={onOpenCost}
      />
      <Segment
        level={signals.runs.level}
        label={t("desktop.strip.runs")}
        value={signals.runs.value}
        title={signals.runs.label}
        onOpen={onOpenRuns}
      />
      <Segment
        level={signals.attention.level}
        label={t("desktop.strip.attention")}
        value={String(signals.attention.count)}
        title={signals.attention.label}
        onOpen={onOpenAttention}
      />
      <button
        type="button"
        className={`bell${unread > 0 ? " has-unread" : ""}`}
        aria-label={unread > 0 ? t("desktop.inbox.bell", { n: unread }) : t("desktop.inbox.bellEmpty")}
        title={t("desktop.inbox.title")}
        aria-expanded={bellOpen}
        onClick={(e) => onBell(e.currentTarget)}
      >
        <Bell aria-hidden />
        {unread > 0 && <span className="bc">{Math.min(99, unread)}</span>}
      </button>
      <Clock />
    </header>
  );
}

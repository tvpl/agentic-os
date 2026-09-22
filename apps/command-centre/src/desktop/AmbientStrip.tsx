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
import { useApiQuery } from "../queries";
import type { MetricsHistory } from "../api";
import { sparkline } from "../runs/sparkline";
import { useOsSettings } from "../queries";
import { listSpaces, type SpaceMap } from "./spaces";
import { requestSpace } from "../components/Workspace";

/** The prototype's levels are shorter than ours; the tokens map one to one. */
function stripLevel(level: SignalLevel): "idle" | "info" | "warn" | "crit" {
  return level === "critical" ? "crit" : level;
}

/** The last 24 hourly samples as a 44 × 12 line, with the trend as one arrow. */
function Spark({ values }: { values: readonly number[] }) {
  if (values.length < 3 || values.every((v) => v === 0)) return null;
  const g = sparkline(values, 44, 12);
  const a = values[values.length - 1]!;
  const b = values[Math.max(0, values.length - 7)]!;
  const trend = a > b * 1.05 ? "↑" : a < b * 0.95 ? "↓" : "→";
  return (
    <span className="sg-spark" aria-hidden>
      <svg viewBox="0 0 44 12" width="44" height="12">
        <path d={g.area} className="sg-spark-area" />
        <path d={g.line} className="sg-spark-line" />
      </svg>
      <span className="sg-trend">{trend}</span>
    </span>
  );
}

function Segment({
  level,
  label,
  value,
  onOpen,
  title,
  testId,
  series,
}: {
  level: SignalLevel;
  label: string;
  value: ReactNode;
  onOpen?: () => void;
  title?: string;
  testId?: string;
  /** Last 24 h, one number per hour (refino item 23). */
  series?: readonly number[];
}) {
  const body = (
    <>
      <span className="dt" aria-hidden />
      <span className="k">{label}</span>
      <span className="v" data-testid={testId}>
        {value}
      </span>
      {series && <Spark values={series} />}
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
  const locale = useLocale();
  const history = useApiQuery<MetricsHistory>(["metrics", "history", 2], "/api/metrics/history?days=2", {
    refetchInterval: 600_000,
  });
  const last24 = (history.data?.samples ?? []).slice(-24);
  const series = {
    cost: last24.map((m) => m.costTodayUsd),
    runs: last24.map((m) => m.runs24h),
    attention: last24.map((m) => m.failed24h + m.approvalsPending),
  };
  const settings = useOsSettings();
  const spaceList = listSpaces(
    (settings.data?.spaces as SpaceMap | undefined) ?? {},
    settings.data?.activeSpace ?? "work",
  );
  const activeSpace = settings.data?.activeSpace ?? "work";
  const spaceName = spaceList.find((sp) => sp.id === activeSpace)?.name ?? activeSpace;
  const nextSpace =
    spaceList[(spaceList.findIndex((sp) => sp.id === activeSpace) + 1) % Math.max(1, spaceList.length)];
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
      <Segment
        level="idle"
        label={t("desktop.strip.space")}
        value={spaceName}
        title={t("desktop.strip.spaceHint")}
        onOpen={nextSpace && nextSpace.id !== activeSpace ? () => requestSpace(nextSpace.id) : undefined}
      />
      <span className="gap" />
      <Segment
        level={signals.cost.level}
        label={t("desktop.strip.day")}
        value={`US$ ${signals.cost.todayUsd.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        title={signals.cost.label}
        onOpen={onOpenCost}
        series={series.cost}
      />
      <Segment
        level={signals.runs.level}
        label={t("desktop.strip.runs")}
        value={signals.runs.value}
        title={signals.runs.label}
        onOpen={onOpenRuns}
        series={series.runs}
      />
      <Segment
        level={signals.attention.level}
        label={t("desktop.strip.attention")}
        value={String(signals.attention.count)}
        title={signals.attention.label}
        onOpen={onOpenAttention}
        series={series.attention}
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

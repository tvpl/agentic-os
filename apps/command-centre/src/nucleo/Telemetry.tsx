/**
 * Telemetry (immersive shell): the day's readings as a line of instrument
 * text in the top-right corner — the provider and its state, an active
 * mission, today's cost, runs in flight and the clock. What needs you and
 * the alerts live in the pendências (top-left), not here. No chips and no boxes; only `warn` and `critical` take colour
 * (signal.ts). Each reading with somewhere to go is a button.
 */
import { useEffect, useState } from "react";
import type { ProviderSnapshot } from "../api";
import { useLocale, useT } from "../i18n";
import { providerProblem } from "../components/providerReadiness";
import { useOsObjectives } from "../queries";
import type { CoreState } from "../desktop/coreState";
import type { DesktopSignals } from "../desktop/useSignals";
import type { SignalLevel } from "../desktop/signal";

const lvl = (l: SignalLevel) => (l === "critical" ? "crit" : l);

export interface TelemetryProps {
  provider: ProviderSnapshot | undefined;
  coreState: CoreState;
  signals: DesktopSignals;
  /** The system's name, signed at the corner. */
  name: string;
  onProvider: () => void;
  onCost: () => void;
  onRuns: () => void;
  onMission: () => void;
}

function Clock() {
  const locale = useLocale();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="nu-clock mono" data-testid="nu-clock">
      {now.toLocaleTimeString(locale, { hour12: false, hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export default function Telemetry({
  provider,
  coreState,
  signals,
  name,
  onProvider,
  onCost,
  onRuns,
  onMission,
}: TelemetryProps) {
  const t = useT();
  const locale = useLocale();
  const objectives = useOsObjectives({ refetchInterval: 30_000 });
  const mission = (objectives.data ?? []).find((o) => o.status === "active" || o.status === "blocked");
  const missionDone = mission ? mission.steps.filter((st) => st.status === "verified").length : 0;
  const problem = provider ? providerProblem(provider) : null;
  const providerLevel: SignalLevel = !provider
    ? "idle"
    : problem
      ? "warn"
      : coreState === "alert"
        ? "critical"
        : "idle";
  const cost = signals.cost.todayUsd.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="nu-tele" role="group" aria-label={t("dash.brand")}>
      <button
        type="button"
        className="nu-t"
        data-l={lvl(providerLevel)}
        data-item="provider"
        title={
          problem ? `${t("dash.activeProvider")}: ${t(`gate.state.${problem}`)}` : t("dash.activeProvider")
        }
        onClick={onProvider}
      >
        <span className="k">{provider?.id ?? t("nucleo.tele.provider")}</span>
        <span className="v" data-testid="provider-state">
          {problem
            ? t(`gate.state.${problem}`)
            : coreState === "idle"
              ? t("desktop.strip.ready")
              : t(`desktop.core.${coreState}`)}
        </span>
      </button>
      {mission && (
        <button
          type="button"
          className="nu-t"
          data-l={mission.status === "blocked" ? "warn" : "info"}
          data-item="mission"
          title={mission.title}
          onClick={onMission}
        >
          <span className="k">{t("desktop.strip.mission")}</span>
          <span className="v">
            {missionDone}/{mission.steps.length}
          </span>
        </button>
      )}
      <button
        type="button"
        className="nu-t"
        data-l={lvl(signals.cost.level)}
        data-item="cost"
        title={signals.cost.label}
        onClick={onCost}
      >
        <span className="k">{t("nucleo.tele.cost")}</span>
        <span className="v">US$ {cost}</span>
      </button>
      <button
        type="button"
        className={`nu-t${signals.activeRuns > 0 ? " live" : ""}`}
        data-l={lvl(signals.runs.level)}
        data-item="runs"
        title={signals.runs.label}
        onClick={onRuns}
      >
        <span className="v">{t("nucleo.tele.live", { n: signals.activeRuns })}</span>
      </button>
      <Clock />
      <span className="nu-sign" aria-hidden>
        {name.replace(/\s*os$/i, "").toUpperCase()}
        <b>·OS</b>
      </span>
    </div>
  );
}

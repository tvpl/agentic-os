import { useMemo } from "react";
import { Activity } from "lucide-react";
import type { Metrics, RunRecord } from "../../api";
import { useT } from "../../i18n";
import { useOsMetrics } from "../../queries";
import { formatDuration } from "../../components/ui";
import { EmptyState } from "../../components/primitives";
import { useDesktopRuns } from "../data";
import { useTweenNumber } from "../useTweenNumber";
import { cfgNumber, type WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

export interface PulseWidgetProps extends WidgetProps {
  onRunSkill: () => void;
}

export default function PulseWidget({ onRunSkill, config }: PulseWidgetProps) {
  const metrics = useOsMetrics({ refetchInterval: 60_000 });
  const runs = useDesktopRuns();
  const days = Math.max(7, Math.min(30, cfgNumber(config, "days", 14)));
  return (
    <WidgetGate queries={[metrics, runs]} lines={3}>
      {metrics.data && runs.data && <PulseBody metrics={metrics.data} runs={runs.data} onRunSkill={onRunSkill} days={days} />}
    </WidgetGate>
  );
}

function PulseBody({ metrics, runs, onRunSkill, days }: { metrics: Metrics; runs: RunRecord[]; onRunSkill: () => void; days: number }) {
  const t = useT();
  const counts = useMemo(() => {
    const out = new Array<number>(days).fill(0);
    const dayMs = 86_400_000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime() - (days - 1) * dayMs;
    for (const r of runs) {
      const idx = Math.floor((r.createdAt - startMs) / dayMs);
      if (idx >= 0 && idx < days) out[idx] = (out[idx] ?? 0) + 1;
    }
    return out;
  }, [runs, days]);
  const last7 = useTweenNumber(metrics.last7d);
  const success = useTweenNumber(metrics.successRate == null ? 0 : metrics.successRate * 100);
  const avg = useTweenNumber(metrics.avgDurationMs ?? 0);

  if (runs.length === 0 && metrics.total === 0) {
    return (
      <EmptyState
        className="compact"
        icon={<Activity aria-hidden />}
        title={t("pulse.empty")}
        body={t("pulse.emptyBody")}
        action={
          <button type="button" className="btn sm primary" onClick={onRunSkill}>
            {t("pulse.runSkill")}
          </button>
        }
      />
    );
  }
  const max = Math.max(1, ...counts);
  const points = counts.map((c, i) => `${(i / (days - 1)) * 100},${34 - (c / max) * 30}`).join(" ");
  return (
    <>
      <div className="pulse-stats">
        <div className="stat">
          <span className="value accented tnum">{Math.round(last7)}</span>
          <span className="label">{t("dash.metricRuns")}</span>
        </div>
        <div className="stat">
          <span className="value tnum">{metrics.successRate == null ? "—" : `${Math.round(success)}%`}</span>
          <span className="label">{t("dash.metricSuccess")}</span>
        </div>
        <div className="stat">
          <span className="value tnum">{metrics.avgDurationMs == null ? "—" : formatDuration(Math.round(avg))}</span>
          <span className="label">{t("dash.metricAvg")}</span>
        </div>
      </div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="pulse-spark" role="img" aria-label={t("widget.runsPerDay")}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
        {counts.map((c, i) => (
          <circle key={i} cx={(i / (days - 1)) * 100} cy={34 - (c / max) * 30} r={c > 0 ? 1.6 : 0.7} fill="var(--accent)" />
        ))}
      </svg>
      <div className="pulse-caption">
        {t("widget.runsPerDay")} · {days}d
      </div>
    </>
  );
}

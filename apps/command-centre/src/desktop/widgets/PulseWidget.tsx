import { useMemo } from "react";
import { Activity } from "lucide-react";
import type { Metrics, RunRecord } from "../../api";
import { useT } from "../../i18n";
import { useOsMetrics } from "../../queries";
import { formatDuration } from "../../components/ui";
import { EmptyState } from "../../components/primitives";
import { useDesktopRuns } from "../data";
import { WidgetGate } from "./WidgetGate";

export default function PulseWidget({ onRunSkill }: { onRunSkill: () => void }) {
  const metrics = useOsMetrics({ refetchInterval: 60_000 });
  const runs = useDesktopRuns();
  return (
    <WidgetGate queries={[metrics, runs]} lines={3}>
      {metrics.data && runs.data && <PulseBody metrics={metrics.data} runs={runs.data} onRunSkill={onRunSkill} />}
    </WidgetGate>
  );
}

const DAYS = 14;

function PulseBody({ metrics, runs, onRunSkill }: { metrics: Metrics; runs: RunRecord[]; onRunSkill: () => void }) {
  const t = useT();
  const counts = useMemo(() => {
    const out = new Array<number>(DAYS).fill(0);
    const dayMs = 86_400_000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime() - (DAYS - 1) * dayMs;
    for (const r of runs) {
      const idx = Math.floor((r.createdAt - startMs) / dayMs);
      if (idx >= 0 && idx < DAYS) out[idx] = (out[idx] ?? 0) + 1;
    }
    return out;
  }, [runs]);

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
  const points = counts.map((c, i) => `${(i / (DAYS - 1)) * 100},${34 - (c / max) * 30}`).join(" ");
  return (
    <>
      <div className="pulse-stats">
        <div className="stat">
          <span className="value accented">{metrics.last7d}</span>
          <span className="label">{t("dash.metricRuns")}</span>
        </div>
        <div className="stat">
          <span className="value">{metrics.successRate == null ? "—" : `${Math.round(metrics.successRate * 100)}%`}</span>
          <span className="label">{t("dash.metricSuccess")}</span>
        </div>
        <div className="stat">
          <span className="value">{formatDuration(metrics.avgDurationMs)}</span>
          <span className="label">{t("dash.metricAvg")}</span>
        </div>
      </div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="pulse-spark" role="img" aria-label={t("widget.runsPerDay")}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
        {counts.map((c, i) => (
          <circle key={i} cx={(i / (DAYS - 1)) * 100} cy={34 - (c / max) * 30} r={c > 0 ? 1.6 : 0.7} fill="var(--accent)" />
        ))}
      </svg>
      <div className="pulse-caption">{t("widget.runsPerDay")}</div>
    </>
  );
}

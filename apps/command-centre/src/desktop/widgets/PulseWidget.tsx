import { useMemo } from "react";
import { Activity } from "lucide-react";
import type { Metrics, RunRecord } from "../../api";
import { useLocale, useT } from "../../i18n";
import { useOsMetrics } from "../../queries";
import { StatusBadge, formatDuration, timeAgo } from "../../components/ui";
import { EmptyState } from "../../components/primitives";
import { useDesktopActions } from "../actions";
import { useDesktopRuns } from "../data";
import { useTweenNumber } from "../useTweenNumber";
import type { WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

export default function PulseWidget(_props: WidgetProps) {
  const { focusDeck } = useDesktopActions();
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const runs = useDesktopRuns();
  const days = 14;
  return (
    <WidgetGate queries={[metrics, runs]} lines={3}>
      {metrics.data && runs.data && (
        <PulseBody metrics={metrics.data} runs={runs.data} onRunSkill={focusDeck} days={days} />
      )}
    </WidgetGate>
  );
}

function PulseBody({
  metrics,
  runs,
  onRunSkill,
  days,
}: {
  metrics: Metrics;
  runs: RunRecord[];
  onRunSkill: () => void;
  days: number;
}) {
  const t = useT();
  const locale = useLocale();
  const { counts, failedDays } = useMemo(() => {
    const counts = new Array<number>(days).fill(0);
    const failedDays = new Array<boolean>(days).fill(false);
    const dayMs = 86_400_000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime() - (days - 1) * dayMs;
    for (const r of runs) {
      const idx = Math.floor((r.createdAt - startMs) / dayMs);
      if (idx < 0 || idx >= days) continue;
      counts[idx] = (counts[idx] ?? 0) + 1;
      if (r.status === "failed" || r.status === "timed_out") failedDays[idx] = true;
    }
    return { counts, failedDays };
  }, [runs, days]);
  const failures = useMemo(
    () => runs.filter((r) => r.status === "failed" || r.status === "timed_out").slice(0, 3),
    [runs],
  );
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
  const rate = metrics.successRate;
  // The prototype's instrument surface: three tiles, a bar per day with the
  // failed days in red, and the failures that need a look.
  return (
    <>
      <div className="mt">
        <div className={rate == null ? "" : rate < 0.5 ? "bad" : rate >= 0.8 ? "good" : ""}>
          <div className="k">{t("dash.metricSuccess")}</div>
          <div className="v tnum">{rate == null ? "—" : `${Math.round(success)}%`}</div>
        </div>
        <div>
          <div className="k">{t("dash.metricRuns")}</div>
          <div className="v tnum">{Math.round(last7)}</div>
        </div>
        <div>
          <div className="k">{t("dash.metricAvg")}</div>
          <div className="v tnum">
            {metrics.avgDurationMs == null ? "—" : formatDuration(Math.round(avg))}
          </div>
        </div>
      </div>
      <div className="cp">
        {t("widget.runsPerDay")} · {days}d
      </div>
      <div className="bars" role="img" aria-label={t("widget.runsPerDay")}>
        {counts.map((c, i) => (
          <i
            key={i}
            className={failedDays[i] ? "f" : ""}
            style={{ height: `${Math.max(4, (c / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="cp">{t("pulse.recentFailures")}</div>
      {failures.length === 0 ? (
        <p className="dm-note">{t("pulse.noFailures")}</p>
      ) : (
        failures.map((r) => (
          <div className="rw" key={r.id}>
            <StatusBadge status={r.status} />
            <span className="truncate">{r.skillSlug ?? r.promptSummary.slice(0, 42)}</span>
            <span className="sp" />
            <span className="dm">{timeAgo(r.createdAt, locale)}</span>
          </div>
        ))
      )}
    </>
  );
}

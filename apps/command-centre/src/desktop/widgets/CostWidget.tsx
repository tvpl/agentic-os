/**
 * Cost widget: today / week spend, tokens, burn rate and the 5-hour block
 * gauge with reset countdown (70 / 90 % thresholds). Reads `Metrics.cost`
 * (F-RUNS contract) and shows a "not available yet" state when absent.
 */
import { Coins } from "lucide-react";
import type { Metrics, MetricsCost } from "../../api";
import { useLocale, useT } from "../../i18n";
import { useOsMetrics } from "../../queries";
import { EmptyState } from "../../components/primitives";
import { formatCountdown, useTicker } from "../data";
import { useTweenNumber } from "../useTweenNumber";
import { WidgetGate } from "./WidgetGate";
import type { WidgetProps } from "../widgetTypes";

export default function CostWidget(_props: WidgetProps) {
  const metrics = useOsMetrics({ refetchInterval: 60_000 });
  return (
    <WidgetGate queries={[metrics]} lines={3}>
      {metrics.data && <CostBody metrics={metrics.data} />}
    </WidgetGate>
  );
}

const readCost = (m: Metrics): MetricsCost | null => {
  const c = (m as Metrics & { cost?: unknown }).cost;
  if (!c || typeof c !== "object") return null;
  const o = c as Partial<MetricsCost>;
  if (typeof o.todayUsd !== "number") return null;
  return { todayUsd: o.todayUsd, weekUsd: o.weekUsd ?? 0, tokensToday: o.tokensToday ?? 0, burnRatePerHour: o.burnRatePerHour ?? 0, block5h: o.block5h };
};

export function gaugeTone(pct: number): "ok" | "warn" | "danger" {
  return pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
}

function CostBody({ metrics }: { metrics: Metrics }) {
  const t = useT();
  const locale = useLocale();
  const now = useTicker(1000);
  const cost = readCost(metrics);
  const today = useTweenNumber(cost?.todayUsd ?? 0);
  const week = useTweenNumber(cost?.weekUsd ?? 0);
  const tokens = useTweenNumber(cost?.tokensToday ?? 0);
  const burn = useTweenNumber(cost?.burnRatePerHour ?? 0);
  const pct = useTweenNumber(Math.max(0, Math.min(100, cost?.block5h?.usedPct ?? 0)));
  if (!cost) {
    return <EmptyState className="compact" icon={<Coins aria-hidden />} title={t("desktop.cost.unavailable")} body={t("desktop.cost.unavailableBody")} />;
  }
  const money = (v: number) => v.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const tone = gaugeTone(cost.block5h?.usedPct ?? 0);
  const compact = (n: number) => n.toLocaleString(locale, { notation: "compact", maximumFractionDigits: 1 });
  return (
    <div className="cost">
      <div className="pulse-stats">
        <div className="stat">
          <span className="value accented tnum">{money(today)}</span>
          <span className="label">{t("desktop.cost.today")}</span>
        </div>
        <div className="stat">
          <span className="value tnum">{money(week)}</span>
          <span className="label">{t("desktop.cost.week")}</span>
        </div>
        <div className="stat">
          <span className="value tnum sm">{compact(tokens)}</span>
          <span className="label">{t("desktop.cost.tokens")}</span>
        </div>
        <div className="stat">
          <span className="value tnum sm">{money(burn)}/h</span>
          <span className="label">{t("desktop.cost.burn")}</span>
        </div>
      </div>
      {cost.block5h && (
        <div className={`cost-gauge ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cost.block5h.usedPct)} aria-label={t("desktop.cost.block")}>
          <div className="cost-gauge-head">
            <span className="hud-label">{t("desktop.cost.block")}</span>
            <span className="mono tnum">
              {Math.round(pct)}% · {t("desktop.cost.resets", { time: formatCountdown(cost.block5h.resetsAt - now) })}
            </span>
          </div>
          <div className="cost-track">
            <div className="cost-fill" style={{ transform: `scaleX(${pct / 100})` }} />
            <span className="cost-tick" style={{ left: "70%" }} aria-hidden />
            <span className="cost-tick" style={{ left: "90%" }} aria-hidden />
          </div>
        </div>
      )}
    </div>
  );
}

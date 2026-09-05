/**
 * Settings › Trends (plan follow-up 8): the §9 metrics over time from the
 * hourly samples. Six small multiples, one series each (single hue, no
 * legend), with a crosshair tooltip and a table view; values wear text
 * tokens, the mark carries the colour.
 */
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { useApiQuery } from "../queries";
import { Segmented } from "../components/primitives";
import type { MetricsDailyPoint, MetricsHistory } from "../api";

const DAY_OPTIONS = ["7", "14", "30", "90"] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

interface Series {
  key: keyof MetricsDailyPoint;
  labelKey:
    "trends.spend" | "trends.runs" | "trends.failed" | "trends.tokens" | "trends.unread" | "trends.wait";
  format: (v: number) => string;
  map?: (p: MetricsDailyPoint) => number | null;
}

const SERIES: Series[] = [
  { key: "spendUsd", labelKey: "trends.spend", format: (v) => `US$ ${v.toFixed(2)}` },
  { key: "runs", labelKey: "trends.runs", format: (v) => String(Math.round(v)) },
  { key: "failed", labelKey: "trends.failed", format: (v) => String(Math.round(v)) },
  {
    key: "tokens",
    labelKey: "trends.tokens",
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))),
  },
  { key: "inboxUnread", labelKey: "trends.unread", format: (v) => String(Math.round(v)) },
  {
    key: "approvalWaitAvgMs",
    labelKey: "trends.wait",
    format: (v) => `${(v / 60_000).toFixed(1)} min`,
    map: (p) => (p.approvalWaitAvgMs == null ? null : p.approvalWaitAvgMs),
  },
];

export function TrendsTab() {
  const t = useT();
  const [days, setDays] = useState<DayOption>("14");
  const [view, setView] = useState<"chart" | "table">("chart");
  const history = useApiQuery<MetricsHistory>(
    ["metrics", "history", days],
    `/api/metrics/history?days=${days}`,
    { staleTime: 60_000 },
  );
  const daily = history.data?.daily ?? [];
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head-row">
          <div className="min0">
            <h2>{t("trends.title")}</h2>
            <p className="hint">{t("trends.hint")}</p>
          </div>
          <div className="head-actions">
            <Segmented<DayOption>
              size="sm"
              ariaLabel={t("trends.days", { n: Number(days) })}
              value={days}
              onChange={setDays}
              options={DAY_OPTIONS.map((n) => ({ value: n, label: `${n}d` }))}
            />
            <Segmented<"chart" | "table">
              size="sm"
              ariaLabel={t("trends.chart")}
              value={view}
              onChange={setView}
              options={[
                { value: "chart", label: t("trends.chart") },
                { value: "table", label: t("trends.table") },
              ]}
            />
          </div>
        </div>
        {daily.length === 0 && !history.isLoading && <p className="widget-muted">{t("trends.empty")}</p>}
        {daily.length > 0 && view === "table" && (
          <div className="table-scroll">
            <table className="trend-table">
              <thead>
                <tr>
                  <th>{t("trends.days", { n: Number(days) }).split(" ")[0]}</th>
                  {SERIES.map((s) => (
                    <th key={s.key}>{t(s.labelKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daily.map((p) => (
                  <tr key={p.day}>
                    <td>{p.day}</td>
                    {SERIES.map((s) => {
                      const v = s.map ? s.map(p) : (p[s.key] as number);
                      return <td key={s.key}>{v == null ? "—" : s.format(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {daily.length > 0 && view === "chart" && (
        <div className="trends-grid">
          {SERIES.map((s) => (
            <TrendCard key={s.key} series={s} points={daily} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrendCard({ series, points }: { series: Series; points: MetricsDailyPoint[] }) {
  const t = useT();
  const values = points.map((p) => (series.map ? series.map(p) : (p[series.key] as number)));
  const last = [...values].reverse().find((v) => v != null) ?? null;
  return (
    <div className="card trend-card">
      <div className="card-head-row">
        <h3>{t(series.labelKey)}</h3>
        <span className="trend-value">{last == null ? "—" : series.format(last)}</span>
      </div>
      <LineChart days={points.map((p) => p.day)} values={values} format={series.format} />
    </div>
  );
}

const W = 320;
const H = 110;
const PAD = { l: 6, r: 6, t: 10, b: 16 } as const;

/** One series, area + 2 px line, ≥ 8 px hover targets, crosshair tooltip. Missing values break the line. */
export function LineChart({
  days,
  values,
  format,
}: {
  days: string[];
  values: Array<number | null>;
  format: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    const present = values.filter((v): v is number => v != null);
    const max = present.length ? Math.max(...present, 0) : 0;
    const n = values.length;
    const x = (i: number) => (n > 1 ? PAD.l + (i * (W - PAD.l - PAD.r)) / (n - 1) : W / 2);
    const y = (v: number) => (max > 0 ? PAD.t + (1 - v / max) * (H - PAD.t - PAD.b) : H - PAD.b);
    const pts = values.map((v, i) => ({ x: x(i), y: v == null ? null : y(v), v }));
    // Segments between consecutive present points; gaps stay gaps.
    let line = "";
    let area = "";
    let open = false;
    let startX = 0;
    pts.forEach((p, i) => {
      if (p.y == null) {
        if (open) area += ` L${pts[i - 1]!.x},${H - PAD.b} L${startX},${H - PAD.b} Z`;
        open = false;
        return;
      }
      if (!open) {
        line += `M${p.x},${p.y}`;
        area += `M${p.x},${H - PAD.b} L${p.x},${p.y}`;
        startX = p.x;
        open = true;
      } else {
        line += ` L${p.x},${p.y}`;
        area += ` L${p.x},${p.y}`;
      }
    });
    if (open) area += ` L${pts[pts.length - 1]!.x},${H - PAD.b} L${startX},${H - PAD.b} Z`;
    return { pts, line, area, max, baseline: H - PAD.b };
  }, [values]);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let dist = Infinity;
    geo.pts.forEach((p, i) => {
      const d = Math.abs(p.x - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };
  const h = hover != null ? geo.pts[hover] : null;
  const first = days[0] ?? "";
  const lastDay = days[days.length - 1] ?? "";
  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${first} → ${lastDay}`}
      >
        <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={geo.baseline} y2={geo.baseline} />
        {geo.max > 0 && (
          <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} strokeDasharray="2 4" />
        )}
        <path className="area" d={geo.area} />
        <path className="line" d={geo.line} />
        {h && h.y != null && (
          <>
            <line className="crosshair" x1={h.x} x2={h.x} y1={PAD.t} y2={geo.baseline} />
            <circle className="dot" cx={h.x} cy={h.y} r={4} />
          </>
        )}
        {!h && geo.pts.length > 0 && geo.pts[geo.pts.length - 1]!.y != null && (
          <circle
            className="dot"
            cx={geo.pts[geo.pts.length - 1]!.x}
            cy={geo.pts[geo.pts.length - 1]!.y!}
            r={3.5}
          />
        )}
        <text className="axis-label" x={PAD.l} y={H - 3}>
          {first.slice(5)}
        </text>
        <text className="axis-label" x={W - PAD.r} y={H - 3} textAnchor="end">
          {lastDay.slice(5)}
        </text>
      </svg>
      {h && (
        <div className="trend-tip" style={{ left: `${(h.x / W) * 100}%` }}>
          {days[hover!]} · {h.v == null ? "—" : format(h.v)}
        </div>
      )}
    </div>
  );
}

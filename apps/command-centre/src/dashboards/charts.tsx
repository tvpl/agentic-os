/**
 * The two charts of the dashboards (.specs/features/cerebro-paineis, design.md "Widgets" and "Cores dos gráficos";
 * the `dataviz` method): a KPI's sparkline and the horizontal bars, both in SVG made by hand, one series each, thin
 * marks, colours only from the chart tokens. Pointing at or focusing a point shows a tooltip, the value first and the
 * label after, written with `textContent`; `Escape` closes it; the tooltip is never the only way to a value: the
 * table of the same rows (`ValuesTable`, "Ver como tabela") holds every value it can show.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { sparkline } from "../runs/sparkline";

/** One value of a chart, as the tooltip and the table both read it. */
export interface ChartPoint {
  label: string;
  value: string;
}

/** The pointed or focused point, and the tooltip that shows it. */
function useChartTip(points: readonly ChartPoint[]) {
  const [active, setActive] = useState<number | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el) return;
    el.replaceChildren();
    const p = active === null ? undefined : points[active];
    if (!p) return;
    const value = document.createElement("strong");
    value.textContent = p.value;
    const label = document.createElement("span");
    label.textContent = p.label;
    el.append(value, " ", label);
  }, [active, points]);
  const onKeyDown = (event: KeyboardEvent) => {
    const last = points.length - 1;
    if (event.key === "Escape" && active !== null) {
      event.stopPropagation();
      setActive(null);
      return;
    }
    const step = ["ArrowRight", "ArrowDown"].includes(event.key)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.key)
        ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    setActive((a) => Math.min(last, Math.max(0, (a ?? (step > 0 ? -1 : last + 1)) + step)));
  };
  const frame = {
    tabIndex: 0,
    onKeyDown,
    onFocus: () => setActive((a) => a ?? points.length - 1),
    onBlur: () => setActive(null),
    onPointerLeave: () => setActive(null),
  };
  const tooltip = <div ref={tip} className="dsh-tip" role="tooltip" hidden={active === null} />;
  return { active, setActive, frame, tooltip };
}

/** The same values as a table (design.md "Interação": the tooltip is never the only path). */
export function ValuesTable({ points, caption }: { points: readonly ChartPoint[]; caption: string }) {
  return (
    <table className="dsh-table dsh-values">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {points.map((p, i) => (
          <tr key={i}>
            <th scope="row">{p.label}</th>
            <td className="dsh-num">{p.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const SPARK_W = 96;
const SPARK_H = 32;

/**
 * The sparkline of a KPI (design.md `kpi`): 96×32, a 2px line, the history before the current period in
 * `--chart-muted`, the current period in `--chart-mark`, an 8px end dot with a 2px ring of the surface, and the area
 * under it in `--chart-mark-soft`. `current` is the index the current period starts at.
 */
export function Sparkline({
  values,
  current,
  points,
  label,
}: {
  values: readonly number[];
  current: number;
  points: readonly ChartPoint[];
  label: string;
}) {
  const geo = sparkline(values, SPARK_W, SPARK_H);
  const tip = useChartTip(points);
  const segs = geo.line.split(" ");
  const now = segs
    .slice(Math.max(0, current))
    .map((s, i) => (i === 0 ? `M${s.slice(1)}` : s))
    .join(" ");
  const step = values.length > 1 ? SPARK_W / (values.length - 1) : SPARK_W;
  return (
    <div className="dsh-spark" {...tip.frame} role="img" aria-label={label}>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        width={SPARK_W}
        height={SPARK_H}
        aria-hidden
        overflow="visible"
      >
        <path className="dsh-spark-area" d={geo.area} />
        <path className="dsh-spark-hist" d={geo.line} />
        {current > 0 && <path className="dsh-spark-now" d={now} />}
        {current <= 0 && <path className="dsh-spark-now" d={geo.line} />}
        {geo.last && <circle className="dsh-spark-dot" cx={geo.last.x} cy={geo.last.y} r={4} />}
        {values.map((_, i) => (
          <rect
            key={i}
            className="dsh-hit"
            x={(values.length > 1 ? i * step : 0) - step / 2}
            y={-8}
            width={Math.max(step, 12)}
            height={SPARK_H + 16}
            data-point={i}
            onPointerMove={() => tip.setActive(i)}
          />
        ))}
        {tip.active !== null && values.length > 1 && (
          <line className="dsh-cross" x1={tip.active * step} x2={tip.active * step} y1={0} y2={SPARK_H} />
        )}
      </svg>
      {tip.tooltip}
    </div>
  );
}

export interface BarDatum {
  label: string;
  count: number;
  /** The conversion from the step before, in a funnel ("46%"). */
  conversion?: string | null;
}

/**
 * Horizontal bars (design.md `bars`): up to 24px thick, 4px corners at the data's end and square at the base, 2px of
 * surface between bars, the track in `--chart-muted` at 25%, the bar in `--chart-mark`; the category at the left, the
 * value at the right and, in a funnel, the conversion in a column of its own; one series, no legend.
 */
export function Bars({
  data,
  funnel,
  label,
  format,
}: {
  data: readonly BarDatum[];
  funnel: boolean;
  label: string;
  format: (n: number) => string;
}) {
  const max = Math.max(0, ...data.map((d) => d.count));
  const points = data.map((d) => ({ label: d.label, value: format(d.count) }));
  const tip = useChartTip(points);
  return (
    <div
      className="dsh-bars"
      data-funnel={funnel ? "" : undefined}
      {...tip.frame}
      role="img"
      aria-label={label}
    >
      {data.map((d, i) => {
        const pct = max > 0 ? (d.count / max) * 100 : 0;
        return (
          <div
            key={i}
            className="dsh-bar-row"
            data-active={tip.active === i ? "" : undefined}
            onPointerMove={() => tip.setActive(i)}
          >
            <span className="dsh-bar-label">{d.label}</span>
            <svg className="dsh-bar-svg" width="100%" height={24} aria-hidden>
              <rect className="dsh-bar-track" x={0} y={0} width="100%" height={24} />
              {pct > 0 && (
                <g className="dsh-bar">
                  <rect x={0} y={0} width={`${pct}%`} height={24} rx={4} />
                  <rect x={0} y={0} width={4} height={24} />
                </g>
              )}
            </svg>
            <span className="dsh-bar-value dsh-num">{format(d.count)}</span>
            {funnel && <span className="dsh-bar-conv dsh-num">{d.conversion ?? ""}</span>}
          </div>
        );
      })}
      {tip.tooltip}
    </div>
  );
}

/** A chart with its "Ver como tabela" switch: the chart, or the table of the same points. */
export function ChartOrTable({
  asTable,
  points,
  caption,
  children,
}: {
  asTable: boolean;
  points: readonly ChartPoint[];
  caption: string;
  children: ReactNode;
}) {
  return asTable ? <ValuesTable points={points} caption={caption} /> : <>{children}</>;
}

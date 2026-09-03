/**
 * Tiny sparkline maths for the tokens series in the Runs header (pure, tested).
 * The series is drawn as an SVG polyline in a viewBox of `w × h`, so the
 * component never touches layout while the numbers change.
 */
export interface SparkGeometry {
  /** `M…L…` path of the line. */
  line: string;
  /** Same points closed down to the baseline, for the soft fill. */
  area: string;
  /** Last point, so the caller can put a dot on it. */
  last: { x: number; y: number } | null;
  max: number;
}

/**
 * Values are mapped to `[h - 1, 1]` (1 px padding so the stroke is never
 * clipped). A flat series sits on the baseline instead of jumping to the top.
 */
export function sparkline(values: readonly number[], w = 100, h = 24): SparkGeometry {
  if (values.length === 0) return { line: "", area: "", last: null, max: 0 };
  const max = Math.max(...values);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const y = (v: number) => {
    if (max <= 0) return h - 1;
    return h - 1 - (v / max) * (h - 2);
  };
  const points = values.map((v, i) => ({ x: values.length > 1 ? i * step : w / 2, y: y(v) }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)},${round(p.y)}`).join(" ");
  const first = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const area = `${line} L${round(lastPoint.x)},${h} L${round(first.x)},${h} Z`;
  return { line, area, last: { x: round(lastPoint.x), y: round(lastPoint.y) }, max };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum of a numeric field over the series (tokens/cost totals under the chart). */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

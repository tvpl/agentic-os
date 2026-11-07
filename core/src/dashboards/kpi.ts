import type { DashboardWidget } from "@mordomo/contracts";

/**
 * The maths of a `kpi` (.specs/features/cerebro-paineis, AC 26 to AC 29, amendment 14): the trend over the points the
 * series keeps, the delta against the declared period, and the chip. The server has no language: a chip is
 * `{ rule, n, tone }` and the screen writes its text.
 */

export interface KpiPoint {
  /** The local start of the hour the point stands for (door 4). */
  at: number;
  value: number;
}

export interface KpiDelta {
  delta: number;
  /** Percent of the base, one decimal; null when the base is 0. */
  deltaPct: number | null;
  direction: "up" | "down" | "flat";
  /** Whether the direction is the good one (`upIsGood`, default true); flat is never bad. */
  good: boolean;
}

export interface KpiChip {
  rule: "remaining" | "open" | "behind";
  n: number;
  tone: "warn" | "danger";
}

/** At most this many points of the series go into a KPI's data (AC 26). */
export const KPI_SERIES_MAX = 30;
const HOUR_MS = 3_600_000;
export const PERIOD_MS: Readonly<Record<"day" | "week", number>> = {
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
};

/**
 * The delta of the newest point against the oldest one that does not pass the period before it (amendment 14): three
 * points 3, 4 and 2 in three hours give −1. Fewer than two points: no delta (AC 28).
 */
export function kpiDelta(
  points: readonly KpiPoint[],
  period: "day" | "week" = "day",
  upIsGood = true,
): KpiDelta | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const newest = sorted[sorted.length - 1]!;
  const from = newest.at - PERIOD_MS[period];
  const base = sorted.find((p) => p.at >= from)!;
  const delta = newest.value - base.value;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return {
    delta,
    deltaPct: base.value === 0 ? null : Math.round((delta / Math.abs(base.value)) * 1000) / 10,
    direction,
    good: direction === "flat" ? true : (direction === "up") === upIsGood,
  };
}

/**
 * The chip a KPI declares, or null when its count is 0 (amendment 14): `remaining` is `of - value` (warn), `open` the
 * open decisions of its source (warn), `behind` the projects behind (danger).
 */
export function kpiChip(
  rule: "remaining" | "open" | "behind" | undefined,
  value: { value: number; of?: number },
  source: Record<string, unknown>,
): KpiChip | null {
  if (rule === undefined) return null;
  const count = (key: string): number => (typeof source[key] === "number" ? (source[key] as number) : 0);
  const n =
    rule === "remaining"
      ? value.of !== undefined
        ? value.of - value.value
        : 0
      : count(rule === "open" ? "open" : "behind");
  if (!(n > 0)) return null;
  return { rule, n, tone: rule === "behind" ? "danger" : "warn" };
}

/**
 * The points a refresh leaves for a KPI: the stored ones of the last 90 days without the point of this hour, then this
 * hour's (the same rule `DashboardStore.savePoints` writes by).
 */
export function seriesWith(
  stored: readonly KpiPoint[],
  current: KpiPoint | null,
  now: number,
  retentionMs: number,
): KpiPoint[] {
  const kept = stored.filter((p) => p.at >= now - retentionMs && (current === null || p.at !== current.at));
  return [...kept, ...(current ? [current] : [])].sort((a, b) => a.at - b.at);
}

/**
 * A KPI's data (AC 26): `value` and `of` by the measure, the delta and its direction when the series has two points,
 * the chip, the newest 30 points oldest first, and the items of its source when it has them (what the highlights of
 * door 5 read, amendment 8).
 */
export function kpiData(
  widget: DashboardWidget,
  value: { value: number; of?: number } | null,
  source: Record<string, unknown>,
  points: readonly KpiPoint[],
): Record<string, unknown> {
  const series = points.slice(-KPI_SERIES_MAX).map((p) => ({ at: p.at, value: p.value }));
  const items = Array.isArray(source.items) ? { items: source.items } : {};
  if (value === null) return { series, ...items };
  const delta = kpiDelta(points, widget.options?.period ?? "day", widget.options?.upIsGood ?? true);
  const chip = kpiChip(widget.options?.chip, value, source);
  return { ...value, ...(delta ?? {}), ...(chip ? { chip } : {}), series, ...items };
}

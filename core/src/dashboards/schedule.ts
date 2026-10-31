import type { DashboardSpec } from "@mordomo/contracts";

/**
 * When a dashboard is refreshed by the service's clock, and when its snapshot is stale (AC 10, AC 11, amendments 12
 * and 13). A `question` dashboard and a `manual` one are never refreshed by the clock nor by a stale `GET`.
 */

const MINUTE = 60_000;
const INTERVALS: Readonly<Record<string, number>> = {
  "15m": 15 * MINUTE,
  "1h": 60 * MINUTE,
  "6h": 360 * MINUTE,
};
const DAY_MS = 24 * 60 * MINUTE;

/** The local instant of `HH:MM` on the local day of `now`. */
function dailyAt(now: number, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
}

const dailyTime = (refresh: string): string | null =>
  refresh.startsWith("daily@") ? refresh.slice(6) : null;

/** Whether the clock runs this dashboard now: never for `manual` or `question`; at once without a snapshot. */
export function refreshDue(
  def: Pick<DashboardSpec, "kind" | "refresh">,
  generatedAt: number | null,
  now: number,
): boolean {
  if (def.kind === "question" || def.refresh === "manual") return false;
  if (generatedAt === null) return true;
  const daily = dailyTime(def.refresh);
  if (daily !== null) {
    // Once a day, at the first tick from that local time on.
    const at = dailyAt(now, daily);
    return now >= at && generatedAt < at;
  }
  const interval = INTERVALS[def.refresh];
  return interval !== undefined && now - generatedAt >= interval;
}

/** Whether a stored snapshot is older than its refresh allows (twice the day for `daily`); false for manual and none. */
export function snapshotStale(
  def: Pick<DashboardSpec, "kind" | "refresh">,
  generatedAt: number | null,
  now: number,
): boolean {
  if (generatedAt === null || def.refresh === "manual" || def.kind === "question") return false;
  const interval = dailyTime(def.refresh) !== null ? 2 * DAY_MS : INTERVALS[def.refresh];
  return interval !== undefined && now - generatedAt > interval;
}

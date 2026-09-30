/**
 * The Brain scene's timeline (immersive shell): the brain as it was N days
 * ago, read from file modification times. A file modified after the cutoff
 * is not there yet. Pure.
 */

export const DAY_MS = 86_400_000;

/** Days from the oldest file to `now`, rounded up (at least 1; 0 files → 0). */
export function timelineSpan(mtimes: readonly number[], now: number): number {
  if (mtimes.length === 0) return 0;
  let oldest = Infinity;
  for (const m of mtimes) if (m < oldest) oldest = m;
  return Math.max(1, Math.ceil((now - oldest) / DAY_MS));
}

/** The mtime cutoff for "N days ago"; 0 days is now, which is no cutoff at all (null). */
export function cutoffFor(daysAgo: number, now: number): number | null {
  if (!(daysAgo > 0)) return null;
  return now - daysAgo * DAY_MS;
}

/** Whether a file existed (by its last change) at the cutoff. */
export function presentAt(mtime: number, cutoff: number | null): boolean {
  return cutoff === null || mtime <= cutoff;
}

export function countPresent(mtimes: readonly number[], cutoff: number | null): number {
  let n = 0;
  for (const m of mtimes) if (presentAt(m, cutoff)) n++;
  return n;
}

/**
 * Changes per bin across the span, oldest bin first — the ticks above the
 * slider. Files older than the span land in the first bin, future ones
 * (clock skew) in the last.
 */
export function histogram(mtimes: readonly number[], now: number, spanDays: number, bins: number): number[] {
  const out = new Array<number>(Math.max(1, bins)).fill(0);
  if (spanDays <= 0) return out;
  const start = now - spanDays * DAY_MS;
  const width = (spanDays * DAY_MS) / out.length;
  for (const m of mtimes) {
    const i = Math.floor((m - start) / width);
    out[Math.min(out.length - 1, Math.max(0, i))]!++;
  }
  return out;
}

/** Whole days since `mtime` (0 = within the last 24 h). */
export function ageDays(mtime: number, now: number): number {
  return Math.max(0, Math.floor((now - mtime) / DAY_MS));
}

/** "Recently changed": pulses in the sky. */
export const RECENT_MS = 3 * DAY_MS;
export function isRecent(mtime: number, now: number, cutoff: number | null = null): boolean {
  const ref = cutoff ?? now;
  return mtime <= ref && ref - mtime < RECENT_MS;
}

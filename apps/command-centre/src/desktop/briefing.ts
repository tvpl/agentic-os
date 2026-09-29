/**
 * The day's briefing (refino item 4): three lines the agent opens with —
 * what ran, what failed, what needs you — composed from what the desktop
 * already knows, so it is instant and costs nothing. Shown once per local
 * day; dismissing it marks the bell read. Pure and tested.
 */
import type { TKey, TVars } from "../i18n";

export const BRIEFING_KEY = "mordomo.briefing.shown";

export interface BriefingRun {
  status: string;
  finishedAt: number | null;
  createdAt: number;
  skillSlug: string | null;
  promptSummary: string;
}
export interface BriefingRoutine {
  name: string;
  enabled: boolean;
  healthy: boolean;
  nextRunAt?: number | null;
}
export interface BriefingInput {
  runs: readonly BriefingRun[];
  routines: readonly BriefingRoutine[];
  pendingApprovals: number;
  todayUsd: number;
  now: number;
  /** Morning and day open the day; evening and night close it (refino item 53). */
  phase?: "morning" | "day" | "evening" | "night";
}

export interface Briefing {
  lines: string[];
  /** What is spoken: the lines joined, short. */
  spoken: string;
  /** Nothing happened and nothing waits: the briefing is one calm line. */
  quiet: boolean;
}

const DAY_MS = 86_400_000;

export function localDay(at: number | Date = Date.now()): string {
  const d = typeof at === "number" ? new Date(at) : at;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Due when it was not shown today — and again once the evening comes. */
export function briefingDue(lastShown: string | null, now: number = Date.now(), phase?: string): boolean {
  return lastShown !== briefingKey(now, phase);
}

/** `YYYY-MM-DD` by day, `YYYY-MM-DD:night` once the day is closing. */
export function briefingKey(now: number = Date.now(), phase?: string): string {
  const day = localDay(now);
  return phase === "evening" || phase === "night" ? `${day}:night` : day;
}

export function composeBriefing(input: BriefingInput, t: (key: TKey, vars?: TVars) => string): Briefing {
  const since = input.now - DAY_MS;
  const recent = input.runs.filter((r) => (r.finishedAt ?? r.createdAt) >= since);
  const done = recent.filter((r) => r.status === "done").length;
  const failed = recent.filter((r) => r.status === "failed" || r.status === "timed_out");
  const unhealthy = input.routines.filter((r) => r.enabled && !r.healthy);
  const next = input.routines
    .filter((r) => r.enabled && typeof r.nextRunAt === "number" && r.nextRunAt > input.now)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
  const lines: string[] = [];
  const night = input.phase === "evening" || input.phase === "night";
  if (night) {
    // Closing the day: what runs while you sleep.
    const overnight = input.routines.filter(
      (r) =>
        r.enabled &&
        typeof r.nextRunAt === "number" &&
        r.nextRunAt > input.now &&
        r.nextRunAt < input.now + 10 * 3_600_000,
    ).length;
    lines.push(t("desktop.briefing.goodNight", { n: overnight }));
  } else if (input.phase === "morning") lines.push(t("desktop.briefing.goodMorning"));

  if (done > 0 || failed.length > 0) lines.push(t("desktop.briefing.ran", { done, failed: failed.length }));
  if (failed.length > 0) {
    const names = [
      ...new Set(failed.map((r) => (r.skillSlug ? `/${r.skillSlug}` : r.promptSummary.slice(0, 30)))),
    ].slice(0, 2);
    lines.push(t("desktop.briefing.failed", { names: names.join(", ") }));
  }
  if (unhealthy.length > 0)
    lines.push(t("desktop.briefing.routines", { n: unhealthy.length, name: unhealthy[0]!.name }));
  if (input.pendingApprovals > 0) lines.push(t("desktop.briefing.approvals", { n: input.pendingApprovals }));
  if (next) {
    const hours = Math.max(1, Math.round((next.nextRunAt! - input.now) / 3_600_000));
    lines.push(t("desktop.briefing.next", { name: next.name, hours }));
  }
  // The day's spend lives in the strip (refino "um número, um lugar"): the
  // briefing says what happened and what is next, not what the strip shows.

  const quiet = done === 0 && failed.length === 0 && unhealthy.length === 0 && input.pendingApprovals === 0;
  if (quiet && !night && input.phase !== "morning") lines.unshift(t("desktop.briefing.quiet"));
  if (lines.length === 0) lines.push(t("desktop.briefing.quiet"));
  return { lines, spoken: lines.slice(0, 3).join(" "), quiet };
}

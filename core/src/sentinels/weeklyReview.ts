import type { Db } from "../db/db.js";
import type { Settings } from "../config/schema.js";
import type { EventBus } from "../events.js";
import type { MordomoPaths } from "../paths.js";
import { weekOf } from "../memory/loops.js";
import { reminderCounts, reminderIn } from "../memory/weeklyReview.js";
import { readMetaJson, writeMetaJson } from "./meta.js";
import { emitSentinel, type SentinelFiredPayload } from "./types.js";

/**
 * "Time for the weekly review." (.specs/features/cerebro-rituais, door 4.) From the hourly pass, the first pass at or
 * after (`weekday`, `hour`) local time of the week (which ends on Sunday), while the week's review is not finished,
 * emits one notification with the open loops and the projects to review; no model, no network. The week it fired is
 * kept in `meta` (`sentinel.weeklyReview.week`, G11), not read back from the inbox: the owner deleting the row does not
 * make another one that week (L-060).
 */

export const WEEKLY_REVIEW_WEEK_KEY = "sentinel.weeklyReview.week";
export const WEEKLY_REVIEW_HREF = "/brain/weekly";

/** The payload for the week that starts on `week`, with these counts. */
export function weeklyReviewAlert(
  week: string,
  counts: { loops: number; projects: number },
): SentinelFiredPayload {
  return {
    sentinel: "weeklyReview",
    title: "Time for the weekly review",
    body: `${counts.loops} open loops, ${counts.projects} projects to review.`,
    severity: "info",
    href: WEEKLY_REVIEW_HREF,
    dedupeKey: `sentinel:weeklyReview:${week}:all`,
    messageParams: { loops: counts.loops, projects: counts.projects },
  };
}

export interface WeeklyReviewSentinelDeps {
  db: Db;
  paths: MordomoPaths;
  getSettings: () => Settings;
  bus: EventBus;
  now?: () => number;
}

/**
 * Whether the reminder is due at `now` (door 4): the week has not had it, it is at or after (`weekday`, `hour`) of the
 * week, and the week has no `finished_at`.
 */
export function weeklyReviewDue(db: Db, cfg: Settings["sentinels"]["weeklyReview"], now: number): boolean {
  const week = weekOf(now);
  if (readMetaJson<string>(db, WEEKLY_REVIEW_WEEK_KEY) === week) return false;
  const row = db.prepare("SELECT finished_at FROM weekly_reviews WHERE week = ?").get(week) as
    { finished_at: number | null } | undefined;
  if (row?.finished_at != null) return false;
  return now >= reminderIn(week, cfg.weekday, cfg.hour);
}

/** The hourly check: emits at most one `sentinel.fired` a local week. Returns what it emitted. */
export function checkWeeklyReview(deps: WeeklyReviewSentinelDeps): SentinelFiredPayload[] {
  const now = deps.now?.() ?? Date.now();
  const settings = deps.getSettings();
  if (!weeklyReviewDue(deps.db, settings.sentinels.weeklyReview, now)) return [];
  const week = weekOf(now);
  // Counted before the week is recorded: a count that fails leaves the next pass free to emit.
  const counts = reminderCounts({ db: deps.db, paths: deps.paths, settings }, now);
  writeMetaJson(deps.db, WEEKLY_REVIEW_WEEK_KEY, week);
  return [emitSentinel(deps.bus, weeklyReviewAlert(week, counts))];
}

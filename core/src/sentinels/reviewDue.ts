import type { Db } from "../db/db.js";
import type { Settings } from "../config/schema.js";
import type { EventBus } from "../events.js";
import type { MordomoPaths } from "../paths.js";
import { reviewsDue } from "../memory/reviews.js";
import { emitSentinel, sentinelDedupeKey, type DedupeLookup, type SentinelFiredPayload } from "./types.js";

/**
 * "These notes are due for review." (.specs/features/cerebro-natureza, door 5, amendment 16.) Once a day, from the
 * hourly pass, one notification when at least one file of the whole brain fell due; no model, no network. The count
 * is shown up to `memory.reviews.maxPerDay`, and as "<max>+" above it.
 */

/** The payload for `count` due files, or null when there is none. */
export function reviewDueAlert(count: number, maxPerDay: number, now: number): SentinelFiredPayload | null {
  if (count <= 0) return null;
  const display = count > maxPerDay ? `${maxPerDay}+` : String(count);
  return {
    sentinel: "reviewDue",
    title: `${display} items to review`,
    body: "Notes whose review date has passed are waiting in Reviews: confirm, update, snooze or let them go.",
    severity: "info",
    href: "/brain/reviews",
    dedupeKey: sentinelDedupeKey("reviewDue", "all", now),
    messageParams: { count, display },
  };
}

export interface ReviewDueDeps {
  db: Db;
  paths: MordomoPaths;
  getSettings: () => Settings;
  bus: EventBus;
  dedupe?: DedupeLookup;
  now?: () => number;
}

/** The hourly check: emits at most one `sentinel.fired` a day. Returns what it emitted. */
export function checkReviewDue(deps: ReviewDueDeps): SentinelFiredPayload[] {
  const now = deps.now?.() ?? Date.now();
  const settings = deps.getSettings();
  const key = sentinelDedupeKey("reviewDue", "all", now);
  if (deps.dedupe?.hasDedupeKey(key)) return [];
  const { total } = reviewsDue(deps.db, { paths: deps.paths, settings }, { kind: "due", limit: 1, now });
  const payload = reviewDueAlert(total, settings.memory.reviews.maxPerDay, now);
  return payload ? [emitSentinel(deps.bus, payload)] : [];
}

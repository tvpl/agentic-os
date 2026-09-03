import type { ActiveHours, Every, Routine } from "./types.js";

/**
 * Pure schedule math for the non-cron kinds (`at`, `every`, `heartbeat`).
 * Cron stays with croner (injected as `cronNext`), everything else is plain
 * arithmetic so the same rules can be mirrored in the UI preview.
 */

export const MINUTE = 60_000;

export function intervalMs(every: Every): number {
  return every.value * (every.unit === "hours" ? 60 * MINUTE : MINUTE);
}

/** Next slot strictly after `now` on the grid `anchor + k·interval`. */
export function nextIntervalSlot(anchor: number, interval: number, now: number): number {
  if (interval <= 0) return now + MINUTE;
  if (now < anchor) return anchor;
  const k = Math.floor((now - anchor) / interval) + 1;
  return anchor + k * interval;
}

/** Wall-clock minutes since midnight of `instant` in `tz` (UTC when the zone is unknown). */
export function wallMinutes(instant: number, tz: string): number {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hourCycle: "h23", hour: "numeric", minute: "numeric" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", hour: "numeric", minute: "numeric" });
  }
  let h = 0;
  let m = 0;
  for (const part of fmt.formatToParts(new Date(instant))) {
    if (part.type === "hour") h = Number(part.value) % 24;
    if (part.type === "minute") m = Number(part.value);
  }
  return h * 60 + m;
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Whether `instant` falls inside the active window (overnight windows wrap past midnight). */
export function isWithinActiveHours(instant: number, hours: ActiveHours | null | undefined, fallbackTz: string): boolean {
  if (!hours) return true;
  const tz = hours.tz || fallbackTz;
  const now = wallMinutes(instant, tz);
  const start = hhmmToMinutes(hours.start);
  const end = hhmmToMinutes(hours.end);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // overnight, e.g. 22:00 → 06:00
}

/** Next `every` firing after `now` (anchored at createdAt). */
export function nextEveryRun(routine: Routine, now: number): number | null {
  if (!routine.every) return null;
  return nextIntervalSlot(routine.createdAt, intervalMs(routine.every), now);
}

/** Next heartbeat slot after `now` that lies inside the active hours (bounded search: 3 days). */
export function nextHeartbeatRun(routine: Routine, now: number, fallbackTz: string): number | null {
  if (!routine.heartbeat) return null;
  const interval = routine.heartbeat.intervalMinutes * MINUTE;
  let candidate = nextIntervalSlot(routine.createdAt, interval, now);
  const limit = now + 3 * 86_400_000;
  for (let i = 0; i < 10_000 && candidate <= limit; i++) {
    if (isWithinActiveHours(candidate, routine.heartbeat.activeHours, fallbackTz)) return candidate;
    candidate += interval;
  }
  return null;
}

/** One-shot: the instant itself while it is still in the future. */
export function nextAtRun(routine: Routine, now: number): number | null {
  if (!routine.at) return null;
  const ms = Date.parse(routine.at);
  if (!Number.isFinite(ms)) return null;
  return ms > now ? ms : null;
}

/**
 * Next firing for any kind. `cronNext` resolves cron expressions (croner on
 * the server). Disabled routines and event-driven kinds return null.
 */
export function nextRunFor(
  routine: Routine,
  now: number,
  fallbackTz: string,
  cronNext: (schedule: string, timezone: string, from: number) => number | null,
): number | null {
  if (!routine.enabled) return null;
  switch (routine.kind) {
    case "cron":
      return cronNext(routine.schedule, routine.timezone || fallbackTz, now);
    case "at":
      return nextAtRun(routine, now);
    case "every":
      return nextEveryRun(routine, now);
    case "heartbeat":
      return nextHeartbeatRun(routine, now, routine.timezone || fallbackTz);
    case "on-exit":
      return null;
  }
}

/** Start of the current day in `tz` (ms). Used for "fired today" counting. */
export function startOfDayIn(instant: number, tz: string): number {
  const minutes = wallMinutes(instant, tz);
  const seconds = Math.floor(instant / 1000) % 60;
  const millis = instant % 1000;
  return instant - minutes * MINUTE - seconds * 1000 - millis;
}

/** Whether a heartbeat run's summary carries the OK token (case-sensitive, whole token). */
export function isHeartbeatOk(summary: string, okToken: string): boolean {
  return summary.includes(okToken);
}

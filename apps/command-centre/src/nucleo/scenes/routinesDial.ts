/**
 * The Routines scene's day dial, as pure maths: where an instant sits on a
 * 24-hour clock face, when a routine fires within one local day, and which
 * routine is next. The dial is drawn in the browser's local time; each
 * routine keeps its own timezone for *when* it fires. The server stays the
 * source of truth for `nextRunAt`; everything here is for drawing.
 */
import {
  intervalMs,
  isValidCron,
  isValidTimeZone,
  isWithinActiveHours,
  nextFires,
  nextIntervalSlot,
  parseCron,
  wallMinutes,
  type SchedulableRoutine,
} from "../../views/cron";

export const DAY_MIN = 1440;
const HOUR_MS = 3_600_000;
/** More firings a day than this and the routine is a cadence, not a set of moments. */
export const DENSE_FIRES = 24;
/** Never enumerate more than one firing a minute. */
const MAX_FIRES = DAY_MIN;

/* ---- the clock face -------------------------------------------------------- */

/** Local midnight of the day that contains `now`. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** The next local midnight (a DST day is 23 or 25 hours long). */
export function endOfLocalDay(now: number): number {
  const d = new Date(startOfLocalDay(now));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Minutes since local midnight, fractional. */
export function localMinutes(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** Minutes of the day → SVG degrees: midnight at the top, clockwise (0° is +x). */
export function minuteAngle(min: number): number {
  return (min / DAY_MIN) * 360 - 90;
}

/** A point on a circle of radius `r` around (`c`, `c`). Rounded for stable markup. */
export function polar(c: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [round(c + Math.cos(rad) * r), round(c + Math.sin(rad) * r)];
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Clockwise arc from angle `a0` to `a1` (degrees). `a1` before `a0` wraps
 * past the top; a sweep of a full turn or more draws the whole circle.
 */
export function arcPath(c: number, r: number, a0: number, a1: number): string {
  let sweep = a1 - a0;
  while (sweep < 0) sweep += 360;
  if (sweep === 0) return "";
  if (sweep >= 360) {
    const [x0, y0] = polar(c, r, a0);
    const [x1, y1] = polar(c, r, a0 + 180);
    return `M${x0} ${y0} A${r} ${r} 0 1 1 ${x1} ${y1} A${r} ${r} 0 1 1 ${x0} ${y0}`;
  }
  const [x0, y0] = polar(c, r, a0);
  const [x1, y1] = polar(c, r, a0 + sweep);
  return `M${x0} ${y0} A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/* ---- firings within a window ----------------------------------------------- */

interface TzDay {
  y: number;
  mo: number;
  d: number;
  dow: number;
  /** wall − utc, in ms, sampled at noon. */
  offset: number;
}
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const formats = new Map<string, Intl.DateTimeFormat>();
function tzDay(noon: number, tz: string | undefined): TzDay {
  const key = tz ?? "";
  let fmt = formats.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || undefined,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formats.set(key, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(noon))) p[part.type] = part.value;
  const y = Number(p.year);
  const mo = Number(p.month);
  const d = Number(p.day);
  const wall = Date.UTC(y, mo - 1, d, Number(p.hour) % 24, Number(p.minute));
  return { y, mo, d, dow: DOW.indexOf((p.weekday ?? "sun").toLowerCase()), offset: wall - noon };
}

/**
 * Every firing of a 5-field cron in [`from`, `to`), evaluated in `tz`
 * (the browser's zone when empty). Same rules as the editor's preview
 * (`views/cron.ts`): DST approximated per day, `dom`/`dow` OR-ed when both
 * are restricted. Invalid expressions fire never.
 */
export function cronFiresBetween(expr: string, tz: string | undefined, from: number, to: number): number[] {
  if (!isValidCron(expr) || !isValidTimeZone(tz ?? "")) return [];
  const spec = parseCron(expr);
  const hours = [...spec.hour].sort((a, b) => a - b);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  const out = new Set<number>();
  const first = Math.floor(from / 86_400_000) * 86_400_000 - 86_400_000;
  for (let day = first; day < to + 86_400_000; day += 86_400_000) {
    const w = tzDay(day + 43_200_000, tz || undefined);
    if (!spec.month.has(w.mo)) continue;
    const domOk = spec.dom.has(w.d);
    const dowOk = spec.dow.has(w.dow);
    const dayOk =
      spec.domAny && spec.dowAny ? true : spec.domAny ? dowOk : spec.dowAny ? domOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of hours) {
      for (const mi of minutes) {
        const instant = Date.UTC(w.y, w.mo - 1, w.d, h, mi) - w.offset;
        if (instant >= from && instant < to) out.add(instant);
        if (out.size >= MAX_FIRES) return [...out].sort((a, b) => a - b);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** A routine as the dial needs it (a `RoutineStatus` fits). */
export interface DialRoutine extends SchedulableRoutine {
  id: string;
  enabled: boolean;
  nextRunAt?: number | null;
}

/** Every firing of `r` in [`from`, `to`), whatever its kind. `on-exit` never fires on a clock. */
export function firesBetween(r: SchedulableRoutine, from: number, to: number): number[] {
  const kind = r.kind ?? "cron";
  const anchor = r.createdAt ?? from;
  switch (kind) {
    case "cron":
      return cronFiresBetween((r.schedule ?? "").trim(), r.timezone || undefined, from, to);
    case "at": {
      const ms = r.at ? Date.parse(r.at) : NaN;
      return Number.isFinite(ms) && ms >= from && ms < to ? [ms] : [];
    }
    case "every": {
      if (!r.every) return [];
      return grid(anchor, intervalMs(r.every), from, to);
    }
    case "heartbeat": {
      const hb = r.heartbeat;
      if (!hb || !(hb.intervalMinutes > 0)) return [];
      return grid(anchor, hb.intervalMinutes * 60_000, from, to).filter((ts) =>
        isWithinActiveHours(ts, hb.activeHours, r.timezone),
      );
    }
    case "on-exit":
      return [];
  }
}
function grid(anchor: number, step: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let ts = nextIntervalSlot(anchor, step, from - 1); ts < to && out.length < MAX_FIRES; ts += step)
    out.push(ts);
  return out;
}

/** How a routine is drawn on the dial for one day. */
export type DayMarks =
  /** A few moments: one marker each. */
  | { kind: "points"; times: number[] }
  /** A cadence: a dotted run on its own lane. */
  | { kind: "run"; times: number[]; stepMin: number }
  /** A heartbeat: its active hours as a band (local minutes; `end` < `start` wraps midnight). */
  | { kind: "band"; times: number[]; start: number; end: number }
  /** Event-driven (`on-exit`) or nothing today. */
  | { kind: "none" };

export function dayMarks(r: SchedulableRoutine, dayStart: number, dayEnd: number): DayMarks {
  const kind = r.kind ?? "cron";
  if (kind === "on-exit") return { kind: "none" };
  const times = firesBetween(r, dayStart, dayEnd);
  if (kind === "heartbeat") {
    const band = heartbeatBand(r, dayStart);
    return { kind: "band", times, start: band.start, end: band.end };
  }
  if (times.length === 0) return { kind: "none" };
  if (kind === "every" || times.length > DENSE_FIRES) {
    const step = kind === "every" && r.every ? intervalMs(r.every) : medianStep(times);
    return { kind: "run", times, stepMin: Math.max(1, Math.round(step / 60_000)) };
  }
  return { kind: "points", times };
}
function medianStep(times: number[]): number {
  if (times.length < 2) return HOUR_MS;
  const steps = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)]!;
}

/**
 * A heartbeat's active hours in the dial's local minutes (the window is
 * written in its own zone). No window, or an empty one, is the whole day.
 */
export function heartbeatBand(r: SchedulableRoutine, dayStart: number): { start: number; end: number } {
  const hours = r.heartbeat?.activeHours;
  if (!hours) return { start: 0, end: DAY_MIN };
  const start = hhmm(hours.start);
  const end = hhmm(hours.end);
  if (start === end) return { start: 0, end: DAY_MIN };
  const midday = dayStart + 12 * HOUR_MS;
  const tz = hours.tz || r.timezone || undefined;
  const delta = wallMinutes(midday, tz) - Math.round(localMinutes(midday));
  const toLocal = (m: number) => (((m - delta) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return { start: toLocal(start), end: toLocal(end) };
}
function hhmm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (Number.isFinite(h) ? h! : 0) * 60 + (Number.isFinite(m) ? m! : 0);
}

/* ---- next ------------------------------------------------------------------ */

/**
 * When `r` fires next after `now`: the server's `nextRunAt` when it is still
 * ahead, otherwise the local preview. Paused and event-driven routines have
 * no next.
 */
export function nextFiring(r: DialRoutine, now: number): number | null {
  if (!r.enabled || (r.kind ?? "cron") === "on-exit") return null;
  if (typeof r.nextRunAt === "number" && r.nextRunAt > now) return r.nextRunAt;
  return nextFires(r, now, 1)[0] ?? null;
}

/** The routine that fires soonest, and when. Ties go to the first in the list. */
export function pickNext<T extends DialRoutine>(
  routines: readonly T[],
  now: number,
): { routine: T; at: number } | null {
  let best: { routine: T; at: number } | null = null;
  for (const routine of routines) {
    const at = nextFiring(routine, now);
    if (at !== null && (!best || at < best.at)) best = { routine, at };
  }
  return best;
}

/** The agenda order: soonest next firing first; paused and event-driven ones after, by name. */
export function agendaOrder<T extends DialRoutine & { name: string }>(
  routines: readonly T[],
  now: number,
): T[] {
  const keyed = routines.map((r) => ({ r, at: nextFiring(r, now) }));
  keyed.sort((a, b) => {
    if (a.at !== null && b.at !== null) return a.at - b.at || a.r.name.localeCompare(b.r.name);
    if (a.at !== null) return -1;
    if (b.at !== null) return 1;
    if (a.r.enabled !== b.r.enabled) return a.r.enabled ? -1 : 1;
    return a.r.name.localeCompare(b.r.name);
  });
  return keyed.map((k) => k.r);
}

/* ---- what happened --------------------------------------------------------- */

export type FireOutcome = "ok" | "fail" | "live" | "skip";

/** One history entry (or a routine's `lastStatus`) as a result on the dial and the list. */
export function fireOutcome(runStatus: string | null | undefined, status?: string | null): FireOutcome {
  const s = runStatus ?? status ?? "";
  if (s === "done" || s === "fired" || s === "caught_up") return "ok";
  if (s === "failed" || s === "timed_out" || s === "error") return "fail";
  if (s === "running" || s === "queued" || s === "waiting_approval" || s === "pending") return "live";
  return "skip";
}

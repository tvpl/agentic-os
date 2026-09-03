/**
 * Minimal 5-field cron support for the routine editor: validation with a
 * human message and a "next N runs" preview in a given IANA timezone.
 * Supports `*`, `a`, `a-b`, `*\/n`, `a-b/n`, lists, and month/weekday names.
 * DST is approximated per day (offset sampled at noon), which is enough for
 * a preview; the server (croner) remains the source of truth.
 */
export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseField(raw: string, min: number, max: number, names: string[] | null, label: string): { set: Set<number>; any: boolean } {
  const set = new Set<number>();
  const val = (token: string): number => {
    const lower = token.toLowerCase();
    if (names) {
      const idx = names.indexOf(lower);
      if (idx >= 0) return idx + (names === MONTHS ? 1 : 0);
    }
    if (!/^\d+$/.test(token)) throw new Error(`${label}: "${token}"`);
    const n = Number(token);
    if (n < min || n > max) throw new Error(`${label}: ${n} ∉ [${min}, ${max}]`);
    return n;
  };
  let any = false;
  for (const part of raw.split(",")) {
    const m = part.match(/^([^/]+)(?:\/(\d+))?$/);
    if (!m || !part) throw new Error(`${label}: "${part}"`);
    const [, range, stepRaw] = m;
    const step = stepRaw ? Number(stepRaw) : 1;
    if (step < 1) throw new Error(`${label}: step ${step}`);
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
      if (!stepRaw) any = true;
    } else if (range!.includes("-")) {
      const [a, b] = range!.split("-");
      lo = val(a!);
      hi = val(b!);
      if (lo > hi) throw new Error(`${label}: ${a}-${b}`);
    } else {
      lo = val(range!);
      hi = stepRaw ? max : lo;
    }
    for (let v = lo; v <= hi; v += step) set.add(v === 7 && max === 7 ? 0 : v);
  }
  return { set, any };
}

export function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("5 fields expected");
  const minute = parseField(fields[0]!, 0, 59, null, "minute");
  const hour = parseField(fields[1]!, 0, 23, null, "hour");
  const dom = parseField(fields[2]!, 1, 31, null, "day");
  const month = parseField(fields[3]!, 1, 12, MONTHS, "month");
  const dow = parseField(fields[4]!, 0, 7, DAYS, "weekday");
  return { minute: minute.set, hour: hour.set, dom: dom.set, month: month.set, dow: dow.set, domAny: dom.any, dowAny: dow.any };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return true; // inherit
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  dow: number;
}

function wallParts(instant: number, tz: string | undefined): WallParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || undefined,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(instant))) p[part.type] = part.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), dow: DAYS.indexOf((p.weekday ?? "sun").toLowerCase()) };
}

/** Next `count` firing instants (ms) after `from`, or [] when nothing matches within ~400 days. */
export function nextCronRuns(expr: string, tz: string | undefined, count = 3, from = Date.now()): number[] {
  const spec = parseCron(expr);
  const out: number[] = [];
  const startDay = Math.floor(from / 86_400_000) * 86_400_000;
  for (let day = 0; day < 400 && out.length < count; day++) {
    const noon = startDay + day * 86_400_000 + 43_200_000;
    const w = wallParts(noon, tz);
    const offset = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - noon; // wall - utc
    if (!spec.month.has(w.mo)) continue;
    const domOk = spec.dom.has(w.d);
    const dowOk = spec.dow.has(w.dow);
    const dayOk = spec.domAny && spec.dowAny ? true : spec.domAny ? dowOk : spec.dowAny ? domOk : domOk || dowOk;
    if (!dayOk) continue;
    for (const h of [...spec.hour].sort((a, b) => a - b)) {
      for (const mi of [...spec.minute].sort((a, b) => a - b)) {
        const instant = Date.UTC(w.y, w.mo - 1, w.d, h, mi) - offset;
        if (instant > from) {
          out.push(instant);
          if (out.length >= count) return out;
        }
      }
    }
  }
  return out;
}

export function timeZoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : ["UTC"];
  } catch {
    return ["UTC"];
  }
}

/* -------------------------------------------------------------------------
 * Routines v2: schedule kinds beyond cron.
 *
 * Mirrors core/src/routines/schedule.ts so the editor can preview the next
 * fires without a round-trip. The server (croner + that module) stays the
 * source of truth; this is a preview.
 * ---------------------------------------------------------------------- */

export type ScheduleKind = "cron" | "at" | "every" | "on-exit" | "heartbeat";

export interface ScheduleEvery {
  value: number;
  unit: "minutes" | "hours";
}
export interface ScheduleActiveHours {
  start: string;
  end: string;
  tz?: string;
}
export interface ScheduleHeartbeat {
  intervalMinutes: number;
  activeHours?: ScheduleActiveHours | null;
  okToken?: string;
}
export interface ScheduleOnExit {
  skillSlug: string;
  statuses?: string[];
}

/** The subset of a routine `nextFires`/`describeSchedule` need. */
export interface SchedulableRoutine {
  kind?: ScheduleKind;
  schedule?: string;
  timezone?: string;
  at?: string | null;
  every?: ScheduleEvery | null;
  onExit?: ScheduleOnExit | null;
  heartbeat?: ScheduleHeartbeat | null;
  createdAt?: number;
  enabled?: boolean;
}

export const MINUTE_MS = 60_000;

export function intervalMs(every: ScheduleEvery): number {
  return Math.max(1, Math.floor(every.value)) * (every.unit === "hours" ? 60 * MINUTE_MS : MINUTE_MS);
}

/** Next slot strictly after `now` on the grid `anchor + k·interval`. */
export function nextIntervalSlot(anchor: number, interval: number, now: number): number {
  if (interval <= 0) return now + MINUTE_MS;
  if (now < anchor) return anchor;
  return anchor + (Math.floor((now - anchor) / interval) + 1) * interval;
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (Number.isFinite(h) ? h! : 0) * 60 + (Number.isFinite(m) ? m! : 0);
}

/** Wall-clock minutes since midnight of `instant` in `tz` (UTC when the zone is unknown). */
export function wallMinutes(instant: number, tz: string | undefined): number {
  const w = wallParts(instant, isValidTimeZone(tz ?? "") ? tz : "UTC");
  return w.h * 60 + w.mi;
}

/** Whether `instant` falls inside the window (windows that wrap past midnight are supported). */
export function isWithinActiveHours(
  instant: number,
  hours: ScheduleActiveHours | null | undefined,
  fallbackTz: string | undefined,
): boolean {
  if (!hours) return true;
  const now = wallMinutes(instant, hours.tz || fallbackTz);
  const start = hhmmToMinutes(hours.start);
  const end = hhmmToMinutes(hours.end);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

/**
 * Next `count` firing instants after `from` for any schedule kind.
 * `on-exit` is event-driven and never returns fires.
 */
export function nextFires(routine: SchedulableRoutine, from = Date.now(), count = 5): number[] {
  const kind = routine.kind ?? "cron";
  const tz = routine.timezone || undefined;
  const anchor = routine.createdAt ?? from;
  switch (kind) {
    case "cron": {
      const expr = (routine.schedule ?? "").trim();
      if (!expr || !isValidCron(expr) || !isValidTimeZone(routine.timezone ?? "")) return [];
      try {
        return nextCronRuns(expr, tz, count, from);
      } catch {
        return [];
      }
    }
    case "at": {
      const ms = routine.at ? Date.parse(routine.at) : NaN;
      return Number.isFinite(ms) && ms > from ? [ms] : [];
    }
    case "every": {
      if (!routine.every) return [];
      const step = intervalMs(routine.every);
      const out: number[] = [];
      let next = nextIntervalSlot(anchor, step, from);
      for (let i = 0; i < count; i++) {
        out.push(next);
        next += step;
      }
      return out;
    }
    case "heartbeat": {
      const hb = routine.heartbeat;
      if (!hb || !(hb.intervalMinutes > 0)) return [];
      const step = hb.intervalMinutes * MINUTE_MS;
      const out: number[] = [];
      let candidate = nextIntervalSlot(anchor, step, from);
      const limit = from + 3 * 86_400_000;
      for (let i = 0; i < 10_000 && out.length < count && candidate <= limit; i++) {
        if (isWithinActiveHours(candidate, hb.activeHours, routine.timezone)) out.push(candidate);
        candidate += step;
      }
      return out;
    }
    case "on-exit":
      return [];
  }
}

/** Translation hook: `describeSchedule` asks for these keys with the given params. */
export type ScheduleDescribe = (key: string, params?: Record<string, string | number>) => string;

/**
 * One-line, human description of a routine's schedule.
 * `t` is the caller's translator (keys live in locales/backend.ts); with no
 * translator the raw key is returned, which keeps this function pure and
 * testable.
 */
export function describeSchedule(routine: SchedulableRoutine, t: ScheduleDescribe = (k) => k): string {
  const kind = routine.kind ?? "cron";
  switch (kind) {
    case "cron": {
      const expr = (routine.schedule ?? "").trim();
      if (!expr) return t("backend.sched.cron.none");
      return isValidCron(expr)
        ? t("backend.sched.cron", { expr })
        : t("backend.sched.cron.invalid", { expr });
    }
    case "at": {
      const ms = routine.at ? Date.parse(routine.at) : NaN;
      if (!Number.isFinite(ms)) return t("backend.sched.at.invalid");
      return t("backend.sched.at", { when: new Date(ms).toISOString().slice(0, 16).replace("T", " ") });
    }
    case "every": {
      if (!routine.every) return t("backend.sched.every.none");
      const { value, unit } = routine.every;
      return t(unit === "hours" ? "backend.sched.every.hours" : "backend.sched.every.minutes", { n: value });
    }
    case "on-exit": {
      const slug = routine.onExit?.skillSlug;
      return slug ? t("backend.sched.onExit", { skill: slug }) : t("backend.sched.onExit.none");
    }
    case "heartbeat": {
      const hb = routine.heartbeat;
      if (!hb) return t("backend.sched.heartbeat.none");
      const hours = hb.activeHours;
      return hours
        ? t("backend.sched.heartbeat.hours", { n: hb.intervalMinutes, start: hours.start, end: hours.end })
        : t("backend.sched.heartbeat", { n: hb.intervalMinutes });
    }
  }
}

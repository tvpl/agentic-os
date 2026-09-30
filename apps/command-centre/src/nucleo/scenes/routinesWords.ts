/**
 * A routine's schedule in words for the Routines scene: "dias úteis às
 * 09:00", "a cada 15 min", "depois de cada execução de /x". The common cron
 * shapes are spelled out; anything else falls back to the editor's own
 * description (`describeSchedule`, "Cron 5 4 * * 2#1"). Pure: the caller
 * passes its translator and locale.
 */
import { describeSchedule, isValidCron, parseCron, type SchedulableRoutine } from "../../views/cron";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A cron read as one of the shapes people say out loud. */
export type CronShape =
  | { k: "everyMinute" }
  | { k: "everyNMin"; n: number }
  | { k: "hourly"; minute: number }
  | { k: "everyNHours"; n: number; minute: number }
  | { k: "times"; times: string[]; days: DayShape }
  | { k: "raw" };

export type DayShape =
  | { k: "daily" }
  | { k: "weekdays" }
  | { k: "weekends" }
  | { k: "dow"; days: number[] }
  | { k: "dom"; day: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** A fixed step (`*\/n` or its expansion) covering the whole range, or null. */
function stepOf(values: number[], min: number, max: number): number | null {
  if (values.length < 2 || values[0] !== min) return null;
  const n = values[1]! - values[0]!;
  for (let i = 1; i < values.length; i++) if (values[i]! - values[i - 1]! !== n) return null;
  return values[values.length - 1]! + n > max ? n : null;
}

export function cronShape(expr: string): CronShape {
  if (!isValidCron(expr)) return { k: "raw" };
  const spec = parseCron(expr);
  const minutes = [...spec.minute].sort((a, b) => a - b);
  const hours = [...spec.hour].sort((a, b) => a - b);
  const allDays = spec.domAny && spec.dowAny && spec.month.size === 12;
  const allHours = hours.length === 24;

  if (allDays && allHours) {
    if (minutes.length === 60) return { k: "everyMinute" };
    const n = stepOf(minutes, 0, 59);
    if (n) return { k: "everyNMin", n };
    if (minutes.length === 1) return { k: "hourly", minute: minutes[0]! };
    return { k: "raw" };
  }
  if (allDays && minutes.length === 1) {
    const n = stepOf(hours, 0, 23);
    if (n && hours.length > 4) return { k: "everyNHours", n, minute: minutes[0]! };
  }
  if (spec.month.size !== 12) return { k: "raw" };
  const times = hours.flatMap((h) => minutes.map((m) => `${pad(h)}:${pad(m)}`));
  if (times.length === 0 || times.length > 4) return { k: "raw" };

  let days: DayShape;
  if (spec.domAny && spec.dowAny) days = { k: "daily" };
  else if (spec.domAny) {
    const dow = [...spec.dow].sort((a, b) => a - b);
    const key = dow.join(",");
    days =
      key === "1,2,3,4,5"
        ? { k: "weekdays" }
        : key === "0,6"
          ? { k: "weekends" }
          : dow.length === 7
            ? { k: "daily" }
            : { k: "dow", days: dow };
  } else if (spec.dowAny && spec.dom.size === 1) days = { k: "dom", day: [...spec.dom][0]! };
  else return { k: "raw" };
  return { k: "times", times, days };
}

/** "seg, qua" for the given weekdays (0 = Sunday), in `locale`. */
export function weekdayNames(days: number[], locale: string): string {
  // 2023-01-01 was a Sunday.
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return days.map((d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d))).replace(/\.$/, "")).join(", ");
}

function joinTimes(times: string[], t: Translate): string {
  if (times.length === 1) return times[0]!;
  return t("scene.routines.w.and", { a: times.slice(0, -1).join(", "), b: times[times.length - 1]! });
}

/**
 * The schedule in words. `localTz` is the browser's zone: a routine that
 * lives in another one says so.
 */
export function scheduleInWords(
  r: SchedulableRoutine,
  t: Translate,
  locale: string,
  localTz = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const kind = r.kind ?? "cron";
  const tzNote = r.timezone && r.timezone !== localTz && kind !== "on-exit" ? ` (${r.timezone})` : "";
  if (kind === "cron") {
    const expr = (r.schedule ?? "").trim();
    const shape = cronShape(expr);
    switch (shape.k) {
      case "everyMinute":
        return t("scene.routines.w.everyMinute");
      case "everyNMin":
        return t("scene.routines.w.everyNMin", { n: shape.n });
      case "hourly":
        return t("scene.routines.w.hourly", { m: pad(shape.minute) });
      case "everyNHours":
        return t("scene.routines.w.everyNHours", { n: shape.n, m: pad(shape.minute) }) + tzNote;
      case "times": {
        const times = joinTimes(shape.times, t);
        const d = shape.days;
        const phrase =
          d.k === "daily"
            ? t("scene.routines.w.daily", { times })
            : d.k === "weekdays"
              ? t("scene.routines.w.weekdays", { times })
              : d.k === "weekends"
                ? t("scene.routines.w.weekends", { times })
                : d.k === "dom"
                  ? t("scene.routines.w.monthly", { d: d.day, times })
                  : t("scene.routines.w.days", { days: weekdayNames(d.days, locale), times });
        return phrase + tzNote;
      }
      case "raw":
        return describeSchedule(r, t);
    }
  }
  if (kind === "at") {
    const ms = r.at ? Date.parse(r.at) : NaN;
    if (!Number.isFinite(ms)) return describeSchedule(r, t);
    const date = new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short" });
    const time = new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return t("scene.routines.w.once", { date, time });
  }
  return describeSchedule(r, t) + (kind === "heartbeat" && r.heartbeat?.activeHours ? tzNote : "");
}

/** How times read in the Runs scene: a clock time today, a date and time before that. Pure. */
import type { TickFormat } from "./runsRiver";

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "03:00" today, "22/09 03:00" (or "22 Sept, 03:00") before. */
export function formatWhen(ts: number, now: number, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = sameDay(ts, now)
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(locale, opts).format(ts);
}

/** "03:00", "seg 22" / "Mon 22", "22 set" / "22 Sept" — the parts only, no locale punctuation between them. */
export function formatTick(ts: number, format: TickFormat, locale: string): string {
  if (format === "time")
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(ts);
  const opts: Intl.DateTimeFormatOptions =
    format === "weekday" ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(locale, opts)
    .formatToParts(ts)
    .filter((p) => p.type !== "literal")
    .map((p) => p.value.replace(/\.$/, ""))
    .join(" ");
}

/** A zoomed window: "06/09 02:26–02:42" within a day, "06/09 02:26 – 07/09 01:10" across days. */
export function formatSpan(from: number, to: number, now: number, locale: string): string {
  const clock = (ts: number) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(ts);
  if (sameDay(from, to)) {
    const day = sameDay(from, now)
      ? ""
      : `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(from)} `;
    return `${day}${clock(from)}–${clock(to)}`;
  }
  return `${formatWhen(from, now, locale)} – ${formatWhen(to, now, locale)}`;
}

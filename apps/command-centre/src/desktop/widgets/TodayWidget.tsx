/**
 * "Today" (RUBRIC 1.5): analog mini clock beside the digital time, week and
 * date line, three configurable time zones in columns with their weekday, the
 * 4 × 13 week-of-quarter grid with the current week accented, and
 * "what's next" from the routines.
 */
import { Link } from "react-router-dom";
import type { RoutineStatus } from "../../api";
import { useLocale, useT } from "../../i18n";
import { useDesktopRoutines, useTicker } from "../data";
import { cfgBool, cfgString, type WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

export default function TodayWidget({ config }: WidgetProps) {
  const routines = useDesktopRoutines();
  return (
    <WidgetGate queries={[routines]} lines={4}>
      {routines.data && (
        <TodayBody
          routines={routines.data}
          analog={cfgBool(config, "analog", true)}
          seconds={cfgBool(config, "seconds", true)}
          quarterGrid={cfgBool(config, "quarterGrid", true)}
          zones={[
            cfgString(config, "zone1", "America/Los_Angeles"),
            cfgString(config, "zone2", "America/New_York"),
            cfgString(config, "zone3", "Europe/London"),
          ]}
        />
      )}
    </WidgetGate>
  );
}

interface TodayBodyProps {
  routines: RoutineStatus[];
  analog: boolean;
  seconds: boolean;
  quarterGrid: boolean;
  zones: string[];
}

function TodayBody({ routines, analog, seconds, quarterGrid, zones }: TodayBodyProps) {
  const t = useT();
  const locale = useLocale();
  const now = new Date(useTicker(1000));
  const week = isoWeek(now);
  const dateLine = now.toLocaleDateString(locale, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    weekday: "short",
  });
  const upcoming = routines
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 3);

  return (
    <>
      <div className="hud-label accent">
        {t("clock.week")}
        {week} | {dateLine}
      </div>
      <div className="clock-main">
        {analog && <AnalogClock date={now} />}
        <div className="display-digits clock-time" role="timer">
          {now.toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
            ...(seconds ? { second: "2-digit" } : {}),
            hour12: false,
          })}
        </div>
      </div>
      <div className="clock-zones" aria-label={t("desktop.today.zones")}>
        {zones.filter(Boolean).map((zone) => (
          <ZoneColumn key={zone} zone={zone} now={now} locale={locale} />
        ))}
      </div>
      {quarterGrid && <QuarterGrid week={week} label={t("desktop.today.quarter")} />}
      <div className="hud-label whats-next">{t("dash.whatsNext")}</div>
      {upcoming.length === 0 ? (
        <p className="widget-muted">{t("dash.noNext")}</p>
      ) : (
        upcoming.map((r) => (
          <div className="list-row tight" key={r.id}>
            <Link to="/routines" className="truncate plain">
              {r.name}
            </Link>
            <span className="mono accent-text">
              {r.nextRunAt
                ? new Date(r.nextRunAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
                : "—"}
            </span>
          </div>
        ))
      )}
    </>
  );
}

/** One time-zone column: time, weekday and the city taken from the IANA id. */
function ZoneColumn({ zone, now, locale }: { zone: string; now: Date; locale: string }) {
  let time = "—";
  let day = "";
  try {
    time = now.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone,
    });
    day = now.toLocaleDateString(locale, { weekday: "short", timeZone: zone });
  } catch {
    /* an invalid zone in the config must not break the widget */
  }
  return (
    <div className="zone">
      <div className="z-time tnum">{time}</div>
      <div className="z-day">{day}</div>
      <div className="z-label" title={zone}>
        {zone.split("/").pop()?.replace(/_/g, " ")}
      </div>
    </div>
  );
}

/** Hands as pure rotations: no per-frame layout, one re-render per second. */
export function clockAngles(date: Date): { hour: number; minute: number; second: number } {
  const s = date.getSeconds();
  const m = date.getMinutes() + s / 60;
  const h = (date.getHours() % 12) + m / 60;
  return { hour: h * 30, minute: m * 6, second: s * 6 };
}

function AnalogClock({ date }: { date: Date }) {
  const t = useT();
  const a = clockAngles(date);
  return (
    <svg className="mini-clock" viewBox="0 0 40 40" role="img" aria-label={t("desktop.today.clock")}>
      <circle cx="20" cy="20" r="18.5" className="mc-face" />
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          x1="20"
          y1="3.5"
          x2="20"
          y2={i % 3 === 0 ? 7 : 5.5}
          className="mc-tick"
          transform={`rotate(${i * 30} 20 20)`}
        />
      ))}
      <line x1="20" y1="20" x2="20" y2="11" className="mc-hour" transform={`rotate(${a.hour} 20 20)`} />
      <line x1="20" y1="20" x2="20" y2="7.5" className="mc-minute" transform={`rotate(${a.minute} 20 20)`} />
      <line x1="20" y1="22" x2="20" y2="6.5" className="mc-second" transform={`rotate(${a.second} 20 20)`} />
      <circle cx="20" cy="20" r="1.4" className="mc-pin" />
    </svg>
  );
}

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Q1–Q4 × 13 weeks; the current week is accented, past weeks are filled. */
function QuarterGrid({ week, label }: { week: number; label: string }) {
  return (
    <div className="q-grid" role="img" aria-label={`${label}: ${week}`}>
      {[0, 1, 2, 3].map((q) => (
        <div className="q-row" key={q}>
          <span className="q-label">Q{q + 1}</span>
          {Array.from({ length: 13 }, (_, i) => {
            const w = q * 13 + i + 1;
            return <span key={i} className={`qd ${w === week ? "now" : w < week ? "past" : ""}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

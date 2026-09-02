import { Link } from "react-router-dom";
import type { RoutineStatus } from "../../api";
import { useLocale, useT } from "../../i18n";
import { useDesktopRoutines, useTicker } from "../data";
import { WidgetGate } from "./WidgetGate";

export default function TodayWidget() {
  const routines = useDesktopRoutines();
  return (
    <WidgetGate queries={[routines]} lines={4}>
      {routines.data && <TodayBody routines={routines.data} />}
    </WidgetGate>
  );
}

function TodayBody({ routines }: { routines: RoutineStatus[] }) {
  const t = useT();
  const locale = useLocale();
  const now = new Date(useTicker(1000));
  const week = isoWeek(now);
  const dateLine = now.toLocaleDateString(locale, { month: "short", day: "2-digit", year: "numeric", weekday: "short" });
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const otherZone = routines.find((r) => r.timezone && r.timezone !== localZone)?.timezone;
  const upcoming = routines
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 3);
  const hm = (tz?: string) => now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  return (
    <>
      <div className="hud-label accent">
        {t("clock.week")}
        {week} | {dateLine}
      </div>
      <div className="display-digits clock-time" role="timer">
        {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </div>
      <div className="clock-zones">
        <div className="zone">
          <div className="z-time">{hm("UTC")}</div>
          <div className="z-label">UTC</div>
        </div>
        {otherZone && (
          <div className="zone">
            <div className="z-time">{hm(otherZone)}</div>
            <div className="z-label">{otherZone.split("/").pop()?.replace(/_/g, " ")}</div>
          </div>
        )}
      </div>
      <QuarterDots week={week} />
      <div className="hud-label whats-next">{t("dash.whatsNext")}</div>
      {upcoming.length === 0 ? (
        <p className="widget-muted">{t("dash.noNext")}</p>
      ) : (
        upcoming.map((r) => (
          <div className="list-row tight" key={r.id}>
            <Link to="/routines" className="truncate plain">
              {r.name}
            </Link>
            <span className="mono accent-text">{r.nextRunAt ? new Date(r.nextRunAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
          </div>
        ))
      )}
    </>
  );
}

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function QuarterDots({ week }: { week: number }) {
  return (
    <div className="q-dots" aria-hidden>
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

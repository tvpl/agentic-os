/**
 * Agenda: a horizontal timeline of upcoming routine fires — 24 h by default,
 * 7 days with a toggle — computed from each routine's cron (`nextCronRuns`)
 * with `nextRunAt` as the fallback; current-time marker, hover tooltip,
 * click → /routines.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import type { RoutineStatus } from "../../api";
import { useLocale, useT } from "../../i18n";
import { EmptyState, Segmented } from "../../components/primitives";
import { isValidCron, nextCronRuns } from "../../views/cron";
import { useDesktopRoutines, useTicker } from "../data";
import { cfgString, type WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

type Span = "24h" | "7d";
const SPAN_MS: Record<Span, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000 };

export interface AgendaFire {
  id: string;
  name: string;
  at: number;
  enabled: boolean;
  runner: string;
}

/** Fires in [from, from+span) for every enabled routine; paused ones contribute their `nextRunAt` only. */
export function agendaFires(routines: RoutineStatus[], from: number, spanMs: number, perRoutine = 12): AgendaFire[] {
  const out: AgendaFire[] = [];
  const to = from + spanMs;
  for (const r of routines) {
    const runner = (r as RoutineStatus & { runner?: string }).runner ?? "local";
    let times: number[] = [];
    if (r.enabled && r.schedule && isValidCron(r.schedule)) {
      try {
        times = nextCronRuns(r.schedule, r.timezone || undefined, perRoutine, from).filter((x) => x < to);
      } catch {
        times = [];
      }
    }
    if (times.length === 0 && r.nextRunAt && r.nextRunAt >= from && r.nextRunAt < to) times = [r.nextRunAt];
    for (const at of times) out.push({ id: r.id, name: r.name, at, enabled: r.enabled, runner });
  }
  return out.sort((a, b) => a.at - b.at);
}

export default function AgendaWidget({ config }: WidgetProps) {
  const routines = useDesktopRoutines();
  return (
    <WidgetGate queries={[routines]} lines={2}>
      {routines.data && <AgendaBody routines={routines.data} defaultSpan={cfgString(config, "span", "24h") === "7d" ? "7d" : "24h"} />}
    </WidgetGate>
  );
}

function AgendaBody({ routines, defaultSpan }: { routines: RoutineStatus[]; defaultSpan: Span }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const now = useTicker(30_000);
  const [span, setSpan] = useState<Span>(defaultSpan);
  const [hover, setHover] = useState<number | null>(null);
  const spanMs = SPAN_MS[span];
  const from = span === "24h" ? now : new Date(now).setHours(0, 0, 0, 0);
  const fires = useMemo(() => agendaFires(routines, from, spanMs), [routines, from, spanMs]);

  const ticks = useMemo(() => {
    const out: Array<{ pct: number; label: string }> = [];
    if (span === "24h") {
      const first = new Date(from);
      first.setMinutes(0, 0, 0);
      for (let i = 0; i <= 24; i += 3) {
        const at = first.getTime() + i * 3_600_000;
        if (at < from || at > from + spanMs) continue;
        out.push({ pct: ((at - from) / spanMs) * 100, label: new Date(at).toLocaleTimeString(locale, { hour: "2-digit" }) });
      }
    } else {
      for (let d = 0; d < 7; d++) {
        const at = from + d * 86_400_000;
        out.push({ pct: (d / 7) * 100, label: new Date(at).toLocaleDateString(locale, { weekday: "short" }) });
      }
    }
    return out;
  }, [span, from, spanMs, locale]);

  if (routines.length === 0) {
    return <EmptyState className="compact" icon={<CalendarClock aria-hidden />} title={t("board.empty")} body={t("board.emptyBody")} />;
  }
  const nowPct = Math.max(0, Math.min(100, ((now - from) / spanMs) * 100));
  const fmt = (at: number) =>
    span === "24h"
      ? new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : new Date(at).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const hovered = hover !== null ? fires[hover] : undefined;
  return (
    <div className="agenda">
      <div className="agenda-head">
        <span className="hud-label">{t("desktop.agenda.upcoming", { n: fires.length })}</span>
        <Segmented size="sm" ariaLabel={t("desktop.agenda.span")} value={span} onChange={setSpan} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />
      </div>
      <div className="agenda-track" role="list" aria-label={t("desktop.agenda.title")}>
        {ticks.map((tick) => (
          <span key={tick.label + tick.pct} className="agenda-tick" style={{ left: `${tick.pct}%` }} aria-hidden>
            {tick.label}
          </span>
        ))}
        <span className="agenda-now" style={{ left: `${nowPct}%` }} aria-hidden />
        {fires.map((f, i) => (
          <button
            key={`${f.id}-${f.at}`}
            type="button"
            role="listitem"
            className={`agenda-dot runner-${f.runner}${f.enabled ? "" : " paused"}${hover === i ? " hover" : ""}`}
            style={{ left: `${((f.at - from) / spanMs) * 100}%` }}
            aria-label={`${f.name} · ${fmt(f.at)}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => navigate("/routines")}
          />
        ))}
        {hovered && (
          <div className="agenda-tip" role="tooltip" style={{ left: `${Math.min(80, ((hovered.at - from) / spanMs) * 100)}%` }}>
            <strong className="truncate">{hovered.name}</strong>
            <span className="mono">{fmt(hovered.at)}</span>
          </div>
        )}
      </div>
      {fires.length === 0 && <p className="widget-muted">{t("desktop.agenda.none")}</p>}
    </div>
  );
}

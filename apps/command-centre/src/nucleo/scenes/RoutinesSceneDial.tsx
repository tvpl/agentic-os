/**
 * The Routines scene's dial: the day as a 24-hour clock face. Midnight at
 * the top, a tick every 15 minutes, the night as a faint band, the amber
 * "now" hand, each routine at its time(s) today, the next firing in cyan
 * with an arc from now to it, and today's past firings as ok/fail dots on
 * an inner ring. Markers are buttons; the colours are CSS tokens (light
 * theme included), the maths is in `routinesDial.ts`.
 */
import type { KeyboardEvent } from "react";
import { useLocale, useT } from "../../i18n";
import { arcPath, localMinutes, minuteAngle, polar, type DayMarks, type FireOutcome } from "./routinesDial";

const C = 300;
const R = 228;
const MARK_R = R - 20;
const LABEL_R = R - 46;
const LANES = [166, 155, 144];
const PAST_R = 131;
export const DISC_R = 120;
/** 22:00 → 06:00. */
const NIGHT = [22 * 60, 6 * 60] as const;

export interface DialRoutineView {
  id: string;
  name: string;
  enabled: boolean;
  unhealthy: boolean;
  marks: DayMarks;
  /** The schedule in words, for the cadence lanes' names. */
  words: string;
}
export interface PastFire {
  key: string;
  routineId: string;
  name: string;
  at: number;
  outcome: FireOutcome;
  runId: string | null;
}

export interface RoutinesSceneDialProps {
  routines: DialRoutineView[];
  past: PastFire[];
  now: number;
  next: { id: string; at: number } | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenRun: (runId: string) => void;
}

const angleOf = (ts: number) => minuteAngle(localMinutes(ts));

function activate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

export default function RoutinesSceneDial({
  routines,
  past,
  now,
  next,
  selectedId,
  onSelect,
  onOpenRun,
}: RoutinesSceneDialProps) {
  const t = useT();
  const locale = useLocale();
  const hhmm = (ts: number) =>
    new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const nowA = angleOf(now);
  const focusId = selectedId ?? next?.id ?? null;

  const lanes = new Map<string, number>();
  let lane = 0;
  for (const r of routines) {
    if (r.marks.kind === "run" || r.marks.kind === "band") lanes.set(r.id, LANES[lane++ % LANES.length]!);
  }
  const points = routines.filter((r) => r.marks.kind === "points");
  const pointCount = points.reduce((n, r) => n + (r.marks.kind === "points" ? r.marks.times.length : 0), 0);
  const labelAll = pointCount <= 8;

  const [hx, hy] = polar(C, R + 8, nowA);
  const [bx, by] = polar(C, DISC_R, nowA);
  const nextArc =
    next && next.at - now < 86_400_000 && next.at > now ? arcPath(C, MARK_R, nowA, angleOf(next.at)) : "";

  return (
    <svg className="rts-dial" viewBox="0 0 600 600" role="group" aria-label={t("scene.routines.dial")}>
      <defs>
        <radialGradient id="rts-glow">
          <stop offset="0" className="rts-glow-in" />
          <stop offset="1" className="rts-glow-out" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 44} fill="url(#rts-glow)" aria-hidden />
      <path
        className="rts-night"
        d={arcPath(C, MARK_R, minuteAngle(NIGHT[0]), minuteAngle(NIGHT[1]))}
        aria-hidden
      />
      <circle className="rts-ring" cx={C} cy={C} r={R} aria-hidden />
      <circle className="rts-ring-past" cx={C} cy={C} r={PAST_R} aria-hidden />

      <g aria-hidden>
        {Array.from({ length: 96 }, (_, k) => {
          const a = (k / 96) * 360 - 90;
          const major = k % 4 === 0;
          const [x1, y1] = polar(C, R, a);
          const [x2, y2] = polar(C, R + (major ? 12 : 5), a);
          return (
            <line key={k} className={major ? "rts-tick major" : "rts-tick"} x1={x1} y1={y1} x2={x2} y2={y2} />
          );
        })}
        {Array.from({ length: 8 }, (_, i) => {
          const [x, y] = polar(C, R + 30, minuteAngle(i * 180));
          return (
            <text key={i} className="rts-hour" x={x} y={y + 4} textAnchor="middle">
              {String(i * 3).padStart(2, "0")}
            </text>
          );
        })}
      </g>

      {nextArc && <path key={next!.id + next!.at} className="rts-next-arc" d={nextArc} aria-hidden />}

      {/* Cadences and heartbeats: one lane each, the whole lane is the button. */}
      {routines.map((r) => {
        const m = r.marks;
        if (m.kind !== "run" && m.kind !== "band") return null;
        const lr = lanes.get(r.id)!;
        const on = r.id === focusId;
        const span =
          m.kind === "band"
            ? arcPath(C, lr, minuteAngle(m.start), minuteAngle(m.end === m.start ? m.start + 1440 : m.end))
            : m.times.length > 1
              ? arcPath(C, lr, angleOf(m.times[0]!), angleOf(m.times[m.times.length - 1]!))
              : "";
        const dots = m.times.length <= 288 ? m.times : [];
        return (
          <g
            key={r.id}
            className={`rts-lane k-${m.kind}${on ? " on" : ""}${r.enabled ? "" : " off"}${r.unhealthy ? " bad" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={r.id === selectedId}
            aria-label={t("scene.routines.cadence", { name: r.name, words: r.words })}
            onClick={() => onSelect(r.id)}
            onKeyDown={activate(() => onSelect(r.id))}
          >
            <title>{`${r.name} · ${r.words}`}</title>
            {span && <path className="rts-lane-span" d={span} />}
            {dots.map((ts) => {
              const [x, y] = polar(C, lr, angleOf(ts));
              return (
                <circle
                  key={ts}
                  className={ts <= now ? "rts-lane-dot done" : "rts-lane-dot"}
                  cx={x}
                  cy={y}
                  r={1.7}
                />
              );
            })}
            {span && <path className="rts-hit" d={span} />}
          </g>
        );
      })}

      {/* Today's past firings. */}
      <g className="rts-past">
        {past.map((p) => {
          const [x, y] = polar(C, PAST_R, angleOf(p.at));
          const label = t("scene.routines.past", {
            name: p.name,
            time: hhmm(p.at),
            status: t(`scene.routines.st.${p.outcome}`),
          });
          const open = () => p.runId && onOpenRun(p.runId);
          return (
            <g
              key={p.key}
              className={`rts-pdot o-${p.outcome}${p.routineId === focusId ? " on" : ""}`}
              role="button"
              tabIndex={-1}
              aria-label={label}
              onClick={open}
              onKeyDown={activate(open)}
            >
              <title>{label}</title>
              <circle cx={x} cy={y} r={p.outcome === "fail" ? 3.6 : 2.8} />
            </g>
          );
        })}
      </g>

      {/* Moments: one marker per firing. */}
      {points.map((r) => {
        if (r.marks.kind !== "points") return null;
        const on = r.id === focusId;
        const isNext = r.id === next?.id;
        return r.marks.times.map((ts, i) => {
          const a = angleOf(ts);
          const [x, y] = polar(C, MARK_R, a);
          const [lx, ly] = polar(C, LABEL_R, a);
          const upcoming = isNext && next!.at === ts;
          const time = hhmm(ts);
          return (
            <g
              key={`${r.id}-${ts}`}
              className={`rts-mark${on ? " on" : ""}${upcoming ? " next" : ""}${
                ts <= now ? " done" : ""
              }${r.enabled ? "" : " off"}${r.unhealthy ? " bad" : ""}`}
              role="button"
              tabIndex={i === 0 ? 0 : -1}
              aria-pressed={r.id === selectedId}
              aria-label={t("scene.routines.marker", { name: r.name, time })}
              onClick={() => onSelect(r.id)}
              onKeyDown={activate(() => onSelect(r.id))}
            >
              <title>{`${r.name} · ${time}`}</title>
              <circle className="rts-hit" cx={x} cy={y} r={14} />
              <circle className="rts-dot" cx={x} cy={y} r={on || upcoming ? 8.5 : 6} />
              {(labelAll || on || upcoming) && (
                <text className="rts-mark-t" x={lx} y={ly + 4} textAnchor="middle">
                  {time}
                </text>
              )}
            </g>
          );
        });
      })}

      <g className="rts-hand" aria-hidden>
        <line x1={bx} y1={by} x2={hx} y2={hy} />
        <circle cx={hx} cy={hy} r={4} />
      </g>
      <circle className="rts-disc" cx={C} cy={C} r={DISC_R} aria-hidden />
    </svg>
  );
}

/**
 * The Núcleo (immersive shell): the home scene.
 *
 * At rest there is only the agent's body and a greeting. The body is the
 * way in:
 *
 * - **Touch it** and the day blooms out of it — six orbital cards spiral
 *   out on springs (what it is doing, the pendências, the last 24 hours, the
 *   next routine, today's cost, the skills), each with its own small
 *   instrument, tethered to the core by light; under the body, four ways to
 *   act (talk, converse, hear the briefing, resolve). Touch it again, or
 *   Escape, and they spiral back in.
 * - **Hold it** and you are talking to it: the conversation rises and the
 *   microphone listens.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CalendarClock,
  Coins,
  MessageSquare,
  Mic,
  ShieldAlert,
  Sparkles,
  Volume2,
  Waves,
} from "lucide-react";
import { useLocale, useT } from "../i18n";
import { useOsSettings } from "../queries";
import type { CoreState } from "../desktop/coreState";
import type { DesktopSignals } from "../desktop/useSignals";
import type { SignalLevel } from "../desktop/signal";
import { useDesktopRoutines, useDesktopRuns } from "../desktop/data";
import { useDayPhase } from "../hooks/useDayPhase";
import { speak } from "../hooks/systemNotify";
import Entity, { type EntityActivity } from "./entity/Entity";
import { mergeActivity } from "./activity";
import { formatIn } from "./format";
import { burst } from "./Sparks";
import { talk } from "./events";
import type { Briefing } from "./useBriefing";
import type { HumanEvent } from "../runs/humanize";
import { Tooltip } from "../ui";

export interface NucleoSceneProps {
  coreState: CoreState;
  signals: DesktopSignals;
  economy: boolean;
  onProject: (id: string) => void;
  /** The day's briefing, said under the core until dismissed. */
  briefing: Briefing | null;
  /** What the agent is doing right now (the live run's humanized events). */
  activity: readonly HumanEvent[];
  /** The pendências, for their card: how many, how loud, the most urgent. */
  pending: { count: number; level: string | null; top: string | null };
  onFocus: () => void;
}

interface Reading {
  id: string;
  /** Degrees around the core: 0 is right, 90 is down. */
  angle: number;
  label: string;
  value: string;
  sub: string;
  level: SignalLevel;
  icon: ReactNode;
  viz: ReactNode;
  act: () => void;
}

const DAY_MS = 86_400_000;
const HOLD_MS = 450;

/** 24 hourly bars of the last day: height by runs, red where one failed. */
function Spark({ bars }: { bars: ReadonlyArray<{ n: number; fail: boolean }> }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <svg className="nu-viz spark" viewBox="0 0 96 22" aria-hidden preserveAspectRatio="none">
      {bars.map((b, i) => {
        const h = b.n === 0 ? 1.5 : 3 + (b.n / max) * 19;
        return (
          <rect
            key={i}
            x={i * 4}
            y={22 - h}
            width="2.6"
            height={h}
            className={b.fail ? "f" : b.n ? "o" : "z"}
          />
        );
      })}
    </svg>
  );
}

/** A thin ring filled to `p` (0–1). */
function Ring({ p }: { p: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="nu-viz ring" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} className="t" />
      <circle
        cx="12"
        cy="12"
        r={r}
        className="a"
        strokeDasharray={`${Math.max(0.02, Math.min(1, p)) * c} ${c}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/** Live dots: one per run in flight, or a slow line at rest. */
function Pulse({ n }: { n: number }) {
  return (
    <span className="nu-viz dots" aria-hidden data-n={n}>
      {n > 0 ? (
        Array.from({ length: Math.min(n, 6) }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.18}s` }} />
        ))
      ) : (
        <b />
      )}
    </span>
  );
}

export default function NucleoScene({
  coreState,
  signals,
  economy,
  onProject,
  briefing,
  activity,
  pending,
  onFocus,
}: NucleoSceneProps) {
  const t = useT();
  const locale = useLocale();
  const phase = useDayPhase();
  const navigate = useNavigate();
  const settings = useOsSettings();
  const runs = useDesktopRuns();
  const routines = useDesktopRoutines();

  const [bloom, setBloom] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!bloom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // The conversation, when open, is what Escape folds first.
      if (document.querySelector(".nu-voice[data-open]")) return;
      e.preventDefault();
      setBloom(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bloom]);

  const doing = activity[activity.length - 1];
  // What it is doing orbits its body: each event a satellite, born once.
  const [satellites, setSatellites] = useState<EntityActivity[]>([]);
  useEffect(() => setSatellites((known) => mergeActivity(known, activity, Date.now())), [activity]);

  const readings = useMemo<Reading[]>(() => {
    const now = Date.now();
    const day = (runs.data ?? []).filter((r) => (r.finishedAt ?? r.createdAt) >= now - DAY_MS);
    const ok = day.filter((r) => r.status === "done").length;
    const failed = day.filter((r) => r.status === "failed" || r.status === "timed_out");
    const lastFail = [...failed].sort(
      (a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt),
    )[0];
    const bars = Array.from({ length: 24 }, () => ({ n: 0, fail: false }));
    for (const r of day) {
      const h = Math.min(23, Math.max(0, 23 - Math.floor((now - (r.finishedAt ?? r.createdAt)) / 3_600_000)));
      bars[h]!.n += 1;
      if (r.status === "failed" || r.status === "timed_out") bars[h]!.fail = true;
    }
    const next = (routines.data ?? [])
      .filter((r) => r.enabled && r.nextRunAt !== null && r.nextRunAt > now)
      .sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0];
    const budget = settings.data?.limits?.dailyBudgetUsd ?? 0;
    const cost = signals.cost.todayUsd;
    return [
      {
        id: "now",
        angle: -42,
        label: t("nucleo.signal.now"),
        value:
          signals.activeRuns > 0
            ? t("nucleo.tele.live", { n: signals.activeRuns })
            : t("nucleo.signal.resting"),
        sub: doing
          ? `${doing.text}${doing.subject ? ` ${doing.subject}` : ""}`
          : t("nucleo.signal.nothingRunning"),
        level: signals.activeRuns > 0 ? "info" : "idle",
        icon: <Activity aria-hidden />,
        viz: <Pulse n={signals.activeRuns} />,
        act: () => onProject("now"),
      },
      {
        id: "pending",
        angle: 4,
        label: t("nucleo.pending.title"),
        value: pending.count > 0 ? String(pending.count) : "✓",
        sub: pending.top ?? t("nucleo.pending.none"),
        level:
          pending.level === "decide"
            ? "critical"
            : pending.level === "fix" || pending.level === "look"
              ? "warn"
              : "idle",
        icon: <ShieldAlert aria-hidden />,
        viz: (
          <span className="nu-viz segs" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <i key={i} className={i < pending.count ? "on" : undefined} />
            ))}
          </span>
        ),
        act: onFocus,
      },
      {
        id: "pulse",
        angle: 48,
        label: t("nucleo.signal.pulse"),
        value: day.length === 0 ? "—" : t("nucleo.signal.okFail", { ok, fail: failed.length }),
        sub: lastFail
          ? (lastFail.skillSlug ? `/${lastFail.skillSlug}` : lastFail.promptSummary).slice(0, 60)
          : day.length === 0
            ? t("nucleo.signal.noRuns")
            : signals.pulse.label,
        level: failed.length > 0 ? "warn" : "idle",
        icon: <Waves aria-hidden />,
        viz: <Spark bars={bars} />,
        act: () => onProject("pulse"),
      },
      {
        id: "cost",
        angle: 132,
        label: t("nucleo.signal.cost"),
        value: `US$ ${cost.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        sub: signals.cost.label,
        level: signals.cost.level,
        icon: <Coins aria-hidden />,
        viz: <Ring p={budget > 0 ? cost / budget : 0} />,
        act: () => onProject("cost"),
      },
      {
        id: "routine",
        angle: 176,
        label: t("nucleo.signal.routine"),
        value: next ? formatIn(next.nextRunAt! - now) : "—",
        sub: next ? next.name : t("nucleo.signal.noRoutine"),
        level: next && !next.healthy ? "warn" : "idle",
        icon: <CalendarClock aria-hidden />,
        viz: <Ring p={next ? 1 - (next.nextRunAt! - now) / DAY_MS : 0} />,
        act: () => onProject("routines"),
      },
      {
        id: "skills",
        angle: 222,
        label: t("nucleo.signal.skills"),
        value: t("nucleo.signal.skillsReady", { n: signals.skills }),
        sub: t("nucleo.signal.skillsHint"),
        level: "idle",
        icon: <Sparkles aria-hidden />,
        viz: (
          <span className="nu-viz hexes" aria-hidden>
            {Array.from({ length: Math.min(7, signals.skills) }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        ),
        act: () => navigate("/skills"),
      },
    ];
  }, [
    runs.data,
    routines.data,
    settings.data,
    signals,
    t,
    locale,
    doing,
    pending,
    onFocus,
    onProject,
    navigate,
  ]);

  const greet = t(
    phase === "morning"
      ? "nucleo.greet.morning"
      : phase === "day"
        ? "nucleo.greet.afternoon"
        : "nucleo.greet.evening",
  );
  const sub =
    pending.count > 0
      ? t("nucleo.greet.attention", { n: pending.count })
      : signals.activeRuns > 0
        ? t("nucleo.greet.running", { n: signals.activeRuns })
        : t("nucleo.greet.clear");

  // The cards orbit the core wherever it is: its centre and radius, measured.
  const sceneRef = useRef<HTMLDivElement>(null);
  const [orbit, setOrbit] = useState<{ cx: number; cy: number; r: number } | null>(null);
  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const core = scene?.querySelector<HTMLElement>(".nu-core");
    if (!scene || !core) return;
    const place = () => {
      const s = scene.getBoundingClientRect();
      const c = core.getBoundingClientRect();
      setOrbit({
        cx: c.left + c.width / 2 - s.left,
        cy: c.top + c.height / 2 - s.top,
        r: c.width * 0.5 + Math.min(70, window.innerWidth * 0.04),
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(scene);
    ro.observe(core);
    return () => ro.disconnect();
  }, []);

  // Touch = bloom; hold = talk. The hold fills a ring while it waits.
  const hold = useRef<{ timer: number; talked: boolean } | null>(null);
  const [holding, setHolding] = useState(false);
  const centre = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    setHolding(true);
    hold.current = {
      talked: false,
      timer: window.setTimeout(() => {
        if (!hold.current) return;
        hold.current.talked = true;
        setHolding(false);
        const c = centre(el);
        burst(c.x, c.y, "agent", 1.6);
        talk();
      }, HOLD_MS),
    };
  };
  const onUp = () => {
    setHolding(false);
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  const toggle = (el: HTMLElement) => {
    if (hold.current?.talked) {
      hold.current = null;
      return;
    }
    hold.current = null;
    const c = centre(el);
    burst(c.x, c.y, "agent", bloom ? 0.7 : 1.5);
    setBloom((v) => !v);
  };

  const sayBriefing = () => {
    if (!briefing) return;
    setSpeaking(true);
    speak(briefing.lines.join(" "), locale, {
      force: true,
      byUser: true,
      onEnd: () => setSpeaking(false),
    });
  };

  const actions: Array<{ id: string; label: string; icon: ReactNode; run: () => void; hide?: boolean }> = [
    { id: "talk", label: t("nucleo.core.talk"), icon: <Mic aria-hidden />, run: talk },
    {
      id: "chat",
      label: t("nucleo.core.chat"),
      icon: <MessageSquare aria-hidden />,
      run: () => document.querySelector<HTMLTextAreaElement>(".cons-input")?.focus(),
    },
    {
      id: "hear",
      label: t("nucleo.core.hear"),
      icon: <Volume2 aria-hidden />,
      run: sayBriefing,
      hide: !briefing,
    },
    { id: "resolve", label: t("nucleo.core.resolve"), icon: <ShieldAlert aria-hidden />, run: onFocus },
  ];
  const shown = actions.filter((a) => !a.hide);

  return (
    <div
      className="nu-nucleo"
      ref={sceneRef}
      data-onboarding="desktop"
      data-speaking={bloom && briefing ? "" : undefined}
      data-bloom={bloom ? "" : undefined}
      style={
        orbit
          ? ({
              "--ocx": `${orbit.cx}px`,
              "--ocy": `${orbit.cy}px`,
              "--or": `${orbit.r}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="nu-core" data-holding={holding ? "" : undefined}>
        <span className="nu-core-wave" aria-hidden key={bloom ? "open" : "shut"} />
        <Entity
          variant="hero"
          state={coreState}
          economy={economy}
          activity={satellites}
          stateLabel={t(`desktop.core.${coreState}`)}
          className="nu-core-orb"
        />
        <span className="nu-core-status mono" aria-live="polite">
          {t(`desktop.core.${coreState}`)}
        </span>
        {/* The core is the way in: a touch blooms the day, a hold talks to it. */}
        <Tooltip label={t("nucleo.core.hint")}>
          <button
            type="button"
            className="nu-core-hit"
            aria-expanded={bloom}
            aria-label={t(bloom ? "nucleo.core.fold" : "nucleo.core.bloom")}
            data-testid="core-bloom"
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onClick={(e) => toggle(e.currentTarget)}
          >
            <svg className="nu-core-hold" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r="48" />
            </svg>
          </button>
        </Tooltip>
        <div className="nu-caption">
          <h1>{greet}.</h1>
          {bloom && briefing ? (
            <div className="nu-speech" aria-live="polite">
              {briefing.lines.map((line, i) => (
                <p key={line} style={{ "--i": i } as CSSProperties}>
                  {line}
                </p>
              ))}
              <button type="button" className="nu-speech-ok mono" onClick={briefing.dismiss}>
                {t("desktop.briefing.dismiss")} ✓
              </button>
            </div>
          ) : (
            <p>
              {sub}
              {!bloom && <span className="nu-caption-hint mono"> · {t("nucleo.core.hint")}</span>}
            </p>
          )}
        </div>
      </div>

      <div className="nu-readings" aria-hidden={!bloom || undefined}>
        {readings.map((r, i) => {
          const left = Math.cos((r.angle * Math.PI) / 180) < 0;
          return (
            <button
              key={r.id}
              type="button"
              className={`nu-reading nu-orb-card${left ? " l" : ""}`}
              data-reading={r.id}
              data-l={r.level === "critical" ? "crit" : r.level}
              tabIndex={bloom ? 0 : -1}
              style={
                {
                  "--pa": `${bloom ? r.angle : r.angle - 70}deg`,
                  "--d": `${bloom ? i * 70 : (readings.length - i) * 40}ms`,
                } as CSSProperties
              }
              onClick={(e) => {
                const c = centre(e.currentTarget);
                burst(c.x, c.y, r.level === "warn" || r.level === "critical" ? "warn" : "agent", 0.6);
                r.act();
              }}
            >
              <span className="oc-ic">{r.icon}</span>
              <span className="oc-body">
                <span className="k">{r.label}</span>
                <span className="v">{r.value}</span>
                <span className="s">{r.sub}</span>
              </span>
              <span className="oc-viz">{r.viz}</span>
            </button>
          );
        })}
      </div>

      <div
        className="nu-core-acts"
        aria-hidden={!bloom || undefined}
        data-speaking={speaking ? "" : undefined}
      >
        {shown.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className="nu-core-act"
            data-act={a.id}
            tabIndex={bloom ? 0 : -1}
            style={
              {
                "--d": `${bloom ? 260 + i * 60 : 0}ms`,
                "--aa": `${90 + (i - (shown.length - 1) / 2) * 34}deg`,
              } as CSSProperties
            }
            onClick={a.run}
          >
            <span className="g">{a.icon}</span>
            <span className="l">{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

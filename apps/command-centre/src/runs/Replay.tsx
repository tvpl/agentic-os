/**
 * Session replay: the run's events (which all carry `ts`) played back on a
 * canvas — prompt → tool → result — with a scrubber, 1×/4×/16× speed and
 * play/pause. The maths lives in `replayEngine.ts`; this file only draws.
 *
 * Motion rules: the loop stops when paused or when the tab is hidden, and
 * `prefers-reduced-motion` replaces the canvas with a static summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useT } from "../i18n";
import { Button, Segmented } from "../components/primitives";
import {
  buildReplayModel,
  layoutNodes,
  particlePoint,
  replaySummary,
  stateAt,
  type PlacedNode,
  type ReplayModel,
} from "./replayEngine";
import type { RunEventView } from "./useRunStream";

const SPEEDS = [1, 4, 16] as const;
type Speed = (typeof SPEEDS)[number];

export interface ReplayProps {
  events: RunEventView[];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function Replay({ events }: ReplayProps) {
  const t = useT();
  const model = useMemo(() => buildReplayModel(events), [events]);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 640, h: 260 });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const seek = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(model.duration, next));
      timeRef.current = clamped;
      setTime(clamped);
    },
    [model.duration],
  );

  // Drawing --------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = sizeRef.current;
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#f97316";
    const line = css.getPropertyValue("--border-strong").trim() || "#403a26";
    const dim = css.getPropertyValue("--text-dim").trim() || "#b3aa96";
    const text = css.getPropertyValue("--text").trim() || "#f2eee3";
    const info = css.getPropertyValue("--info").trim() || "#7dd3fc";
    const ok = css.getPropertyValue("--ok").trim() || "#4ade80";
    const danger = css.getPropertyValue("--danger").trim() || "#f87171";

    const placed = layoutNodes(model, w, h, 44);
    const state = stateAt(model, timeRef.current);
    ctx.clearRect(0, 0, w, h);

    // Edges between every pair a particle ever used (drawn once, faint).
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    const drawn = new Set<string>();
    for (const p of model.particles) {
      const key = `${p.from}→${p.to}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const a = placed.get(p.from);
      const b = placed.get(p.to);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Nodes.
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const node of placed.values()) {
      const since = state.arrivals.get(node.id);
      const glow = since === undefined ? 0 : Math.max(0, 1 - since / 900);
      const seen = node.firstAt <= timeRef.current;
      const colour =
        node.kind === "result" ? (model.ok === false ? danger : ok) : node.kind === "tool" ? info : accent;
      const r = radius(node);
      ctx.globalAlpha = seen ? 1 : 0.28;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + glow * 6, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(colour, 0.12 + glow * 0.35);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = seen ? text : dim;
      ctx.fillText(node.count > 1 ? `${node.label} ×${node.count}` : node.label, node.x, node.y + r + 11);
      ctx.globalAlpha = 1;
    }

    // Particles in flight.
    for (const flight of state.flights) {
      const point = particlePoint(flight, placed);
      if (!point) continue;
      const colour =
        flight.particle.kind === "error" ? danger : flight.particle.kind === "result" ? ok : accent;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(colour, 0.18);
      ctx.fill();
    }
  }, [model]);

  // Size (DPR-aware) ------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduced) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(320, Math.round(rect.width));
      const h = Math.max(180, Math.round(rect.height));
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw, reduced]);

  // Playback loop ---------------------------------------------------------
  useEffect(() => {
    if (reduced) return;
    draw();
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!document.hidden) {
        const next = timeRef.current + dt * speed;
        if (next >= model.duration) {
          timeRef.current = model.duration;
          setTime(model.duration);
          setPlaying(false);
          draw();
          return;
        }
        timeRef.current = next;
        setTime(next);
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVisibility = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [playing, speed, model.duration, draw, reduced]);

  const toggle = () => {
    if (!playing && timeRef.current >= model.duration) seek(0);
    setPlaying((p) => !p);
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  /**
   * Space and the arrows drive playback. The controls keep their native
   * behaviour (space on the button, arrows on the range), so the window
   * listener skips any focused form control to avoid acting twice.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        el?.isContentEditable
      )
        return;
      const step = Math.max(200, model.duration / 40);
      if (e.key === " ") {
        e.preventDefault();
        toggleRef.current();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(timeRef.current - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(timeRef.current + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "End") {
        e.preventDefault();
        seek(model.duration);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model.duration, seek]);

  if (events.length === 0) return <p className="widget-muted">{t("runs.replay.empty")}</p>;

  const summary = replaySummary(model);

  return (
    <div className="replay" role="group" aria-label={t("runs.replay.title")}>
      {reduced ? (
        <ReplaySummary model={model} />
      ) : (
        <canvas
          ref={canvasRef}
          className="replay-canvas"
          aria-label={t("runs.replay.canvasLabel", { n: summary.length })}
          role="img"
        />
      )}
      <div className="replay-controls">
        <Button
          size="sm"
          variant="secondary"
          icon={playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          aria-pressed={playing}
          onClick={toggle}
          disabled={reduced}
        >
          {playing ? t("runs.replay.pause") : t("runs.replay.play")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw aria-hidden />}
          aria-label={t("runs.replay.restart")}
          title={t("runs.replay.restart")}
          onClick={() => seek(0)}
          disabled={reduced}
        />
        <input
          className="replay-scrub"
          type="range"
          min={0}
          max={model.duration}
          step={Math.max(1, Math.round(model.duration / 1000))}
          value={Math.round(time)}
          aria-label={t("runs.replay.scrub")}
          aria-valuetext={`${(time / 1000).toFixed(1)}s`}
          disabled={reduced}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="replay-clock mono tnum">
          {(time / 1000).toFixed(1)}s / {(model.duration / 1000).toFixed(1)}s
        </span>
        <Segmented
          ariaLabel={t("runs.replay.speed")}
          size="sm"
          value={String(speed)}
          onChange={(v) => setSpeed(Number(v) as Speed)}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
        />
      </div>
      {!reduced && <ReplaySummary model={model} compact />}
    </div>
  );
}

function ReplaySummary({ model, compact = false }: { model: ReplayModel; compact?: boolean }) {
  const t = useT();
  const rows = replaySummary(model);
  if (rows.length === 0) return null;
  return (
    <ul className={`replay-summary${compact ? " compact" : ""}`} aria-label={t("runs.replay.summary")}>
      {rows.map((row) => (
        <li key={`${row.kind}:${row.label}`} className={`replay-chip kind-${row.kind}`}>
          <span className="mono">{row.label}</span>
          {row.count > 1 && <span className="replay-count">×{row.count}</span>}
        </li>
      ))}
    </ul>
  );
}

function radius(node: PlacedNode): number {
  if (node.kind === "prompt" || node.kind === "result") return 12;
  return 8 + Math.min(6, node.count);
}

/** `color-mix` in canvas: accept #rgb/#rrggbb, else fall back to the colour itself. */
function withAlpha(colour: string, alpha: number): string {
  const hex = colour.replace("#", "");
  if (hex.length === 3 || hex.length === 6) {
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const n = Number.parseInt(full, 16);
    if (Number.isFinite(n)) return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return colour;
}

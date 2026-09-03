/**
 * Desktop wallpaper: particle core + orbital ring of recent artifacts/files.
 *
 * Performance rules (audit item 30):
 *  - colour tokens read once per theme/accent change (MutationObserver on
 *    <html data-theme / style>), never per frame;
 *  - size comes from a ResizeObserver, never getBoundingClientRect in a frame;
 *  - idle (no hover, no active runs, no new data) → ≤ 12 fps;
 *  - paused entirely while document.hidden or prefers-reduced-motion (one
 *    static frame is drawn instead).
 * Light theme (item 31): token colours and source-over compositing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode, FileImage, FileText } from "lucide-react";
import type { ArtifactEntry } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery } from "../queries";
import { timeAgo } from "../components/ui";
import { AREA_COLORS, AREA_COLORS_LIGHT, shortAge } from "./data";

const TWO_PI = Math.PI * 2;
const MAX_CHIPS = 14;
const IDLE_FPS = 12;

interface Point {
  x: number;
  y: number;
  z: number;
  /** index into the area palette; -1 = neutral particle colour */
  ci: number;
  p: number;
}
interface Tokens {
  star: string;
  particle: string;
  line: string;
  accent: string;
  light: boolean;
}
interface LoopState {
  points: Point[];
  activeRuns: number;
  hover: boolean;
  /** performance.now() until which the scene counts as "changing" */
  dirtyUntil: number;
  redraw: () => void;
}

function readTokens(): Tokens {
  const el = document.documentElement;
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    star: get("--canvas-star", "#efe9da"),
    particle: get("--canvas-particle", "#94a3b8"),
    line: get("--canvas-line", "#403a26"),
    accent: get("--accent", "#f97316"),
    light: el.dataset.theme === "light",
  };
}

interface GraphNodeLite {
  area: string | null;
  name: string;
  mtime: number;
}

export interface WallpaperProps {
  artifacts: ArtifactEntry[];
  activeRuns: number;
  /** The Now panel sits over the core: draw it dimmer. */
  dimmed: boolean;
  onOpenBrain: () => void;
  onOpenRun: (runId: string) => void;
}

export default function Wallpaper({ artifacts, activeRuns, dimmed, onOpenBrain, onOpenRun }: WallpaperProps) {
  const t = useT();
  const locale = useLocale();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<LoopState>({ points: [], activeRuns, hover: false, dirtyUntil: 0, redraw: () => undefined });
  stateRef.current.activeRuns = activeRuns;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tip, setTip] = useState<{ left: number; top: number; text: string; sub: string } | null>(null);

  const graph = useApiQuery<{ nodes: GraphNodeLite[] }>(qk.memoryGraph({ maxNodes: 700 }), "/api/memory/graph?maxNodes=700", {
    staleTime: 60_000,
  });

  // Build the particle cloud whenever the graph changes (deterministic seed).
  useEffect(() => {
    const nodes = graph.data?.nodes ?? [];
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const areas = [...new Set(nodes.map((n) => n.area ?? "•"))];
    const indexOf = new Map(areas.map((a, i) => [a, i % AREA_COLORS.length]));
    const MIN_POINTS = 620;
    const source = nodes.length > 0 ? Array.from({ length: Math.max(MIN_POINTS, nodes.length) }, (_, i) => nodes[i % nodes.length]!) : [];
    let points: Point[] = source.map((n) => {
      const u = rand();
      const r = 86 * Math.cbrt(u) + rand() * 18;
      const theta = rand() * TWO_PI;
      const phi = Math.acos(2 * rand() - 1);
      return {
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta) * 0.82,
        z: r * Math.cos(phi),
        ci: indexOf.get(n.area ?? "•") ?? -1,
        p: rand() * TWO_PI,
      };
    });
    if (points.length === 0) {
      points = Array.from({ length: 90 }, () => ({
        x: (rand() - 0.5) * 100,
        y: (rand() - 0.5) * 80,
        z: (rand() - 0.5) * 100,
        ci: -1,
        p: rand() * TWO_PI,
      }));
    }
    stateRef.current.points = points;
    stateRef.current.dirtyUntil = performance.now() + 1500;
    stateRef.current.redraw();
  }, [graph.data]);

  useEffect(() => {
    stateRef.current.dirtyUntil = performance.now() + 1500;
    stateRef.current.redraw();
  }, [activeRuns]);

  // The render loop. Mounted once; everything dynamic goes through stateRef.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const state = stateRef.current;
    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionMq.matches;
    let tokens = readTokens();
    let w = wrap.clientWidth;
    let h = wrap.clientHeight;
    let running = false;
    let raf = 0;
    let lastDraw = 0;

    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand(), a: 0.1 + rand() * 0.4, p: rand() * TWO_PI }));

    const draw = (now: number) => {
      const cx = w / 2;
      const cy = h * 0.54;
      const tSec = now / 1000;
      const rot = reduceMotion ? 0.6 : tSec * 0.13;
      ctx.clearRect(0, 0, w, h);

      // starfield
      ctx.fillStyle = tokens.star;
      for (const s of stars) {
        const tw = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(tSec * 0.9 + s.p);
        ctx.globalAlpha = s.a * tw * (tokens.light ? 0.7 : 0.5);
        ctx.fillRect(s.x * w, s.y * h, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;

      // wireframe polyhedron
      ctx.strokeStyle = tokens.line;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.7;
      const R = Math.min(w, h) * 0.36;
      const verts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TWO_PI + rot * 0.22;
        verts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.92]);
      }
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          if ((i + j) % 3 === 0) {
            ctx.moveTo(verts[i]![0], verts[i]![1]);
            ctx.lineTo(verts[j]![0], verts[j]![1]);
          }
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // live agents: pulsing halo + orbiting comet while runs are active
      if (state.activeRuns > 0) {
        const haloR = Math.min(w, h) * 0.22;
        const pulse = reduceMotion ? 0.5 : 0.35 + 0.25 * Math.sin(tSec * 4);
        ctx.strokeStyle = tokens.accent;
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR + Math.sin(tSec * 2) * 5, 0, TWO_PI);
        ctx.stroke();
        const ca = tSec * 1.6;
        for (let i = 0; i < 7; i++) {
          const trailA = ca - i * 0.09;
          ctx.globalAlpha = (1 - i / 7) * 0.85;
          const sz = 3.4 - i * 0.4;
          ctx.fillStyle = i === 0 ? tokens.star : tokens.accent;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(trailA) * haloR, cy + Math.sin(trailA) * haloR * 0.92, Math.max(0.8, sz), 0, TWO_PI);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // particle ball — additive glow on dark, plain compositing on light
      ctx.globalCompositeOperation = tokens.light ? "source-over" : "lighter";
      const palette = tokens.light ? AREA_COLORS_LIGHT : AREA_COLORS;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      for (const pt of state.points) {
        const x = pt.x * cos - pt.z * sin;
        const z = pt.x * sin + pt.z * cos;
        const depth = (z + 120) / 240;
        const px = cx + x * 1.2;
        const py = cy + pt.y * 1.2;
        const twinkle = reduceMotion ? 0.9 : 0.6 + 0.4 * Math.sin(tSec * 1.7 + pt.p);
        ctx.globalAlpha = Math.max(0.1, (0.3 + depth * 0.7) * twinkle) * 0.85;
        ctx.fillStyle = pt.ci >= 0 ? palette[pt.ci]! : tokens.particle;
        const sizePt = 1.4 + depth * 2.3;
        ctx.fillRect(px - sizePt / 2, py - sizePt / 2, sizePt, sizePt);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const changing = state.activeRuns > 0 || state.hover || now < state.dirtyUntil;
      const minInterval = changing ? 0 : 1000 / IDLE_FPS;
      if (now - lastDraw < minInterval) return;
      lastDraw = now;
      draw(now);
    };
    const start = () => {
      if (running || reduceMotion || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const staticFrame = () => draw(performance.now());

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      state.dirtyUntil = performance.now() + 500;
      if (!running) staticFrame();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const mo = new MutationObserver(() => {
      tokens = readTokens();
      state.dirtyUntil = performance.now() + 500;
      if (!running) staticFrame();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => {
      reduceMotion = motionMq.matches;
      if (reduceMotion) {
        stop();
        staticFrame();
      } else start();
    };
    motionMq.addEventListener("change", onMotion);

    state.redraw = () => {
      if (!running) staticFrame();
    };
    if (reduceMotion) staticFrame();
    else start();

    return () => {
      stop();
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionMq.removeEventListener("change", onMotion);
      state.redraw = () => undefined;
    };
  }, []);

  const recentFiles = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .slice()
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 18),
    [graph.data],
  );

  const chips = useMemo(() => {
    const cx = size.w / 2;
    const cy = size.h * 0.54;
    const R = Math.min(size.w * 0.62, size.h * 0.92) * 0.46;
    const seen = new Set<string>();
    const combined: Array<{ key: string; label: string; ts: number; kind: "artifact" | "file"; runId: string | null }> = [];
    for (const a of artifacts) {
      if (combined.length >= MAX_CHIPS) break;
      const key = `a-${a.runId}-${a.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push({ key, label: a.file, ts: a.createdAt, kind: "artifact", runId: a.runId });
    }
    for (const f of recentFiles) {
      if (combined.length >= MAX_CHIPS) break;
      const key = `f-${f.name}-${f.mtime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push({ key, label: f.name, ts: f.mtime, kind: "file", runId: null });
    }
    const n = combined.length;
    return combined.map((chip, i) => {
      const a = Math.PI * (0.56 + (1.88 * i) / Math.max(1, n - 1));
      return { ...chip, left: cx + Math.cos(a) * R, top: cy + Math.sin(a) * R * 0.86 };
    });
  }, [artifacts, recentFiles, size]);

  const showTip = (chip: (typeof chips)[number]) =>
    setTip({ left: chip.left + 24, top: chip.top + 24, text: chip.label, sub: timeAgo(chip.ts, locale) });

  return (
    <div
      className="desktop-canvas"
      ref={wrapRef}
      onPointerEnter={() => {
        stateRef.current.hover = true;
      }}
      onPointerLeave={() => {
        stateRef.current.hover = false;
      }}
    >
      <canvas ref={canvasRef} aria-hidden className={dimmed ? "dimmed" : undefined} />
      <button type="button" className="orbital-core-btn" style={{ top: "54%" }} onClick={onOpenBrain} aria-label={t("dash.brainCta")} title={t("dash.brainCta")} />
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className={`orbit-chip ${chip.kind}`}
          style={{ left: chip.left, top: chip.top }}
          onClick={() => (chip.runId ? onOpenRun(chip.runId) : onOpenBrain())}
          onMouseEnter={() => showTip(chip)}
          onMouseLeave={() => setTip(null)}
          onFocus={() => showTip(chip)}
          onBlur={() => setTip(null)}
          aria-label={`${chip.label} · ${timeAgo(chip.ts, locale)}`}
          title={chip.label}
        >
          {chipIcon(chip.label)}
          <span className="chip-name">{chip.label}</span>
          <span className="chip-age">{shortAge(chip.ts)}</span>
        </button>
      ))}
      {tip && (
        <div className="orbit-tooltip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.text}
          <div className="sub">{tip.sub}</div>
        </div>
      )}
    </div>
  );
}

function chipIcon(file: string) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "svg", "gif", "webp"].includes(ext)) return <FileImage aria-hidden />;
  if (["ts", "tsx", "js", "py", "sh", "json", "html", "css"].includes(ext)) return <FileCode aria-hidden />;
  return <FileText aria-hidden />;
}

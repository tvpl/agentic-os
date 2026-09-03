/**
 * Desktop wallpaper: a wireframe icosphere rotating in pseudo-3D over a
 * static hex weave, a particle core coloured by memory area inside it, a slow
 * counter-rotating tick ring, and the orbital ring of artifact chips.
 *
 * Performance rules (audit item 30 / 2.2 §7):
 *  - geometry is pure maths from `icosphere.ts` (unit-tested), projected per
 *    frame; edges are batched into a handful of alpha buckets so one frame is
 *    ~8 strokes, not 120;
 *  - particles are pre-rendered glow sprites (`drawImage`), never per-frame
 *    `shadowBlur`; the hex weave is one cached pattern;
 *  - colour tokens are read once per theme/accent change (MutationObserver),
 *    size comes from a ResizeObserver, never `getBoundingClientRect` in a frame;
 *  - idle (no hover, no active runs, no new data) → ≤ 12 fps; `hover` is armed
 *    only by the core button and the chips, never by a full-screen wrapper;
 *  - paused entirely while `document.hidden`; one static frame under
 *    `prefers-reduced-motion`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { File as FileIcon, FileCode, FileImage, FileText, FileVideo, Globe } from "lucide-react";
import { useLocale, useT } from "../i18n";
import { AREA_COLORS, AREA_COLORS_LIGHT, shortAge, type GraphNodeLite } from "./data";
import { edgeAlpha, icosphere, project, rotate } from "./icosphere";
import { chipAngle, chipLabel, type RingChip } from "./ringChips";

const TWO_PI = Math.PI * 2;
const IDLE_FPS = 12;
/** Alpha buckets for the wireframe: one stroke call per bucket, not per edge. */
const EDGE_BUCKETS = 6;
const MESH = icosphere(1);

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
  labels: string[];
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

/** A soft radial sprite; drawn once per colour and blitted per particle. */
function glowSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, "transparent");
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, TWO_PI);
  g.fill();
  return c;
}

/** The static hex weave behind the core, as a repeatable tile. */
function hexTile(color: string): HTMLCanvasElement {
  const w = 36;
  const h = 62;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  g.strokeStyle = color;
  g.lineWidth = 0.6;
  g.beginPath();
  const pts: Array<[number, number]> = [
    [18, 0],
    [36, 10],
    [36, 31],
    [18, 41],
    [0, 31],
    [0, 10],
  ];
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.moveTo(18, 41);
  g.lineTo(18, 62);
  g.stroke();
  return c;
}

export interface WallpaperProps {
  chips: RingChip[];
  /** Graph nodes drive the particle colours (one per memory area). */
  nodes: GraphNodeLite[];
  activeRuns: number;
  /** Short labels of the most recent runs, drifting inside the sphere. */
  runLabels: string[];
  /** The Now panel sits over the core: draw it dimmer. */
  dimmed: boolean;
  searching: boolean;
  /** Keys of the chips that match the current search. */
  matched: ReadonlySet<string>;
  revealLabels: boolean;
  onOpenBrain: () => void;
  onChipActivate: (chip: RingChip) => void;
}

export default function Wallpaper({
  chips,
  nodes,
  activeRuns,
  runLabels,
  dimmed,
  searching,
  matched,
  revealLabels,
  onOpenBrain,
  onChipActivate,
}: WallpaperProps) {
  const t = useT();
  const locale = useLocale();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<LoopState>({
    points: [],
    activeRuns,
    hover: false,
    labels: runLabels,
    dirtyUntil: 0,
    redraw: () => undefined,
  });
  stateRef.current.activeRuns = activeRuns;
  stateRef.current.labels = runLabels;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Build the particle cloud whenever the graph changes (deterministic seed).
  useEffect(() => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const areas = [...new Set(nodes.map((n) => n.area ?? "•"))];
    const indexOf = new Map(areas.map((a, i) => [a, i % AREA_COLORS.length]));
    const MIN_POINTS = 620;
    const source =
      nodes.length > 0
        ? Array.from(
            { length: Math.max(MIN_POINTS, Math.min(nodes.length, 1400)) },
            (_, i) => nodes[i % nodes.length]!,
          )
        : [];
    let points: Point[] = source.map((n) => {
      const u = rand();
      const r = 0.86 * Math.cbrt(u) + rand() * 0.16;
      const theta = rand() * TWO_PI;
      const phi = Math.acos(2 * rand() - 1);
      return {
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
        ci: indexOf.get(n.area ?? "•") ?? -1,
        p: rand() * TWO_PI,
      };
    });
    if (points.length === 0) {
      points = Array.from({ length: 120 }, () => ({
        x: (rand() - 0.5) * 1.2,
        y: (rand() - 0.5) * 1.2,
        z: (rand() - 0.5) * 1.2,
        ci: -1,
        p: rand() * TWO_PI,
      }));
    }
    stateRef.current.points = points;
    stateRef.current.dirtyUntil = performance.now() + 1500;
    stateRef.current.redraw();
  }, [nodes]);

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
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stars = Array.from({ length: 140 }, () => ({
      x: rand(),
      y: rand(),
      a: 0.1 + rand() * 0.4,
      p: rand() * TWO_PI,
    }));

    // Cached, token-dependent raster assets (never rebuilt inside a frame).
    let sprites: HTMLCanvasElement[] = [];
    let neutral = glowSprite("#fff", 16);
    let core = glowSprite("#fff", 256);
    let weave: CanvasPattern | null = null;
    const buildAssets = () => {
      const palette = tokens.light ? AREA_COLORS_LIGHT : AREA_COLORS;
      sprites = palette.map((c) => glowSprite(c, 16));
      neutral = glowSprite(tokens.particle, 16);
      core = glowSprite(tokens.accent, 256);
      weave = ctx.createPattern(hexTile(tokens.line), "repeat");
    };
    buildAssets();

    // Reused scratch buffers: no per-frame allocation.
    const projected = MESH.vertices.map(() => ({ x: 0, y: 0, depth: 0, scale: 1 }));
    const order: number[] = [];

    const draw = (now: number) => {
      const cx = w / 2;
      const cy = h * 0.54;
      const tSec = now / 1000;
      const spin = reduceMotion ? 0.9 : tSec;
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.3;

      // static hex weave
      if (weave) {
        ctx.globalAlpha = tokens.light ? 0.1 : 0.16;
        ctx.fillStyle = weave;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }

      // starfield
      ctx.fillStyle = tokens.star;
      for (const s of stars) {
        const tw = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(tSec * 0.9 + s.p);
        ctx.globalAlpha = s.a * tw * (tokens.light ? 0.7 : 0.5);
        ctx.fillRect(s.x * w, s.y * h, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;

      // ---- wireframe icosphere (two axes, perspective, depth-faded edges) ----
      const ay = spin * 0.12;
      const ax = spin * 0.05;
      for (let i = 0; i < MESH.vertices.length; i++) {
        const p = project(rotate(MESH.vertices[i]!, ax, ay), cx, cy, R);
        const slot = projected[i]!;
        slot.x = p.x;
        slot.y = p.y;
        slot.depth = p.depth;
        slot.scale = p.scale;
      }
      ctx.strokeStyle = tokens.line;
      ctx.lineWidth = 0.8;
      for (let b = 0; b < EDGE_BUCKETS; b++) {
        let started = false;
        for (const [a, c] of MESH.edges) {
          const pa = projected[a]!;
          const pc = projected[c]!;
          const alpha = edgeAlpha(pa.depth, pc.depth);
          if (Math.min(EDGE_BUCKETS - 1, Math.floor(((alpha - 0.08) / 0.62) * EDGE_BUCKETS)) !== b) continue;
          if (!started) {
            ctx.beginPath();
            started = true;
          }
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pc.x, pc.y);
        }
        if (started) {
          ctx.globalAlpha = (0.08 + (0.62 * (b + 0.5)) / EDGE_BUCKETS) * (tokens.light ? 0.8 : 1);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // ---- slow counter-rotating tick ring ----
      const ringR = R * 1.24;
      const ringA = -spin * 0.04;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 72; i++) {
        const a = ringA + (i / 72) * TWO_PI;
        const long = i % 6 === 0;
        const c = Math.cos(a);
        const s = Math.sin(a) * 0.94;
        ctx.moveTo(cx + c * ringR, cy + s * ringR);
        ctx.lineTo(cx + c * (ringR + (long ? 10 : 4)), cy + s * (ringR + (long ? 10 : 4)));
      }
      ctx.strokeStyle = tokens.line;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // live agents: pulsing halo + orbiting comet while runs are active
      if (state.activeRuns > 0) {
        const haloR = R * 0.74;
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
          ctx.arc(
            cx + Math.cos(trailA) * haloR,
            cy + Math.sin(trailA) * haloR * 0.92,
            Math.max(0.8, sz),
            0,
            TWO_PI,
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // ---- particle core: depth-sorted glow sprites, twinkle and drift ----
      ctx.globalCompositeOperation = tokens.light ? "source-over" : "lighter";
      // accent core glow
      const coreScale = R * (reduceMotion ? 1 : 1 + 0.02 * Math.sin(tSec * 0.6));
      ctx.globalAlpha = tokens.light ? 0.1 : 0.22;
      ctx.drawImage(core, cx - coreScale * 0.55, cy - coreScale * 0.55, coreScale * 1.1, coreScale * 1.1);
      ctx.globalAlpha = 1;

      const pts = state.points;
      if (order.length !== pts.length) {
        order.length = 0;
        for (let i = 0; i < pts.length; i++) order.push(i);
      }
      const cos = Math.cos(ay);
      const sin = Math.sin(ay);
      const cosX = Math.cos(ax * 0.6);
      const sinX = Math.sin(ax * 0.6);
      const zOf = (i: number) => {
        const pt = pts[i]!;
        const z1 = pt.x * sin + pt.z * cos;
        return pt.y * sinX + z1 * cosX;
      };
      order.sort((a, b) => zOf(a) - zOf(b));
      const pr = R * 0.82;
      for (const i of order) {
        const pt = pts[i]!;
        const drift = reduceMotion ? 0 : 0.02 * Math.sin(tSec * 0.35 + pt.p);
        const x = pt.x * cos - pt.z * sin;
        const z1 = pt.x * sin + pt.z * cos;
        const y = pt.y * cosX - z1 * sinX + drift;
        const z = pt.y * sinX + z1 * cosX;
        const persp = 4 / (4 - z);
        const px = cx + x * pr * persp;
        const py = cy + y * pr * persp;
        const depth = (z + 1) / 2;
        const twinkle = reduceMotion ? 0.9 : 0.62 + 0.38 * Math.sin(tSec * 1.7 + pt.p);
        ctx.globalAlpha = Math.max(0.06, (0.22 + depth * 0.78) * twinkle) * (tokens.light ? 0.6 : 0.8);
        const sz = (1.6 + depth * 3.4) * persp;
        ctx.drawImage(pt.ci >= 0 ? (sprites[pt.ci] ?? neutral) : neutral, px - sz / 2, py - sz / 2, sz, sz);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // ---- drifting labels of the most recent runs ----
      const labels = state.labels;
      if (labels.length > 0) {
        ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = tokens.star;
        for (let i = 0; i < labels.length; i++) {
          const a = (reduceMotion ? 0.8 : tSec * 0.06) + (i * TWO_PI) / labels.length;
          const rr = R * (0.42 + 0.12 * ((i % 3) - 1));
          ctx.globalAlpha = 0.28 + 0.16 * Math.cos(a);
          ctx.fillText(labels[i]!, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.62);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = "start";
      }
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
      buildAssets();
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

  const placed = useMemo(() => {
    const R = Math.min(size.w * 0.62, size.h * 0.92) * 0.46;
    return chips.map((chip, i) => {
      const a = chipAngle(i, chips.length);
      return {
        chip,
        dx: Math.cos(a) * R,
        dy: Math.sin(a) * R * 0.86,
        side: Math.cos(a) >= 0 ? "right" : "left",
      };
    });
  }, [chips, size]);

  const hover = (key: string | null) => {
    stateRef.current.hover = key !== null;
    setHoverKey(key);
  };

  return (
    <div className="desktop-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden className={dimmed ? "dimmed" : undefined} />
      <button
        type="button"
        className="orbital-core-btn"
        style={{ top: "54%" }}
        onClick={onOpenBrain}
        onPointerEnter={() => hover("core")}
        onPointerLeave={() => hover(null)}
        aria-label={t("dash.brainCta")}
        title={t("dash.brainCta")}
      />
      <div
        className={`orbit-ring${searching ? " searching" : ""}${hoverKey ? " paused" : ""}`}
        style={{ left: size.w / 2, top: size.h * 0.54 }}
      >
        {placed.map(({ chip, dx, dy, side }) => {
          const isMatch = matched.has(chip.key);
          const label = chipLabel(chip, locale);
          return (
            <span className="orbit-slot" key={chip.key} style={{ transform: `translate(${dx}px, ${dy}px)` }}>
              <button
                type="button"
                className={`orbit-chip ${chip.kind}${searching ? (isMatch ? " match" : " muted") : ""}${revealLabels ? " labelled" : ""}`}
                onClick={() => onChipActivate(chip)}
                onPointerEnter={() => hover(chip.key)}
                onPointerLeave={() => hover(null)}
                onFocus={() => hover(chip.key)}
                onBlur={() => hover(null)}
                aria-label={`${label} · ${shortAge(chip.ts)}`}
                title={label}
              >
                <span className="chip-face">
                  <ChipIcon kind={chip.artifactKind} />
                  <span className="chip-count" aria-hidden>
                    {chip.n}
                  </span>
                  <span className="chip-age" aria-hidden>
                    {shortAge(chip.ts)}
                  </span>
                  <span className={`chip-label ${side}`} aria-hidden>
                    {label}
                  </span>
                </span>
              </button>
              {searching && isMatch && hoverKey === chip.key && (
                <span className="chip-card-wrap">
                  <span className={`chip-card ${side}`} role="tooltip">
                    <strong className="truncate">{chip.title}</strong>
                    <span className="mono">
                      {chip.skillSlug ? `/${chip.skillSlug} · ` : ""}
                      {new Date(chip.ts).toLocaleString(locale, {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChipIcon({ kind }: { kind: RingChip["artifactKind"] }) {
  if (kind === "image") return <FileImage aria-hidden />;
  if (kind === "video") return <FileVideo aria-hidden />;
  if (kind === "html") return <Globe aria-hidden />;
  if (kind === "code") return <FileCode aria-hidden />;
  if (kind === "markdown") return <FileText aria-hidden />;
  return <FileIcon aria-hidden />;
}

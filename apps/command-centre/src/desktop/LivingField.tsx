/**
 * The living field (redesign F7): the Second Brain as the desktop's ground.
 *
 * What it replaces had two halves, and both were wrong. The icosphere was a
 * wireframe sphere that meant nothing, orbited by file chips that navigated
 * away instead of doing anything with the file. Removing it left a plain
 * glow — honest, but empty: the desktop the user complained about being
 * cluttered became a desktop that was nothing at all.
 *
 * This is the workspace itself, drawn dim: one point per indexed file,
 * coloured by area, drifting slowly. Hovering lights a file and names it;
 * clicking opens it as a document window, where the console can point the
 * agent at it. The background stops being decoration and becomes the map.
 *
 * Performance rules carried over from the wallpaper it replaces: positions
 * are pure maths per frame, colours are read once per theme change (never per
 * frame), the canvas is paused while the tab is hidden, and the economy
 * profile draws one static frame.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../components/Workspace";
import { AREA_COLORS, AREA_COLORS_LIGHT, useDesktopGraph, type GraphNodeLite } from "./data";

/** Idle frame rate: the field is ambient, not an animation. */
const IDLE_FPS = 12;
const MAX_POINTS = 260;

interface FieldPoint {
  /** Orbit angle and radius, in normalised stage units. */
  a: number;
  r: number;
  /** Angular speed; signed so the field does not rotate as one body. */
  s: number;
  colour: number;
  node: GraphNodeLite;
  /** Screen position of the last frame, for hit testing. */
  x: number;
  y: number;
}

export interface LivingFieldProps {
  /** Opens a file as a window on the stage. */
  onOpenFile: (path: string) => void;
}

export default function LivingField({ onOpenFile }: LivingFieldProps) {
  const graph = useDesktopGraph();
  const { economy } = useWorkspace();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number>(-1);
  const hoverRef = useRef(-1);
  hoverRef.current = hover;
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;

  const points = useMemo<FieldPoint[]>(() => {
    const nodes = (graph.data?.nodes ?? []).slice(0, MAX_POINTS);
    const areas = [...new Set(nodes.map((n) => n.area ?? ""))];
    return nodes.map((node, i) => {
      // Deterministic from the index: the field looks the same across reloads,
      // so it reads as a place rather than a screensaver.
      const golden = (i * 137.508 * Math.PI) / 180;
      return {
        a: golden,
        r: 0.14 + Math.sqrt((i + 1) / (nodes.length + 1)) * 0.82,
        s: (0.03 + ((i * 7) % 11) / 320) * (i % 2 ? 1 : -1),
        colour: Math.max(0, areas.indexOf(node.area ?? "")),
        node,
        x: 0,
        y: 0,
      };
    });
  }, [graph.data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let palette = AREA_COLORS;
    let line = "rgba(122,109,74,";
    let ink = "#f2eee3";
    let sub = "#8a8170";
    const readTokens = () => {
      const light = document.documentElement.dataset.theme === "light";
      palette = light ? AREA_COLORS_LIGHT : AREA_COLORS;
      line = light ? "rgba(120,110,92," : "rgba(122,109,74,";
      ink = light ? "#201c14" : "#f2eee3";
      sub = light ? "#6f6757" : "#8a8170";
    };
    readTokens();
    const themeWatch = new MutationObserver(readTokens);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let size = { w: 0, h: 0 };
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w: canvas.clientWidth, h: canvas.clientHeight };
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      // Ambient, not animated: one frame every ~83 ms is plenty.
      if (!economy && now - last < 1000 / IDLE_FPS) return;
      last = now;
      const { w, h } = size;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      const rx = w * 0.44;
      const ry = h * 0.42;

      for (const p of points) {
        if (!economy) p.a += p.s * dt;
        p.x = cx + Math.cos(p.a) * p.r * rx;
        p.y = cy + Math.sin(p.a) * p.r * ry;
      }

      // Edges between near neighbours: enough to read as a weave, never n².
      ctx.lineWidth = 1;
      // Few files sit far apart: the weave reaches further so they still connect.
      const reach = Math.min(w, h) * (points.length > 60 ? 0.13 : 0.34);
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        for (let j = i + 1; j < Math.min(i + 5, points.length); j++) {
          const b = points[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > reach) continue;
          const near = hoverRef.current === i || hoverRef.current === j;
          ctx.strokeStyle = near ? "rgba(249,115,22,.5)" : `${line}${0.34 * (1 - d / reach)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // A sparse workspace must still read as a field: with a dozen files the
      // points carry the whole picture, so they grow as the count falls.
      const scale = points.length > 120 ? 1 : points.length > 40 ? 1.25 : 1.6;
      points.forEach((p, i) => {
        const on = hoverRef.current === i;
        ctx.globalAlpha = on ? 1 : 0.62;
        ctx.fillStyle = palette[p.colour % palette.length]!;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (on ? 4.6 : 2.3) * scale, 0, Math.PI * 2);
        ctx.fill();
        if (on) {
          ctx.globalAlpha = 0.18;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      });

      const h0 = points[hoverRef.current];
      if (h0) {
        ctx.font = "600 11px Rajdhani, system-ui, sans-serif";
        ctx.fillStyle = ink;
        ctx.textAlign = "left";
        ctx.fillText((h0.node.title || h0.node.name).toUpperCase(), h0.x + 13, h0.y - 6);
        ctx.font = '400 10px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = sub;
        ctx.fillText(h0.node.area ?? "", h0.x + 13, h0.y + 8);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeWatch.disconnect();
    };
  }, [points, economy]);

  const hit = (e: React.PointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1;
    let bd = 18;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  return (
    <canvas
      ref={canvasRef}
      className="living-field"
      aria-hidden
      onPointerMove={(e) => {
        const next = hit(e);
        if (next !== hoverRef.current) setHover(next);
        e.currentTarget.style.cursor = next >= 0 ? "pointer" : "default";
      }}
      onPointerLeave={() => setHover(-1)}
      onClick={() => {
        const p = points[hoverRef.current];
        if (p) openRef.current(p.node.path);
      }}
    />
  );
}

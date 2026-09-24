/**
 * The living field (redesign F7): the Second Brain as the desktop's ground.
 *
 * What it replaces had two halves, and both were wrong. The icosphere was a
 * wireframe sphere that meant nothing, orbited by file chips that navigated
 * away instead of doing anything with the file. Removing it left a plain
 * glow — honest, but empty: the desktop the user complained about being
 * cluttered became a desktop that was nothing at all.
 *
 * This is the workspace itself, drawn dim: one point per thing the OS knows —
 * an indexed file, an enabled skill, a live routine, a recent run — coloured
 * by kind and drifting slowly. Hovering lights one and names it; clicking
 * opens it. A failed run or an unhealthy routine burns rather than glows, so
 * the ground itself carries the same warning the pods do. The background
 * stops being decoration and becomes the map.
 *
 * Drawing files alone was the first attempt, and on a real workspace it came
 * out as three faint dots: a constellation needs a sky, and the rest of what
 * the OS holds is no less memory than the files are.
 *
 * Performance rules carried over from the wallpaper it replaces: positions
 * are pure maths per frame, colours are read once per theme change (never per
 * frame), the canvas is paused while the tab is hidden, and the economy
 * profile draws one static frame.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../components/Workspace";
import { useT } from "../i18n";
import { useOsSkills } from "../queries";
import { useDesktopGraph, useDesktopRoutines, useDesktopRuns } from "./data";
import { fieldSeeds, placeField, type FieldKind, type FieldPoint } from "./fieldPoints";

/** Idle frame rate: the field is ambient, not an animation. */
const IDLE_FPS = 12;

/** One colour per kind, so the sky is legible without a legend. */
const KIND_COLOURS: Record<FieldKind, string> = {
  file: "#22d3ee",
  skill: "#4ade80",
  routine: "#a78bfa",
  run: "#fbbf24",
};
const KIND_COLOURS_LIGHT: Record<FieldKind, string> = {
  file: "#0e7490",
  skill: "#15803d",
  routine: "#6d28d9",
  run: "#a16207",
};
/** What burns: a failed run, an unhealthy routine. Same amber as a lit pod. */
const HOT = "#f97316";

export interface LivingFieldProps {
  /** Opens a file as a window on the stage. */
  onOpenFile: (path: string) => void;
}

export default function LivingField({ onOpenFile }: LivingFieldProps) {
  const t = useT();
  const navigate = useNavigate();
  const graph = useDesktopGraph();
  const skills = useOsSkills();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  const { economy } = useWorkspace();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number>(-1);
  const hoverRef = useRef(-1);
  hoverRef.current = hover;
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;

  const points = useMemo<FieldPoint[]>(
    () =>
      placeField(
        fieldSeeds({
          files: graph.data?.nodes ?? [],
          skills: skills.data ?? [],
          routines: routines.data ?? [],
          runs: runs.data ?? [],
          labels: {
            skill: t("nav.skills"),
            routine: t("desktop.widget.routines"),
            run: t("desktop.hud.runs"),
            failed: t("desktop.field.failed"),
          },
        }),
      ),
    [graph.data, skills.data, routines.data, runs.data, t],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let palette = KIND_COLOURS;
    let line = "rgba(122,109,74,";
    let ink = "#f2eee3";
    let sub = "#8a8170";
    const readTokens = () => {
      const light = document.documentElement.dataset.theme === "light";
      palette = light ? KIND_COLOURS_LIGHT : KIND_COLOURS;
      line = light ? "rgba(120,110,92," : "rgba(122,109,74,";
      ink = light ? "#201c14" : "#f2eee3";
      sub = light ? "#6f6757" : "#8a8170";
    };
    readTokens();
    const themeWatch = new MutationObserver(readTokens);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let size = { w: 0, h: 0 };
    /** True when the backing store actually changed — and was therefore wiped. */
    const measure = (): boolean => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = { w: canvas.clientWidth, h: canvas.clientHeight };
      const w = Math.round(size.w * dpr);
      const h = Math.round(size.h * dpr);
      // Assigning `canvas.width` clears the canvas even when the value is
      // unchanged, and `ResizeObserver` fires once the moment it starts
      // observing — which used to erase the frame just painted, leaving a
      // hidden tab (no animation frames) blank for good.
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };
    measure();

    let raf = 0;
    let last = performance.now();
    const paint = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const { w, h } = size;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      const rx = w * 0.44;
      const ry = h * 0.42;

      for (const p of points) {
        if (!economy) {
          p.a += p.s * dt;
          p.phase += dt * 1.6;
        }
        p.x = cx + Math.cos(p.a) * p.r * rx;
        p.y = cy + Math.sin(p.a) * p.r * ry;
      }

      // Edges between near neighbours: enough to read as a weave, never n². The
      // candidate window is by index, which after the drift is effectively a
      // random sample — cheap, and a constellation does not need every edge.
      ctx.lineWidth = 1;
      // Few points sit far apart: the weave reaches further so they still connect.
      const reach = Math.min(w, h) * (points.length > 60 ? 0.17 : 0.34);
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        for (let j = i + 1; j < Math.min(i + 10, points.length); j++) {
          const b = points[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > reach) continue;
          const near = hoverRef.current === i || hoverRef.current === j;
          ctx.strokeStyle = near ? "rgba(249,115,22,.5)" : `${line}${0.45 * (1 - d / reach)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // A sparse workspace must still read as a field: with a dozen points they
      // carry the whole picture, so they grow as the count falls.
      const scale = points.length > 120 ? 1 : points.length > 40 ? 1.2 : 1.5;
      points.forEach((p, i) => {
        const on = hoverRef.current === i;
        // The pulse is slow and shallow: the field breathes, it does not blink.
        const breath = 1 + Math.sin(p.phase) * 0.12;
        ctx.globalAlpha = on ? 1 : p.hot ? 0.85 : 0.6;
        ctx.fillStyle = p.hot ? HOT : palette[p.kind];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * scale * breath * (on ? 2.1 : 1), 0, Math.PI * 2);
        ctx.fill();
        // A halo, on what is hovered and on what is wrong.
        if (on || p.hot) {
          ctx.globalAlpha = on ? 0.2 : 0.1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * scale * (on ? 7 : 4.5), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      });

      const h0 = points[hoverRef.current];
      if (h0) {
        ctx.font = "600 11px Rajdhani, system-ui, sans-serif";
        ctx.fillStyle = ink;
        ctx.textAlign = "left";
        ctx.fillText(h0.label.toUpperCase(), h0.x + 13, h0.y - 6);
        ctx.font = '400 10px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = h0.hot ? HOT : sub;
        ctx.fillText(h0.detail, h0.x + 13, h0.y + 8);
      }
    };
    // One frame now, synchronously. A tab can be loaded in the background —
    // restored at start-up, opened behind another window — and a hidden tab
    // gets no animation frames at all, so waiting for `requestAnimationFrame`
    // left the ground blank until the tab was first focused.
    paint(performance.now());
    // A resize wipes the backing store, so it has to repaint even while the
    // animation loop is parked.
    const ro = new ResizeObserver(() => {
      if (measure()) paint(performance.now());
    });
    ro.observe(canvas);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      // Ambient, not animated: one frame every ~83 ms is plenty.
      if (!economy && now - last < 1000 / IDLE_FPS) return;
      paint(now);
    };
    raf = requestAnimationFrame(loop);

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
      /* How much of the workspace the ground is carrying; asserted in e2e. */
      data-points={points.length}
      aria-hidden
      onPointerMove={(e) => {
        const next = hit(e);
        if (next !== hoverRef.current) setHover(next);
        e.currentTarget.style.cursor = next >= 0 ? "pointer" : "default";
      }}
      onPointerLeave={() => setHover(-1)}
      onClick={() => {
        const p = points[hoverRef.current];
        if (!p) return;
        // A file becomes a window the console can point the agent at; anything
        // else opens where it actually lives.
        if ("file" in p.open) openRef.current(p.open.file);
        else navigate(p.open.route);
      }}
    />
  );
}

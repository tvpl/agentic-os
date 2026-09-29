/**
 * The agent's body (immersive shell): a sphere of particles with an orbital
 * ring and a gauge, drawn on one canvas. Its shape is the agent's state —
 * it breathes when idle, ripples under your keystrokes while listening,
 * swirls and sweeps the gauge while it works, and pulses from the equator
 * while it answers. Waiting for you tints the gauge amber; an alert flashes
 * red; a finished run flashes green.
 *
 * Cyan is the agent and amber is the system (refino item 19), so the sphere
 * is cyan with a few amber motes. The loop stops when the orb is off screen
 * or the tab is hidden, and runs at a quarter of the rate in economy mode.
 */
import { useEffect, useRef } from "react";
import type { CoreState } from "../desktop/coreState";

/** Fired on `window` on every keystroke in the voice line; the orb ripples with it. */
export const TYPING_EVENT = "mordomo:typing";

type Motion = "idle" | "listening" | "thinking" | "speaking" | "waiting" | "alert" | "done";
export function motionOf(state: CoreState): Motion {
  switch (state) {
    case "listening":
      return "listening";
    case "queued":
    case "thinking":
    case "tool":
      return "thinking";
    case "responding":
      return "speaking";
    case "waiting":
      return "waiting";
    case "alert":
    case "interrupted":
      return "alert";
    case "done":
      return "done";
    default:
      return "idle";
  }
}

const SPIN: Record<Motion, number> = {
  idle: 0.16,
  listening: 0.26,
  thinking: 1.1,
  speaking: 0.4,
  waiting: 0.12,
  alert: 0.5,
  done: 0.3,
};

interface Point {
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  mote: boolean;
}
const SPHERE: Point[] = (() => {
  const n = 620;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    out.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, lat: Math.asin(y), lon: th, mote: i % 17 === 0 });
  }
  return out;
})();

function rgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export interface CoreOrbProps {
  state: CoreState;
  /** The HUD's small copy: fewer points, no ring or gauge. */
  mini?: boolean;
  /** Economy render profile: a quarter of the frame rate. */
  economy?: boolean;
  className?: string;
}

export default function CoreOrb({ state, mini = false, economy = false, className }: CoreOrbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const motion = useRef<Motion>(motionOf(state));
  motion.current = motionOf(state);
  const flash = useRef(0);
  useEffect(() => {
    if (state === "done" || state === "alert") flash.current = 1;
  }, [state]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let t = 0;
    let rot = 0;
    let energy = 0;
    let frame = 0;
    const onType = () => {
      energy = Math.min(1, energy + 0.35);
    };
    window.addEventListener(TYPING_EVENT, onType);

    const colours = () => {
      const css = getComputedStyle(document.documentElement);
      const light = document.documentElement.dataset.theme === "light";
      return {
        light,
        agent: rgb(css.getPropertyValue("--agent"), [34, 211, 238]),
        system: rgb(css.getPropertyValue("--accent"), [242, 181, 69]),
        warn: rgb(css.getPropertyValue("--warn"), [251, 191, 36]),
        danger: rgb(css.getPropertyValue("--danger"), [248, 113, 113]),
        ok: rgb(css.getPropertyValue("--ok"), [74, 222, 128]),
      };
    };
    let pal = colours();
    const themeWatch = new MutationObserver(() => {
      pal = colours();
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const m = motion.current;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * (mini ? 0.34 : 0.27);
      const [ar, ag, ab] = pal.agent;
      const col = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      const blend = pal.light ? "source-over" : "lighter";
      ctx.globalCompositeOperation = blend;
      // Glow.
      const glowA = (m === "thinking" ? 0.22 : m === "speaking" ? 0.19 : 0.13) * (pal.light ? 0.6 : 1);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.9);
      glow.addColorStop(0, col(pal.agent, glowA));
      glow.addColorStop(0.45, col(pal.agent, glowA * 0.25));
      glow.addColorStop(1, col(pal.agent, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      // The sphere.
      const speak = m === "speaking" ? 0.55 + 0.45 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)) : 0;
      const tilt = 0.42;
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const step = mini ? 3 : 1;
      for (let i = 0; i < SPHERE.length; i += step) {
        const p = SPHERE[i]!;
        let d = 1 + 0.018 * Math.sin(t * 1.2 + p.lat * 4);
        if (m === "listening") d += energy * 0.1 * Math.sin(p.lon * 5 + t * 9);
        if (m === "thinking") d += 0.055 * Math.sin(p.lat * 8 + t * 6) + 0.035 * Math.sin(p.lon * 7 - t * 4);
        if (m === "speaking") d += speak * 0.12 * Math.sin(p.lat * 10 - t * 14) * Math.cos(p.lat);
        if (m === "waiting") d += 0.03 * Math.sin(t * 2.4);
        const x1 = p.x * cr - p.z * sr;
        const z1 = p.x * sr + p.z * cr;
        const y2 = p.y * ct - z1 * st;
        const z2 = p.y * st + z1 * ct;
        const k = (z2 + 1) / 2;
        const pr = 1 + z2 * 0.12;
        const sx = cx + x1 * R * d * pr;
        const sy = cy + y2 * R * d * pr;
        const a = (0.12 + 0.7 * k * k) * (pal.light ? 0.9 : 1);
        const s = (mini ? 0.8 : 0.7) + (mini ? 0.9 : 1.5) * k;
        ctx.fillStyle = p.mote ? col(pal.system, a) : `rgba(${ar},${ag},${ab},${a})`;
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      }
      if (!mini) {
        // Orbital ring with travelling ticks.
        const rx = R * 1.42;
        const ry = rx * 0.26;
        const tiltR = -0.18;
        ctx.lineWidth = 1;
        ctx.strokeStyle = col(pal.agent, 0.22);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, tiltR, 0, Math.PI * 2);
        ctx.stroke();
        const spin = m === "thinking" ? 1.6 : 0.25;
        for (let k = 0; k < 56; k++) {
          const a = (k / 56) * Math.PI * 2 + t * spin * 0.3;
          const ex = Math.cos(a) * rx;
          const ey = Math.sin(a) * ry;
          const px = cx + ex * Math.cos(tiltR) - ey * Math.sin(tiltR);
          const py = cy + ex * Math.sin(tiltR) + ey * Math.cos(tiltR);
          const front = Math.sin(a) > 0 ? 0.75 : 0.25;
          ctx.fillStyle = col(pal.agent, front * (k % 7 === 0 ? 1 : 0.45));
          const s = k % 7 === 0 ? 2.4 : 1.2;
          ctx.fillRect(px - s / 2, py - s / 2, s, s);
        }
        // Gauge: the system's ring of ticks.
        const gr = R * 1.62;
        const gauge = m === "waiting" ? pal.warn : m === "alert" ? pal.danger : pal.system;
        ctx.strokeStyle = col(gauge, m === "waiting" ? 0.45 + 0.25 * Math.sin(t * 3) : 0.28);
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2 - t * 0.05;
          const l = k % 6 === 0 ? 7 : 3;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * gr, cy + Math.sin(a) * gr);
          ctx.lineTo(cx + Math.cos(a) * (gr + l), cy + Math.sin(a) * (gr + l));
          ctx.stroke();
        }
        if (m === "thinking" || m === "speaking" || m === "listening") {
          const a0 = t * (m === "thinking" ? 3 : 1.2);
          const len = m === "thinking" ? 1.4 : m === "listening" ? 0.3 + energy : 0.6 + speak;
          ctx.strokeStyle = m === "thinking" ? col(pal.system, 0.85) : col(pal.agent, 0.8);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, gr - 6, a0, a0 + len);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, gr - 6, a0 + Math.PI, a0 + Math.PI + len * 0.5);
          ctx.stroke();
        }
      }
      // A finished run flashes green, an alert red: one ring expanding out.
      if (flash.current > 0.01) {
        const c = m === "alert" ? pal.danger : pal.ok;
        const f = 1 - flash.current;
        ctx.strokeStyle = col(c, flash.current * 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.05 + f * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      frame++;
      if (economy && frame % 4 !== 0) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      rot += dt * SPIN[motion.current];
      energy = Math.max(0, energy - dt * 1.4);
      flash.current = Math.max(0, flash.current - dt * 0.9);
      draw();
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
          })
        : null;
    io?.observe(canvas);
    if (reduced) {
      // One still frame per state; no loop.
      draw();
      const redraw = window.setInterval(draw, 1000);
      return () => {
        window.clearInterval(redraw);
        window.removeEventListener(TYPING_EVENT, onType);
        themeWatch.disconnect();
        io?.disconnect();
      };
    }
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(TYPING_EVENT, onType);
      themeWatch.disconnect();
      io?.disconnect();
    };
  }, [mini, economy]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

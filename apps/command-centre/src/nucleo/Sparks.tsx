/**
 * Sparks (immersive shell): the light a gesture leaves behind. A journey or
 * a projection starts with a burst at its origin — a ring that expands and
 * a spray of motes that decelerate and fade — so the eye knows where the
 * new thing came from. One canvas over everything; the loop only runs while
 * sparks are alive. Reduced motion draws nothing.
 */
import { useEffect, useRef } from "react";

export const BURST_EVENT = "mordomo:burst";
export type BurstTone = "agent" | "system" | "warn" | "danger" | "ok";

/** Fire a burst at a point in viewport coordinates. */
export function burst(x: number, y: number, tone: BurstTone = "agent", strength = 1): void {
  window.dispatchEvent(new CustomEvent(BURST_EVENT, { detail: { x, y, tone, strength } }));
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}
interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
  strength: number;
}

const VAR: Record<BurstTone, string> = {
  agent: "--agent",
  system: "--accent",
  warn: "--warn",
  danger: "--danger",
  ok: "--ok",
};

export default function Sparks() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motes: Mote[] = [];
    const rings: Ring[] = [];
    let raf = 0;
    let last = 0;
    const colour = (tone: BurstTone) =>
      getComputedStyle(document.documentElement).getPropertyValue(VAR[tone]).trim() || "#22d3ee";
    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const light = document.documentElement.dataset.theme === "light";
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!;
        r.life += dt;
        const k = r.life / r.max;
        if (k >= 1) {
          rings.splice(i, 1);
          continue;
        }
        const e = 1 - Math.pow(1 - k, 3);
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1.5 + (1 - k) * 2 * r.strength;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 6 + e * 90 * r.strength, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - k) * 0.35;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 4 + e * 46 * r.strength, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i]!;
        m.life += dt;
        if (m.life >= m.max) {
          motes.splice(i, 1);
          continue;
        }
        const drag = Math.pow(0.04, dt);
        m.vx *= drag;
        m.vy *= drag;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const k = m.life / m.max;
        ctx.globalAlpha = (1 - k) * 0.95;
        ctx.fillStyle = m.color;
        const s = m.size * (1 - k * 0.6);
        ctx.fillRect(m.x - s / 2, m.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = motes.length > 0 || rings.length > 0 ? requestAnimationFrame(frame) : 0;
      if (!raf) last = 0;
    };
    const onBurst = (e: Event) => {
      if (reduced) return;
      const { x, y, tone, strength } = (
        e as CustomEvent<{ x: number; y: number; tone: BurstTone; strength: number }>
      ).detail;
      const color = colour(tone);
      const s = Math.max(0.3, Math.min(2, strength ?? 1));
      rings.push({ x, y, r: 0, life: 0, max: 0.75, color, strength: s });
      const n = Math.round(26 * s);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (120 + Math.random() * 420) * s;
        motes.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 0,
          max: 0.5 + Math.random() * 0.6,
          size: 1 + Math.random() * 2.2,
          color,
        });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };
    window.addEventListener(BURST_EVENT, onBurst);
    return () => {
      window.removeEventListener(BURST_EVENT, onBurst);
      cancelAnimationFrame(raf);
    };
  }, []);
  return <canvas ref={ref} className="nu-sparks" aria-hidden />;
}

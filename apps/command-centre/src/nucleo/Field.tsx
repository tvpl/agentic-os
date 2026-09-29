/**
 * The machine around you (immersive shell): drifting motes coming toward
 * the viewer and a perspective floor receding to a horizon, both faint.
 * Changing scene is travel — for a moment the motes streak and the floor
 * rushes — so `travel` (any value that changes per scene change) sets it
 * off. Economy mode and reduced motion draw one still frame.
 */
import { useEffect, useRef } from "react";

interface Mote {
  x: number;
  y: number;
  z: number;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export default function Field({ travel, economy = false }: { travel: string; economy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const warp = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    warp.current = 1;
  }, [travel]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const still = reduced || economy;
    const rnd = seeded(7);
    const motes: Mote[] = Array.from({ length: 200 }, () => ({
      x: rnd() * 2 - 1,
      y: rnd() * 2 - 1,
      z: rnd(),
    }));
    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    let raf = 0;
    let last = performance.now();
    let floor = 0;

    const draw = (dt: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const css = getComputedStyle(document.documentElement);
      const light = document.documentElement.dataset.theme === "light";
      const accent = css.getPropertyValue("--accent").trim() || "#f2b545";
      const cx = w / 2 + mx * 18;
      const cy = h * 0.46 + my * 12;
      const wv = warp.current;
      const speed = 0.012 + wv * 0.9;
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;
      for (const p of motes) {
        const z0 = p.z;
        p.z -= speed * dt;
        if (p.z <= 0.02) p.z = 1;
        const f = 1 / (p.z * 2.2 + 0.15);
        const sx = cx + p.x * w * 0.175 * f;
        const sy = cy + p.y * h * 0.175 * f;
        const a = Math.max(0, Math.min(0.5, (1 - p.z) * 0.5)) * (light ? 0.5 : 1);
        if (wv > 0.05 && z0 > p.z) {
          const f0 = 1 / (Math.min(1, z0 + wv * 0.08) * 2.2 + 0.15);
          ctx.globalAlpha = a * 0.8;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx + p.x * w * 0.175 * f0, cy + p.y * h * 0.175 * f0);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        } else {
          ctx.globalAlpha = a * 0.55;
          const s = 1 + (1 - p.z) * 1.2;
          ctx.fillRect(sx, sy, s, s);
        }
      }
      // The floor.
      const hor = h * 0.62;
      floor = (floor + dt * (0.04 + wv * 1.4)) % 1;
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const k = (i + floor) / 14;
        const y = hor + (h - hor) * k * k;
        ctx.globalAlpha = 0.05 * k * (light ? 1.4 : 1);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = light ? 0.06 : 0.045;
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 18, hor);
        ctx.lineTo(cx + i * w * 0.16, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      warp.current = Math.max(0, wv - dt * 1.6);
    };

    if (still) {
      draw(0);
      const onResize = () => draw(0);
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("pointermove", onMove);
      };
    }
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      draw(dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [economy]);

  return <canvas ref={ref} className="nu-field" aria-hidden />;
}

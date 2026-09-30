/**
 * Light between the core and what it shows (immersive shell): dotted leader
 * lines from the core to each reading, and a beam — with motes running
 * along it — to each lâmina it projected. Read from the DOM every frame, so
 * the lines follow the core as it steps aside; the loop only runs in the
 * Núcleo, and stops with the tab hidden.
 */
import { useEffect, useRef } from "react";

export default function Beams({ active, economy }: { active: boolean; economy: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !active) {
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let frame = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const core = document.querySelector<HTMLElement>(".nu-core-orb");
      if (!core) return;
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue("--accent").trim() || "#f2b545";
      const agent = css.getPropertyValue("--agent").trim() || "#22d3ee";
      const c = core.getBoundingClientRect();
      const cx = c.left + c.width / 2;
      const cy = c.top + c.height / 2;
      const R = c.width * 0.27;
      const t = performance.now() / 1000;
      if (w > 760) {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        ctx.lineWidth = 1;
        for (const el of document.querySelectorAll<HTMLElement>(".nu-reading")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || getComputedStyle(el).opacity === "0") continue;
          const left = el.classList.contains("l");
          const tx = left ? r.right + 4 : r.left - 4;
          const ty = r.top + r.height / 2;
          const a = Math.atan2(ty - cy, tx - cx);
          ctx.globalAlpha = 0.3 * Number(getComputedStyle(el.parentElement!).opacity || 1);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * R * 1.75, cy + Math.sin(a) * R * 1.75);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.globalAlpha = 0.7;
          ctx.fillRect(tx - 1.5, ty - 1.5, 3, 3);
        }
        ctx.setLineDash([]);
        for (const el of document.querySelectorAll<HTMLElement>(".nu-lamina:not(.bye)")) {
          const r = el.getBoundingClientRect();
          const tx = r.left;
          const ty = r.top + Math.min(r.height / 2, 120);
          const a = Math.atan2(ty - cy, tx - cx);
          const sx = cx + Math.cos(a) * R * 1.2;
          const sy = cy + Math.sin(a) * R * 1.2;
          const g = ctx.createLinearGradient(sx, sy, tx, ty);
          g.addColorStop(0, agent);
          g.addColorStop(1, "transparent");
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = g;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.globalAlpha = 0.08;
          ctx.strokeStyle = agent;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, r.top + 16);
          ctx.moveTo(sx, sy);
          ctx.lineTo(tx, r.bottom - 16);
          ctx.stroke();
          ctx.fillStyle = agent;
          for (let k = 0; k < 3; k++) {
            const f = (t * 0.5 + k / 3) % 1;
            ctx.globalAlpha = 0.9 * (1 - f);
            ctx.fillRect(sx + (tx - sx) * f - 1.5, sy + (ty - sy) * f - 1.5, 3, 3);
          }
        }
        ctx.globalAlpha = 1;
      }
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      frame++;
      if ((economy || reduced) && frame % 15 !== 0) return;
      draw();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, economy]);
  return <canvas ref={ref} className="nu-beams" aria-hidden />;
}

/**
 * Tween a number towards its latest value over `durationMs` (ease-out), so
 * stats and countdowns never "snap". Returns the current tweened value; it
 * settles exactly on the target. Under reduced motion the value is
 * returned immediately. Render with `font-variant-numeric: tabular-nums`.
 */
import { useEffect, useRef, useState } from "react";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Pure step function: value at `elapsed` ms from `from` to `to`. */
export function tweenAt(from: number, to: number, elapsed: number, durationMs: number): number {
  if (durationMs <= 0 || elapsed >= durationMs) return to;
  if (elapsed <= 0) return from;
  return from + (to - from) * easeOut(elapsed / durationMs);
}

export function useTweenNumber(value: number, durationMs = 300): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const from = shownRef.current;
    if (from === target) return;
    const reduce = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame !== "function") {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const v = tweenAt(from, target, now - start, durationMs);
      shownRef.current = v;
      setShown(v);
      if (v !== target) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return shown;
}

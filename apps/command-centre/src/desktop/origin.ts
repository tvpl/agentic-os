/**
 * Where a panel comes from (refino item 18). The last pointer-down on the
 * desk is remembered for a moment; a panel that materialises right after
 * grows out of that point — the pod, the chip, the strip segment that
 * opened it — instead of appearing from nowhere.
 */
export interface Origin {
  x: number;
  y: number;
  at: number;
}

let last: Origin | null = null;
let installed = false;

export function installOriginTracking(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(
    "pointerdown",
    (e) => {
      last = { x: e.clientX, y: e.clientY, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

/** The origin, if it is recent enough to be the cause of what just opened. */
export function recentOrigin(maxAgeMs = 900, now = performance.now()): Origin | null {
  return last && now - last.at <= maxAgeMs ? last : null;
}

/** Test seam. */
export function setOriginForTest(o: Origin | null): void {
  last = o;
}

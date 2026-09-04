/**
 * Pointer picking in world space: hubs first, then planets, then orbs, then
 * the nearest visible file within a zoom-aware tolerance. Pure.
 */
import type { FileNode, Hub, OrbNode, Planet, Transform, World } from "./world";

export type Hit = { file?: FileNode; hub?: Hub; orb?: OrbNode; planet?: Planet };

export const HUB_HIT_RADIUS = 17;
export const APP_HIT_RADIUS = 17;
export const ORB_HIT_RADIUS = 13;
export const PLANET_HIT_RADIUS = 7;

/** Tolerance (world units) for picking a file at zoom `k`: generous when zoomed out. */
export function fileTolerance(k: number): number {
  return 9 / k + 4;
}

export function hitTest(
  w: Pick<World, "hubs" | "orbs" | "files" | "transform"> & Partial<Pick<World, "planets">>,
  wx: number,
  wy: number,
): Hit {
  for (const hub of w.hubs) {
    if (Math.hypot(wx - hub.x, wy - hub.y) < HUB_HIT_RADIUS) return { hub };
  }
  for (const orb of w.orbs) {
    if (Math.hypot(wx - orb.x, wy - orb.y) < (orb.kind === "app" ? APP_HIT_RADIUS : ORB_HIT_RADIUS))
      return { orb };
  }
  for (const planet of w.planets ?? []) {
    if (Math.hypot(wx - planet.x, wy - planet.y) < PLANET_HIT_RADIUS) return { planet };
  }
  const tol = fileTolerance(w.transform.k);
  let best: FileNode | undefined;
  let bestD = tol * tol;
  for (const n of w.files) {
    if (n.visAlpha < 0.2) continue;
    const dx = wx - n.x;
    const dy = wy - n.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { file: best };
}

export interface ScreenPoint {
  x: number;
  y: number;
  sx: number;
  sy: number;
}

/** Canvas-relative pointer position → world coordinates (plus the screen offset for tooltips). */
export function screenToWorld(
  tr: Transform,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): ScreenPoint {
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return { x: (sx - rect.width / 2 - tr.x) / tr.k, y: (sy - rect.height / 2 - tr.y) / tr.k, sx, sy };
}

/** Zoom by `factor` keeping the point under the cursor fixed. */
export function zoomAt(
  target: Transform,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  factor: number,
  clamp: (k: number) => number,
): void {
  const k = clamp(target.k * factor);
  const mx = clientX - rect.left - rect.width / 2;
  const my = clientY - rect.top - rect.height / 2;
  const wx = (mx - target.x) / target.k;
  const wy = (my - target.y) / target.k;
  target.k = k;
  target.x = mx - wx * k;
  target.y = my - wy * k;
}

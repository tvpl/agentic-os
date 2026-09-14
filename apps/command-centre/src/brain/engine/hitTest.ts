/**
 * Pointer picking in world space: hubs first, then orbs, then planets, then
 * the nearest visible file within a zoom-aware tolerance. Pure.
 */
import type { FileNode, Hub, OrbNode, Planet, Transform, World } from "./world";

export type Hit = { file?: FileNode; hub?: Hub; orb?: OrbNode; planet?: Planet };

/** Drawn radii (world units) the screen-space tolerances build on. */
export const HUB_DRAW_RADIUS = 12;
export const APP_DRAW_RADIUS = 18;
export const ORB_DRAW_RADIUS = 13;
export const PLANET_DRAW_RADIUS = 3.6;
/** Extra screen pixels of slack around a hub / orb / planet / file. */
const HUB_SLACK_PX = 6;
const ORB_SLACK_PX = 4;
const PLANET_MIN_PX = 7;
const FILE_SLACK_PX = 8;

/** Tolerance (world units) for picking a file of radius `r` at zoom `k`: 8 px plus the dot itself. */
export function fileTolerance(k: number, r = 2): number {
  return FILE_SLACK_PX / k + r;
}

type HitWorld = Pick<World, "hubs" | "orbs" | "files" | "transform"> &
  Partial<Pick<World, "planets" | "matched" | "filterGroup">>;

/** A file the current filters have faded out is not clickable (it is barely drawn). */
export function fileHittable(w: Pick<HitWorld, "matched" | "filterGroup">, n: FileNode): boolean {
  if (n.visAlpha < 0.35) return false;
  if (w.matched && !w.matched.has(n.id)) return false;
  if (w.filterGroup && n.group !== w.filterGroup) return false;
  return true;
}

export function hitTest(w: HitWorld, wx: number, wy: number): Hit {
  const k = w.transform.k;
  const hubTol = HUB_DRAW_RADIUS + HUB_SLACK_PX / k;
  for (const hub of w.hubs) {
    if (Math.hypot(wx - hub.x, wy - hub.y) < hubTol) return { hub };
  }
  for (const orb of w.orbs) {
    const tol = (orb.kind === "app" ? APP_DRAW_RADIUS : ORB_DRAW_RADIUS) + ORB_SLACK_PX / k;
    if (Math.hypot(wx - orb.x, wy - orb.y) < tol) return { orb };
  }
  const planetTol = Math.max(PLANET_MIN_PX / k, PLANET_DRAW_RADIUS * 1.6);
  for (const planet of w.planets ?? []) {
    if (Math.hypot(wx - planet.x, wy - planet.y) < planetTol) return { planet };
  }
  let best: FileNode | undefined;
  let bestD = Infinity;
  for (const n of w.files) {
    if (!fileHittable(w, n)) continue;
    const tol = fileTolerance(k, n.r);
    const dx = wx - n.x;
    const dy = wy - n.y;
    const d = dx * dx + dy * dy;
    if (d < tol * tol && d < bestD) {
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

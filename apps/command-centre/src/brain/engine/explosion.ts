/**
 * Directed hub explosion (item 60) and layout-switch tweens (item 13).
 * Deterministic: no Math.random(); every particle gets a start point, a
 * delay in arc order and a spring or eased curve toward its live target.
 */
import { orderFiles, targetOf } from "./layouts";
import { EXPLOSION_S, LAYOUT_TWEEN_S, RING, clampZoom, type FileNode, type Hub, type Trip, type World } from "./world";

/** Stagger between consecutive files of a fan (seconds); capped so big hubs stay snappy. */
const FAN_STAGGER = 0.004;
const FAN_MAX_STAGGER_TOTAL = 0.35;

export interface ExplosionPlan {
  /** File index → trip (in world order). */
  trips: Array<{ index: number; trip: Trip }>;
}

/**
 * Plan the fan for a hub: on expand, files start at the hub disc and travel
 * to their targets with a spring overshoot in arc order (dir, then mtime);
 * on collapse they ease back into the halo from where they are.
 */
export function planExplosion(w: Pick<World, "files" | "time">, hub: Pick<Hub, "key" | "x" | "y" | "expanded">): ExplosionPlan {
  const members = orderFiles(w.files.filter((n) => n.group === hub.key));
  const stagger = Math.min(FAN_STAGGER, FAN_MAX_STAGGER_TOTAL / Math.max(1, members.length));
  const trips: ExplosionPlan["trips"] = [];
  members.forEach((n, i) => {
    const index = w.files.indexOf(n);
    trips.push({
      index,
      trip: hub.expanded
        ? { x0: hub.x, y0: hub.y, t0: w.time + i * stagger, dur: EXPLOSION_S, kind: "spring" }
        : { x0: n.x, y0: n.y, t0: w.time, dur: EXPLOSION_S * 0.75, kind: "ease" },
    });
  });
  return { trips };
}

export function applyPlan(w: Pick<World, "files">, plan: ExplosionPlan): void {
  for (const { index, trip } of plan.trips) {
    const n = w.files[index];
    if (!n || n.pinned) continue;
    n.trip = trip;
    n.vx = 0;
    n.vy = 0;
    if (trip.kind === "spring") {
      n.x = trip.x0;
      n.y = trip.y0;
    }
  }
}

/** Start an eased trip from the current position of every (unpinned) file — the layout switch. */
export function startLayoutTween(w: Pick<World, "files" | "time">): void {
  for (const n of w.files) {
    if (n.pinned) continue;
    n.trip = { x0: n.x, y0: n.y, t0: w.time, dur: LAYOUT_TWEEN_S, kind: "ease" };
    n.vx = 0;
    n.vy = 0;
  }
}

/**
 * Camera target that frames a hub and its files (rotated targets) inside a
 * viewport of `width × height` with padding; zoom is clamped and never below
 * the current one by more than a fit requires.
 */
export function frameSector(
  w: Pick<World, "files" | "theta">,
  hub: Pick<Hub, "key" | "baseAngle">,
  view: { width: number; height: number },
  padding = 90,
): { x: number; y: number; k: number } {
  const members = w.files.filter((n) => n.group === hub.key);
  const hx = Math.cos(hub.baseAngle + w.theta) * RING.hubs;
  const hy = Math.sin(hub.baseAngle + w.theta) * RING.hubs;
  let minX = hx;
  let maxX = hx;
  let minY = hy;
  let maxY = hy;
  for (const n of members) {
    const [tx, ty] = targetOf(n, w.theta);
    if (tx < minX) minX = tx;
    if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty;
    if (ty > maxY) maxY = ty;
  }
  const bw = Math.max(40, maxX - minX + padding);
  const bh = Math.max(40, maxY - minY + padding);
  const k = clampZoom(Math.min(view.width / bw, view.height / bh, 4));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: -cx * k, y: -cy * k, k };
}

/** Ease-out cubic (layout switch). */
export function easeOut(u: number): number {
  const v = 1 - u;
  return 1 - v * v * v;
}

/** Ease-out back: a ~10 % overshoot that settles (hub explosion spring). */
export function easeSpring(u: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const v = u - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
}

/** Position along a trip at world time `t` (target given). Returns null once the trip is over. */
export function tripPosition(trip: Trip, t: number, tx: number, ty: number): [number, number] | null {
  const u = (t - trip.t0) / trip.dur;
  if (u >= 1) return null;
  if (u <= 0) return [trip.x0, trip.y0];
  const f = trip.kind === "spring" ? easeSpring(u) : easeOut(u);
  return [trip.x0 + (tx - trip.x0) * f, trip.y0 + (ty - trip.y0) * f];
}

/** True while any file is on a trip (the render loop must stay at full rate). */
export function tripsActive(files: ReadonlyArray<Pick<FileNode, "trip">>): boolean {
  for (const n of files) if (n.trip) return true;
  return false;
}

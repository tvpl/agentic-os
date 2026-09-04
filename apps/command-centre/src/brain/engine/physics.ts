/**
 * One simulation step: ring rotation, file springs / trips (or the d3 force
 * tick), hub, planet and orb positions, alpha tweens and the zoom/pan tween.
 * Pure; the caller passes time.
 */
import { tripPosition } from "./explosion";
import { targetOf } from "./layouts";
import { RING, RING_SPEED, type World } from "./world";

/** Spring stiffness toward the layout target per 60 fps frame. */
const SPRING = 0.045;
/** Velocity damping per 60 fps frame. */
const DAMPING = 0.86;
/** Largest frame multiplier we integrate (protects against tab-switch jumps). */
const MAX_FRAME = 2.2;
/** Hover highlight tween (seconds) and visibility tween (seconds). */
const HOVER_TWEEN_S = 0.15;
const VIS_TWEEN_S = 0.3;
const RING_FADE_S = 0.8;
/** Alpha of a node outside the hover/selection neighbourhood. */
export const DIM_ALPHA = 0.12;

/**
 * Advance the world by `dt` seconds. With `animate === false` (reduced motion)
 * the rings stop spinning but particles still settle onto their targets.
 */
export function stepWorld(w: World, dt: number, animate: boolean): void {
  w.time += dt;
  if (animate) w.theta += w.spin * dt * 0.45;
  const f = Math.min(MAX_FRAME, dt * 60);

  if (w.layout === "force") {
    for (const n of w.files) {
      if (n.pinned) {
        n.fx = n.x;
        n.fy = n.y;
      } else if (n.fx != null) {
        n.fx = null;
        n.fy = null;
      }
    }
    w.sim?.tick();
    // A trip under force (layout switch into force) is dropped: the simulation owns positions.
    for (const n of w.files) n.trip = null;
  } else {
    const damp = Math.pow(DAMPING, f);
    for (const n of w.files) {
      const [tx, ty] = targetOf(n, w.theta);
      n.tx = tx;
      n.ty = ty;
      if (n.pinned) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      if (n.trip) {
        const p = tripPosition(n.trip, w.time, tx, ty);
        if (p) {
          n.x = p[0];
          n.y = p[1];
          continue;
        }
        n.trip = null;
        n.x = tx;
        n.y = ty;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx = n.vx * damp + (n.tx - n.x) * SPRING * f;
      n.vy = n.vy * damp + (n.ty - n.y) * SPRING * f;
      n.x += n.vx * f;
      n.y += n.vy * f;
    }
  }

  // Alpha tweens: neighbour highlight and visibility (local mode / timeline).
  const hoverStep = Math.min(1, dt / HOVER_TWEEN_S);
  const visStep = Math.min(1, dt / VIS_TWEEN_S);
  const focus = w.focusSet;
  for (let i = 0; i < w.files.length; i++) {
    const n = w.files[i]!;
    const hoverTarget = focus === null ? 1 : focus.has(i) ? 1 : DIM_ALPHA;
    n.hoverAlpha += (hoverTarget - n.hoverAlpha) * hoverStep;
    if (Math.abs(hoverTarget - n.hoverAlpha) < 0.005) n.hoverAlpha = hoverTarget;
    const visTarget = n.visible ? 1 : 0;
    n.visAlpha += (visTarget - n.visAlpha) * visStep;
    if (Math.abs(visTarget - n.visAlpha) < 0.005) n.visAlpha = visTarget;
  }
  if (w.ringFade < 1) w.ringFade = Math.min(1, w.ringFade + dt / RING_FADE_S);

  const cosT = Math.cos(w.theta);
  const sinT = Math.sin(w.theta);
  for (const hub of w.hubs) {
    const bx = Math.cos(hub.baseAngle) * RING.hubs;
    const by = Math.sin(hub.baseAngle) * RING.hubs;
    hub.x = bx * cosT - by * sinT;
    hub.y = bx * sinT + by * cosT;
  }
  for (const p of w.planets) {
    const [x, y] = targetOf(p, w.theta);
    p.x = x;
    p.y = y;
  }
  for (const orb of w.orbs) {
    const a = orb.baseAngle + w.theta * RING_SPEED[orb.kind];
    orb.x = Math.cos(a) * orb.radius;
    orb.y = Math.sin(a) * orb.radius;
  }
}

/** Ease the view transform toward its target (animated zoom / centring). */
export function tweenTransform(w: World, dt: number): void {
  const tf = Math.min(1, dt * 7);
  const tr = w.transform;
  const tg = w.target;
  tr.x += (tg.x - tr.x) * tf;
  tr.y += (tg.y - tr.y) * tf;
  tr.k += (tg.k - tr.k) * tf;
  if (Math.abs(tg.x - tr.x) < 0.02 && Math.abs(tg.y - tr.y) < 0.02 && Math.abs(tg.k - tr.k) < 0.0005) {
    tr.x = tg.x;
    tr.y = tg.y;
    tr.k = tg.k;
  }
}

/** True while the transform still differs from its target. */
export function transformSettled(w: Pick<World, "transform" | "target">): boolean {
  return w.transform.x === w.target.x && w.transform.y === w.target.y && w.transform.k === w.target.k;
}

/** Largest distance between any (unpinned) file and its layout target — 0 means fully settled. */
export function maxDisplacement(w: World): number {
  let max = 0;
  for (const n of w.files) {
    if (n.pinned) continue;
    const [tx, ty] = targetOf(n, w.theta);
    max = Math.max(max, Math.hypot(tx - n.x, ty - n.y));
  }
  return max;
}

/** True while any alpha tween (hover / visibility / ring fade) is still moving. */
export function alphasSettled(w: Pick<World, "files" | "focusSet" | "ringFade">): boolean {
  if (w.ringFade < 1) return false;
  const focus = w.focusSet;
  for (let i = 0; i < w.files.length; i++) {
    const n = w.files[i]!;
    const hoverTarget = focus === null ? 1 : focus.has(i) ? 1 : DIM_ALPHA;
    if (n.hoverAlpha !== hoverTarget) return false;
    if (n.visAlpha !== (n.visible ? 1 : 0)) return false;
  }
  return true;
}

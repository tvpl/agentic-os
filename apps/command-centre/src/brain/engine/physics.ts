/**
 * One simulation step: ring rotation, file springs (or the d3 force tick),
 * hub and orb positions, and the zoom/pan tween. Pure; the caller passes time.
 */
import { targetOf } from "./layouts";
import { RING, RING_SPEED, type World } from "./world";

/** Spring stiffness toward the layout target per 60 fps frame. */
const SPRING = 0.045;
/** Velocity damping per 60 fps frame. */
const DAMPING = 0.86;
/** Largest frame multiplier we integrate (protects against tab-switch jumps). */
const MAX_FRAME = 2.2;

/**
 * Advance the world by `dt` seconds. With `animate === false` (reduced motion)
 * the rings stop spinning but particles still settle onto their targets.
 */
export function stepWorld(w: World, dt: number, animate: boolean): void {
  if (animate) w.theta += w.spin * dt * 0.45;

  if (w.layout === "force") {
    w.sim?.tick();
  } else {
    const f = Math.min(MAX_FRAME, dt * 60);
    const damp = Math.pow(DAMPING, f);
    for (const n of w.files) {
      const [tx, ty] = targetOf(n, w.theta);
      n.tx = tx;
      n.ty = ty;
      n.vx = n.vx * damp + (n.tx - n.x) * SPRING * f;
      n.vy = n.vy * damp + (n.ty - n.y) * SPRING * f;
      n.x += n.vx * f;
      n.y += n.vy * f;
    }
  }

  const cosT = Math.cos(w.theta);
  const sinT = Math.sin(w.theta);
  for (const hub of w.hubs) {
    const bx = Math.cos(hub.baseAngle) * RING.hubs;
    const by = Math.sin(hub.baseAngle) * RING.hubs;
    hub.x = bx * cosT - by * sinT;
    hub.y = bx * sinT + by * cosT;
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
}

/** Largest distance between any file and its layout target — 0 means fully settled. */
export function maxDisplacement(w: World): number {
  let max = 0;
  for (const n of w.files) {
    const [tx, ty] = targetOf(n, w.theta);
    max = Math.max(max, Math.hypot(tx - n.x, ty - n.y));
  }
  return max;
}

/**
 * One physics step: ring rotation, transform tween, springy file motion,
 * hub/orb placement, effect ageing and comet trails. Returns whether
 * anything is still moving so the loop can go idle (dirty-flag rendering).
 */
import { targetOf } from "./layouts";
import { RING, RING_SPEED, type World } from "./world";

export interface TickResult {
  /** True while positions or the transform are still converging. */
  moving: boolean;
}

const VELOCITY_EPS = 0.02;
const DISTANCE_EPS = 0.05;
const TRANSFORM_EPS = 0.01;

/**
 * @param dt seconds since the previous tick (clamped by the caller)
 * @param now seconds (performance.now() / 1000), used for effects and comets
 * @param animate false under reduced motion: no spin, snapping tweens
 */
export function tick(w: World, dt: number, now: number, animate: boolean): TickResult {
  let moving = false;
  if (animate && w.spin > 0) {
    w.theta += w.spin * dt * 0.45;
    moving = true;
  }

  const tr = w.transform;
  const tg = w.target;
  const tf = animate ? Math.min(1, dt * 7) : 1;
  tr.x += (tg.x - tr.x) * tf;
  tr.y += (tg.y - tr.y) * tf;
  tr.k += (tg.k - tr.k) * tf;
  if (Math.abs(tg.x - tr.x) + Math.abs(tg.y - tr.y) + Math.abs(tg.k - tr.k) * 100 > TRANSFORM_EPS) moving = true;
  else {
    tr.x = tg.x;
    tr.y = tg.y;
    tr.k = tg.k;
  }

  if (w.layout === "force" && w.sim) {
    if (w.sim.alpha() > w.sim.alphaMin()) {
      w.sim.tick();
      moving = true;
    }
  } else {
    const f = animate ? Math.min(2.2, dt * 60) : 1;
    const damp = animate ? Math.pow(0.86, f) : 0;
    const gain = animate ? 0.045 * f : 1;
    let maxV = 0;
    let maxD = 0;
    for (const n of w.files) {
      const [tx, ty] = targetOf(n, w.theta);
      n.tx = tx;
      n.ty = ty;
      n.vx = n.vx * damp + (tx - n.x) * gain;
      n.vy = n.vy * damp + (ty - n.y) * gain;
      n.x += n.vx * f;
      n.y += n.vy * f;
      const v = Math.abs(n.vx) + Math.abs(n.vy);
      const d = Math.abs(tx - n.x) + Math.abs(ty - n.y);
      if (v > maxV) maxV = v;
      if (d > maxD) maxD = d;
    }
    if (maxV > VELOCITY_EPS || maxD > DISTANCE_EPS) moving = true;
    else {
      for (const n of w.files) {
        n.vx = 0;
        n.vy = 0;
      }
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
    const speed = orb.kind === "skill" ? RING_SPEED.skills : orb.kind === "routine" ? RING_SPEED.routines : RING_SPEED.apps;
    const a = orb.baseAngle + w.theta * speed;
    orb.x = Math.cos(a) * orb.radius;
    orb.y = Math.sin(a) * orb.radius;
  }

  if (w.effects.length > 0) {
    w.effects = w.effects.filter((fx) => now - fx.start < 1);
    if (w.effects.length > 0) moving = true;
  }
  if (animate && w.comets.length > 0) {
    for (const comet of w.comets) {
      const [hx, hy] = cometHead(w, comet, now);
      comet.trail.push({ x: hx, y: hy });
      if (comet.trail.length > 16) comet.trail.shift();
    }
    moving = true;
  }
  return { moving };
}

/** Position of a comet head: shuttles between the core and its skill orb. */
export function cometHead(w: World, comet: World["comets"][number], now: number): [number, number] {
  const targetOrb = comet.skillSlug ? w.orbs.find((o) => o.kind === "skill" && o.id === comet.skillSlug) : undefined;
  const tx = targetOrb ? targetOrb.x : Math.cos(comet.seed + now * 0.4) * RING.hubs * 0.7;
  const ty = targetOrb ? targetOrb.y : Math.sin(comet.seed + now * 0.4) * RING.hubs * 0.7;
  const cycle = (now * 0.4 + comet.seed) % 2;
  const p = cycle < 1 ? cycle : 2 - cycle;
  const ease = p * p * (3 - 2 * p);
  const bulge = Math.sin(ease * Math.PI) * 44;
  const dl = Math.hypot(ty, -tx) || 1;
  return [tx * ease + (ty / dl) * bulge, ty * ease + (-tx / dl) * bulge];
}

/** Gathers a hub's files at the hub and hurls them outward (expand) or inward (collapse). */
export function explodeHub(w: World, hub: World["hubs"][number], now: number, random: () => number = Math.random): void {
  for (const n of w.files) {
    if (n.group !== hub.key) continue;
    n.x = hub.x + (random() - 0.5) * 6;
    n.y = hub.y + (random() - 0.5) * 6;
    const a = random() * Math.PI * 2;
    const kick = hub.expanded ? 6 + random() * 5 : 2;
    n.vx = Math.cos(a) * kick;
    n.vy = Math.sin(a) * kick;
  }
  w.effects.push({ x: hub.x, y: hub.y, start: now, color: hub.color });
}

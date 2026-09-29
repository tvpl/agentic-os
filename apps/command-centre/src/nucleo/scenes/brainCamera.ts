/**
 * The Brain scene's camera rig (immersive shell): how a hand moves through
 * the sky. The camera is a perspective eye looking at a focus point from a
 * distance along a heading (yaw) and a tilt (pitch); every gesture turns
 * into motion of that rig — orbiting the focus, panning it across the screen,
 * dollying towards the point under the cursor, flying forwards and sideways —
 * and every motion keeps a velocity that glides and settles (damping) once
 * the hand lets go. Framing fits a set of points into the free part of the
 * screen from the current heading. Pure: no DOM, no clock of its own.
 */
import { clamp, NEAR, PITCH_LIMIT, zoomAbout, type Camera, type Vec3 } from "./brainSpace";

/** The camera's axes in world space: screen right, screen down, and into the screen. */
export interface Basis {
  right: Vec3;
  down: Vec3;
  fwd: Vec3;
}

/** Velocity of every degree of freedom of the rig (per second; zoom is log-distance per second). */
export interface CamVel {
  yaw: number;
  pitch: number;
  x: number;
  y: number;
  z: number;
  zoom: number;
}

export const zeroVel = (): CamVel => ({ yaw: 0, pitch: 0, x: 0, y: 0, z: 0, zoom: 0 });

/** How fast each kind of motion settles once the hand lets go (per second). */
export const DAMPING = { orbit: 3.6, pan: 4.8, zoom: 9 } as const;
/** Fly keys: the cruise speed as a share of the distance to the focus, per second. */
export const FLY_SPEED = 0.85;

/** The axes of a camera with this heading and tilt (the same convention as `project`). */
export function basis(yaw: number, pitch: number): Basis {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    right: { x: cy, y: 0, z: -sy },
    down: { x: -sy * sp, y: cp, z: -cy * sp },
    fwd: { x: sy * cp, y: sp, z: cy * cp },
  };
}

/** Where the eye is. */
export function eyeOf(cam: Camera): Vec3 {
  const { fwd } = basis(cam.yaw, cam.pitch);
  return { x: cam.tx - fwd.x * cam.dist, y: cam.ty - fwd.y * cam.dist, z: cam.tz - fwd.z * cam.dist };
}

/** Turn around the focus point (radians). The tilt stops at the poles. */
export function orbitBy(cam: Camera, dYaw: number, dPitch: number): void {
  cam.yaw += dYaw;
  cam.pitch = clamp(cam.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
}

/** World units one screen pixel spans at the focus distance. */
export const pxToWorld = (cam: Camera, focal: number): number => cam.dist / Math.max(1, focal);

/**
 * Slide the focus so the sky follows the hand: dragging `dx, dy` pixels moves
 * what is at the focus distance by exactly that much on screen.
 */
export function panBy(cam: Camera, dx: number, dy: number, focal: number): void {
  const { right, down } = basis(cam.yaw, cam.pitch);
  const k = pxToWorld(cam, focal);
  cam.tx -= (right.x * dx + down.x * dy) * k;
  cam.ty -= (right.y * dx + down.y * dy) * k;
  cam.tz -= (right.z * dx + down.z * dy) * k;
}

/** A screen-space velocity (px/s) of the hand as a world velocity of the focus. */
export function panVelocity(cam: Camera, vx: number, vy: number, focal: number): Vec3 {
  const { right, down } = basis(cam.yaw, cam.pitch);
  const k = -pxToWorld(cam, focal);
  return {
    x: (right.x * vx + down.x * vy) * k,
    y: (right.y * vx + down.y * vy) * k,
    z: (right.z * vx + down.z * vy) * k,
  };
}

/**
 * Dolly by `factor` (new distance = old × factor) towards `anchor`, which
 * stays where it is on screen. The factor is limited so the distance stays in
 * [lo, hi]; returns the factor actually applied.
 */
export function dollyBy(cam: Camera, anchor: Vec3, factor: number, lo: number, hi: number): number {
  const next = clamp(cam.dist * factor, lo, Math.max(lo, hi));
  const f = next / cam.dist;
  if (Math.abs(f - 1) < 1e-9) return 1;
  const c = zoomAbout(cam, anchor, f);
  cam.tx = c.tx;
  cam.ty = c.ty;
  cam.tz = c.tz;
  cam.dist = c.dist;
  return f;
}

export interface StepOptions {
  /** Distance limits of the moment. */
  lo: number;
  hi: number;
  /** The point the zoom glides towards (null: the focus). */
  anchor: Vec3 | null;
  /** A wanted velocity of the focus (fly keys), or null to let it settle. */
  thrust?: Vec3 | null;
}

const EPS = { turn: 0.002, move: 0.01, zoom: 0.004 };

/**
 * Advance the rig by `dt` seconds: apply every velocity, then damp it. A held
 * thrust pulls the focus velocity towards it instead of damping it. True while
 * anything still moves.
 */
export function stepCamera(cam: Camera, vel: CamVel, dt: number, opts: StepOptions): boolean {
  if (dt <= 0) return isMoving(vel) || Boolean(opts.thrust);
  // orbit
  if (vel.yaw !== 0 || vel.pitch !== 0) {
    cam.yaw += vel.yaw * dt;
    const p = cam.pitch + vel.pitch * dt;
    cam.pitch = clamp(p, -PITCH_LIMIT, PITCH_LIMIT);
    if (p !== cam.pitch) vel.pitch = 0;
    const k = Math.exp(-DAMPING.orbit * dt);
    vel.yaw *= k;
    vel.pitch *= k;
    if (Math.abs(vel.yaw) < EPS.turn) vel.yaw = 0;
    if (Math.abs(vel.pitch) < EPS.turn) vel.pitch = 0;
  }
  // pan / fly
  const thrust = opts.thrust;
  if (thrust) {
    const k = 1 - Math.exp(-7 * dt);
    vel.x += (thrust.x - vel.x) * k;
    vel.y += (thrust.y - vel.y) * k;
    vel.z += (thrust.z - vel.z) * k;
  }
  if (vel.x !== 0 || vel.y !== 0 || vel.z !== 0) {
    cam.tx += vel.x * dt;
    cam.ty += vel.y * dt;
    cam.tz += vel.z * dt;
    if (!thrust) {
      const k = Math.exp(-DAMPING.pan * dt);
      vel.x *= k;
      vel.y *= k;
      vel.z *= k;
      const floor = EPS.move * Math.max(1, cam.dist) * 0.01;
      if (Math.hypot(vel.x, vel.y, vel.z) < floor) vel.x = vel.y = vel.z = 0;
    }
  }
  // dolly
  if (vel.zoom !== 0) {
    const want = Math.exp(vel.zoom * dt);
    const got = dollyBy(cam, opts.anchor ?? { x: cam.tx, y: cam.ty, z: cam.tz }, want, opts.lo, opts.hi);
    if (Math.abs(got - want) > 1e-6) vel.zoom = 0;
    vel.zoom *= Math.exp(-DAMPING.zoom * dt);
    if (Math.abs(vel.zoom) < EPS.zoom) vel.zoom = 0;
  }
  return isMoving(vel) || Boolean(thrust);
}

export function isMoving(vel: CamVel): boolean {
  return vel.yaw !== 0 || vel.pitch !== 0 || vel.x !== 0 || vel.y !== 0 || vel.z !== 0 || vel.zoom !== 0;
}

export function stopVel(vel: CamVel): void {
  vel.yaw = vel.pitch = vel.x = vel.y = vel.z = vel.zoom = 0;
}

/** Held fly keys as a direction in camera terms. */
export interface FlyInput {
  /** −1 left … +1 right. */
  right: number;
  /** −1 back … +1 forward. */
  forward: number;
  /** −1 down … +1 up. */
  up: number;
}

/** The world velocity the fly keys ask for (cruise speed scales with how far the focus is). */
export function flyThrust(cam: Camera, input: FlyInput, speed = FLY_SPEED): Vec3 | null {
  if (input.right === 0 && input.forward === 0 && input.up === 0) return null;
  const { right, down, fwd } = basis(cam.yaw, cam.pitch);
  const s = speed * Math.max(60, cam.dist);
  const n = Math.hypot(input.right, input.forward, input.up) || 1;
  const r = (input.right / n) * s;
  const f = (input.forward / n) * s;
  const u = (input.up / n) * s;
  return {
    x: right.x * r + fwd.x * f - down.x * u,
    y: right.y * r + fwd.y * f - down.y * u,
    z: right.z * r + fwd.z * f - down.z * u,
  };
}

/* ------------------------------------------------------------ framing */

export interface FitOptions {
  /** Space kept free around the points (px). */
  margin?: number;
  /** Keep the focus on this point (only the distance is fitted). */
  centre?: Vec3;
  /** Closest the camera may stand. */
  min?: number;
}

export interface Fit {
  tx: number;
  ty: number;
  tz: number;
  dist: number;
}

/**
 * The focus and distance that show every point inside a free area of
 * `freeW × freeH` px (minus the margin) from this heading and tilt, centred
 * in it. Perspective is exact: the distance is searched, not estimated.
 */
export function fitView(
  points: readonly Vec3[],
  yaw: number,
  pitch: number,
  focal: number,
  freeW: number,
  freeH: number,
  opts: FitOptions = {},
): Fit {
  const min = opts.min ?? 120;
  const n = points.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  if (opts.centre) ({ x: cx, y: cy, z: cz } = opts.centre);
  else if (n > 0) {
    for (const p of points) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    cx /= n;
    cy /= n;
    cz /= n;
  }
  if (n === 0) return { tx: cx, ty: cy, tz: cz, dist: min };
  const { right, down, fwd } = basis(yaw, pitch);
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const Z = new Float64Array(n);
  points.forEach((p, i) => {
    const x = p.x - cx;
    const y = p.y - cy;
    const z = p.z - cz;
    X[i] = x * right.x + y * right.y + z * right.z;
    Y[i] = x * down.x + y * down.y + z * down.z;
    Z[i] = x * fwd.x + y * fwd.y + z * fwd.z;
  });
  const margin = opts.margin ?? Math.max(36, Math.min(freeW, freeH) * 0.1);
  const halfW = Math.max(16, freeW / 2 - margin);
  const halfH = Math.max(16, freeH / 2 - margin);
  let ox = 0;
  let oy = 0;
  const fits = (d: number) => {
    for (let i = 0; i < n; i++) {
      const depth = Z[i]! + d;
      if (depth < NEAR * 2) return false;
      const s = focal / depth;
      if (Math.abs((X[i]! - ox) * s) > halfW || Math.abs((Y[i]! - oy) * s) > halfH) return false;
    }
    return true;
  };
  const search = () => {
    let lo = 1;
    let hi = Math.max(min, 64);
    let guard = 0;
    while (!fits(hi) && guard++ < 40) hi *= 2;
    for (let k = 0; k < 36; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let d = search();
  if (!opts.centre) {
    for (let iter = 0; iter < 3; iter++) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const s = focal / (Z[i]! + d);
        const sx = (X[i]! - ox) * s;
        const sy = (Y[i]! - oy) * s;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
      ox += ((minX + maxX) / 2) * (d / focal);
      oy += ((minY + maxY) / 2) * (d / focal);
      d = search();
    }
  }
  const dist = Math.max(min, d);
  return {
    tx: cx + right.x * ox + down.x * oy,
    ty: cy + right.y * ox + down.y * oy,
    tz: cz + right.z * ox + down.z * oy,
    dist,
  };
}

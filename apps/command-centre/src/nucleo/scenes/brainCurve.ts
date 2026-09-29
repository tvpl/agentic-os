/**
 * The Brain scene's synapses as curves (immersive shell). A link is a
 * quadratic Bézier in 3D that bows away from the centre it belongs to (its
 * cluster, the time axis, the note you are inside), so a web of links reads
 * as arches around a body instead of a hairball of chords. The same curve
 * carries the pulses of light and the camera when you travel through it.
 * Pure.
 */
import { hash01, type Vec3 } from "./brainSpace";

/** How far a link bows, as a share of its length. */
export const BEND = 0.2;

/**
 * The control point of the link `a → b` bowing away from `centre`. When the
 * midpoint sits on the centre (a diameter), it bows sideways along a
 * direction chosen by `seed`, so the result is stable frame to frame.
 */
export function controlPoint(a: Vec3, b: Vec3, centre: Vec3, bend = BEND, seed = 0): Vec3 {
  const out = new Float64Array(3);
  controlPointInto(out, 0, a.x, a.y, a.z, b.x, b.y, b.z, centre.x, centre.y, centre.z, bend, seed);
  return { x: out[0]!, y: out[1]!, z: out[2]! };
}

/** `controlPoint` without allocating: writes x, y, z at `out[o…o+2]` (the render loop's version). */
export function controlPointInto(
  out: Float64Array,
  o: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  bend = BEND,
  seed = 0,
): void {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const mz = (az + bz) / 2;
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  if (len < 1e-6) {
    out[o] = mx;
    out[o + 1] = my;
    out[o + 2] = mz;
    return;
  }
  let ox = mx - cx;
  let oy = my - cy;
  let oz = mz - cz;
  // Only the part of "outward" perpendicular to the link bends it.
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const uz = (bz - az) / len;
  const along = ox * ux + oy * uy + oz * uz;
  ox -= along * ux;
  oy -= along * uy;
  oz -= along * uz;
  let ol = Math.hypot(ox, oy, oz);
  if (ol < len * 0.02) {
    // A diameter: any perpendicular will do, picked by the seed.
    const ang = hash01(seed, 91) * Math.PI * 2;
    const [px, py, pz] = perpendicular(ux, uy, uz);
    const qx = uy * pz - uz * py;
    const qy = uz * px - ux * pz;
    const qz = ux * py - uy * px;
    ox = px * Math.cos(ang) + qx * Math.sin(ang);
    oy = py * Math.cos(ang) + qy * Math.sin(ang);
    oz = pz * Math.cos(ang) + qz * Math.sin(ang);
    ol = 1;
  }
  const k = (len * bend * (0.85 + 0.3 * hash01(seed, 92))) / ol;
  out[o] = mx + ox * k;
  out[o + 1] = my + oy * k;
  out[o + 2] = mz + oz * k;
}

function perpendicular(x: number, y: number, z: number): [number, number, number] {
  // Cross with the axis least aligned with the vector.
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let px: number;
  let py: number;
  let pz: number;
  if (ax <= ay && ax <= az) [px, py, pz] = [0, -z, y];
  else if (ay <= az) [px, py, pz] = [-z, 0, x];
  else [px, py, pz] = [-y, x, 0];
  const l = Math.hypot(px, py, pz) || 1;
  return [px / l, py / l, pz / l];
}

/** A point on the quadratic Bézier `a → b` through control `c`. */
export function bezier(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  };
}

/** Its (unnormalised) tangent. */
export function bezierTangent(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return {
    x: 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x),
    y: 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y),
    z: 2 * u * (c.z - a.z) + 2 * t * (b.z - c.z),
  };
}

/** `n + 1` points along the curve, both ends included. */
export function sampleCurve(a: Vec3, c: Vec3, b: Vec3, n: number): Vec3[] {
  const steps = Math.max(1, Math.round(n));
  const out: Vec3[] = [];
  for (let i = 0; i <= steps; i++) out.push(bezier(a, c, b, i / steps));
  return out;
}

/** Arc length of the curve (a polyline estimate). */
export function curveLength(a: Vec3, c: Vec3, b: Vec3, n = 16): number {
  const pts = sampleCurve(a, c, b, n);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    len += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  }
  return len;
}

/** The 2D quadratic Bézier at `t` (screen space: the curve as drawn). */
export function quad2(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
}

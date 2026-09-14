/**
 * Camera flights: a timed, eased journey of the view transform from where it
 * is now to a target, with a zoom-out-then-in dip on long trips (a light
 * van Wijk approximation). Pure over the world; the render loop advances the
 * flight each frame with `stepFlight`, gestures cancel it with `cancelFlight`.
 * Also home to the content-bounds helpers the camera fits to.
 */
import { targetOf } from "./layouts";
import { RING, clampZoom, type FileNode, type Hub, type Transform, type World } from "./world";

export type Ease = (t: number) => number;

export interface CameraFlight {
  from: Transform;
  to: Transform;
  /** World-clock seconds when the flight started. */
  startedAt: number;
  /** Seconds. */
  duration: number;
  ease: Ease;
  /** Zoom reached at the midpoint on a long trip (log-space dip), or null for a plain interpolation. */
  dipK: number | null;
}

export interface FlightOptions {
  /** Seconds (default 0.52). 0 jumps straight to the target (reduced motion). */
  duration?: number;
  ease?: Ease;
}

export const FLIGHT_DURATION_S = 0.52;

/** Ease-in-out cubic. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/** A screen rectangle (client coordinates). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Screen insets that keep overlay `panels` out of the framed region of
 * `view` (same coordinate space). Each panel is pushed out along the edge
 * that costs the least free space, so a sidebar reserves a left or right
 * band, a top bar a top band and a bottom sheet a bottom band — whatever the
 * stylesheet decided. Panels with no area (hidden) or outside the view are
 * ignored; `margin` is kept clear past every panel and along the free edges.
 */
export function reserveInsets(view: Rect, panels: ReadonlyArray<Rect>, margin = 0): Insets {
  const ins: Insets = { left: 0, right: 0, top: 0, bottom: margin };
  const edges: ReadonlyArray<keyof Insets> = ["left", "right", "top", "bottom"];
  for (const p of panels) {
    if (!(p.right > p.left && p.bottom > p.top)) continue;
    const cost: Insets = {
      left: p.right - view.left,
      right: view.right - p.left,
      top: p.bottom - view.top,
      bottom: view.bottom - p.top,
    };
    if (edges.some((e) => cost[e] <= 0)) continue; // entirely outside the view
    let edge: keyof Insets = "left";
    for (const e of edges) if (cost[e] < cost[edge]) edge = e;
    ins[edge] = Math.max(ins[edge], cost[edge] + margin);
  }
  return ins;
}

/**
 * Where a file will be once its trip ends: the rotated layout target while it
 * is mid-trip (its live point drifts under the camera), the live point
 * otherwise (pinned files and force layouts own their positions).
 */
export function restingPoint(
  w: Pick<World, "theta">,
  n: Pick<FileNode, "x" | "y" | "trip" | "pinned" | "baseAngle" | "baseRadius">,
): [number, number] {
  return n.trip && !n.pinned ? targetOf(n, w.theta) : [n.x, n.y];
}

/** Sanitise a target transform (finite, clamped zoom). */
function safe(t: Transform): Transform {
  const k = clampZoom(Number.isFinite(t.k) ? t.k : 1);
  return { x: Number.isFinite(t.x) ? t.x : 0, y: Number.isFinite(t.y) ? t.y : 0, k };
}

const same = (a: Transform, b: Transform): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.k - b.k) < 0.002;

/**
 * Plan a flight from `from` to `to`. When the pan distance is large relative
 * to the viewport the zoom dips to ~max(0.6·min(k0,k1), 0.3) at the midpoint
 * so the trip reads as "pull back, glide, dive in" instead of a slide.
 */
export function planFlight(
  from: Transform,
  to: Transform,
  view: { width: number; height: number },
  now: number,
  opts: FlightOptions = {},
): CameraFlight {
  const end = safe(to);
  const start = safe(from);
  const duration = Math.max(0, opts.duration ?? FLIGHT_DURATION_S);
  const ease = opts.ease ?? easeInOutCubic;
  const dcx = -end.x / end.k - -start.x / start.k;
  const dcy = -end.y / end.k - -start.y / start.k;
  const kMin = Math.min(start.k, end.k);
  const screenDist = Math.hypot(dcx, dcy) * kMin;
  const longTrip = screenDist > 0.45 * Math.min(view.width, view.height);
  const dip = Math.max(0.6 * kMin, 0.3);
  const mid = Math.exp((Math.log(start.k) + Math.log(end.k)) / 2);
  const dipK = longTrip && dip < mid ? dip : null;
  return { from: start, to: end, startedAt: now, duration, ease, dipK };
}

/** The transform at world-clock `now` for a flight, plus whether it has finished. */
export function flightAt(f: CameraFlight, now: number): { transform: Transform; done: boolean } {
  const u = f.duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - f.startedAt) / f.duration));
  if (u >= 1) return { transform: { ...f.to }, done: true };
  const e = f.ease(u);
  const lk0 = Math.log(f.from.k);
  const lk1 = Math.log(f.to.k);
  let lk = lk0 + (lk1 - lk0) * e;
  if (f.dipK !== null) {
    const midLog = (lk0 + lk1) / 2;
    lk += Math.sin(Math.PI * e) * (Math.log(f.dipK) - midLog);
  }
  const k = Math.exp(lk);
  // Interpolate the world point under the viewport centre, then re-anchor it at zoom k.
  const cx0 = -f.from.x / f.from.k;
  const cy0 = -f.from.y / f.from.k;
  const cx1 = -f.to.x / f.to.k;
  const cy1 = -f.to.y / f.to.k;
  const cx = cx0 + (cx1 - cx0) * e;
  const cy = cy0 + (cy1 - cy0) * e;
  return { transform: { x: 0 - cx * k, y: 0 - cy * k, k }, done: false };
}

/**
 * Start (or restart) a flight toward `to`. A flight already heading to the
 * same place is left alone so repeated clicks do not stutter; a zero duration
 * jumps. The live target follows the transform during the flight so the
 * regular tween never fights it.
 */
export function startFlight(
  w: Pick<World, "transform" | "target" | "flight" | "time">,
  to: Transform,
  view: { width: number; height: number },
  opts: FlightOptions = {},
): void {
  const end = safe(to);
  if (w.flight && same(w.flight.to, end)) return;
  if ((opts.duration ?? FLIGHT_DURATION_S) <= 0 || same(w.transform, end)) {
    w.flight = null;
    w.transform = { ...end };
    w.target = { ...end };
    return;
  }
  w.flight = planFlight(w.transform, end, view, w.time, opts);
  w.target = { ...w.transform };
}

/** Advance the active flight to world-clock `now` (no-op without one). */
export function stepFlight(w: Pick<World, "transform" | "target" | "flight">, now: number): void {
  const f = w.flight;
  if (!f) return;
  const { transform, done } = flightAt(f, now);
  w.transform = transform;
  w.target = { ...transform };
  if (done) w.flight = null;
}

/** A gesture took over: drop the flight where it is, with no jump. */
export function cancelFlight(w: Pick<World, "transform" | "target" | "flight">): void {
  if (!w.flight) return;
  w.flight = null;
  w.target = { ...w.transform };
}

/** Axis-aligned bounds of a point set (null when empty). */
export function boundsOf(points: Iterable<{ x: number; y: number }>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return b;
}

/**
 * Transform that fits `bounds` into the part of the viewport left free by
 * overlay panels (`insets`, screen px), with `padding` world units around it.
 * The fitted content is centred in the free region, not in the canvas.
 */
export function fitToBounds(
  bounds: Bounds | null,
  view: { width: number; height: number },
  opts: { padding?: number; insets?: Partial<Insets>; maxK?: number } = {},
): Transform {
  const insets = { ...NO_INSETS, ...opts.insets };
  const padding = opts.padding ?? 40;
  const freeW = Math.max(80, view.width - insets.left - insets.right);
  const freeH = Math.max(80, view.height - insets.top - insets.bottom);
  const offX = (insets.left - insets.right) / 2;
  const offY = (insets.top - insets.bottom) / 2;
  if (!bounds) return { x: offX, y: offY, k: 1 };
  const bw = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const bh = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const k = clampZoom(Math.min(freeW / bw, freeH / bh, opts.maxK ?? 4));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: offX - cx * k, y: offY - cy * k, k };
}

/** Transform that puts world point (x, y) at the centre of the free region at zoom k. */
export function centreTransform(x: number, y: number, k: number, insets: Partial<Insets> = {}): Transform {
  const ins = { ...NO_INSETS, ...insets };
  const nk = clampZoom(k);
  return { x: (ins.left - ins.right) / 2 - x * nk, y: (ins.top - ins.bottom) / 2 - y * nk, k: nk };
}

/** Bounds of everything drawn: visible files, hubs and orbs (rings included through the orbs). */
export function contentBounds(w: Pick<World, "files" | "hubs" | "orbs">): Bounds | null {
  const pts: Array<{ x: number; y: number }> = [];
  for (const n of w.files) if (n.visAlpha >= 0.3 || n.visible) pts.push(n);
  for (const h of w.hubs) pts.push(h);
  for (const o of w.orbs) pts.push(o);
  if (pts.length === 0) {
    // Nothing loaded yet: fall back to the ring guides.
    pts.push({ x: -RING.apps, y: -RING.apps }, { x: RING.apps, y: RING.apps });
  }
  return boundsOf(pts);
}

/** Bounds of a hub's sector: the hub disc plus the (rotated) targets of its files and planets. */
export function sectorBounds(
  w: Pick<World, "files" | "planets" | "theta">,
  hub: Pick<Hub, "key" | "baseAngle">,
): Bounds {
  const hx = Math.cos(hub.baseAngle + w.theta) * RING.hubs;
  const hy = Math.sin(hub.baseAngle + w.theta) * RING.hubs;
  const pts: Array<{ x: number; y: number }> = [{ x: hx, y: hy }];
  for (const n of w.files) {
    if (n.group !== hub.key) continue;
    const [x, y] = n.pinned ? [n.x, n.y] : targetOf(n, w.theta);
    pts.push({ x, y });
  }
  for (const p of w.planets) {
    if (p.hubKey !== hub.key) continue;
    const [x, y] = targetOf(p, w.theta);
    pts.push({ x, y });
  }
  return boundsOf(pts)!;
}

/** Bounds of the files of one sub-folder planet (targets, so a mid-fan click still frames correctly). */
export function planetBounds(
  w: Pick<World, "files" | "theta">,
  planet: { hubKey: string; dir: string; x: number; y: number },
): Bounds {
  const pts: Array<{ x: number; y: number }> = [{ x: planet.x, y: planet.y }];
  for (const n of w.files) {
    if (n.group !== planet.hubKey || n.dir !== planet.dir) continue;
    const [x, y] = n.pinned ? [n.x, n.y] : targetOf(n, w.theta);
    pts.push({ x, y });
  }
  return boundsOf(pts)!;
}

/** Bounds of a collapsed hub: its disc and halo. */
export function hubBounds(hub: Pick<Hub, "x" | "y">, halo = 60): Bounds {
  return { minX: hub.x - halo, minY: hub.y - halo, maxX: hub.x + halo, maxY: hub.y + halo };
}

/**
 * Where a zoom-by-factor should land: scaled from the flight's destination
 * when one is in progress (so Reset then Zoom in twice lands on exactly
 * 1.69, never on a mid-flight value), else from the current target.
 */
export function zoomTarget(
  w: Pick<World, "target" | "flight">,
  factor: number,
  clamp: (k: number) => number,
): Transform {
  const base = w.flight ? w.flight.to : w.target;
  const k = clamp(base.k * factor);
  // pan is expressed in screen px for the world origin: keep the same world
  // point under the viewport centre while the scale changes
  return { x: (base.x * k) / base.k, y: (base.y * k) / base.k, k };
}

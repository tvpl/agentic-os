/**
 * The Brain scene's space (immersive shell): where every note sits in 3D,
 * how the camera sees it and how it travels. Pure — no DOM, no React — so
 * the constellation's geometry is unit tested.
 *
 * Areas are clusters placed on a ring (a sphere past six); a cluster's notes
 * fill a flattened ellipsoid around its centre, the most linked nearest the
 * middle, then links pull related notes a little closer. Positions are a
 * function of the note ids, so a refresh never scrambles the sky.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera {
  yaw: number;
  pitch: number;
  /** Distance from the target along the view axis. */
  dist: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface View {
  /** Screen point the camera target lands on. */
  cx: number;
  cy: number;
  focal: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale (1 = at `focal` distance). */
  s: number;
  /** Depth (larger = further). */
  d: number;
}

export const PITCH_LIMIT = 1.25;
/** Points closer than this to the eye are culled. */
export const NEAR = 30;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function easeInOutCubic(t: number): number {
  const k = clamp(t, 0, 1);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** Perspective projection: translate to the target, yaw about Y, pitch about X. Null behind the eye. */
export function project(p: Vec3, cam: Camera, view: View): Projected | null {
  const x = p.x - cam.tx;
  const y = p.y - cam.ty;
  const z = p.z - cam.tz;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const y1 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const d = z2 + cam.dist;
  if (d < NEAR) return null;
  const s = view.focal / d;
  return { x: view.cx + x1 * s, y: view.cy + y1 * s, s, d };
}

/**
 * The world point under a screen point, on the plane through the camera
 * target facing the camera (the inverse of `project` at depth `cam.dist`).
 */
export function unproject(sx: number, sy: number, cam: Camera, view: View): Vec3 {
  const s = view.focal / cam.dist;
  const x1 = (sx - view.cx) / s;
  const y1 = (sy - view.cy) / s;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const y = y1 * cp;
  const z1 = -y1 * sp;
  const cy = Math.cos(cam.yaw);
  const sy2 = Math.sin(cam.yaw);
  return { x: cam.tx + x1 * cy + z1 * sy2, y: cam.ty + y, z: cam.tz - x1 * sy2 + z1 * cy };
}

/**
 * Zoom by `factor` (new distance = old × factor) keeping `p` where it is on
 * screen: the target slides towards it as the camera closes in.
 */
export function zoomAbout(cam: Camera, p: Vec3, factor: number): Camera {
  return {
    ...cam,
    dist: cam.dist * factor,
    tx: p.x + (cam.tx - p.x) * factor,
    ty: p.y + (cam.ty - p.y) * factor,
    tz: p.z + (cam.tz - p.z) * factor,
  };
}

/** Wrap an angle into [−π, π). */
export function wrapAngle(a: number): number {
  const t = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
}

export interface Flight {
  from: Camera;
  to: Camera;
  t0: number;
  dur: number;
  /** Extra distance at the middle of the trip: the camera pulls back as it travels (negative: it dives). */
  lift: number;
  /** A curved trip: the camera target follows this quadratic Bézier (a synapse) instead of a straight line. */
  path?: { a: Vec3; c: Vec3; b: Vec3 };
}

/**
 * A camera trip from `from` to `to` (only the given fields change). Yaw takes
 * the shorter way round; a long trip arcs back mid-way so the sky stays in
 * view instead of sliding past at close range.
 */
export function planFlight(from: Camera, to: Partial<Camera>, now: number, dur: number): Flight {
  const target: Camera = { ...from, ...to };
  if (to.yaw !== undefined) target.yaw = from.yaw + wrapAngle(to.yaw - from.yaw);
  if (to.pitch !== undefined) target.pitch = clamp(to.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  const travel = Math.hypot(target.tx - from.tx, target.ty - from.ty, target.tz - from.tz);
  const lift = Math.min(travel * 0.35, Math.max(from.dist, target.dist) * 0.6);
  return { from: { ...from }, to: target, t0: now, dur: Math.max(1, dur), lift };
}

/**
 * A trip through a synapse: the camera target rides the link's curve from
 * `path.a` to `path.b` and dives towards it on the way (`dip` of the
 * distance), arriving at `dist`.
 */
export function planPathFlight(
  from: Camera,
  path: { a: Vec3; c: Vec3; b: Vec3 },
  dist: number,
  now: number,
  dur: number,
  dip = 0.4,
): Flight {
  const to: Camera = { ...from, tx: path.b.x, ty: path.b.y, tz: path.b.z, dist };
  return {
    from: { ...from, tx: path.a.x, ty: path.a.y, tz: path.a.z },
    to,
    t0: now,
    dur: Math.max(1, dur),
    lift: -Math.min(from.dist, dist) * clamp(dip, 0, 0.9),
    path: { a: { ...path.a }, c: { ...path.c }, b: { ...path.b } },
  };
}

/** The camera at `now` along a flight, and whether it has arrived. */
export function flightAt(f: Flight, now: number): { cam: Camera; done: boolean } {
  const k = clamp((now - f.t0) / f.dur, 0, 1);
  const e = easeInOutCubic(k);
  let tx = lerp(f.from.tx, f.to.tx, e);
  let ty = lerp(f.from.ty, f.to.ty, e);
  let tz = lerp(f.from.tz, f.to.tz, e);
  if (f.path) {
    const { a, c, b } = f.path;
    const u = 1 - e;
    tx = u * u * a.x + 2 * u * e * c.x + e * e * b.x;
    ty = u * u * a.y + 2 * u * e * c.y + e * e * b.y;
    tz = u * u * a.z + 2 * u * e * c.z + e * e * b.z;
  }
  const cam: Camera = {
    yaw: lerp(f.from.yaw, f.to.yaw, e),
    pitch: lerp(f.from.pitch, f.to.pitch, e),
    dist: Math.max(NEAR * 1.5, lerp(f.from.dist, f.to.dist, e) + Math.sin(Math.PI * k) * f.lift),
    tx,
    ty,
    tz,
  };
  return { cam, done: k >= 1 };
}

export function centroid(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / points.length, y: y / points.length, z: z / points.length };
}

/** Furthest distance of `points` from `c` (0 for none). */
export function reach(points: readonly Vec3[], c: Vec3): number {
  let r = 0;
  for (const p of points) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
  return r;
}

/** Camera distance that frames a sphere of `radius` (with a floor so one star is not a close-up). */
export function frameDistance(radius: number, min = 220): number {
  return Math.max(min, radius * 2.6 + 120);
}

/** Index of the nearest point within `slop` px of (x, y) (its own radius counts), or −1. */
export function pick(
  points: ReadonlyArray<{ x: number; y: number; r: number } | null>,
  x: number,
  y: number,
  slop = 10,
): number {
  let best = -1;
  let bestD = Infinity;
  points.forEach((p, i) => {
    if (!p) return;
    const lim = p.r + slop;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= lim * lim && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Deterministic 0..1 noise from an integer and a salt (stable positions across rebuilds). */
export function hash01(n: number, salt: number): number {
  let h = (Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export interface Cluster {
  key: string;
  center: Vec3;
  radius: number;
  count: number;
}

export interface StarInput {
  id: number;
  group: string;
  degree: number;
}

export interface Constellation {
  pos: Vec3[];
  clusters: Cluster[];
  /** Radius of the whole sky around the origin. */
  radius: number;
}

export function clusterRadius(count: number): number {
  return 46 + 24 * Math.sqrt(Math.max(1, count));
}

/**
 * Place every star. `order` is the cluster order (largest first); groups
 * missing from it are appended. Edges are pairs of indices into `files`;
 * only authored ones (`strong`, the default) pull — structural edges (same
 * folder) would collapse a cluster that is already together.
 */
export function layoutConstellation(
  files: readonly StarInput[],
  edges: ReadonlyArray<{ a: number; b: number; strong?: boolean }>,
  order: readonly string[] = [],
): Constellation {
  const members = new Map<string, number[]>();
  files.forEach((f, i) => {
    const list = members.get(f.group) ?? [];
    list.push(i);
    members.set(f.group, list);
  });
  const keys = [
    ...order.filter((k) => members.has(k)),
    ...[...members.keys()].filter((k) => !order.includes(k)).sort(),
  ];
  const radii = keys.map((k) => clusterRadius(members.get(k)!.length));
  const centers = placeClusters(radii);
  const clusters: Cluster[] = keys.map((key, i) => ({
    key,
    center: centers[i]!,
    radius: radii[i]!,
    count: members.get(key)!.length,
  }));

  const pos: Vec3[] = files.map(() => ({ x: 0, y: 0, z: 0 }));
  const home: number[] = new Array<number>(files.length).fill(0);
  clusters.forEach((cl, ci) => {
    const list = [...members.get(cl.key)!].sort(
      (a, b) => files[b]!.degree - files[a]!.degree || files[a]!.id - files[b]!.id,
    );
    list.forEach((idx, rank) => {
      const id = files[idx]!.id;
      // Uniform direction on the sphere, flattened into a disc-ish galaxy.
      const u = hash01(id, 1) * 2 - 1;
      const phi = hash01(id, 2) * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      const frac = list.length === 1 ? 0 : Math.pow((rank + 0.5) / list.length, 0.55);
      const r = cl.radius * frac * (0.78 + 0.3 * hash01(id, 3));
      pos[idx] = {
        x: cl.center.x + Math.cos(phi) * rr * r,
        y: cl.center.y + u * r * 0.62,
        z: cl.center.z + Math.sin(phi) * rr * r,
      };
      home[idx] = ci;
    });
  });

  // Links draw related notes a little closer (a few cheap passes, no n²).
  // Rest length: a third of the cluster, so linked notes lean together without collapsing.
  for (let pass = 0; pass < 18; pass++) {
    for (const e of edges) {
      const a = pos[e.a];
      const b = pos[e.b];
      if (!a || !b || e.strong === false) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz);
      const same = home[e.a] === home[e.b];
      const rest = same ? Math.max(26, (clusters[home[e.a]!]?.radius ?? 90) * 0.34) : 60;
      if (d <= rest) continue;
      const k = (same ? 0.02 : 0.006) * (1 - rest / d);
      a.x += dx * k;
      a.y += dy * k;
      a.z += dz * k;
      b.x -= dx * k;
      b.y -= dy * k;
      b.z -= dz * k;
    }
    // Keep each star inside its own cluster.
    pos.forEach((p, i) => {
      const cl = clusters[home[i]!];
      if (!cl) return;
      const dx = p.x - cl.center.x;
      const dy = p.y - cl.center.y;
      const dz = p.z - cl.center.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > cl.radius) {
        const s = cl.radius / d;
        p.x = cl.center.x + dx * s;
        p.y = cl.center.y + dy * s;
        p.z = cl.center.z + dz * s;
      }
    });
  }

  // The sky's size is where the stars actually are (a small brain is framed close).
  let radius = 0;
  for (const p of pos) radius = Math.max(radius, Math.hypot(p.x, p.y, p.z));
  return { pos, clusters, radius: Math.max(radius + 24, 60) };
}

/**
 * Cluster centres: one at the origin; up to six on a tilted ring whose
 * circumference fits them all (each gets an arc in proportion to its size);
 * more on a Fibonacci sphere.
 */
export function placeClusters(radii: readonly number[]): Vec3[] {
  const n = radii.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0, z: 0 }];
  const total = radii.reduce((s, r) => s + r, 0);
  if (n <= 6) {
    const R = Math.max(220, (total * 1.25) / Math.PI);
    let acc = 0;
    return radii.map((r, i) => {
      // Each cluster owns an arc of 2r out of a circle of 2·total: its centre is half-way along.
      const a = ((acc + r) / total) * Math.PI - Math.PI / 2;
      acc += 2 * r;
      const elev = (i % 2 === 0 ? -0.18 : 0.22) * R;
      return { x: Math.cos(a) * R, y: elev, z: Math.sin(a) * R };
    });
  }
  const area = radii.reduce((s, r) => s + r * r, 0);
  const R = Math.max(320, Math.sqrt(area * 0.8));
  const golden = Math.PI * (3 - Math.sqrt(5));
  return radii.map((_, i) => {
    const y = 1 - ((i + 0.5) / n) * 2;
    const rr = Math.sqrt(1 - y * y);
    const a = i * golden;
    return { x: Math.cos(a) * rr * R, y: y * R * 0.7, z: Math.sin(a) * rr * R };
  });
}

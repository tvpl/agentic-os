/**
 * The Brain scene's dimensions (immersive shell): the same stars arranged
 * four ways. By area (the nebulae), by time (a helix along a time axis, the
 * oldest at the far end, now at the near one), by type (one constellation
 * per content icon) and by links (the most connected at the core, the
 * orphans on an outer halo). Each arrangement brings its own guides — rings,
 * an axis, labels — drawn faintly in 3D. Switching morphs the stars from one
 * to the other. Pure; every position is a function of the note ids.
 */
import { CONTENT_KINDS, type ContentKind } from "./brainGlyphs";
import { clamp, clusterRadius, hash01, placeClusters, type Vec3 } from "./brainSpace";

export type Dimension = "areas" | "time" | "types" | "links";
export const DIMENSIONS: readonly Dimension[] = ["areas", "time", "types", "links"];

export type TimeUnit = "day" | "week" | "month" | "year";

export type GuideLabel =
  | { kind: "group"; key: string; count: number }
  | { kind: "time"; at: number; unit: TimeUnit }
  | { kind: "now" }
  | { kind: "type"; key: ContentKind; count: number }
  | { kind: "degree"; min: number; max: number | null; count: number };

export interface Guide {
  shape: "ring" | "line";
  /** Ring centre, or line start. */
  a: Vec3;
  /** Line end. */
  b?: Vec3;
  radius?: number;
  /** Ring normal: "y" = a horizontal ring, "x" = a ring around the x (time) axis. */
  normal?: "x" | "y";
  label?: GuideLabel;
  labelAt?: Vec3;
  strong?: boolean;
}

export interface DimGroup {
  key: string;
  label: GuideLabel;
  centre: Vec3;
  radius: number;
  members: number[];
}

export interface DimLayout {
  dim: Dimension;
  pos: Vec3[];
  guides: Guide[];
  groups: DimGroup[];
  /** Index into `groups` per star (−1 = none). */
  groupOf: Int32Array;
  /** Links bow away from the time axis (time) instead of a group centre. */
  axis: boolean;
  radius: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DAY = 86_400_000;
/** The links arrangement is a flattened ball: its shells read as rings, like a radar. */
const FLAT = 0.32;

function skyRadius(pos: readonly Vec3[]): number {
  let r = 0;
  for (const p of pos) r = Math.max(r, Math.hypot(p.x, p.y, p.z));
  return Math.max(60, r + 24);
}

/* ------------------------------------------------------------------ areas */

/** The area constellation (computed by `layoutConstellation`) as a dimension. */
export function layoutAreas(
  pos: readonly Vec3[],
  clusters: ReadonlyArray<{ key: string; center: Vec3; radius: number; count: number }>,
  clusterOf: readonly number[],
): DimLayout {
  const groups: DimGroup[] = clusters.map((c) => ({
    key: c.key,
    label: { kind: "group", key: c.key, count: c.count },
    centre: c.center,
    radius: c.radius,
    members: [],
  }));
  const groupOf = new Int32Array(pos.length).fill(-1);
  clusterOf.forEach((c, i) => {
    groupOf[i] = c;
    groups[c]?.members.push(i);
  });
  return { dim: "areas", pos: [...pos], guides: [], groups, groupOf, axis: false, radius: skyRadius(pos) };
}

/* ------------------------------------------------------------------- time */

export interface TimeInput {
  id: number;
  mtime: number;
}

/** Tick unit for a span of days. */
export function timeUnit(spanDays: number): TimeUnit {
  if (spanDays <= 21) return "day";
  if (spanDays <= 150) return "week";
  if (spanDays <= 1100) return "month";
  return "year";
}

/** Tick times (local calendar boundaries) strictly inside [min, max], at most `max` of them. */
export function timeTicks(min: number, max: number, unit: TimeUnit, most = 12): number[] {
  if (!(max > min)) return [];
  const d = new Date(min);
  d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (unit === "month") d.setDate(1);
  if (unit === "year") d.setMonth(0, 1);
  const out: number[] = [];
  let guard = 0;
  while (guard++ < 5000) {
    if (unit === "day") d.setDate(d.getDate() + 1);
    else if (unit === "week") d.setDate(d.getDate() + 7);
    else if (unit === "month") d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    const t = d.getTime();
    if (t >= max) break;
    if (t > min) out.push(t);
  }
  if (out.length <= most) return out;
  const step = Math.ceil(out.length / most);
  return out.filter((_, i) => i % step === 0);
}

/**
 * The helix: time runs along x (oldest at −L, newest at +L). Position along
 * the axis blends real time and rank, so a burst of notes on one day still
 * spreads out and a quiet month still reads as a gap.
 */
export function layoutTime(files: readonly TimeInput[]): DimLayout {
  const n = files.length;
  const order = files
    .map((_, i) => i)
    .sort((a, b) => files[a]!.mtime - files[b]!.mtime || files[a]!.id - files[b]!.id);
  const sorted = order.map((i) => files[i]!.mtime);
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;
  const span = Math.max(1, max - min);
  const L = clamp(220 + 16 * Math.sqrt(n), 280, 1150);
  const R = clamp(62 + 3.2 * Math.sqrt(n), 76, 240);
  const turns = clamp(n / 36, 1.25, 7);
  const rankAt = (t: number) => {
    // share of notes changed at or before t (binary search)
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! <= t) lo = mid + 1;
      else hi = mid;
    }
    return n === 0 ? 0 : lo / n;
  };
  const u = (t: number, rank?: number) => 0.5 * ((t - min) / span) + 0.5 * (rank ?? rankAt(t));
  const xOf = (uu: number) => -L + 2 * L * uu;
  const pos: Vec3[] = files.map(() => ({ x: 0, y: 0, z: 0 }));
  order.forEach((i, rank) => {
    const f = files[i]!;
    const uu = u(f.mtime, n === 1 ? 0.5 : (rank + 0.5) / n);
    const th = uu * turns * Math.PI * 2 + (hash01(f.id, 41) - 0.5) * 0.6;
    const r = R * (0.72 + 0.5 * hash01(f.id, 42));
    pos[i] = { x: xOf(uu), y: Math.cos(th) * r, z: Math.sin(th) * r };
  });

  const unit = timeUnit(span / DAY);
  const ticks = timeTicks(min, max, unit);
  const guides: Guide[] = [
    { shape: "line", a: { x: -L - 50, y: 0, z: 0 }, b: { x: L + 70, y: 0, z: 0 }, strong: true },
    {
      shape: "ring",
      a: { x: L + 70, y: 0, z: 0 },
      radius: 10,
      normal: "x",
      label: { kind: "now" },
      labelAt: { x: L + 70, y: -R * 0.5, z: 0 },
      strong: true,
    },
  ];
  const bounds = [min - 1, ...ticks, max + 1];
  const groups: DimGroup[] = [];
  const groupOf = new Int32Array(n).fill(-1);
  for (let k = 0; k < bounds.length - 1; k++) {
    const from = bounds[k]!;
    const to = bounds[k + 1]!;
    const members = order.filter((i) => files[i]!.mtime > from && files[i]!.mtime <= to);
    if (k > 0) {
      const x = xOf(u(from));
      guides.push({
        shape: "ring",
        a: { x, y: 0, z: 0 },
        radius: R * 1.18,
        normal: "x",
        label: { kind: "time", at: from, unit },
        labelAt: { x, y: -R * 1.34, z: 0 },
      });
    }
    if (members.length === 0) continue;
    const gi = groups.length;
    for (const i of members) groupOf[i] = gi;
    const x0 = xOf(u(Math.max(from, min)));
    const x1 = xOf(u(Math.min(to, max)));
    groups.push({
      key: `t${from}`,
      label: { kind: "time", at: Math.max(from, min), unit },
      centre: { x: (x0 + x1) / 2, y: 0, z: 0 },
      radius: Math.max(R, Math.abs(x1 - x0) / 2),
      members,
    });
  }
  return { dim: "time", pos, guides, groups, groupOf, axis: true, radius: Math.max(L + 80, R) };
}

/* ------------------------------------------------------------------ types */

export interface TypeInput {
  id: number;
  mtime: number;
  kind: ContentKind;
}

/** One flat spiral galaxy per content kind, newest at the heart. */
export function layoutTypes(files: readonly TypeInput[]): DimLayout {
  const members = new Map<ContentKind, number[]>();
  files.forEach((f, i) => {
    const list = members.get(f.kind) ?? [];
    list.push(i);
    members.set(f.kind, list);
  });
  const keys = [...members.keys()].sort(
    (a, b) =>
      members.get(b)!.length - members.get(a)!.length || CONTENT_KINDS.indexOf(a) - CONTENT_KINDS.indexOf(b),
  );
  const radii = keys.map((k) => clusterRadius(members.get(k)!.length) * 0.92);
  const centres = placeClusters(radii);
  const pos: Vec3[] = files.map(() => ({ x: 0, y: 0, z: 0 }));
  const groupOf = new Int32Array(files.length).fill(-1);
  const guides: Guide[] = [];
  const groups: DimGroup[] = keys.map((key, gi) => {
    const c = centres[gi]!;
    const R = radii[gi]!;
    const list = [...members.get(key)!].sort(
      (a, b) => files[b]!.mtime - files[a]!.mtime || files[a]!.id - files[b]!.id,
    );
    list.forEach((i, k) => {
      const f = files[i]!;
      const r = list.length === 1 ? 0 : R * 0.95 * Math.sqrt((k + 0.5) / list.length);
      const th = k * GOLDEN + hash01(f.id, 51) * 0.3;
      pos[i] = {
        x: c.x + Math.cos(th) * r,
        y: c.y + (hash01(f.id, 52) - 0.5) * R * 0.22,
        z: c.z + Math.sin(th) * r,
      };
      groupOf[i] = gi;
    });
    const label: GuideLabel = { kind: "type", key, count: list.length };
    guides.push({
      shape: "ring",
      a: c,
      radius: R * 1.12,
      normal: "y",
      label,
      labelAt: { x: c.x, y: c.y - R * 0.42 - 26, z: c.z },
    });
    return { key, label, centre: c, radius: R, members: list };
  });
  return { dim: "types", pos, guides, groups, groupOf, axis: false, radius: skyRadius(pos) };
}

/* ------------------------------------------------------------------ links */

export interface LinkInput {
  id: number;
  degree: number;
}

/** Degree bands: [min, max|null] from the core out, orphans last. */
export function degreeBands(degrees: readonly number[]): Array<[number, number | null]> {
  const pos = degrees.filter((d) => d > 0).sort((a, b) => a - b);
  if (pos.length === 0) return [[0, 0]];
  const q = (p: number) => pos[Math.min(pos.length - 1, Math.floor(p * pos.length))]!;
  const hub = Math.max(3, q(0.9));
  const mid = Math.max(2, Math.min(hub - 1, q(0.55)));
  const bands: Array<[number, number | null]> = [];
  if (pos[pos.length - 1]! >= hub) bands.push([hub, null]);
  if (mid < hub && pos.some((d) => d >= mid && d < hub)) bands.push([mid, hub - 1]);
  if (pos.some((d) => d < mid)) bands.push([1, mid - 1]);
  if (degrees.some((d) => d === 0)) bands.push([0, 0]);
  return bands;
}

/**
 * Connectivity: the most linked at the core, the less linked on outer
 * shells, orphans on a halo. Direction starts from `seed` (the area
 * constellation, so areas stay side by side) and linked notes pull towards
 * each other along their shell.
 */
export function layoutLinks(
  files: readonly LinkInput[],
  edges: ReadonlyArray<{ a: number; b: number; strong?: boolean }>,
  seed?: readonly Vec3[],
): DimLayout {
  const n = files.length;
  const R = clamp(170 + 10 * Math.sqrt(n), 200, 900);
  const bands = degreeBands(files.map((f) => f.degree));
  const bandOf = (d: number) => bands.findIndex(([lo, hi]) => d >= lo && (hi === null || d <= hi));
  // Radii per band: the core fills a ball, the rest are shells, orphans a halo.
  const SHELLS: Array<[number, number]> = [
    [0.06, 0.3],
    [0.42, 0.66],
    [0.76, 1],
  ];
  let next = 0;
  const shells = bands.map(([lo]): [number, number] => {
    if (lo === 0) return [R * 1.16, R * 1.26];
    const [a, b] = SHELLS[Math.min(2, next++)]!;
    return [a * R, b * R];
  });
  const members = bands.map(() => [] as number[]);
  files.forEach((f, i) => members[Math.max(0, bandOf(f.degree))]!.push(i));
  const target = new Float64Array(n);
  members.forEach((list, b) => {
    const [r0, r1] = shells[b]!;
    const sorted = [...list].sort(
      (x, y) => files[y]!.degree - files[x]!.degree || files[x]!.id - files[y]!.id,
    );
    sorted.forEach((i, k) => {
      target[i] = r0 + (r1 - r0) * (sorted.length === 1 ? 0.5 : k / (sorted.length - 1));
    });
  });
  const pos: Vec3[] = files.map((f, i) => {
    let dx: number;
    let dy: number;
    let dz: number;
    const s = seed?.[i];
    if (s && Math.hypot(s.x, s.y, s.z) > 1e-3) {
      [dx, dy, dz] = [s.x, s.y, s.z];
    } else {
      const u = hash01(f.id, 61) * 2 - 1;
      const phi = hash01(f.id, 62) * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      [dx, dy, dz] = [Math.cos(phi) * rr, u, Math.sin(phi) * rr];
    }
    // A little noise so notes that started together do not stay on one point.
    dx += (hash01(f.id, 63) - 0.5) * 0.5 * Math.hypot(dx, dy, dz);
    dz += (hash01(f.id, 64) - 0.5) * 0.5 * Math.hypot(dx, dy, dz);
    const l = Math.hypot(dx, dy, dz) || 1;
    const r = target[i]!;
    return { x: (dx / l) * r, y: (dy / l) * r * FLAT, z: (dz / l) * r };
  });
  for (let pass = 0; pass < 20; pass++) {
    for (const e of edges) {
      const a = pos[e.a];
      const b = pos[e.b];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz);
      const rest = R * 0.22;
      if (d <= rest) continue;
      const k = (e.strong === false ? 0.004 : 0.012) * (1 - rest / d);
      a.x += dx * k;
      a.y += dy * k;
      a.z += dz * k;
      b.x -= dx * k;
      b.y -= dy * k;
      b.z -= dz * k;
    }
    pos.forEach((p, i) => {
      const r = target[i]!;
      const l = Math.hypot(p.x, p.y / FLAT, p.z);
      if (l < 1e-6) return;
      p.x = (p.x / l) * r;
      p.y = (p.y / l) * r;
      p.z = (p.z / l) * r;
    });
  }
  const groupOf = new Int32Array(n).fill(-1);
  const guides: Guide[] = [];
  const groups: DimGroup[] = [];
  bands.forEach(([lo, hi], b) => {
    const list = members[b]!;
    if (list.length === 0) return;
    const label: GuideLabel = { kind: "degree", min: lo, max: hi, count: list.length };
    const [, r1] = shells[b]!;
    const ringR = lo === 0 ? R * 1.3 : r1 + R * 0.04;
    // Labels sit on their rings at spread angles, so they never stack.
    const th = Math.PI * 0.3 + guides.length * 0.42;
    guides.push({
      shape: "ring",
      a: { x: 0, y: 0, z: 0 },
      radius: ringR,
      normal: "y",
      label,
      labelAt: { x: Math.cos(th) * ringR, y: 0, z: Math.sin(th) * ringR },
    });
    const gi = groups.length;
    for (const i of list) groupOf[i] = gi;
    groups.push({
      key: `d${lo}`,
      label,
      centre: { x: 0, y: 0, z: 0 },
      radius: Math.max(40, r1),
      members: list,
    });
  });
  return { dim: "links", pos, guides, groups, groupOf, axis: false, radius: skyRadius(pos) };
}

/**
 * The point a link between `a` and `b` bows away from in a layout: the time
 * axis, the shared group's centre, or the middle of the sky.
 */
export function bowCentre(
  layout: Pick<DimLayout, "axis" | "groupOf" | "groups">,
  a: number,
  b: number,
  mid: Vec3,
): Vec3 {
  if (layout.axis) return { x: mid.x, y: 0, z: 0 };
  const ga = layout.groupOf[a] ?? -1;
  if (ga >= 0 && ga === layout.groupOf[b] && layout.groups[ga]) return layout.groups[ga]!.centre;
  return { x: 0, y: 0, z: 0 };
}

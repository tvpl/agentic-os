/**
 * The Brain scene's "inside a note" space (immersive shell): when you enter
 * a note, its synapses become the space. The note is the centre; the notes
 * it links to (and that link to it) sit on a first shell around it, grouped
 * in sectors by how they relate; the notes one hop further sit on an outer
 * shell, each out beyond the neighbour that leads to it — so every branch
 * reads as a path you can follow. Pure.
 */
import type { Vec3 } from "./brainSpace";

export interface EgoOptions {
  /** Most first-shell neighbours (the rest stay in the sky). */
  max1?: number;
  /** Most second-shell notes. */
  max2?: number;
  /** Sort key of a neighbour: sectors follow it (e.g. relation kind, then area). Lower first. */
  sector?: (i: number) => number;
  /** Importance of a note (e.g. its degree): the most important are kept when capping. */
  weight?: (i: number) => number;
  /** Whether a note may take part (the timeline, local mode). */
  allowed?: (i: number) => boolean;
}

export interface Ego {
  centre: number;
  hop1: number[];
  hop2: number[];
  /** The first-shell note each second-shell note hangs from. */
  parent: Map<number, number>;
  /** Offset from the centre of every member (the centre itself at 0). */
  offset: Map<number, Vec3>;
  r1: number;
  r2: number;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function shellRadii(n1: number, n2: number): [number, number] {
  const r1 = Math.round(95 + 11 * Math.sqrt(Math.max(1, n1)));
  const r2 = Math.round(r1 * (n2 > 0 ? 1.85 : 1.5) + 4 * Math.sqrt(n2));
  return [r1, r2];
}

/** Members of the ego graph of `centre`: its neighbours, then theirs. */
export function egoMembers(
  centre: number,
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  opts: EgoOptions = {},
): { hop1: number[]; hop2: number[]; parent: Map<number, number> } {
  const max1 = opts.max1 ?? 24;
  const max2 = opts.max2 ?? 40;
  const ok = opts.allowed ?? (() => true);
  const weight = opts.weight ?? ((i: number) => adjacency[i]?.length ?? 0);
  const sector = opts.sector ?? (() => 0);
  const first = [...new Set(adjacency[centre] ?? [])].filter((j) => j !== centre && ok(j));
  first.sort((a, b) => weight(b) - weight(a) || a - b);
  const hop1 = first.slice(0, max1).sort((a, b) => sector(a) - sector(b) || weight(b) - weight(a) || a - b);
  const in1 = new Set(hop1);
  // Second shell: reached from the most first-shell notes first, then by weight.
  const reach = new Map<number, { count: number; parent: number }>();
  for (const p of hop1)
    for (const j of adjacency[p] ?? []) {
      if (j === centre || in1.has(j) || !ok(j)) continue;
      const cur = reach.get(j);
      if (cur) cur.count++;
      else reach.set(j, { count: 1, parent: p });
    }
  const hop2 = [...reach.keys()]
    .sort((a, b) => reach.get(b)!.count - reach.get(a)!.count || weight(b) - weight(a) || a - b)
    .slice(0, max2);
  const parent = new Map(hop2.map((j) => [j, reach.get(j)!.parent]));
  return { hop1, hop2, parent };
}

/**
 * Place the members on their shells. The first shell is a band around the
 * centre (elevation within ±0.5 rad, so from the usual slightly-above camera
 * it reads as an open ellipse, not a ball), neighbours in sector order; the
 * second shell fans each branch out beyond its parent.
 */
export function egoLayout(
  centre: number,
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  opts: EgoOptions = {},
): Ego {
  const { hop1, hop2, parent } = egoMembers(centre, adjacency, opts);
  const [r1, r2] = shellRadii(hop1.length, hop2.length);
  const offset = new Map<number, Vec3>([[centre, { x: 0, y: 0, z: 0 }]]);
  const dirs = new Map<number, { az: number; el: number }>();
  const n1 = hop1.length;
  const phase = -Math.PI / 2 + (n1 > 0 ? Math.PI / n1 : 0);
  hop1.forEach((j, k) => {
    const az = phase + (k / Math.max(1, n1)) * Math.PI * 2;
    const el = n1 <= 2 ? 0 : 0.42 * Math.sin(k * GOLDEN * 2.1);
    dirs.set(j, { az, el });
    offset.set(j, sph(az, el, r1));
  });
  // Children of each parent share the parent's arc.
  const children = new Map<number, number[]>();
  for (const j of hop2) {
    const p = parent.get(j)!;
    const list = children.get(p) ?? [];
    list.push(j);
    children.set(p, list);
  }
  const arc = (Math.PI * 2) / Math.max(3, n1);
  for (const [p, list] of children) {
    const d = dirs.get(p)!;
    const m = list.length;
    list.forEach((j, k) => {
      const spread = m === 1 ? 0 : (k / (m - 1) - 0.5) * arc * 0.8;
      const lift = m <= 2 ? 0 : ((k % 3) - 1) * 0.16;
      const rr = r2 * (0.94 + 0.12 * ((k * 7) % 5) * 0.25);
      offset.set(j, sph(d.az + spread, clampEl(d.el * 1.1 + lift), rr));
    });
  }
  return { centre, hop1, hop2, parent, offset, r1, r2 };
}

const clampEl = (e: number) => Math.max(-0.7, Math.min(0.7, e));

function sph(az: number, el: number, r: number): Vec3 {
  return { x: Math.cos(az) * Math.cos(el) * r, y: Math.sin(el) * r, z: Math.sin(az) * Math.cos(el) * r };
}

/** Everyone in the ego graph, centre first. */
export function egoAll(ego: Pick<Ego, "centre" | "hop1" | "hop2">): number[] {
  return [ego.centre, ...ego.hop1, ...ego.hop2];
}

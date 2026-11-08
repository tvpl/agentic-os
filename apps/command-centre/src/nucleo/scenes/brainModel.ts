/**
 * From the brain's world (the same files, edges and adjacency the classic
 * map uses) to the constellation the Brain scene draws. Pure.
 */
import type { ContentKind } from "./brainGlyphs";
import { hash01, layoutConstellation, type Vec3 } from "./brainSpace";
import type { DimLayout } from "./brainDimensions";
import type { Nebula, StarCluster, StarModel } from "./brainStage";
import { incidence } from "./brainSynapse";
import { isRecent } from "./brainTimeline";

/** Cluster hues: warm first (amber is the system), never the agent's cyan — cyan is what lights up. */
export const CLUSTER_PALETTE = [
  "#f2b545",
  "#a9b4ff",
  "#7ee0a8",
  "#ff9a76",
  "#f59ac0",
  "#d8c38a",
  "#c9a0ff",
  "#9fc9ff",
  "#e6e08a",
  "#ffc3a0",
  "#b8e39a",
  "#e0b3ff",
];

export interface ModelFile {
  id: number;
  name: string;
  title: string | null;
  group: string;
  degree: number;
  mtime: number;
  /** Colour override from a query group, if any. */
  tint: string | null;
  /** Content kind (its icon); a plain note when unknown. */
  kind?: ContentKind;
}

export interface ModelEdge {
  a: number;
  b: number;
  kind: string;
  why?: string;
}

/** A note's display name: its title, else the file name without the extension. */
export function starLabel(f: Pick<ModelFile, "name" | "title">, max = 40): string {
  const raw = (f.title?.trim() || f.name.replace(/(.)\.[^./]+$/, "$1") || f.name).replace(/\s+/g, " ");
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

export function starSize(degree: number, recent: boolean): number {
  return 1.9 + Math.log1p(Math.max(0, degree)) * 1.15 + (recent ? 0.9 : 0);
}

/** Structural edges (same folder / area) are many and weak; authored ones (links, related) are strong. */
export function isStrongKind(kind: string): boolean {
  return kind === "markdown-link" || kind === "wikilink" || kind === "related";
}

export function buildModel(
  files: readonly ModelFile[],
  edges: readonly ModelEdge[],
  adjacency: number[][],
  opts: { order: readonly string[]; enabled: ReadonlySet<string>; now: number },
): StarModel {
  const active = edges.filter((e) => opts.enabled.has(e.kind));
  const sky = layoutConstellation(
    files,
    active.map((e) => ({ a: e.a, b: e.b, strong: isStrongKind(e.kind) })),
    opts.order,
  );
  const clusterIndex = new Map(sky.clusters.map((c, i) => [c.key, i]));
  const clusters: StarCluster[] = sky.clusters.map((c, i) => {
    const dustCount = Math.min(90, 24 + c.count * 3);
    const dust: Vec3[] = [];
    for (let k = 0; k < dustCount; k++) {
      const seed = i * 1000 + k;
      const u = hash01(seed, 11) * 2 - 1;
      const phi = hash01(seed, 12) * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      const r = c.radius * 1.15 * Math.cbrt(hash01(seed, 13));
      dust.push({
        x: c.center.x + Math.cos(phi) * rr * r,
        y: c.center.y + u * r * 0.62,
        z: c.center.z + Math.sin(phi) * rr * r,
      });
    }
    // A nebula is a few overlapping puffs of light, not one flat disc.
    const puffs = Array.from({ length: 5 }, (_, k) => {
      const seed = i * 97 + k;
      const u = hash01(seed, 21) * 2 - 1;
      const phi = hash01(seed, 22) * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      const off = k === 0 ? 0 : c.radius * (0.25 + 0.35 * hash01(seed, 23));
      return {
        o: { x: Math.cos(phi) * rr * off, y: u * off * 0.5, z: Math.sin(phi) * rr * off },
        r: c.radius * (k === 0 ? 1.45 : 0.7 + 0.45 * hash01(seed, 24)),
        a: k === 0 ? 1 : 0.55 + 0.4 * hash01(seed, 25),
      };
    });
    return { ...c, color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]!, dust, puffs };
  });

  // The three most linked stars of each cluster are its landmarks.
  const hub = files.map(() => false);
  const byCluster = new Map<string, number[]>();
  files.forEach((f, i) => {
    const list = byCluster.get(f.group) ?? [];
    list.push(i);
    byCluster.set(f.group, list);
  });
  for (const list of byCluster.values())
    list
      .filter((i) => files[i]!.degree > 0)
      .sort((a, b) => files[b]!.degree - files[a]!.degree)
      .slice(0, 3)
      .forEach((i) => (hub[i] = true));

  return {
    pos: sky.pos,
    size: files.map((f) => starSize(f.degree, isRecent(f.mtime, opts.now))),
    color: files.map((f) => f.tint ?? clusters[clusterIndex.get(f.group) ?? 0]?.color ?? CLUSTER_PALETTE[0]!),
    label: files.map((f) => starLabel(f)),
    group: files.map((f) => f.group),
    mtime: files.map((f) => f.mtime),
    cluster: files.map((f) => clusterIndex.get(f.group) ?? 0),
    hub,
    clusters,
    edges: active.map((e) => ({
      a: e.a,
      b: e.b,
      strong: isStrongKind(e.kind),
      kind: e.kind,
      why: e.why ?? "",
    })),
    adjacency,
    radius: sky.radius,
    id: files.map((f) => f.id),
    degree: files.map((f) => f.degree),
    kind: files.map((f) => f.kind ?? "note"),
    incident: incidence(files.length, active),
  };
}

/** Mix two #rrggbb colours (t = share of `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `rgba()` of a hex colour at an alpha (for gradients and strokes). */
export function rgba(hex: string, alpha: number): string {
  const p = parseHex(hex) ?? [255, 255, 255];
  return `rgba(${p[0]},${p[1]},${p[2]},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/**
 * The glows behind an arrangement: the area nebulae where the areas are; for
 * the other arrangements, one per group in the colour of the area most of its
 * stars come from (so you see how areas mix across time and types); the
 * links arrangement has a single glow at its core.
 */
export function nebulaeOf(
  layout: DimLayout,
  model: Pick<StarModel, "clusters" | "cluster" | "color">,
): Nebula[] {
  if (layout.dim === "areas")
    return model.clusters.map((c, ci) => ({
      centre: c.center,
      radius: c.radius,
      color: c.color,
      puffs: c.puffs,
      members: model.cluster.flatMap((k, i) => (k === ci ? [i] : [])),
    }));
  if (layout.dim === "links") {
    const core = layout.groups[0];
    if (!core) return [];
    return [
      {
        centre: { x: 0, y: 0, z: 0 },
        radius: core.radius * 1.6,
        color: dominantColor(core.members, model),
        puffs: [{ o: { x: 0, y: 0, z: 0 }, r: core.radius * 1.9, a: 1 }],
        members: core.members,
      },
    ];
  }
  return layout.groups.map((g, gi) => {
    const r = layout.dim === "time" ? Math.min(g.radius, 220) : g.radius;
    return {
      centre: g.centre,
      radius: r,
      color: dominantColor(g.members, model),
      puffs: [0, 1, 2].map((k) => {
        const seed = gi * 31 + k;
        const off = k === 0 ? 0 : r * 0.35;
        const ang = hash01(seed, 26) * Math.PI * 2;
        return {
          o: { x: Math.cos(ang) * off, y: (hash01(seed, 27) - 0.5) * off * 0.6, z: Math.sin(ang) * off },
          r: r * (k === 0 ? 1.35 : 0.8),
          a: k === 0 ? 0.8 : 0.5,
        };
      }),
      members: g.members,
    };
  });
}

function dominantColor(members: readonly number[], model: Pick<StarModel, "color">): string {
  const counts = new Map<string, number>();
  for (const i of members) {
    const c = model.color[i];
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = CLUSTER_PALETTE[0]!;
  let n = -1;
  for (const [c, k] of counts)
    if (k > n) {
      best = c;
      n = k;
    }
  return best;
}

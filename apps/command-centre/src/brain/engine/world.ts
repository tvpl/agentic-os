/**
 * Second Brain world model — pure TypeScript, no DOM, no React.
 *
 * The world is a mutable bag of positioned entities (file particles, memory
 * hubs, structure orbs, transient effects) plus the view transform. React
 * owns one instance in a ref; the engine modules (`layouts`, `physics`,
 * `hitTest`, `render`) read and write it without ever touching React state.
 */
import type { Simulation, SimulationNodeDatum } from "d3-force";
import type { Connector, GraphData, GraphNode, RoutineStatus, Skill } from "../../api";

export type LayoutKind = "force" | "circle" | "hex" | "rings";
export type ViewKind = "areas" | "folders";
export type OrbKind = "skill" | "routine" | "app";

export interface FileNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Current rotated target (rings/circle/hex layouts). */
  tx: number;
  ty: number;
  /** Polar target before the ring rotation is applied. */
  baseAngle: number;
  baseRadius: number;
  phase: number;
  group: string;
  r: number;
}

export interface Hub {
  key: string;
  color: string;
  count: number;
  x: number;
  y: number;
  baseAngle: number;
  expanded: boolean;
}

export interface OrbNode {
  kind: OrbKind;
  id: string;
  label: string;
  baseAngle: number;
  radius: number;
  x: number;
  y: number;
  active: boolean;
  official?: boolean;
}

export interface Effect {
  x: number;
  y: number;
  /** Seconds (performance.now() / 1000). */
  start: number;
  color: string;
}

export interface Comet {
  runId: string;
  skillSlug: string | null;
  seed: number;
  trail: Array<{ x: number; y: number }>;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface BrainSettings {
  layout: LayoutKind;
  view: ViewKind;
  spin: number;
  showNames: boolean;
  linkSpring: number;
  nodeScale: number;
  clusterSize: number;
}

export const DEFAULT_SETTINGS: BrainSettings = {
  layout: "rings",
  view: "areas",
  spin: 0.16,
  showNames: false,
  linkSpring: 0.05,
  nodeScale: 1,
  clusterSize: 1,
};

/** Slider ranges exposed under "Advanced" — anything outside is clamped. */
export const SETTING_RANGES = {
  spin: { min: 0, max: 1, step: 0.01 },
  linkSpring: { min: 0.01, max: 0.2, step: 0.01 },
  clusterSize: { min: 0.5, max: 1.8, step: 0.05 },
  nodeScale: { min: 0.4, max: 2, step: 0.05 },
} as const;

export const GROUP_COLORS = [
  "#c084fc", "#f472b6", "#22d3ee", "#fde047",
  "#4ade80", "#fb923c", "#a5b4fc", "#f87171",
  "#5eead4", "#fbbf24",
];
export const RING = { skills: 92, hubs: 178, filesInner: 150, routines: 318, apps: 372, labelPad: 14 } as const;
export const MEMORY_RING_RADIUS = RING.hubs + 60;
/** Angular speed of each ring relative to the spin parameter. */
export const RING_SPEED = { skills: -0.35, memory: 1, routines: 0.5, apps: 0.22 } as const;
/** Ring labels sit at this angle (top-left quadrant) and rotate with their ring. */
export const LABEL_ANGLE = -Math.PI * 0.75;
/** Arc kept free of orbs around the label so badges never collide with it. */
export const LABEL_GAP = 0.62;
export const SKILL_COLOR = "#fb923c";
export const ROUTINE_COLOR = "#fbbf24";
export const APP_COLOR = "#7dd3fc";
export const MEMORY_COLOR = "#c084fc";
export const TWO_PI = Math.PI * 2;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 9;
/** World width the minimap and fit-view assume. */
export const WORLD_EXTENT = RING.apps * 2.35;

export interface World {
  files: FileNode[];
  edges: Array<{ a: number; b: number }>;
  hubs: Hub[];
  hubByKey: Map<string, Hub>;
  orbs: OrbNode[];
  effects: Effect[];
  comets: Comet[];
  transform: Transform;
  target: Transform;
  theta: number;
  layout: LayoutKind;
  spin: number;
  nodeScale: number;
  clusterSize: number;
  linkSpring: number;
  showNames: boolean;
  filterGroup: string | null;
  matched: Set<number> | null;
  selectedId: number | null;
  selectedEdges: Set<number>;
  hoverKey: string | null;
  colorOf: Map<string, string>;
  sim: Simulation<FileNode, undefined> | null;
}

export function createWorld(settings: BrainSettings = DEFAULT_SETTINGS): World {
  return {
    files: [],
    edges: [],
    hubs: [],
    hubByKey: new Map(),
    orbs: [],
    effects: [],
    comets: [],
    transform: { x: 0, y: 0, k: 1 },
    target: { x: 0, y: 0, k: 1 },
    theta: 0,
    layout: settings.layout,
    spin: settings.spin,
    nodeScale: settings.nodeScale,
    clusterSize: settings.clusterSize,
    linkSpring: settings.linkSpring,
    showNames: settings.showNames,
    filterGroup: null,
    matched: null,
    selectedId: null,
    selectedEdges: new Set(),
    hoverKey: null,
    colorOf: new Map(),
    sim: null,
  };
}

/** Deterministic LCG (Park–Miller) so layouts are reproducible for a seed. */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function groupOf(n: GraphNode, view: ViewKind): string {
  if (view === "areas") return n.area ?? "unsorted";
  const seg = n.rel.split(/[\\/]/)[0] ?? "";
  return n.rel.includes("/") || n.rel.includes("\\") ? seg : "(root)";
}

/**
 * Evenly distributes `count` angles around a ring while leaving `LABEL_GAP`
 * free around the label angle — orbs and label rotate together, so they
 * never overlap.
 */
export function ringAngles(count: number, offset = 0): number[] {
  const usable = TWO_PI - LABEL_GAP;
  const start = LABEL_ANGLE + LABEL_GAP / 2 + offset;
  return Array.from({ length: count }, (_, i) => start + ((i + 0.5) / Math.max(1, count)) * usable);
}

export function clampZoom(k: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
}

export interface WorldSources {
  graph: GraphData;
  skills: Skill[];
  routines: RoutineStatus[];
  connectors: Connector[];
  view: ViewKind;
  /** Seed for initial scatter positions (deterministic). */
  seed?: number;
}

/**
 * Rebuilds hubs, files, edges and orbs from API data. Keeps positions of
 * files that survive and the expanded state of hubs. Caller runs
 * `layoutFiles` afterwards.
 */
export function buildWorld(w: World, src: WorldSources): void {
  const { graph, view } = src;
  const groups = new Map<string, number>();
  for (const n of graph.nodes) {
    const g = groupOf(n, view);
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  const groupKeys = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  w.colorOf = new Map(groupKeys.map((k, i) => [k, GROUP_COLORS[i % GROUP_COLORS.length]!]));

  const prevExpanded = new Map(w.hubs.map((h) => [h.key, h.expanded]));
  const hubAngles = ringAngles(groupKeys.length, -LABEL_GAP / 2);
  w.hubs = groupKeys.map((key, gi) => ({
    key,
    color: w.colorOf.get(key)!,
    count: groups.get(key) ?? 0,
    x: 0,
    y: 0,
    baseAngle: hubAngles[gi] ?? 0,
    expanded: prevExpanded.get(key) ?? true,
  }));
  w.hubByKey = new Map(w.hubs.map((h) => [h.key, h]));

  const rand = seededRandom(src.seed ?? 3);
  const prev = new Map(w.files.map((n) => [n.id, n]));
  w.files = graph.nodes.map((n) => {
    const old = prev.get(n.id);
    return {
      ...n,
      group: groupOf(n, view),
      x: old?.x ?? (rand() - 0.5) * 60,
      y: old?.y ?? (rand() - 0.5) * 60,
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      baseAngle: 0,
      baseRadius: 0,
      phase: rand() * TWO_PI,
      r: 1.7 + Math.min(2.6, Math.log10(Math.max(10, n.size)) - 1) * 0.9,
    };
  });
  const indexOf = new Map(w.files.map((n, i) => [n.id, i]));
  w.edges = graph.edges
    .filter((e) => e.kind === "markdown-link")
    .map((e) => ({ a: indexOf.get(e.source) ?? -1, b: indexOf.get(e.target) ?? -1 }))
    .filter((e) => e.a >= 0 && e.b >= 0);
  setSelected(w, w.selectedId !== null && indexOf.has(w.selectedId) ? w.selectedId : null);

  const skillAngles = ringAngles(src.skills.length);
  const routineAngles = ringAngles(src.routines.length, 0.35);
  const appAngles = ringAngles(src.connectors.length, 0.12);
  w.orbs = [
    ...src.skills.map((s, i): OrbNode => ({
      kind: "skill",
      id: s.slug,
      label: `/${s.slug}`,
      baseAngle: skillAngles[i] ?? 0,
      radius: RING.skills,
      x: 0,
      y: 0,
      active: s.enabled,
    })),
    ...src.routines.map((r, i): OrbNode => ({
      kind: "routine",
      id: r.id,
      label: r.name,
      baseAngle: routineAngles[i] ?? 0,
      radius: RING.routines,
      x: 0,
      y: 0,
      active: r.enabled,
    })),
    ...src.connectors.map((c, i): OrbNode => ({
      kind: "app",
      id: c.id,
      label: c.name,
      baseAngle: appAngles[i] ?? 0,
      radius: RING.apps,
      x: 0,
      y: 0,
      active: c.status === "healthy" || c.status === "configured",
      official: c.official,
    })),
  ];
}

/** Marks a file as selected and caches the indices of its edges. */
export function setSelected(w: World, id: number | null): void {
  w.selectedId = id;
  w.selectedEdges = new Set();
  if (id === null) return;
  w.edges.forEach((e, i) => {
    if (w.files[e.a]?.id === id || w.files[e.b]?.id === id) w.selectedEdges.add(i);
  });
}

/** Client-side search over names, paths, titles and tags. */
export function matchFiles(files: readonly FileNode[], query: string): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return files.filter(
    (n) =>
      n.name.toLowerCase().includes(q) ||
      n.rel.toLowerCase().includes(q) ||
      (n.title?.toLowerCase().includes(q) ?? false) ||
      n.tags.some((tag) => tag.toLowerCase().includes(q)),
  );
}

export function setMatched(w: World, query: string): void {
  const q = query.trim();
  w.matched = q ? new Set(matchFiles(w.files, q).map((n) => n.id)) : null;
}

/** Legend rows: one per group, sorted by size, coloured like the hubs. */
export function legendOf(w: World): Array<{ key: string; count: number; color: string }> {
  return w.hubs.map((h) => ({ key: h.key, count: h.count, color: h.color }));
}

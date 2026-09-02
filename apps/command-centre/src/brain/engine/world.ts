/**
 * Second Brain world model — pure TypeScript, no DOM, no React (audit item 40).
 *
 * The world is a mutable bag of positioned entities (file particles, memory
 * hubs, structure orbs, transient effects) plus the view transform. The React
 * view owns one instance in a ref; `layouts`, `physics` and `hitTest` read and
 * write it without touching React state, which makes every rule here unit
 * testable and keeps the render loop free of component re-renders.
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
  /** Current rotated target (rings / circle / hex layouts). */
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
  sub: string;
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

export const GROUP_COLORS = ["#c084fc", "#f472b6", "#22d3ee", "#fde047", "#4ade80", "#fb923c", "#a5b4fc", "#f87171", "#5eead4", "#fbbf24"];
export const RING = { skills: 92, hubs: 178, filesInner: 150, routines: 318, apps: 372, labelPad: 14 } as const;
/** Angular speed of each orb ring relative to the spin parameter. */
export const RING_SPEED = { skill: -0.35, routine: 0.5, app: 0.22 } as const;
export const SKILL_COLOR = "#fb923c";
export const ROUTINE_COLOR = "#fbbf24";
export const APP_COLOR = "#7dd3fc";
export const TWO_PI = Math.PI * 2;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 9;
/** World width the minimap and fit-view assume. */
export const WORLD_EXTENT = RING.apps * 2.35;

export interface World {
  files: FileNode[];
  edges: Array<{ a: number; b: number }>;
  hubs: Hub[];
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
  filterGroup: string | null;
  matched: Set<number> | null;
  selectedId: number | null;
  selectedEdges: Set<number>;
  showNames: boolean;
  hoverKey: string | null;
  colorOf: Map<string, string>;
  sim: Simulation<FileNode, undefined> | null;
  linkSpring: number;
}

export function createWorld(settings: BrainSettings = DEFAULT_SETTINGS): World {
  return {
    files: [],
    edges: [],
    hubs: [],
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
    filterGroup: null,
    matched: null,
    selectedId: null,
    selectedEdges: new Set(),
    showNames: settings.showNames,
    hoverKey: null,
    colorOf: new Map(),
    sim: null,
    linkSpring: settings.linkSpring,
  };
}

/** Deterministic PRNG (Park–Miller) so layouts are reproducible in tests. */
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** The group a graph node belongs to in the given view: its area, or its first folder segment. */
export function groupOfNode(n: GraphNode, view: ViewKind): string {
  if (view === "areas") return n.area ?? "unsorted";
  const seg = n.rel.split(/[\\/]/)[0] ?? "";
  return n.rel.includes("/") || n.rel.includes("\\") ? seg : "(root)";
}

export function clampZoom(k: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
}

export interface WorldSources {
  graph: GraphData;
  skills: Skill[];
  routines: RoutineStatus[];
  connectors: Connector[];
  groupOf: (n: GraphNode) => string;
  /** Localised ring names shown as orb subtitles. */
  labels: { skills: string; routines: string; apps: string };
}

/**
 * (Re)build hubs, files, edges and orbs from fresh data. Existing file
 * positions and hub expansion states survive a rebuild so a refresh does not
 * scramble the map. Callers run `layoutFiles(w)` afterwards.
 */
export function buildWorld(w: World, src: WorldSources): void {
  const { graph, skills, routines, connectors, groupOf, labels } = src;
  const groups = new Map<string, number>();
  for (const n of graph.nodes) groups.set(groupOf(n), (groups.get(groupOf(n)) ?? 0) + 1);
  const groupKeys = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  w.colorOf = new Map(groupKeys.map((k, i) => [k, GROUP_COLORS[i % GROUP_COLORS.length]!]));

  const prevExpanded = new Map(w.hubs.map((h) => [h.key, h.expanded]));
  w.hubs = groupKeys.map((key, gi) => ({
    key,
    color: w.colorOf.get(key)!,
    count: groups.get(key) ?? 0,
    x: 0,
    y: 0,
    baseAngle: (gi / Math.max(1, groupKeys.length)) * TWO_PI - Math.PI / 2,
    expanded: prevExpanded.get(key) ?? true,
  }));

  const rand = seededRandom(3);
  const prev = new Map(w.files.map((n) => [n.id, n]));
  w.files = graph.nodes.map((n) => {
    const old = prev.get(n.id);
    return {
      ...n,
      group: groupOf(n),
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
  w.selectedEdges = new Set();

  w.orbs = [
    ...skills.map(
      (s, i): OrbNode => ({
        kind: "skill",
        id: s.slug,
        label: `/${s.slug}`,
        sub: labels.skills,
        baseAngle: (i / Math.max(1, skills.length)) * TWO_PI - Math.PI / 2,
        radius: RING.skills,
        x: 0,
        y: 0,
        active: s.enabled,
      }),
    ),
    ...routines.map(
      (r, i): OrbNode => ({
        kind: "routine",
        id: r.id,
        label: r.name,
        sub: labels.routines,
        baseAngle: (i / Math.max(1, routines.length)) * TWO_PI + 0.35,
        radius: RING.routines,
        x: 0,
        y: 0,
        active: r.enabled,
      }),
    ),
    ...connectors.map(
      (c, i): OrbNode => ({
        kind: "app",
        id: c.id,
        label: c.name,
        sub: labels.apps,
        baseAngle: (i / Math.max(1, connectors.length)) * TWO_PI + 0.12,
        radius: RING.apps,
        x: 0,
        y: 0,
        active: c.status === "healthy" || c.status === "configured",
        official: c.official,
      }),
    ),
  ];
}

/** Search-as-you-type: highlight the files whose name or path contains the query (null = no filter). */
export function setMatched(w: World, query: string): void {
  const q = query.trim().toLowerCase();
  if (!q) {
    w.matched = null;
    return;
  }
  w.matched = new Set(w.files.filter((n) => n.name.toLowerCase().includes(q) || n.rel.toLowerCase().includes(q)).map((n) => n.id));
}

/** Select a file: marks it and the edges touching it (null clears). */
export function setSelected(w: World, id: number | null): void {
  w.selectedId = id;
  w.selectedEdges = new Set(id === null ? [] : w.edges.flatMap((e, i) => (w.files[e.a]?.id === id || w.files[e.b]?.id === id ? [i] : [])));
}

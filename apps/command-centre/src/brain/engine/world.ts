/**
 * Second Brain world model — pure TypeScript, no DOM, no React (audit item 40).
 *
 * The world is a mutable bag of positioned entities (file particles, memory
 * hubs, sub-folder planets, structure orbs, transient effects) plus the view
 * transform. The React view owns one instance in a ref; `layouts`, `physics`,
 * `graph` and `hitTest` read and write it without touching React state, which
 * makes every rule here unit testable and keeps the render loop free of
 * component re-renders.
 */
import type { Simulation, SimulationNodeDatum } from "d3-force";
import type { Connector, GraphData, GraphNode, RoutineStatus, Skill } from "../../api";

export type LayoutKind = "arcs" | "force" | "circle" | "hex" | "rings";
export type ViewKind = "areas" | "folders";
export type OrbKind = "skill" | "routine" | "app";
/** Edge kinds produced by `/api/memory/graph`. Unknown kinds are kept under "other". */
export type EdgeKind = "markdown-link" | "same-dir" | "same-area" | "other";
export const EDGE_KINDS: readonly EdgeKind[] = ["markdown-link", "same-dir", "same-area", "other"];
export type ModifiedRange = "24h" | "7d" | "30d" | "all";
export type SizeRange = "any" | "small" | "medium" | "large";

/** A one-off journey of a particle from a fixed start to its live layout target. */
export interface Trip {
  x0: number;
  y0: number;
  /** World clock seconds when the trip starts (may be in the future: staggered fans). */
  t0: number;
  dur: number;
  /** "ease" = eased tween (layout switch); "spring" = overshoot (hub explosion). */
  kind: "ease" | "spring";
}

export interface FileNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Current rotated target (arcs / rings / circle / hex layouts). */
  tx: number;
  ty: number;
  /** Polar target before the ring rotation is applied. */
  baseAngle: number;
  baseRadius: number;
  phase: number;
  group: string;
  r: number;
  /** Number of visible-kind edges touching the node (precomputed). */
  degree: number;
  /** Neighbour-highlight alpha (tweened, 0..1). */
  hoverAlpha: number;
  /** Visibility alpha (tweened): local mode, timeline and filters fade nodes out. */
  visAlpha: number;
  /** Target of `visAlpha` (set by `applyVisibility`). */
  visible: boolean;
  /** Pinned by the user: the spring step and the force layout leave it alone. */
  pinned: boolean;
  /** Colour override from a query group (Obsidian-style), else null. */
  tint: string | null;
  trip: Trip | null;
}

export interface Hub {
  key: string;
  color: string;
  count: number;
  x: number;
  y: number;
  baseAngle: number;
  /** Angular sector (arcs layout): centre and span. */
  sectorStart: number;
  sectorSpan: number;
  expanded: boolean;
  /** True once the user expanded it (hygiene: large hubs never opened). */
  everExpanded: boolean;
}

/** A sub-folder marker inside a hub sector ("planet" with a count). */
export interface Planet {
  hubKey: string;
  dir: string;
  label: string;
  count: number;
  baseAngle: number;
  baseRadius: number;
  x: number;
  y: number;
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

export interface WorldEdge {
  a: number;
  b: number;
  kind: EdgeKind;
  why: string;
}

export interface QueryGroup {
  query: string;
  color: string;
}

export interface BrainFilters {
  exts: string[];
  tags: string[];
  modified: ModifiedRange;
  size: SizeRange;
}

export const DEFAULT_FILTERS: BrainFilters = { exts: [], tags: [], modified: "all", size: "any" };

export interface WorkspaceState {
  pinned: Array<{ id: number; x: number; y: number }>;
  collapsed: string[];
}

export interface BrainSettings {
  layout: LayoutKind;
  view: ViewKind;
  spin: number;
  showNames: boolean;
  linkSpring: number;
  nodeScale: number;
  clusterSize: number;
  edgeKinds: EdgeKind[];
  localHops: number;
  focusMode: boolean;
  workspace?: WorkspaceState;
}

export const DEFAULT_SETTINGS: BrainSettings = {
  layout: "arcs",
  view: "areas",
  spin: 0.16,
  showNames: false,
  linkSpring: 0.05,
  nodeScale: 1,
  clusterSize: 1,
  edgeKinds: ["markdown-link", "same-dir"],
  localHops: 1,
  focusMode: true,
};

export const LAYOUTS: readonly LayoutKind[] = ["arcs", "force", "circle", "hex", "rings"];

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
/** Duration of the layout-switch tween (seconds). */
export const LAYOUT_TWEEN_S = 0.8;
/** Duration of the directed hub explosion (seconds). */
export const EXPLOSION_S = 0.6;

export interface World {
  files: FileNode[];
  edges: WorldEdge[];
  hubs: Hub[];
  planets: Planet[];
  orbs: OrbNode[];
  effects: Effect[];
  comets: Comet[];
  transform: Transform;
  target: Transform;
  theta: number;
  /** World clock in seconds, advanced by `stepWorld` (trips and tweens key off it). */
  time: number;
  layout: LayoutKind;
  spin: number;
  nodeScale: number;
  clusterSize: number;
  filterGroup: string | null;
  filters: BrainFilters;
  query: string;
  groups: QueryGroup[];
  /** Files that pass search + filters (null = no filter active). */
  matched: Set<number> | null;
  selectedId: number | null;
  selectedEdges: Set<number>;
  /** File id under the pointer (null = none). */
  hoverId: number | null;
  /** Indices of the files highlighted by hover/selection (null = no highlight). */
  focusSet: Set<number> | null;
  /** Local mode: only nodes within `localHops` of the selection stay visible. */
  local: boolean;
  localHops: number;
  /** Timeline cutoff (mtime, ms): files modified after it are hidden. Null = off. */
  timeline: number | null;
  edgeKinds: Set<EdgeKind>;
  showNames: boolean;
  hoverKey: string | null;
  colorOf: Map<string, string>;
  sim: Simulation<FileNode, undefined> | null;
  linkSpring: number;
  /** 0..1 fade of the ring guides after a layout switch. */
  ringFade: number;
  /** Adjacency over the enabled edge kinds (file index → neighbour indices). */
  adjacency: number[][];
}

export function createWorld(settings: BrainSettings = DEFAULT_SETTINGS): World {
  return {
    files: [],
    edges: [],
    hubs: [],
    planets: [],
    orbs: [],
    effects: [],
    comets: [],
    transform: { x: 0, y: 0, k: 1 },
    target: { x: 0, y: 0, k: 1 },
    theta: 0,
    time: 0,
    layout: settings.layout,
    spin: settings.spin,
    nodeScale: settings.nodeScale,
    clusterSize: settings.clusterSize,
    filterGroup: null,
    filters: { ...DEFAULT_FILTERS },
    query: "",
    groups: [],
    matched: null,
    selectedId: null,
    selectedEdges: new Set(),
    hoverId: null,
    focusSet: null,
    local: false,
    localHops: settings.localHops,
    timeline: null,
    edgeKinds: new Set(settings.edgeKinds),
    showNames: settings.showNames,
    hoverKey: null,
    colorOf: new Map(),
    sim: null,
    linkSpring: settings.linkSpring,
    ringFade: 1,
    adjacency: [],
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

export function normalizeEdgeKind(kind: string): EdgeKind {
  return kind === "markdown-link" || kind === "same-dir" || kind === "same-area" ? kind : "other";
}

const DAY_MS = 86_400_000;

/** Node radius: base + degree (log) + recency boost (24 h / 7 d). Item 35. */
export function nodeRadius(degree: number, mtime: number, now: number): number {
  return 1.6 + Math.log1p(Math.max(0, degree)) * 0.6 + recencyBoost(mtime, now);
}

export function recencyBoost(mtime: number, now: number): number {
  const age = now - mtime;
  if (age < DAY_MS) return 1.2;
  if (age < 7 * DAY_MS) return 0.6;
  return 0;
}

export interface WorldSources {
  graph: GraphData;
  skills: Skill[];
  routines: RoutineStatus[];
  connectors: Connector[];
  groupOf: (n: GraphNode) => string;
  /** Localised ring names shown as orb subtitles. */
  labels: { skills: string; routines: string; apps: string };
  /** "Now" for recency sizing (defaults to Date.now(); tests pass a fixed value). */
  now?: number;
}

/**
 * (Re)build hubs, files, edges and orbs from fresh data. Existing file
 * positions, pins and hub expansion states survive a rebuild so a refresh does
 * not scramble the map. Callers run `layoutFiles(w)` afterwards.
 */
export function buildWorld(w: World, src: WorldSources): void {
  const { graph, skills, routines, connectors, groupOf, labels } = src;
  const now = src.now ?? Date.now();
  const groups = new Map<string, number>();
  for (const n of graph.nodes) groups.set(groupOf(n), (groups.get(groupOf(n)) ?? 0) + 1);
  const groupKeys = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  w.colorOf = new Map(groupKeys.map((k, i) => [k, GROUP_COLORS[i % GROUP_COLORS.length]!]));

  const prevHubs = new Map(w.hubs.map((h) => [h.key, h]));
  w.hubs = groupKeys.map((key, gi) => {
    const old = prevHubs.get(key);
    const baseAngle = (gi / Math.max(1, groupKeys.length)) * TWO_PI - Math.PI / 2;
    return {
      key,
      color: w.colorOf.get(key)!,
      count: groups.get(key) ?? 0,
      x: old?.x ?? 0,
      y: old?.y ?? 0,
      baseAngle,
      sectorStart: baseAngle - Math.PI / Math.max(1, groupKeys.length),
      sectorSpan: TWO_PI / Math.max(1, groupKeys.length),
      expanded: old?.expanded ?? true,
      everExpanded: old?.everExpanded ?? false,
    };
  });

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
      r: 2,
      degree: 0,
      hoverAlpha: 1,
      visAlpha: old?.visAlpha ?? 1,
      visible: true,
      pinned: old?.pinned ?? false,
      fx: old?.pinned ? old.x : null,
      fy: old?.pinned ? old.y : null,
      tint: null,
      trip: null,
    };
  });
  const indexOf = new Map(w.files.map((n, i) => [n.id, i]));
  w.edges = graph.edges
    .map((e): WorldEdge => ({ a: indexOf.get(e.source) ?? -1, b: indexOf.get(e.target) ?? -1, kind: normalizeEdgeKind(e.kind), why: e.why }))
    .filter((e) => e.a >= 0 && e.b >= 0 && e.a !== e.b);
  w.selectedEdges = new Set();
  w.focusSet = null;
  refreshGraphDerived(w, now);

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

/** Edge indices whose kind is currently enabled. */
export function activeEdgeIndices(w: Pick<World, "edges" | "edgeKinds">): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.edges.length; i++) if (w.edgeKinds.has(w.edges[i]!.kind)) out.push(i);
  return out;
}

/**
 * Recompute adjacency, degrees and radii over the enabled edge kinds. Call
 * after `buildWorld` and whenever `edgeKinds` changes.
 */
export function refreshGraphDerived(w: World, now: number = Date.now()): void {
  const adjacency: number[][] = w.files.map(() => []);
  for (const e of w.edges) {
    if (!w.edgeKinds.has(e.kind)) continue;
    adjacency[e.a]!.push(e.b);
    adjacency[e.b]!.push(e.a);
  }
  w.adjacency = adjacency;
  w.files.forEach((n, i) => {
    n.degree = adjacency[i]!.length;
    n.r = nodeRadius(n.degree, n.mtime, now);
  });
  applyFilters(w, now);
  setSelected(w, w.selectedId);
}

/** Search-as-you-type: highlight the files whose name or path contains the query (null = no filter). */
export function setMatched(w: World, query: string, now: number = Date.now()): void {
  w.query = query;
  applyFilters(w, now);
}

const RANGE_MS: Record<ModifiedRange, number> = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS, all: Infinity };

export function sizeInRange(size: number, range: SizeRange): boolean {
  if (range === "any") return true;
  if (range === "small") return size < 10 * 1024;
  if (range === "medium") return size >= 10 * 1024 && size < 1024 * 1024;
  return size >= 1024 * 1024;
}

/** True when any search, chip or range filter is active. */
export function filtersActive(w: Pick<World, "query" | "filters">): boolean {
  const f = w.filters;
  return w.query.trim() !== "" || f.exts.length > 0 || f.tags.length > 0 || f.modified !== "all" || f.size !== "any";
}

/**
 * Combine search, extension / tag chips, modified range and size into
 * `w.matched` (item 34). The group filter stays separate (it also drives the
 * hub fan lines) and is combined at draw time.
 */
export function applyFilters(w: World, now: number = Date.now()): void {
  if (!filtersActive(w)) {
    w.matched = null;
    return;
  }
  const q = w.query.trim().toLowerCase();
  const f = w.filters;
  const exts = new Set(f.exts.map((e) => e.toLowerCase()));
  const tags = new Set(f.tags.map((t) => t.toLowerCase()));
  const maxAge = RANGE_MS[f.modified];
  const out = new Set<number>();
  for (const n of w.files) {
    if (q && !n.name.toLowerCase().includes(q) && !n.rel.toLowerCase().includes(q)) continue;
    if (exts.size > 0 && !exts.has(n.ext.toLowerCase())) continue;
    if (tags.size > 0 && !n.tags.some((t) => tags.has(t.toLowerCase()))) continue;
    if (maxAge !== Infinity && now - n.mtime > maxAge) continue;
    if (!sizeInRange(n.size, f.size)) continue;
    out.add(n.id);
  }
  w.matched = out;
}

/** Obsidian-style groups: the first query whose substring matches the path tints the node. */
export function applyGroups(w: Pick<World, "files" | "groups">): void {
  const groups = w.groups.filter((g) => g.query.trim() !== "").map((g) => ({ q: g.query.trim().toLowerCase(), color: g.color }));
  for (const n of w.files) {
    n.tint = null;
    if (groups.length === 0) continue;
    const hay = n.rel.toLowerCase();
    for (const g of groups) {
      if (hay.includes(g.q)) {
        n.tint = g.color;
        break;
      }
    }
  }
}

/** Select a file: marks it and the (enabled-kind) edges touching it (null clears). */
export function setSelected(w: World, id: number | null): void {
  w.selectedId = id;
  w.selectedEdges = new Set();
  if (id === null) return;
  const idx = w.files.findIndex((n) => n.id === id);
  if (idx < 0) {
    w.selectedId = null;
    return;
  }
  w.edges.forEach((e, i) => {
    if ((e.a === idx || e.b === idx) && w.edgeKinds.has(e.kind)) w.selectedEdges.add(i);
  });
}

/** Extension and tag facets of the loaded graph (top N by count), for the filter chips. */
export function facetsOf(files: ReadonlyArray<Pick<GraphNode, "ext" | "tags">>, top = 8): { exts: Array<[string, number]>; tags: Array<[string, number]> } {
  const exts = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const n of files) {
    const ext = n.ext || "(none)";
    exts.set(ext, (exts.get(ext) ?? 0) + 1);
    for (const t of n.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top);
  return { exts: sort(exts), tags: sort(tags) };
}

/**
 * All Second Brain state plumbing in one hook: the UI state and its three
 * sources (localStorage → URL → server `settings.brain`), the world instance
 * and every "state → world" synchronisation, plus the derived data the panels
 * need (facets, edge-kind counts, legend, hygiene, timeline range).
 *
 * The view (`views/SecondBrain.tsx`) stays a thin container: it owns the
 * queries, the selection/preview, the canvas handlers and the layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import {
  api,
  type BrainSettingsPayload,
  type Connector,
  type GraphData,
  type GraphNode,
  type RoutineStatus,
  type Skill,
} from "../api";
import { startLayoutTween } from "./engine/explosion";
import { applyVisibility, hygiene, timelineRange, updateFocus, type HygieneReport } from "./engine/graph";
import { layoutFiles } from "./engine/layouts";
import {
  DEFAULT_SETTINGS,
  GROUP_COLORS,
  applyFilters,
  applyGroups,
  buildWorld,
  createWorld,
  facetsOf,
  groupOfNode,
  normalizeEdgeKind,
  refreshGraphDerived,
  type BrainSettings,
  type EdgeKind,
  type FileNode,
  type World,
  type WorkspaceState,
} from "./engine/world";
import {
  defaultUi,
  loadLocalSettings,
  paramsFromUi,
  parseBrainSettings,
  sameParams,
  saveLocalSettings,
  settingsFromUi,
  uiFromParams,
  urlControlledKeys,
  type BrainUi,
} from "./state";

export interface BrainStateSources {
  graph: GraphData | null;
  skills: Skill[];
  routines: RoutineStatus[];
  connectors: Connector[];
  ringLabels: { skills: string; memory: string; routines: string; apps: string };
  /** Timeline cutoff (mtime ms) or null when the scrubber is off. */
  timeline: number | null;
  /** Raw `settings.brain` blob from the server (undefined while loading). */
  serverBlob: unknown;
  /** Ask the canvas for a frame. */
  dirty: () => void;
}

export interface BrainState {
  ui: BrainUi;
  uiRef: MutableRefObject<BrainUi>;
  patch: (p: Partial<BrainUi>) => void;
  world: MutableRefObject<World>;
  /** Bumped after every `buildWorld` (dependency for world-derived memos). */
  version: number;
  groupOf: (n: GraphNode) => string;
  /** Save pins + collapsed hubs (to the server too while workspace mode is on). */
  persistWorkspace: () => void;
  /** Persist the current settings; `toServer` also PUTs `settings.brain`. */
  persist: (settings: BrainSettings, toServer: boolean) => void;
  /** Set when a selection arrives from the URL (deep link): the view should frame it. */
  focusRef: MutableRefObject<boolean>;
  facets: { exts: Array<[string, number]>; tags: Array<[string, number]> };
  kindCounts: Map<EdgeKind, number>;
  legend: Array<{ key: string; count: number; color: string }>;
  report: HygieneReport;
  range: [number, number] | null;
}

/** Pins and collapsed hubs as they stand right now (the workspace blob). */
export function workspaceOf(w: World): WorkspaceState {
  return {
    pinned: w.files
      .filter((n) => n.pinned)
      .map((n) => ({ id: n.id, x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10 })),
    collapsed: w.hubs.filter((h) => !h.expanded).map((h) => h.key),
  };
}

export function useBrainState(src: BrainStateSources): BrainState {
  const { graph, skills, routines, connectors, ringLabels, timeline, serverBlob, dirty } = src;

  const [boot] = useState<BrainSettings>(() => ({ ...DEFAULT_SETTINGS, ...loadLocalSettings() }));
  const [world] = useState<MutableRefObject<World>>(() => ({ current: createWorld(boot) }));
  const [ui, setUi] = useState<BrainUi>(() => defaultUi(boot));
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const patch = useCallback((p: Partial<BrainUi>) => setUi((cur) => ({ ...cur, ...p })), []);
  const [version, setVersion] = useState(0);

  /* ---------- URL ⇄ state ---------- */
  const [searchParams, setSearchParams] = useSearchParams();
  const lockedKeys = useRef<Set<keyof BrainSettings> | null>(null);
  lockedKeys.current ??= urlControlledKeys(searchParams);
  const focusRef = useRef(searchParams.has("sel"));
  const paramStamp = useRef("");

  useEffect(() => {
    const stamp = searchParams.toString();
    if (stamp === paramStamp.current) return;
    paramStamp.current = stamp;
    // A selection that arrives through the URL (command palette, shared link)
    // is framed by the camera; one made on the canvas is not.
    const sel = searchParams.get("sel");
    if (sel !== null && sel !== String(uiRef.current.sel)) focusRef.current = true;
    setUi((cur) => uiFromParams(searchParams, cur));
  }, [searchParams]);

  useEffect(() => {
    const next = paramsFromUi(ui);
    if (sameParams(next, searchParams)) {
      paramStamp.current = searchParams.toString();
      return;
    }
    paramStamp.current = next.toString();
    setSearchParams(next, { replace: true });
  }, [ui, searchParams, setSearchParams]);

  /* ---------- persistence: localStorage always, server on demand ---------- */
  const saveTimer = useRef<number | undefined>(undefined);
  const persist = useCallback((next: BrainSettings, toServer: boolean) => {
    saveLocalSettings(next);
    if (!toServer) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const payload: BrainSettingsPayload = next;
      void api.put("/api/settings", { brain: payload }).catch(() => undefined);
    }, 700);
  }, []);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const settingsJson = useMemo(() => JSON.stringify(settingsFromUi(ui)), [ui]);
  useEffect(() => {
    saveLocalSettings(JSON.parse(settingsJson) as BrainSettings);
  }, [settingsJson]);

  // The server blob wins over localStorage but never over the URL.
  const serverApplied = useRef(false);
  useEffect(() => {
    if (serverApplied.current || serverBlob === undefined) return;
    serverApplied.current = true;
    const locked = lockedKeys.current ?? new Set<keyof BrainSettings>();
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parseBrainSettings(serverBlob)))
      if (!locked.has(key as keyof BrainSettings)) next[key] = value;
    if (Object.keys(next).length > 0) patch(next as Partial<BrainUi>);
  }, [serverBlob, patch]);

  const persistWorkspace = useCallback(() => {
    persist(settingsFromUi(uiRef.current, workspaceOf(world.current)), uiRef.current.workspaceMode);
  }, [persist, world]);

  /* ---------- world construction ---------- */
  const groupOf = useCallback((n: GraphNode): string => groupOfNode(n, ui.view), [ui.view]);
  useEffect(() => {
    if (!graph) return;
    const w = world.current;
    buildWorld(w, { graph, skills, routines, connectors, groupOf, labels: ringLabels });
    layoutFiles(w);
    applyGroups(w);
    applyFilters(w);
    applyVisibility(w);
    updateFocus(w);
    setVersion((v) => v + 1);
    dirty();
  }, [graph, skills, routines, connectors, groupOf, ringLabels, world, dirty]);

  // Restore the saved workspace (pins + collapsed hubs) onto a freshly built world.
  useEffect(() => {
    const w = world.current;
    const ws = ui.workspace;
    if (!ws || w.files.length === 0) return;
    const byId = new Map(w.files.map((n) => [n.id, n]));
    for (const p of ws.pinned) {
      const n = byId.get(p.id);
      if (!n) continue;
      n.pinned = true;
      n.x = p.x;
      n.y = p.y;
      n.fx = p.x;
      n.fy = p.y;
    }
    const collapsed = new Set(ws.collapsed);
    for (const h of w.hubs) h.expanded = !collapsed.has(h.key);
    layoutFiles(w);
    dirty();
  }, [version, ui.workspace, world, dirty]);

  /* ---------- state → world ---------- */
  useEffect(() => {
    const w = world.current;
    w.spin = ui.spin;
    w.nodeScale = ui.nodeScale;
    w.showNames = ui.showNames;
    w.linkSpring = ui.linkSpring;
    w.filterGroup = ui.filterGroup;
    dirty();
  }, [ui.spin, ui.nodeScale, ui.showNames, ui.linkSpring, ui.filterGroup, world, dirty]);

  useEffect(() => {
    const w = world.current;
    w.layout = ui.layout;
    w.clusterSize = ui.clusterSize;
    if (w.files.length === 0) return;
    layoutFiles(w);
    startLayoutTween(w);
    w.ringFade = 0;
    dirty();
  }, [ui.layout, ui.clusterSize, world, dirty]);

  useEffect(() => {
    const w = world.current;
    w.edgeKinds = new Set(ui.edgeKinds);
    refreshGraphDerived(w);
    applyGroups(w);
    applyVisibility(w);
    updateFocus(w);
    dirty();
  }, [ui.edgeKinds, version, world, dirty]);

  useEffect(() => {
    const w = world.current;
    w.query = ui.query;
    w.filters = ui.filters;
    w.groups = ui.groups;
    applyFilters(w);
    applyGroups(w);
    dirty();
  }, [ui.query, ui.filters, ui.groups, version, world, dirty]);

  useEffect(() => {
    const w = world.current;
    w.local = ui.local;
    w.localHops = ui.localHops;
    w.timeline = timeline;
    applyVisibility(w);
    dirty();
  }, [ui.local, ui.localHops, ui.sel, timeline, version, world, dirty]);

  /* ---------- force layout ---------- */
  useEffect(() => {
    const w = world.current;
    w.sim?.stop();
    w.sim = null;
    if (ui.layout !== "force" || w.files.length === 0) return;
    const links = w.edges
      .filter((e) => w.edgeKinds.has(e.kind))
      .map((e) => ({ source: w.files[e.a]!, target: w.files[e.b]! }));
    w.sim = forceSimulation(w.files)
      .force("charge", forceManyBody().strength(-24))
      .force("center", forceCenter(0, 0))
      .force(
        "collide",
        forceCollide<FileNode>((n) => n.r * 2.6),
      )
      .force(
        "link",
        forceLink(links)
          .distance(44)
          .strength(ui.linkSpring * 10),
      )
      .alphaDecay(0.006)
      .stop();
    dirty();
    return () => {
      w.sim?.stop();
      w.sim = null;
    };
  }, [ui.layout, ui.linkSpring, ui.edgeKinds, version, world, dirty]);

  /* ---------- derived panel data ---------- */
  const facets = useMemo(() => facetsOf(graph?.nodes ?? []), [graph]);
  const range = useMemo(() => timelineRange(graph?.nodes ?? []), [graph]);
  const kindCounts = useMemo(() => {
    const counts = new Map<EdgeKind, number>();
    for (const e of graph?.edges ?? []) {
      const kind = normalizeEdgeKind(e.kind);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
  }, [graph]);
  const legend = useMemo(() => {
    void version;
    const counts = new Map<string, number>();
    for (const n of graph?.nodes ?? []) counts.set(groupOf(n), (counts.get(groupOf(n)) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count], i) => ({
        key,
        count,
        color: world.current.colorOf.get(key) ?? GROUP_COLORS[i % GROUP_COLORS.length]!,
      }));
  }, [graph, groupOf, version, world]);
  const report = useMemo(() => {
    void version;
    return hygiene(world.current);
  }, [version, world]);

  return {
    ui,
    uiRef,
    patch,
    world,
    version,
    groupOf,
    persistWorkspace,
    persist,
    focusRef,
    facets,
    kindCounts,
    legend,
    report,
    range,
  };
}

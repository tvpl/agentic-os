import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { ArrowLeft, Copy, ExternalLink, Maximize2, Minus, Plus, RefreshCw, Scan, Tv, X } from "lucide-react";
import {
  api,
  type Connector,
  type GraphData,
  type GraphNode,
  type RoutineStatus,
  type RunRecord,
  type Skill,
} from "../api";
import { I18nContext, useT } from "../i18n";
import { useOsMeta } from "../queries";
import { formatBytes, timeAgo, useToast } from "../components/ui";
import { LAUNCHER_EVENT } from "../App";

/* ============================================================================
   Second Brain v3 — the ARMS universe, alive.
   New in v3: animated zoom (smoothly tweened transform + controls + keyboard),
   spring "explosion" physics when hubs expand/collapse, two-pass neon links
   with energy pulses traveling along them, LIVE AGENT COMETS (running runs
   fly between the core and their skill, with trails and finish bursts),
   a navigable minimap, and presentation mode (p) that hides all chrome.
============================================================================ */

type LayoutKind = "force" | "circle" | "hex" | "rings";
type ViewKind = "areas" | "folders";

interface FileNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  baseAngle: number;
  baseRadius: number;
  phase: number;
  group: string;
  r: number;
}

interface Hub {
  key: string;
  color: string;
  count: number;
  x: number;
  y: number;
  baseAngle: number;
  expanded: boolean;
}

interface OrbNode {
  kind: "skill" | "routine" | "app";
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

interface Effect {
  x: number;
  y: number;
  start: number;
  color: string;
}

interface Comet {
  runId: string;
  skillSlug: string | null;
  seed: number;
  trail: Array<{ x: number; y: number }>;
}

interface PreviewState {
  node: FileNode;
  content: string | null;
  kind: string;
  message: string | null;
  related: Array<{ id: number; name: string; why: string }>;
}

const GROUP_COLORS = [
  "#c084fc", "#f472b6", "#22d3ee", "#fde047",
  "#4ade80", "#fb923c", "#a5b4fc", "#f87171",
  "#5eead4", "#fbbf24",
];
const RING = { skills: 92, hubs: 178, filesInner: 150, routines: 318, apps: 372, labelPad: 14 };
const SKILL_COLOR = "#fb923c";
const ROUTINE_COLOR = "#fbbf24";
const APP_COLOR = "#7dd3fc";
const TWO_PI = Math.PI * 2;
const BAKE_KEY = "mordomo.brain.settings";
const WORLD_EXTENT = RING.apps * 2.35; // world width the minimap and fit-view assume

interface BrainSettings {
  layout: LayoutKind;
  view: ViewKind;
  spin: number;
  showNames: boolean;
  linkSpring: number;
  nodeScale: number;
  clusterSize: number;
}
const DEFAULT_SETTINGS: BrainSettings = {
  layout: "rings",
  view: "areas",
  spin: 0.16,
  showNames: false,
  linkSpring: 0.05,
  nodeScale: 1,
  clusterSize: 1,
};
function loadBaked(): BrainSettings {
  try {
    const raw = localStorage.getItem(BAKE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<BrainSettings>) };
  } catch {
    /* private mode / blocked storage */
  }
  return DEFAULT_SETTINGS;
}

export default function SecondBrain() {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const toast = useToast();
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const baked = useMemo(loadBaked, []);
  const meta = useOsMeta();
  const [listOpen, setListOpen] = useState(false);

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [routines, setRoutines] = useState<RoutineStatus[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [total, setTotal] = useState(0);
  const [layout, setLayout] = useState<LayoutKind>(baked.layout);
  const [view, setView] = useState<ViewKind>(baked.view);
  const [spin, setSpin] = useState(baked.spin);
  const [showNames, setShowNames] = useState(baked.showNames);
  const [linkSpring, setLinkSpring] = useState(baked.linkSpring);
  const [nodeScale, setNodeScale] = useState(baked.nodeScale);
  const [clusterSize, setClusterSize] = useState(baked.clusterSize);
  const [legendOpen, setLegendOpen] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<Array<{ id: number; name: string; rel: string }>>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);

  const world = useRef({
    files: [] as FileNode[],
    edges: [] as Array<{ a: number; b: number }>,
    hubs: [] as Hub[],
    orbs: [] as OrbNode[],
    effects: [] as Effect[],
    comets: [] as Comet[],
    transform: { x: 0, y: 0, k: 1 },
    target: { x: 0, y: 0, k: 1 },
    theta: 0,
    layout: baked.layout as LayoutKind,
    spin: baked.spin,
    nodeScale: baked.nodeScale,
    clusterSize: baked.clusterSize,
    filterGroup: null as string | null,
    matched: null as Set<number> | null,
    selectedId: null as number | null,
    selectedEdges: new Set<number>(),
    showNames: baked.showNames,
    hoverKey: null as string | null,
    colorOf: new Map<string, string>(),
    sim: null as Simulation<FileNode, undefined> | null,
    linkSpring: baked.linkSpring,
  });

  /* ---------- data ---------- */
  const load = useCallback(async () => {
    const [g, sk, rt, cn] = await Promise.all([
      api.get<GraphData>("/api/memory/graph?maxNodes=3000"),
      api.get<Skill[]>("/api/skills").catch(() => []),
      api.get<RoutineStatus[]>("/api/routines").catch(() => []),
      api.get<Connector[]>("/api/connectors").catch(() => []),
    ]);
    setGraph(g);
    setTotal(g.totalFiles);
    setSkills(sk.filter((s) => s.enabled).slice(0, 24));
    setRoutines(rt.slice(0, 18));
    setConnectors(cn.slice(0, 20));
  }, []);

  useEffect(() => {
    void load().catch(() => setGraph({ nodes: [], edges: [], truncated: false, totalFiles: 0 }));
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!debounced.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    void api
      .get<Array<{ id: number; name: string; rel: string }>>(`/api/memory/search?q=${encodeURIComponent(debounced)}&limit=8`)
      .then((res) => !cancelled && setHits(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  /* ---------- live agents: poll runs → comets + finish bursts ---------- */
  useEffect(() => {
    const w = world.current;
    let prevActive = new Map<string, RunRecord>();
    let stopped = false;
    const poll = async () => {
      try {
        const runs = await api.get<RunRecord[]>("/api/runs?limit=12");
        if (stopped) return;
        const active = runs.filter((r) => ["running", "queued"].includes(r.status));
        // finish bursts for runs that left the active set
        for (const [id, old] of prevActive) {
          if (active.some((r) => r.id === id)) continue;
          const finished = runs.find((r) => r.id === id);
          const color = finished?.status === "done" ? "#4ade80" : finished?.status === "failed" ? "#f87171" : "#fbbf24";
          w.effects.push({ x: 0, y: 0, start: performance.now() / 1000, color });
          void old;
        }
        prevActive = new Map(active.map((r) => [r.id, r]));
        setLiveCount(active.length);
        // sync comets (keep trails of survivors)
        const existing = new Map(w.comets.map((c) => [c.runId, c]));
        w.comets = active.slice(0, 4).map((r, i) => existing.get(r.id) ?? {
          runId: r.id,
          skillSlug: r.skillSlug,
          seed: (i + 1) * 1.7 + (r.id.charCodeAt(0) % 7),
          trail: [],
        });
      } catch {
        /* service briefly unavailable */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 4000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const groupOf = useCallback(
    (n: GraphNode): string => {
      if (view === "areas") return n.area ?? "unsorted";
      const seg = n.rel.split(/[\\/]/)[0] ?? "";
      return n.rel.includes("/") || n.rel.includes("\\") ? seg : "(root)";
    },
    [view],
  );

  /* ---------- build world ---------- */
  useEffect(() => {
    if (!graph) return;
    const w = world.current;
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

    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
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
      ...skills.map((s, i): OrbNode => ({
        kind: "skill",
        id: s.slug,
        label: `/${s.slug}`,
        sub: t("brain.ring.skills"),
        baseAngle: (i / Math.max(1, skills.length)) * TWO_PI - Math.PI / 2,
        radius: RING.skills,
        x: 0,
        y: 0,
        active: s.enabled,
      })),
      ...routines.map((r, i): OrbNode => ({
        kind: "routine",
        id: r.id,
        label: r.name,
        sub: t("brain.ring.routines"),
        baseAngle: (i / Math.max(1, routines.length)) * TWO_PI + 0.35,
        radius: RING.routines,
        x: 0,
        y: 0,
        active: r.enabled,
      })),
      ...connectors.map((c, i): OrbNode => ({
        kind: "app",
        id: c.id,
        label: c.name,
        sub: t("brain.ring.apps"),
        baseAngle: (i / Math.max(1, connectors.length)) * TWO_PI + 0.12,
        radius: RING.apps,
        x: 0,
        y: 0,
        active: c.status === "healthy" || c.status === "configured",
        official: c.official,
      })),
    ];
    layoutFiles(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, skills, routines, connectors, groupOf]);

  useEffect(() => {
    const w = world.current;
    w.spin = spin;
    w.nodeScale = nodeScale;
    w.showNames = showNames;
    w.filterGroup = filterGroup;
    w.linkSpring = linkSpring;
    if (w.clusterSize !== clusterSize) {
      w.clusterSize = clusterSize;
      layoutFiles(w);
    }
  }, [spin, nodeScale, showNames, filterGroup, linkSpring, clusterSize]);

  useEffect(() => {
    const w = world.current;
    w.layout = layout;
    layoutFiles(w);
  }, [layout, view]);

  useEffect(() => {
    const w = world.current;
    if (!debounced.trim()) {
      w.matched = null;
      return;
    }
    const q = debounced.toLowerCase();
    w.matched = new Set(
      w.files.filter((n) => n.name.toLowerCase().includes(q) || n.rel.toLowerCase().includes(q)).map((n) => n.id),
    );
  }, [debounced]);

  /* ---------- zoom helpers (animated via target transform) ---------- */
  const zoomBy = useCallback((factor: number) => {
    const tg = world.current.target;
    tg.k = Math.min(9, Math.max(0.3, tg.k * factor));
  }, []);
  const zoomFit = useCallback(() => {
    const canvas = canvasRef.current;
    const w = world.current;
    const rect = canvas?.getBoundingClientRect();
    const k = rect ? Math.min(rect.width, rect.height) / WORLD_EXTENT : 1;
    w.target = { x: 0, y: 0, k: Math.max(0.3, k) };
  }, []);
  const zoomReset = useCallback(() => {
    world.current.target = { x: 0, y: 0, k: 1 };
  }, []);
  const centerOn = useCallback((x: number, y: number, k?: number) => {
    const tg = world.current.target;
    const nk = k ?? Math.max(tg.k, 2.1);
    world.current.target = { x: -x * nk, y: -y * nk, k: nk };
  }, []);

  /* ---------- selection ---------- */
  const selectToken = useRef(0);
  const select = useCallback(async (node: FileNode | null, focus = false) => {
    const w = world.current;
    const token = ++selectToken.current;
    w.selectedId = node?.id ?? null;
    w.selectedEdges = new Set(
      node
        ? w.edges.flatMap((e, i) => (w.files[e.a]?.id === node.id || w.files[e.b]?.id === node.id ? [i] : []))
        : [],
    );
    if (!node) {
      setPreview(null);
      return;
    }
    if (focus) centerOn(node.x, node.y);
    setPreview({ node, content: null, kind: "loading", message: null, related: [] });
    try {
      const [pv, rel] = await Promise.all([
        api.get<{ kind: string; content: string | null; message: string | null }>(
          `/api/memory/preview?p=${encodeURIComponent(node.path)}`,
        ),
        api.get<Array<{ file: { id: number; name: string }; why: string }>>(`/api/memory/related?id=${node.id}`),
      ]);
      if (token !== selectToken.current) return; // a newer selection won the race
      setPreview({
        node,
        content: pv.content,
        kind: pv.kind,
        message: pv.message,
        related: rel.map((r) => ({ id: r.file.id, name: r.file.name, why: r.why })),
      });
    } catch (err) {
      if (token !== selectToken.current) return;
      setPreview({ node, content: null, kind: "error", message: (err as Error).message, related: [] });
    }
  }, [centerOn]);

  const selectById = useCallback(
    (id: number) => {
      const node = world.current.files.find((n) => n.id === id);
      if (node) void select(node, true);
    },
    [select],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post<{ stats: { scanned: number; added: number } }>("/api/memory/index");
      await api.post("/api/memory/routers");
      toast(`${res.stats.scanned} files (+${res.stats.added})`, "ok");
      await load();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setRefreshing(false);
    }
  };

  const bake = () => {
    try {
      const settings: BrainSettings = { layout, view, spin, showNames, linkSpring, nodeScale, clusterSize };
      localStorage.setItem(BAKE_KEY, JSON.stringify(settings));
      toast(t("brain.baked"), "ok");
    } catch {
      toast("Storage unavailable", "danger");
    }
  };

  const toggleHub = useCallback((hub: Hub) => {
    const w = world.current;
    hub.expanded = !hub.expanded;
    // explosion: gather the hub's files at the hub and let the springs hurl
    // them to their new targets (or implode them back into the halo)
    for (const n of w.files) {
      if (n.group !== hub.key) continue;
      n.x = hub.x + (Math.random() - 0.5) * 6;
      n.y = hub.y + (Math.random() - 0.5) * 6;
      const a = Math.random() * TWO_PI;
      const kick = hub.expanded ? 6 + Math.random() * 5 : 2;
      n.vx = Math.cos(a) * kick;
      n.vy = Math.sin(a) * kick;
    }
    w.effects.push({ x: hub.x, y: hub.y, start: performance.now() / 1000, color: hub.color });
    layoutFiles(w);
  }, []);

  const setAllExpanded = (expanded: boolean) => {
    const w = world.current;
    for (const hub of w.hubs) {
      if (hub.expanded !== expanded) toggleHub(hub);
    }
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "");
      if (inField) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "/" && !mod && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "p" && !mod && !e.altKey) {
        setPresenting((v) => !v);
      } else if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomBy(1.25);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomBy(0.8);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, zoomReset]);

  // While presenting, Esc exits presentation instead of leaving the app
  // (capture-phase listener beats the OS shell's bubble-phase navigator).
  useEffect(() => {
    if (!presenting) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPresenting(false);
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [presenting]);

  /* ---------- render loop ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = world.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sprites = new Map<string, HTMLCanvasElement>();
    let bgCanvas: HTMLCanvasElement | null = null;
    // Theme tokens are read once per theme change, never per frame (audit item 30/31).
    const readTokens = () => {
      const s = getComputedStyle(document.documentElement);
      const light = document.documentElement.dataset.theme === "light";
      return {
        light,
        blend: (light ? "source-over" : "lighter") as GlobalCompositeOperation,
        accentCol: s.getPropertyValue("--accent").trim() || "#f97316",
        textDim: s.getPropertyValue("--text-dim").trim() || "#b3aa96",
        faint: s.getPropertyValue("--text-faint").trim() || "#7d7462",
        star: light ? "#3b3630" : "#efe9da",
        hex: light ? "rgba(32,28,20,0.05)" : "rgba(240,230,210,0.03)",
        vars: {
          "--font": s.getPropertyValue("--font").trim() || s.getPropertyValue("--font-body").trim() || "ui-sans-serif, system-ui, sans-serif",
          "--mono": s.getPropertyValue("--mono").trim() || s.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
        } as Record<string, string>,
      };
    };
    let tokens = readTokens();
    const themeObserver = new MutationObserver(() => {
      tokens = readTokens();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    let raf = 0;
    let last = performance.now();
    let running = true;

    const sprite = (color: string): HTMLCanvasElement => {
      let s = sprites.get(color);
      if (s) return s;
      s = document.createElement("canvas");
      s.width = 40;
      s.height = 40;
      const sc = s.getContext("2d")!;
      const g = sc.createRadialGradient(20, 20, 0.5, 20, 20, 19);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.18, color);
      g.addColorStop(0.5, color + "88");
      g.addColorStop(1, color + "00");
      sc.fillStyle = g;
      sc.fillRect(0, 0, 40, 40);
      sprites.set(color, s);
      return s;
    };

    const buildBackground = (width: number, height: number) => {
      bgCanvas = document.createElement("canvas");
      bgCanvas.width = width;
      bgCanvas.height = height;
      const bc = bgCanvas.getContext("2d")!;
      let seed = 11;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      bc.fillStyle = tokens.star;
      for (let i = 0; i < 220; i++) {
        bc.globalAlpha = 0.06 + rand() * 0.22;
        bc.fillRect(rand() * width, rand() * height, 1.2, 1.2);
      }
      bc.globalAlpha = 1;
      const hexR = 34;
      bc.strokeStyle = tokens.hex;
      bc.lineWidth = 1;
      for (let row = 0; row * hexR * 1.5 < height + hexR; row++) {
        for (let col = 0; col * hexR * Math.sqrt(3) < width + hexR; col++) {
          const cx2 = col * hexR * Math.sqrt(3) + (row % 2 ? (hexR * Math.sqrt(3)) / 2 : 0);
          const cy2 = row * hexR * 1.5;
          bc.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i + Math.PI / 6;
            const px = cx2 + Math.cos(a) * hexR;
            const py = cy2 + Math.sin(a) * hexR;
            if (i === 0) bc.moveTo(px, py);
            else bc.lineTo(px, py);
          }
          bc.closePath();
          bc.stroke();
        }
      }
      const glow = bc.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, Math.min(width, height) * 0.55);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f97316";
      glow.addColorStop(0, accent + "1f");
      glow.addColorStop(0.4, "#2b0f4d22");
      glow.addColorStop(1, "transparent");
      bc.fillStyle = glow;
      bc.fillRect(0, 0, width, height);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildBackground(rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const quadPoint = (
      ax: number, ay: number, cx2: number, cy2: number, bx: number, by: number, u: number,
    ): [number, number] => {
      const v = 1 - u;
      return [v * v * ax + 2 * v * u * cx2 + u * u * bx, v * v * ay + 2 * v * u * cy2 + u * u * by];
    };

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const rect = canvas.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const cx = cw / 2;
      const cy = ch / 2;
      const tr = w.transform;
      const tg = w.target;
      const tNow = now / 1000;
      if (!reduceMotion) w.theta += w.spin * dt * 0.45;

      // tween transform toward its target (animated zoom / centering)
      const tf = Math.min(1, dt * 7);
      tr.x += (tg.x - tr.x) * tf;
      tr.y += (tg.y - tr.y) * tf;
      tr.k += (tg.k - tr.k) * tf;

      const { accentCol, textDim, faint } = tokens;
      const styles = { getPropertyValue: (name: string) => tokens.vars[name] ?? "" };

      ctx.clearRect(0, 0, cw, ch);
      if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, cw, ch);

      // advance files — springy physics with overshoot for explosions
      if (w.layout === "force") {
        w.sim?.tick();
      } else {
        const cos = Math.cos(w.theta);
        const sin = Math.sin(w.theta);
        const f = Math.min(2.2, dt * 60);
        const damp = Math.pow(0.86, f);
        for (const n of w.files) {
          const bx = Math.cos(n.baseAngle) * n.baseRadius;
          const by = Math.sin(n.baseAngle) * n.baseRadius;
          n.tx = bx * cos - by * sin;
          n.ty = bx * sin + by * cos;
          n.vx = n.vx * damp + (n.tx - n.x) * 0.045 * f;
          n.vy = n.vy * damp + (n.ty - n.y) * 0.045 * f;
          n.x += n.vx * f;
          n.y += n.vy * f;
        }
      }
      const cosT = Math.cos(w.theta);
      const sinT = Math.sin(w.theta);
      for (const hub of w.hubs) {
        const bx = Math.cos(hub.baseAngle) * RING.hubs;
        const by = Math.sin(hub.baseAngle) * RING.hubs;
        hub.x = bx * cosT - by * sinT;
        hub.y = bx * sinT + by * cosT;
      }
      for (const orb of w.orbs) {
        const speed = orb.kind === "skill" ? -0.35 : orb.kind === "routine" ? 0.5 : 0.22;
        const a = orb.baseAngle + w.theta * speed;
        orb.x = Math.cos(a) * orb.radius;
        orb.y = Math.sin(a) * orb.radius;
      }

      ctx.save();
      ctx.translate(cx + tr.x, cy + tr.y);
      ctx.scale(tr.k, tr.k);

      // ring guides + labels
      const ringDefs: Array<{ r: number; label: string; color: string }> = [
        { r: RING.skills, label: t("brain.ring.skills").toUpperCase(), color: SKILL_COLOR },
        { r: RING.hubs + 60, label: t("brain.ring.memory").toUpperCase(), color: "#c084fc" },
        { r: RING.routines, label: t("brain.ring.routines").toUpperCase(), color: ROUTINE_COLOR },
        { r: RING.apps, label: t("brain.ring.apps").toUpperCase(), color: APP_COLOR },
      ];
      for (const ring of ringDefs) {
        ctx.beginPath();
        ctx.arc(0, 0, ring.r, 0, TWO_PI);
        ctx.strokeStyle = ring.color + "2e";
        ctx.lineWidth = 1 / tr.k;
        ctx.stroke();
        ctx.font = `800 ${15 / Math.max(0.7, tr.k)}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
        ctx.fillStyle = ring.color + "b8";
        ctx.textAlign = "center";
        ctx.shadowColor = ring.color;
        ctx.shadowBlur = 14;
        ctx.fillText(ring.label, 0, -ring.r + RING.labelPad / tr.k - 4);
        ctx.shadowBlur = 0;
        ctx.textAlign = "start";
      }
      for (const rr of [RING.routines, RING.apps]) {
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * TWO_PI + w.theta * (rr === RING.apps ? 0.22 : 0.5);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.1 / tr.k, 0, TWO_PI);
          ctx.fillStyle = faint;
          ctx.globalAlpha = 0.5;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      ctx.globalCompositeOperation = tokens.blend;

      // hub fan lines
      for (const hub of w.hubs) {
        if (!hub.expanded || hub.count > 80) continue;
        if (w.filterGroup && hub.key !== w.filterGroup) continue;
        ctx.strokeStyle = hub.color;
        ctx.globalAlpha = 0.14;
        ctx.lineWidth = 0.7 / tr.k;
        ctx.beginPath();
        for (const n of w.files) {
          if (n.group !== hub.key) continue;
          ctx.moveTo(hub.x, hub.y);
          ctx.lineTo(n.x, n.y);
        }
        ctx.stroke();
      }

      // NEON markdown links: wide glow pass + bright core pass + energy pulses
      if (w.edges.length > 0 && w.edges.length < 1500) {
        for (let i = 0; i < w.edges.length; i++) {
          const e = w.edges[i]!;
          const a = w.files[e.a];
          const b = w.files[e.b];
          if (!a || !b) continue;
          const isSel = w.selectedEdges.has(i);
          const mx = ((a.x + b.x) / 2) * 0.82;
          const my = ((a.y + b.y) / 2) * 0.82;
          // glow pass
          ctx.strokeStyle = accentCol;
          ctx.globalAlpha = isSel ? 0.3 : 0.1;
          ctx.lineWidth = (isSel ? 5 : 3.4) / tr.k;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
          ctx.stroke();
          // core pass
          ctx.globalAlpha = isSel ? 0.95 : 0.4;
          ctx.lineWidth = (isSel ? 1.6 : 1) / tr.k;
          ctx.stroke();
          // traveling energy pulse
          if (i < 240 && !reduceMotion) {
            const u = (tNow * (isSel ? 0.55 : 0.22) + i * 0.137) % 1;
            const [px, py] = quadPoint(a.x, a.y, mx, my, b.x, b.y, u);
            const ps = (isSel ? 3.4 : 2.2) / Math.max(0.7, tr.k);
            ctx.globalAlpha = 0.9;
            ctx.drawImage(sprite(accentCol), px - ps * 2, py - ps * 2, ps * 4, ps * 4);
          }
        }
        ctx.globalAlpha = 1;
      }

      // FILE particles (additive)
      let labelBudget = 240;
      const hubByKey = new Map(w.hubs.map((h) => [h.key, h] as const));
      for (const n of w.files) {
        const color = w.colorOf.get(n.group) ?? "#94a3b8";
        const hub = hubByKey.get(n.group);
        const collapsedDim = hub && !hub.expanded ? 0.35 : 1;
        const dimByFilter = w.filterGroup !== null && n.group !== w.filterGroup;
        const dimBySearch = w.matched !== null && !w.matched.has(n.id);
        const selected = w.selectedId === n.id;
        let alpha = (dimByFilter || dimBySearch ? 0.05 : 0.95) * collapsedDim;
        if (!reduceMotion && alpha > 0.2) alpha *= 0.7 + 0.3 * Math.sin(tNow * 1.5 + n.phase);
        const boost = selected ? 2.1 : w.matched?.has(n.id) ? 1.6 : 1;
        const size = n.r * w.nodeScale * boost;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite(color), n.x - size * 2.6, n.y - size * 2.6, size * 5.2, size * 5.2);

        const wantLabel =
          selected || (w.matched?.has(n.id) ?? false) ||
          ((w.showNames || tr.k > 1.9) && !dimByFilter && !dimBySearch && collapsedDim === 1 && labelBudget > 0);
        if (wantLabel && labelBudget > 0) {
          labelBudget--;
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = selected ? 1 : 0.7;
          ctx.fillStyle = textDim;
          ctx.font = `${10 / tr.k}px ${styles.getPropertyValue("--mono") || "monospace"}`;
          ctx.fillText(n.name.length > 26 ? n.name.slice(0, 24) + "…" : n.name, n.x + size + 5 / tr.k, n.y + 3 / tr.k);
          ctx.globalCompositeOperation = tokens.blend;
        }
      }

      // burst effects (hub explosions, run finishes)
      w.effects = w.effects.filter((fx) => tNow - fx.start < 1);
      for (const fx of w.effects) {
        const age = tNow - fx.start;
        const rr = age * 150;
        const alpha = Math.max(0, 1 - age / 0.9);
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = alpha * 0.8;
        ctx.lineWidth = 2 / tr.k;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, rr, 0, TWO_PI);
        ctx.stroke();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TWO_PI + fx.start;
          const pr = rr * 0.85;
          const ps = 2.4 * alpha;
          ctx.globalAlpha = alpha;
          ctx.drawImage(sprite(fx.color), fx.x + Math.cos(a) * pr - ps * 2, fx.y + Math.sin(a) * pr - ps * 2, ps * 4, ps * 4);
        }
      }
      ctx.globalAlpha = 1;

      // LIVE AGENT COMETS
      for (const comet of w.comets) {
        const targetOrb = comet.skillSlug ? w.orbs.find((o) => o.kind === "skill" && o.id === comet.skillSlug) : undefined;
        const tx2 = targetOrb ? targetOrb.x : Math.cos(comet.seed + tNow * 0.4) * RING.hubs * 0.7;
        const ty2 = targetOrb ? targetOrb.y : Math.sin(comet.seed + tNow * 0.4) * RING.hubs * 0.7;
        const cycle = (tNow * 0.4 + comet.seed) % 2;
        const p = cycle < 1 ? cycle : 2 - cycle;
        const ease = p * p * (3 - 2 * p);
        const bulge = Math.sin(ease * Math.PI) * 44;
        const dx = ty2;
        const dy = -tx2;
        const dl = Math.hypot(dx, dy) || 1;
        const hx = tx2 * ease + (dx / dl) * bulge;
        const hy = ty2 * ease + (dy / dl) * bulge;
        comet.trail.push({ x: hx, y: hy });
        if (comet.trail.length > 16) comet.trail.shift();
        comet.trail.forEach((pt, i) => {
          const a2 = (i / comet.trail.length) * 0.7;
          const ps = 1 + (i / comet.trail.length) * 2.4;
          ctx.globalAlpha = a2;
          ctx.drawImage(sprite(accentCol), pt.x - ps * 2, pt.y - ps * 2, ps * 4, ps * 4);
        });
        const headPulse = reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(tNow * 6 + comet.seed);
        const hs = 4.2 * headPulse;
        ctx.globalAlpha = 1;
        ctx.drawImage(sprite("#ffffff"), hx - hs * 2, hy - hs * 2, hs * 4, hs * 4);
        ctx.drawImage(sprite(accentCol), hx - hs * 2.8, hy - hs * 2.8, hs * 5.6, hs * 5.6);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // structure orbs
      for (const orb of w.orbs) {
        const hovered = w.hoverKey === `${orb.kind}:${orb.id}`;
        if (orb.kind === "skill") {
          const pulse = reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(tNow * 2 + orb.baseAngle * 5);
          drawSpark(ctx, orb.x, orb.y, (hovered ? 11 : 8) * pulse, SKILL_COLOR, tr.k);
          if (hovered || tr.k > 1.6) {
            ctx.fillStyle = hovered ? accentCol : textDim;
            ctx.font = `700 ${10 / tr.k}px ${styles.getPropertyValue("--mono") || "monospace"}`;
            ctx.textAlign = "center";
            ctx.fillText(orb.label, orb.x, orb.y - 12 / tr.k);
            ctx.textAlign = "start";
          }
        } else if (orb.kind === "routine") {
          drawClock(ctx, orb.x, orb.y, hovered ? 10 : 8, ROUTINE_COLOR, orb.active, tr.k, tNow);
          if (hovered) {
            ctx.fillStyle = accentCol;
            ctx.font = `700 ${10.5 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
            ctx.textAlign = "center";
            ctx.fillText(orb.label, orb.x, orb.y - 15 / tr.k);
            ctx.textAlign = "start";
          }
        } else {
          drawHexBadge(ctx, orb.x, orb.y, hovered ? 15 : 12, APP_COLOR, orb.label, !!orb.official, orb.active, tr.k);
          if (hovered) {
            ctx.fillStyle = accentCol;
            ctx.font = `700 ${10.5 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
            ctx.textAlign = "center";
            ctx.fillText(orb.label, orb.x, orb.y - 20 / tr.k);
            ctx.textAlign = "start";
          }
        }
      }

      // MEMORY hubs
      for (const hub of w.hubs) {
        const active = w.filterGroup === hub.key || w.hoverKey === `hub:${hub.key}`;
        const rr = active ? 13 : 10.5;
        ctx.save();
        ctx.shadowColor = hub.color;
        ctx.shadowBlur = active ? 26 : 14;
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, rr, 0, TWO_PI);
        ctx.fillStyle = hub.color;
        ctx.fill();
        ctx.restore();
        drawFolderGlyph(ctx, hub.x, hub.y, rr * 0.9, "#0b0a08");
        ctx.font = `800 ${9 / tr.k}px ${styles.getPropertyValue("--mono") || "monospace"}`;
        ctx.fillStyle = faint;
        ctx.textAlign = "center";
        ctx.fillText(String(hub.count), hub.x, hub.y + rr + 11 / tr.k);
        ctx.fillStyle = active ? accentCol : textDim;
        ctx.font = `800 ${11.5 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
        const label = hub.key.toUpperCase();
        ctx.fillText(label.length > 16 ? label.slice(0, 15) + "…" : label, hub.x, hub.y - rr - 7 / tr.k);
        ctx.textAlign = "start";
        if (!hub.expanded) {
          ctx.strokeStyle = hub.color;
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 1 / tr.k;
          ctx.beginPath();
          ctx.arc(hub.x, hub.y, rr + 5, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      drawPixelCore(ctx, accentCol, tr.k, reduceMotion ? 0 : tNow, w.comets.length > 0);
      ctx.fillStyle = textDim;
      ctx.font = `800 ${11 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
      ctx.textAlign = "center";
      ctx.fillText("ROUTER.MD", 0, 36 / tr.k);
      ctx.textAlign = "start";

      ctx.restore();

      // minimap
      const mini = minimapRef.current;
      if (mini) {
        const mctx = mini.getContext("2d");
        if (mctx) {
          const mw = mini.width;
          const mh = mini.height;
          const scale = mw / WORLD_EXTENT;
          mctx.clearRect(0, 0, mw, mh);
          mctx.fillStyle = "rgba(0,0,0,0.25)";
          mctx.fillRect(0, 0, mw, mh);
          mctx.strokeStyle = faint;
          mctx.globalAlpha = 0.5;
          for (const rr of [RING.skills, RING.routines, RING.apps]) {
            mctx.beginPath();
            mctx.arc(mw / 2, mh / 2, rr * scale, 0, TWO_PI);
            mctx.stroke();
          }
          mctx.globalAlpha = 1;
          for (let i = 0; i < w.files.length; i += 2) {
            const n = w.files[i]!;
            mctx.fillStyle = w.colorOf.get(n.group) ?? "#94a3b8";
            mctx.fillRect(mw / 2 + n.x * scale, mh / 2 + n.y * scale, 1.4, 1.4);
          }
          // viewport rectangle
          const vw = cw / tr.k * scale;
          const vh = ch / tr.k * scale;
          const vx = mw / 2 + (-tr.x / tr.k - cw / (2 * tr.k)) * scale;
          const vy = mh / 2 + (-tr.y / tr.k - ch / (2 * tr.k)) * scale;
          mctx.strokeStyle = accentCol;
          mctx.lineWidth = 1;
          mctx.strokeRect(vx, vy, vw, vh);
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeObserver.disconnect();
    };
  }, [t]);

  /* ---------- minimap navigation ---------- */
  useEffect(() => {
    const mini = minimapRef.current;
    if (!mini) return;
    let down = false;
    const jump = (e: PointerEvent) => {
      const rect = mini.getBoundingClientRect();
      const scale = mini.width / WORLD_EXTENT;
      const wx = (e.clientX - rect.left - rect.width / 2) / scale;
      const wy = (e.clientY - rect.top - rect.height / 2) / scale;
      const tg = world.current.target;
      world.current.target = { x: -wx * tg.k, y: -wy * tg.k, k: tg.k };
    };
    const onDown = (e: PointerEvent) => {
      down = true;
      mini.setPointerCapture(e.pointerId);
      jump(e);
    };
    const onMove = (e: PointerEvent) => down && jump(e);
    const onUp = () => (down = false);
    mini.addEventListener("pointerdown", onDown);
    mini.addEventListener("pointermove", onMove);
    mini.addEventListener("pointerup", onUp);
    return () => {
      mini.removeEventListener("pointerdown", onDown);
      mini.removeEventListener("pointermove", onMove);
      mini.removeEventListener("pointerup", onUp);
    };
  }, []);

  /* ---------- force simulation ---------- */
  useEffect(() => {
    const w = world.current;
    w.sim?.stop();
    w.sim = null;
    if (layout !== "force" || !graph) return;
    const links = w.edges.map((e) => ({ source: w.files[e.a]!, target: w.files[e.b]! }));
    w.sim = forceSimulation(w.files)
      .force("charge", forceManyBody().strength(-24))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<FileNode>((n) => n.r * 2.6))
      .force("link", forceLink(links).distance(44).strength(linkSpring * 10))
      .alphaDecay(0.006)
      .stop();
    return () => {
      w.sim?.stop();
      w.sim = null;
    };
  }, [layout, graph, linkSpring]);

  /* ---------- pointer interaction ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = world.current;
    let dragging = false;
    let moved = false;
    let start = { x: 0, y: 0 };

    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const tr = w.transform;
      return {
        x: (clientX - rect.left - rect.width / 2 - tr.x) / tr.k,
        y: (clientY - rect.top - rect.height / 2 - tr.y) / tr.k,
        sx: clientX - rect.left,
        sy: clientY - rect.top,
      };
    };

    const hitTest = (wx: number, wy: number): { file?: FileNode; hub?: Hub; orb?: OrbNode } => {
      for (const hub of w.hubs) {
        if (Math.hypot(wx - hub.x, wy - hub.y) < 17) return { hub };
      }
      for (const orb of w.orbs) {
        if (Math.hypot(wx - orb.x, wy - orb.y) < (orb.kind === "app" ? 17 : 13)) return { orb };
      }
      const tol = 9 / w.transform.k + 4;
      let best: FileNode | undefined;
      let bestD = tol * tol;
      for (const n of w.files) {
        const dx = wx - n.x;
        const dy = wy - n.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return { file: best };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const tg = w.target;
      const factor = e.deltaY < 0 ? 1.13 : 0.89;
      const k = Math.min(9, Math.max(0.3, tg.k * factor));
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const wx = (mx - tg.x) / tg.k;
      const wy = (my - tg.y) / tg.k;
      tg.k = k;
      tg.x = mx - wx * k;
      tg.y = my - wy * k;
    };
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      start = { x: e.clientX - w.transform.x, y: e.clientY - w.transform.y };
      canvas.classList.add("dragging");
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        const nx = e.clientX - start.x;
        const ny = e.clientY - start.y;
        if (Math.abs(nx - w.transform.x) + Math.abs(ny - w.transform.y) > 3) moved = true;
        w.transform.x = nx;
        w.transform.y = ny;
        w.target.x = nx;
        w.target.y = ny;
        w.target.k = w.transform.k;
        return;
      }
      const p = toWorld(e.clientX, e.clientY);
      const hit = hitTest(p.x, p.y);
      w.hoverKey = hit.hub ? `hub:${hit.hub.key}` : hit.orb ? `${hit.orb.kind}:${hit.orb.id}` : null;
      const hoverId = w.hoverKey ?? (hit.file ? `file:${hit.file.id}` : null);
      if (hoverId === lastHoverId) return;
      lastHoverId = hoverId;
      if (hit.hub) {
        setHover({ x: p.sx + 14, y: p.sy + 10, title: hit.hub.key, sub: `${hit.hub.count} ${t("brain.files")} — ${t("brain.clickToFilter")}` });
      } else if (hit.orb) {
        setHover({ x: p.sx + 14, y: p.sy + 10, title: hit.orb.label, sub: hit.orb.sub });
      } else if (hit.file) {
        setHover({ x: p.sx + 14, y: p.sy + 10, title: hit.file.name, sub: hit.file.group });
      } else {
        setHover(null);
      }
    };
    const onUp = (e: PointerEvent) => {
      canvas.classList.remove("dragging");
      if (!dragging) return;
      dragging = false;
      if (moved) return;
      const p = toWorld(e.clientX, e.clientY);
      const hit = hitTest(p.x, p.y);
      if (hit.hub) {
        toggleHub(hit.hub);
      } else if (hit.orb) {
        if (hit.orb.kind === "skill") navigate(`/skills/${hit.orb.id}`);
        else if (hit.orb.kind === "routine") navigate("/routines");
        else navigate("/connectors");
      } else if (hit.file) {
        void select(hit.file);
      } else {
        void select(null);
      }
    };
    const onDblClick = (e: MouseEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      const hit = hitTest(p.x, p.y);
      if (hit.file) void select(hit.file, true);
      else world.current.target = { x: 0, y: 0, k: 1 };
    };
    let lastHoverId: string | null = null;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDblClick);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, [select, navigate, t, toggleHub]);

  /* ---------- legend data ---------- */
  const legend = useMemo(() => {
    if (!graph) return [];
    const counts = new Map<string, number>();
    for (const n of graph.nodes) counts.set(groupOf(n), (counts.get(groupOf(n)) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.map(([key, count], i) => ({
      key,
      count,
      color: world.current.colorOf.get(key) ?? GROUP_COLORS[i % GROUP_COLORS.length]!,
    }));
  }, [graph, groupOf]);

  const layoutLabels: Record<LayoutKind, string> = {
    force: t("brain.layout.force"),
    circle: t("brain.layout.circle"),
    hex: t("brain.layout.hex"),
    rings: t("brain.layout.rings"),
  };

  return (
    <div className={`brain2${presenting ? " presenting" : ""}${preview ? " has-preview" : ""}`}>
      <canvas ref={canvasRef} aria-label={t("brain.title")} role="img" aria-describedby="brain-count" />
      <span id="brain-count" className="sr-only">{total} {t("brain.sub")}</span>
      {listOpen && !presenting && graph && (
        <FileList graph={graph} groupOf={groupOf} selectedId={preview?.node.id ?? null} onSelect={selectById} onClose={() => setListOpen(false)} />
      )}

      <div className="brain2-topbar">
        <div>
          <div className="brain2-brand">
            <span className="primary accent-text">{(meta.data?.name ?? "Mordomo").replace(/\s*os$/i, "")}</span>
            <span className="secondary">{t("brain.title")}</span>
          </div>
          <div className="brain2-brand">
            <span className="byline">{total.toLocaleString()} {t("brain.sub")}</span>
            {liveCount > 0 && (
              <button
                className="badge accent"
                style={{ border: "none", cursor: "pointer", marginLeft: 8, animation: "pulse-glow 2s ease-in-out infinite" }}
                onClick={() => navigate("/runs")}
              >
                ◉ {liveCount} {t("brain.liveAgents")}
              </button>
            )}
          </div>
        </div>
        {presenting ? (
          <button className="os-chip" onClick={() => setPresenting(false)}>
            <X aria-hidden /> {t("brain.exitPresent")}
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" onClick={refresh} disabled={refreshing} title={t("brain.refresh")}>
              {refreshing ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />}
            </button>
            <button className="btn sm" onClick={() => setPresenting(true)} title={t("brain.present")} aria-label={t("brain.present")}>
              <Tv aria-hidden />
            </button>
            <button className="os-chip" onClick={() => navigate("/")}>
              <ArrowLeft aria-hidden /> {t("os.backToOs")}
            </button>
            <button className="os-chip" onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
              ☰ {t("os.menu")}
            </button>
          </div>
        )}
      </div>

      {!presenting && (
        <div className="brain2-panel">
          <input
            ref={searchRef}
            className="input"
            placeholder={t("brain.searchPh")}
            title={`${t("brain.searchPh")} ( / )`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("common.search")}
          />
          {hits.length > 0 && (
            <div>
              {hits.map((h) => (
                <button key={h.id} className="microapp-row" style={{ padding: "5px 6px" }} onClick={() => selectById(h.id)}>
                  <span style={{ minWidth: 0 }}>
                    <span className="ma-name truncate" style={{ display: "block", fontSize: 12 }}>{h.name}</span>
                    <span className="ma-desc truncate" style={{ display: "block" }}>{h.rel}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div>
            <div className="hud-label" style={{ marginBottom: 6 }}>{t("brain.layout")}</div>
            <div className="segmented sm" role="group" aria-label={t("brain.layout")}>
              {(["force", "circle", "hex", "rings"] as LayoutKind[]).map((k) => (
                <button key={k} className={layout === k ? "active" : ""} onClick={() => setLayout(k)}>{layoutLabels[k]}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="hud-label" style={{ marginBottom: 6 }}>{t("brain.view")}</div>
            <div className="segmented sm" role="group" aria-label={t("brain.view")}>
              <button className={view === "areas" ? "active" : ""} onClick={() => { setView("areas"); setFilterGroup(null); }}>{t("brain.view.areas")}</button>
              <button className={view === "folders" ? "active" : ""} onClick={() => { setView("folders"); setFilterGroup(null); }}>{t("brain.view.folders")}</button>
            </div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setAllExpanded(true)}>{t("brain.expandAll")}</button>
            <button className="btn sm" onClick={() => setAllExpanded(false)}>{t("brain.collapseAll")}</button>
          </div>
          <div className="row">
            <button
              className="btn sm"
              onClick={() => {
                zoomReset();
                setFilterGroup(null);
                setQuery("");
                void select(null);
              }}
            >
              {t("brain.reset")}
            </button>
            <button className={`btn sm${listOpen ? " outline-accent" : ""}`} onClick={() => setListOpen((v) => !v)} aria-pressed={listOpen}>
              {t("brain.listView")}
            </button>
          </div>
          <details className="brain2-advanced">
          <summary className="hud-label">{t("brain.advanced")}</summary>
          <div>
            <div className="hud-label">{t("brain.spin")}</div>
            <div className="slider-row">
              <input type="range" min={0} max={1} step={0.01} value={spin} onChange={(e) => setSpin(Number(e.target.value))} aria-label={t("brain.spin")} />
              <span className="val">{spin.toFixed(2)}</span>
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
            {t("brain.fileNames")}
          </label>
          <div>
            <div className="hud-label">{t("brain.springs")}</div>
            <div className="slider-row">
              <input type="range" min={0.01} max={0.2} step={0.01} value={linkSpring} onChange={(e) => setLinkSpring(Number(e.target.value))} aria-label={t("brain.springs")} />
              <span className="val">{linkSpring.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <div className="hud-label">{t("brain.clusterSize")}</div>
            <div className="slider-row">
              <input type="range" min={0.5} max={1.8} step={0.05} value={clusterSize} onChange={(e) => setClusterSize(Number(e.target.value))} aria-label={t("brain.clusterSize")} />
              <span className="val">{clusterSize.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <div className="hud-label">{t("brain.nodeSize")}</div>
            <div className="slider-row">
              <input type="range" min={0.4} max={2} step={0.05} value={nodeScale} onChange={(e) => setNodeScale(Number(e.target.value))} aria-label={t("brain.nodeSize")} />
              <span className="val">{nodeScale.toFixed(2)}</span>
            </div>
          </div>
          <button className="btn sm outline-accent" onClick={bake}>{t("brain.bake")}</button>
          </details>
          {filterGroup && (
            <button className="btn sm outline-accent" onClick={() => setFilterGroup(null)}>
              <X aria-hidden /> {filterGroup}
            </button>
          )}
          <div>
            <div className="hud-label" style={{ marginBottom: 4 }}>{t("brain.minimap")}</div>
            <canvas ref={minimapRef} width={226} height={150} className="brain2-minimap" aria-label={t("brain.minimap")} />
          </div>
          {graph?.truncated && <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)" }}>{t("brain.truncated")}</p>}
        </div>
      )}

      {!presenting && (
        <div className="zoom-stack">
          <button className="os-tool" onClick={() => zoomBy(1.3)} aria-label={t("brain.zoomIn")} title={`${t("brain.zoomIn")} (+)`}><Plus aria-hidden /></button>
          <button className="os-tool" onClick={() => zoomBy(0.77)} aria-label={t("brain.zoomOut")} title={`${t("brain.zoomOut")} (−)`}><Minus aria-hidden /></button>
          <button className="os-tool" onClick={zoomFit} aria-label={t("brain.zoomFit")} title={t("brain.zoomFit")}><Maximize2 aria-hidden /></button>
          <button className="os-tool" onClick={zoomReset} aria-label={t("brain.reset")} title={`${t("brain.reset")} (0)`}><Scan aria-hidden /></button>
        </div>
      )}

      {!presenting && (legendOpen && legend.length > 0 ? (
        <div className="brain2-legend" aria-label={t("brain.legend")}>
          <button className="hud-label" style={{ marginBottom: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }} onClick={() => setLegendOpen(false)}>
            ◆ {t("brain.legend")}
          </button>
          {legend.slice(0, 9).map((l) => (
            <div className="lg-row" key={l.key}>
              <button
                onClick={() => setFilterGroup((cur) => (cur === l.key ? null : l.key))}
                aria-pressed={filterGroup === l.key}
                style={{ opacity: filterGroup && filterGroup !== l.key ? 0.4 : 1, width: "100%" }}
              >
                <span className="dot" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }} />
                <span className="truncate" style={{ maxWidth: 110 }}>{l.key}</span>
                <span className="count">{l.count}</span>
              </button>
            </div>
          ))}
          <div className="lg-row"><span className="dot" style={{ background: SKILL_COLOR, boxShadow: `0 0 8px ${SKILL_COLOR}` }} /> {t("brain.ring.skills")}<span className="count">{skills.length}</span></div>
          <div className="lg-row"><span className="dot" style={{ background: ROUTINE_COLOR, boxShadow: `0 0 8px ${ROUTINE_COLOR}` }} /> {t("brain.ring.routines")}<span className="count">{routines.length}</span></div>
          <div className="lg-row"><span className="dot" style={{ background: APP_COLOR, boxShadow: `0 0 8px ${APP_COLOR}` }} /> {t("brain.ring.apps")}<span className="count">{connectors.length}</span></div>
        </div>
      ) : legend.length > 0 ? (
        <button className="os-chip" style={{ position: "absolute", left: 16, bottom: 16, zIndex: 10 }} onClick={() => setLegendOpen(true)}>
          ◆ {t("brain.legend")}
        </button>
      ) : null)}

      {!presenting && (
        <div className="brain2-bottom-tag">{layoutLabels[layout]} · {view === "areas" ? t("brain.view.areas") : t("brain.view.folders")}</div>
      )}

      {hover && !preview && (
        <div className="brain2-tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.title}
          <div className="sub">{hover.sub}</div>
        </div>
      )}

      {preview && !presenting && (
        <aside className="brain2-preview">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <h3 style={{ margin: 0, wordBreak: "break-all" }}>{preview.node.title ?? preview.node.name}</h3>
            <button className="btn ghost sm" onClick={() => void select(null)} aria-label={t("common.close")}>✕</button>
          </div>
          <p className="mono" style={{ fontSize: 11, color: "var(--text-faint)", wordBreak: "break-all", margin: "4px 0 8px" }}>
            {preview.node.path}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="badge accent">{preview.node.group}</span>
            <span className="badge dim">{preview.node.ext || "file"}</span>
            <span className="badge dim">{formatBytes(preview.node.size)}</span>
            <span className="badge dim">{timeAgo(preview.node.mtime, lang)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              className="btn sm"
              onClick={() => {
                void navigator.clipboard.writeText(preview.node.path);
                toast(t("common.copied"), "ok");
              }}
            >
              <Copy aria-hidden /> {t("brain.copyPath")}
            </button>
            <button
              className="btn sm"
              onClick={() => void api.post("/api/memory/open", { p: preview.node.path }).catch((e: Error) => toast(e.message, "danger"))}
            >
              <ExternalLink aria-hidden /> {t("common.open")}
            </button>
          </div>
          {preview.kind === "loading" ? (
            <span className="spinner" aria-hidden />
          ) : preview.kind === "text" ? (
            <pre className="preview-pre">{preview.content}</pre>
          ) : (
            <p style={{ color: "var(--text-faint)", fontSize: 12.5 }}>
              {preview.kind === "blocked" ? t("brain.blocked") : (preview.message ?? t("brain.binary"))}
            </p>
          )}
          {preview.related.length > 0 && (
            <>
              <div className="hud-label" style={{ margin: "10px 0 4px" }}>{t("brain.related")}</div>
              {preview.related.slice(0, 6).map((r) => (
                <div className="list-row" key={`${r.id}-${r.why}`} style={{ padding: "5px 0" }}>
                  <button className="btn ghost sm" style={{ padding: "2px 6px" }} onClick={() => selectById(r.id)}>{r.name}</button>
                  <span className="meta" style={{ textAlign: "right", fontSize: 11 }}>{r.why}</span>
                </div>
              ))}
            </>
          )}
        </aside>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   File layout: nebulas around each hub, shaped by the chosen layout.
--------------------------------------------------------------------------- */
function layoutFiles(w: {
  files: FileNode[];
  hubs: Hub[];
  layout: LayoutKind;
  clusterSize: number;
}): void {
  const byGroup = new Map<string, FileNode[]>();
  for (const n of w.files) {
    const list = byGroup.get(n.group) ?? [];
    list.push(n);
    byGroup.set(n.group, list);
  }
  const cs = w.clusterSize;

  for (const hub of w.hubs) {
    const list = (byGroup.get(hub.key) ?? []).slice().sort((a, b) => b.mtime - a.mtime);
    if (list.length === 0) continue;
    const hubX = Math.cos(hub.baseAngle) * RING.hubs;
    const hubY = Math.sin(hub.baseAngle) * RING.hubs;

    if (!hub.expanded) {
      list.forEach((n, i) => {
        const rr = 20 + (i % 3) * 5;
        const aa = (i / Math.max(1, list.length)) * TWO_PI;
        const x = hubX + Math.cos(aa) * rr * 0.8;
        const y = hubY + Math.sin(aa) * rr * 0.8;
        n.baseRadius = Math.hypot(x, y);
        n.baseAngle = Math.atan2(y, x);
      });
      continue;
    }

    if (w.layout === "hex") {
      const HEX = 13 * cs;
      const cols = Math.max(3, Math.ceil(Math.sqrt(list.length) * 1.25));
      list.forEach((n, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const localX = (col - cols / 2) * HEX + (row % 2 ? HEX / 2 : 0);
        const localY = 46 + row * HEX * 0.87;
        const ang = hub.baseAngle + Math.PI / 2;
        const x = hubX + localX * Math.cos(ang) + Math.cos(hub.baseAngle) * localY;
        const y = hubY + localX * Math.sin(ang) + Math.sin(hub.baseAngle) * localY;
        n.baseRadius = Math.hypot(x, y);
        n.baseAngle = Math.atan2(y, x);
      });
    } else if (w.layout === "circle") {
      const clusterR = (16 + Math.sqrt(list.length) * 7.5) * cs;
      const centerR = RING.hubs + clusterR + 26;
      const gx = Math.cos(hub.baseAngle) * centerR;
      const gy = Math.sin(hub.baseAngle) * centerR;
      list.forEach((n, i) => {
        const rr = clusterR * Math.sqrt((i + 0.5) / list.length);
        const aa = i * 2.399963;
        const x = gx + Math.cos(aa) * rr;
        const y = gy + Math.sin(aa) * rr;
        n.baseRadius = Math.hypot(x, y);
        n.baseAngle = Math.atan2(y, x);
      });
    } else {
      const sector = TWO_PI / Math.max(1, w.hubs.length);
      const span = sector * 0.9;
      list.forEach((n, i) => {
        const tFrac = (i + 0.5) / list.length;
        const rr = (RING.filesInner + (RING.routines - 42 - RING.filesInner) * Math.pow(tFrac, 0.72)) * (0.82 + 0.36 * ((i * 0.618) % 1)) * (0.7 + 0.3 * cs);
        const aa = hub.baseAngle - span / 2 + span * ((i * 0.381966) % 1);
        n.baseRadius = Math.min(rr, RING.routines - 26);
        n.baseAngle = aa;
      });
    }
  }
}

/* ---------------------------------------------------------------------------
   Crafted canvas glyphs
--------------------------------------------------------------------------- */
function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, k: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.beginPath();
  const inner = size * 0.32;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TWO_PI - Math.PI / 2;
    const r = i % 2 === 0 ? size : inner;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff8ee";
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1, size * 0.16), 0, TWO_PI);
  ctx.fill();
  ctx.restore();
  void k;
}

function drawClock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  active: boolean,
  k: number,
  tNow: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = active ? 1 : 0.45;
  ctx.shadowColor = color;
  ctx.shadowBlur = active ? 14 : 4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 / Math.max(0.7, k);
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, TWO_PI);
  ctx.stroke();
  ctx.shadowBlur = 0;
  const minuteA = (tNow * 0.8) % TWO_PI;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(minuteA - Math.PI / 2) * size * 0.72, Math.sin(minuteA - Math.PI / 2) * size * 0.72);
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(minuteA / 12 - Math.PI / 2) * size * 0.45, Math.sin(minuteA / 12 - Math.PI / 2) * size * 0.45);
  ctx.stroke();
  ctx.restore();
}

function drawHexBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  label: string,
  official: boolean,
  active: boolean,
  k: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = active ? 1 : 0.72;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = Math.cos(a) * size;
    const py = Math.sin(a) * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#10131a";
  ctx.fill();
  ctx.shadowColor = color;
  ctx.shadowBlur = official ? 14 : 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 / Math.max(0.7, k);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.max(7, size * 0.62)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials(label), 0, 0.5);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "start";
  ctx.restore();
}

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

function drawFolderGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.fillStyle = color;
  const s = size;
  ctx.fillRect(0, s * 0.25, s, s * 0.55);
  ctx.fillRect(0, s * 0.12, s * 0.45, s * 0.2);
  ctx.restore();
}

const CORE_PIXELS = [
  "01111110",
  "01000010",
  "01011010",
  "01000010",
  "01100110",
  "01000010",
  "01111110",
  "00000000",
];
function drawPixelCore(
  ctx: CanvasRenderingContext2D,
  color: string,
  k: number,
  tNow: number,
  agentsActive: boolean,
): void {
  const px = 4.4 / Math.max(0.6, Math.min(k, 2));
  const half = (CORE_PIXELS.length * px) / 2;
  const pulse = tNow === 0 ? 0.5 : 0.4 + 0.25 * Math.sin(tNow * (agentsActive ? 5 : 2));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 1.6 / k;
  ctx.shadowColor = color;
  ctx.shadowBlur = agentsActive ? 30 : 18;
  ctx.beginPath();
  ctx.arc(0, 0, half + 13 / k, 0, TWO_PI);
  ctx.stroke();
  if (agentsActive) {
    ctx.globalAlpha = pulse * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, half + 22 / k, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  CORE_PIXELS.forEach((rowStr, row) => {
    for (let col = 0; col < rowStr.length; col++) {
      if (rowStr[col] === "1") {
        ctx.fillRect(col * px - half, row * px - half, px * 0.92, px * 0.92);
      }
    }
  });
  ctx.shadowBlur = 0;
  ctx.restore();
}


/* ---------------------------------------------------------------------------
   Accessible list view: the same nodes as the canvas, keyboard-navigable
   (audit item 43). Arrow keys move between files, Enter opens the preview.
--------------------------------------------------------------------------- */
function FileList({
  graph,
  groupOf,
  selectedId,
  onSelect,
  onClose,
}: {
  graph: GraphData;
  groupOf: (n: GraphNode) => string;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      if (needle && !n.name.toLowerCase().includes(needle) && !n.path.toLowerCase().includes(needle)) continue;
      const g = groupOf(n);
      const list = map.get(g) ?? [];
      list.push(n);
      map.set(g, list);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, nodes]) => ({ key, nodes: nodes.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 400) }));
  }, [graph, groupOf, filter]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-file]"));
    const idx = items.findIndex((b) => b === document.activeElement);
    const next = items[(idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <aside className="brain2-list" aria-label={t("brain.listView")}>
      <div className="brain2-list-head">
        <input className="input sm" placeholder={t("common.search")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("common.search")} />
        <button className="btn ghost sm" onClick={onClose} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div
        className="brain2-list-body"
        role="listbox"
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={t("brain.listView")}
        aria-activedescendant={selectedId != null ? `bl-${selectedId}` : undefined}
      >
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.key}>
            <div className="hud-label brain2-list-group">
              {g.key} <span className="count">{g.nodes.length}</span>
            </div>
            {g.nodes.map((n) => (
              <button
                key={n.id}
                id={`bl-${n.id}`}
                role="option"
                aria-selected={n.id === selectedId}
                data-file
                className={`brain2-list-item${n.id === selectedId ? " selected" : ""}`}
                onClick={() => onSelect(n.id)}
                title={n.path}
              >
                <span className="truncate">{n.name}</span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="widget-muted">{t("common.empty")}</p>}
      </div>
    </aside>
  );
}

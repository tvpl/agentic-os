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
import { ArrowLeft, Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { api, type GraphData, type GraphNode, type Connector, type RoutineStatus, type Skill } from "../api";
import { I18nContext, useT } from "../i18n";
import { formatBytes, timeAgo, useToast } from "../components/ui";
import { LAUNCHER_EVENT } from "../App";

/* ============================================================================
   Second Brain — the ARMS universe as a living map.
   Concentric structure: pixel ROUTER core → SKILLS ring (sparks) → MEMORY
   (area hubs with expandable file nebulas) → ROUTINES ring (clocks) →
   APPLICATIONS ring (hex badges). Canvas with additive glow; layouts change
   how the MEMORY nebulas are shaped. Everything on screen is real data.
============================================================================ */

type LayoutKind = "force" | "circle" | "hex" | "rings";
type ViewKind = "areas" | "folders";

interface FileNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
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
  const searchRef = useRef<HTMLInputElement>(null);
  const baked = useMemo(loadBaked, []);

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
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<Array<{ id: number; name: string; rel: string }>>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);

  const world = useRef({
    files: [] as FileNode[],
    edges: [] as Array<{ a: number; b: number }>,
    hubs: [] as Hub[],
    orbs: [] as OrbNode[],
    transform: { x: 0, y: 0, k: 1 },
    theta: 0,
    layout: baked.layout as LayoutKind,
    spin: baked.spin,
    nodeScale: baked.nodeScale,
    clusterSize: baked.clusterSize,
    filterGroup: null as string | null,
    matched: null as Set<number> | null,
    selectedId: null as number | null,
    showNames: baked.showNames,
    hoverKey: null as string | null,
    colorOf: new Map<string, string>(),
    sim: null as Simulation<FileNode, undefined> | null,
    linkSpring: baked.linkSpring,
    dirty: true,
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

    // structure orbs
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

  /* ---------- selection ---------- */
  const select = useCallback(async (node: FileNode | null) => {
    world.current.selectedId = node?.id ?? null;
    if (!node) {
      setPreview(null);
      return;
    }
    setPreview({ node, content: null, kind: "loading", message: null, related: [] });
    try {
      const [pv, rel] = await Promise.all([
        api.get<{ kind: string; content: string | null; message: string | null }>(
          `/api/memory/preview?p=${encodeURIComponent(node.path)}`,
        ),
        api.get<Array<{ file: { id: number; name: string }; why: string }>>(`/api/memory/related?id=${node.id}`),
      ]);
      setPreview({
        node,
        content: pv.content,
        kind: pv.kind,
        message: pv.message,
        related: rel.map((r) => ({ id: r.file.id, name: r.file.name, why: r.why })),
      });
    } catch (err) {
      setPreview({ node, content: null, kind: "error", message: (err as Error).message, related: [] });
    }
  }, []);

  const selectById = useCallback(
    (id: number) => {
      const node = world.current.files.find((n) => n.id === id);
      if (node) void select(node);
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

  const setAllExpanded = (expanded: boolean) => {
    const w = world.current;
    for (const hub of w.hubs) hub.expanded = expanded;
    layoutFiles(w);
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "");
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      // stars
      bc.fillStyle = "#efe9da";
      for (let i = 0; i < 220; i++) {
        bc.globalAlpha = 0.06 + rand() * 0.22;
        bc.fillRect(rand() * width, rand() * height, 1.2, 1.2);
      }
      bc.globalAlpha = 1;
      // faint hex lattice
      const hexR = 34;
      bc.strokeStyle = "rgba(240,230,210,0.03)";
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
      // center glow
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
      const tNow = now / 1000;
      if (!reduceMotion) w.theta += w.spin * dt * 0.45;

      const styles = getComputedStyle(document.documentElement);
      const accentCol = styles.getPropertyValue("--accent").trim() || "#f97316";
      const textDim = styles.getPropertyValue("--text-dim").trim() || "#b3aa96";
      const faint = styles.getPropertyValue("--text-faint").trim() || "#7d7462";

      ctx.clearRect(0, 0, cw, ch);
      if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, cw, ch);

      // advance files
      if (w.layout === "force") {
        w.sim?.tick();
      } else {
        const cos = Math.cos(w.theta);
        const sin = Math.sin(w.theta);
        for (const n of w.files) {
          const bx = Math.cos(n.baseAngle) * n.baseRadius;
          const by = Math.sin(n.baseAngle) * n.baseRadius;
          n.tx = bx * cos - by * sin;
          n.ty = bx * sin + by * cos;
          n.x += (n.tx - n.x) * Math.min(1, dt * 7);
          n.y += (n.ty - n.y) * Math.min(1, dt * 7);
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
      // orbit dots on outer rings
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

      // hub fan lines (expanded hubs with modest counts) + markdown links
      ctx.globalCompositeOperation = "lighter";
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
      if (w.edges.length > 0 && w.edges.length < 1500) {
        ctx.strokeStyle = accentCol;
        ctx.lineWidth = 0.9 / tr.k;
        ctx.globalAlpha = 0.3;
        ctx.setLineDash([5 / tr.k, 7 / tr.k]);
        ctx.lineDashOffset = reduceMotion ? 0 : -tNow * 8;
        ctx.beginPath();
        for (const e of w.edges) {
          const a = w.files[e.a];
          const b = w.files[e.b];
          if (!a || !b) continue;
          const mx = (a.x + b.x) / 2 * 0.82;
          const my = (a.y + b.y) / 2 * 0.82;
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(mx, my, b.x, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      // FILE particles (additive)
      let labelBudget = 240;
      for (const n of w.files) {
        const color = w.colorOf.get(n.group) ?? "#94a3b8";
        const hub = w.hubs.find((h) => h.key === n.group);
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
          ctx.globalCompositeOperation = "lighter";
        }
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // SKILL sparks
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
        // count badge
        ctx.font = `800 ${9 / tr.k}px ${styles.getPropertyValue("--mono") || "monospace"}`;
        ctx.fillStyle = faint;
        ctx.textAlign = "center";
        ctx.fillText(String(hub.count), hub.x, hub.y + rr + 11 / tr.k);
        // label
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

      // pixel core
      drawPixelCore(ctx, accentCol, tr.k, reduceMotion ? 0 : tNow);
      ctx.fillStyle = textDim;
      ctx.font = `800 ${11 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
      ctx.textAlign = "center";
      ctx.fillText("ROUTER.MD", 0, 36 / tr.k);
      ctx.textAlign = "start";

      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

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
      const tr = w.transform;
      const factor = e.deltaY < 0 ? 1.13 : 0.89;
      const k = Math.min(9, Math.max(0.3, tr.k * factor));
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const wx = (mx - tr.x) / tr.k;
      const wy = (my - tr.y) / tr.k;
      tr.k = k;
      tr.x = mx - wx * k;
      tr.y = my - wy * k;
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
        return;
      }
      const p = toWorld(e.clientX, e.clientY);
      const hit = hitTest(p.x, p.y);
      w.hoverKey = hit.hub ? `hub:${hit.hub.key}` : hit.orb ? `${hit.orb.kind}:${hit.orb.id}` : null;
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
        hit.hub.expanded = !hit.hub.expanded;
        layoutFiles(w);
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
    const onDblClick = () => {
      w.transform.x = 0;
      w.transform.y = 0;
      w.transform.k = 1;
    };
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
  }, [select, navigate, t]);

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
    <div className="brain2">
      <canvas ref={canvasRef} aria-label={t("brain.title")} role="img" />

      <div className="brain2-topbar">
        <div>
          <div className="brain2-brand">
            <span className="primary" style={{ color: "var(--accent)" }}>Mordomo</span>
            <span className="secondary">{t("brain.title")}</span>
          </div>
          <div className="brain2-brand"><span className="byline">{total.toLocaleString()} {t("brain.sub")}</span></div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn sm" onClick={refresh} disabled={refreshing} title={t("brain.refresh")}>
            {refreshing ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />}
          </button>
          <button className="os-chip" onClick={() => navigate("/")}>
            <ArrowLeft aria-hidden /> {t("os.backToOs")}
          </button>
          <button className="os-chip" onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
            ☰ {t("os.menu")}
          </button>
        </div>
      </div>

      <div className="brain2-panel">
        <input
          ref={searchRef}
          className="input"
          placeholder={`${t("brain.searchPh")} ( / )`}
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
        <div className="row">
          <button className="btn sm" onClick={() => setAllExpanded(true)}>{t("brain.expandAll")}</button>
          <button className="btn sm" onClick={() => setAllExpanded(false)}>{t("brain.collapseAll")}</button>
        </div>
        <div className="row">
          <button
            className="btn sm"
            onClick={() => {
              world.current.transform = { x: 0, y: 0, k: 1 };
              setFilterGroup(null);
              setQuery("");
              void select(null);
            }}
          >
            {t("brain.reset")}
          </button>
          <button className="btn sm outline-accent" onClick={bake}>{t("brain.bake")}</button>
        </div>
        {filterGroup && (
          <button className="btn sm outline-accent" onClick={() => setFilterGroup(null)}>
            <X aria-hidden /> {filterGroup}
          </button>
        )}
        {graph?.truncated && <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)" }}>{t("brain.truncated")}</p>}
      </div>

      {legendOpen && legend.length > 0 ? (
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
      ) : null}

      <div className="brain2-bottom-tag">{layoutLabels[layout]} · {view === "areas" ? t("brain.view.areas") : t("brain.view.folders")}</div>

      {hover && !preview && (
        <div className="brain2-tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.title}
          <div className="sub">{hover.sub}</div>
        </div>
      )}

      {preview && (
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
      // tight halo hugging the hub
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
        const x = hubX + localX * Math.cos(ang) - localY * Math.sin(ang) * 0 + Math.cos(hub.baseAngle) * localY;
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
      // rings (default): a nebula wedge sweeping outward from the hub —
      // the dense, organic look of the reference. Golden-angle spiral bounded
      // to the hub's sector between filesInner and the routines ring.
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
  // hands
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
function drawPixelCore(ctx: CanvasRenderingContext2D, color: string, k: number, tNow: number): void {
  const px = 4.4 / Math.max(0.6, Math.min(k, 2));
  const half = (CORE_PIXELS.length * px) / 2;
  const pulse = tNow === 0 ? 0.5 : 0.4 + 0.25 * Math.sin(tNow * 2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 1.6 / k;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, half + 13 / k, 0, TWO_PI);
  ctx.stroke();
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

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import { Copy, ExternalLink, RefreshCw, X } from "lucide-react";
import { api, type GraphData, type GraphNode } from "../api";
import { I18nContext, useT } from "../i18n";
import { formatBytes, timeAgo, useToast } from "../components/ui";

/* ============================================================================
   Second Brain 2.0 — full-bleed animated canvas map of the workspace.
   Layouts: Force · Circle · Hex · Rings (default). Views: Areas · Folders.
   Thousands of nodes at 60fps via cached glow sprites + spatial hit-grid.
============================================================================ */

type LayoutKind = "force" | "circle" | "hex" | "rings";
type ViewKind = "areas" | "folders";

interface BrainNode extends GraphNode {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
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
  baseRadius: number;
}

interface PreviewState {
  node: BrainNode;
  content: string | null;
  kind: string;
  message: string | null;
  related: Array<{ id: number; name: string; why: string }>;
}

const GROUP_COLORS = [
  "#c084fc", "#f472b6", "#fb923c", "#22d3ee",
  "#fde047", "#4ade80", "#a5b4fc", "#f87171",
  "#5eead4", "#fbbf24",
];

const TWO_PI = Math.PI * 2;

export default function SecondBrain() {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const toast = useToast();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [total, setTotal] = useState(0);
  const [layout, setLayout] = useState<LayoutKind>("rings");
  const [view, setView] = useState<ViewKind>("areas");
  const [spin, setSpin] = useState(0.15);
  const [showNames, setShowNames] = useState(false);
  const [linkSpring, setLinkSpring] = useState(0.04);
  const [nodeScale, setNodeScale] = useState(1);
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<Array<{ id: number; name: string; rel: string; snippet: string | null }>>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const [accent, setAccent] = useState("#f97316");

  // Mutable world shared with the render loop (avoids re-renders per frame).
  const world = useRef({
    nodes: [] as BrainNode[],
    edges: [] as Array<{ a: number; b: number }>, // indexes into nodes
    hubs: [] as Hub[],
    transform: { x: 0, y: 0, k: 1 },
    theta: 0,
    layout: "rings" as LayoutKind,
    spin: 0.15,
    nodeScale: 1,
    filterGroup: null as string | null,
    matched: null as Set<number> | null,
    selectedId: null as number | null,
    showNames: false,
    hoverId: null as number | null,
    hoverHub: null as string | null,
    colorOf: new Map<string, string>(),
    sim: null as Simulation<BrainNode, undefined> | null,
    linkSpring: 0.04,
  });

  /* ---------- data ---------- */
  const load = useCallback(async () => {
    const data = await api.get<GraphData>("/api/memory/graph?maxNodes=3000");
    setGraph(data);
    setTotal(data.totalFiles);
  }, []);

  useEffect(() => {
    void load().catch(() => setGraph({ nodes: [], edges: [], truncated: false, totalFiles: 0 }));
    setAccent(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f97316");
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  // FTS deep-search (content) results shown in the panel.
  useEffect(() => {
    if (!debounced.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    void api
      .get<Array<{ id: number; name: string; rel: string; snippet: string | null }>>(
        `/api/memory/search?q=${encodeURIComponent(debounced)}&limit=8`,
      )
      .then((res) => !cancelled && setHits(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  /* ---------- world building ---------- */
  const groupOf = useCallback(
    (n: GraphNode): string => {
      if (view === "areas") return n.area ?? "unsorted";
      const seg = n.rel.split(/[\\/]/)[0] ?? "";
      return n.rel.includes("/") || n.rel.includes("\\") ? seg : "(root)";
    },
    [view],
  );

  useEffect(() => {
    if (!graph) return;
    const w = world.current;
    const groups = new Map<string, number>();
    for (const n of graph.nodes) {
      const g = groupOf(n);
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    const groupKeys = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    w.colorOf = new Map(groupKeys.map((k, i) => [k, GROUP_COLORS[i % GROUP_COLORS.length]!]));

    const prev = new Map(w.nodes.map((n) => [n.id, n]));
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    w.nodes = graph.nodes.map((n) => {
      const old = prev.get(n.id);
      const group = groupOf(n);
      return {
        ...n,
        group,
        x: old?.x ?? (rand() - 0.5) * 100,
        y: old?.y ?? (rand() - 0.5) * 100,
        tx: 0,
        ty: 0,
        vx: 0,
        vy: 0,
        baseAngle: 0,
        baseRadius: 0,
        phase: rand() * TWO_PI,
        r: 2 + Math.min(3, Math.log10(Math.max(10, n.size)) - 1),
      };
    });
    const indexOf = new Map(w.nodes.map((n, i) => [n.id, i]));
    w.edges = graph.edges
      .filter((e) => e.kind === "markdown-link")
      .map((e) => ({ a: indexOf.get(e.source) ?? -1, b: indexOf.get(e.target) ?? -1 }))
      .filter((e) => e.a >= 0 && e.b >= 0);

    computeLayout(w, layout, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, view, groupOf]);

  // Push simple control state into the world ref.
  useEffect(() => {
    const w = world.current;
    w.spin = spin;
    w.nodeScale = nodeScale;
    w.showNames = showNames;
    w.filterGroup = filterGroup;
    w.linkSpring = linkSpring;
  }, [spin, nodeScale, showNames, filterGroup, linkSpring]);

  useEffect(() => {
    const w = world.current;
    w.layout = layout;
    computeLayout(w, layout, view);
  }, [layout, view]);

  // Search highlighting (name/path match on loaded nodes).
  useEffect(() => {
    const w = world.current;
    if (!debounced.trim()) {
      w.matched = null;
      return;
    }
    const q = debounced.toLowerCase();
    w.matched = new Set(
      w.nodes.filter((n) => n.name.toLowerCase().includes(q) || n.rel.toLowerCase().includes(q)).map((n) => n.id),
    );
  }, [debounced]);

  /* ---------- selection / preview ---------- */
  const select = useCallback(async (node: BrainNode | null) => {
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
      const node = world.current.nodes.find((n) => n.id === id);
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

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setQuery("");
        void select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  /* ---------- render loop ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = world.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sprites = new Map<string, HTMLCanvasElement>();
    let raf = 0;
    let last = performance.now();
    let running = true;

    const sprite = (color: string): HTMLCanvasElement => {
      let s = sprites.get(color);
      if (s) return s;
      s = document.createElement("canvas");
      s.width = 32;
      s.height = 32;
      const sc = s.getContext("2d")!;
      const g = sc.createRadialGradient(16, 16, 1, 16, 16, 15);
      g.addColorStop(0, color);
      g.addColorStop(0.35, color + "cc");
      g.addColorStop(1, color + "00");
      sc.fillStyle = g;
      sc.fillRect(0, 0, 32, 32);
      sprites.set(color, s);
      return s;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

      if (!reduceMotion) w.theta += w.spin * dt * 0.5;

      // Advance node positions.
      if (w.layout === "force") {
        w.sim?.tick(); // the simulation mutates n.x / n.y directly
      } else {
        const cos = Math.cos(w.theta);
        const sin = Math.sin(w.theta);
        for (const n of w.nodes) {
          const bx = Math.cos(n.baseAngle) * n.baseRadius;
          const by = Math.sin(n.baseAngle) * n.baseRadius;
          n.tx = bx * cos - by * sin;
          n.ty = bx * sin + by * cos;
          n.x += (n.tx - n.x) * Math.min(1, dt * 6);
          n.y += (n.ty - n.y) * Math.min(1, dt * 6);
        }
      }

      ctx.clearRect(0, 0, cw, ch);

      // Faint decorative outer rings (screen-space, centered).
      ctx.save();
      ctx.translate(cx + tr.x, cy + tr.y);
      ctx.scale(tr.k, tr.k);

      const styles = getComputedStyle(document.documentElement);
      const borderCol = styles.getPropertyValue("--border-strong").trim() || "#383225";
      const textDim = styles.getPropertyValue("--text-dim").trim() || "#a89f8d";
      const accentCol = styles.getPropertyValue("--accent").trim() || accent;

      if (w.layout !== "force") {
        ctx.strokeStyle = borderCol;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1 / tr.k;
        for (const rr of [Math.min(cw, ch) * 0.46, Math.min(cw, ch) * 0.52]) {
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, TWO_PI);
          ctx.stroke();
          // orbit markers
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * TWO_PI + w.theta * (rr % 2 === 0 ? 0.6 : -0.4);
            ctx.beginPath();
            ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.6 / tr.k, 0, TWO_PI);
            ctx.fillStyle = borderCol;
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      // Edges (markdown links).
      if (w.edges.length > 0 && w.edges.length < 1200) {
        ctx.strokeStyle = accentCol;
        ctx.lineWidth = 0.6 / tr.k;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        for (const e of w.edges) {
          const a = w.nodes[e.a];
          const b = w.nodes[e.b];
          if (!a || !b) continue;
          if (w.filterGroup && a.group !== w.filterGroup && b.group !== w.filterGroup) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Nodes.
      const tNow = now / 1000;
      let labelBudget = 260;
      for (const n of w.nodes) {
        const color = w.colorOf.get(n.group) ?? "#94a3b8";
        const dimByFilter = w.filterGroup !== null && n.group !== w.filterGroup;
        const dimBySearch = w.matched !== null && !w.matched.has(n.id);
        const selected = w.selectedId === n.id;
        const hovered = w.hoverId === n.id;
        let alpha = dimByFilter || dimBySearch ? 0.08 : 0.9;
        if (!reduceMotion && !dimByFilter && !dimBySearch) {
          alpha *= 0.75 + 0.25 * Math.sin(tNow * 1.4 + n.phase);
        }
        const boost = selected || hovered ? 1.9 : w.matched?.has(n.id) ? 1.5 : 1;
        const size = n.r * w.nodeScale * boost;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite(color), n.x - size * 2.2, n.y - size * 2.2, size * 4.4, size * 4.4);
        ctx.globalAlpha = Math.min(1, alpha + 0.1);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, TWO_PI);
        ctx.fill();

        const wantLabel =
          selected || hovered || (w.matched?.has(n.id) ?? false) ||
          ((w.showNames || tr.k > 1.7) && !dimByFilter && !dimBySearch && labelBudget > 0);
        if (wantLabel && labelBudget > 0) {
          labelBudget--;
          ctx.globalAlpha = selected || hovered ? 1 : 0.75;
          ctx.fillStyle = textDim;
          ctx.font = `${10 / tr.k}px ${styles.getPropertyValue("--mono") || "monospace"}`;
          ctx.fillText(n.name.length > 28 ? n.name.slice(0, 26) + "…" : n.name, n.x + size + 4 / tr.k, n.y + 3 / tr.k);
        }
      }
      ctx.globalAlpha = 1;

      // Hubs + centre (non-force layouts). Hubs rotate with their clusters.
      if (w.layout !== "force") {
        const cosT = Math.cos(w.theta);
        const sinT = Math.sin(w.theta);
        for (const hub of w.hubs) {
          const bx = Math.cos(hub.baseAngle) * hub.baseRadius;
          const by = Math.sin(hub.baseAngle) * hub.baseRadius;
          hub.x = bx * cosT - by * sinT;
          hub.y = bx * sinT + by * cosT;
          const active = w.filterGroup === hub.key || w.hoverHub === hub.key;
          ctx.beginPath();
          ctx.arc(hub.x, hub.y, active ? 11 : 8, 0, TWO_PI);
          ctx.fillStyle = hub.color;
          ctx.globalAlpha = active ? 1 : 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#00000055";
          ctx.lineWidth = 1.5 / tr.k;
          ctx.stroke();
          ctx.fillStyle = active ? accentCol : textDim;
          ctx.font = `700 ${11 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
          ctx.textAlign = "center";
          const label = hub.key.toUpperCase();
          ctx.fillText(label.length > 16 ? label.slice(0, 15) + "…" : label, hub.x, hub.y - 14 / tr.k);
          ctx.textAlign = "start";
        }
        drawPixelCore(ctx, accentCol, tr.k, reduceMotion ? 0 : tNow);
        ctx.fillStyle = textDim;
        ctx.font = `800 ${11 / tr.k}px ${styles.getPropertyValue("--font") || "sans-serif"}`;
        ctx.textAlign = "center";
        ctx.fillText("ROUTER.MD", 0, 34 / tr.k);
        ctx.textAlign = "start";
      }

      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [accent]);

  /* ---------- force simulation lifecycle ---------- */
  useEffect(() => {
    const w = world.current;
    w.sim?.stop();
    w.sim = null;
    if (layout !== "force" || !graph) return;
    const links = w.edges.map((e) => ({ source: w.nodes[e.a]!, target: w.nodes[e.b]! }));
    w.sim = forceSimulation(w.nodes)
      .force("charge", forceManyBody().strength(-26))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<BrainNode>((n) => n.r * 2.4))
      .force("link", forceLink(links).distance(46).strength(w.linkSpring * 10))
      .alphaDecay(0.008)
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

    const hitTest = (wx: number, wy: number): { node?: BrainNode; hub?: Hub } => {
      const tol = 10 / w.transform.k;
      for (const hub of w.hubs) {
        if (Math.hypot(wx - hub.x, wy - hub.y) < 16) return { hub };
      }
      let best: BrainNode | undefined;
      let bestD = tol * tol;
      for (const n of w.nodes) {
        const dx = wx - n.x;
        const dy = wy - n.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return { node: best };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const tr = w.transform;
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const k = Math.min(8, Math.max(0.3, tr.k * factor));
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
      w.hoverId = hit.node?.id ?? null;
      w.hoverHub = hit.hub?.key ?? null;
      if (hit.hub) {
        setHover({ x: p.sx + 14, y: p.sy + 10, title: hit.hub.key, sub: `${hit.hub.count} files — click to filter` });
      } else if (hit.node) {
        setHover({ x: p.sx + 14, y: p.sy + 10, title: hit.node.name, sub: hit.node.group });
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
        setFilterGroup((cur) => (cur === hit.hub!.key ? null : hit.hub!.key));
      } else if (hit.node) {
        void select(hit.node);
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
  }, [select]);

  /* ---------- derived ---------- */
  const legend = useMemo(() => {
    if (!graph) return [];
    const counts = new Map<string, number>();
    for (const n of graph.nodes) {
      const g = groupOf(n);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
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
        <button className="btn sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />} {t("brain.refresh")}
        </button>
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
              <button
                key={h.id}
                className="microapp-row"
                style={{ padding: "5px 6px" }}
                onClick={() => selectById(h.id)}
              >
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
              <button key={k} className={layout === k ? "active" : ""} onClick={() => setLayout(k)}>
                {layoutLabels[k]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="hud-label" style={{ marginBottom: 6 }}>{t("brain.view")}</div>
          <div className="segmented sm" role="group" aria-label={t("brain.view")}>
            <button className={view === "areas" ? "active" : ""} onClick={() => { setView("areas"); setFilterGroup(null); }}>
              {t("brain.view.areas")}
            </button>
            <button className={view === "folders" ? "active" : ""} onClick={() => { setView("folders"); setFilterGroup(null); }}>
              {t("brain.view.folders")}
            </button>
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
          <div className="hud-label">{t("brain.nodeSize")}</div>
          <div className="slider-row">
            <input type="range" min={0.4} max={2} step={0.05} value={nodeScale} onChange={(e) => setNodeScale(Number(e.target.value))} aria-label={t("brain.nodeSize")} />
            <span className="val">{nodeScale.toFixed(2)}</span>
          </div>
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
          {filterGroup && (
            <button className="btn sm outline-accent" onClick={() => setFilterGroup(null)}>
              <X aria-hidden /> {filterGroup}
            </button>
          )}
        </div>
        {graph?.truncated && <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)" }}>{t("brain.truncated")}</p>}
      </div>

      {legend.length > 0 && (
        <div className="brain2-legend" aria-label={t("brain.legend")}>
          <div className="hud-label" style={{ marginBottom: 6 }}>{t("brain.legend")}</div>
          {legend.slice(0, 9).map((l) => (
            <div className="lg-row" key={l.key}>
              <button
                onClick={() => setFilterGroup((cur) => (cur === l.key ? null : l.key))}
                aria-pressed={filterGroup === l.key}
                style={{ opacity: filterGroup && filterGroup !== l.key ? 0.4 : 1, width: "100%" }}
              >
                <span className="dot" style={{ background: l.color, boxShadow: `0 0 6px ${l.color}` }} />
                <span className="truncate" style={{ maxWidth: 110 }}>{l.key}</span>
                <span className="count">{l.count}</span>
              </button>
            </div>
          ))}
        </div>
      )}

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
                  <button className="btn ghost sm" style={{ padding: "2px 6px" }} onClick={() => selectById(r.id)}>
                    {r.name}
                  </button>
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

/* ---------- layout computation (base polar coordinates per node) ---------- */
function computeLayout(
  w: {
    nodes: BrainNode[];
    hubs: Hub[];
    colorOf: Map<string, string>;
  },
  layout: LayoutKind,
  _view: ViewKind,
): void {
  const groups = new Map<string, BrainNode[]>();
  for (const n of w.nodes) {
    const list = groups.get(n.group) ?? [];
    list.push(n);
    groups.set(n.group, list);
  }
  const groupKeys = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k]) => k);
  const G = Math.max(1, groupKeys.length);
  const totalN = Math.max(1, w.nodes.length);

  w.hubs = groupKeys.map((key, gi) => ({
    key,
    color: w.colorOf.get(key) ?? "#94a3b8",
    count: groups.get(key)?.length ?? 0,
    x: 0,
    y: 0,
    baseAngle: (gi / G) * TWO_PI - Math.PI / 2,
    baseRadius: 120,
  }));

  if (layout === "force") {
    // Seed cluster-ish start positions; the simulation takes it from here.
    groupKeys.forEach((key, gi) => {
      const angle = (gi / G) * TWO_PI;
      const list = groups.get(key)!;
      list.forEach((n, i) => {
        n.x = Math.cos(angle) * 160 + (i % 17) * 6 - 48;
        n.y = Math.sin(angle) * 160 + Math.floor(i / 17) * 6 - 48;
      });
    });
    return;
  }

  if (layout === "rings") {
    // Reference look: hubs on an inner ring; each group's files fan outwards in
    // its angular sector across expanding arc bands. Recent files sit closer.
    groupKeys.forEach((key, gi) => {
      const list = groups.get(key)!.slice().sort((a, b) => b.mtime - a.mtime);
      const sector = TWO_PI / G;
      const a0 = gi * sector - Math.PI / 2 + sector * 0.08;
      const span = sector * 0.84;
      const hub = w.hubs.find((h) => h.key === key);
      if (hub) {
        hub.baseAngle = a0 + span / 2;
        hub.baseRadius = 120;
      }
      const perBand = Math.max(6, Math.ceil(span * 170 / 14));
      list.forEach((n, i) => {
        const band = Math.floor(i / perBand);
        const posInBand = i % perBand;
        const bandCount = Math.min(perBand, list.length - band * perBand);
        n.baseRadius = 170 + band * 16 + (i % 3) * 3;
        n.baseAngle = a0 + (bandCount <= 1 ? span / 2 : (posInBand / (bandCount - 1)) * span);
      });
    });
  } else if (layout === "circle") {
    // Each group is a packed disc arranged around the centre.
    const ringR = Math.max(200, 60 * Math.sqrt(G) + 120);
    groupKeys.forEach((key, gi) => {
      const list = groups.get(key)!;
      const angle = (gi / G) * TWO_PI - Math.PI / 2;
      const gx = Math.cos(angle) * ringR;
      const gy = Math.sin(angle) * ringR;
      const clusterR = 14 + Math.sqrt(list.length) * 7;
      list.forEach((n, i) => {
        const rr = clusterR * Math.sqrt((i + 0.5) / list.length);
        const aa = i * 2.399963; // golden angle spiral
        const x = gx + Math.cos(aa) * rr;
        const y = gy + Math.sin(aa) * rr;
        n.baseRadius = Math.hypot(x, y);
        n.baseAngle = Math.atan2(y, x);
      });
      const hub = w.hubs.find((h) => h.key === key);
      if (hub) {
        hub.baseRadius = ringR;
        hub.baseAngle = angle;
      }
    });
  } else {
    // Hex: nodes snapped to a hex lattice, groups in wedges from the centre.
    const HEX = 16;
    groupKeys.forEach((key, gi) => {
      const list = groups.get(key)!;
      const sector = TWO_PI / G;
      const midAngle = gi * sector - Math.PI / 2;
      const cols = Math.max(3, Math.ceil(Math.sqrt(list.length) * 1.2));
      list.forEach((n, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const localX = (col - cols / 2) * HEX + (row % 2 ? HEX / 2 : 0);
        const localY = 120 + row * HEX * 0.87;
        // rotate the wedge into place
        const x = localX * Math.cos(midAngle + Math.PI / 2) - localY * Math.sin(midAngle + Math.PI / 2);
        const y = localX * Math.sin(midAngle + Math.PI / 2) + localY * Math.cos(midAngle + Math.PI / 2);
        n.baseRadius = Math.hypot(x, y);
        n.baseAngle = Math.atan2(y, x);
      });
      const hub = w.hubs.find((h) => h.key === key);
      if (hub) {
        hub.baseRadius = 96;
        hub.baseAngle = midAngle;
      }
    });
  }
  void totalN;
}

/* Pixel-art centre glyph (a tiny document/robot mark) drawn on canvas. */
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
  const px = 4 / Math.max(0.6, Math.min(k, 2));
  const half = (CORE_PIXELS.length * px) / 2;
  const pulse = tNow === 0 ? 0.5 : 0.4 + 0.2 * Math.sin(tNow * 2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 1.5 / k;
  ctx.beginPath();
  ctx.arc(0, 0, half + 12 / k, 0, TWO_PI);
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
  ctx.restore();
}

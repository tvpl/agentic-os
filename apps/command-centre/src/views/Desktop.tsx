import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Activity,
  BrainCircuit,
  CalendarClock,
  FileCode,
  FileImage,
  FileText,
  Grid3x3,
  Info,
  LayoutGrid,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  api,
  type ArtifactEntry,
  type Meta,
  type Metrics,
  type ModelishOption,
  type ProviderId,
  type ProviderSnapshot,
  type RoutineStatus,
  type RunRecord,
  type Skill,
} from "../api";
import { I18nContext, useT } from "../i18n";
import { Loading, Modal, StatusBadge, formatDuration, timeAgo, useApi, useToast } from "../components/ui";
import { LAUNCHER_EVENT } from "../App";

/* ============================================================================
   The OS desktop: a fullscreen surface. The particle core + artifact orbit is
   the wallpaper; widgets float above it on a 24-column grid and can be
   dragged, resized and hidden in edit mode. Layout persists in settings.
============================================================================ */

const COLS = 24;
const GRID_TOP = 96;
const GRID_PAD = 16;

interface WidgetBox {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}
type LayoutMap = Record<string, WidgetBox>;

const DEFAULT_LAYOUT: LayoutMap = {
  microapps: { x: 0, y: 0, w: 5, h: 6, visible: true },
  today: { x: 0, y: 6, w: 5, h: 7, visible: true },
  workspace: { x: 0, y: 13, w: 5, h: 4, visible: true },
  deck: { x: 19, y: 0, w: 5, h: 9, visible: true },
  routines: { x: 19, y: 9, w: 5, h: 4, visible: true },
  pulse: { x: 19, y: 13, w: 5, h: 4, visible: true },
  attention: { x: 6, y: 14, w: 12, h: 3, visible: true },
};

interface DashData {
  providers: ProviderSnapshot[];
  skills: Skill[];
  routines: RoutineStatus[];
  artifacts: ArtifactEntry[];
  runs: RunRecord[];
  metrics: Metrics;
  layout: LayoutMap;
  facetsTotal: number;
  areas: Array<{ area: string; count: number }>;
}

export default function Desktop({ meta }: { meta: Meta }) {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const [editMode, setEditMode] = useState(false);
  const [matrixFor, setMatrixFor] = useState<Skill | null>(null);

  const { data, loading, reload } = useApi<DashData>(async () => {
    const [providers, skills, routines, artifacts, runs, metrics, settings, memStatus] = await Promise.all([
      api.get<ProviderSnapshot[]>("/api/providers"),
      api.get<Skill[]>("/api/skills"),
      api.get<RoutineStatus[]>("/api/routines"),
      api.get<ArtifactEntry[]>("/api/artifacts/recent?limit=22"),
      api.get<RunRecord[]>("/api/runs?limit=200"),
      api.get<Metrics>("/api/metrics"),
      api.get<{ dashboardLayout: LayoutMap }>("/api/settings"),
      api.get<{ facets: { total: number; areas: Array<{ area: string; count: number }> } }>("/api/memory/status"),
    ]);
    return {
      providers,
      skills,
      routines,
      artifacts,
      runs,
      metrics,
      layout: settings.dashboardLayout ?? {},
      facetsTotal: memStatus.facets.total,
      areas: memStatus.facets.areas,
    };
  });

  const [layout, setLayout] = useState<LayoutMap>(DEFAULT_LAYOUT);
  useEffect(() => {
    if (data) setLayout({ ...DEFAULT_LAYOUT, ...data.layout });
  }, [data]);

  const persistLayout = useCallback((next: LayoutMap) => {
    setLayout(next);
    void api.put("/api/settings", { dashboardLayout: next }).catch(() => undefined);
  }, []);

  const switchDefault = async (provider: ProviderId) => {
    try {
      await api.put("/api/providers/default", { provider });
      reload();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const runSkill = async (skill: Skill) => {
    if (skill.inputs.some((i) => i.required)) {
      navigate(`/skills/${skill.slug}`);
      return;
    }
    try {
      const res = await api.post<{ runId: string }>(`/api/skills/${skill.slug}/run`, { inputs: {} });
      toast(`▶ /${skill.slug}`, "ok");
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  if (loading && !data) return <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Loading /></div>;
  if (!data) return null;

  const widgets: Record<string, { title: string; icon: ReactNode; node: ReactNode }> = {
    microapps: { title: t("dash.microapps"), icon: <Grid3x3 aria-hidden />, node: <MicroAppsWidget /> },
    today: { title: t("dash.clock"), icon: <CalendarClock aria-hidden />, node: <TodayWidget routines={data.routines} /> },
    workspace: {
      title: t("widget.workspace"),
      icon: <BrainCircuit aria-hidden />,
      node: <WorkspaceWidget total={data.facetsTotal} areas={data.areas} />,
    },
    deck: {
      title: t("dash.deck"),
      icon: <Sparkles aria-hidden />,
      node: <DeckWidget skills={data.skills} onRun={runSkill} onConfig={setMatrixFor} />,
    },
    routines: { title: t("dash.board"), icon: <CalendarClock aria-hidden />, node: <BoardWidget routines={data.routines} runs={data.runs} /> },
    pulse: { title: t("widget.pulse"), icon: <Activity aria-hidden />, node: <PulseWidget metrics={data.metrics} runs={data.runs} /> },
    attention: { title: t("dash.attention"), icon: <AlertTriangle aria-hidden />, node: <AttentionWidget routines={data.routines} runs={data.runs} /> },
  };

  return (
    <div className={`desktop${editMode ? " edit-mode" : ""}`}>
      <OrbitalCore
        artifacts={data.artifacts}
        onOpenBrain={() => navigate("/brain")}
        onOpenRun={(runId) => navigate(`/runs/${runId}`)}
      />

      {/* topbar */}
      <div className="os-topbar">
        <div className="side">
          <span className="dot ok" aria-hidden />
          <span className="hud-label">
            {t("dash.activeProvider")}:{" "}
            <span style={{ color: "var(--accent)" }}>{data.providers.find((p) => p.isDefault)?.id ?? "—"}</span>
          </span>
        </div>
        <div className="os-brand">
          <div className="line1">
            <span className="brand-mark" aria-hidden>{meta.name.charAt(0).toUpperCase()}</span>
            <span className="name">
              <span className="accent">{meta.name.replace(/\s*os$/i, "")}</span> <span style={{ fontWeight: 400 }}>Agentic OS</span>
            </span>
          </div>
          <div className="byline">{t("dash.brainSub")}</div>
          <div className="os-tools">
            <button
              className={`os-tool${editMode ? " active" : ""}`}
              onClick={() => setEditMode((v) => !v)}
              aria-pressed={editMode}
              aria-label={t("os.edit")}
              title={t("os.edit")}
            >
              <Pencil aria-hidden />
            </button>
            <button className="os-tool" onClick={() => navigate("/brain")} aria-label={t("common.search")} title={`${t("nav.brain")} ( / )`}>
              <Search aria-hidden />
            </button>
            <button
              className="os-tool"
              onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}
              aria-label={t("os.menu")}
              title={`${t("os.menu")} (Ctrl/⌘ M)`}
            >
              <LayoutGrid aria-hidden />
            </button>
            <button className="os-tool" onClick={() => navigate("/settings")} aria-label={t("nav.settings")} title={t("nav.settings")}>
              <Info aria-hidden />
            </button>
          </div>
        </div>
        <div className="side right">
          <div className="segmented sm" role="group" aria-label={t("dash.providers")}>
            {data.providers.map((p) => (
              <button
                key={p.id}
                className={p.isDefault ? "active" : ""}
                disabled={!p.enabled}
                onClick={() => !p.isDefault && p.enabled && switchDefault(p.id)}
                title={p.enabled ? p.id : t("common.disabled")}
              >
                <span className={`dot ${p.enabled ? (p.health.ok ? "ok" : p.health.installed ? "warn" : "danger") : "dim"}`} style={{ marginRight: 5 }} />
                {p.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* widget layer */}
      <WidgetLayer
        layout={layout}
        widgets={widgets}
        editMode={editMode}
        onLayoutChange={persistLayout}
      />

      {editMode && (
        <div className="edit-bar">
          <span className="hud-label" style={{ fontSize: 10 }}>{t("os.editHint")}</span>
          {Object.entries(layout)
            .filter(([id, box]) => !box.visible && widgets[id])
            .map(([id, box]) => (
              <button
                key={id}
                className="btn sm outline-accent"
                onClick={() => persistLayout({ ...layout, [id]: { ...box, visible: true } })}
              >
                <Plus aria-hidden /> {widgets[id]!.title}
              </button>
            ))}
          <button className="btn sm" onClick={() => persistLayout(DEFAULT_LAYOUT)}>{t("os.resetLayout")}</button>
          <button className="btn sm primary" onClick={() => setEditMode(false)}>{t("os.done")}</button>
        </div>
      )}

      {matrixFor && (
        <ModelEffortMatrix
          skill={matrixFor}
          providers={data.providers}
          onClose={() => setMatrixFor(null)}
          onSaved={() => {
            setMatrixFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Widget layer: grid math, drag, resize.
--------------------------------------------------------------------------- */
function WidgetLayer({
  layout,
  widgets,
  editMode,
  onLayoutChange,
}: {
  layout: LayoutMap;
  widgets: Record<string, { title: string; icon: ReactNode; node: ReactNode }>;
  editMode: boolean;
  onLayoutChange: (next: LayoutMap) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; px: number; py: number; box: WidgetBox } | null>(null);
  const [ghost, setGhost] = useState<WidgetBox | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cellW = (size.w - GRID_PAD * 2) / COLS;
  const rows = Math.max(12, Math.floor((size.h - GRID_TOP - GRID_PAD) / 44));
  const cellH = (size.h - GRID_TOP - GRID_PAD) / rows;

  useEffect(() => {
    document.documentElement.style.setProperty("--cell-w", `${cellW}px`);
    document.documentElement.style.setProperty("--cell-h", `${cellH}px`);
  }, [cellW, cellH]);

  const toPx = (box: WidgetBox) => ({
    left: GRID_PAD + box.x * cellW,
    top: GRID_TOP + box.y * cellH,
    width: box.w * cellW - 8,
    height: box.h * cellH - 8,
  });

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      if (drag.mode === "move") {
        const nx = Math.round(drag.box.x + dx / cellW);
        const ny = Math.round(drag.box.y + dy / cellH);
        setGhost({
          ...drag.box,
          x: Math.max(0, Math.min(COLS - drag.box.w, nx)),
          y: Math.max(0, Math.min(rows - 2, ny)),
        });
      } else {
        const nw = Math.round(drag.box.w + dx / cellW);
        const nh = Math.round(drag.box.h + dy / cellH);
        setGhost({
          ...drag.box,
          w: Math.max(3, Math.min(COLS - drag.box.x, nw)),
          h: Math.max(2, Math.min(rows - drag.box.y, nh)),
        });
      }
    };
    const onUp = () => {
      if (ghost) onLayoutChange({ ...layout, [drag.id]: ghost });
      setDrag(null);
      setGhost(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, ghost, cellW, cellH, rows, layout, onLayoutChange]);

  return (
    <div className="desktop-widgets" ref={ref}>
      {Object.entries(widgets).map(([id, widget]) => {
        const box = drag?.id === id && ghost ? ghost : layout[id];
        if (!box || !box.visible) return null;
        const px = toPx(box);
        return (
          <section
            key={id}
            className={`widget${editMode ? " editing" : ""}${drag?.id === id ? " dragging" : ""}`}
            style={px}
            aria-label={widget.title}
            onPointerDown={(e) => {
              if (!editMode) return;
              const target = e.target as HTMLElement;
              if (target.closest(".widget-resize") || target.closest(".widget-hide")) return;
              e.preventDefault();
              setDrag({ id, mode: "move", px: e.clientX, py: e.clientY, box });
              setGhost(box);
            }}
          >
            <div className="widget-inner">
              <h2>{widget.icon} {widget.title}</h2>
              {widget.node}
            </div>
            {editMode && (
              <>
                <span className="widget-grip" aria-hidden>⠿</span>
                <button
                  className="widget-hide"
                  aria-label={`✕ ${widget.title}`}
                  onClick={() => onLayoutChange({ ...layout, [id]: { ...box, visible: false } })}
                >
                  ✕
                </button>
                <span
                  className="widget-resize"
                  role="slider"
                  aria-label={`resize ${widget.title}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDrag({ id, mode: "resize", px: e.clientX, py: e.clientY, box });
                    setGhost(box);
                  }}
                />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Wallpaper: particle core + orbit of recent artifacts/files (additive glow).
--------------------------------------------------------------------------- */
const TWO_PI = Math.PI * 2;
const AREA_COLORS = ["#c084fc", "#f472b6", "#fb923c", "#22d3ee", "#fde047", "#4ade80", "#a5b4fc"];

function OrbitalCore({
  artifacts,
  onOpenBrain,
  onOpenRun,
}: {
  artifacts: ArtifactEntry[];
  onOpenBrain: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [recentFiles, setRecentFiles] = useState<Array<{ name: string; mtime: number }>>([]);
  const [chips, setChips] = useState<
    Array<{ key: string; label: string; ts: number; kind: "artifact" | "file"; runId: string | null; left: number; top: number }>
  >([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let alive = true;
    let points: Array<{ x: number; y: number; z: number; c: string; p: number }> = [];
    let stars: Array<{ x: number; y: number; a: number; p: number }> = [];

    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand(), a: 0.1 + rand() * 0.4, p: rand() * TWO_PI }));

    void api
      .get<{ nodes: Array<{ area: string | null; name: string; mtime: number }> }>("/api/memory/graph?maxNodes=700")
      .then((g) => {
        setRecentFiles(
          g.nodes.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 18).map((n) => ({ name: n.name, mtime: n.mtime })),
        );
        const areas = [...new Set(g.nodes.map((n) => n.area ?? "•"))];
        const colorOf = new Map(areas.map((a, i) => [a, AREA_COLORS[i % AREA_COLORS.length]!]));
        const MIN_POINTS = 620;
        const source =
          g.nodes.length > 0
            ? Array.from({ length: Math.max(MIN_POINTS, g.nodes.length) }, (_, i) => g.nodes[i % g.nodes.length]!)
            : [];
        points = source.map((n) => {
          const u = rand();
          const r = 86 * Math.cbrt(u) + rand() * 18;
          const theta = rand() * TWO_PI;
          const phi = Math.acos(2 * rand() - 1);
          return {
            x: r * Math.sin(phi) * Math.cos(theta),
            y: r * Math.sin(phi) * Math.sin(theta) * 0.82,
            z: r * Math.cos(phi),
            c: colorOf.get(n.area ?? "•") ?? "#94a3b8",
            p: rand() * TWO_PI,
          };
        });
        if (points.length === 0) {
          points = Array.from({ length: 90 }, () => ({
            x: (rand() - 0.5) * 100,
            y: (rand() - 0.5) * 80,
            z: (rand() - 0.5) * 100,
            c: "#6b6350",
            p: rand() * TWO_PI,
          }));
        }
      })
      .catch(() => undefined);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const frame = (now: number) => {
      if (!alive) return;
      const rect = wrap.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height * 0.54;
      const tSec = now / 1000;
      const rot = reduceMotion ? 0.6 : tSec * 0.13;
      ctx.clearRect(0, 0, rect.width, rect.height);

      // starfield
      ctx.fillStyle = "#efe9da";
      for (const s of stars) {
        const tw = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(tSec * 0.9 + s.p);
        ctx.globalAlpha = s.a * tw * 0.5;
        ctx.fillRect(s.x * rect.width, s.y * rect.height, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;

      const styles = getComputedStyle(document.documentElement);
      // wireframe polyhedron
      ctx.strokeStyle = styles.getPropertyValue("--border-strong").trim() || "#403a26";
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.7;
      const R = Math.min(rect.width, rect.height) * 0.36;
      const verts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TWO_PI + rot * 0.22;
        verts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.92]);
      }
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        for (let j = i + 1; j < verts.length; j++) {
          if ((i + j) % 3 === 0) {
            ctx.moveTo(verts[i]![0], verts[i]![1]);
            ctx.lineTo(verts[j]![0], verts[j]![1]);
          }
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // particle ball — additive blending for the bright, luminous look
      ctx.globalCompositeOperation = "lighter";
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      for (const pt of points) {
        const x = pt.x * cos - pt.z * sin;
        const z = pt.x * sin + pt.z * cos;
        const depth = (z + 120) / 240;
        const px = cx + x * 1.2;
        const py = cy + pt.y * 1.2;
        const twinkle = reduceMotion ? 0.9 : 0.6 + 0.4 * Math.sin(tSec * 1.7 + pt.p);
        ctx.globalAlpha = Math.max(0.1, (0.3 + depth * 0.7) * twinkle) * 0.85;
        ctx.fillStyle = pt.c;
        const sizePt = 1.4 + depth * 2.3;
        ctx.fillRect(px - sizePt / 2, py - sizePt / 2, sizePt, sizePt);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const place = () => {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height * 0.54;
      const R = Math.min(rect.width * 0.62, rect.height * 0.92) * 0.46;
      const seen = new Set<string>();
      const combined: Array<{ key: string; label: string; ts: number; kind: "artifact" | "file"; runId: string | null }> = [];
      for (const a of artifacts) {
        const key = `a-${a.runId}-${a.file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push({ key, label: a.file, ts: a.createdAt, kind: "artifact", runId: a.runId });
      }
      for (const f of recentFiles) {
        if (combined.length >= 22) break;
        const key = `f-${f.name}-${f.mtime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push({ key, label: f.name, ts: f.mtime, kind: "file", runId: null });
      }
      const n = combined.length;
      setChips(
        combined.map((chip, i) => {
          const a = Math.PI * (0.56 + (1.88 * i) / Math.max(1, n - 1));
          return { ...chip, left: cx + Math.cos(a) * R, top: cy + Math.sin(a) * R * 0.86 };
        }),
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [artifacts, recentFiles]);

  return (
    <div className="desktop-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <button
        className="orbital-core-btn"
        style={{ top: "54%" }}
        onClick={onOpenBrain}
        aria-label={t("dash.brainCta")}
        title={t("dash.brainCta")}
      />
      {chips.map((chip) => (
        <button
          key={chip.key}
          className="orbit-chip"
          style={{ left: chip.left, top: chip.top, opacity: chip.kind === "file" ? 0.85 : 1 }}
          onClick={() => (chip.runId ? onOpenRun(chip.runId) : onOpenBrain())}
          onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: chip.label, sub: timeAgo(chip.ts, lang) })}
          onMouseLeave={() => setTip(null)}
          aria-label={chip.label}
        >
          <span className="day-tag">{ageTag(chip.ts)}</span>
          {chipIcon(chip.label)}
        </button>
      ))}
      {tip && wrapRef.current && (
        <div
          className="orbit-tooltip"
          style={{
            left: tip.x - wrapRef.current.getBoundingClientRect().left + 12,
            top: tip.y - wrapRef.current.getBoundingClientRect().top + 12,
          }}
        >
          {tip.text}
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{tip.sub}</div>
        </div>
      )}
    </div>
  );
}

function ageTag(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return "1D";
  if (days < 14) return `${days}D`;
  return `${Math.floor(days / 7)}W`;
}

function chipIcon(file: string) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "svg", "gif", "webp"].includes(ext)) return <FileImage aria-hidden />;
  if (["ts", "tsx", "js", "py", "sh", "json", "html", "css"].includes(ext)) return <FileCode aria-hidden />;
  return <FileText aria-hidden />;
}

/* ---------------------------------------------------------------------------
   Widgets (all real data)
--------------------------------------------------------------------------- */
function MicroAppsWidget() {
  const t = useT();
  return (
    <>
      <Link className="microapp-row" to="/brain">
        <span className="ma-icon"><BrainCircuit aria-hidden /></span>
        <span style={{ minWidth: 0 }}>
          <span className="ma-name" style={{ display: "block" }}>{t("nav.brain")}</span>
          <span className="ma-desc">{t("microapp.brain.desc")}</span>
        </span>
        <span className="ma-arrow">→</span>
      </Link>
      <Link className="microapp-row" to="/pixel">
        <span className="ma-icon"><Grid3x3 aria-hidden /></span>
        <span style={{ minWidth: 0 }}>
          <span className="ma-name" style={{ display: "block" }}>{t("nav.pixel")}</span>
          <span className="ma-desc">{t("microapp.pixel.desc")}</span>
        </span>
        <span className="ma-arrow">→</span>
      </Link>
      <Link className="microapp-row" to="/connectors">
        <span className="ma-icon" style={{ background: "transparent", color: "var(--text-faint)" }}><Plus aria-hidden /></span>
        <span style={{ minWidth: 0 }}>
          <span className="ma-name" style={{ display: "block", color: "var(--text-dim)" }}>{t("conn.title")}</span>
          <span className="ma-desc">{t("microapp.notConfigured")}</span>
        </span>
        <span className="ma-arrow">→</span>
      </Link>
    </>
  );
}

function TodayWidget({ routines }: { routines: RoutineStatus[] }) {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const week = isoWeek(now);
  const dateLine = now.toLocaleDateString(lang, { month: "short", day: "2-digit", year: "numeric", weekday: "short" });
  const upcoming = routines
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 3);
  return (
    <>
      <div className="hud-label" style={{ color: "var(--accent)" }}>Wk{week} | {dateLine}</div>
      <div className="display-digits clock-time" role="timer">
        {now.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
      <div className="clock-zones">
        <div className="zone">
          <div className="z-time">{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</div>
          <div className="z-label">UTC</div>
        </div>
        {routines[0]?.timezone && routines[0].timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
          <div className="zone">
            <div className="z-time">
              {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: routines[0].timezone })}
            </div>
            <div className="z-label">{routines[0].timezone.split("/").pop()?.replace("_", " ")}</div>
          </div>
        )}
      </div>
      <QuarterDots now={now} />
      <div className="hud-label" style={{ margin: "12px 0 4px" }}>{t("dash.whatsNext")}</div>
      {upcoming.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-faint)" }}>{t("dash.noNext")}</p>
      ) : (
        upcoming.map((r) => (
          <div className="list-row" key={r.id} style={{ padding: "5px 0" }}>
            <Link to="/routines" className="truncate" style={{ color: "var(--text)", fontSize: 13 }}>{r.name}</Link>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>
              {r.nextRunAt ? new Date(r.nextRunAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>
        ))
      )}
    </>
  );
}

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function QuarterDots({ now }: { now: Date }) {
  const week = isoWeek(now);
  return (
    <div className="q-dots" aria-hidden>
      {[0, 1, 2, 3].map((q) => (
        <div className="q-row" key={q}>
          <span className="q-label">Q{q + 1}</span>
          {Array.from({ length: 13 }, (_, i) => {
            const w = q * 13 + i + 1;
            return <span key={i} className={`qd ${w === week ? "now" : w < week ? "past" : ""}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

function WorkspaceWidget({ total, areas }: { total: number; areas: Array<{ area: string; count: number }> }) {
  const t = useT();
  const max = Math.max(1, ...areas.map((a) => a.count));
  return (
    <>
      <div className="stat" style={{ marginBottom: 8 }}>
        <span className="value accented">{total.toLocaleString()}</span>
        <span className="label">{t("widget.filesIndexed")}</span>
      </div>
      {areas.slice(0, 4).map((a, i) => (
        <div key={a.area} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
          <span className="hud-label" style={{ fontSize: 9.5, width: 76, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.area}</span>
          <span style={{ display: "flex", gap: 3 }}>
            {Array.from({ length: Math.max(1, Math.round((a.count / max) * 14)) }, (_, d) => (
              <span
                key={d}
                style={{
                  width: 7, height: 7, borderRadius: 2,
                  background: AREA_COLORS[i % AREA_COLORS.length],
                  boxShadow: `0 0 5px ${AREA_COLORS[i % AREA_COLORS.length]}`,
                  opacity: 0.9,
                }}
              />
            ))}
          </span>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>{a.count}</span>
        </div>
      ))}
    </>
  );
}

function DeckWidget({
  skills,
  onRun,
  onConfig,
}: {
  skills: Skill[];
  onRun: (s: Skill) => void;
  onConfig: (s: Skill) => void;
}) {
  const t = useT();
  const deck = useMemo(() => {
    const favorites = skills.filter((s) => s.favorite && s.enabled);
    const rest = skills.filter((s) => s.enabled && !s.favorite);
    return [...favorites, ...rest].slice(0, 8);
  }, [skills]);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, marginTop: -6 }}>
        <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{t("dash.tapToRun")}</span>
        <Link to="/skills" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {t("dash.addSkill")}
        </Link>
      </div>
      <div className="deck-grid">
        {deck.map((s) => (
          <div className="deck-card" key={s.slug}>
            <Sparkles className="deck-icon" aria-hidden />
            <Link to={`/skills/${s.slug}`} className="slug" style={{ color: "var(--text)" }}>/{s.slug}</Link>
            <div className="config">
              <span className="model">{shortModel(s.recommendedModel)}</span>
              <span className="sep">·</span>
              <span className="effort">{s.recommendedEffort === "default" ? t("effort.default") : t(`effort.${s.recommendedEffort}` as Parameters<typeof t>[0])}</span>
            </div>
            <div className="deck-actions">
              <button className="btn sm outline-accent" onClick={() => onRun(s)} aria-label={`${t("common.run")} /${s.slug}`}>
                <Play aria-hidden />
              </button>
              <button className="btn sm ghost" onClick={() => onConfig(s)} aria-label={`${t("matrix.title")} /${s.slug}`}>
                <Settings2 aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function shortModel(model: string | null): string {
  if (!model) return "AUTO";
  const m = model.toLowerCase();
  for (const name of ["opus", "sonnet", "haiku", "fable", "gpt-5.2", "gpt-5", "o4"]) {
    if (m.includes(name)) return name.toUpperCase();
  }
  return model.slice(0, 10).toUpperCase();
}

function BoardWidget({ routines, runs }: { routines: RoutineStatus[]; runs: RunRecord[] }) {
  const t = useT();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const firedToday = runs.filter(
    (r) => r.origin === "routine" && r.createdAt >= todayStart.getTime() && !["queued", "running"].includes(r.status),
  ).length;
  const rows = routines
    .map((r) => {
      const firedTodayAt = r.lastFiredAt && r.lastFiredAt >= todayStart.getTime() ? r.lastFiredAt : null;
      const ts = r.enabled ? (r.nextRunAt ?? firedTodayAt) : firedTodayAt;
      return { r, ts, fired: !!firedTodayAt && (!r.nextRunAt || new Date(r.nextRunAt).getDate() !== new Date().getDate()) };
    })
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));
  const nextId = rows.find((row) => row.r.enabled && row.r.nextRunAt)?.r.id ?? null;
  return (
    <>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: -8, marginBottom: 4, textAlign: "right" }}>
        {firedToday}/{routines.filter((r) => r.enabled).length || routines.length} {t("dash.firedToday")}
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-faint)", margin: 0 }}><Link to="/routines">{t("routines.new")} →</Link></p>
      ) : (
        rows.map(({ r, ts, fired }) => {
          const isNext = r.id === nextId;
          const status = !r.enabled ? t("board.paused") : fired ? t("board.fired") : isNext ? t("board.next") : t("board.queued");
          return (
            <div className={`board-row${isNext ? " next" : ""}${fired || !r.enabled ? " fired" : ""}`} key={r.id}>
              <span className="time">
                {ts ? new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"}
              </span>
              <Link to="/routines" className="name truncate" style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>
                {r.name}
              </Link>
              <span className="status">{status}</span>
            </div>
          );
        })
      )}
    </>
  );
}

function PulseWidget({ metrics, runs }: { metrics: Metrics; runs: RunRecord[] }) {
  const t = useT();
  const days = 14;
  const counts = useMemo(() => {
    const out = new Array<number>(days).fill(0);
    const dayMs = 86_400_000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime() - (days - 1) * dayMs;
    for (const r of runs) {
      const idx = Math.floor((r.createdAt - startMs) / dayMs);
      if (idx >= 0 && idx < days) out[idx] = (out[idx] ?? 0) + 1;
    }
    return out;
  }, [runs]);
  const max = Math.max(1, ...counts);
  const points = counts.map((c, i) => `${(i / (days - 1)) * 100},${34 - (c / max) * 30}`).join(" ");
  return (
    <>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div className="stat"><span className="value accented" style={{ fontSize: 20 }}>{metrics.last7d}</span><span className="label">{t("dash.metricRuns")}</span></div>
        <div className="stat"><span className="value" style={{ fontSize: 20 }}>{metrics.successRate == null ? "—" : `${Math.round(metrics.successRate * 100)}%`}</span><span className="label">{t("dash.metricSuccess")}</span></div>
        <div className="stat"><span className="value" style={{ fontSize: 20 }}>{formatDuration(metrics.avgDurationMs)}</span><span className="label">{t("dash.metricAvg")}</span></div>
      </div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" style={{ width: "100%", height: 30, marginTop: 6 }} aria-label={t("widget.runsPerDay")}>
        <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 3px var(--accent-glow))" }} />
        {counts.map((c, i) => (
          <circle key={i} cx={(i / (days - 1)) * 100} cy={34 - (c / max) * 30} r={c > 0 ? 1.6 : 0.7} fill="var(--accent)" />
        ))}
      </svg>
      <div style={{ fontSize: 9.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{t("widget.runsPerDay")}</div>
    </>
  );
}

function AttentionWidget({ routines, runs }: { routines: RoutineStatus[]; runs: RunRecord[] }) {
  const t = useT();
  const failures = runs.filter((r) => r.status === "failed").slice(0, 3);
  const unhealthy = routines.filter((r) => !r.healthy);
  const running = runs.filter((r) => ["running", "queued"].includes(r.status));
  if (failures.length === 0 && unhealthy.length === 0 && running.length === 0) {
    return <p style={{ color: "var(--ok)", margin: 0, fontSize: 13 }}>{t("dash.allClear")}</p>;
  }
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      {running.map((r) => (
        <Link key={r.id} to={`/runs/${r.id}`} className="badge info" style={{ textDecoration: "none" }}>
          <span className="spinner" style={{ width: 10, height: 10 }} aria-hidden /> {r.skillSlug ?? r.provider}
        </Link>
      ))}
      {unhealthy.map((r) => (
        <Link key={r.id} to="/routines" className="badge danger" style={{ textDecoration: "none" }}>
          {r.name} · {r.recentFailures}×
        </Link>
      ))}
      {failures.map((r) => (
        <Link key={r.id} to={`/runs/${r.id}`} style={{ display: "inline-flex", gap: 8, alignItems: "center", textDecoration: "none", color: "var(--text-dim)", fontSize: 12.5 }}>
          <StatusBadge status={r.status} /> <span className="truncate" style={{ maxWidth: 260 }}>{r.skillSlug ?? r.promptSummary.slice(0, 42)}</span>
        </Link>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Model × Effort matrix (persists to the canonical skill)
--------------------------------------------------------------------------- */
function ModelEffortMatrix({
  skill,
  providers,
  onClose,
  onSaved,
}: {
  skill: Skill;
  providers: ProviderSnapshot[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const enabled = providers.filter((p) => p.enabled && skill.providers.includes(p.id));
  const [provider, setProvider] = useState<ProviderId>(
    (providers.find((p) => p.isDefault && enabled.includes(p))?.id ?? enabled[0]?.id ?? "claude") as ProviderId,
  );
  const [models, setModels] = useState<ModelishOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<ModelishOption[]>(`/api/providers/${provider}/models`).then(setModels).catch(() => setModels([]));
  }, [provider]);

  const efforts = ["low", "medium", "high", "default"] as const;
  const effortLabel: Record<(typeof efforts)[number], string> = {
    low: t("effort.low"),
    medium: t("effort.medium"),
    high: t("effort.high"),
    default: t("effort.default"),
  };

  const pick = async (model: string | null, effort: (typeof efforts)[number]) => {
    setBusy(true);
    try {
      const { body, skillFile, resources, bodyLineCount, thick, favorite, ...front } = skill as Skill & Record<string, unknown>;
      void skillFile; void resources; void bodyLineCount; void thick; void favorite;
      delete (front as Record<string, unknown>).dir;
      await api.put(`/api/skills/${skill.slug}`, {
        frontmatter: { ...front, recommendedModel: model, recommendedEffort: effort },
        body,
      });
      toast(`/${skill.slug}: ${shortModel(model)} · ${effortLabel[effort]}`, "ok");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "danger");
      setBusy(false);
    }
  };

  const rowsM: Array<{ id: string | null; label: string }> = [
    { id: null, label: "AUTO" },
    ...models.map((m) => ({ id: m.id, label: shortModel(m.id) })),
  ];

  return (
    <Modal title={`/${skill.slug} — ${t("matrix.title")}`} onClose={onClose}>
      <p style={{ color: "var(--text-dim)", marginTop: 0, fontSize: 13 }}>{t("matrix.hint")}</p>
      {enabled.length > 1 && (
        <div className="segmented sm" style={{ marginBottom: 12 }}>
          {enabled.map((p) => (
            <button key={p.id} className={provider === p.id ? "active" : ""} onClick={() => setProvider(p.id)}>{p.id}</button>
          ))}
        </div>
      )}
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {efforts.map((e) => <th key={e}>{effortLabel[e]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rowsM.map((row) => {
            const activeRow = (skill.recommendedModel ?? null) === row.id;
            return (
              <tr key={row.id ?? "auto"} className={activeRow ? "active-row" : ""}>
                <td className="model-name">{row.label}</td>
                {efforts.map((e) => (
                  <td className="cell" key={e}>
                    <button
                      className={`m-dot${activeRow && skill.recommendedEffort === e ? " selected" : ""}`}
                      disabled={busy}
                      onClick={() => void pick(row.id, e)}
                      aria-label={`${row.label} · ${effortLabel[e]}`}
                      aria-pressed={activeRow && skill.recommendedEffort === e}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

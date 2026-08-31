import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { api, type GraphData, type GraphNode } from "../api";
import { I18nContext, useT } from "../i18n";
import { Empty, ErrorBox, Loading, formatBytes, timeAgo, useApi, useToast } from "../components/ui";

interface SimNode extends SimulationNodeDatum, GraphNode {}
interface Facets {
  areas: Array<{ area: string; count: number }>;
  exts: Array<{ ext: string; count: number }>;
  total: number;
}
interface Preview {
  kind: string;
  content: string | null;
  truncated: boolean;
  message: string | null;
}

const AREA_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"];

export default function SecondBrain() {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const toast = useToast();
  const [view, setView] = useState<"graph" | "grid">("graph");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const [ext, setExt] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [related, setRelated] = useState<Array<{ file: GraphNode; why: string }>>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(id);
  }, [query]);

  const status = useApi<{ facets: Facets }>(() => api.get("/api/memory/status"));
  const graph = useApi<GraphData>(
    () =>
      api.get(
        `/api/memory/graph?maxNodes=350${area ? `&area=${encodeURIComponent(area)}` : ""}${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`,
      ),
    [area, debounced],
  );

  const gridHits = useApi<Array<GraphNode & { snippet: string | null }>>(
    () =>
      api.get(
        `/api/memory/search?q=${encodeURIComponent(debounced)}${area ? `&area=${encodeURIComponent(area)}` : ""}${ext ? `&ext=${encodeURIComponent(ext)}` : ""}&limit=90`,
      ),
    [debounced, area, ext],
  );

  const select = async (node: GraphNode) => {
    setSelected(node);
    setPreview(null);
    setRelated([]);
    try {
      const [pv, rel] = await Promise.all([
        api.get<Preview>(`/api/memory/preview?p=${encodeURIComponent(node.path)}`),
        api.get<Array<{ file: GraphNode; why: string }>>(`/api/memory/related?id=${node.id}`),
      ]);
      setPreview(pv);
      setRelated(rel);
    } catch (err) {
      setPreview({ kind: "error", content: null, truncated: false, message: (err as Error).message });
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post<{ stats: { scanned: number; added: number } }>("/api/memory/index");
      await api.post("/api/memory/routers");
      toast(`${res.stats.scanned} files scanned (+${res.stats.added})`, "ok");
      status.reload();
      graph.reload();
      gridHits.reload();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setRefreshing(false);
    }
  };

  const facets = status.data?.facets;
  const areaColor = useMemo(() => {
    const map = new Map<string, string>();
    (facets?.areas ?? []).forEach((a, i) => map.set(a.area, AREA_COLORS[i % AREA_COLORS.length]!));
    return (a: string | null) => (a ? (map.get(a) ?? "#94a3b8") : "#94a3b8");
  }, [facets]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("brain.title")}</h1>
          <p className="sub">{facets ? `${facets.total} ${t("brain.sub")}` : "…"}</p>
        </div>
        <div className="head-actions">
          <div className="segmented" role="group">
            <button className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>{t("brain.graph")}</button>
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>{t("brain.grid")}</button>
          </div>
          <button className="btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />} {t("brain.refresh")}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ maxWidth: 340 }}
          placeholder={t("brain.searchPh")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("common.search")}
        />
        <select className="input" style={{ maxWidth: 170 }} value={area} onChange={(e) => setArea(e.target.value)} aria-label={t("brain.filterArea")}>
          <option value="">{t("brain.filterArea")}: {t("brain.all")}</option>
          {(facets?.areas ?? []).map((a) => (
            <option key={a.area} value={a.area}>{a.area} ({a.count})</option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 150 }} value={ext} onChange={(e) => setExt(e.target.value)} aria-label={t("brain.filterExt")}>
          <option value="">{t("brain.filterExt")}: {t("brain.all")}</option>
          {(facets?.exts ?? []).map((x) => (
            <option key={x.ext} value={x.ext}>{x.ext} ({x.count})</option>
          ))}
        </select>
      </div>

      {facets && facets.total === 0 ? (
        <Empty>{t("brain.noIndex")}</Empty>
      ) : (
        <div className="brain-layout">
          <div>
            {view === "graph" ? (
              graph.loading && !graph.data ? (
                <Loading />
              ) : graph.error && !graph.data ? (
                <ErrorBox message={graph.error} onRetry={graph.reload} />
              ) : graph.data ? (
                <>
                  <GraphCanvas data={graph.data} selectedId={selected?.id ?? null} onSelect={select} colorFor={areaColor} />
                  {graph.data.truncated && (
                    <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 6 }}>{t("brain.truncated")}</p>
                  )}
                </>
              ) : null
            ) : gridHits.data ? (
              <div className="file-grid">
                {gridHits.data.map((f) => (
                  <button key={f.id} className={`file-card${selected?.id === f.id ? " selected" : ""}`} onClick={() => select(f)}>
                    <div className="name">{f.name}</div>
                    <div className="meta">{f.area ?? "—"} · {timeAgo(f.mtime, lang)}</div>
                    {f.snippet && <div className="meta" style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: sanitizeSnippet(f.snippet) }} />}
                  </button>
                ))}
              </div>
            ) : (
              <Loading />
            )}
          </div>

          <aside className="preview-pane">
            {selected ? (
              <div className="card" style={{ margin: 0 }}>
                <h3 style={{ wordBreak: "break-all" }}>{selected.title ?? selected.name}</h3>
                <p className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", wordBreak: "break-all" }}>{selected.path}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {selected.area && <span className="badge info">{selected.area}</span>}
                  <span className="badge dim">{selected.ext || "file"}</span>
                  <span className="badge dim">{formatBytes(selected.size)}</span>
                  {selected.tags.map((tag) => <span key={tag} className="badge dim">#{tag}</span>)}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <button
                    className="btn sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(selected.path);
                      toast(t("common.copied"), "ok");
                    }}
                  >
                    <Copy aria-hidden /> {t("brain.copyPath")}
                  </button>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      try {
                        await api.post("/api/memory/open", { p: selected.path });
                      } catch (err) {
                        toast((err as Error).message, "danger");
                      }
                    }}
                  >
                    <ExternalLink aria-hidden /> {t("common.open")}
                  </button>
                </div>
                <h2>{t("brain.preview")}</h2>
                {preview == null ? (
                  <Loading />
                ) : preview.kind === "text" ? (
                  <pre className="preview-pre">{preview.content}{preview.truncated ? "\n…" : ""}</pre>
                ) : (
                  <p style={{ color: "var(--text-faint)" }}>
                    {preview.kind === "blocked" ? t("brain.blocked") : (preview.message ?? t("brain.binary"))}
                  </p>
                )}
                {related.length > 0 && (
                  <>
                    <h2 style={{ marginTop: 12 }}>{t("brain.related")}</h2>
                    {related.map((r) => (
                      <div className="list-row" key={`${r.file.id}-${r.why}`}>
                        <button className="btn ghost sm truncate" style={{ maxWidth: 200 }} onClick={() => select(r.file)}>
                          {r.file.name}
                        </button>
                        <span className="meta" style={{ textAlign: "right" }}>{r.why}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="empty">{t("brain.preview")}</div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/** Snippet comes from our own FTS with <mark> tags; strip everything else. */
function sanitizeSnippet(snippet: string): string {
  return snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

function GraphCanvas({
  data,
  selectedId,
  onSelect,
  colorFor,
}: {
  data: GraphData;
  selectedId: number | null;
  onSelect: (node: GraphNode) => void;
  colorFor: (area: string | null) => string;
}) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<Array<{ source: SimNode; target: SimNode; kind: string }>>([]);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges = data.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, kind: e.kind }));
    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-42))
      .force("center", forceCenter(460, 270))
      .force("collide", forceCollide(14))
      .force(
        "link",
        forceLink(simEdges)
          .distance((l: { kind?: string }) => (l.kind === "markdown-link" ? 60 : 34))
          .strength(0.5),
      )
      .stop();
    sim.tick(160);
    setNodes([...simNodes]);
    setEdges(simEdges as Array<{ source: SimNode; target: SimNode; kind: string }>);
    setTransform({ x: 0, y: 0, k: 1 });
  }, [data]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform((tr) => {
      const k = Math.min(6, Math.max(0.25, tr.k * factor));
      const rect = svgRef.current?.getBoundingClientRect();
      const cx = (e.clientX - (rect?.left ?? 0) - tr.x) / tr.k;
      const cy = (e.clientY - (rect?.top ?? 0) - tr.y) / tr.k;
      return { k, x: e.clientX - (rect?.left ?? 0) - cx * k, y: e.clientY - (rect?.top ?? 0) - cy * k };
    });
  };

  return (
    <div className="brain-canvas">
      <svg
        ref={svgRef}
        viewBox="0 0 920 540"
        role="img"
        aria-label="Workspace graph"
        onWheel={onWheel}
        onPointerDown={(e) => {
          dragging.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          setTransform((tr) => ({ ...tr, x: e.clientX - dragging.current!.x, y: e.clientY - dragging.current!.y }));
        }}
        onPointerUp={() => (dragging.current = null)}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {edges.map((e, i) => (
            <line
              key={i}
              className={`graph-edge ${e.kind}`}
              x1={e.source.x}
              y1={e.source.y}
              x2={e.target.x}
              y2={e.target.y}
              strokeWidth={e.kind === "markdown-link" ? 1.4 : 0.7}
            />
          ))}
          {nodes.map((n) => (
            <g
              key={n.id}
              className={`graph-node${selectedId === n.id ? " selected" : ""}`}
              transform={`translate(${n.x},${n.y})`}
              onClick={() => onSelect(n)}
              tabIndex={0}
              role="button"
              aria-label={n.name}
              onKeyDown={(e) => e.key === "Enter" && onSelect(n)}
            >
              <circle r={selectedId === n.id ? 9 : 6.5} fill={colorFor(n.area)} />
              {(transform.k > 1.3 || selectedId === n.id || nodes.length <= 60) && (
                <text className="graph-label" x={10} y={3.5}>{n.name.length > 26 ? `${n.name.slice(0, 24)}…` : n.name}</text>
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

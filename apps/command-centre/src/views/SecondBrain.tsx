/**
 * Second Brain — the thin container.
 *
 * Everything heavy lives in `src/brain/**`: the world model and its pure
 * queries (`engine/*`), the renderer (`render/*`), the state plumbing
 * (`useBrainState`) and the panels. This file loads the data, owns the
 * selection, translates canvas hits into navigation and lays the pieces out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type GraphData, type IndexProgressPayload, type MemoryPreview, type RunRecord } from "../api";
import { useToast } from "../components/ui";
import { useLang, useT } from "../i18n";
import { useOsEvent } from "../hooks/useEventStream";
import { useOsNavigate } from "../hooks/useViewTransition";
import {
  qk,
  useApiQuery,
  useInvalidate,
  useOsConnectors,
  useOsMeta,
  useOsRoutines,
  useOsRuns,
  useOsSettings,
  useOsSkills,
} from "../queries";
import { BrainCanvas } from "../brain/BrainCanvas";
import { BrainChrome, type HoverInfo } from "../brain/BrainChrome";
import { BrainPanel } from "../brain/BrainPanel";
import { FileList } from "../brain/FileList";
import { PreviewPanel, type PreviewState } from "../brain/PreviewPanel";
import { useBrainState, workspaceOf } from "../brain/useBrainState";
import { useCamera, useMinimapNav } from "../brain/camera";
import { frameSector } from "../brain/engine/explosion";
import { applyVisibility, updateFocus } from "../brain/engine/graph";
import type { Hit } from "../brain/engine/hitTest";
import { setHubsExpanded, toggleHub as toggleHubIn } from "../brain/engine/hubs";
import {
  DEFAULT_FILTERS,
  setSelected,
  type FileNode,
  type Hub,
  type LayoutKind,
} from "../brain/engine/world";
import { saveLocalSettings, settingsFromUi } from "../brain/state";
import "../brain/brain.css";

const GRAPH_PARAMS = { maxNodes: 3000 };
const GRAPH_PATH = "/api/memory/graph?maxNodes=3000";
const LAYOUT_KEYS: Record<
  LayoutKind,
  | "brain.layout.arcs"
  | "brain.layout.force"
  | "brain.layout.circle"
  | "brain.layout.hex"
  | "brain.layout.rings"
> = {
  arcs: "brain.layout.arcs",
  force: "brain.layout.force",
  circle: "brain.layout.circle",
  hex: "brain.layout.hex",
  rings: "brain.layout.rings",
};

export default function SecondBrain() {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const navigate = useOsNavigate();
  const invalidate = useInvalidate();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef({ width: 1, height: 1 });
  const invalidateRef = useRef(0);
  const dirty = useCallback(() => {
    invalidateRef.current++;
  }, []);

  const [presenting, setPresenting] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hits, setHits] = useState<Array<{ id: number; name: string; rel: string }>>([]);
  const [dangling, setDangling] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<{ value: number | null; playing: boolean }>({
    value: null,
    playing: false,
  });
  const [progress, setProgress] = useState<IndexProgressPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [layoutToast, setLayoutToast] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState(0);

  /* ---------- data ---------- */
  const graphQuery = useApiQuery<GraphData>(qk.memoryGraph(GRAPH_PARAMS), GRAPH_PATH);
  const skillsQuery = useOsSkills();
  const routinesQuery = useOsRoutines();
  const connectorsQuery = useOsConnectors();
  const settingsQuery = useOsSettings();
  const runsQuery = useOsRuns({ limit: 12 }, { refetchInterval: 20_000 });
  const meta = useOsMeta();

  const graph = graphQuery.data ?? null;
  const skills = useMemo(
    () => (skillsQuery.data ?? []).filter((s) => s.enabled).slice(0, 24),
    [skillsQuery.data],
  );
  const routines = useMemo(() => (routinesQuery.data ?? []).slice(0, 18), [routinesQuery.data]);
  const connectors = useMemo(() => (connectorsQuery.data ?? []).slice(0, 20), [connectorsQuery.data]);
  const skillSlugs = useMemo(() => new Set(skills.map((s) => s.slug)), [skills]);
  const ringLabels = useMemo(
    () => ({
      skills: t("brain.ring.skills"),
      memory: t("brain.ring.memory"),
      routines: t("brain.ring.routines"),
      apps: t("brain.ring.apps"),
    }),
    [t],
  );

  /* ---------- state plumbing (URL ⇄ server ⇄ localStorage ⇄ world) ---------- */
  const brain = useBrainState({
    graph,
    skills,
    routines,
    connectors,
    ringLabels,
    timeline: timeline.value,
    serverBlob: settingsQuery.data?.brain,
    dirty,
  });
  const { ui, uiRef, patch, world, version, groupOf, persistWorkspace } = brain;
  const wantFocus = brain.focusRef;

  /* ---------- camera ---------- */
  const camera = useCamera(world, viewRef, dirty);
  const { centerOn } = camera;

  /* ---------- selection + preview ---------- */
  const previewToken = useRef(0);
  const selectId = useCallback(
    (id: number | null, focus = false) => {
      if (id !== null && id === uiRef.current.sel) {
        const node = world.current.files.find((n) => n.id === id);
        if (focus && node) centerOn(node.x, node.y);
        return;
      }
      wantFocus.current = focus;
      patch({ sel: id });
    },
    [patch, centerOn, world, uiRef, wantFocus],
  );

  useEffect(() => {
    const w = world.current;
    setSelected(w, ui.sel);
    applyVisibility(w);
    updateFocus(w);
    dirty();
    const node = ui.sel === null ? undefined : w.files.find((n) => n.id === ui.sel);
    if (!node) {
      setPreview(null);
      setDangling([]);
      return;
    }
    if (wantFocus.current) {
      wantFocus.current = false;
      centerOn(node.x, node.y);
    }
    const token = ++previewToken.current;
    setPreview({ node, content: null, kind: "loading", message: null });
    void api
      .get<MemoryPreview>(`/api/memory/preview?p=${encodeURIComponent(node.path)}`)
      .then((pv) => {
        if (token === previewToken.current)
          setPreview({ node, content: pv.content, kind: pv.kind, message: pv.message });
      })
      .catch((err: Error) => {
        if (token === previewToken.current)
          setPreview({ node, content: null, kind: "error", message: err.message });
      });
  }, [ui.sel, version, world, dirty, centerOn, wantFocus]);

  /* ---------- search-as-you-type (server hits) ---------- */
  useEffect(() => {
    const q = ui.query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void api
        .get<Array<{ id: number; name: string; rel: string }>>(
          `/api/memory/search?q=${encodeURIComponent(q)}&limit=8`,
        )
        .then((res) => {
          if (!cancelled) setHits(res);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [ui.query]);

  /* ---------- timeline playback ---------- */
  const range = brain.range;
  const timelineOn = timeline.value !== null;
  useEffect(() => {
    if (!timeline.playing || !range || !timelineOn) return;
    const step = Math.max(1, Math.round((range[1] - range[0]) / 120));
    const id = window.setInterval(() => {
      setTimeline((cur) => {
        if (cur.value === null) return cur;
        const next = cur.value + step;
        return next >= range[1] ? { value: range[1], playing: false } : { ...cur, value: next };
      });
    }, 60);
    return () => window.clearInterval(id);
  }, [timeline.playing, timelineOn, range]);

  /* ---------- live agents: comets + finish bursts ---------- */
  const prevActive = useRef<string[]>([]);
  const runs = runsQuery.data;
  useEffect(() => {
    const w = world.current;
    const active = (runs ?? []).filter((r: RunRecord) => r.status === "running" || r.status === "queued");
    for (const id of prevActive.current) {
      if (active.some((r) => r.id === id)) continue;
      const finished = (runs ?? []).find((r) => r.id === id);
      const color =
        finished?.status === "done" ? "#4ade80" : finished?.status === "failed" ? "#f87171" : "#fbbf24";
      w.effects.push({ x: 0, y: 0, start: performance.now() / 1000, color });
    }
    prevActive.current = active.map((r) => r.id);
    setLiveCount(active.length);
    const existing = new Map(w.comets.map((c) => [c.runId, c]));
    w.comets = active.slice(0, 4).map(
      (r, i) =>
        existing.get(r.id) ?? {
          runId: r.id,
          skillSlug: r.skillSlug,
          seed: (i + 1) * 1.7 + (r.id.charCodeAt(0) % 7),
          trail: [],
        },
    );
    dirty();
  }, [runs, world, dirty]);

  /* ---------- indexing ---------- */
  useOsEvent("index.progress", (e) => setProgress(e.payload as IndexProgressPayload));
  useOsEvent("index.finished", () => {
    setProgress(null);
    void invalidate(qk.memoryGraph(GRAPH_PARAMS), qk.memoryStatus);
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        const res = await api.post<{ stats: { scanned: number; added: number } }>("/api/memory/index");
        await api.post("/api/memory/routers");
        await invalidate(qk.memoryGraph(GRAPH_PARAMS), qk.memoryStatus);
        toast(t("brain.indexed", { n: res.stats.scanned, added: res.stats.added }), "ok");
      } catch (err) {
        toast((err as Error).message, "danger");
      } finally {
        setRefreshing(false);
        setProgress(null);
      }
    })();
  }, [invalidate, toast, t]);

  /* ---------- hubs: directed explosion + camera framing ---------- */
  const toggleHub = useCallback(
    (hub: Hub) => {
      const w = world.current;
      toggleHubIn(w, hub, { focusMode: uiRef.current.focusMode, now: performance.now() / 1000 });
      if (hub.expanded) w.target = frameSector(w, hub, viewRef.current);
      dirty();
      persistWorkspace();
    },
    [world, uiRef, dirty, persistWorkspace],
  );

  const setAllExpanded = useCallback(
    (expanded: boolean) => {
      if (setHubsExpanded(world.current, expanded).length === 0) return;
      dirty();
      persistWorkspace();
    },
    [world, dirty, persistWorkspace],
  );

  const expandHub = useCallback(
    (key: string) => {
      const hub = world.current.hubs.find((h) => h.key === key);
      if (!hub) return;
      if (hub.expanded) centerOn(hub.x, hub.y);
      else toggleHub(hub);
    },
    [world, toggleHub, centerOn],
  );

  /* ---------- canvas handlers ---------- */
  const onHover = useCallback(
    (hit: Hit | null, sx: number, sy: number) => {
      const w = world.current;
      w.hoverId = hit?.file?.id ?? null;
      updateFocus(w);
      dirty();
      if (!hit) return setHover(null);
      if (hit.hub)
        return setHover({
          x: sx,
          y: sy,
          title: hit.hub.key,
          sub: `${hit.hub.count} ${t("brain.files")} — ${t("brain.hub.hint")}`,
        });
      if (hit.orb) return setHover({ x: sx, y: sy, title: hit.orb.label, sub: hit.orb.sub });
      if (hit.planet)
        return setHover({
          x: sx,
          y: sy,
          title: hit.planet.label,
          sub: `${hit.planet.count} ${t("brain.files")} · ${t("brain.planet")}`,
        });
      if (hit.file)
        return setHover({
          x: sx,
          y: sy,
          title: hit.file.name,
          sub: `${hit.file.group} · ${t("brain.dragHint")}`,
        });
      setHover(null);
    },
    [world, dirty, t],
  );

  const unpin = useCallback(
    (node: FileNode) => {
      node.pinned = false;
      node.fx = null;
      node.fy = null;
      dirty();
      persistWorkspace();
      setPreview((cur) => (cur && cur.node.id === node.id ? { ...cur } : cur));
    },
    [dirty, persistWorkspace],
  );

  const handlers = useMemo(
    () => ({
      onHover,
      onClick: (hit: Hit) => {
        if (hit.hub) return toggleHub(hit.hub);
        if (hit.orb)
          return navigate(
            hit.orb.kind === "skill"
              ? `/skills/${hit.orb.id}`
              : hit.orb.kind === "routine"
                ? "/routines"
                : "/connectors",
          );
        if (hit.planet) return centerOn(hit.planet.x, hit.planet.y, 3);
        selectId(hit.file ? hit.file.id : null);
      },
      onDoubleClick: (hit: Hit) => {
        if (hit.hub) patch({ filterGroup: uiRef.current.filterGroup === hit.hub.key ? null : hit.hub.key });
        else if (hit.file?.pinned) unpin(hit.file);
        else if (hit.file) selectId(hit.file.id, true);
        else if (!hit.orb && !hit.planet) camera.reset();
      },
      onDragEnd: () => {
        persistWorkspace();
        setPreview((cur) => (cur ? { ...cur } : cur));
      },
    }),
    [onHover, toggleHub, navigate, centerOn, selectId, patch, uiRef, unpin, camera, persistWorkspace],
  );

  useMinimapNav(minimapRef, world, dirty, !presenting);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        camera.by(1.25);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        camera.by(0.8);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        camera.reset();
      } else if (inField || mod || e.altKey) {
        /* typing: single-key shortcuts stay off */
      } else if (e.key === "/") {
        e.preventDefault();
        setPresenting(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (e.key === "p") setPresenting((v) => !v);
      else if (e.key === "f") patch({ local: !uiRef.current.local });
      else if (e.key === "l") patch({ showNames: !uiRef.current.showNames });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera, patch, uiRef]);

  // Esc closes the preview, then the list, then presentation mode — and only
  // then bubbles to the shell (which leaves the view).
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (uiRef.current.sel !== null) selectId(null);
      else if (listOpen) setListOpen(false);
      else if (presenting) setPresenting(false);
      else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [listOpen, presenting, selectId, uiRef]);

  /* ---------- layout pill ---------- */
  const layoutLabel = t(LAYOUT_KEYS[ui.layout]);
  const layoutRef = useRef(ui.layout);
  useEffect(() => {
    if (layoutRef.current === ui.layout) return;
    layoutRef.current = ui.layout;
    setLayoutToast(layoutLabel);
    const id = window.setTimeout(() => setLayoutToast(null), 1200);
    return () => window.clearTimeout(id);
  }, [ui.layout, layoutLabel]);

  const bake = useCallback(() => {
    const next = settingsFromUi(uiRef.current, workspaceOf(world.current));
    saveLocalSettings(next);
    void api
      .put("/api/settings", { brain: next })
      .then(() => {
        toast(t("brain.savedServer"), "ok");
        void invalidate(qk.settings);
      })
      .catch(() => toast(t("brain.savedLocal"), "info"));
  }, [world, uiRef, toast, t, invalidate]);

  const reset = useCallback(() => {
    camera.reset();
    setTimeline({ value: null, playing: false });
    patch({
      sel: null,
      query: "",
      filterGroup: null,
      filters: { ...DEFAULT_FILTERS },
      groups: [],
      local: false,
    });
  }, [camera, patch]);

  const total = graph?.totalFiles ?? 0;

  return (
    <div className={`brain2${presenting ? " presenting" : ""}${preview ? " has-preview" : ""}`}>
      <BrainCanvas
        world={world}
        canvasRef={canvasRef}
        minimapRef={minimapRef}
        viewRef={viewRef}
        invalidateRef={invalidateRef}
        ringLabels={ringLabels}
        coreLabel="ROUTER.MD"
        ariaLabel={t("brain.title")}
        describedBy="brain-count"
        handlers={handlers}
      />
      <span id="brain-count" className="sr-only" aria-live="polite">
        {total} {t("brain.sub")}
        {preview ? ` — ${preview.node.name} ${t("brain.selected")}` : ""}
      </span>

      <BrainChrome
        systemName={meta.data?.name ?? "Mordomo"}
        total={total}
        lang={lang}
        ui={ui}
        patch={patch}
        presenting={presenting}
        setPresenting={setPresenting}
        loading={!graph && !graphQuery.isError}
        error={!graph && graphQuery.isError ? graphQuery.error.message : null}
        onRetry={() => void graphQuery.refetch()}
        progress={progress}
        refreshing={refreshing}
        onRefresh={refresh}
        liveCount={liveCount}
        onNavigate={navigate}
        zoom={camera.controls}
        legend={brain.legend}
        legendOpen={legendOpen}
        setLegendOpen={setLegendOpen}
        ringCounts={{ skills: skills.length, routines: routines.length, apps: connectors.length }}
        kindCounts={brain.kindCounts}
        layoutLabel={layoutLabel}
        layoutToast={layoutToast}
        hover={preview ? null : hover}
      />

      {listOpen && !presenting && graph && (
        <FileList
          graph={graph}
          groupOf={groupOf}
          selectedId={ui.sel}
          onSelect={(id) => selectId(id, true)}
          onClose={() => setListOpen(false)}
        />
      )}

      {!presenting && (
        <BrainPanel
          ui={ui}
          patch={patch}
          searchRef={searchRef}
          hits={hits}
          facets={brain.facets}
          kindCounts={brain.kindCounts}
          timeline={{ range, value: timeline.value, playing: timeline.playing }}
          onTimeline={(value) =>
            setTimeline((cur) => ({ value, playing: value === null ? false : cur.playing }))
          }
          onTimelinePlay={() => setTimeline((cur) => ({ ...cur, playing: !cur.playing }))}
          onSelectId={selectId}
          onHub={expandHub}
          onExpandAll={setAllExpanded}
          onReset={reset}
          listOpen={listOpen}
          onToggleList={() => setListOpen((v) => !v)}
          onBake={bake}
          hygiene={brain.report}
          dangling={dangling}
          minimapRef={minimapRef}
          truncated={graph?.truncated ?? false}
          lang={lang}
        />
      )}

      {preview && !presenting && (
        <PreviewPanel
          preview={preview}
          world={world.current}
          skills={skillSlugs}
          lang={lang}
          onClose={() => selectId(null)}
          onSelectId={selectId}
          onSkill={(slug) => navigate(`/skills/${slug}`)}
          onUnpin={unpin}
          onDangling={setDangling}
        />
      )}
    </div>
  );
}

import { usePanelPreference } from "../brain/usePanelPreference";
import { errorMessage } from "./shared";
/**
 * Second Brain — the thin container.
 *
 * Everything heavy lives in `src/brain/**`: the world model and its pure
 * queries (`engine/*`), the renderer (`render/*`), the state plumbing
 * (`useBrainState`) and the panels. This file loads the data, owns the
 * selection, translates canvas hits into navigation and lays the pieces out.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type GraphData, type IndexProgressPayload, type RunSummary } from "../api";
import { apiCall } from "../apiCall";
import { useToast } from "../components/ui";
import { useLang, useT, type TKey } from "../i18n";
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
  useOsUiPreferences,
  useOsSkills,
} from "../queries";
import { BrainCanvas } from "../brain/BrainCanvas";
import { BrainChrome, type HoverInfo } from "../brain/BrainChrome";
import { BrainPanel } from "../brain/BrainPanel";
import { FileList } from "../brain/FileList";
import { PreviewPanel, type PreviewState } from "../brain/PreviewPanel";
import { useBrainState, workspaceOf } from "../brain/useBrainState";
import { ZoomReadout, useZoomBus } from "../brain/ZoomReadout";
import { useCamera, useMinimapNav } from "../brain/camera";
import {
  cancelFlight,
  hubBounds,
  planetBounds,
  reserveInsets,
  restingPoint,
  sectorBounds,
  type Insets,
  type Rect,
} from "../brain/engine/flight";
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
import { useCommands, type Command } from "../commands/registry";
import { openNoteEditor } from "../brain/noteEditor";

const GRAPH_PARAMS = { maxNodes: 3000 };
/**
 * Chrome that overlays the canvas (screen px). The insets are measured from
 * the panels' real rects; these are only the fallbacks for a panel that is
 * not mounted yet (the preview a selection is about to open, the top bar
 * before first paint).
 */
const TOPBAR_PX = 60;
const PANEL_MARGIN_PX = 16;
const PREVIEW_TOP_PX = 76;
const PREVIEW_MAX_PX = 360;
const PREVIEW_MAX_FRACTION = 0.42;
/** Below this viewport width the file list hides under the preview instead of sitting beside it. */
const LIST_BESIDE_PREVIEW_QUERY = "(min-width: 1100px)";
const LIST_BESIDE_PREVIEW_GAP_PX = 12;
/** Zoom a double-click on a file dives to (a single click uses the camera's focus zoom, never zooming out). */
const FILE_DIVE_K = 3.2;
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
  const [legendOpen, setLegendOpen] = usePanelPreference("legend", true);
  const [listOpen, setListOpen] = usePanelPreference("files", false);
  const [controlsCollapsed, setControlsCollapsed] = usePanelPreference("controls", false);
  const [missingSelection, setMissingSelection] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hits, setHits] = useState<Array<{ id: number; name: string; rel: string }>>([]);
  const [dangling, setDangling] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<{ value: number | null; playing: boolean }>({
    value: null,
    playing: false,
  });
  const [progress, setProgress] = useState<IndexProgressPayload | null>(null);
  /** How the last index pass ended when it did not finish: shown as text until the next one starts. */
  const [indexNote, setIndexNote] = useState<"cancelled" | "failed" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [layoutToast, setLayoutToast] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState(0);

  /* ---------- data ---------- */
  const graphQuery = useApiQuery<GraphData>(qk.memoryGraph(GRAPH_PARAMS), GRAPH_PATH);
  const skillsQuery = useOsSkills();
  const routinesQuery = useOsRoutines();
  const connectorsQuery = useOsConnectors();
  const uiPreferencesQuery = useOsUiPreferences();
  const runsQuery = useOsRuns({ limit: 12 }, { refetchInterval: 120_000 });
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
    serverBlob: uiPreferencesQuery.data?.brain,
    dirty,
  });
  const { ui, uiRef, patch, world, version, groupOf, persistWorkspace } = brain;
  const wantFocus = brain.focusRef;

  /* ---------- camera ---------- */
  // Overlay panels reserve screen insets so framed content lands in the free
  // part of the viewport. They are measured from the panels' real rects (the
  // stylesheet decides where each sits and whether the file list stays beside
  // the preview), after every panel change and again at the start of every
  // camera helper that frames against them, so a resize never leaves them
  // stale. A panel the state says is open but that is not mounted yet (the
  // preview a selection is about to open) falls back to its stylesheet size.
  const rootRef = useRef<HTMLDivElement>(null);
  const insetsRef = useRef<Insets>({ left: 0, right: 0, top: TOPBAR_PX, bottom: PANEL_MARGIN_PX });
  const reduceMotionRef = useRef(false);
  const panelState = useRef({ presenting, previewOpen: preview !== null, listOpen, controlsCollapsed });
  const refreshInsets = useCallback(() => {
    const st = panelState.current;
    const view = viewRef.current;
    const canvas: Rect = canvasRef.current?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: view.width,
      bottom: view.height,
    };
    if (st.presenting) {
      insetsRef.current = { left: 0, right: 0, top: 0, bottom: PANEL_MARGIN_PX };
      return;
    }
    const rectOf = (selector: string): Rect | null => {
      const el = rootRef.current?.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const panels: Rect[] = [];
    const topbar = rectOf(".brain2-topbar");
    panels.push(
      topbar ?? { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.top + TOPBAR_PX },
    );
    const controls = rectOf(".brain2-panel");
    if (controls) panels.push(controls);
    const list = st.listOpen ? rectOf(".brain2-list") : null;
    const preview = st.previewOpen ? rectOf(".brain2-preview") : null;
    if (preview) {
      panels.push(preview);
      if (list) panels.push(list); // still displayed beside it (wide viewports); hidden ones measure 0×0
    } else if (st.previewOpen) {
      // Not mounted yet: the stylesheet's geometry, beside the list when the viewport keeps both.
      const beside = list !== null && window.matchMedia(LIST_BESIDE_PREVIEW_QUERY).matches;
      const left = beside ? list.right + LIST_BESIDE_PREVIEW_GAP_PX : canvas.left + PANEL_MARGIN_PX;
      panels.push({
        left,
        top: canvas.top + PREVIEW_TOP_PX,
        right: left + Math.min(PREVIEW_MAX_PX, view.width * PREVIEW_MAX_FRACTION),
        bottom: canvas.bottom - PANEL_MARGIN_PX,
      });
      if (beside) panels.push(list);
    } else if (list) panels.push(list);
    insetsRef.current = reserveInsets(canvas, panels, PANEL_MARGIN_PX);
  }, []);
  useLayoutEffect(() => {
    panelState.current = { presenting, previewOpen: preview !== null, listOpen, controlsCollapsed };
    refreshInsets();
  }, [presenting, preview, listOpen, controlsCollapsed, refreshInsets]);
  const camera = useCamera(world, viewRef, insetsRef, dirty, reduceMotionRef, refreshInsets);
  const { centerOn, fitToBounds } = camera;
  /**
   * "Reset zoom and position" means it: a flight still playing and a dive
   * still queued for the selection would both steer the camera away again a
   * moment later — inside a plate, where the preview pane lands mid-canvas,
   * that is exactly what happened.
   */
  const resetCamera = useCallback(() => {
    cancelFlight(world.current);
    wantFocus.current = false;
    camera.reset();
  }, [camera, world, wantFocus]);
  const zoomControls = useMemo(
    () => ({ ...camera.controls, reset: resetCamera }),
    [camera.controls, resetCamera],
  );
  const zoomBus = useZoomBus();

  /* ---------- selection + preview ---------- */
  const previewToken = useRef(0);
  const selectId = useCallback(
    (id: number | null, focus: boolean | "dive" = false) => {
      if (id !== null && id === uiRef.current.sel) {
        const w = world.current;
        const node = w.files.find((n) => n.id === id);
        if (focus && node) {
          panelState.current.previewOpen = true; // the preview is open (or about to be) for this selection
          const [x, y] = restingPoint(w, node);
          centerOn(x, y, focus === "dive" ? FILE_DIVE_K : undefined);
        }
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
    const token = ++previewToken.current;
    let cancelled = false;
    const node = ui.sel === null ? undefined : w.files.find((n) => n.id === ui.sel);
    setMissingSelection(ui.sel !== null && version > 0 && !node);
    if (!node) {
      setPreview(null);
      setDangling([]);
      return;
    }
    if (wantFocus.current) {
      const dive = wantFocus.current === "dive";
      wantFocus.current = false;
      panelState.current.previewOpen = true; // the preview opens with this selection
      const [x, y] = restingPoint(w, node);
      centerOn(x, y, dive ? FILE_DIVE_K : undefined);
    }
    setPreview({ node, content: null, kind: "loading", message: null });
    void apiCall("GET /api/memory/preview", { query: { p: node.path } })
      .then((pv) => {
        if (!cancelled && token === previewToken.current)
          setPreview({
            node,
            content: pv.content,
            kind: pv.kind,
            message: pv.message,
            editable: pv.editable,
          });
      })
      .catch((err: Error) => {
        if (!cancelled && token === previewToken.current)
          setPreview({ node, content: null, kind: "error", message: errorMessage(err, t) });
      });
    return () => {
      cancelled = true;
    };
  }, [ui.sel, version, world, dirty, centerOn, wantFocus, t]);

  /* ---------- search-as-you-type (server hits) ---------- */
  useEffect(() => {
    const q = ui.query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void apiCall("GET /api/memory/search", { query: { q: q, limit: 8 } })
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
    const active = (runs ?? []).filter((r: RunSummary) => r.status === "running" || r.status === "queued");
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
  useOsEvent("index.started", () => setIndexNote(null));
  useOsEvent("index.progress", (e) => setProgress(e.payload as IndexProgressPayload));
  useOsEvent(["index.finished", "index.failed", "index.cancelled"], (e) => {
    setProgress(null);
    // A pass that ends otherwise than finished says so in text, where the progress was.
    setIndexNote(e.type === "index.cancelled" ? "cancelled" : e.type === "index.failed" ? "failed" : null);
    void invalidate(qk.memoryGraph(GRAPH_PARAMS), qk.memoryStatus);
  });
  const cancelIndex = useCallback(() => {
    void apiCall("POST /api/memory/index/cancel", { body: {} }).catch((err: unknown) =>
      toast(errorMessage(err, t), "danger"),
    );
  }, [toast, t]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        const res = await apiCall("POST /api/memory/index");
        await apiCall("POST /api/memory/routers");
        await invalidate(qk.memoryGraph(GRAPH_PARAMS), qk.memoryStatus);
        toast(t("brain.indexed", { n: res.stats.scanned, added: res.stats.added }), "ok");
      } catch (err) {
        // A cancel and a failure are shown in the bar (index.cancelled, index.failed), not twice as a toast.
        if (!(
          err instanceof ApiError &&
          ["index_cancelled", "index_worker_crashed", "index_worker_out_of_memory"].includes(err.code)
        ))
          toast(errorMessage(err, t), "danger");
      } finally {
        setRefreshing(false);
        setProgress(null);
      }
    })();
  }, [invalidate, toast, t]);

  /* ---------- hubs: directed explosion + camera framing ---------- */
  const frameHub = useCallback(
    (hub: Hub) => {
      const w = world.current;
      if (hub.expanded) fitToBounds(sectorBounds(w, hub), { padding: 60, maxK: 4 });
      else fitToBounds(hubBounds(hub), { padding: 40, maxK: 2.5 });
    },
    [world, fitToBounds],
  );

  /** Expand or collapse one hub (files fan out / ease back), then frame it. */
  const toggleHub = useCallback(
    (hub: Hub) => {
      const w = world.current;
      cancelFlight(w);
      toggleHubIn(w, hub, { focusMode: uiRef.current.focusMode, now: performance.now() / 1000 });
      frameHub(hub);
      setHover(null); // the tooltip text depends on the expanded state; the next move rebuilds it
      dirty();
      persistWorkspace();
    },
    [world, uiRef, frameHub, dirty, persistWorkspace],
  );

  /** Single click on a hub: open it if closed, and frame its sector either way (never collapses). */
  const focusHub = useCallback(
    (hub: Hub) => {
      if (hub.expanded) frameHub(hub);
      else toggleHub(hub);
    },
    [frameHub, toggleHub],
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
      if (hub) focusHub(hub);
    },
    [world, focusHub],
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
          sub: `${hit.hub.count} ${t("brain.files")} — ${t(hit.hub.expanded ? "brain.hub.hint" : "brain.hub.hintCollapsed")}`,
        });
      if (hit.orb) return setHover({ x: sx, y: sy, title: hit.orb.label, sub: hit.orb.sub });
      if (hit.planet)
        return setHover({
          x: sx,
          y: sy,
          title: hit.planet.label,
          sub: `${hit.planet.count} ${t("brain.files")} · ${t("brain.planet")} — ${t("brain.planet.hint")}`,
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

  // Click semantics ("zoom while navigating"): a single click acts at once
  // and a double-click is purely additive, so a double-click never contradicts
  // the click that preceded it (hub: focus, focus, then collapse; file:
  // select + fly, then dive closer; empty: nothing, then fit to content).
  const handlers = useMemo(
    () => ({
      onHover,
      onZoom: zoomBus.emit,
      onClick: (hit: Hit) => {
        if (hit.hub) return focusHub(hit.hub);
        if (hit.orb)
          return navigate(
            hit.orb.kind === "skill"
              ? `/skills/${hit.orb.id}`
              : hit.orb.kind === "routine"
                ? "/routines"
                : "/connectors",
          );
        if (hit.planet) return fitToBounds(planetBounds(world.current, hit.planet), { padding: 36, maxK: 4 });
        if (hit.file) return selectId(hit.file.id, true);
        selectId(null);
      },
      onDoubleClick: (hit: Hit) => {
        if (hit.hub) {
          if (hit.hub.expanded) toggleHub(hit.hub);
          return;
        }
        if (hit.file?.pinned) return unpin(hit.file);
        if (hit.file) return selectId(hit.file.id, "dive");
        if (!hit.orb && !hit.planet) camera.fit();
      },
      onDragEnd: () => {
        persistWorkspace();
        setPreview((cur) => (cur ? { ...cur } : cur));
      },
    }),
    [
      onHover,
      zoomBus,
      focusHub,
      toggleHub,
      navigate,
      fitToBounds,
      world,
      selectId,
      unpin,
      camera,
      persistWorkspace,
    ],
  );

  useMinimapNav(minimapRef, world, dirty, !presenting);

  /* ---------- keyboard (the `view:brain` scope: `/` and `p` are the brain's while it is open) ---------- */
  // `/` asks for the search field; it is focused once it is on screen (panel open, not presenting).
  const [searchAsk, setSearchAsk] = useState(0);
  const searchAnswered = useRef(0);
  useEffect(() => {
    if (searchAsk === searchAnswered.current || controlsCollapsed || presenting) return;
    searchAnswered.current = searchAsk;
    searchRef.current?.focus();
  }, [searchAsk, controlsCollapsed, presenting]);
  const keyActs = useRef({ camera, patch, resetCamera, setControlsCollapsed });
  keyActs.current = { camera, patch, resetCamera, setControlsCollapsed };
  const commands = useMemo<Command[]>(() => {
    const key = (id: string, title: TKey, keys: string[], run: () => void) =>
      ({ id, title, group: "view", scope: "view:brain", keys, run }) satisfies Command;
    return [
      key("brain.zoomIn", "cmd.brain.zoomIn", ["Mod+=", "Mod++"], () => keyActs.current.camera.by(1.25)),
      key("brain.zoomOut", "cmd.brain.zoomOut", ["Mod+-"], () => keyActs.current.camera.by(0.8)),
      key("brain.zoomReset", "cmd.brain.zoomReset", ["Mod+0"], () => keyActs.current.resetCamera()),
      key("brain.search", "shell.shortcuts.brainSearch", ["/"], () => {
        // The field is on screen only with the panel open and out of presentation: bring it, then focus it.
        setPresenting(false);
        keyActs.current.setControlsCollapsed(false);
        setSearchAsk((n) => n + 1);
      }),
      key("brain.present", "shell.shortcuts.brainPresent", ["p"], () => setPresenting((v) => !v)),
      key("brain.newNote", "note.new", ["n"], () => openNoteEditor({ mode: "new" })),
      key("brain.local", "cmd.brain.local", ["f"], () =>
        keyActs.current.patch({ local: !uiRef.current.local }),
      ),
      key("brain.names", "cmd.brain.names", ["l"], () =>
        keyActs.current.patch({ showNames: !uiRef.current.showNames }),
      ),
    ];
  }, [uiRef]);
  useCommands(commands);

  // Esc closes the preview, then the list, then presentation mode — and only
  // then falls to the shell (which leaves the view). The brain is one panel
  // among others (G2): its Escape is only its own when the focus is in it
  // (or nowhere); a dialog's Escape is the dialog's (the modal scope).
  const escState = useRef({ listOpen, presenting, selectId, setListOpen });
  escState.current = { listOpen, presenting, selectId, setListOpen };
  const escCommands = useMemo<Command[]>(
    () => [
      {
        id: "brain.escape",
        title: "cmd.brain.escape",
        group: "view",
        scope: "view:brain",
        keys: ["Escape"],
        allowInInput: true,
        when: () => {
          const s = escState.current;
          const el = document.activeElement;
          const here = !el || el === document.body || Boolean(rootRef.current?.contains(el));
          return here && (uiRef.current.sel !== null || s.listOpen || s.presenting);
        },
        run: () => {
          const s = escState.current;
          if (uiRef.current.sel !== null) s.selectId(null);
          else if (s.listOpen) s.setListOpen(false);
          else setPresenting(false);
        },
      },
    ],
    [uiRef],
  );
  useCommands(escCommands);

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
      .putUiPreferences({ brain: next })
      .then(() => {
        toast(t("brain.savedServer"), "ok");
        void invalidate(qk.uiPreferences);
      })
      .catch(() => toast(t("brain.savedLocal"), "info"));
  }, [world, uiRef, toast, t, invalidate]);

  const reset = useCallback(() => {
    // A flight in progress (the dive to a just-selected file) would keep
    // steering the camera after the reset; it ends here.
    resetCamera();
    setTimeline({ value: null, playing: false });
    patch({
      sel: null,
      query: "",
      filterGroup: null,
      filters: { ...DEFAULT_FILTERS },
      groups: [],
      local: false,
    });
  }, [resetCamera, patch]);

  const total = graph?.totalFiles ?? 0;

  return (
    <div
      ref={rootRef}
      className={`brain2${presenting ? " presenting" : ""}${preview ? " has-preview" : ""}${listOpen ? " has-list" : ""}`}
    >
      <BrainCanvas
        world={world}
        canvasRef={canvasRef}
        minimapRef={minimapRef}
        viewRef={viewRef}
        invalidateRef={invalidateRef}
        reduceMotionRef={reduceMotionRef}
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

      {missingSelection && !presenting && (
        <div className="brain-missing-source" role="status">
          <p>{t("brain.missingSelection")}</p>
          <button className="btn sm" disabled={refreshing} onClick={refresh}>
            {t("brain.refresh")}
          </button>
          <button className="btn ghost sm" onClick={() => selectId(null)}>
            {t("common.close")}
          </button>
        </div>
      )}
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
        indexNote={indexNote}
        onCancelIndex={cancelIndex}
        refreshing={refreshing}
        onRefresh={refresh}
        liveCount={liveCount}
        onNavigate={navigate}
        zoom={zoomControls}
        zoomReadout={<ZoomReadout world={world} bus={zoomBus} />}
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
          collapsed={controlsCollapsed}
          onCollapse={setControlsCollapsed}
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

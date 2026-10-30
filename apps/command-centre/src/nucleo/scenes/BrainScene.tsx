/**
 * The Brain scene (immersive shell): the second brain as a place you move
 * through.
 *
 * The whole screen is a living 3D sky of the indexed files — areas are
 * nebulae, notes are stars with their content icon, links are curved
 * synapses that fire pulses of light. Zooming is navigation: far away the
 * areas speak, closer the hubs, closer still every note; keep going and you
 * dive into a note, whose synapses become the space around you, and choosing
 * a neighbour travels through the synapse to it. The same stars can be
 * arranged four ways (areas, time, types, links) and morph between them.
 * Opening a note opens the reader beside the sky: the note in book
 * typography with its outline, key terms and context; its links travel.
 *
 * The data and its rules are the Second Brain's: the same graph query, the
 * same state plumbing (`useBrainState`: `?sel=`, `?q=` and `?group=` deep
 * links, the filters, local mode, the saved settings), the same markdown and
 * hygiene. What the sky does not show — layouts, pins, hubs, minimap, query
 * groups — stays one click away in the classic 2D map, behind "⋯".
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type Connector,
  type GraphData,
  type GraphNode,
  type IndexProgressPayload,
  type RoutineStatus,
  type Skill,
} from "../../api";
import { apiCall } from "../../apiCall";
import { escapeLayerOpen, getDialogDepth, keyLayerOpen, Popover, Tooltip } from "../../ui";
import { Skeleton, timeAgo, useToast } from "../../components/ui";
import { useWorkspace } from "../../components/Workspace";
import { useLang, useT, type TKey } from "../../i18n";
import { useOsEvent } from "../../hooks/useEventStream";
import { useOsNavigate } from "../../hooks/useViewTransition";
import { qk, useApiQuery, useInvalidate, useOsSkills, useOsUiPreferences } from "../../queries";
import { useDesktopActions } from "../../desktop/actions";
import {
  CONSOLE_DRAFT_EVENT,
  readConsoleDraft,
  storeConsoleDraft,
  withConsoleReference,
} from "../../desktop/consoleDraft";
import { APPS } from "../../desktop/apps";
import { FileList } from "../../brain/FileList";
import { useBrainState, workspaceOf } from "../../brain/useBrainState";
import { saveLocalSettings, settingsFromUi } from "../../brain/state";
import { applyVisibility, updateFocus } from "../../brain/engine/graph";
import {
  DEFAULT_FILTERS,
  groupOfNode,
  setSelected,
  type EdgeKind,
  type FileNode,
  type ViewKind,
} from "../../brain/engine/world";
import { errorMessage } from "../../views/shared";
import { useLaminas } from "../projections";
import type { SceneViewProps } from "../sceneViews";
import { BrainSceneCanvas, type EdgeCard, type GroupCard, type StarCard } from "./BrainSceneCanvas";
import { BrainSceneGauge } from "./BrainSceneGauge";
import { BrainSceneLegend, type LegendItem } from "./BrainSceneLegend";
import { openCleanup } from "../../brain/cleanupEvents";
import { BrainSceneMenu } from "./BrainSceneMenu";
import { BrainSceneReader, type RailEntry, type RailGroup, type SheetPreview } from "./BrainSceneReader";
import { BrainSceneTrail, type TrailCrumb } from "./BrainSceneTrail";
import {
  DIMENSIONS,
  layoutAreas,
  layoutLinks,
  layoutTime,
  layoutTypes,
  type DimLayout,
  type Dimension,
  type GuideLabel,
} from "./brainDimensions";
import { egoLayout } from "./brainEgo";
import { inferKind, type ContentKind } from "./brainGlyphs";
import { buildModel, nebulaeOf, starLabel } from "./brainModel";
import { contextOf, cut, excerptOf, relationRank, RELATION_ORDER } from "./brainReading";
import type { Vec3 } from "./brainSpace";
import {
  createStage,
  diveTo,
  enterNote,
  flyFit,
  flyHome,
  frameEgo,
  flyTo,
  igniteBurst,
  leaveNote,
  overviewDistance,
  posOf,
  refreshEgo,
  setLayout,
  setModel,
  syncFrame,
  targetOf,
} from "./brainStage";
import { buildCorpus, keyTerms, notesWith, sharedTermNeighbours, whyTerms } from "./brainTerms";
import { countPresent, cutoffFor, histogram, timelineSpan } from "./brainTimeline";
import { edgeBetween, planTour, type TourPlan } from "./brainTour";
import {
  back as trailBack,
  current as trailHere,
  EMPTY_TRAIL,
  follow,
  forward as trailForward,
  jump as trailJump,
  prune,
  type Trail,
} from "./brainTrail";
import { distanceForLevel } from "./brainZoom";
import "./brainScene.css";
import { RequestFailed } from "../../brain/RequestFailed";
import { graphRequest, useBrainSearch, useRelatedFiles } from "../../brain/memoryData";
import { useWorkContext } from "../../contexts/useWorkContext";
import {
  BrainViewSwitch,
  NotesView,
  useBrainMode,
  useBrainViewCommands,
  type BrainModeState,
} from "../../brain/BrainViewSwitch";

const GRAPH_PARAMS = { maxNodes: 3000 };
const NO_SKILLS: Skill[] = [];
const NO_ROUTINES: RoutineStatus[] = [];
const NO_CONNECTORS: Connector[] = [];
const CLASSIC_KEY = "mordomo.brainScene.classic";
const HELP_KEY = "mordomo.brainScene.navHelp";
const DIM_KEY = "mordomo.brainScene.dim";
const TOUR_DWELL_MS = 5600;
const HIST_BINS = 48;
const NARROW = "(max-width: 760px)";
const KIND_KEYS: Record<EdgeKind, TKey> = {
  "markdown-link": "brain.kind.markdown-link",
  wikilink: "brain.kind.wikilink",
  related: "brain.kind.related",
  "same-dir": "brain.kind.same-dir",
  other: "brain.kind.other",
};
const CONTENT_KEYS: Record<ContentKind, TKey> = {
  note: "scene.brain.kind.note",
  journal: "scene.brain.kind.journal",
  index: "scene.brain.kind.index",
  project: "scene.brain.kind.project",
  person: "scene.brain.kind.person",
  meeting: "scene.brain.kind.meeting",
  tasks: "scene.brain.kind.tasks",
  web: "scene.brain.kind.web",
  code: "scene.brain.kind.code",
  data: "scene.brain.kind.data",
  config: "scene.brain.kind.config",
  image: "scene.brain.kind.image",
  pdf: "scene.brain.kind.pdf",
  doc: "scene.brain.kind.doc",
  file: "scene.brain.kind.file",
};
/** The navigation help: what the hand and the keys do in the sky. */
const HELP_ROWS: ReadonlyArray<[TKey, TKey]> = [
  ["scene.brain.help.orbit.k", "scene.brain.help.orbit.v"],
  ["scene.brain.help.pan.k", "scene.brain.help.pan.v"],
  ["scene.brain.help.zoom.k", "scene.brain.help.zoom.v"],
  ["scene.brain.help.click.k", "scene.brain.help.click.v"],
  ["scene.brain.help.home.k", "scene.brain.help.home.v"],
  ["scene.brain.help.fly.k", "scene.brain.help.fly.v"],
  ["scene.brain.help.rise.k", "scene.brain.help.rise.v"],
  ["scene.brain.help.frame.k", "scene.brain.help.frame.v"],
  ["scene.brain.help.esc.k", "scene.brain.help.esc.v"],
];
/** Kinds whose preview text is prose worth an excerpt. */
const PROSE: ReadonlySet<ContentKind> = new Set([
  "note",
  "journal",
  "index",
  "project",
  "person",
  "meeting",
  "tasks",
  "web",
]);

/** One-line excerpts of notes, by path and change time: they survive leaving the scene. */
const EXCERPTS = new Map<string, string>();
const excerptKey = (f: Pick<FileNode, "path" | "mtime">) => `${f.path}|${f.mtime}`;

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, [query]);
  return on;
}

export default function BrainScene({ onMetaChanged }: SceneViewProps) {
  const [classic, setClassicState] = useState(() => {
    try {
      return sessionStorage.getItem(CLASSIC_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setClassic = useCallback((on: boolean) => {
    setClassicState(on);
    try {
      if (on) sessionStorage.setItem(CLASSIC_KEY, "1");
      else sessionStorage.removeItem(CLASSIC_KEY);
    } catch {
      /* the choice lasts for this visit */
    }
  }, []);
  const brain = useBrainMode();
  // The classic map is the frame's brain, which has the row and the commands of its own.
  useBrainViewCommands(brain);
  if (brain.mode === "notes") return <NotesMode brain={brain} />;
  if (classic) return <ClassicMap onBack={() => setClassic(false)} onMetaChanged={onMetaChanged} />;
  return <Constellation onClassic={() => setClassic(true)} view={brain} />;
}

/** The scene's "Notas" mode (.specs/features/cerebro-vista-notas, AC 1): the same notes view as the frame's, under the HUD. */
function NotesMode({ brain }: { brain: BrainModeState }) {
  return (
    <div className="bs-notes">
      <BrainViewSwitch mode="notes" onChoose={(mode) => brain.go(mode)} />
      <Suspense fallback={<Skeleton lines={6} />}>
        <NotesView onShowInGraph={(id) => brain.go("graph", `?sel=${id}&local=1&hops=1`)} />
      </Suspense>
    </div>
  );
}

/** The production Second Brain, full screen, with a way back to the sky. */
function ClassicMap({ onBack, onMetaChanged }: { onBack: () => void; onMetaChanged: () => void }) {
  const t = useT();
  const View = APPS.brain.Component;
  return (
    <div className="bs-classic">
      <View onMetaChanged={onMetaChanged} />
      <button type="button" className="bs-back" onClick={onBack}>
        ✦ {t("scene.brain.backToSky")}
      </button>
    </div>
  );
}

interface TourState {
  plan: TourPlan;
  step: number;
  playing: boolean;
}

function Constellation({ onClassic, view }: { onClassic: () => void; view: BrainModeState }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const navigate = useOsNavigate();
  const invalidate = useInvalidate();
  const { economy } = useWorkspace();
  const { openDoc } = useDesktopActions();
  const laminas = useLaminas();
  const narrow = useMedia(NARROW);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [stage] = useState(createStage);
  const dirty = useCallback(() => stage.wake(), [stage]);
  /** Where some stars are headed in the current arrangement (the visible ones): what a flight frames. */
  const membersAt = useCallback(
    (members: readonly number[]): Vec3[] => {
      const base = { ...stage, ego: null };
      const on = members.filter((i) => stage.target[i] !== 0);
      return (on.length > 0 ? on : members).map((i) => targetOf(base, i));
    },
    [stage],
  );
  // Development builds expose the stage for the visual and performance checks.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __brainStage?: unknown }).__brainStage = stage;
  }, [stage]);

  /* ---------- data ---------- */
  // In the active work context (cerebro-contextos AC 32): its files only; the whole index without one.
  const work = useWorkContext();
  const graphReq = graphRequest(GRAPH_PARAMS.maxNodes, work.query);
  const graphQuery = useApiQuery<GraphData>(graphReq.key, graphReq.path, { enabled: work.ready });
  const uiPreferencesQuery = useOsUiPreferences();
  const skillsQuery = useOsSkills();
  const graph = graphQuery.data ?? null;
  const skillSlugs = useMemo(
    () => new Set((skillsQuery.data ?? []).filter((s) => s.enabled).map((s) => s.slug)),
    [skillsQuery.data],
  );
  const ringLabels = useMemo(
    () => ({
      skills: t("brain.ring.skills"),
      memory: t("brain.ring.memory"),
      routines: t("brain.ring.routines"),
      apps: t("brain.ring.apps"),
    }),
    [t],
  );

  /* ---------- timeline ---------- */
  const now = useMemo(() => {
    void graph;
    return Date.now();
  }, [graph]);
  const mtimes = useMemo(() => (graph?.nodes ?? []).map((n) => n.mtime), [graph]);
  const span = useMemo(() => timelineSpan(mtimes, now), [mtimes, now]);
  const [daysAgo, setDaysAgo] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const cutoff = cutoffFor(Math.min(daysAgo, span), now);

  /* ---------- state plumbing (URL ⇄ settings ⇄ world), shared with the classic map ---------- */
  const brain = useBrainState({
    graph,
    skills: NO_SKILLS,
    routines: NO_ROUTINES,
    connectors: NO_CONNECTORS,
    ringLabels,
    timeline: cutoff,
    serverBlob: uiPreferencesQuery.data?.brain,
    dirty,
  });
  const { ui, uiRef, patch, world, version } = brain;

  // Areas when the files have them; folders otherwise (an unsorted sky is one grey cloud).
  const anyArea = useMemo(() => (graph?.nodes ?? []).some((n) => n.area), [graph]);
  const grouping: ViewKind = ui.view === "areas" && !anyArea ? "folders" : ui.view;
  const groupKey = useCallback((n: GraphNode) => groupOfNode(n, grouping), [grouping]);
  const areasLabel = grouping === "areas" ? t("scene.brain.areas") : t("scene.brain.folders");

  /* ---------- the sky ---------- */
  const [sky, setSky] = useState<{
    rev: number;
    clusters: Array<{ key: string; count: number; color: string }>;
    links: number;
  }>({ rev: 0, clusters: [], links: 0 });
  const idIndex = useRef(new Map<number, number>());
  const firstSky = useRef(true);
  const measureRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    stage.economy = economy;
    stage.reduced = reduced;
    stage.wake();
  }, [stage, economy, reduced]);

  useEffect(() => {
    const w = world.current;
    if (w.files.length === 0) return;
    const counts = new Map<string, number>();
    const files = w.files.map((f) => {
      const group = groupKey(f);
      counts.set(group, (counts.get(group) ?? 0) + 1);
      return {
        id: f.id,
        name: f.name,
        title: f.title,
        group,
        degree: f.degree,
        mtime: f.mtime,
        tint: f.tint,
        kind: inferKind(f),
      };
    });
    const order = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
    const model = buildModel(files, w.edges, w.adjacency, { order, enabled: w.edgeKinds, now: Date.now() });
    idIndex.current = new Map(w.files.map((f, i) => [f.id, i]));
    setModel(stage, model);
    for (let i = 0; i < w.files.length; i++) stage.target[i] = w.files[i]!.visible ? 1 : 0;
    setSky((s) => ({
      rev: s.rev + 1,
      clusters: model.clusters.map((c) => ({ key: c.key, count: c.count, color: c.color })),
      links: model.edges.length,
    }));
  }, [version, ui.edgeKinds, ui.groups, groupKey, world, stage]);

  // Visibility: the timeline and local mode (the world decides, the sky fades).
  useEffect(() => {
    const w = world.current;
    const n = Math.min(w.files.length, stage.target.length);
    for (let i = 0; i < n; i++) stage.target[i] = w.files[i]!.visible ? 1 : 0;
    stage.cutoff = cutoff;
    stage.wake();
  }, [sky.rev, version, cutoff, ui.local, ui.localHops, ui.sel, world, stage]);

  /* ---------- dimensions: the same stars, four arrangements ---------- */
  const [dim, setDimState] = useState<Dimension>(() => {
    try {
      const v = localStorage.getItem(DIM_KEY);
      return (DIMENSIONS as readonly string[]).includes(v ?? "") ? (v as Dimension) : "areas";
    } catch {
      return "areas";
    }
  });
  const setDim = useCallback((d: Dimension) => {
    setDimState(d);
    try {
      localStorage.setItem(DIM_KEY, d);
    } catch {
      /* per visit */
    }
  }, []);
  const [lens, setLens] = useState<string | null>(null);
  const guideText = useCallback(
    (l: GuideLabel | undefined): string => {
      if (!l) return "";
      switch (l.kind) {
        case "group":
          return l.key;
        case "now":
          return t("scene.brain.now");
        case "type":
          return t(CONTENT_KEYS[l.key]);
        case "degree":
          return l.min === 0 && l.max === 0
            ? t("scene.brain.orphans")
            : l.max === null
              ? t("scene.brain.degreeCore", { min: l.min })
              : l.max === l.min
                ? t("scene.brain.links", { n: l.min })
                : t("scene.brain.degreeBand", { min: l.min, max: l.max });
        case "time": {
          const d = new Date(l.at);
          if (l.unit === "year") return String(d.getFullYear());
          if (l.unit === "month") return d.toLocaleDateString(lang, { month: "short", year: "numeric" });
          return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
        }
      }
    },
    [t, lang],
  );
  const [layoutRev, setLayoutRev] = useState<DimLayout | null>(null);
  const layoutCache = useRef(new Map<string, DimLayout>());
  const prevDim = useRef<Dimension | null>(null);
  useEffect(() => {
    const m = stage.model;
    if (!m || sky.rev === 0) return;
    const key = `${sky.rev}:${dim}`;
    let lay = layoutCache.current.get(key);
    if (!lay) {
      if (layoutCache.current.size > 8) layoutCache.current.clear();
      lay =
        dim === "time"
          ? layoutTime(m.id.map((id, i) => ({ id, mtime: m.mtime[i]! })))
          : dim === "types"
            ? layoutTypes(m.id.map((id, i) => ({ id, mtime: m.mtime[i]!, kind: m.kind[i]! })))
            : dim === "links"
              ? layoutLinks(
                  m.id.map((id, i) => ({ id, degree: m.degree[i]! })),
                  m.edges,
                  m.pos,
                )
              : layoutAreas(m.pos, m.clusters, m.cluster);
      layoutCache.current.set(key, lay);
    }
    stage.nebulae = nebulaeOf(lay, m);
    stage.guideText = lay.guides.map((g) => guideText(g.label));
    stage.groupText = lay.groups.map((g) => guideText(g.label));
    const switched = prevDim.current !== null && prevDim.current !== dim;
    prevDim.current = dim;
    setLayout(stage, lay, performance.now());
    setLayoutRev(lay);
    // A new arrangement is framed whole (unless you are inside a note).
    if (switched && !stage.ego) flyHome(stage, performance.now());
  }, [sky.rev, dim, stage, guideText]);
  useEffect(() => setLens(null), [dim]);

  /* ---------- excerpts: a line of each note, read on demand ---------- */
  const [excerptRev, setExcerptRev] = useState(0);
  const excerptQueue = useRef<number[]>([]);
  const excerptWant = useRef(new Set<string>());
  const inflight = useRef(0);
  const bumpTimer = useRef(0);
  const pump = useCallback(() => {
    while (inflight.current < 3 && excerptQueue.current.length > 0) {
      const i = excerptQueue.current.shift()!;
      const f = world.current.files[i];
      if (!f) continue;
      const key = excerptKey(f);
      if (EXCERPTS.has(key)) continue;
      const kind = stage.model?.kind[i] ?? "note";
      if (!PROSE.has(kind)) {
        EXCERPTS.set(key, "");
        continue;
      }
      inflight.current++;
      void apiCall("GET /api/memory/preview", { query: { p: f.path } })
        .then((pv) => EXCERPTS.set(key, pv.kind === "text" && pv.content ? excerptOf(pv.content, 160) : ""))
        .catch(() => EXCERPTS.set(key, ""))
        .finally(() => {
          inflight.current--;
          stage.wake();
          if (!bumpTimer.current)
            bumpTimer.current = window.setTimeout(() => {
              bumpTimer.current = 0;
              setExcerptRev((r) => r + 1);
            }, 400);
          pump();
        });
    }
  }, [world, stage]);
  useEffect(() => () => window.clearTimeout(bumpTimer.current), []);
  const need = useCallback(
    (i: number) => {
      const f = world.current.files[i];
      if (!f) return;
      const key = excerptKey(f);
      if (EXCERPTS.has(key) || excerptWant.current.has(key)) return;
      excerptWant.current.add(key);
      excerptQueue.current.push(i);
      if (excerptQueue.current.length > 60) excerptQueue.current.splice(0, excerptQueue.current.length - 60);
      pump();
    },
    [world, pump],
  );
  const excerptAt = useCallback(
    (i: number): string | undefined => {
      const f = world.current.files[i];
      return f ? EXCERPTS.get(excerptKey(f)) : undefined;
    },
    [world],
  );
  useEffect(() => {
    stage.excerpt = excerptAt;
    stage.need = need;
  }, [stage, excerptAt, need]);

  /* ---------- selection + reading ---------- */
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [missing, setMissing] = useState(false);
  const [dangling, setDangling] = useState<string[]>([]);
  const [trail, setTrail] = useState<Trail>(EMPTY_TRAIL);
  const selectId = useCallback(
    (id: number | null) => {
      if (id !== null && id === uiRef.current.sel) {
        // Again on the note you are in: back to its whole space.
        if (stage.ego) {
          frameEgo(stage, performance.now());
        }
        return;
      }
      patch({ sel: id });
    },
    [patch, uiRef, stage],
  );
  const selNode = useMemo(() => {
    void version;
    return ui.sel === null ? null : (world.current.files.find((n) => n.id === ui.sel) ?? null);
  }, [ui.sel, version, world]);
  const selIdx = ui.sel === null ? -1 : (idIndex.current.get(ui.sel) ?? -1);

  // The note's context: who cites it, what it cites, what resembles it, what lives next to it.
  const context = useMemo(() => {
    void version;
    void sky.rev;
    if (selIdx < 0) return null;
    return contextOf(selIdx, world.current.edges, (i) => world.current.files[i]?.visible ?? false);
  }, [selIdx, version, sky.rev, world]);

  const egoFor = useCallback(
    (idx: number) => {
      const m = stage.model!;
      const ctx = contextOf(idx, world.current.edges, (i) => stage.target[i] === 1);
      return egoLayout(idx, m.adjacency, {
        sector: relationRank(ctx),
        weight: (i) => m.degree[i] ?? 0,
        allowed: (i) => stage.target[i] === 1,
      });
    },
    [stage, world],
  );
  const enteredRev = useRef(-1);
  /** A double click asked to dive into this star once it is open. */
  const diveNext = useRef(-1);
  useEffect(() => {
    const w = world.current;
    setSelected(w, ui.sel);
    applyVisibility(w);
    updateFocus(w);
    // Local mode follows the selection: the sky learns what stays visible now.
    const count = Math.min(w.files.length, stage.target.length);
    for (let i = 0; i < count; i++) stage.target[i] = w.files[i]!.visible ? 1 : 0;
    const idx = ui.sel === null ? -1 : (idIndex.current.get(ui.sel) ?? -1);
    stage.selIdx = idx;
    setMissing(ui.sel !== null && version > 0 && idx < 0 && w.files.length > 0);
    const m = stage.model;
    const nowMs = performance.now();
    if (idx >= 0 && m) {
      if (stage.ego?.centre !== idx) {
        enterNote(stage, egoFor(idx), nowMs, () => igniteBurst(stage, idx, performance.now()));
        enteredRev.current = sky.rev;
        if (diveNext.current === idx && stage.travel === null) diveTo(stage, idx, nowMs);
        diveNext.current = -1;
      } else if (enteredRev.current !== sky.rev) {
        // The links changed under the note you are in: its space rearranges in place.
        refreshEgo(stage, egoFor(idx), nowMs);
        enteredRev.current = sky.rev;
      }
      setTrail((tr) => follow(tr, ui.sel!));
    } else if (stage.ego) {
      leaveNote(stage, nowMs);
      setTrail(EMPTY_TRAIL);
    }
    stage.wake();
  }, [ui.sel, version, sky.rev, world, stage, egoFor]);
  useEffect(() => {
    setTrail((tr) => prune(tr, (id) => idIndex.current.has(id)));
  }, [sky.rev]);

  useEffect(() => {
    if (!selNode) {
      setPreview(null);
      setDangling([]);
      return;
    }
    let cancelled = false;
    setPreview({ node: selNode, content: null, kind: "loading", message: null });
    void apiCall("GET /api/memory/preview", { query: { p: selNode.path } })
      .then((pv) => {
        if (cancelled) return;
        setPreview({
          node: selNode,
          content: pv.content,
          kind: pv.kind,
          message: pv.message,
          editable: pv.editable,
        });
        if (pv.kind === "text" && pv.content) EXCERPTS.set(excerptKey(selNode), excerptOf(pv.content, 160));
      })
      .catch((err: Error) => {
        if (!cancelled)
          setPreview({ node: selNode, content: null, kind: "error", message: errorMessage(err, t) });
      });
    return () => {
      cancelled = true;
    };
  }, [selNode, t]);

  /* ---------- key terms, and what is close without being linked ---------- */
  const corpus = useMemo(() => {
    void excerptRev;
    const w = world.current;
    const why = w.files.map(() => [] as string[]);
    for (const e of w.edges) {
      const terms = whyTerms(e.why);
      if (terms.length === 0) continue;
      why[e.a]!.push(...terms);
      why[e.b]!.push(...terms);
    }
    return buildCorpus(
      w.files.map((f, i) =>
        [
          f.title ?? "",
          f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
          f.rel.split(/[\\/]/).slice(0, -1).join(" "),
          f.tags.join(" "),
          Object.values(f.fields ?? {}).join(" "),
          why[i]!.join(" "),
          EXCERPTS.get(excerptKey(f)) ?? "",
        ].join(" "),
      ),
    );
    // excerptRev stands for EXCERPTS' content; version for the world's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, excerptRev, world]);
  const noteTerms = useMemo(() => {
    if (!preview || preview.kind !== "text" || !preview.content || selIdx < 0) return [];
    const headings = (preview.content.match(/^#{1,6}\s+.+$/gm) ?? []).join(" ");
    return keyTerms(preview.content, corpus, {
      max: 7,
      emphasis: `${preview.node.title ?? ""} ${headings}`,
    }).map((k) => ({ term: k.term, n: notesWith(k.term, corpus, selIdx).length }));
  }, [preview, corpus, selIdx]);
  const [termHover, setTermHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setPinned(new Set());
    setTermHover(null);
  }, [ui.sel]);
  useEffect(() => {
    const on = new Set<number>();
    for (const term of [...pinned, ...(termHover ? [termHover] : [])])
      for (const i of notesWith(term, corpus, selIdx)) on.add(i);
    stage.termLit = on.size > 0 ? on : null;
    stage.wake();
  }, [pinned, termHover, corpus, selIdx, stage]);
  // Pinned terms widen the view to take in every star they light.
  const pinnedKey = [...pinned].sort().join("|");
  useEffect(() => {
    if (!stage.ego) return;
    const nowMs = performance.now();
    if (pinned.size === 0) {
      frameEgo(stage, nowMs);
      return;
    }
    const pts = [stage.ego.anchor, ...[...(stage.termLit ?? [])].map((i) => posOf(stage, i))];
    flyFit(stage, pts, nowMs, { min: 220 });
    // pinnedKey stands for `pinned`'s content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedKey, stage]);

  // A failed request is said (and can be asked again), never shown as "nothing related" (cerebro-correcoes, AC 25);
  // in the active work context, as the graph and the search (cerebro-vista-notas, C74).
  const relatedFiles = useRelatedFiles(selNode?.id ?? null, work.query);
  const relatedFailed = relatedFiles.failed;
  const related = useMemo(
    () => relatedFiles.related.map((r) => ({ id: r.file.id, why: r.why })),
    [relatedFiles.related],
  );

  const kindOfIdx = useCallback((i: number): ContentKind => stage.model?.kind[i] ?? "note", [stage]);
  const entryOf = useCallback(
    (i: number, fallback: string): RailEntry | null => {
      const f = world.current.files[i];
      if (!f) return null;
      const ex = excerptAt(i);
      return {
        index: i,
        id: f.id,
        label: starLabel(f, 60),
        kind: kindOfIdx(i),
        group: groupKey(f),
        line: ex ? cut(ex, 110) : fallback,
      };
    },
    [world, excerptAt, kindOfIdx, groupKey],
  );
  const whyLine = useCallback(
    (why: string) => {
      const terms = whyTerms(why);
      return terms.length > 0 ? t("scene.brain.shared", { terms: terms.join(", ") }) : "";
    },
    [t],
  );
  const railGroups = useMemo<RailGroup[]>(() => {
    void excerptRev;
    if (!context) return [];
    return RELATION_ORDER.flatMap((relation) => {
      const entries = context[relation]
        .map((e) => entryOf(e.index, whyLine(e.why)))
        .filter((e): e is RailEntry => e !== null)
        .sort((a, b) => a.label.localeCompare(b.label));
      return entries.length > 0 ? [{ relation, entries }] : [];
    });
  }, [context, entryOf, whyLine, excerptRev]);
  const nearby = useMemo<RailEntry[]>(() => {
    void excerptRev;
    const m = stage.model;
    if (selIdx < 0 || !m) return [];
    const linked = new Set<number>([selIdx, ...(m.adjacency[selIdx] ?? [])]);
    const out: RailEntry[] = [];
    for (const r of related) {
      const i = idIndex.current.get(r.id);
      if (i === undefined || linked.has(i) || !world.current.files[i]?.visible) continue;
      const entry = entryOf(i, whyLine(r.why));
      if (entry) out.push(entry);
      linked.add(i);
      if (out.length >= 6) break;
    }
    if (out.length < 3 && noteTerms.length > 0)
      for (const s of sharedTermNeighbours(
        noteTerms.map((k) => k.term),
        corpus,
        selIdx,
        linked,
        6 - out.length,
      )) {
        const entry = entryOf(s.index, t("scene.brain.shared", { terms: s.shared.join(", ") }));
        if (entry) out.push(entry);
      }
    return out;
  }, [selIdx, related, noteTerms, corpus, entryOf, whyLine, t, stage, world, excerptRev]);
  // The rail's notes want their excerpts.
  useEffect(() => {
    for (const g of railGroups) for (const e of g.entries.slice(0, 12)) need(e.index);
    for (const e of nearby) need(e.index);
  }, [railGroups, nearby, need]);

  /* ---------- search: the sky's matches + the server's content hits ---------- */
  const search = useBrainSearch(ui.query, 8, work.query);
  const hits = search.hits;
  const [searchFocus, setSearchFocus] = useState(false);

  const [lit, setLit] = useState<number[] | null>(null);
  useEffect(() => {
    const w = world.current;
    let set: Set<number> | null = null;
    let labelled = true;
    if (w.matched) {
      set = new Set();
      for (const id of w.matched) {
        const i = idIndex.current.get(id);
        if (i !== undefined) set.add(i);
      }
      if (ui.query.trim())
        for (const h of hits) {
          const i = idIndex.current.get(h.id);
          if (i !== undefined) set.add(i);
        }
    } else if (ui.filterGroup) {
      const m = stage.model;
      const ci = m?.clusters.findIndex((c) => c.key === ui.filterGroup) ?? -1;
      if (m && ci >= 0) set = new Set(m.cluster.flatMap((c, i) => (c === ci ? [i] : [])));
      labelled = false;
    } else if (lens && layoutRev) {
      const g = layoutRev.groups.find((x) => x.key === lens);
      if (g) set = new Set(g.members);
      labelled = false;
    }
    stage.highlight = set;
    stage.labelHighlight = labelled;
    stage.wake();
    setLit(set ? [...set] : null);
  }, [ui.query, ui.filters, ui.filterGroup, hits, sky.rev, version, world, stage, lens, layoutRev]);

  // Typing flies to the matches (once the typing settles); a deep link `?q=` too.
  const litKey = lit ? lit.join(",") : "";
  useEffect(() => {
    if (!ui.query.trim() || !lit || lit.length === 0 || uiRef.current.sel !== null) return;
    const id = window.setTimeout(() => {
      const pts = lit.filter((i) => stage.target[i]).map((i) => targetOf(stage, i));
      if (pts.length === 0) return;
      flyFit(stage, pts, performance.now(), { min: 240 });
    }, 420);
    return () => window.clearTimeout(id);
    // litKey stands for `lit`'s content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litKey, ui.query, stage, uiRef]);

  // The first sky arrives from further out (a dive), unless a deep link already chose where to look.
  // It waits for the canvas and the instruments (a later refresh of the data must not cancel it).
  const firstRaf = useRef(0);
  useEffect(() => {
    if (sky.rev === 0 || !firstSky.current) return;
    firstSky.current = false;
    if (uiRef.current.sel !== null || uiRef.current.query.trim()) return;
    let frames = 0;
    const go = () => {
      if (frames++ < 2 || (!stage.frame && frames < 60)) {
        firstRaf.current = requestAnimationFrame(go);
        return;
      }
      firstRaf.current = 0;
      if (uiRef.current.sel !== null) return;
      measureRef.current();
      const group = uiRef.current.filterGroup;
      const g = group ? stage.layout?.groups.find((x) => x.key === group) : undefined;
      if (g) flyFit(stage, membersAt(g.members), performance.now(), { min: 240 });
      else flyHome(stage, performance.now());
    };
    firstRaf.current = requestAnimationFrame(go);
  }, [sky.rev, stage, uiRef, membersAt]);
  useEffect(() => () => cancelAnimationFrame(firstRaf.current), []);

  /* ---------- the free part of the screen: the camera centres in it ---------- */
  const sheetOpen = preview !== null;
  const [listOpen, setListOpen] = useState(false);
  const dock: "right" | "left" = laminas.length > 0 && !narrow ? "left" : "right";
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    // The scene may be mid-zoom (the shell scales it in): measure in its own, untransformed pixels.
    const k = box.width > 0 ? root.offsetWidth / box.width : 1;
    const rr = {
      left: box.left,
      top: box.top,
      right: box.left + root.offsetWidth / k,
      bottom: box.top + root.offsetHeight / k,
      width: root.offsetWidth,
    };
    const cs = getComputedStyle(root);
    const hud = parseFloat(cs.getPropertyValue("--nu-hud")) || 68;
    const voice = parseFloat(cs.getPropertyValue("--nu-voice-h")) || 150;
    // A module spine on the left, unless the shell already set the scene beside it.
    let pageLeft = 0;
    for (let el: HTMLElement | null = root; el; el = el.offsetParent as HTMLElement | null)
      pageLeft += el.offsetLeft;
    const spine = Math.max(0, (parseFloat(cs.getPropertyValue("--nu-spine")) || 0) - pageLeft);
    root.style.setProperty("--bs-spine", `${spine}px`);
    const ins = { top: hud, right: 0, bottom: voice, left: spine };
    // Narrow, the tools take a band under the HUD: the sky strip starts below them.
    const tools = root.querySelector(".bs-tools-row")?.getBoundingClientRect();
    if (tools && rr.width <= 760) ins.top = Math.max(ins.top, (tools.bottom - rr.top) * k + 6);
    const sheet = sheetRef.current?.getBoundingClientRect();
    if (sheet && sheet.width > 0) {
      if (rr.width <= 760) ins.bottom = Math.max(ins.bottom, (rr.bottom - sheet.top) * k);
      else if (dockRef.current === "right") ins.right = (rr.right - sheet.left) * k + 12;
      else ins.left = (sheet.right - rr.left) * k + 12;
    }
    const list = listRef.current?.getBoundingClientRect();
    if (list && list.width > 0 && rr.width > 760)
      ins.left = Math.max(ins.left, (list.right - rr.left) * k + 12);
    const lam = document.querySelector(".nu-laminas")?.getBoundingClientRect();
    if (lam && lam.width > 0 && rr.width > 760)
      ins.right = Math.max(ins.right, (rr.right - lam.left) * k + 12);
    // The instruments floating over the sky frame it too: the legend on the left, the gauge
    // on the right, the timeline (or the tour's voice) above the voice line.
    const rel = (sel: string) => {
      const b = root.querySelector(sel)?.getBoundingClientRect();
      return b && b.width > 0 && b.height > 0
        ? { l: (b.left - rr.left) * k, t: (b.top - rr.top) * k, r: (b.right - rr.left) * k }
        : null;
    };
    const H = root.offsetHeight;
    if (rr.width > 760) {
      const legend = rel(".bs-legend");
      if (legend) ins.left = Math.max(ins.left, legend.r + 18);
      const gauge = rel(".bs-gauge");
      if (gauge) ins.right = Math.max(ins.right, rr.width - gauge.l + 14);
    }
    const bottomBar = rel(".bs-time") ?? rel(".bs-tourbar");
    if (bottomBar && bottomBar.t > H * 0.5) ins.bottom = Math.max(ins.bottom, H - bottomBar.t + 10);
    stage.insets = ins;
    syncFrame(stage);
    stage.blocked = [
      ...root.querySelectorAll(
        ".bs-legend, .bs-tools-row, .bs-results, .bs-gauge, .bs-time, .bs-tourbar, .bs-trail-dock, .bs-help",
      ),
    ]
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b): [number, number, number, number] => [
        (b.left - rr.left) * k,
        (b.top - rr.top) * k,
        b.width * k,
        b.height * k,
      ]);
    stage.wake();
  }, [stage]);
  measureRef.current = measure;
  useLayoutEffect(() => {
    measure();
    // Again once the reader and the lâminas have finished sliding.
    const id = window.setTimeout(measure, 700);
    return () => window.clearTimeout(id);
  }, [measure, sheetOpen, dock, listOpen, laminas.length, narrow]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const shell = root.closest(".nu-shell");
    const mo = new MutationObserver(measure);
    if (shell) mo.observe(shell, { attributes: true, attributeFilter: ["style", "data-proj"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  /* ---------- the guided tour: it travels through the synapses ---------- */
  const [tour, setTour] = useState<TourState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const startTour = useCallback(() => {
    const w = world.current;
    const plan = planTour(
      w.files.map((f) => ({ id: f.id, group: groupKey(f), degree: f.degree, mtime: f.mtime })),
      w.adjacency,
      { allowed: (i) => w.files[i]!.visible },
    );
    if (!plan) {
      toast(t("scene.brain.tourNone"), "info");
      return;
    }
    setMenuOpen(false);
    setTour({ plan, step: 0, playing: true });
  }, [world, groupKey, toast, t]);
  const tourStop = tour ? tour.plan.stops[tour.step] : undefined;
  useEffect(() => {
    if (tourStop === undefined) return;
    const f = world.current.files[tourStop];
    if (f) selectId(f.id);
  }, [tourStop, world, selectId]);
  useEffect(() => {
    if (!tour?.playing) return;
    const last = tour.step >= tour.plan.stops.length - 1;
    const id = window.setTimeout(
      () =>
        setTour((cur) => (cur ? (last ? { ...cur, playing: false } : { ...cur, step: cur.step + 1 }) : cur)),
      TOUR_DWELL_MS,
    );
    return () => window.clearTimeout(id);
  }, [tour]);
  const caption = useMemo(() => {
    if (!tour) return null;
    const w = world.current;
    const idx = tour.plan.stops[tour.step]!;
    const f = w.files[idx];
    if (!f) return null;
    const name = starLabel(f, 60);
    const area = groupKey(f);
    if (tour.plan.kind === "recent")
      return t("scene.brain.tour.recent", { name, area, ago: timeAgo(f.mtime, lang) });
    if (tour.step === 0) return t("scene.brain.tour.start", { name, area, n: f.degree });
    const prevIdx = tour.plan.stops[tour.step - 1]!;
    const prev = w.files[prevIdx];
    const edge = edgeBetween(w.edges, prevIdx, idx);
    const kind = edge
      ? (edge.why?.trim() ? edge.why.trim() : t(KIND_KEYS[edge.kind])).replace(/[.\s]+$/, "")
      : "";
    const via = t("scene.brain.tour.via", { prev: prev ? starLabel(prev, 40) : "", name, kind });
    return tour.step === tour.plan.stops.length - 1
      ? `${via} ${t("scene.brain.tour.end", { steps: tour.plan.stops.length })}`
      : via;
  }, [tour, world, groupKey, t, lang]);

  /* ---------- timeline replay ---------- */
  useEffect(() => {
    if (!replaying) return;
    const step = Math.max(1, Math.round(span / 60));
    const id = window.setInterval(() => {
      setDaysAgo((d) => {
        const next = Math.max(0, d - step);
        if (next === 0) setReplaying(false);
        return next;
      });
    }, 90);
    return () => window.clearInterval(id);
  }, [replaying, span]);
  const hist = useMemo(() => histogram(mtimes, now, span, HIST_BINS), [mtimes, now, span]);
  const histMax = Math.max(1, ...hist);
  const present = countPresent(mtimes, cutoff);

  /* ---------- indexing ---------- */
  const [progress, setProgress] = useState<IndexProgressPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useOsEvent("index.progress", (e) => setProgress(e.payload as IndexProgressPayload));
  useOsEvent(["index.finished", "index.failed"], () => {
    setProgress(null);
    void invalidate(qk.memoryGraph(GRAPH_PARAMS), qk.memoryStatus);
  });
  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        const res = await apiCall("POST /api/memory/index");
        await apiCall("POST /api/memory/routers");
        await invalidate(qk.memoryGraph(GRAPH_PARAMS), qk.memoryStatus);
        toast(t("brain.indexed", { n: res.stats.scanned, added: res.stats.added }), "ok");
      } catch (err) {
        toast(errorMessage(err, t), "danger");
      } finally {
        setRefreshing(false);
        setProgress(null);
      }
    })();
  }, [invalidate, toast, t]);

  /* ---------- actions ---------- */
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendAll, setLegendAll] = useState(false);
  const flyToCluster = useCallback(
    (key: string) => {
      const m = stage.model;
      const cl = m?.clusters.find((c) => c.key === key);
      if (!cl) return;
      setTour(null);
      if (uiRef.current.sel !== null) patch({ sel: null });
      const on = uiRef.current.filterGroup === key;
      patch({ filterGroup: on ? null : key });
      const g = stage.layout?.groups.find((x) => x.key === key);
      if (on || !g) flyHome(stage, performance.now());
      else flyFit(stage, membersAt(g.members), performance.now(), { min: 240 });
      if (narrow) setLegendOpen(false);
    },
    [stage, uiRef, patch, narrow, membersAt],
  );
  const flyToLens = useCallback(
    (key: string) => {
      const g = stage.layout?.groups.find((x) => x.key === key);
      if (!g) return;
      setTour(null);
      if (uiRef.current.sel !== null) patch({ sel: null });
      const on = lens === key;
      setLens(on ? null : key);
      if (on) flyHome(stage, performance.now());
      else flyFit(stage, membersAt(g.members), performance.now(), { min: 240 });
      if (narrow) setLegendOpen(false);
    },
    [stage, uiRef, patch, lens, narrow, membersAt],
  );
  const reference = useCallback(
    (ask?: string) => {
      const node = preview?.node;
      if (!node) return;
      const base = readConsoleDraft();
      const lead = base.text.trimEnd();
      const draft = withConsoleReference(
        ask ? { ...base, text: `${lead ? `${lead} ` : ""}${ask}` } : base,
        node.path,
        t("brain.consoleSource"),
      );
      if (!storeConsoleDraft(draft)) toast(t("brain.consoleStorageFailed"), "danger");
      window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".cons-input")?.focus());
    },
    [preview, t, toast],
  );
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
    setTour(null);
    setReplaying(false);
    setDaysAgo(0);
    setLens(null);
    patch({
      sel: null,
      query: "",
      filterGroup: null,
      filters: { ...DEFAULT_FILTERS },
      groups: [],
      local: false,
    });
    flyHome(stage, performance.now());
  }, [patch, stage]);

  const onPick = useCallback(
    (idx: number) => {
      const f = world.current.files[idx];
      if (!f) return;
      setTour(null);
      selectId(f.id);
    },
    [world, selectId],
  );
  const onEmpty = useCallback(() => {
    setTour(null);
    if (uiRef.current.sel !== null) patch({ sel: null });
    else if (uiRef.current.filterGroup) patch({ filterGroup: null });
    else if (lens) setLens(null);
  }, [uiRef, patch, lens]);
  const describe = useCallback(
    (idx: number): StarCard => {
      const m = stage.model;
      if (!m) return { title: "", kind: "note", meta: "", links: "" };
      const f = world.current.files[idx];
      const ex = excerptAt(idx);
      if (ex === undefined) need(idx);
      const kind = m.kind[idx] ?? "note";
      return {
        title: m.label[idx] ?? "",
        kind,
        meta: [m.group[idx], t(CONTENT_KEYS[kind]), f ? timeAgo(f.mtime, lang) : ""]
          .filter(Boolean)
          .join(" · "),
        excerpt: ex ? cut(ex, 150) : undefined,
        pending: ex === undefined && PROSE.has(kind),
        links: t("scene.brain.links", { n: m.incident[idx]?.length ?? 0 }),
      };
    },
    [stage, world, excerptAt, need, t, lang],
  );
  const describeEdge = useCallback(
    (e: number): EdgeCard | null => {
      const m = stage.model;
      const ed = m?.edges[e];
      if (!m || !ed) return null;
      const kind = (KIND_KEYS as Record<string, TKey | undefined>)[ed.kind] ?? KIND_KEYS.other;
      const why = ed.why.trim();
      return {
        title: `${m.label[ed.a] ?? ""} ↔ ${m.label[ed.b] ?? ""}`,
        kind: t(kind),
        why: why ? cut(why, 150) : "",
      };
    },
    [stage, t],
  );
  const describeGroup = useCallback(
    (gi: number): GroupCard | null => {
      const g = stage.layout?.groups[gi];
      if (!g) return null;
      return {
        title: stage.groupText[gi] || g.key,
        meta: t("scene.brain.present", { n: g.members.length }),
      };
    },
    [stage, t],
  );
  const words = useMemo(
    () => ({
      enter: t("scene.brain.enterHint"),
      exit: t("scene.brain.exitHint"),
      starHint: t("scene.brain.hint.star"),
      edgeHint: t("scene.brain.hint.edge"),
      groupHint: t("scene.brain.hint.group"),
    }),
    [t],
  );
  /** Frame everything (inside a note: its whole space). */
  const onHome = useCallback(() => {
    const nowMs = performance.now();
    if (stage.ego) {
      frameEgo(stage, nowMs);
    } else flyHome(stage, nowMs);
  }, [stage]);
  /** F: the note you are in, else what is lit (a search, an area, a lens), else everything. */
  const onFrame = useCallback(() => {
    if (stage.ego) return onHome();
    const lit0 = stage.highlight;
    if (lit0 && lit0.size > 0) flyFit(stage, membersAt([...lit0]), performance.now(), { min: 200 });
    else if (stage.hoverIdx >= 0) {
      const m = stage.model;
      const around = [stage.hoverIdx, ...(m?.adjacency[stage.hoverIdx] ?? [])];
      flyFit(stage, membersAt(around), performance.now(), { min: 200 });
    } else onHome();
  }, [stage, onHome, membersAt]);
  // A double click dives: open the note, then fly close to it once it is the centre.
  const onDive = useCallback(
    (idx: number) => {
      const f = world.current.files[idx];
      if (!f) return;
      setTour(null);
      if (stage.ego?.centre === idx) {
        diveTo(stage, idx, performance.now());
        return;
      }
      if (stage.ego?.hop.has(idx)) {
        // On the current space: the trip through the synapse is the dive.
        selectId(f.id);
        return;
      }
      diveNext.current = idx;
      selectId(f.id);
    },
    [world, stage, selectId],
  );
  const onGroup = useCallback(
    (gi: number) => {
      const g = stage.layout?.groups[gi];
      if (!g) return;
      if (stage.layout?.dim === "areas") flyToCluster(g.key);
      else flyToLens(g.key);
    },
    [stage, flyToCluster, flyToLens],
  );

  /* ---------- the navigation help: once on the first visit, then behind "?" ---------- */
  const [help, setHelp] = useState(() => {
    try {
      return !localStorage.getItem(HELP_KEY);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!help) return;
    try {
      localStorage.setItem(HELP_KEY, "1");
    } catch {
      /* it shows again next visit */
    }
  }, [help]);
  const helpTimer = useRef(0);
  const helpRef = useRef(help);
  helpRef.current = help;
  const onInteract = useCallback(() => {
    // Shown on its own, it steps aside a while after the hand starts flying.
    if (!helpRef.current || helpTimer.current) return;
    helpTimer.current = window.setTimeout(() => {
      helpTimer.current = 0;
      setHelp(false);
    }, 9000);
  }, []);
  useEffect(() => () => window.clearTimeout(helpTimer.current), []);
  const toggleHelp = useCallback(() => {
    window.clearTimeout(helpTimer.current);
    helpTimer.current = -1;
    setHelp((v) => !v);
  }, []);
  const goLevel = useCallback(
    (level: number) => {
      const nowMs = performance.now();
      if (level >= 3) {
        if (stage.ego) {
          frameEgo(stage, nowMs);
        } else if (stage.enterIdx >= 0) onPick(stage.enterIdx);
        else
          flyTo(
            stage,
            { x: stage.cam.tx, y: stage.cam.ty, z: stage.cam.tz },
            distanceForLevel(2, overviewDistance(stage)),
            nowMs,
          );
        return;
      }
      if (stage.ego) {
        patch({ sel: null });
        return;
      }
      if (level <= 0) flyHome(stage, nowMs);
      else
        flyTo(
          stage,
          { x: stage.cam.tx, y: stage.cam.ty, z: stage.cam.tz },
          distanceForLevel(level, overviewDistance(stage)),
          nowMs,
        );
    },
    [stage, onPick, patch],
  );

  /* ---------- the trail through the synapses ---------- */
  const goTrail = useCallback(
    (next: Trail) => {
      const id = trailHere(next);
      setTour(null);
      if (id !== null) selectId(id);
    },
    [selectId],
  );
  const crumbOf = useCallback(
    (id: number): TrailCrumb | null => {
      const i = idIndex.current.get(id);
      const f = i === undefined ? undefined : world.current.files[i];
      return f && i !== undefined ? { id, label: starLabel(f, 28), kind: kindOfIdx(i) } : null;
    },
    [world, kindOfIdx],
  );
  const trailNode = (
    <BrainSceneTrail
      trail={trail}
      crumbOf={crumbOf}
      onBack={() => goTrail(trailBack(trail))}
      onForward={() => goTrail(trailForward(trail))}
      onJump={(k) => goTrail(trailJump(trail, k))}
      compact={narrow}
    />
  );

  /* ---------- Escape: the tour, the reader, the list, the lens, the search — then the shell ---------- */
  const escState = useRef({ tour: false, listOpen, menuOpen, lens, help: false });
  escState.current = { tour: tour !== null, listOpen, menuOpen, lens, help };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (escState.current.menuOpen || getDialogDepth() > 0 || escapeLayerOpen()) return; // a popover, a hint or a dialog has it
      const target = e.target instanceof Node ? e.target : null;
      const el = target instanceof Element ? target : null;
      if (el?.closest('[role="dialog"], .nu-voice, .nu-laminas')) return;
      const root = rootRef.current;
      const onPage = target === document.body || target === document.documentElement;
      if (!onPage && !(target && root?.contains(target))) return;
      const st = escState.current;
      if (st.help) setHelp(false);
      else if (st.tour) setTour(null);
      else if (uiRef.current.sel !== null) patch({ sel: null });
      else if (st.listOpen) setListOpen(false);
      else if (st.lens) setLens(null);
      else if (uiRef.current.query.trim() || uiRef.current.filterGroup)
        patch({ query: "", filterGroup: null });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [patch, uiRef]);

  // Shift+1…4: the four arrangements.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || keyLayerOpen()) return;
      const m = /^Digit([1-4])$/.exec(e.code);
      if (!m) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (el?.closest('[role="dialog"], .nu-voice')) return;
      e.preventDefault();
      setDim(DIMENSIONS[Number(m[1]) - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDim]);

  // The floating type moved: the sky learns where not to write.
  const tourOn = tour !== null;
  useEffect(() => {
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [measure, dim, legendOpen, legendAll, tourOn, ui.query, layoutRev, help]);

  /* ---------- render ---------- */
  const total = graph?.totalFiles ?? 0;
  const loading = !graph && !graphQuery.isError;
  const failed = !graph && graphQuery.isError;
  const empty = graph !== null && graph.nodes.length === 0;
  const q = ui.query.trim();
  const litCount = lit?.length ?? 0;
  const dayLabel = daysAgo === 0 ? t("scene.brain.today") : t("scene.brain.daysAgo", { n: daysAgo });
  const dateLabel =
    cutoff === null ? "" : new Date(cutoff).toLocaleDateString(lang, { day: "numeric", month: "short" });

  const legendItems = useMemo<LegendItem[]>(() => {
    if (dim === "areas" || !layoutRev || layoutRev.dim !== dim) {
      return sky.clusters.map((c) => ({ key: c.key, label: c.key, count: c.count, color: c.color }));
    }
    return layoutRev.groups.map((g, gi) => ({
      key: g.key,
      label: guideText(g.label),
      count: g.members.length,
      color: stage.nebulae[gi]?.color,
      kind: g.label.kind === "type" ? g.label.key : undefined,
    }));
  }, [dim, layoutRev, sky.clusters, guideText, stage]);
  const legendHeading =
    dim === "areas"
      ? `${areasLabel} · ${t("scene.brain.count", { n: graph?.nodes.length ?? 0, links: sky.links })}`
      : dim === "time"
        ? t("scene.brain.timeLegend")
        : dim === "types"
          ? t("scene.brain.typesLegend")
          : t("scene.brain.linksLegend");
  const inside = preview !== null;
  const selKind = selIdx >= 0 ? kindOfIdx(selIdx) : "note";
  const kindOfId = useCallback(
    (id: number): ContentKind | null => {
      const i = idIndex.current.get(id);
      return i === undefined ? null : kindOfIdx(i);
    },
    [kindOfIdx],
  );
  const onTermPin = useCallback(
    (term: string) =>
      setPinned((cur) => {
        const next = new Set(cur);
        if (next.has(term)) next.delete(term);
        else next.add(term);
        return next;
      }),
    [],
  );
  const onPeek = useCallback(
    (id: number | null) => {
      stage.peekIdx = id === null ? -1 : (idIndex.current.get(id) ?? -1);
      stage.wake();
    },
    [stage],
  );
  const onProgress = useCallback(
    (p: number) => {
      stage.readProgress = p;
      stage.wake();
    },
    [stage],
  );
  const onReaderNote = useCallback(
    (id: number) => {
      setTour(null);
      stage.peekIdx = -1;
      selectId(id);
    },
    [selectId, stage],
  );
  const onReaderClose = useCallback(() => {
    setTour(null);
    patch({ sel: null });
  }, [patch]);
  const onSkill = useCallback((slug: string) => navigate(`/skills/${slug}`), [navigate]);
  const onLamina = useCallback(() => {
    if (!preview) return;
    openDoc(preview.node.path);
    setTour(null);
    patch({ sel: null });
  }, [preview, openDoc, patch]);
  const onCopy = useCallback(() => {
    if (!preview) return;
    void navigator.clipboard
      .writeText(preview.node.path)
      .then(() => toast(t("common.copied"), "ok"))
      .catch((error: Error) => toast(errorMessage(error, t), "danger"));
  }, [preview, toast, t]);
  const onEditor = useCallback(() => {
    if (!preview) return;
    void apiCall("POST /api/memory/open", { body: { p: preview.node.path } }).catch((e: Error) =>
      toast(e.message, "danger"),
    );
  }, [preview, toast]);

  return (
    <div
      ref={rootRef}
      className="bs"
      data-sheet={sheetOpen ? dock : undefined}
      data-list={listOpen ? "" : undefined}
      data-tour={tour ? "" : undefined}
      data-narrow={narrow ? "" : undefined}
      data-dim={dim}
    >
      <BrainViewSwitch mode="graph" onChoose={(mode) => view.go(mode)} />
      {graph && !empty && (
        <BrainSceneCanvas
          stage={stage}
          onPick={onPick}
          onEmpty={onEmpty}
          onDive={onDive}
          onHome={onHome}
          onFrame={onFrame}
          onGroup={onGroup}
          describe={describe}
          describeEdge={describeEdge}
          describeGroup={describeGroup}
          onInteract={onInteract}
          words={words}
          label={t("scene.brain.canvas")}
          describedBy="bs-live"
        />
      )}
      <p id="bs-live" className="sr-only" aria-live="polite">
        {total} {t("brain.sub")}
        {preview ? ` — ${t("scene.brain.selected", { name: starLabel(preview.node, 80) })}` : ""}
      </p>

      {/* ---- states ---- */}
      {(loading || failed || empty) && (
        <div className="bs-state" role={failed ? "alert" : "status"}>
          {loading && <p className="bs-state-title bs-breathe">{t("brain.loading")}</p>}
          {failed && (
            <>
              <p className="bs-state-title">{t("scene.brain.errorTitle")}</p>
              <p className="bs-faint">{graphQuery.error?.message}</p>
              <div className="bs-state-acts">
                <button type="button" className="bs-act" onClick={() => void graphQuery.refetch()}>
                  {t("common.retry")}
                </button>
              </div>
            </>
          )}
          {empty && (
            <>
              <p className="bs-state-title">{t("scene.brain.emptyTitle")}</p>
              <p className="bs-faint">{t("brain.noIndex")}</p>
              <div className="bs-state-acts">
                <button type="button" className="bs-act agent" onClick={refresh} disabled={refreshing}>
                  {refreshing ? t("brain.indexing") : t("brain.refresh")}
                </button>
                <button type="button" className="bs-act" onClick={() => navigate("/settings")}>
                  {t("scene.brain.settings")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- top-left: the dimensions and their legend — or, inside a note, the trail ---- */}
      {graph && !empty && !listOpen && !(inside && !narrow) && (
        <BrainSceneLegend
          dim={dim}
          onDim={setDim}
          areasLabel={areasLabel}
          heading={legendHeading}
          items={legendItems}
          active={dim === "areas" ? ui.filterGroup : lens}
          onItem={dim === "areas" ? flyToCluster : flyToLens}
          open={legendOpen}
          onToggle={() => setLegendOpen((v) => !v)}
          all={legendAll}
          onAll={() => setLegendAll((v) => !v)}
          footer={
            progress && (
              <p className="bs-eyebrow bs-indexing" role="status">
                {t("scene.brain.indexing", { scanned: progress.scanned, total: progress.total ?? "…" })}
              </p>
            )
          }
        />
      )}
      {inside && !narrow && !listOpen && <div className="bs-trail-dock">{trailNode}</div>}

      {/* ---- list view (the accessible alternative), in the legend's place ---- */}
      {listOpen && graph && (
        <div className="bs-list" ref={listRef}>
          <FileList
            graph={graph}
            groupOf={groupKey}
            selectedId={ui.sel}
            onSelect={(id) => {
              setTour(null);
              selectId(id);
            }}
            onClose={() => setListOpen(false)}
          />
        </div>
      )}

      {/* ---- the depth gauge (right edge) ---- */}
      {graph && !empty && !inside && <BrainSceneGauge stage={stage} onLevel={goLevel} onHome={onHome} />}

      {/* ---- tools (top-right): search, tour, more ---- */}
      {graph && !empty && (
        <div className="bs-tools">
          <div className="bs-tools-row">
            <label className="bs-search">
              <span className="sr-only">{t("scene.brain.search")}</span>
              <input
                ref={searchRef}
                type="search"
                value={ui.query}
                placeholder={t("scene.brain.searchPh")}
                onChange={(e) => patch({ query: e.target.value })}
                onFocus={() => setSearchFocus(true)}
                onBlur={() => window.setTimeout(() => setSearchFocus(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && lit && lit.length > 0) {
                    const first = world.current.files[lit[0]!];
                    if (first) selectId(first.id);
                  }
                }}
                spellCheck={false}
              />
            </label>
            <button type="button" className="bs-tour-btn" onClick={startTour} aria-pressed={tour !== null}>
              {t("scene.brain.tour")} <span aria-hidden>▸</span>
            </button>
            <Tooltip label={t("scene.brain.help")}>
              <button
                type="button"
                className="bs-help-btn"
                aria-label={t("scene.brain.help")}
                aria-expanded={help}
                onClick={toggleHelp}
              >
                ?
              </button>
            </Tooltip>
            <Tooltip label={t("scene.brain.more")}>
              <button
                ref={moreRef}
                type="button"
                className="bs-more"
                aria-label={t("scene.brain.more")}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⋯
              </button>
            </Tooltip>
          </div>
          {q && (
            <div className="bs-results" data-open={searchFocus || !sheetOpen ? "" : undefined}>
              <p className="bs-eyebrow" role="status">
                {litCount > 0 ? t("scene.brain.matches", { n: litCount }) : t("scene.brain.noMatches", { q })}
              </p>
              {search.failed && <RequestFailed message={t("brain.search.failed")} onRetry={search.retry} />}
              {!search.failed && hits.length > 0 && (searchFocus || !sheetOpen) && (
                <ul className="bs-hits" aria-label={t("scene.brain.inContent")}>
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setTour(null);
                          selectId(h.id);
                        }}
                      >
                        <span className="bs-link-name">{h.name}</span>
                        <small className="mono">{h.rel}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {help && (
            <section className="bs-help" aria-label={t("scene.brain.helpTitle")}>
              <header>
                <p className="bs-eyebrow">{t("scene.brain.helpTitle")}</p>
                <button
                  type="button"
                  className="bs-help-x"
                  aria-label={t("common.close")}
                  onClick={toggleHelp}
                >
                  ×
                </button>
              </header>
              <dl>
                {HELP_ROWS.map(([k, v]) => (
                  <div key={k}>
                    <dt>{t(k)}</dt>
                    <dd>{t(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      {menuOpen && (
        <Popover
          open
          onClose={() => setMenuOpen(false)}
          anchor={moreRef}
          placement="bottom-end"
          ariaLabel={t("scene.brain.more")}
          className="bs-menu"
        >
          <BrainSceneMenu
            ui={ui}
            patch={patch}
            kindCounts={brain.kindCounts}
            facets={brain.facets}
            hygiene={brain.report}
            dangling={dangling}
            refreshing={refreshing}
            listOpen={listOpen}
            truncated={graph?.truncated ?? false}
            onRefresh={refresh}
            onToggleList={() => {
              setListOpen((v) => !v);
              setMenuOpen(false);
            }}
            onClassic={onClassic}
            onReset={() => {
              reset();
              setMenuOpen(false);
            }}
            onBake={bake}
            onCleanup={() => {
              setMenuOpen(false);
              openCleanup();
            }}
            onNote={(id) => {
              setMenuOpen(false);
              selectId(id);
            }}
          />
        </Popover>
      )}

      {missing && (
        <div className="bs-missing" role="status">
          <p>{t("brain.missingSelection")}</p>
          <div className="bs-state-acts">
            <button type="button" className="bs-act" disabled={refreshing} onClick={refresh}>
              {t("brain.refresh")}
            </button>
            <button type="button" className="bs-act ghost" onClick={() => patch({ sel: null })}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}

      {/* ---- the reader ---- */}
      {preview && (
        <BrainSceneReader
          key={dock}
          sheetRef={sheetRef}
          preview={preview}
          kind={selKind}
          kindLabel={t(CONTENT_KEYS[selKind])}
          group={groupKey(preview.node)}
          degree={railGroups.reduce((s, g) => s + g.entries.length, 0)}
          files={world.current.files}
          skills={skillSlugs}
          lang={lang}
          caption={narrow ? caption : null}
          trail={narrow ? trailNode : undefined}
          context={railGroups}
          nearby={nearby}
          relatedFailed={relatedFailed}
          onRelatedRetry={relatedFiles.retry}
          terms={noteTerms}
          pinned={pinned}
          kindOfId={kindOfId}
          onTermHover={setTermHover}
          onTermPin={onTermPin}
          onClose={onReaderClose}
          onNote={onReaderNote}
          onPeek={onPeek}
          onProgress={onProgress}
          onSkill={onSkill}
          onLamina={onLamina}
          onReference={reference}
          onCopy={onCopy}
          onEditor={onEditor}
          onDangling={setDangling}
        />
      )}

      {/* ---- bottom: the tour's voice, or the timeline ---- */}
      {tour ? (
        <div className="bs-tourbar" role="region" aria-label={t("scene.brain.tour")}>
          <p className="bs-eyebrow">
            {t("scene.brain.tour")} ·{" "}
            {t("scene.brain.tour.step", { i: tour.step + 1, n: tour.plan.stops.length })}
          </p>
          <p className="bs-caption" aria-live="polite">
            {caption}
          </p>
          <div className="bs-tour-ctl">
            <Tooltip label={t("scene.brain.tour.prev")}>
              <button
                type="button"
                aria-label={t("scene.brain.tour.prev")}
                disabled={tour.step === 0}
                onClick={() =>
                  setTour((c) => (c ? { ...c, step: Math.max(0, c.step - 1), playing: false } : c))
                }
              >
                ‹
              </button>
            </Tooltip>
            <Tooltip label={tour.playing ? t("scene.brain.tour.pause") : t("scene.brain.tour.play")}>
              <button
                type="button"
                aria-label={tour.playing ? t("scene.brain.tour.pause") : t("scene.brain.tour.play")}
                onClick={() => setTour((c) => (c ? { ...c, playing: !c.playing } : c))}
              >
                {tour.playing ? "❚❚" : "▶"}
              </button>
            </Tooltip>
            <Tooltip label={t("scene.brain.tour.next")}>
              <button
                type="button"
                aria-label={t("scene.brain.tour.next")}
                disabled={tour.step >= tour.plan.stops.length - 1}
                onClick={() =>
                  setTour((c) =>
                    c ? { ...c, step: Math.min(c.plan.stops.length - 1, c.step + 1), playing: false } : c,
                  )
                }
              >
                ›
              </button>
            </Tooltip>
            <Tooltip label={t("scene.brain.tour.stop")}>
              <button type="button" aria-label={t("scene.brain.tour.stop")} onClick={() => setTour(null)}>
                ×
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        graph &&
        !empty &&
        span > 0 &&
        !inside && (
          <div className="bs-time">
            <div className="bs-time-row">
              <span className="bs-eyebrow">{t("scene.brain.timeline")}</span>
              <span className="bs-time-now mono">
                {dayLabel}
                {dateLabel && <span className="bs-faint"> · {dateLabel}</span>}
                <span className="bs-faint"> · {t("scene.brain.present", { n: present })}</span>
              </span>
              <Tooltip label={replaying ? t("scene.brain.pause") : t("scene.brain.play")}>
                <button
                  type="button"
                  className="bs-time-play"
                  aria-label={replaying ? t("scene.brain.pause") : t("scene.brain.play")}
                  onClick={() => {
                    if (replaying) setReplaying(false);
                    else {
                      setDaysAgo(span);
                      setReplaying(true);
                    }
                  }}
                >
                  {replaying ? "❚❚" : "▶"}
                </button>
              </Tooltip>
            </div>
            <div className="bs-hist" aria-hidden>
              {hist.map((v, i) => (
                <i
                  key={i}
                  style={{ height: `${v === 0 ? 0 : 12 + (v / histMax) * 88}%` }}
                  data-future={(i + 1) / HIST_BINS > 1 - daysAgo / span ? "" : undefined}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={span}
              step={1}
              value={span - Math.min(daysAgo, span)}
              aria-label={t("scene.brain.timelineAria")}
              aria-valuetext={`${dayLabel} · ${t("scene.brain.present", { n: present })}`}
              onChange={(e) => {
                setReplaying(false);
                setDaysAgo(span - Number(e.target.value));
              }}
            />
          </div>
        )
      )}
    </div>
  );
}

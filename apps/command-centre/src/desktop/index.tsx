/**
 * The OS desktop: a fullscreen surface. The icosphere wallpaper sits under a
 * "Now" panel and the ring of artifact chips; widgets float above on a
 * 24-column grid (stacked below 1024 px) and can be dragged, resized,
 * configured, added and hidden in edit mode. Layout persists in settings.
 *
 * Every widget owns its queries through the registry, so one failing endpoint
 * degrades only that widget; the desktop itself never renders blank.
 *
 * Modes: edit (grid + gallery + per-widget gear) and search (widgets fade to
 * 30 %, and choosing a match lands the file on the stage as a document
 * window). Both are reachable from the tool row, the keyboard and the
 * command palette (`mordomo:toggle-edit`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { api, type LaunchRunResponse, type Meta, type Skill } from "../api";
import { useT } from "../i18n";
import { qk, useOsMetrics, useOsProviders, useOsSettings } from "../queries";
import { budgetState } from "./budget";
import { useToast } from "../components/ui";
import { Button, Popover } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { playCue, useNotifications } from "../hooks/useNotifications";
import { useOsNavigate } from "../hooks/useViewTransition";
import { useOsEvent } from "../hooks/useEventStream";
import { OPEN_DECK_EVENT, OPEN_PANEL_EVENT, RESET_LAYOUT_EVENT } from "../App";
import {
  PANEL_ACTION_EVENT,
  panelKind,
  publishPanels,
  type OpenPanel,
  type PanelAction,
  ARRANGE_EVENT,
} from "./panelKinds";
import { APPS, appForPath, appId, appKindOf, appLocationOf, type AppKind, type AppLocation } from "./apps";
import AppPanel from "./AppPanel";
import RunPanel from "./RunPanel";
import SkillInputsPanel from "./SkillInputsPanel";
import {
  FORM_BOX,
  RUN_BOX,
  formPanelId,
  formSlugOf,
  isFormPanelId,
  isRunPanelId,
  runIdOf,
  runPanelId,
  runPanelTitle,
} from "./runPanels";
import { isRunActive } from "../runs/useRunStream";
import { useLocation, useNavigate as useRouterNavigate } from "react-router-dom";
import { SWITCH_SPACE_EVENT, takePendingSpace } from "../components/Workspace";
import { DEFAULT_SPACE, listSpaces, switchSpace, type SpaceMap } from "./spaces";
import { DOC_BOX, defaultWindows, docId, docPath, isDocId, minFor } from "./defaultWindows";
import DocWindow from "./DocWindow";
import { CONSOLE_DRAFT_EVENT, CONSOLE_REFS_EVENT, readConsoleDraft, storeConsoleDraft } from "./consoleDraft";
import {
  arrangeOnOpen,
  clampIntoStage,
  placeNew,
  raise,
  stackOrder,
  tile,
  topZ,
  type WindowMap,
  columns,
} from "./windowModel";
import { useWindowLayout, type StageMetrics } from "./useWindowLayout";
import WidgetLayer, { type WidgetSpec } from "./WidgetLayer";
import AgentPresence from "./AgentPresence";
import LivingField from "./LivingField";
import DesktopPods from "./DesktopPods";
import AmbientStrip from "./AmbientStrip";
import { useDesktopSignals } from "./useSignals";
import { DESKTOP_ACTION_EVENT, publishDesktopModes, type DesktopAction } from "./desktopModes";
import { hudEquals, normalizeHud, type Hud } from "./hud";
import SkillDeck from "./SkillDeck";
import FirstRunHint from "./FirstRunHint";
import ModelEffortPopover from "./ModelEffortPopover";
import { SearchBar, type ArtifactHit } from "./ArtifactSearch";
import { DesktopActionsProvider, type DesktopActions } from "./actions";
import { WIDGET_REGISTRY, hasSurface, widgetDefinition } from "./registry";
import { baseCoreState, type CoreState } from "./coreState";
import { isActiveStatus, useArtifactList, useDesktopRuns } from "./data";
import { InboxList } from "./widgets/InboxWidget";
import Console, { LISTENING_EVENT } from "./console/Console";
import "./desktop.css";

const SEARCH_DEBOUNCE_MS = 220;

export default function Desktop({ meta, onMetaChanged }: { meta: Meta; onMetaChanged?: () => void }) {
  const t = useT();
  const navigate = useOsNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [metrics, setMetrics] = useState<StageMetrics | null>(null);
  const stage = useMemo(() => ({ w: metrics?.w ?? 1200, h: metrics?.h ?? 700 }), [metrics?.w, metrics?.h]);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const [deckPopover, setDeckPopover] = useState<{ skill: Skill; anchor: HTMLElement } | null>(null);
  /** Expanded widget, owned here so the ambient strip can open a surface. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Camera pulled back over the whole stage. */
  const [overview, setOverview] = useState(false);
  /** The radial skill deck, fanned out over the console. */
  const [deckOpen, setDeckOpen] = useState(false);
  /** Paths the console draft points at; the layer tethers to their windows. */
  const [activeRefs, setActiveRefs] = useState<readonly string[]>([]);
  useEffect(() => {
    const onRefs = (e: Event) => setActiveRefs((e as CustomEvent<string[]>).detail ?? []);
    window.addEventListener(CONSOLE_REFS_EVENT, onRefs);
    return () => window.removeEventListener(CONSOLE_REFS_EVENT, onRefs);
  }, []);
  const [bellAnchor, setBellAnchor] = useState<HTMLElement | null>(null);

  const settings = useOsSettings();
  const providers = useOsProviders();
  const runs = useDesktopRuns();
  const notifications = useNotifications();

  const searchList = useArtifactList({ q: debounced, limit: 40 }, searching && debounced.trim().length >= 2);

  const { layout, commit, latest, saving, conflict, resolveConflict } = useWindowLayout({
    serverLayout: settings.data?.dashboardLayout,
    stage,
    spaceId: settings.data?.activeSpace,
    onError: (err) => toast(`${t("os.layoutSaveFailed")}: ${err.message}`, "danger"),
  });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  /* ---- search results ---------------------------------------------------- */
  const hits = useMemo<ArtifactHit[]>(() => {
    if (!searching) return [];
    return (searchList.data?.items ?? []).slice(0, 12).map((item) => ({
      key: item.id || item.path,
      label: item.file.split("/").pop() ?? item.file,
      title: item.title || item.file,
      path: item.path,
      runId: item.runId,
      skillSlug: item.skillSlug,
      ts: item.createdAt,
    }));
  }, [searching, searchList.data]);

  const activeRuns = useMemo(
    () => (runs.data ?? []).filter((r) => isActiveStatus(r.status)).length,
    [runs.data],
  );
  const coreState = useCoreState(runs.data ?? []);
  useBudgetNotifications();
  const signals = useDesktopSignals(activeRuns);

  /* ---- the HUD (G5): which instruments sit on the arcs, persisted ------- */
  const storedHud = useMemo(() => normalizeHud(settings.data?.hud), [settings.data?.hud]);
  const [hud, setHud] = useState<Hud>(storedHud);
  useEffect(() => setHud(storedHud), [storedHud]);
  const [editingHud, setEditingHud] = useState(false);
  const saveHudMutation = useMutation({
    mutationFn: (next: Hud) => api.put<{ settings: Record<string, unknown> }>("/api/settings", { hud: next }),
    onSuccess: (data) => {
      if (data?.settings) qc.setQueryData(qk.settings, data.settings);
      else qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
    },
    onError: (err: Error) => {
      toast(err.message, "danger");
      setHud(storedHud);
    },
  });
  const saveHud = useCallback(
    (next: Hud) => {
      if (hudEquals(next, hud)) return;
      setHud(next);
      saveHudMutation.mutate(next);
    },
    [hud, saveHudMutation],
  );

  const runningSkills = useMemo(
    () =>
      new Set(
        (runs.data ?? []).filter((r) => isActiveStatus(r.status) && r.skillSlug).map((r) => r.skillSlug!),
      ),
    [runs.data],
  );

  /* ---- mutations -------------------------------------------------------- */

  const openRunRef = useRef<(id: string) => void>(() => undefined);
  const closePanelRef = useRef<(id: string) => void>(() => undefined);
  const layoutRef = useRef<WindowMap>({});
  const openSkillFormRef = useRef<(slug: string) => void>(() => undefined);
  const openWindowRef = useRef<(id: string) => boolean>(() => false);

  /** What running a skill from the desktop leads to: a form, a hold, or a trace. */
  type RunOutcome = { form: string } | { approvals: true } | { run: string };
  const runSkill = useMutation({
    mutationFn: async (skill: Skill): Promise<RunOutcome> => {
      // A skill that needs inputs gets its form on the stage; one that can
      // start now starts, and its trace opens as a panel (G3). Neither
      // leaves the desktop.
      if (skill.inputs.some((i) => i.required)) return { form: skill.slug };
      const res = await api.post<LaunchRunResponse>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, {
        inputs: {},
      });
      const runId = res.runId;
      if (res.status === "waiting_approval" || !runId) {
        toast(t("runs.approvalPending"), "info");
        return { approvals: true };
      }
      toast(`▶ /${skill.slug}`, "ok");
      return { run: runId };
    },
    onSuccess: (out) => {
      if ("form" in out) openSkillFormRef.current(out.form);
      else if ("approvals" in out) openWindowRef.current("approvals");
      else openRunRef.current(out.run);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  /**
   * Switching space is one write: the arrangement being left is saved into
   * its space and the target's comes back. Done here, not in the dock,
   * because the live layout includes a drag the debounce has not persisted.
   */
  const saveSpaces = useMutation({
    mutationFn: (patch: { spaces: SpaceMap; activeSpace: string; dashboardLayout: WindowMap }) =>
      api.put("/api/settings", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const saveSpacesRef = useRef(saveSpaces.mutate);
  saveSpacesRef.current = saveSpaces.mutate;
  /**
   * The spaces map, held locally as well as in settings. Two switches in a
   * row happen faster than the settings query refetches, and reading the
   * stale copy would recreate the space you just left from the defaults —
   * losing the arrangement the switch was supposed to save.
   */
  const spacesRef = useRef<{ spaces: SpaceMap; active: string }>({ spaces: {}, active: DEFAULT_SPACE });
  useEffect(() => {
    if (!settings.data) return;
    spacesRef.current = {
      spaces: (settings.data.spaces as SpaceMap | undefined) ?? {},
      active: settings.data.activeSpace ?? DEFAULT_SPACE,
    };
  }, [settings.data]);
  const switchRef = useRef<(next: string) => void>(() => undefined);
  switchRef.current = (next: string) => {
    const { spaces, active } = spacesRef.current;
    const out = switchSpace(spaces, active, layout, next, defaultWindows(stage));
    if (out.activeSpace === active && out.layout === layout) return;
    spacesRef.current = { spaces: out.spaces, active: out.activeSpace };
    // A different desktop: nothing from the old one stays expanded over it.
    setExpandedId(null);
    setOverview(false);
    commit(out.layout);
    saveSpacesRef.current({
      spaces: out.spaces,
      activeSpace: out.activeSpace,
      dashboardLayout: out.layout,
    });
  };
  useEffect(() => {
    const onSwitch = (e: Event) => {
      takePendingSpace();
      switchRef.current((e as CustomEvent<string>).detail);
    };
    window.addEventListener(SWITCH_SPACE_EVENT, onSwitch);
    return () => window.removeEventListener(SWITCH_SPACE_EVENT, onSwitch);
  }, []);
  // A switch asked for from another app, before this desktop existed.
  const ready = settings.data !== undefined && metrics !== null;
  useEffect(() => {
    if (!ready) return;
    const pending = takePendingSpace();
    if (pending) switchRef.current(pending);
  }, [ready]);

  const resetLayout = async () => {
    if (await confirm({ title: t("os.resetLayout"), body: t("os.resetLayoutBody") }))
      commit(defaultWindows(stage));
  };

  /* ---- modes ------------------------------------------------------------ */
  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery("");
    setDebounced("");
  }, []);

  useEffect(() => {
    const onReset = () => void resetLayout();
    const onOpenDeck = () => setDeckOpen(true);
    window.addEventListener(RESET_LAYOUT_EVENT, onReset);
    window.addEventListener(OPEN_DECK_EVENT, onOpenDeck);
    return () => {
      window.removeEventListener(RESET_LAYOUT_EVENT, onReset);
      window.removeEventListener(OPEN_DECK_EVENT, onOpenDeck);
    };
    // `resetLayout` closes over the live layout and the confirm hook; the
    // listener reads the latest through the render it was registered in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The dock asks for a mode (G5); the desktop owns it and tells the dock
  // what is on, so the dock's buttons can show pressed.
  const tileRef = useRef(() => undefined as void);
  tileRef.current = () => commit(tile(layout, stage));
  useEffect(() => {
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<DesktopAction>).detail;
      if (action === "overview") setOverview((v) => !v);
      else if (action === "hud") setEditingHud((v) => !v);
      else if (action === "tile") tileRef.current();
    };
    window.addEventListener(DESKTOP_ACTION_EVENT, onAction);
    return () => window.removeEventListener(DESKTOP_ACTION_EVENT, onAction);
  }, []);
  useEffect(() => {
    publishDesktopModes({ overview, editing: editingHud });
    return () => publishDesktopModes({ overview: false, editing: false });
  }, [overview, editingHud]);
  // Escape leaves the HUD edit, like every other mode.
  useEffect(() => {
    if (!editingHud) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof Element && e.target.closest('[role="dialog"]')))
        setEditingHud(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingHud]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.documentElement.dataset.onboarding) return;
      // The deck is a command, so unlike the camera and search it keeps a
      // modifier and works from inside the console too.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setDeckOpen((v) => !v);
        return;
      }
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[role="dialog"]')) return;
      const editable =
        el instanceof HTMLElement &&
        (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      // ⌘1…⌘6 switch spaces (refino item 50), from anywhere on the desk.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && /^[1-6]$/.test(e.key)) {
        const { spaces, active } = spacesRef.current;
        const ids = listSpaces(spaces, active).map((sp) => sp.id);
        const target = ids[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          switchRef.current(target);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // The stack by keyboard: ] and [ raise the next and previous panel,
      // F puts the top one in the cinema, Escape closes it.
      if (!editable && (e.key === "]" || e.key === "[")) {
        const order = stackOrder(layoutRef.current);
        if (order.length > 1) {
          e.preventDefault();
          const next = e.key === "]" ? order[order.length - 1]! : order[1]!;
          commit(raise(layoutRef.current, next));
        }
        return;
      }
      if (!editable && e.key.toLowerCase() === "f" && !searching && !overview) {
        const top = stackOrder(layoutRef.current)[0];
        if (top) {
          e.preventDefault();
          setExpandedId((cur) => (cur ? null : top));
        }
        return;
      }
      if (e.key === "/" && !editable && !searching) {
        e.preventDefault();
        setSearching(true);
        return;
      }
      // Tab stays keyboard navigation; the camera gets its own key.
      if (e.key === "\\" && !editable) {
        e.preventDefault();
        setOverview((v) => !v);
        return;
      }
      if (e.key === "Escape" && overview) {
        e.preventDefault();
        setOverview(false);
        return;
      }
      if (e.key === "Escape" && searching) {
        e.preventDefault();
        e.stopPropagation();
        closeSearch();
        return;
      }
      // With nothing else open, Escape closes the top panel (refino item 50).
      if (e.key === "Escape" && !editable && !deckOpen && !editingHud) {
        if (expandedId) {
          e.preventDefault();
          setExpandedId(null);
          return;
        }
        const top = stackOrder(layoutRef.current)[0];
        if (top) {
          e.preventDefault();
          closePanelRef.current(top);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, overview, closeSearch, deckOpen, editingHud, expandedId, commit]);

  /* ---- widgets from the registry --------------------------------------- */
  /** Document windows on the stage, newest (highest) first. */
  /**
   * Every panel on the stage, top of the stack first — what the console can
   * point the agent at, and what the dock lists. Published to the panel store
   * as well, because the dock lives outside this route.
   */
  const openPanels = useMemo<OpenPanel[]>(() => {
    const out: OpenPanel[] = [];
    for (const [id, box] of Object.entries(layout)) {
      if (!box.visible) continue;
      const kind = panelKind(id);
      if (isDocId(id)) {
        const path = docPath(id);
        const name = path.split(/[\\/]/).pop() || path;
        out.push({ id, kind, ref: name, title: name, path, minimized: box.minimized ?? false });
        continue;
      }
      const app = appKindOf(id);
      if (app) {
        const def = APPS[app];
        out.push({ id, kind, ref: t(def.refKey), title: t(def.titleKey), minimized: box.minimized ?? false });
        continue;
      }
      if (isRunPanelId(id)) {
        const rid = runIdOf(id);
        const record = (runs.data ?? []).find((r) => r.id === rid);
        const short = rid.length > 8 ? rid.slice(0, 8) : rid;
        out.push({
          id,
          kind,
          ref: `run-${short}`,
          title: runPanelTitle(rid, record?.skillSlug),
          minimized: box.minimized ?? false,
          live: record ? isRunActive(record.status) : false,
        });
        continue;
      }
      if (isFormPanelId(id)) {
        const slug = formSlugOf(id);
        out.push({
          id,
          kind,
          ref: slug,
          title: t("desktop.form.title", { slug }),
          minimized: box.minimized ?? false,
        });
        continue;
      }
      const def = widgetDefinition(id);
      if (!def) continue;
      out.push({ id, kind, ref: t(def.refKey), title: t(def.titleKey), minimized: box.minimized ?? false });
    }
    return out.sort((a, b) => (layout[b.id]?.z ?? 0) - (layout[a.id]?.z ?? 0));
  }, [layout, t, runs.data]);
  useEffect(() => {
    publishPanels(openPanels);
    return () => publishPanels([]);
  }, [openPanels]);
  /** The console only sees what is actually on the stage — and never itself. */
  const stagePanels = useMemo(() => openPanels.filter((p) => !p.minimized), [openPanels]);

  /**
   * A pod's window: put it on the stage if it is not there, raise it if it is.
   * The stage opens clear (F7), so a pod is how most windows arrive — opening
   * one must not feel like a different gesture from focusing one.
   */
  const openWindow = useCallback(
    (id: string) => {
      // Read and write the latest layout, not this render's: a pod, a strip
      // segment or a deep link can fire in the same tick the stored layout
      // arrives, and building on the boot defaults would erase it.
      const existing = latest()[id];
      if (!existing) return false;
      commit((prev) => {
        const box = prev[id];
        if (!box) return prev;
        if (box.visible && !box.minimized) {
          // Already on the stage: raising it is the whole answer.
          return { ...prev, [id]: { ...box, z: topZ(prev) + 1 } };
        }
        // Its stored corner was chosen for a different composition and may now
        // be under the console or under a window opened a moment ago, so a
        // window arriving from a pod is placed against what is actually open.
        const spot = placeNew({ w: box.w, h: box.h }, prev, stage);
        return arrangeOnOpen(
          { ...prev, [id]: { ...box, ...spot, visible: true, minimized: false, z: topZ(prev) + 1 } },
          stage,
        );
      });
      return true;
    },
    [latest, commit, stage],
  );

  /**
   * An app on the stage. Opening one that is already there raises it and,
   * when a path was asked for, moves it there; a new one lands where there is
   * room. The path and query live in the panel's `config`, so a reload or a
   * space switch brings the app back where it was.
   */
  const openApp = useCallback(
    (kind: AppKind, at?: Partial<AppLocation>) => {
      const id = appId(kind);
      const def = APPS[kind];
      commit((prev) => {
        const existing = prev[id];
        const config: Record<string, unknown> = { ...(existing?.config ?? {}) };
        if (at?.pathname !== undefined) config.path = at.pathname;
        if (at?.search !== undefined) config.search = at.search;
        if (existing)
          return {
            ...prev,
            [id]: { ...existing, visible: true, minimized: false, z: topZ(prev) + 1, config },
          };
        const spot = placeNew(def.size, prev, stage);
        // Fitted to the stage it opens on: the default box is a wish, not a
        // right, and a plate wider than the stage would hang off its edge.
        const box = clampIntoStage(
          { ...spot, ...def.size, z: topZ(prev) + 1, visible: true, minimized: false, config },
          stage,
          minFor(id),
        );
        // Few panels reflow into columns (refino item 11); many keep their spots.
        return arrangeOnOpen({ ...prev, [id]: box }, stage);
      });
    },
    [commit, stage],
  );
  const openAppRef = useRef(openApp);
  openAppRef.current = openApp;

  /** A panel with a fixed box: on the stage if it is not there, raised if it is. */
  /**
   * Open (or raise) a panel that is not in the layout yet — a document, a run's
   * trace, a skill's form. Derived from the latest committed layout, not this
   * render's, because these arrive in bursts: a form closing and its run
   * opening in the same tick, three artifacts landing when a run settles.
   */
  const openSized = useCallback(
    (id: string, size: { w: number; h: number }) => {
      commit((prev) => {
        const existing = prev[id];
        if (existing)
          return { ...prev, [id]: { ...existing, visible: true, minimized: false, z: topZ(prev) + 1 } };
        const spot = placeNew(size, prev, stage);
        return arrangeOnOpen(
          {
            ...prev,
            [id]: clampIntoStage(
              { ...spot, ...size, z: topZ(prev) + 1, visible: true, minimized: false },
              stage,
              minFor(id),
            ),
          },
          stage,
        );
      });
    },
    [commit, stage],
  );
  const openDoc = useCallback((path: string) => openSized(docId(path), DOC_BOX), [openSized]);
  const openRun = useCallback((runId: string) => openSized(runPanelId(runId), RUN_BOX), [openSized]);
  const openSkillForm = useCallback((slug: string) => openSized(formPanelId(slug), FORM_BOX), [openSized]);
  openRunRef.current = openRun;
  openSkillFormRef.current = openSkillForm;
  /** A form is done once its run is off: it closes itself. */
  const closePanel = useCallback(
    (id: string) => {
      commit((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, visible: false } } : prev));
    },
    [commit],
  );
  closePanelRef.current = closePanel;

  /**
   * Deep links (G2): the app routes still exist — notifications, the palette,
   * every `Link` inside an app — but they open the app as a panel and hand the
   * URL back to the desktop. The desktop stays mounted through it (App renders
   * it for every app route), so nothing re-materialises.
   */
  const location = useLocation();
  layoutRef.current = layout;
  // The bounce is a plain router navigation on purpose: the link that got us
  // here may itself be mid view-transition (`useOsNavigate`), and starting a
  // second transition inside the first one's update callback freezes the
  // document — the palette and the run list both hung on exactly that.
  const routerNavigate = useRouterNavigate();
  // A deep link on a cold load has to wait for the stored layout: opening a
  // panel over the boot defaults and persisting that would erase every panel
  // the user had on the stage.
  const layoutReady = settings.data !== undefined;
  useEffect(() => {
    if (!layoutReady) return;
    // A run's own route opens its trace panel, not the Runs app: that is
    // what every "open run" link in the OS means now (G3).
    const runMatch = /^\/runs\/([^/]+)$/.exec(location.pathname);
    if (runMatch) {
      openRunRef.current(decodeURIComponent(runMatch[1]!));
      routerNavigate("/", { replace: true });
      return;
    }
    const def = appForPath(location.pathname);
    if (!def) return;
    // A bare link to an app that is already open at that path ("Second
    // Brain" in the dock, again) is a request to see it, not to reset it:
    // its query — the brain's selection and zoom — is left alone. A deeper
    // path or an explicit query is a request to go there.
    // Read from the latest layout, not this render's: on a cold load the
    // render's layout is still the boot default, which has no app entry and
    // would make every bare link look like "the same path".
    const current = appLocationOf(def, latest()[appId(def.kind)]?.config);
    const same = current.pathname === location.pathname && location.search === "";
    openAppRef.current(def.kind, same ? undefined : { pathname: location.pathname, search: location.search });
    routerNavigate("/", { replace: true });
  }, [layoutReady, location.pathname, location.search, routerNavigate, latest]);

  /** Move an app panel to a path or query inside it (the view asked, via its route hooks). */
  const setAppLocation = useCallback(
    (id: string, next: Partial<AppLocation>) => {
      // On the latest layout: a view writes its location from inside an
      // effect, often in the same tick as another commit.
      commit((prev) => {
        const box = prev[id];
        if (!box) return prev;
        const config: Record<string, unknown> = { ...(box.config ?? {}) };
        if (next.pathname !== undefined) config.path = next.pathname;
        if (next.search !== undefined) config.search = next.search;
        return { ...prev, [id]: { ...box, config } };
      });
    },
    [commit],
  );

  /** Append `@name` to the console draft and put the caret back in it. */
  const referencePanel = useCallback(
    (id: string) => {
      const panel = openPanels.find((p) => p.id === id);
      if (!panel) return;
      const draft = readConsoleDraft();
      const text = draft.text.trimEnd();
      storeConsoleDraft({ ...draft, text: `${text ? `${text} ` : ""}@${panel.ref} ` });
      window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    },
    [openPanels],
  );

  openWindowRef.current = openWindow;

  /** The palette composed a desk (refino item 47): open what it named, then columns or grid. */
  useEffect(() => {
    const onArrange = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail ?? [];
      for (const id of ids) {
        const app = appKindOf(id);
        if (app) openAppRef.current(app);
        else openWindowRef.current(id);
      }
      window.setTimeout(() => {
        commit((prev) => {
          const open = Object.values(prev).filter((b) => b.visible && !b.minimized).length;
          return open <= 3 ? columns(prev, stage) : tile(prev, stage);
        });
      }, 0);
    };
    window.addEventListener(ARRANGE_EVENT, onArrange);
    return () => window.removeEventListener(ARRANGE_EVENT, onArrange);
  }, [commit, stage]);

  /** The dock's task buttons: focus, park, restore — the same layout, edited here. */
  useEffect(() => {
    const onAction = (e: Event) => {
      const { id, action } = (e as CustomEvent<{ id: string; action: PanelAction }>).detail;
      const box = layout[id];
      if (!box) return;
      if (action === "minimize") commit({ ...layout, [id]: { ...box, minimized: true } });
      else commit({ ...layout, [id]: { ...box, visible: true, minimized: false, z: topZ(layout) + 1 } });
    };
    const onOpenPanel = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const box = layout[id];
      if (!box) return;
      const spot = box.visible && !box.minimized ? {} : placeNew({ w: box.w, h: box.h }, layout, stage);
      commit({ ...layout, [id]: { ...box, ...spot, visible: true, minimized: false, z: topZ(layout) + 1 } });
    };
    window.addEventListener(PANEL_ACTION_EVENT, onAction);
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
    return () => {
      window.removeEventListener(PANEL_ACTION_EVENT, onAction);
      window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
    };
  }, [layout, commit, stage]);

  const actions = useMemo<DesktopActions>(
    () => ({
      runSkill: (skill) => runSkill.mutate(skill),
      configureSkill: (skill, anchor) => setDeckPopover({ skill, anchor }),
      focusDeck: () => document.querySelector<HTMLElement>(".deck-card .btn")?.focus(),
      runningSkills,
      openPanels: stagePanels,
      openDoc,
      openApp,
      openRun,
      openSkillForm,
      openPanel: (id) => {
        openWindow(id);
      },
      referencePanel,
    }),
    [
      runSkill,
      runningSkills,
      stagePanels,
      openDoc,
      openApp,
      openRun,
      openSkillForm,
      openWindow,
      referencePanel,
    ],
  );

  const widgets = useMemo(() => {
    const out: Record<string, WidgetSpec> = {};
    for (const id of Object.keys(layout)) {
      if (isDocId(id)) {
        const path = docPath(id);
        out[id] = {
          title: path.split(/[\\/]/).pop() || path,
          refName: path.split(/[\\/]/).pop() || path,
          icon: <FileText aria-hidden />,
          expandable: true,
          surfaceMin: { w: 460, h: 340 },
          node: <DocWindow instanceId={id} />,
        };
        continue;
      }
      if (isRunPanelId(id)) {
        const rid = runIdOf(id);
        const record = (runs.data ?? []).find((r) => r.id === rid);
        out[id] = {
          title: runPanelTitle(rid, record?.skillSlug),
          refName: `run-${rid.length > 8 ? rid.slice(0, 8) : rid}`,
          expandable: true,
          surfaceMin: { w: 720, h: 520 },
          node: <RunPanel runId={rid} />,
        };
        continue;
      }
      if (isFormPanelId(id)) {
        const slug = formSlugOf(id);
        out[id] = {
          title: t("desktop.form.title", { slug }),
          refName: slug,
          expandable: false,
          node: <SkillInputsPanel slug={slug} onDone={() => closePanel(id)} />,
        };
        continue;
      }
      const app = appKindOf(id);
      if (app) {
        const def = APPS[app];
        const Icon = def.Icon;
        out[id] = {
          title: t(def.titleKey),
          refName: t(def.refKey),
          icon: <Icon aria-hidden />,
          expandable: true,
          surfaceMin: { w: 760, h: 540 },
          node: (
            <AppPanel
              kind={app}
              location={appLocationOf(def, layout[id]!.config)}
              onLocation={(next) => setAppLocation(id, next)}
              onMetaChanged={onMetaChanged}
            />
          ),
        };
        continue;
      }
      const def = widgetDefinition(id);
      if (!def) continue;
      const Component = def.Component;
      out[id] = {
        title: t(def.titleKey),
        refName: t(def.refKey),
        icon: def.icon,
        expandable: hasSurface(def),
        surfaceMin: def.surfaceMin,
        node: <Component instanceId={id} />,
      };
    }
    return out;
  }, [layout, t, setAppLocation, onMetaChanged, runs.data, closePanel]);

  const activeProvider = providers.data?.find((p) => p.isDefault);
  const consoleNode = (
    <Console
      busy={activeRuns > 0}
      deckOpen={deckOpen}
      onToggleDeck={(open) => setDeckOpen((v) => open ?? !v)}
      stacked={Boolean(metrics?.stacked)}
    />
  );

  return (
    <DesktopActionsProvider value={actions}>
      <div
        className={`desktop${searching ? " searching" : ""}${editingHud ? " editing" : ""}`}
        data-core={coreState}
      >
        {!metrics?.stacked && <LivingField onOpenFile={(path) => openDoc(path)} />}
        <AgentPresence />
        {!metrics?.stacked && <FirstRunHint />}
        <SkillDeck open={deckOpen} onClose={() => setDeckOpen(false)} />

        <div className="depth-layer desktop-depth">
          {!metrics?.stacked && (
            <DesktopPods
              hud={hud}
              signals={signals}
              editing={editingHud}
              onHudChange={saveHud}
              onOpenApp={(kind) => openApp(kind)}
              onExpand={(id) => {
                // A pod only opens what the layout actually holds; otherwise it
                // would promise a panel that has no body to render.
                if (!openWindow(id)) navigate("/settings");
              }}
            />
          )}
          <WidgetLayer
            layout={layout}
            widgets={widgets}
            onLayoutChange={commit}
            onMetrics={setMetrics}
            expandedId={expandedId}
            onExpandedChange={setExpandedId}
            overview={overview}
            onOverviewChange={setOverview}
            onReference={referencePanel}
            tetherTo={activeRefs}
            // On a narrow stage the console flows first in the column; on
            // the desk it is the fixed plate below (G4).
            stackedLead={metrics?.stacked ? consoleNode : undefined}
          />
        </div>
        {!metrics?.stacked && consoleNode}

        <AmbientStrip
          meta={meta}
          provider={activeProvider}
          coreState={coreState}
          signals={signals}
          unread={notifications.unread}
          bellOpen={bellAnchor !== null}
          onBell={(anchor) => setBellAnchor((prev) => (prev ? null : anchor))}
          onOpenProvider={() => openApp("settings", { pathname: "/settings", search: "?tab=providers" })}
          onOpenCost={() => openWindow("cost")}
          onOpenRuns={() => openApp("runs")}
          onOpenAttention={() => openWindow("attention")}
        />

        {searching && (
          <SearchBar
            query={query}
            matches={hits.length}
            hits={hits}
            onQuery={setQuery}
            onPick={(hit) => {
              // Search lands the file on the stage, where it can be referenced,
              // instead of only showing a preview that closes with the modal.
              openDoc(hit.path);
              closeSearch();
            }}
            onClose={closeSearch}
          />
        )}

        {conflict && (
          <div className="edit-bar enter-fade-up" role="toolbar" aria-label={t("os.layoutConflict")}>
            <span role="alert">{t("os.layoutConflict")}</span>
            <Button size="sm" disabled={saving} onClick={() => void resolveConflict(false)}>
              {t("os.layoutUseServer")}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void resolveConflict(true)}>
              {t("os.layoutKeepMine")}
            </Button>
          </div>
        )}

        {bellAnchor && (
          <Popover
            open
            onClose={() => setBellAnchor(null)}
            anchor={bellAnchor}
            placement="bottom-end"
            ariaLabel={t("desktop.inbox.title")}
            className="bell-pop"
          >
            <InboxList limit={10} />
          </Popover>
        )}

        {deckPopover && (
          <ModelEffortPopover
            skill={deckPopover.skill}
            providers={providers.data ?? []}
            anchor={deckPopover.anchor}
            open
            onClose={() => setDeckPopover(null)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: qk.skills }).catch(() => undefined);
            }}
          />
        )}
      </div>
    </DesktopActionsProvider>
  );
}

/**
 * Budget crossings (plan Onda 2 §5) land in the inbox once per day per level:
 * 80 % warns, 100 % flags the day as over budget. The rule itself is pure
 * (`budgetState`); this only decides when to speak.
 */
function useBudgetNotifications() {
  const t = useT();
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const settings = useOsSettings();
  const { notify } = useNotifications();
  const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
  const tone = budget.tone;
  const pct = Math.round(budget.ratio * 100);
  useEffect(() => {
    if (tone !== "warn" && tone !== "over") return;
    const day = new Date().toISOString().slice(0, 10);
    const key = `budget:${day}:${tone}`;
    try {
      if (localStorage.getItem(`mordomo.${key}`)) return;
      localStorage.setItem(`mordomo.${key}`, "1");
    } catch {
      /* private mode: notify every load, which is still correct */
    }
    notify({
      kind: "system",
      tone: tone === "over" ? "danger" : "warn",
      title: t(tone === "over" ? "dash.budgetOver" : "dash.budgetWarn", { pct }),
      href: "/settings?tab=security",
      dedupeKey: key,
    });
  }, [tone, pct, notify, t]);
}

/** Short-lived overrides (ms) for the finer core states fed by `run.event`. */
const TOOL_HOLD_MS = 1600;
const RESPOND_HOLD_MS = 1400;
const ALERT_HOLD_MS = 4000;
const DONE_HOLD_MS = 1300;

/**
 * Derives the core state from the event stream: an active run means
 * thinking; tool calls, streamed text, failures, approvals and completions
 * override it for a moment and then fall back.
 */
export function useCoreState(runs: ReadonlyArray<{ status: string }>): CoreState {
  const [override, setOverride] = useState<{ state: CoreState; until: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hold = useCallback((state: CoreState, ms: number) => {
    const until = Date.now() + ms;
    setOverride({ state, until });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setOverride((o) => (o && o.until <= Date.now() ? null : o)),
      ms + 20,
    );
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useOsEvent("run.event", (e) => {
    const ev = (e.payload as { event?: { type?: string; stream?: string } } | undefined)?.event;
    if (!ev) return;
    if (ev.type === "tool_use") hold("tool", TOOL_HOLD_MS);
    else if (ev.type === "assistant") hold("responding", RESPOND_HOLD_MS);
    else if (ev.type === "error") hold("alert", ALERT_HOLD_MS);
  });
  useOsEvent("run.started", () => playCue("ack"));
  useOsEvent("run.finished", (e) => {
    const status = (e.payload as { status?: string } | undefined)?.status;
    playCue(status === "done" || status === "cancelled" ? "done" : "alert");
    hold(
      status === "done"
        ? "done"
        : status === "cancelled"
          ? "cancelled"
          : status === "interrupted"
            ? "interrupted"
            : "alert",
      status === "done" ? DONE_HOLD_MS : ALERT_HOLD_MS,
    );
  });
  useOsEvent(["approval.requested", "routine.alert"], () => hold("alert", ALERT_HOLD_MS));
  const [listening, setListening] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setListening(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(LISTENING_EVENT, on);
    return () => window.removeEventListener(LISTENING_EVENT, on);
  }, []);

  if (listening) return "listening";
  if (override && override.until > Date.now()) return override.state;
  return baseCoreState(runs);
}

/** Registry ids, for tests and for the command palette. */
export const WIDGET_IDS = Object.keys(WIDGET_REGISTRY);

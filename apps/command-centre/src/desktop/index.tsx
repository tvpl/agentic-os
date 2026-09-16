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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Columns3,
  Copy,
  FileText,
  Grid2x2,
  Info,
  LayoutGrid,
  Palette,
  Pencil,
  Plus,
  Search,
  Telescope,
} from "lucide-react";
import { api, type LaunchRunResponse, type Meta, type ProviderId, type Skill } from "../api";
import { useT, type TKey } from "../i18n";
import { qk, useOsMetrics, useOsProviders, useOsSettings } from "../queries";
import { budgetState } from "./budget";
import { useToast } from "../components/ui";
import { Button, Popover } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { playCue, useNotifications } from "../hooks/useNotifications";
import { useOsNavigate } from "../hooks/useViewTransition";
import { useOsEvent } from "../hooks/useEventStream";
import { LAUNCHER_EVENT, OPEN_DECK_EVENT, TOGGLE_EDIT_EVENT } from "../App";
import { SWITCH_SPACE_EVENT, takePendingSpace } from "../components/Workspace";
import { DEFAULT_SPACE, switchSpace, type SpaceMap } from "./spaces";
import { DOC_BOX, defaultWindows, docId, docPath, isDocId } from "./defaultWindows";
import DocWindow from "./DocWindow";
import { CONSOLE_DRAFT_EVENT, CONSOLE_REFS_EVENT, readConsoleDraft, storeConsoleDraft } from "./consoleDraft";
import { cascade, placeNew, tile, topZ, type WindowMap } from "./windowModel";
import { useWindowLayout, type StageMetrics } from "./useWindowLayout";
import WidgetLayer, { type WidgetSpec } from "./WidgetLayer";
import AgentPresence from "./AgentPresence";
import LivingField from "./LivingField";
import DesktopPods from "./DesktopPods";
import SkillDeck from "./SkillDeck";
import ModelEffortPopover from "./ModelEffortPopover";
import AddWidgetGallery from "./AddWidgetGallery";
import { LayoutPresets } from "./LayoutPresets";
import WidgetConfigPopover from "./WidgetConfigPopover";
import { SearchBar, type ArtifactHit } from "./ArtifactSearch";
import { DesktopActionsProvider, type DesktopActions } from "./actions";
import { WIDGET_REGISTRY, defaultConfig, hasSurface, widgetDefinition } from "./registry";
import { baseCoreState, type CoreState } from "./coreState";
import { providerProblem } from "../components/providerReadiness";
import { isActiveStatus, useArtifactList, useDesktopRuns } from "./data";
import { InboxList } from "./widgets/InboxWidget";
import { LISTENING_EVENT } from "./widgets/PromptWidget";
import "./desktop.css";

/** One-click accent presets, cycled by the palette tool and persisted. */
const ACCENT_PRESETS = ["#f97316", "#22d3ee", "#a78bfa", "#4ade80", "#f43f5e", "#fbbf24"];
const SEARCH_DEBOUNCE_MS = 220;

export default function Desktop({ meta, onMetaChanged }: { meta: Meta; onMetaChanged?: () => void }) {
  const t = useT();
  const navigate = useOsNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [metrics, setMetrics] = useState<StageMetrics | null>(null);
  const stage = useMemo(() => ({ w: metrics?.w ?? 1200, h: metrics?.h ?? 700 }), [metrics?.w, metrics?.h]);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const [deckPopover, setDeckPopover] = useState<{ skill: Skill; anchor: HTMLElement } | null>(null);
  const [configFor, setConfigFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
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
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const settings = useOsSettings();
  const providers = useOsProviders();
  const runs = useDesktopRuns();
  const notifications = useNotifications();

  const searchList = useArtifactList({ q: debounced, limit: 40 }, searching && debounced.trim().length >= 2);

  const { layout, commit, saving, conflict, resolveConflict } = useWindowLayout({
    serverLayout: settings.data?.dashboardLayout,
    stage,
    spaceId: settings.data?.activeSpace,
    editing: editMode,
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

  const runningSkills = useMemo(
    () =>
      new Set(
        (runs.data ?? []).filter((r) => isActiveStatus(r.status) && r.skillSlug).map((r) => r.skillSlug!),
      ),
    [runs.data],
  );

  /* ---- mutations -------------------------------------------------------- */
  const accent = useMutation({
    mutationFn: (next: string) => api.put("/api/settings", { accentColor: next }),
    onSuccess: (_d, next) => {
      onMetaChanged?.();
      toast(`${t("settings.accent")}: ${next}`, "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const cycleAccent = () => {
    const current = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const idx = ACCENT_PRESETS.findIndex((c) => c.toLowerCase() === current.toLowerCase());
    accent.mutate(ACCENT_PRESETS[(idx + 1) % ACCENT_PRESETS.length]!);
  };

  const switchDefault = useMutation({
    mutationFn: (provider: ProviderId) => api.put("/api/providers/default", { provider }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.providers }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.meta }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const runSkill = useMutation({
    mutationFn: async (skill: Skill) => {
      if (skill.inputs.some((i) => i.required)) return { navigateTo: `/skills/${skill.slug}` };
      const res = await api.post<LaunchRunResponse>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, {
        inputs: {},
      });
      if (res.status === "waiting_approval" || !res.runId) {
        toast(t("runs.approvalPending"), "info");
        return { navigateTo: "/settings?tab=security" };
      }
      toast(`▶ /${skill.slug}`, "ok");
      return { navigateTo: `/runs/${res.runId}` };
    },
    onSuccess: ({ navigateTo }) => navigate(navigateTo),
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
    const onToggleEdit = () => {
      setEditMode((v) => !v);
    };
    const onOpenDeck = () => setDeckOpen(true);
    window.addEventListener(TOGGLE_EDIT_EVENT, onToggleEdit);
    window.addEventListener(OPEN_DECK_EVENT, onOpenDeck);
    return () => {
      window.removeEventListener(TOGGLE_EDIT_EVENT, onToggleEdit);
      window.removeEventListener(OPEN_DECK_EVENT, onOpenDeck);
    };
  }, []);

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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[role="dialog"]')) return;
      const editable =
        el instanceof HTMLElement &&
        (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, overview, closeSearch]);

  /* ---- widgets from the registry --------------------------------------- */
  /** Document windows on the stage, newest (highest) first. */
  const openDocs = useMemo(
    () =>
      Object.entries(layout)
        .filter(([id, box]) => isDocId(id) && box.visible && !box.minimized)
        .sort((a, b) => b[1].z - a[1].z)
        .map(([id]) => {
          const path = docPath(id);
          return { id, ref: path.split(/[\\/]/).pop() || path, path };
        }),
    [layout],
  );

  const openDoc = useCallback(
    (path: string) => {
      const id = docId(path);
      const existing = layout[id];
      if (existing) {
        commit({ ...layout, [id]: { ...existing, visible: true, minimized: false, z: topZ(layout) + 1 } });
        return;
      }
      const spot = placeNew(DOC_BOX, layout, stage);
      commit({
        ...layout,
        [id]: { ...spot, ...DOC_BOX, z: topZ(layout) + 1, visible: true, minimized: false },
      });
    },
    [layout, commit, stage],
  );

  /** Append `@name` to the console draft and put the caret back in it. */
  const referenceDoc = useCallback((id: string) => {
    const path = docPath(id);
    const ref = path.split(/[\\/]/).pop() || path;
    const draft = readConsoleDraft();
    const text = draft.text.trimEnd();
    storeConsoleDraft({ ...draft, text: `${text ? `${text} ` : ""}@${ref} ` });
    window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
  }, []);

  const actions = useMemo<DesktopActions>(
    () => ({
      runSkill: (skill) => runSkill.mutate(skill),
      configureSkill: (skill, anchor) => setDeckPopover({ skill, anchor }),
      focusDeck: () => document.querySelector<HTMLElement>(".deck-card .btn")?.focus(),
      runningSkills,
      openDocs,
      openDoc,
      referenceDoc,
    }),
    [runSkill, runningSkills, openDocs, openDoc, referenceDoc],
  );

  const widgets = useMemo(() => {
    const out: Record<string, WidgetSpec> = {};
    for (const id of Object.keys(layout)) {
      if (isDocId(id)) {
        const path = docPath(id);
        out[id] = {
          title: path.split(/[\\/]/).pop() || path,
          icon: <FileText aria-hidden />,
          expandable: true,
          surfaceMin: { w: 460, h: 340 },
          node: <DocWindow instanceId={id} />,
        };
        continue;
      }
      const def = widgetDefinition(id);
      if (!def) continue;
      const box = layout[id]!;
      const config = { ...defaultConfig(def), ...(box.config ?? {}) };
      const Component = def.Component;
      out[id] = {
        title: t(def.titleKey),
        icon: def.icon,
        configurable: (def.configSchema?.length ?? 0) > 0,
        expandable: hasSurface(def),
        surfaceMin: def.surfaceMin,
        node: <Component instanceId={id} config={config} editing={editMode} />,
      };
    }
    return out;
  }, [layout, t, editMode]);

  const setConfig = (id: string, next: Record<string, unknown> | undefined) => {
    const box = layout[id];
    if (!box) return;
    const updated = { ...box };
    if (next) updated.config = next;
    else delete updated.config;
    commit({ ...layout, [id]: updated });
  };

  const activeProvider = providers.data?.find((p) => p.isDefault);
  const defaultProvider = activeProvider?.id ?? t("common.loading");
  const configDef = configFor ? widgetDefinition(configFor.id) : undefined;

  return (
    <DesktopActionsProvider value={actions}>
      <div
        className={`desktop${editMode ? " edit-mode" : ""}${searching ? " searching" : ""}`}
        data-core={coreState}
      >
        {!metrics?.stacked && <LivingField onOpenFile={(path) => openDoc(path)} />}
        <AgentPresence />
        <SkillDeck open={deckOpen} onClose={() => setDeckOpen(false)} />

        <div className="depth-layer desktop-depth">
          {!metrics?.stacked && (
            <DesktopPods
              activeRuns={activeRuns}
              onOpenDeck={() => setDeckOpen(true)}
              onExpand={(id) => {
                // A pod only opens what the layout actually holds; otherwise it
                // would promise a panel that has no body to render.
                if (layout[id]) setExpandedId(id);
                else navigate("/settings");
              }}
            />
          )}
          <WidgetLayer
            layout={layout}
            widgets={widgets}
            editMode={editMode}
            onLayoutChange={commit}
            onMetrics={setMetrics}
            onConfigure={(id, anchor) => setConfigFor({ id, anchor })}
            expandedId={expandedId}
            onExpandedChange={setExpandedId}
            overview={overview}
            onOverviewChange={setOverview}
            tetherTo={activeRefs.map(docId)}
          />
        </div>

        <div className="os-topbar">
          <div className="side">
            <span
              className={`dot ${activeProvider?.health.ok ? "ok" : activeProvider?.health.installed ? "warn" : "dim"}`}
              aria-hidden
            />
            <span className="hud-label">
              {t("dash.activeProvider")}: <span className="accent-text">{defaultProvider}</span>
              {" · "}
              {activeProvider && providerProblem(activeProvider) ? (
                <span className="core-state-label warn-text" data-testid="provider-state">
                  {t(`gate.state.${providerProblem(activeProvider)!}`)}
                </span>
              ) : (
                <span className="core-state-label">{t(`desktop.core.${coreState}`)}</span>
              )}
            </span>
          </div>
          <div className="os-brand">
            <div className="line1">
              <span className="brand-mark" aria-hidden>
                {meta.name.charAt(0).toUpperCase()}
              </span>
              <span className="name">
                <span className="accent">{meta.name.replace(/\s*os$/i, "")}</span>{" "}
                <span style={{ fontWeight: 400 }}>{t("dash.brand")}</span>
              </span>
            </div>
            <div className="byline">{t("dash.brainSub")}</div>
            <div className="os-tools">
              <Tool
                active={editMode}
                label={t("os.edit")}
                onClick={() => {
                  setEditMode((v) => !v);
                }}
              >
                <Pencil aria-hidden />
              </Tool>
              <Tool
                active={searching}
                label={t("desktop.search.open")}
                onClick={() => (searching ? closeSearch() : setSearching(true))}
              >
                <Search aria-hidden />
              </Tool>
              <Tool label={t("desktop.arrange.tile")} onClick={() => commit(tile(layout, stage))}>
                <Columns3 aria-hidden />
              </Tool>
              <Tool label={t("desktop.arrange.cascade")} onClick={() => commit(cascade(layout, stage))}>
                <Copy aria-hidden />
              </Tool>
              <Tool
                active={overview}
                label={t(overview ? "desktop.overview.exit" : "desktop.overview.enter")}
                onClick={() => setOverview((v) => !v)}
              >
                <Telescope aria-hidden />
              </Tool>
              <Tool
                label={`${t("os.menu")} (⌘K)`}
                onClick={() => window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT))}
              >
                <LayoutGrid aria-hidden />
              </Tool>
              <Tool label={t("settings.accent")} onClick={cycleAccent}>
                <Palette aria-hidden />
              </Tool>
              <Tool label={t("nav.settings")} onClick={() => navigate("/settings")}>
                <Info aria-hidden />
              </Tool>
            </div>
          </div>
          <div className="side right">
            <button
              type="button"
              className={`os-tool bell${notifications.unread > 0 ? " has-unread" : ""}`}
              aria-label={
                notifications.unread > 0
                  ? t("desktop.inbox.bell", { n: notifications.unread })
                  : t("desktop.inbox.bellEmpty")
              }
              title={t("desktop.inbox.title")}
              aria-expanded={bellAnchor !== null}
              onClick={(e) => {
                // Read the anchor now: a batched updater runs after the synthetic event is released.
                const anchor = e.currentTarget;
                setBellAnchor((prev) => (prev ? null : anchor));
              }}
            >
              <Bell aria-hidden />
              {notifications.unread > 0 && (
                <span className="bell-count">{Math.min(99, notifications.unread)}</span>
              )}
            </button>
            <div className="segmented sm" role="group" aria-label={t("dash.providers")}>
              {(providers.data ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.isDefault ? "active" : ""}
                  disabled={!p.enabled || switchDefault.isPending}
                  onClick={() => !p.isDefault && p.enabled && switchDefault.mutate(p.id)}
                  title={p.enabled ? p.id : t("common.disabled")}
                  aria-pressed={p.isDefault}
                >
                  <span
                    className={`dot ${p.enabled ? (p.health.ok ? "ok" : p.health.installed ? "warn" : "danger") : "dim"}`}
                    style={{ marginRight: 5 }}
                  />
                  {p.id}
                </button>
              ))}
            </div>
          </div>
        </div>

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

        {(editMode || conflict) && (
          <div className="edit-bar enter-fade-up" role="toolbar" aria-label={t("os.edit")}>
            {conflict && (
              <>
                <span role="alert">{t("os.layoutConflict")}</span>
                <Button size="sm" disabled={saving} onClick={() => void resolveConflict(false)}>
                  {t("os.layoutUseServer")}
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void resolveConflict(true)}>
                  {t("os.layoutKeepMine")}
                </Button>
              </>
            )}
            <span className="hud-label">{t("os.editHint")}</span>
            <Button size="sm" onClick={() => setPresetsOpen(true)}>
              {t("os.layoutPresets")}
            </Button>
            <Button
              ref={addButtonRef}
              size="sm"
              variant="outline"
              icon={<Plus aria-hidden />}
              onClick={() => setAddAnchor(addButtonRef.current)}
            >
              {t("desktop.add.title")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Grid2x2 aria-hidden />}
              onClick={() => void resetLayout()}
            >
              {t("os.resetLayout")}
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={() => setEditMode(false)}>
              {t("os.done")}
            </Button>
          </div>
        )}

        {presetsOpen && (
          <LayoutPresets
            layout={layout}
            stage={stage}
            onApply={commit}
            onClose={() => setPresetsOpen(false)}
          />
        )}
        {addAnchor && (
          <AddWidgetGallery
            layout={layout}
            stage={stage}
            anchor={addAnchor}
            onAdd={(next: WindowMap) => commit(next)}
            onClose={() => setAddAnchor(null)}
          />
        )}

        {configFor && configDef && (
          <WidgetConfigPopover
            definition={configDef}
            title={t(configDef.titleKey as TKey)}
            config={layout[configFor.id]?.config}
            anchor={configFor.anchor}
            onChange={(next) => setConfig(configFor.id, next)}
            onClose={() => setConfigFor(null)}
          />
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

function Tool({
  children,
  label,
  active,
  onClick,
}: {
  children: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`os-tool${active ? " active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

/** Registry ids, for tests and for the command palette. */
export const WIDGET_IDS = Object.keys(WIDGET_REGISTRY);

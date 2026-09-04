/**
 * The OS desktop: a fullscreen surface. The icosphere wallpaper sits under a
 * "Now" panel and the ring of artifact chips; widgets float above on a
 * 24-column grid (stacked below 900 px) and can be dragged, resized,
 * configured, added and hidden in edit mode. Layout persists in settings.
 *
 * Every widget owns its queries through the registry, so one failing endpoint
 * degrades only that widget; the desktop itself never renders blank.
 *
 * Modes: edit (grid + gallery + per-widget gear) and search (widgets fade to
 * 30 %, only matching chips keep their ring, a detail modal pushes the
 * desktop back). Both are reachable from the tool row, the keyboard and the
 * command palette (`mordomo:toggle-edit`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Grid2x2, Info, LayoutGrid, Palette, Pencil, Plus, Search, Tag } from "lucide-react";
import {
  api,
  type ArtifactEntry,
  type ArtifactListItem,
  type LaunchRunResponse,
  type Meta,
  type ProviderId,
  type Skill,
} from "../api";
import { useLocale, useT, type TKey } from "../i18n";
import { qk, useOsMetrics, useOsProviders, useOsSettings } from "../queries";
import { budgetState } from "./budget";
import { useToast } from "../components/ui";
import { Button, Popover } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { useNotifications } from "../hooks/useNotifications";
import { useOsNavigate } from "../hooks/useViewTransition";
import { useOsEvent } from "../hooks/useEventStream";
import { LAUNCHER_EVENT, TOGGLE_EDIT_EVENT } from "../App";
import { DEFAULT_LAYOUT, freeRegion, type LayoutMap, type WidgetConfig } from "./defaultLayout";
import { useLayoutState, type GridMetrics } from "./useGridLayout";
import WidgetLayer, { type WidgetSpec } from "./WidgetLayer";
import Wallpaper, { type CoreFocus, type CoreState } from "./Wallpaper";
import NowPanel from "./NowPanel";
import HudTelemetry from "./HudTelemetry";
import ModelEffortPopover from "./ModelEffortPopover";
import AddWidgetGallery from "./AddWidgetGallery";
import WidgetConfigPopover from "./WidgetConfigPopover";
import { ArtifactModal, SearchBar } from "./ArtifactSearch";
import { DesktopActionsProvider, type DesktopActions } from "./actions";
import { WIDGET_REGISTRY, defaultConfig, widgetDefinition } from "./registry";
import { buildRingChips, chipMatches, type RingChip } from "./ringChips";
import {
  isActiveStatus,
  recentFiles,
  useArtifactList,
  useDesktopArtifacts,
  useDesktopGraph,
  useDesktopRuns,
} from "./data";
import { InboxList } from "./widgets/InboxWidget";
import { LISTENING_EVENT } from "./widgets/PromptWidget";
import "./desktop.css";

/** One-click accent presets, cycled by the palette tool and persisted. */
const ACCENT_PRESETS = ["#f97316", "#22d3ee", "#a78bfa", "#4ade80", "#f43f5e", "#fbbf24"];
const RING_CHIPS = 22;
const SEARCH_DEBOUNCE_MS = 220;

/** `/api/artifacts/recent` rows in the shape the ring wants (older servers, or before the first list call). */
function fromRecent(entries: readonly ArtifactEntry[]): ArtifactListItem[] {
  return entries.map((a) => ({
    id: `${a.runId}/${a.file}`,
    file: a.file,
    path: a.path,
    runId: a.runId,
    skillSlug: a.skillSlug,
    createdAt: a.createdAt,
    kind: "other" as const,
    title: a.file,
    folder: a.runId,
    sizeBytes: a.sizeBytes ?? 0,
    thumbnail: false,
  }));
}

export default function Desktop({ meta, onMetaChanged }: { meta: Meta; onMetaChanged?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useOsNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);
  const rows = metrics?.rows ?? 20;

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [revealLabels, setRevealLabels] = useState(false);
  const [detail, setDetail] = useState<RingChip | null>(null);

  const [deckPopover, setDeckPopover] = useState<{ skill: Skill; anchor: HTMLElement } | null>(null);
  const [configFor, setConfigFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [bellAnchor, setBellAnchor] = useState<HTMLElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const settings = useOsSettings();
  const providers = useOsProviders();
  const runs = useDesktopRuns();
  const recent = useDesktopArtifacts();
  const graph = useDesktopGraph();
  const notifications = useNotifications();

  const ringList = useArtifactList({ limit: RING_CHIPS });
  const searchList = useArtifactList({ q: debounced, limit: 40 }, searching && debounced.trim().length >= 2);

  const { layout, commit, saving } = useLayoutState({
    serverLayout: settings.data?.dashboardLayout,
    rows,
    editing: editMode,
    onError: (err) => toast(`${t("os.layoutSaveFailed")}: ${err.message}`, "danger"),
  });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  /* ---- chips ------------------------------------------------------------ */
  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const files = useMemo(() => recentFiles(nodes, 12), [nodes]);
  const baseArtifacts = useMemo(() => {
    const listed = ringList.data?.items ?? [];
    return listed.length > 0 ? listed : fromRecent(recent.data ?? []);
  }, [ringList.data, recent.data]);

  const chips = useMemo(() => {
    const found = searching ? (searchList.data?.items ?? []) : [];
    const merged = [...found, ...baseArtifacts];
    return buildRingChips(merged, files, searching ? RING_CHIPS + 4 : RING_CHIPS);
  }, [baseArtifacts, files, searching, searchList.data]);

  const matched = useMemo(() => {
    if (!searching || query.trim().length === 0) return new Set<string>();
    const paths = new Set((searchList.data?.items ?? []).map((i) => i.path));
    return new Set(chips.filter((c) => paths.has(c.path) || chipMatches(c, query)).map((c) => c.key));
  }, [chips, searching, query, searchList.data]);

  const runLabels = useMemo(
    () =>
      (runs.data ?? [])
        .filter((r) => r.skillSlug)
        .slice(0, 3)
        .map(
          (r) =>
            `/${r.skillSlug!} · ${new Date(r.createdAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        ),
    [runs.data, locale],
  );

  const activeRuns = useMemo(
    () => (runs.data ?? []).filter((r) => isActiveStatus(r.status)).length,
    [runs.data],
  );
  const coreState = useCoreState(activeRuns);
  useBudgetNotifications();

  /* ---- the free region between the widget columns anchors the core ------ */
  const focus = useMemo<CoreFocus | null>(() => {
    if (!metrics || metrics.stacked) return null;
    const r = freeRegion(layout, metrics);
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    // The ring hugs the free region (chips are 46px plus their count badge)
    // but never collapses onto the Now panel, which shrinks to fit inside it.
    const rx = Math.max(210, (r.right - r.left) / 2 - 44);
    const ry = Math.max(170, (r.bottom - r.top) / 2 - 44);
    return { cx, cy, rx, ry };
  }, [layout, metrics]);

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

  const resetLayout = async () => {
    if (await confirm({ title: t("os.resetLayout"), body: t("os.resetLayoutBody") })) commit(DEFAULT_LAYOUT);
  };

  /* ---- modes ------------------------------------------------------------ */
  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery("");
    setDebounced("");
    setDetail(null);
  }, []);

  useEffect(() => {
    const onToggleEdit = () => setEditMode((v) => !v);
    window.addEventListener(TOGGLE_EDIT_EVENT, onToggleEdit);
    return () => window.removeEventListener(TOGGLE_EDIT_EVENT, onToggleEdit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
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
      if (e.key === "Escape" && searching) {
        e.preventDefault();
        e.stopPropagation();
        if (detail) setDetail(null);
        else closeSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, detail, closeSearch]);

  /* ---- widgets from the registry --------------------------------------- */
  const actions = useMemo<DesktopActions>(
    () => ({
      runSkill: (skill) => runSkill.mutate(skill),
      configureSkill: (skill, anchor) => setDeckPopover({ skill, anchor }),
      focusDeck: () => document.querySelector<HTMLElement>(".deck-card .btn")?.focus(),
      runningSkills,
    }),
    [runSkill, runningSkills],
  );

  const widgets = useMemo(() => {
    const out: Record<string, WidgetSpec> = {};
    for (const id of Object.keys(layout)) {
      const def = widgetDefinition(id);
      if (!def) continue;
      const box = layout[id]!;
      const config = { ...defaultConfig(def), ...(box.config ?? {}) };
      const Component = def.Component;
      out[id] = {
        title: t(def.titleKey),
        icon: def.icon,
        configurable: (def.configSchema?.length ?? 0) > 0,
        node: <Component instanceId={id} config={config} editing={editMode} />,
      };
    }
    return out;
  }, [layout, t, editMode]);

  const setConfig = (id: string, next: WidgetConfig | undefined) => {
    const box = layout[id];
    if (!box) return;
    const updated = { ...box };
    if (next) updated.config = next;
    else delete updated.config;
    commit({ ...layout, [id]: updated });
  };

  const defaultProvider = providers.data?.find((p) => p.isDefault)?.id ?? meta.name;
  const configDef = configFor ? widgetDefinition(configFor.id) : undefined;

  return (
    <DesktopActionsProvider value={actions}>
      <div
        className={`desktop${editMode ? " edit-mode" : ""}${searching ? " searching" : ""}`}
        data-depth={detail ? "pushed" : undefined}
        data-core={coreState}
        style={
          focus
            ? ({
                "--core-x": `${focus.cx}px`,
                "--core-y": `${focus.cy}px`,
                "--core-ry": `${focus.ry}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <Wallpaper
          chips={chips}
          nodes={nodes}
          activeRuns={activeRuns}
          runLabels={runLabels}
          dimmed={!searching}
          searching={searching}
          matched={matched}
          revealLabels={revealLabels}
          coreState={coreState}
          focus={focus}
          onOpenBrain={() => navigate("/brain")}
          onChipActivate={(chip) => {
            if (searching) setDetail(chip);
            else if (chip.runId) navigate(`/runs/${chip.runId}`);
            else navigate("/brain");
          }}
        />

        <div className="depth-layer desktop-depth">
          <NowPanel />
          <HudTelemetry activeRuns={activeRuns} />
          <WidgetLayer
            layout={layout}
            widgets={widgets}
            editMode={editMode}
            onLayoutChange={commit}
            onMetrics={setMetrics}
            onConfigure={(id, anchor) => setConfigFor({ id, anchor })}
          />
        </div>

        <div className="os-topbar">
          <div className="side">
            <span className="dot ok" aria-hidden />
            <span className="hud-label">
              {t("dash.activeProvider")}: <span className="accent-text">{defaultProvider}</span>
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
              <Tool active={editMode} label={t("os.edit")} onClick={() => setEditMode((v) => !v)}>
                <Pencil aria-hidden />
              </Tool>
              <Tool
                active={searching}
                label={t("desktop.search.open")}
                onClick={() => (searching ? closeSearch() : setSearching(true))}
              >
                <Search aria-hidden />
              </Tool>
              <Tool
                active={revealLabels}
                label={revealLabels ? t("desktop.ring.labelsOff") : t("desktop.ring.labels")}
                onClick={() => setRevealLabels((v) => !v)}
              >
                <Tag aria-hidden />
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
          <SearchBar query={query} matches={matched.size} onQuery={setQuery} onClose={closeSearch} />
        )}

        {editMode && (
          <div className="edit-bar enter-fade-up" role="toolbar" aria-label={t("os.edit")}>
            <span className="hud-label">{t("os.editHint")}</span>
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

        {addAnchor && (
          <AddWidgetGallery
            layout={layout}
            rows={rows}
            anchor={addAnchor}
            onAdd={(next: LayoutMap) => commit(next)}
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

        {detail && (
          <ArtifactModal
            chip={detail}
            onClose={() => setDetail(null)}
            onOpenRun={(runId) => navigate(`/runs/${runId}`)}
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
  const metrics = useOsMetrics({ refetchInterval: 60_000 });
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
export function useCoreState(activeRuns: number): CoreState {
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
  useOsEvent("run.finished", (e) => {
    const status = (e.payload as { status?: string } | undefined)?.status;
    hold(
      status === "done" ? "done" : status === "cancelled" ? "done" : "alert",
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
  return activeRuns > 0 ? "thinking" : "idle";
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

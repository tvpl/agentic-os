/**
 * The OS desktop: a fullscreen surface. The particle wallpaper sits under a
 * "Now" panel (active runs, next routine, latest artifacts); widgets float
 * above on a 24-column grid (stacked below 900 px) and can be dragged,
 * resized and hidden in edit mode. Layout persists in settings.
 *
 * Every widget owns its queries, so one failing endpoint degrades only that
 * widget; the desktop itself never renders blank.
 */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, BrainCircuit, CalendarClock, Grid3x3, Info, LayoutGrid, Palette, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { api, type Meta, type ProviderId, type Skill } from "../api";
import { useT } from "../i18n";
import { qk, useOsProviders, useOsSettings } from "../queries";
import { useToast } from "../components/ui";
import { Button } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { LAUNCHER_EVENT } from "../App";
import { DEFAULT_LAYOUT } from "./defaultLayout";
import { useLayoutState } from "./useGridLayout";
import WidgetLayer, { type WidgetSpec } from "./WidgetLayer";
import Wallpaper from "./Wallpaper";
import NowPanel from "./NowPanel";
import SkillMatrixModal from "./SkillMatrixModal";
import { isActiveStatus, useDesktopArtifacts, useDesktopRuns } from "./data";
import MicroAppsWidget from "./widgets/MicroAppsWidget";
import TodayWidget from "./widgets/TodayWidget";
import WorkspaceWidget from "./widgets/WorkspaceWidget";
import DeckWidget from "./widgets/DeckWidget";
import BoardWidget from "./widgets/BoardWidget";
import PulseWidget from "./widgets/PulseWidget";
import AttentionWidget from "./widgets/AttentionWidget";

/** One-click accent presets, cycled by the palette tool and persisted. */
const ACCENT_PRESETS = ["#f97316", "#22d3ee", "#a78bfa", "#4ade80", "#f43f5e", "#fbbf24"];

export default function Desktop({ meta, onMetaChanged }: { meta: Meta; onMetaChanged?: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [matrixFor, setMatrixFor] = useState<Skill | null>(null);
  const [rows, setRows] = useState(18);

  const settings = useOsSettings();
  const providers = useOsProviders();
  const runs = useDesktopRuns();
  const artifacts = useDesktopArtifacts();

  const { layout, commit, saving } = useLayoutState({
    serverLayout: settings.data?.dashboardLayout,
    rows,
    editing: editMode,
    onError: (err) => toast(`${t("os.layoutSaveFailed")}: ${err.message}`, "danger"),
  });

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
      const res = await api.post<{ runId: string }>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, { inputs: {} });
      toast(`▶ /${skill.slug}`, "ok");
      return { navigateTo: `/runs/${res.runId}` };
    },
    onSuccess: ({ navigateTo }) => navigate(navigateTo),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const resetLayout = async () => {
    if (await confirm({ title: t("os.resetLayout"), body: t("os.resetLayoutBody") })) commit(DEFAULT_LAYOUT);
  };

  const widgets: Record<string, WidgetSpec> = {
    microapps: { title: t("dash.microapps"), icon: <Grid3x3 aria-hidden />, node: <MicroAppsWidget /> },
    today: { title: t("dash.clock"), icon: <CalendarClock aria-hidden />, node: <TodayWidget /> },
    workspace: { title: t("widget.workspace"), icon: <BrainCircuit aria-hidden />, node: <WorkspaceWidget /> },
    deck: { title: t("dash.deck"), icon: <Sparkles aria-hidden />, node: <DeckWidget onRun={(s) => runSkill.mutate(s)} onConfig={setMatrixFor} /> },
    routines: { title: t("dash.board"), icon: <CalendarClock aria-hidden />, node: <BoardWidget /> },
    pulse: { title: t("widget.pulse"), icon: <Activity aria-hidden />, node: <PulseWidget onRunSkill={() => document.querySelector<HTMLElement>(".deck-card .btn")?.focus()} /> },
    attention: { title: t("dash.attention"), icon: <AlertTriangle aria-hidden />, node: <AttentionWidget /> },
  };

  const activeRuns = (runs.data ?? []).filter((r) => isActiveStatus(r.status)).length;
  const defaultProvider = providers.data?.find((p) => p.isDefault)?.id ?? meta.name;

  return (
    <div className={`desktop${editMode ? " edit-mode" : ""}`}>
      <Wallpaper
        artifacts={artifacts.data ?? []}
        activeRuns={activeRuns}
        dimmed
        onOpenBrain={() => navigate("/brain")}
        onOpenRun={(runId) => navigate(`/runs/${runId}`)}
      />
      <NowPanel />

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
              <span className="accent">{meta.name.replace(/\s*os$/i, "")}</span> <span style={{ fontWeight: 400 }}>{t("dash.brand")}</span>
            </span>
          </div>
          <div className="byline">{t("dash.brainSub")}</div>
          <div className="os-tools">
            <Tool active={editMode} label={t("os.edit")} onClick={() => setEditMode((v) => !v)}>
              <Pencil aria-hidden />
            </Tool>
            <Tool label={`${t("nav.brain")} ( / )`} onClick={() => navigate("/brain")}>
              <Search aria-hidden />
            </Tool>
            <Tool label={`${t("os.menu")} (Ctrl/⌘ M)`} onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
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
                <span className={`dot ${p.enabled ? (p.health.ok ? "ok" : p.health.installed ? "warn" : "danger") : "dim"}`} style={{ marginRight: 5 }} />
                {p.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      <WidgetLayer layout={layout} widgets={widgets} editMode={editMode} onLayoutChange={commit} onMetrics={(m) => m.rows !== rows && setRows(m.rows)} />

      {editMode && (
        <div className="edit-bar enter-fade-up" role="toolbar" aria-label={t("os.edit")}>
          <span className="hud-label">{t("os.editHint")}</span>
          {Object.entries(layout)
            .filter(([id, box]) => !box.visible && widgets[id])
            .map(([id, box]) => (
              <Button key={id} size="sm" variant="outline" icon={<Plus aria-hidden />} onClick={() => commit({ ...layout, [id]: { ...box, visible: true } })}>
                {widgets[id]!.title}
              </Button>
            ))}
          <Button size="sm" variant="secondary" onClick={() => void resetLayout()}>
            {t("os.resetLayout")}
          </Button>
          <Button size="sm" variant="primary" loading={saving} onClick={() => setEditMode(false)}>
            {t("os.done")}
          </Button>
        </div>
      )}

      {matrixFor && (
        <SkillMatrixModal
          skill={matrixFor}
          providers={providers.data ?? []}
          onClose={() => setMatrixFor(null)}
          onSaved={() => {
            setMatrixFor(null);
            qc.invalidateQueries({ queryKey: qk.skills }).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

function Tool({ children, label, active, onClick }: { children: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`os-tool${active ? " active" : ""}`} onClick={onClick} aria-pressed={active} aria-label={label} title={label}>
      {children}
    </button>
  );
}

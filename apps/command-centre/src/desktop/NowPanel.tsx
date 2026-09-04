/**
 * The "Now" panel over the desktop core (roadmap item 2 / analysis item 22):
 * active runs with their current tool, the next routine with a countdown, the
 * last artifacts — and, crucially, never three "nothing" lines. Each section
 * degrades to something useful: the last finished runs with a one-line
 * summary, the next fire of a paused routine with an inline Enable, and the
 * files changed in the last 24 h taken from the graph's `mtime`.
 */
import { Link } from "react-router-dom";
import { useState } from "react";
import { Activity, CalendarClock, FileText, Play, Sparkles, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ArtifactEntry, type RoutineStatus, type RunRecord } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useOsConnectors, useOsSettings } from "../queries";
import { isConfigured } from "./widgets/MicroAppsWidget";
import { nextStep, type StepId } from "./nextStep";
import { StatusBadge, timeAgo, useToast } from "../components/ui";
import { Button } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { useOsNavigate } from "../hooks/useViewTransition";
import { useRunQuery } from "../runs/useRunStream";
import {
  formatCountdown,
  isActiveStatus,
  recentFiles,
  useDesktopArtifacts,
  useDesktopGraph,
  useDesktopRoutines,
  useDesktopRuns,
  useTicker,
  type GraphNodeLite,
} from "./data";

const DAY_MS = 86_400_000;

/** One-line summary of a finished run: the skill or the prompt, plus its status. */
export function runSummary(run: RunRecord, fallback: string): string {
  const head = run.skillSlug ? `/${run.skillSlug}` : run.promptSummary.trim().split(/\r?\n/)[0]?.slice(0, 60);
  return head && head.length > 0 ? head : fallback;
}

export default function NowPanel() {
  const t = useT();
  const runs = useDesktopRuns();
  const routines = useDesktopRoutines();
  const artifacts = useDesktopArtifacts();
  const graph = useDesktopGraph();
  const now = useTicker(1000);

  const active = (runs.data ?? []).filter((r) => isActiveStatus(r.status)).slice(0, 3);
  const finished = (runs.data ?? []).filter((r) => !isActiveStatus(r.status)).slice(0, 3);
  const enabledNext = (routines.data ?? [])
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
  const pausedNext = (routines.data ?? [])
    .filter((r) => !r.enabled)
    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))[0];
  const last = (artifacts.data ?? []).slice(0, 3);
  const changed = recentFiles(graph.data?.nodes ?? [], 3, now - DAY_MS);

  return (
    <section className={`now-panel${active.length > 0 ? " live" : ""}`} aria-label={t("now.title")}>
      <header className="now-head">
        <span className="hud-label">{t("now.title")}</span>
        {active.length > 0 && <span className="badge info">{t("dash.running")}</span>}
      </header>

      <NextStep runs={runs.data ?? []} routines={routines.data ?? []} />

      <div className="now-section">
        <div className="now-label">
          <Activity aria-hidden /> {active.length > 0 ? t("now.activeRuns") : t("desktop.now.lastRuns")}
        </div>
        {active.length > 0 ? (
          active.map((r) => <ActiveRunRow key={r.id} run={r} now={now} />)
        ) : finished.length > 0 ? (
          finished.map((r) => <FinishedRunRow key={r.id} run={r} />)
        ) : (
          <p className="now-muted">{t("now.idle")}</p>
        )}
      </div>

      <div className="now-section">
        <div className="now-label">
          <CalendarClock aria-hidden /> {enabledNext ? t("now.nextRoutine") : t("desktop.now.paused")}
        </div>
        {enabledNext ? (
          <NextRoutine routine={enabledNext} now={now} />
        ) : pausedNext ? (
          <PausedRoutine routine={pausedNext} />
        ) : (
          <p className="now-muted">{t("now.noRoutine")}</p>
        )}
      </div>

      <div className="now-section">
        <div className="now-label">
          <FileText aria-hidden /> {last.length > 0 ? t("now.lastArtifacts") : t("desktop.now.changed")}
        </div>
        {last.length > 0 ? (
          last.map((a) => <ArtifactRow key={`${a.runId}-${a.file}`} artifact={a} />)
        ) : changed.length > 0 ? (
          changed.map((f) => <ChangedFileRow key={f.path} file={f} />)
        ) : (
          <p className="now-muted">{t("now.noArtifacts")}</p>
        )}
      </div>
    </section>
  );
}

function ActiveRunRow({ run, now }: { run: RunRecord; now: number }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useOsNavigate();
  // Per-run record for the current tool; `/api/events` invalidates it on run.event, 5 s is the fallback.
  const detail = useRunQuery(run.id, { refetchInterval: 5000 });
  const events = detail.data?.events ?? [];
  let tool: string | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "tool_use") {
      tool = String(e.tool ?? "");
      break;
    }
  }
  const cancel = useMutation({
    mutationFn: () => api.post(`/api/runs/${encodeURIComponent(run.id)}/cancel`),
    onSuccess: () => {
      toast(t("runs.cancelled"), "ok");
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["run"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const onCancel = async () => {
    if (
      await confirm({
        title: t("now.cancelTitle"),
        body: t("now.cancelBody"),
        danger: true,
        confirmLabel: t("runs.cancel"),
      })
    )
      cancel.mutate();
  };
  const title = run.skillSlug ? `/${run.skillSlug}` : run.promptSummary.slice(0, 48);
  return (
    <div className="now-run">
      <button type="button" className="now-run-main" onClick={() => navigate(`/runs/${run.id}`)}>
        <StatusBadge status={run.status} />
        <span className="now-run-title truncate" title={run.promptSummary}>
          {title}
        </span>
        <span className="now-run-meta mono">
          {run.provider} · {formatCountdown(now - run.createdAt)}
        </span>
        {tool && (
          <span className="now-run-tool mono" title={t("now.tool")}>
            {tool}
          </span>
        )}
      </button>
      <Button
        size="sm"
        variant="ghost"
        icon={<Square aria-hidden />}
        aria-label={t("runs.cancel")}
        title={t("runs.cancel")}
        onClick={() => void onCancel()}
        loading={cancel.isPending}
      />
    </div>
  );
}

function FinishedRunRow({ run }: { run: RunRecord }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Link to={`/runs/${run.id}`} className="now-run-main plain" title={run.promptSummary}>
      <StatusBadge status={run.status} />
      <span className="now-run-title truncate">{runSummary(run, t("desktop.now.noSummary"))}</span>
      <span className="now-run-meta mono">{timeAgo(run.finishedAt ?? run.createdAt, locale)}</span>
    </Link>
  );
}

function NextRoutine({ routine, now }: { routine: RoutineStatus; now: number }) {
  const t = useT();
  const locale = useLocale();
  const at = routine.nextRunAt ?? now;
  return (
    <Link to="/routines" className="now-routine">
      <span className="now-run-title truncate">{routine.name}</span>
      <span className="now-countdown mono">{t("now.in", { time: formatCountdown(at - now) })}</span>
      <span className="now-run-meta mono">
        {new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
      </span>
    </Link>
  );
}

/** A paused routine still knows when it would fire: offer to switch it back on from here. */
function PausedRoutine({ routine }: { routine: RoutineStatus }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const enable = useMutation({
    mutationFn: () => api.post(`/api/routines/${encodeURIComponent(routine.id)}/toggle`),
    onSuccess: () => {
      toast(t("desktop.now.enabled"), "ok");
      qc.invalidateQueries({ queryKey: qk.routines }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  return (
    <div className="now-routine paused">
      <Link to="/routines" className="now-run-title truncate plain">
        {routine.name}
      </Link>
      <span className="now-run-meta mono">
        {routine.nextRunAt
          ? new Date(routine.nextRunAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
          : routine.schedule}
      </span>
      <Button
        size="sm"
        variant="outline"
        icon={<Play aria-hidden />}
        loading={enable.isPending}
        onClick={() => enable.mutate()}
      >
        {t("desktop.now.enable")}
      </Button>
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: ArtifactEntry }) {
  const locale = useLocale();
  return (
    <Link to={`/runs/${artifact.runId}`} className="now-artifact" title={artifact.path}>
      <span className="truncate mono">{artifact.file}</span>
      <span className="now-run-meta">{timeAgo(artifact.createdAt, locale)}</span>
    </Link>
  );
}

function ChangedFileRow({ file }: { file: GraphNodeLite }) {
  const locale = useLocale();
  return (
    <Link to="/brain" className="now-artifact" title={file.path}>
      <span className="truncate mono">{file.name}</span>
      <span className="now-run-meta">{timeAgo(file.mtime, locale)}</span>
    </Link>
  );
}

/* ---- onboarding (plan Onda 2 §7): one next step until the OS is really in use ---- */
const NEXT_DISMISS_KEY = "mordomo.next.dismissed";

function readDismissed(): Set<StepId> {
  try {
    const raw = localStorage.getItem(NEXT_DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as StepId[]) : []);
  } catch {
    return new Set();
  }
}

const STEP_LINK: Record<StepId, string> = {
  folder: "/settings?tab=memory",
  run: "/skills/workspace-digest",
  routine: "/routines",
  budget: "/settings?tab=security",
  connector: "/connectors",
};

function NextStep({ runs, routines }: { runs: RunRecord[]; routines: RoutineStatus[] }) {
  const t = useT();
  const settings = useOsSettings();
  const connectors = useOsConnectors({ staleTime: 60_000, retry: false });
  const [dismissed, setDismissed] = useState<ReadonlySet<StepId>>(() => readDismissed());
  const folders = Array.isArray(settings.data?.indexedFolders)
    ? settings.data.indexedFolders.filter((f) => f.enabled !== false).length
    : 0;
  const step = settings.data
    ? nextStep(
        {
          folders,
          runs: runs.length,
          routinesEnabled: routines.filter((r) => r.enabled).length,
          budgetUsd: settings.data.limits?.dailyBudgetUsd ?? 0,
          connectorsConfigured: (connectors.data ?? []).filter((c) => isConfigured(c.status)).length,
        },
        dismissed,
      )
    : null;
  if (!step) return null;
  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(step);
    setDismissed(next);
    try {
      localStorage.setItem(NEXT_DISMISS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="now-section now-next">
      <div className="now-label">
        <Sparkles aria-hidden /> {t("desktop.next.title")}
      </div>
      <div className="now-next-body">
        <strong>{t(`desktop.next.${step}`)}</strong>
        <p className="now-muted">{t(`desktop.next.${step}Body`)}</p>
        <div className="now-next-actions">
          <Link to={STEP_LINK[step]} className="btn sm primary">
            {t("desktop.next.go")}
          </Link>
          <button type="button" className="btn sm ghost" onClick={dismiss}>
            {t("desktop.next.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Now" panel over the desktop core (roadmap item 2): active runs with
 * their current tool, the next routine with a countdown, the last artifacts.
 */
import { Link, useNavigate } from "react-router-dom";
import { Activity, CalendarClock, FileText, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ArtifactEntry, type RoutineStatus, type RunRecord } from "../api";
import { useLocale, useT } from "../i18n";
import { StatusBadge, timeAgo, useToast } from "../components/ui";
import { Button } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { useRunQuery } from "../runs/useRunStream";
import { formatCountdown, isActiveStatus, useDesktopArtifacts, useDesktopRoutines, useDesktopRuns, useTicker } from "./data";

export default function NowPanel() {
  const t = useT();
  const runs = useDesktopRuns();
  const routines = useDesktopRoutines();
  const artifacts = useDesktopArtifacts();
  const now = useTicker(1000);

  const active = (runs.data ?? []).filter((r) => isActiveStatus(r.status)).slice(0, 3);
  const next = (routines.data ?? [])
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
  const last = (artifacts.data ?? []).slice(0, 3);

  return (
    <section className={`now-panel${active.length > 0 ? " live" : ""}`} aria-label={t("now.title")}>
      <header className="now-head">
        <span className="hud-label">{t("now.title")}</span>
        {active.length > 0 && <span className="badge info">{t("dash.running")}</span>}
      </header>

      <div className="now-section">
        <div className="now-label">
          <Activity aria-hidden /> {t("now.activeRuns")}
        </div>
        {active.length === 0 ? (
          <p className="now-muted">{t("now.idle")}</p>
        ) : (
          active.map((r) => <ActiveRunRow key={r.id} run={r} now={now} />)
        )}
      </div>

      <div className="now-section">
        <div className="now-label">
          <CalendarClock aria-hidden /> {t("now.nextRoutine")}
        </div>
        {next ? <NextRoutine routine={next} now={now} /> : <p className="now-muted">{t("now.noRoutine")}</p>}
      </div>

      <div className="now-section">
        <div className="now-label">
          <FileText aria-hidden /> {t("now.lastArtifacts")}
        </div>
        {last.length === 0 ? <p className="now-muted">{t("now.noArtifacts")}</p> : last.map((a) => <ArtifactRow key={`${a.runId}-${a.file}`} artifact={a} />)}
      </div>
    </section>
  );
}

function ActiveRunRow({ run, now }: { run: RunRecord; now: number }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
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
    if (await confirm({ title: t("now.cancelTitle"), body: t("now.cancelBody"), danger: true, confirmLabel: t("runs.cancel") })) cancel.mutate();
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
            ⚙ {tool}
          </span>
        )}
      </button>
      <Button size="sm" variant="ghost" icon={<Square aria-hidden />} aria-label={t("runs.cancel")} title={t("runs.cancel")} onClick={() => void onCancel()} loading={cancel.isPending} />
    </div>
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
      <span className="now-run-meta mono">{new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>
    </Link>
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

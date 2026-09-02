import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, FileText, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useLocale, useT } from "../i18n";
import { useOsArtifacts } from "../queries";
import { ErrorBox, Skeleton, StatusBadge, formatDuration, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { useTicker } from "../desktop/data";
import EventTimeline from "./EventTimeline";
import { isNotFound, isRunActive, useRunQuery, useRunStream } from "./useRunStream";

export default function RunDetail({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const record = useRunQuery(id, {
    refetchInterval: (q) => (isRunActive(q.state.data?.run.status) ? 5000 : false),
  });
  const run = record.data?.run;
  const active = isRunActive(run?.status);
  const stream = useRunStream(id, active);
  const events = stream.events.length > 0 ? stream.events : (record.data?.events ?? []);
  const now = useTicker(active ? 1000 : 60_000);
  const [preview, setPreview] = useState<{ path: string; content: string | null } | null>(null);

  const artifacts = useOsArtifacts();
  const mine = (artifacts.data ?? []).filter((a) => a.runId === id);

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/runs/${encodeURIComponent(id)}/cancel`),
    onSuccess: () => {
      toast(t("runs.cancelled"), "ok");
      qc.invalidateQueries({ queryKey: ["run", id] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const onCancel = async () => {
    if (await confirm({ title: t("now.cancelTitle"), body: t("now.cancelBody"), danger: true, confirmLabel: t("runs.cancel") })) cancel.mutate();
  };

  const open = useMutation({
    mutationFn: (p: string) => api.get<{ path: string; content: string | null }>(`/api/artifacts/file?p=${encodeURIComponent(p)}`),
    onSuccess: setPreview,
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("common.copied"), "ok");
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  if (record.isError && isNotFound(record.error)) {
    return (
      <div className="page">
        <EmptyState
          icon={<FileText aria-hidden />}
          title={t("runs.notFound")}
          body={t("runs.notFoundBody")}
          action={
            <Link to="/runs" className="btn primary">
              <ArrowLeft aria-hidden /> {t("runs.backToList")}
            </Link>
          }
        />
      </div>
    );
  }
  if (record.isError && !run) {
    return (
      <div className="page">
        <ErrorBox message={record.error.message} offline={record.error.name === "ApiError" && "unreachable" in record.error && Boolean(record.error.unreachable)} onRetry={() => void record.refetch()} />
      </div>
    );
  }
  if (!run) {
    return (
      <div className="page">
        <Skeleton lines={6} />
      </div>
    );
  }

  const title = run.skillSlug ? `/${run.skillSlug}` : run.promptSummary.slice(0, 80) || t("runs.title");
  const duration = active ? formatCountdown(now - (run.startedAt ?? run.createdAt)) : formatDuration(run.durationMs);

  return (
    <div className="page run-detail">
      <div className="page-head">
        <div className="run-head-main">
          <p className="run-back">
            <Link to="/runs">
              <ArrowLeft aria-hidden /> {t("runs.title")}
            </Link>
          </p>
          <h1 className="run-title">
            <span className={run.skillSlug ? "mono" : ""}>{title}</span>
            <StatusBadge status={run.status} />
          </h1>
          <div className="run-meta">
            <Badge kind="meta">{run.provider}</Badge>
            {run.model && (
              <Badge kind="meta" title={t("runs.model")}>
                {run.model}
              </Badge>
            )}
            {run.effort && (
              <Badge kind="meta" title={t("skills.effort")}>
                {t("skills.effort")}: {run.effort}
              </Badge>
            )}
            <Badge kind="meta" title={active ? t("runs.elapsed") : t("table.duration")}>
              {duration}
            </Badge>
            <Badge kind="meta" title={t("table.when")}>
              {timeAgo(run.createdAt, locale)}
            </Badge>
            <Badge kind="meta">{run.origin}</Badge>
          </div>
          {run.cwd && (
            <div className="run-cwd">
              <span className="hud-label">{t("runs.cwd")}</span>
              <code className="mono truncate" title={run.cwd}>
                {run.cwd}
              </code>
              <Button size="sm" variant="ghost" icon={<Copy aria-hidden />} aria-label={t("brain.copyPath")} title={t("brain.copyPath")} onClick={() => void copy(run.cwd!)} />
            </div>
          )}
          <p className="run-id mono">{run.id}</p>
        </div>
        {active && (
          <Button variant="danger" icon={<Square aria-hidden />} onClick={() => void onCancel()} loading={cancel.isPending}>
            {t("runs.cancel")}
          </Button>
        )}
      </div>

      {run.error && (
        <div className="error-box run-error" role="alert">
          {run.error}
        </div>
      )}

      <div className="card">
        <h2>{t("runs.prompt")}</h2>
        <pre className="preview-pre prompt-pre">{run.promptSummary}</pre>
      </div>

      <div className="card">
        <h2>{t("runs.events")}</h2>
        <EventTimeline events={events} live={stream.live} />
      </div>

      <div className="card">
        <h2>{t("runs.artifacts")}</h2>
        {mine.length === 0 && run.artifacts.length === 0 ? (
          <p className="widget-muted">{t("runs.noArtifacts")}</p>
        ) : (
          (mine.length > 0 ? mine : run.artifacts.map((rel) => ({ file: rel.split("/").slice(1).join("/") || rel, path: null as string | null }))).map((a) => (
            <div className="list-row artifact-row" key={a.file}>
              <span className="mono truncate" title={a.path ?? a.file}>
                {a.file}
              </span>
              <span className="artifact-actions">
                {a.path && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => open.mutate(a.path!)} loading={open.isPending && open.variables === a.path}>
                      {t("common.open")}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Copy aria-hidden />} aria-label={t("brain.copyPath")} title={t("brain.copyPath")} onClick={() => void copy(a.path!)} />
                  </>
                )}
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => navigate(`/brain`)}
                  hidden={true}
                  aria-hidden
                  tabIndex={-1}
                />
              </span>
            </div>
          ))
        )}
        {preview && <pre className="preview-pre artifact-preview">{preview.content ?? t("runs.binaryOrLarge")}</pre>}
      </div>
    </div>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
}

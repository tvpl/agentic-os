/**
 * One run: header with cost/token/context badges, inline approval when the
 * profile put the run on hold, prompt, timeline (searchable) or replay,
 * files changed with per-file diffs, and artifacts.
 *
 * Keyboard: `r` run again, `c` continue with a follow-up, `/` search the log.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, Copy, CornerDownRight, FileText, RefreshCw, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useLocale, useT } from "../i18n";
import { useOsArtifacts, useOsObjectives } from "../queries";
import { ErrorBox, Skeleton, StatusBadge, formatDuration, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Segmented } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { useTicker } from "../desktop/data";
import EventTimeline, { type EventTimelineHandle } from "./EventTimeline";
import FilesChanged from "./FilesChanged";
import Replay from "./Replay";
import { ApprovalCard, ToolApprovalCard, useApprovals } from "./ApprovalCards";
import { SquadCard } from "./Squad";
import { SkillNoteCard } from "./SkillNote";
import { approvalForRun, toolApprovalsForRun } from "./approvals";
import { eventsToText } from "./logText";
import { authRecovery } from "./authRecovery";
import { contextWindowFor } from "./models";
import { contextUsed, foldUsage, formatTokens, formatUsd, totalTokens } from "./usage";
import { isNotFound, isRunActive, useRunQuery, useRunStream } from "./useRunStream";

type DetailTab = "timeline" | "replay";

export default function RunDetail({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const record = useRunQuery(id, {
    refetchInterval: (q) => (isRunActive(q.state.data?.run.status) ? 20_000 : false),
  });
  const run = record.data?.run;
  const active = isRunActive(run?.status);
  const stream = useRunStream(id, active);
  const historic = record.data?.events;
  const events = useMemo(
    () => (stream.events.length > 0 ? stream.events : (historic ?? [])),
    [stream.events, historic],
  );
  const now = useTicker(active ? 1000 : 60_000);
  const [preview, setPreview] = useState<{ path: string; content: string | null } | null>(null);
  const [tab, setTab] = useState<DetailTab>("timeline");
  const [followUp, setFollowUp] = useState<string | null>(null);
  /** Approval created by "Run again"/"Continue" under `review_before_write`. */
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const timelineRef = useRef<EventTimelineHandle>(null);
  const followUpRef = useRef<HTMLTextAreaElement>(null);

  const artifacts = useOsArtifacts();
  const objectives = useOsObjectives({ staleTime: 10_000 });
  const mine = (artifacts.data ?? []).filter((a) => a.runId === id);
  const objective = objectives.data?.find((candidate) => candidate.steps.some((step) => step.runId === id));
  const objectiveStep = objective?.steps.find((step) => step.runId === id);
  const running = run?.status === "running" || run?.status === "queued";
  const approvals = useApprovals({
    enabled: run?.status === "waiting_approval" || pendingApprovalId !== null || running,
    refetchInterval: running ? 30_000 : 120_000,
  });
  const toolApprovals = toolApprovalsForRun(approvals.data, run?.id);
  const approval =
    (run ? approvalForRun(approvals.data, run) : null) ??
    (approvals.data ?? []).find((a) => a.id === pendingApprovalId && a.status === "pending") ??
    null;

  const usage = useMemo(() => run?.usage ?? foldUsage(events), [run?.usage, events]);
  const contextTokens = useMemo(() => contextUsed(events), [events]);
  const contextWindow = contextWindowFor(usage?.model ?? run?.model ?? null);

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

  const receiptIds = useRef<Record<string, string>>({});
  const receipt = (action: string) => (receiptIds.current[action] ??= crypto.randomUUID());
  type LaunchResponse = {
    runId: string | null;
    sessionId?: string;
    status?: string;
    pendingApproval?: { id: string } | null;
  };
  const onLaunched = (res: LaunchResponse, action: string) => {
    delete receiptIds.current[action];
    setFollowUp(null);
    qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
    if (res.status === "waiting_approval") {
      setPendingApprovalId(res.pendingApproval?.id ?? null);
      qc.invalidateQueries({ queryKey: ["approvals"] }).catch(() => undefined);
      toast(t("runs.approve.queued"), "info");
      return;
    }
    setPendingApprovalId(null);
    if (res.runId) navigate(`/runs/${res.runId}`);
  };
  const repeat = useMutation({
    mutationFn: () =>
      api.post<LaunchResponse>(`/api/runs/${encodeURIComponent(id)}/retry`, {
        submissionId: receipt("retry"),
      }),
    onSuccess: (res) => {
      onLaunched(res, "retry");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const continueRun = useMutation({
    mutationFn: (prompt: string) =>
      run?.sessionId
        ? api.post<LaunchResponse>(`/api/sessions/${encodeURIComponent(run.sessionId)}/continue`, {
            submissionId: receipt("continue"),
            prompt,
            mode: run.request?.mode ?? "read_only",
            model: run.model,
            effort: run.effort,
            ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
          })
        : api.post<LaunchResponse>("/api/runs", {
            submissionId: receipt("continue"),
            prompt,
            mode: run?.request?.mode ?? "read_only",
            provider: run?.provider,
            model: run?.model,
            effort: run?.effort,
            cwd: run?.cwd,
            ...(run?.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
          }),
    onSuccess: (res) => onLaunched(res, "continue"),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const open = useMutation({
    mutationFn: (p: string) =>
      api.get<{ path: string; content: string | null }>(`/api/artifacts/file?p=${encodeURIComponent(p)}`),
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

  const copyLog = () => void copy(eventsToText(events, locale));
  const runAgain = () => {
    if (run?.request) repeat.mutate();
  };
  const startFollowUp = () => {
    setTab("timeline");
    setFollowUp((cur) => cur ?? "");
    window.setTimeout(() => followUpRef.current?.focus(), 0);
  };

  // Shortcuts: never steal keys while the reader is typing. The handlers live
  // in a ref so the listener is attached once, not on every streamed frame.
  const shortcuts = useRef({ runAgain, startFollowUp });
  shortcuts.current = { runAgain, startFollowUp };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "/") {
        e.preventDefault();
        setTab("timeline");
        window.setTimeout(() => timelineRef.current?.focusSearch(), 0);
      } else if (e.key === "r") {
        e.preventDefault();
        shortcuts.current.runAgain();
      } else if (e.key === "c") {
        e.preventDefault();
        shortcuts.current.startFollowUp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        <ErrorBox
          message={record.error.message}
          offline={
            record.error.name === "ApiError" &&
            "unreachable" in record.error &&
            Boolean(record.error.unreachable)
          }
          onRetry={() => void record.refetch()}
        />
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
  const duration = active
    ? formatCountdown(now - (run.startedAt ?? run.createdAt))
    : formatDuration(run.durationMs, locale);
  const contextPct =
    contextTokens != null && contextWindow ? Math.min(100, (contextTokens / contextWindow) * 100) : null;
  const recovery = authRecovery(run.provider, run.failure?.message ?? run.error);

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
            {(usage?.model ?? run.model) && (
              <Badge kind="meta" title={t("runs.model")}>
                {usage?.model ?? run.model}
              </Badge>
            )}
            {run.effort && (
              <Badge kind="meta" title={t("skills.effort")}>
                {t("skills.effort")}: {run.effort}
              </Badge>
            )}
            <Badge kind="meta" className="num" title={active ? t("runs.elapsed") : t("table.duration")}>
              {duration}
            </Badge>
            <Badge kind="meta" title={t("table.when")}>
              {timeAgo(run.createdAt, locale)}
            </Badge>
            <Badge kind="meta">{run.origin}</Badge>
            {usage && (
              <>
                <Badge kind="state" tone="accent" title={t("runs.usage.costTitle")}>
                  {formatUsd(usage.costUsd)}
                </Badge>
                <Badge kind="meta" className="num" title={t("runs.usage.tokensTitle")}>
                  ↑{formatTokens(usage.inputTokens)} ↓{formatTokens(usage.outputTokens)} ·{" "}
                  {formatTokens(totalTokens(usage))}
                </Badge>
              </>
            )}
          </div>
          <div className="run-context">
            <span className="hud-label">{t("runs.usage.context")}</span>
            {contextPct == null ? (
              <span className="mono dim">{t("runs.usage.na")}</span>
            ) : (
              <>
                <span
                  className="context-track"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(contextPct)}
                  aria-label={t("runs.usage.context")}
                >
                  <span className="context-fill" style={{ transform: `scaleX(${contextPct / 100})` }} />
                </span>
                <span className="mono tnum">
                  {formatTokens(contextTokens)} / {formatTokens(contextWindow)} · {Math.round(contextPct)}%
                </span>
              </>
            )}
          </div>
          {run.cwd && (
            <div className="run-cwd">
              <span className="hud-label">{t("runs.cwd")}</span>
              <code className="mono truncate" title={run.cwd}>
                {run.cwd}
              </code>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy aria-hidden />}
                aria-label={t("brain.copyPath")}
                title={t("brain.copyPath")}
                onClick={() => void copy(run.cwd!)}
              />
            </div>
          )}
          <p className="run-id mono">{run.id}</p>
        </div>
        <div className="run-actions">
          {active && (
            <Button
              variant="danger"
              icon={<Square aria-hidden />}
              onClick={() => void onCancel()}
              loading={cancel.isPending}
            >
              {t("runs.cancel")}
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden />}
            onClick={runAgain}
            loading={repeat.isPending}
            disabled={!run.request}
            title={t("runs.actions.againTitle")}
          >
            {t("runs.actions.again")}
          </Button>
          <Button
            variant="secondary"
            icon={<CornerDownRight aria-hidden />}
            onClick={startFollowUp}
            title={t("runs.actions.continueTitle")}
          >
            {t("runs.actions.continue")}
          </Button>
          <Button
            variant="ghost"
            icon={<ClipboardList aria-hidden />}
            onClick={copyLog}
            disabled={events.length === 0}
            title={t("runs.actions.copyLogTitle")}
          >
            {t("runs.actions.copyLog")}
          </Button>
        </div>
      </div>

      {objective && objectiveStep && (
        <div className="card run-objective">
          <span className="hud-label">{t("runs.objective.title")}</span>
          <strong>{objective.title}</strong>
          <div className="run-objective-chain" aria-label={t("runs.objective.chain")}>
            {objective.steps.map((step) => (
              <span
                key={step.id}
                className={step.id === objectiveStep.id ? "current" : ""}
                title={step.blockedReason ?? step.nextAction ?? step.status}
              >
                {step.position + 1}. {step.title} · {step.status}
              </span>
            ))}
          </div>
          {objectiveStep.evidence?.verified && (
            <p className="hint">
              {t("runs.objective.evidence", { n: objectiveStep.evidence.artifacts.length })}
            </p>
          )}
        </div>
      )}

      {!active && (
        <div className={`card run-outcome${run.failure ? " failed" : ""}`}>
          <div>
            <span className="hud-label">{t("runs.outcome.title")}</span>
            <strong>
              {run.status === "done"
                ? t("runs.outcome.completed")
                : (run.failure?.message ?? run.error ?? run.status)}
            </strong>
          </div>
          <div className="run-outcome-facts">
            {run.failure && (
              <Badge kind="state" tone="danger">
                {run.failure.code}
              </Badge>
            )}
            <span>{t("runs.outcome.files", { n: run.filesChanged?.length ?? 0 })}</span>
            <span>{t("runs.outcome.artifacts", { n: run.artifacts?.length ?? 0 })}</span>
            {run.failure?.effectsUncertain && (
              <Badge kind="state" tone="warn">
                {t("runs.outcome.uncertain")}
              </Badge>
            )}
          </div>
          {run.failure && (
            <p className="hint">
              {run.failure.effectsUncertain
                ? t("runs.outcome.reconcile")
                : run.failure.recoverable
                  ? t("runs.outcome.retry")
                  : t("runs.outcome.fix")}
            </p>
          )}
        </div>
      )}

      {toolApprovals.length > 0 && (
        <div className="card approvals-card tool">
          <h2>{t("runs.toolApprove.title")}</h2>
          {toolApprovals.map((a) => (
            <ToolApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      )}
      {approval && (
        <div className="card approvals-card">
          <h2>{t("runs.approve.title")}</h2>
          <ApprovalCard
            approval={approval}
            compact
            onLaunched={(runId) => {
              setPendingApprovalId(null);
              if (runId) navigate(`/runs/${runId}`);
            }}
          />
        </div>
      )}

      {run.error && (
        <div className="error-box run-error" role="alert">
          {run.error}
          {recovery && (
            <div className="auth-recovery">
              <strong>{t("desktop.auth.title")}</strong>
              <p>{t("desktop.auth.body", { command: recovery })}</p>
              <code>{recovery}</code> · <Link to="/settings?tab=providers">{t("desktop.auth.settings")}</Link>
            </div>
          )}
        </div>
      )}

      {followUp !== null && (
        <div className="card follow-up">
          <h2>{t("runs.actions.continue")}</h2>
          <p className="hint">{t("runs.actions.continueHint")}</p>
          <textarea
            ref={followUpRef}
            className="input follow-up-input"
            rows={4}
            value={followUp}
            aria-label={t("runs.actions.continue")}
            placeholder={t("runs.actions.continuePh")}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && followUp.trim())
                continueRun.mutate(followUp);
              if (e.key === "Escape") setFollowUp(null);
            }}
          />
          <div className="row-actions">
            <Button
              variant="primary"
              disabled={!followUp.trim()}
              loading={continueRun.isPending}
              onClick={() => continueRun.mutate(followUp)}
            >
              {t("common.run")}
            </Button>
            <Button variant="ghost" onClick={() => setFollowUp(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      <div className="card">
        <h2 id="run-prompt-heading">{t("runs.prompt")}</h2>
        <pre
          className="preview-pre prompt-pre"
          role="region"
          aria-labelledby="run-prompt-heading"
          tabIndex={0}
        >
          {run.request?.kind === "prompt" || run.request?.kind === "system"
            ? run.request.prompt
            : run.promptSummary}
        </pre>
      </div>

      <div className="card">
        <div className="card-head-row">
          <h2>{t("runs.events")}</h2>
          <Segmented
            ariaLabel={t("runs.tabs")}
            size="sm"
            value={tab}
            onChange={(v) => setTab(v as DetailTab)}
            options={[
              { value: "timeline", label: t("runs.tabTimeline") },
              { value: "replay", label: t("runs.tabReplay") },
            ]}
          />
        </div>
        {tab === "timeline" ? (
          <EventTimeline ref={timelineRef} events={events} live={stream.live} cwd={run.cwd} searchable />
        ) : (
          <Replay events={events} />
        )}
      </div>

      <SquadCard run={run} />

      <SkillNoteCard run={run} />

      <FilesChanged runId={id} files={run.filesChanged ?? []} cwd={run.cwd} />

      <div className="card">
        <h2>{t("runs.artifacts")}</h2>
        {mine.length === 0 && run.artifacts.length === 0 ? (
          <p className="widget-muted">{t("runs.noArtifacts")}</p>
        ) : (
          (mine.length > 0
            ? mine
            : run.artifacts.map((rel) => ({
                file: rel.split("/").slice(1).join("/") || rel,
                path: null as string | null,
              }))
          ).map((a) => (
            <div className="list-row artifact-row" key={a.file}>
              <span className="mono truncate" title={a.path ?? a.file}>
                {a.file}
              </span>
              <span className="artifact-actions">
                {a.path && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => open.mutate(a.path!)}
                      loading={open.isPending && open.variables === a.path}
                    >
                      {t("common.open")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy aria-hidden />}
                      aria-label={t("brain.copyPath")}
                      title={t("brain.copyPath")}
                      onClick={() => void copy(a.path!)}
                    />
                  </>
                )}
              </span>
            </div>
          ))
        )}
        {preview && (
          <pre className="preview-pre artifact-preview">{preview.content ?? t("runs.binaryOrLarge")}</pre>
        )}
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

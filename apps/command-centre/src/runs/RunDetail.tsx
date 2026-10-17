/**
 * One run: header with cost/token/context badges, inline approval when the
 * profile put the run on hold, prompt, timeline (searchable) or replay,
 * files changed with per-file diffs, and artifacts.
 *
 * Keyboard: `r` run again, `c` continue with a follow-up, `/` search the log.
 */
import "./runs.css";
import { FailureFixCard } from "./FailureFixCard";
import { recallFromEvents } from "./recallFromEvents";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, Copy, CornerDownRight, FileText, RefreshCw, Square } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "../apiCall";
import { useLocale, useT } from "../i18n";
import { useOsArtifacts, useOsObjectives, useOsProviders } from "../queries";
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
import { useCommands, type Command } from "../commands/registry";
import { Tooltip } from "../ui";

type DetailTab = "timeline" | "replay";

export default function RunDetail({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const providers = useOsProviders();
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
    mutationFn: () => apiCall("POST /api/runs/:id/cancel", { params: { id } }),
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
      apiCall("POST /api/runs/:id/retry", {
        params: { id },
        body: {
          submissionId: receipt("retry"),
        },
      }),
    onSuccess: (res) => {
      onLaunched(res, "retry");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const continueRun = useMutation({
    mutationFn: (prompt: string) =>
      run?.sessionId
        ? apiCall("POST /api/sessions/:id/continue", {
            params: { id: run.sessionId },
            body: {
              submissionId: receipt("continue"),
              prompt,
              mode: run.request?.mode ?? "read_only",
              model: run.model,
              effort: run.effort,
              ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
            },
          })
        : apiCall("POST /api/runs", {
            body: {
              submissionId: receipt("continue"),
              prompt,
              mode: run?.request?.mode ?? "read_only",
              provider: run?.provider,
              model: run?.model,
              effort: run?.effort,
              cwd: run?.cwd ?? undefined,
              ...(run?.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
            },
          }),
    onSuccess: (res) => onLaunched(res, "continue"),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const open = useMutation({
    mutationFn: (p: string) => apiCall("GET /api/artifacts/file", { query: { p: p } }),
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

  // Shortcuts (the `view:runs` scope; bare keys, so never while the reader is
  // typing). The handlers live in a ref so the commands are registered once,
  // not on every streamed frame. A run shown twice (a lâmina and the Runs
  // scene) answers once: the newest instance holds the keys.
  const shortcuts = useRef({ runAgain, startFollowUp });
  shortcuts.current = { runAgain, startFollowUp };
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "runs.search",
        title: "cmd.runs.search",
        group: "view",
        scope: "view:runs",
        keys: ["/"],
        run: () => {
          setTab("timeline");
          window.setTimeout(() => timelineRef.current?.focusSearch(), 0);
        },
      },
      {
        id: "runs.again",
        title: "cmd.runs.again",
        group: "view",
        scope: "view:runs",
        keys: ["r"],
        run: () => shortcuts.current.runAgain(),
      },
      {
        id: "runs.followUp",
        title: "cmd.runs.followUp",
        group: "view",
        scope: "view:runs",
        keys: ["c"],
        run: () => shortcuts.current.startFollowUp(),
      },
    ],
    [],
  );
  useCommands(commands, { exclusive: "run-detail" });

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
  const recalled = recallFromEvents(events).flatMap((r) => r.paths);
  const duration = active
    ? formatCountdown(now - (run.startedAt ?? run.createdAt))
    : formatDuration(run.durationMs, locale);
  const contextPct =
    contextTokens != null && contextWindow ? Math.min(100, (contextTokens / contextWindow) * 100) : null;
  const recovery = authRecovery(run.provider, run.failure?.message ?? run.error, providers.data);

  return (
    <div className={`page run-detail${embedded ? " embedded" : ""}`}>
      {/* Embedded (the Runs scene's Log): the scene already says the run's name, state,
          numbers, error and ways on — the record starts below them. */}
      {embedded ? (
        <div className="run-embedded-acts">
          <Button
            size="sm"
            variant="ghost"
            icon={<ClipboardList aria-hidden />}
            onClick={copyLog}
            disabled={events.length === 0}
            title={t("runs.actions.copyLogTitle")}
          >
            {t("runs.actions.copyLog")}
          </Button>
        </div>
      ) : (
        <div className="page-head detail">
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
            {/* The sheet (refino item 14): who ran it on one line, what it cost on the next. */}
            <p className="run-sheet-line mono">
              <span>{run.provider}</span>
              {(usage?.model ?? run.model) && (
                <>
                  <span className="dot" aria-hidden>
                    ·
                  </span>
                  <span title={t("runs.model")}>{usage?.model ?? run.model}</span>
                </>
              )}
              {run.effort && (
                <>
                  <span className="dot" aria-hidden>
                    ·
                  </span>
                  <span title={t("skills.effort")}>
                    {t("skills.effort").toLowerCase()} {run.effort}
                  </span>
                </>
              )}
              <span className="dot" aria-hidden>
                ·
              </span>
              <span>{run.origin}</span>
              <span className="dot" aria-hidden>
                ·
              </span>
              <span title={t("table.when")}>{timeAgo(run.createdAt, locale)}</span>
            </p>
            <div className="run-sheet-metrics">
              {usage && (
                <span className="run-metric">
                  <b className="tnum accent">{formatUsd(usage.costUsd)}</b>
                  <small>{t("runs.usage.costTitle")}</small>
                </span>
              )}
              {usage && (
                <span className="run-metric" title={t("runs.usage.tokensTitle")}>
                  <b className="tnum">
                    ↑{formatTokens(usage.inputTokens)} ↓{formatTokens(usage.outputTokens)}
                  </b>
                  <small>{formatTokens(totalTokens(usage))} tokens</small>
                </span>
              )}
              <span className="run-metric">
                <b className="tnum">{duration}</b>
                <small>{active ? t("runs.elapsed") : t("table.duration")}</small>
              </span>
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
                <Tooltip label={t("brain.copyPath")}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy aria-hidden />}
                    aria-label={t("brain.copyPath")}
                    onClick={() => void copy(run.cwd!)}
                  />
                </Tooltip>
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
      )}

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

      {!active && !embedded && (
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
          {run.status !== "done" && (
            <FailureFixCard
              runId={run.id}
              failure={run.failure}
              provider={run.provider}
              status={run.status}
            />
          )}
          {recalled.length > 0 && (
            <div className="run-recalled">
              <span className="hud-label">{t("desktop.recalled", { n: recalled.length })}</span>
              <ul>
                {recalled.slice(0, 10).map((p, i) => (
                  <li key={`${p.path}-${i}`} className="mono">
                    {p.path} <span className="dim">§ {p.section}</span>
                  </li>
                ))}
              </ul>
            </div>
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

      {run.error && !embedded && (
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
                    <Tooltip label={t("brain.copyPath")}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Copy aria-hidden />}
                        aria-label={t("brain.copyPath")}
                        onClick={() => void copy(a.path!)}
                      />
                    </Tooltip>
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

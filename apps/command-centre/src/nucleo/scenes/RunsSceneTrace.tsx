/**
 * A run's trace, unfolded in place under the river (Runs scene): title,
 * meta and status, the chain of steps with the failing one lit and its
 * error, and the agent's line — for a failed run the cause and the way out
 * (retry, sign in, raise the budget, approvals), for a live one what it is
 * doing right now (streamed), for a finished one its answer. Everything
 * else a run has lives behind "Full detail".
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw, Square, X } from "lucide-react";
import { api } from "../../api";
import { useLocale, useT } from "../../i18n";
import { formatDuration, useToast } from "../../components/ui";
import { useConfirm } from "../../hooks/useConfirm";
import { useDesktopActions } from "../../desktop/actions";
import { useTicker } from "../../desktop/data";
import { FailureFixCard } from "../../runs/FailureFixCard";
import { failureFix } from "../../runs/failureFix";
import { authRecovery } from "../../runs/authRecovery";
import { narrate } from "../../runs/humanize";
import { formatTokens, formatUsd, totalTokens } from "../../runs/usage";
import { isNotFound, isRunActive, isRunFailed, useRunQuery, useRunStream } from "../../runs/useRunStream";
import { compactSteps, extractSteps, isGap, resultSummary } from "./runsTrace";
import { laneOf, runLabel, runStart, toneOf } from "./runsRiver";
import { formatWhen } from "./runsFormat";

export default function RunsTrace({
  id,
  onClose,
  onDetail,
  detailOpen,
}: {
  id: string;
  onClose: () => void;
  onDetail: () => void;
  detailOpen: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { openRun } = useDesktopActions();
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
  const steps = useMemo(() => (run ? extractSteps(events, run, t, run.cwd) : []), [events, run, t]);
  const [expanded, setExpanded] = useState(false);
  const chain = expanded ? steps : compactSteps(steps, 7);

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/runs/${encodeURIComponent(id)}/cancel`),
    onSuccess: () => {
      toast(t("runs.cancelled"), "ok");
      qc.invalidateQueries({ queryKey: ["run", id] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const again = useMutation({
    mutationFn: () =>
      api.post<{ runId: string | null; status?: string }>(`/api/runs/${encodeURIComponent(id)}/retry`, {
        submissionId: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (res.runId) openRun(res.runId);
      else {
        qc.invalidateQueries({ queryKey: ["approvals"] }).catch(() => undefined);
        toast(t("runs.approve.queued"), "info");
      }
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  if (record.isError && isNotFound(record.error)) {
    return (
      <div className="rs-trace-top">
        <p className="rs-quiet">{t("scene.runs.trace.notFound")}</p>
        <CloseButton onClose={onClose} />
      </div>
    );
  }
  if (!run) {
    return <p className="rs-quiet rs-pulse">{t("scene.runs.trace.loading")}</p>;
  }

  const tone = toneOf(run.status);
  const start = runStart(run);
  const duration = active ? formatDuration(now - start, locale) : formatDuration(run.durationMs, locale);
  const usage = run.usage;
  const failed = isRunFailed(run.status) || run.status === "cancelled";
  const fix = failureFix(run.failure, run.provider, run.status);
  const fixRetries = fix && ["retry", "provider", "login"].includes(fix.action.kind);
  const login = authRecovery(run.provider, run.failure?.message ?? run.error);
  const statusWord = (() => {
    if (run.status === "timed_out") return t("scene.runs.status.timedOut");
    const key = `status.${run.status}` as Parameters<typeof t>[0];
    const s = t(key);
    return s === key ? run.status.replace(/_/g, " ") : s;
  })();
  const live = active ? narrate(events, t, run.cwd, 1)[0] : undefined;
  const summary = !active && !failed ? resultSummary(events) : null;

  return (
    <>
      <div className="rs-trace-top">
        <h3 className={run.skillSlug ? "mono" : undefined}>{runLabel(run, 90)}</h3>
        <span className="rs-pill" data-tone={tone}>
          {statusWord}
        </span>
        <span className="rs-meta mono">
          {[
            t(`scene.runs.lane.short.${laneOf(run)}`),
            run.provider,
            usage?.model ?? run.model,
            formatWhen(start, now, locale),
            duration,
            usage ? `${formatTokens(totalTokens(usage))} tok` : null,
            usage?.costUsd != null ? formatUsd(usage.costUsd) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="rs-trace-acts">
          {active && (
            <button
              type="button"
              className="rs-btn ghost"
              disabled={cancel.isPending}
              onClick={() => {
                void confirm({
                  title: t("now.cancelTitle"),
                  body: t("now.cancelBody"),
                  danger: true,
                  confirmLabel: t("runs.cancel"),
                }).then((ok) => ok && cancel.mutate());
              }}
            >
              <Square aria-hidden /> {t("scene.runs.stop")}
            </button>
          )}
          {!active && !fixRetries && (
            <button
              type="button"
              className="rs-btn ghost"
              disabled={again.isPending || !run.request}
              title={t("runs.actions.againTitle")}
              onClick={() => again.mutate()}
            >
              <RefreshCw aria-hidden /> {t("scene.runs.again")}
            </button>
          )}
          <button
            type="button"
            className="rs-btn"
            aria-expanded={detailOpen}
            data-detail-trigger=""
            onClick={onDetail}
          >
            {t("scene.runs.detail")} <ArrowUpRight aria-hidden />
          </button>
          <CloseButton onClose={onClose} />
        </span>
      </div>

      <ol className="rs-chain" aria-label={t("scene.runs.trace.steps")}>
        {chain.map((s, i) =>
          isGap(s) ? (
            <li key={s.key} className="rs-step gap" style={{ animationDelay: `${i * 70}ms` }}>
              <button type="button" className="rs-gap" onClick={() => setExpanded(true)}>
                {t("scene.runs.trace.more", { n: s.gap })}
              </button>
            </li>
          ) : (
            <li key={s.key} className="rs-step" data-tone={s.tone} style={{ animationDelay: `${i * 70}ms` }}>
              <b>
                {s.text}
                {s.count > 1 && (
                  <span className="rs-times"> {t("scene.runs.trace.times", { n: s.count })}</span>
                )}
              </b>
              {s.subject && (
                <code className="rs-subject" title={s.subject}>
                  {s.subject}
                </code>
              )}
              <small className="mono">
                {/* The first step says when; the rest say how far into the run. */}
                {i === 0 || s.ts < start
                  ? formatWhen(s.ts, now, locale)
                  : `+${formatDuration(Math.max(0, s.ts - start), locale)}`}
                {s.durationMs != null && s.durationMs > 0 ? ` · ${formatDuration(s.durationMs, locale)}` : ""}
              </small>
              {s.error && <p className="rs-err">{s.error}</p>}
            </li>
          ),
        )}
      </ol>
      {steps.length > 7 && expanded && (
        <button type="button" className="rs-gap" onClick={() => setExpanded(false)}>
          {t("scene.runs.trace.collapse")}
        </button>
      )}

      {(failed || live || active || summary) && (
        <div className="rs-agent" data-tone={failed ? "fail" : undefined}>
          <span className="rs-agent-dot" aria-hidden />
          <div className="rs-agent-body">
            {failed ? (
              <>
                <span className="rs-agent-who">{t("scene.runs.agent")}</span>
                <FailureFixCard
                  runId={run.id}
                  failure={run.failure}
                  provider={run.provider}
                  status={run.status}
                  compact
                />
                {login && fix?.action.kind !== "login" && (
                  <p className="rs-login">
                    {t("scene.runs.agent.login")} <code>{login}</code>
                  </p>
                )}
              </>
            ) : active ? (
              <p aria-live="polite">
                <span className="rs-agent-who">{t("scene.runs.agent")}</span>{" "}
                {live
                  ? t("scene.runs.agent.now", {
                      what: live.subject ? `${live.text} ${live.subject}` : live.text,
                    })
                  : t("scene.runs.agent.starting")}
              </p>
            ) : (
              <p className="rs-summary">
                <span className="rs-agent-who">{t("scene.runs.agent")}</span> {summary}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="rs-x"
      aria-label={t("scene.runs.trace.close")}
      title={t("scene.runs.trace.close")}
      onClick={onClose}
    >
      <X aria-hidden />
    </button>
  );
}

/**
 * One run in focus (Runs scene): what replaces the overview once a run is
 * chosen. A head with the run's name, state and numbers, then three sections
 * — Summary (the agent's line first, the error once, and the ways on: run
 * again, continue, ask the agent), Steps (the chain, the failing step lit)
 * and Log (the complete record) — one at a time.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CornerDownRight, MessageCircleQuestion, RefreshCw, Send, Square } from "lucide-react";
import { apiCall } from "../../apiCall";
import { useLocale, useT } from "../../i18n";
import { formatDuration, useToast } from "../../components/ui";
import { useConfirm } from "../../hooks/useConfirm";
import { useDesktopActions } from "../../desktop/actions";
import { useTicker } from "../../desktop/data";
import { useOsProviders } from "../../queries";
import { failureFix } from "../../runs/failureFix";
import { authRecovery } from "../../runs/authRecovery";
import { narrate } from "../../runs/humanize";
import { formatTokens, formatUsd, totalTokens } from "../../runs/usage";
import { isNotFound, isRunActive, isRunFailed, useRunQuery, useRunStream } from "../../runs/useRunStream";
import RunDetail from "../../runs/RunDetail";
import { Tabs, Tooltip } from "../../ui";
import { askAbout, refWord } from "../subject";
import { compactSteps, extractSteps, isGap, resultSummary } from "./runsTrace";
import { laneOf, runLabel, runStart, toneOf } from "./runsRiver";
import { formatWhen } from "./runsFormat";

type Tab = "summary" | "steps" | "log";
const TABS: readonly Tab[] = ["summary", "steps", "log"];

export default function RunsRun({
  id,
  leaving,
  onClose,
  log = false,
  onLog,
}: {
  id: string;
  leaving: boolean;
  onClose: () => void;
  /** Open on the log (the `?detail=1` link of the old "Full detail"). */
  log?: boolean;
  /** The log is a place in the URL: a link, a reload and Back land on it. */
  onLog?: (open: boolean) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { openRun } = useDesktopActions();
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
  const steps = useMemo(() => (run ? extractSteps(events, run, t, run.cwd) : []), [events, run, t]);
  const [tab, setTabState] = useState<Tab>(log ? "log" : "summary");
  const setTab = (k: Tab) => {
    setTabState(k);
    onLog?.(k === "log");
  };
  const [expanded, setExpanded] = useState(false);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const followRef = useRef<HTMLInputElement>(null);
  const following = followUp !== null;
  useEffect(() => {
    if (following) followRef.current?.focus();
  }, [following]);

  const cancel = useMutation({
    mutationFn: () => apiCall("POST /api/runs/:id/cancel", { params: { id } }),
    onSuccess: () => {
      toast(t("runs.cancelled"), "ok");
      qc.invalidateQueries({ queryKey: ["run", id] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const launched = (res: { runId: string | null }) => {
    qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
    if (res.runId) openRun(res.runId);
    else {
      qc.invalidateQueries({ queryKey: ["approvals"] }).catch(() => undefined);
      toast(t("runs.approve.queued"), "info");
    }
  };
  const again = useMutation({
    mutationFn: () =>
      apiCall("POST /api/runs/:id/retry", {
        params: { id },
        body: {
          submissionId: crypto.randomUUID(),
        },
      }),
    onSuccess: launched,
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const continueRun = useMutation({
    mutationFn: (prompt: string) =>
      run?.sessionId
        ? apiCall("POST /api/sessions/:id/continue", {
            params: { id: run.sessionId },
            body: {
              submissionId: crypto.randomUUID(),
              prompt,
              mode: run.request?.mode ?? "read_only",
              model: run.model,
              effort: run.effort,
              ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
            },
          })
        : apiCall("POST /api/runs", {
            body: {
              submissionId: crypto.randomUUID(),
              prompt,
              mode: run?.request?.mode ?? "read_only",
              provider: run?.provider,
              model: run?.model,
              effort: run?.effort,
              cwd: run?.cwd ?? undefined,
              ...(run?.timeoutMs ? { timeoutMs: run.timeoutMs } : {}),
            },
          }),
    onSuccess: (res) => {
      setFollowUp(null);
      launched(res);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const shell = (children: ReactNode) => (
    <section className={`rs-run${leaving ? " bye" : ""}`} data-id={id} aria-label={t("concept.runs.tabs")}>
      {children}
    </section>
  );
  const back = (
    <Tooltip label={`${t("concept.runs.back")} · Esc`}>
      <button type="button" className="rs-back" aria-label={t("concept.runs.back")} onClick={onClose}>
        <ArrowLeft aria-hidden />
      </button>
    </Tooltip>
  );
  if (record.isError && isNotFound(record.error)) {
    return shell(
      <header className="rs-run-head">
        {back}
        <p className="rs-quiet">{t("scene.runs.trace.notFound")}</p>
      </header>,
    );
  }
  if (!run) return shell(<p className="rs-quiet rs-pulse">{t("scene.runs.trace.loading")}</p>);

  const tone = toneOf(run.status);
  const start = runStart(run);
  const duration = active ? formatDuration(now - start, locale) : formatDuration(run.durationMs, locale);
  const usage = run.usage;
  const failed = isRunFailed(run.status) || run.status === "cancelled";
  const fix = failureFix(run.failure, run.provider, run.status, providers.data);
  const error = failed ? (run.failure?.message ?? run.error ?? null) : null;
  const login = authRecovery(run.provider, run.failure?.message ?? run.error, providers.data);
  const statusWord = (() => {
    if (run.status === "timed_out") return t("scene.runs.status.timedOut");
    const key = `status.${run.status}` as Parameters<typeof t>[0];
    const s = t(key);
    return s === key ? run.status.replace(/_/g, " ") : s;
  })();
  const live = active ? narrate(events, t, run.cwd, 1)[0] : undefined;
  const summary = !active && !failed ? resultSummary(events) : null;
  const agentLine = failed
    ? t(fix?.causeKey ?? "runs.fix.unknown")
    : active
      ? live
        ? t("scene.runs.agent.now", { what: live.subject ? `${live.text} ${live.subject}` : live.text })
        : t("scene.runs.agent.starting")
      : (summary ?? t("concept.runs.done", { duration }));
  const label = runLabel(run, 90);
  const chain = expanded ? steps : compactSteps(steps, 9);
  const submitFollowUp = (e: FormEvent) => {
    e.preventDefault();
    const text = followUp?.trim();
    if (text && !continueRun.isPending) continueRun.mutate(text);
  };

  return shell(
    <>
      <header className="rs-run-head">
        {back}
        <h3 className={run.skillSlug ? "mono" : undefined}>{label}</h3>
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
      </header>

      <Tabs.Root
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        ids={{ tab: (k) => `rs-tab-${k}`, panel: () => "rs-run-panel" }}
      >
        <Tabs.List variant="pill" label={t("concept.runs.tabs")} className="rs-tabs">
          {TABS.map((k) => (
            <Tabs.Tab key={k} value={k}>
              {t(`concept.runs.tab.${k}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel className="rs-run-panel" data-tab={tab} key={tab}>
          {tab === "summary" && (
            <>
              <p className="rs-agent-line" data-tone={failed ? "fail" : undefined} aria-live="polite">
                <span className="rs-agent-dot" aria-hidden />
                {agentLine}
              </p>
              {error && <p className="rs-err">{error}</p>}
              {login && fix?.action.kind === "login" && <code className="rs-login-cmd mono">{login}</code>}
              <div className="rs-run-acts">
                <button
                  type="button"
                  className="nu-act primary"
                  disabled={again.isPending || !run.request || active}
                  title={t("runs.actions.againTitle")}
                  onClick={() => again.mutate()}
                >
                  <RefreshCw aria-hidden />
                  <span>{t("scene.runs.again")}</span>
                </button>
                <button
                  type="button"
                  className="nu-act"
                  aria-expanded={followUp !== null}
                  onClick={() => setFollowUp((cur) => (cur === null ? "" : null))}
                >
                  <CornerDownRight aria-hidden />
                  <span>{t("concept.runs.continue")}</span>
                </button>
                <button
                  type="button"
                  className="nu-act"
                  onClick={() =>
                    askAbout(
                      {
                        id: `subject:run:${run.id}`,
                        kind: "run",
                        ref: refWord("run", run.id.slice(0, 8)),
                        title: `${label} · ${statusWord} (run ${run.id})`,
                      },
                      t("concept.runs.askPrompt", { what: label }),
                    )
                  }
                >
                  <MessageCircleQuestion aria-hidden />
                  <span>{t("concept.runs.ask")}</span>
                </button>
              </div>
              {followUp !== null && (
                <form className="rs-follow" onSubmit={submitFollowUp}>
                  <input
                    ref={followRef}
                    className="input"
                    value={followUp}
                    aria-label={t("concept.runs.continue")}
                    placeholder={t("runs.actions.continuePh")}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setFollowUp(null);
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="rs-follow-send"
                    aria-label={t("concept.runs.send")}
                    disabled={!followUp.trim() || continueRun.isPending}
                  >
                    <Send aria-hidden />
                  </button>
                </form>
              )}
            </>
          )}
          {tab === "steps" && (
            <>
              <ol className="rs-chain" aria-label={t("scene.runs.trace.steps")}>
                {chain.map((s, i) =>
                  isGap(s) ? (
                    <li key={s.key} className="rs-step gap" style={{ animationDelay: `${i * 60}ms` }}>
                      <button type="button" className="rs-gap" onClick={() => setExpanded(true)}>
                        {t("scene.runs.trace.more", { n: s.gap })}
                      </button>
                    </li>
                  ) : (
                    <li
                      key={s.key}
                      className="rs-step"
                      data-tone={s.tone}
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
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
                        {i === 0 || s.ts < start
                          ? formatWhen(s.ts, now, locale)
                          : `+${formatDuration(Math.max(0, s.ts - start), locale)}`}
                        {s.durationMs != null && s.durationMs > 0
                          ? ` · ${formatDuration(s.durationMs, locale)}`
                          : ""}
                      </small>
                      {s.error && <p className="rs-err">{s.error}</p>}
                    </li>
                  ),
                )}
              </ol>
              {steps.length > 9 && expanded && (
                <button type="button" className="rs-gap" onClick={() => setExpanded(false)}>
                  {t("scene.runs.trace.collapse")}
                </button>
              )}
            </>
          )}
          {tab === "log" && (
            <div className="rs-run-log">
              <RunDetail id={id} embedded />
            </div>
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </>,
  );
}

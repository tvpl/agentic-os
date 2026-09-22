/**
 * The conversation behind the console (plan Onda 1 §4), as a strip above the
 * field rather than a window of its own (G4). Every submit continues the
 * same session; each turn shows what was asked, what the agent answered,
 * the tools it used and what it cost. A running turn streams live and can
 * be stopped from here; the full trace is a panel beside the console (G3).
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Square, Volume2 } from "lucide-react";
import type { RunRecord } from "../../api";
import { useLocale, useT } from "../../i18n";
import { speak } from "../../hooks/systemNotify";
import { formatDuration } from "../../components/ui";
import { authRecovery } from "../../runs/authRecovery";
import { useDesktopActions } from "../actions";
import type { replyFromEvents } from "./refs";
import { citations, type Citation } from "./citations";
import type { HumanEvent } from "../../runs/humanize";
import type { OpenPanel } from "../panelKinds";
import { appKindOf } from "../apps";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ArtifactEntry } from "../../api";
import { useOsArtifacts } from "../../queries";
import { useToast } from "../../components/ui";
import { FailureFixCard } from "../../runs/FailureFixCard";

export type Reply = ReturnType<typeof replyFromEvents>;

export function ConsoleThread({
  turns,
  activeId,
  live,
  narration,
  replies,
  panels,
  onStop,
  stopping,
}: {
  turns: readonly RunRecord[];
  activeId: string | undefined;
  live: Reply;
  /** The running turn's last actions, in words (refino item 36). */
  narration: readonly HumanEvent[];
  replies: ReadonlyMap<string, Reply>;
  /** Open panels, so a reply's `@ref` or file becomes a chip (refino item 1). */
  panels: readonly OpenPanel[];
  onStop: (runId: string) => void;
  stopping: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const artifacts = useOsArtifacts();
  // Keep the newest turn in view as it streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, live.text, live.tools, narration.length]);
  return (
    <div className="cons-thread" ref={ref} aria-live="polite">
      {turns.length === 0 && <p className="cons-empty">{t("desktop.console.empty")}</p>}
      {turns.map((run) => (
        <Turn
          key={run.id}
          run={run}
          reply={activeId === run.id ? live : (replies.get(run.id) ?? null)}
          streaming={activeId === run.id}
          narration={activeId === run.id ? narration : []}
          panels={panels}
          artifacts={(artifacts.data ?? []).filter((a) => a.runId === run.id).slice(0, 4)}
          onStop={() => onStop(run.id)}
          stopping={stopping}
        />
      ))}
    </div>
  );
}

function Turn({
  run,
  reply,
  streaming,
  narration,
  panels,
  artifacts,
  onStop,
  stopping,
}: {
  run: RunRecord;
  reply: Reply | null;
  streaming: boolean;
  narration: readonly HumanEvent[];
  panels: readonly OpenPanel[];
  /** What this turn produced (refino item 45). */
  artifacts: readonly ArtifactEntry[];
  onStop: () => void;
  stopping: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const actions = useDesktopActions();
  const send = useMutation({
    mutationFn: (a: ArtifactEntry) =>
      api.post<{ ok: boolean; error?: string }>("/api/channels/telegram/send", {
        text: `${a.file}\n${a.path}`,
      }),
    onSuccess: (r) =>
      toast(r.ok ? t("desktop.artifact.sent") : (r.error ?? t("common.error")), r.ok ? "ok" : "danger"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const forget = useMutation({
    mutationFn: (id: number) => api.post(`/api/memory/facts/${id}/retract`),
    onSuccess: () => {
      toast(t("desktop.facts.retracted"), "ok");
      qc.invalidateQueries({ queryKey: ["memory", "facts"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const { openRun } = actions;
  const cited = reply?.text && !streaming ? citations(reply.text, panels) : [];
  const open = (c: Citation) => {
    if ("path" in c.target) return actions.openDoc(c.target.path);
    const id = c.target.panelId;
    if (id.startsWith("run:")) return actions.openRun(id.slice(4));
    if (id.startsWith("doc:")) return actions.openDoc(id.slice(4));
    const app = appKindOf(id);
    if (app) return actions.openApp(app);
    return actions.openPanel(id);
  };
  const cost = run.usage?.costUsd;
  const recovery = authRecovery(run.provider, `${run.error ?? ""} ${reply?.text ?? ""}`);
  const failed = run.status === "failed" || run.status === "timed_out" || run.status === "interrupted";
  return (
    <div className={`console-turn${streaming ? " streaming" : ""}${failed ? " failed" : ""}`}>
      <div className="console-msg you">
        <span className="console-who">{t("desktop.console.you")}</span>
        <p>{run.promptSummary}</p>
      </div>
      <div className="console-msg agent">
        <span className="console-who">{t("desktop.console.agent")}</span>
        {reply?.text ? (
          <p>{reply.text}</p>
        ) : run.status === "waiting_approval" ? (
          <p className="console-thinking waiting">{t("desktop.console.awaiting")}</p>
        ) : streaming ? (
          <p className="console-thinking">
            <span className="spinner sm" aria-hidden />{" "}
            {narration.length > 0 ? t("desktop.console.working") : t("desktop.console.thinking")}
          </p>
        ) : (
          <p className="console-muted">{runErrorText(run.error, t) ?? t("desktop.console.noReply")}</p>
        )}
        {streaming && run.status !== "waiting_approval" && narration.length > 0 && (
          <ol className="console-narration" aria-label={t("desktop.console.working")}>
            {narration.map((h, i) => (
              <li key={`${i}-${h.text}-${h.subject ?? ""}`} className={`tone-${h.tone}`}>
                <span>{h.text}</span>
                {h.subject && <code className="mono">{h.subject}</code>}
              </li>
            ))}
          </ol>
        )}
        {cited.length > 0 && (
          <div className="console-cites">
            {cited.map((c) => (
              <button key={c.label} type="button" className="console-cite mono" onClick={() => open(c)}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        {!streaming && reply && reply.recalled.some((r) => r.paths.length > 0) && (
          <details className="console-memory">
            <summary>
              {t("desktop.recalled", { n: reply.recalled.reduce((n, r) => n + r.paths.length, 0) })}
            </summary>
            <div className="console-cites">
              {reply.recalled
                .flatMap((r) => r.paths)
                .slice(0, 8)
                .map((p, i) => (
                  <button
                    key={`${p.path}-${i}`}
                    type="button"
                    className="console-cite mono"
                    title={`${p.path} § ${p.section}`}
                    onClick={() => p.path.startsWith("/") && actions.openDoc(p.path)}
                  >
                    {p.path.split("/").pop()}
                  </button>
                ))}
            </div>
          </details>
        )}
        {!streaming &&
          reply?.learned.map((f, i) => (
            <p key={`${f.id ?? i}`} className="console-learned">
              <span>{t("desktop.learned", { text: f.text })}</span>
              {f.id !== null && (
                <button
                  type="button"
                  className="console-link"
                  disabled={forget.isPending}
                  onClick={() => forget.mutate(f.id!)}
                >
                  {t("desktop.learnedUndo")}
                </button>
              )}
            </p>
          ))}
        {!streaming && artifacts.length > 0 && (
          <div className="console-artifacts">
            {artifacts.map((a) => (
              <div key={`${a.runId}-${a.path}`} className="console-artifact">
                <button
                  type="button"
                  className="console-artifact-open"
                  onClick={() => actions.openDoc(a.path)}
                >
                  <span className="mono">{a.file}</span>
                  {a.sizeBytes != null && (
                    <small className="dm">{Math.max(1, Math.round(a.sizeBytes / 1024))} kB</small>
                  )}
                </button>
                <button
                  type="button"
                  className="console-link"
                  title={t("desktop.artifact.send")}
                  disabled={send.isPending}
                  onClick={() => send.mutate(a)}
                >
                  ✈
                </button>
              </div>
            ))}
          </div>
        )}
        {!streaming && failed && (
          <FailureFixCard
            runId={run.id}
            failure={run.failure}
            provider={run.provider}
            status={run.status}
            compact
          />
        )}
        {recovery && (
          <div className="auth-recovery" role="alert">
            <strong>{t("desktop.auth.title")}</strong>
            <p>{t("desktop.auth.body", { command: recovery })}</p>
            <code>{recovery}</code>
            {" · "}
            {/* A deep link: it opens the Settings panel on the providers tab (G2). */}
            <Link to="/settings?tab=providers">{t("desktop.auth.settings")}</Link>
          </div>
        )}
        <div className="console-foot mono">
          {reply && reply.tools > 0 && <span>{t("desktop.console.tools", { n: reply.tools })}</span>}
          {typeof cost === "number" && cost > 0 && <span>${cost.toFixed(3)}</span>}
          {run.durationMs != null && !streaming && <span>{formatDuration(run.durationMs)}</span>}
          {streaming ? (
            <button type="button" className="console-link danger" onClick={onStop} disabled={stopping}>
              <Square aria-hidden /> {t("desktop.console.stop")}
            </button>
          ) : (
            <>
              {reply?.text && (
                <button
                  type="button"
                  className="console-link"
                  onClick={() => speak(reply.text, locale, { force: true })}
                  aria-label={t("desktop.console.read")}
                  title={t("desktop.console.read")}
                >
                  <Volume2 aria-hidden /> {t("desktop.console.read")}
                </button>
              )}
              {/* The trace is a panel on the stage (G3), not a page. */}
              <button type="button" className="console-link" onClick={() => openRun(run.id)}>
                {t("desktop.console.open")} →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The few outcomes the backend reports in English that a person reads in
 * the thread; anything else is shown as the backend wrote it.
 */
function runErrorText(error: string | null | undefined, t: ReturnType<typeof useT>): string | null {
  if (!error) return null;
  if (/approval denied/i.test(error)) return t("desktop.console.deniedByYou");
  if (/approval expired|nobody answered/i.test(error)) return t("desktop.console.deniedByTime");
  if (/cancelled by user|cancel(l)?ed/i.test(error)) return t("desktop.console.cancelledByYou");
  return error;
}

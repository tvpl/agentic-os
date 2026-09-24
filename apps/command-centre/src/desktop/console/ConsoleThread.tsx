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

export type Reply = ReturnType<typeof replyFromEvents>;

export function ConsoleThread({
  turns,
  activeId,
  live,
  replies,
  onStop,
  stopping,
}: {
  turns: readonly RunRecord[];
  activeId: string | undefined;
  live: Reply;
  replies: ReadonlyMap<string, Reply>;
  onStop: (runId: string) => void;
  stopping: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // Keep the newest turn in view as it streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, live.text, live.tools]);
  return (
    <div className="cons-thread" ref={ref} aria-live="polite">
      {turns.length === 0 && <p className="cons-empty">{t("desktop.console.empty")}</p>}
      {turns.map((run) => (
        <Turn
          key={run.id}
          run={run}
          reply={activeId === run.id ? live : (replies.get(run.id) ?? null)}
          streaming={activeId === run.id}
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
  onStop,
  stopping,
}: {
  run: RunRecord;
  reply: Reply | null;
  streaming: boolean;
  onStop: () => void;
  stopping: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const { openRun } = useDesktopActions();
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
        ) : streaming ? (
          <p className="console-thinking">
            <span className="spinner sm" aria-hidden />{" "}
            {reply?.tool ? t("desktop.console.tool", { tool: reply.tool }) : t("desktop.console.thinking")}
          </p>
        ) : (
          <p className="console-muted">{run.error ?? t("desktop.console.noReply")}</p>
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

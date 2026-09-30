/**
 * The selected routine, unfolded under its line in the Routines scene: what
 * it runs, when and where, why it is failing (with a way to ask the agent),
 * the actions of the production view — run now, pause/enable, edit,
 * duplicate, history, delete — and, on demand, its firing history.
 */
import type { RoutineHistoryEntry, RoutineStatus } from "../../api";
import { useLocale, useT, type TKey } from "../../i18n";
import { timeAgo } from "../../components/ui";
import { routineKind, routineRunner } from "../../views/Routines";
import { fireOutcome, type FireOutcome } from "./routinesDial";

export interface RoutinesSceneDetailProps {
  routine: RoutineStatus;
  words: string;
  nextAt: number | null;
  history: RoutineHistoryEntry[] | undefined;
  historyLoading: boolean;
  historyOpen: boolean;
  busy: boolean;
  onRun: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onAsk: () => void;
  onOpenRun: (runId: string) => void;
}

export default function RoutinesSceneDetail({
  routine: r,
  words,
  nextAt,
  history,
  historyLoading,
  historyOpen,
  busy,
  onRun,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  onHistory,
  onAsk,
  onOpenRun,
}: RoutinesSceneDetailProps) {
  const t = useT();
  const locale = useLocale();
  const kind = routineKind(r);
  const runner = routineRunner(r);
  const unhealthy = !r.healthy || r.recentFailures >= 2;
  const lastFail = (history ?? []).find((h) => fireOutcome(h.runStatus, h.status) === "fail");
  const when = (ts: number) =>
    new Date(ts).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const whenLong = (ts: number) =>
    new Date(ts).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  /** The app's word for a run status, or the scene's own when it has none. */
  const statusWord = (status: string, o: FireOutcome) => {
    const key = `status.${status}` as TKey;
    const word = t(key);
    return word === key ? t(`scene.routines.st.${o}`) : word;
  };

  return (
    <div className="rts-detail" role="region" aria-label={t("scene.routines.details", { name: r.name })}>
      <dl className="rts-facts">
        <div>
          <dt>{t("scene.routines.f.target")}</dt>
          <dd className={r.skillSlug ? "mono agent" : undefined}>
            {r.skillSlug ? `/${r.skillSlug}` : (r.prompt ?? "").slice(0, 140) || "—"}
          </dd>
        </div>
        <div>
          <dt>{t("scene.routines.f.when")}</dt>
          <dd>
            {words} <span className="faint">· {t(`backend.kind.${kind}` as TKey)}</span>
          </dd>
        </div>
        <div>
          <dt>{t("scene.routines.f.where")}</dt>
          <dd>
            {r.remoteName ?? t(`backend.runner.${runner}` as TKey)} · {r.provider}
            {kind !== "on-exit" && <> · {r.timezone || t("routines.tzInherited")}</>}
          </dd>
        </div>
        <div>
          <dt>{t("scene.routines.f.next")}</dt>
          <dd className="mono">
            {r.enabled && nextAt ? `${when(nextAt)} · ${timeAgo(nextAt, locale)}` : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("scene.routines.f.last")}</dt>
          <dd className="mono">
            {r.lastFiredAt ? `${when(r.lastFiredAt)} · ${timeAgo(r.lastFiredAt, locale)}` : t("common.never")}
            {r.lastStatus && (
              <span className={`rts-st o-${fireOutcome(r.lastStatus)}`}>
                {" "}
                {t(`scene.routines.st.${fireOutcome(r.lastStatus)}`)}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {unhealthy && (
        <p className="rts-why">
          <span>
            {t("routines.failingWhy", { n: r.recentFailures })}
            {lastFail?.note ? ` — ${lastFail.note.slice(0, 160)}` : ""}
          </span>
          <span className="rts-why-acts">
            <button type="button" className="rts-act agent" onClick={onAsk}>
              {t("scene.routines.ask")}
            </button>
            {lastFail?.runId && (
              <button type="button" className="rts-act" onClick={() => onOpenRun(lastFail.runId!)}>
                {t("routines.fix")}
              </button>
            )}
          </span>
        </p>
      )}

      <div className="rts-acts">
        <button type="button" className="rts-act agent" onClick={onRun} disabled={busy}>
          {t("scene.routines.runNow")}
        </button>
        <button type="button" className="rts-act" onClick={onToggle} disabled={busy}>
          {r.enabled ? t("routines.pause") : t("routines.resume")}
        </button>
        <button type="button" className="rts-act" onClick={onEdit}>
          {t("common.edit")}
        </button>
        <button type="button" className="rts-act" onClick={onDuplicate} disabled={busy}>
          {t("routines.duplicate")}
        </button>
        <button type="button" className="rts-act" onClick={onHistory} aria-expanded={historyOpen}>
          {historyOpen ? t("scene.routines.hideHistory") : t("routines.history")}
        </button>
        <button type="button" className="rts-act danger" onClick={onDelete} disabled={busy}>
          {t("common.delete")}
        </button>
      </div>

      {historyOpen && (
        <ol className="rts-hist" aria-label={t("routines.history")}>
          {historyLoading && !history ? (
            <li className="faint">…</li>
          ) : (history ?? []).length === 0 ? (
            <li className="faint">{t("routines.noHistory")}</li>
          ) : (
            (history ?? []).slice(0, 12).map((h) => {
              const o = fireOutcome(h.runStatus, h.status);
              return (
                <li key={h.id}>
                  <span className="mono faint">{whenLong(h.firedAt)}</span>
                  <span className={`rts-st o-${o}`}>{statusWord(h.runStatus ?? h.status, o)}</span>
                  {h.outcome && (
                    <span className={h.outcome === "alert" ? "rts-st o-fail" : "faint"}>
                      {t(`backend.outcome.${h.outcome}` as TKey)}
                    </span>
                  )}
                  {h.runId ? (
                    <button type="button" className="rts-act" onClick={() => onOpenRun(h.runId!)}>
                      {t("scene.routines.openRun")}
                    </button>
                  ) : (
                    <span className="faint truncate">{h.note ?? ""}</span>
                  )}
                </li>
              );
            })
          )}
        </ol>
      )}
    </div>
  );
}

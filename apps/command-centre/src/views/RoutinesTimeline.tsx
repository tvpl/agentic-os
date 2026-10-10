/**
 * Routines on a line (refino item 29): one row per enabled routine, the
 * last twelve hours to the left of "now" (what fired, and how it went)
 * and the next twelve to the right (what will). A routine that failed
 * twice in a row gets a diagnosis card with a way to fix it.
 */
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type RoutineStatus } from "../api";
import { dictionaries, useLocale, useT, type TKey } from "../i18n";
import { fireOutcome } from "../nucleo/scenes/routinesDial";
import { qk } from "../queries";
import { nextFires } from "./cron";

interface HistoryEntry {
  id: number;
  runId: string | null;
  firedAt: number;
  status: string;
  note: string | null;
  runStatus: string | null;
  durationMs: number | null;
}

const WINDOW_MS = 12 * 3_600_000;

/** A past fire as one of four shapes: a disc (went well), a diamond (failed), a half disc (still going), a dash (nothing ran). */
const DOT_TONE = { ok: "ok", fail: "bad", live: "live", skip: "skip" } as const;

/** What a past fire is drawn as, and the status key that says it in words (the raw status when it has no words). */
export function pastFire(h: Pick<HistoryEntry, "runStatus" | "status">): { tone: string; statusKey: string } {
  const raw = h.runStatus ?? h.status;
  return { tone: DOT_TONE[fireOutcome(h.runStatus, h.status)], statusKey: `status.${raw}` };
}

export function RoutinesTimeline({
  routines,
  now = Date.now(),
}: {
  routines: RoutineStatus[];
  now?: number;
}) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const rows = routines.filter((r) => r.enabled).slice(0, 12);
  const histories = useQueries({
    queries: rows.map((r) => ({
      queryKey: qk.routineHistory(r.id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        api.get<HistoryEntry[]>(`/api/routines/${encodeURIComponent(r.id)}/history`, { signal }),
      staleTime: 60_000,
    })),
  });
  if (rows.length === 0) return null;
  const from = now - WINDOW_MS;
  const to = now + WINDOW_MS;
  const x = (ts: number) => `${Math.max(0, Math.min(100, ((ts - from) / (to - from)) * 100))}%`;
  const hourMarks = Array.from({ length: 9 }, (_, i) => from + (i * (to - from)) / 8);
  const fmtHour = (ts: number) =>
    new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rt-timeline" aria-label={t("routines.timeline")}>
      <div className="rt-timeline-axis" aria-hidden>
        {hourMarks.map((ts, i) => (
          <span key={i} style={{ left: x(ts) }} className="rt-tick">
            {fmtHour(ts)}
          </span>
        ))}
        <span className="rt-now" style={{ left: x(now) }} title={t("routines.now")} />
      </div>
      {rows.map((r, i) => {
        const history = (histories[i]?.data ?? []).filter((h) => h.firedAt >= from && h.firedAt <= now);
        const future = nextFires(r, now, 6).filter((ts) => ts <= to);
        const failing = r.recentFailures >= 2 || !r.healthy;
        const lastFailed = (histories[i]?.data ?? []).find(
          (h) => h.runStatus === "failed" || h.runStatus === "timed_out" || h.status === "failed",
        );
        return (
          <div key={r.id} className={`rt-row${failing ? " failing" : ""}`}>
            <span className="rt-name truncate" title={r.name}>
              {r.name}
            </span>
            <div className="rt-lane">
              <span className="rt-now-line" style={{ left: x(now) }} aria-hidden />
              {history.map((h) => {
                const { tone, statusKey } = pastFire(h);
                const said = statusKey in dictionaries.en ? t(statusKey as TKey) : (h.runStatus ?? h.status);
                return (
                  <button
                    key={h.id}
                    type="button"
                    className={`rt-dot past ${tone}`}
                    style={{ left: x(h.firedAt) }}
                    title={`${fmtHour(h.firedAt)} · ${said}`}
                    aria-label={`${r.name} ${fmtHour(h.firedAt)} · ${said}`}
                    onClick={() => h.runId && navigate(`/runs/${h.runId}`)}
                  />
                );
              })}
              {future.map((ts) => (
                <span key={ts} className="rt-dot future" style={{ left: x(ts) }} title={fmtHour(ts)} />
              ))}
            </div>
            {failing && (
              <div className="rt-diagnosis">
                <span>
                  {t("routines.failingWhy", { n: r.recentFailures })}
                  {lastFailed?.note ? ` — ${lastFailed.note.slice(0, 140)}` : ""}
                </span>
                {lastFailed?.runId && (
                  <button type="button" className="go" onClick={() => navigate(`/runs/${lastFailed.runId}`)}>
                    {t("routines.fix")}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

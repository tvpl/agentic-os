import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import type { RoutineStatus, RunRecord } from "../../api";
import { useLocale, useT } from "../../i18n";
import { EmptyState } from "../../components/primitives";
import { sameLocalDay, useDesktopRoutines, useDesktopRuns } from "../data";
import { WidgetGate } from "./WidgetGate";

export default function BoardWidget() {
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  return (
    <WidgetGate queries={[routines, runs]} lines={3}>
      {routines.data && runs.data && <BoardBody routines={routines.data} runs={runs.data} />}
    </WidgetGate>
  );
}

function BoardBody({ routines, runs }: { routines: RoutineStatus[]; runs: RunRecord[] }) {
  const t = useT();
  const locale = useLocale();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const firedToday = runs.filter((r) => r.origin === "routine" && r.createdAt >= todayStart.getTime() && !["queued", "running"].includes(r.status)).length;
  const rows = routines
    .map((r) => {
      const firedTodayAt = r.lastFiredAt && sameLocalDay(r.lastFiredAt, now) ? r.lastFiredAt : null;
      const ts = r.enabled ? (r.nextRunAt ?? firedTodayAt) : firedTodayAt;
      // "Fired" only when it already ran today and its next run is not also today (compare the full local date, not getDate()).
      const fired = !!firedTodayAt && (!r.nextRunAt || !sameLocalDay(r.nextRunAt, now));
      return { r, ts, fired };
    })
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));
  const nextId = rows.find((row) => row.r.enabled && row.r.nextRunAt)?.r.id ?? null;

  if (rows.length === 0) {
    return (
      <EmptyState
        className="compact"
        icon={<CalendarClock aria-hidden />}
        title={t("board.empty")}
        body={t("board.emptyBody")}
        action={
          <Link to="/routines" className="btn sm primary">
            {t("board.enable")}
          </Link>
        }
      />
    );
  }
  return (
    <>
      <div className="board-count">
        {firedToday}/{routines.filter((r) => r.enabled).length || routines.length} {t("dash.firedToday")}
      </div>
      {rows.map(({ r, ts, fired }) => {
        const isNext = r.id === nextId;
        const status = !r.enabled ? t("board.paused") : fired ? t("board.fired") : isNext ? t("board.next") : t("board.queued");
        return (
          <div className={`board-row${isNext ? " next" : ""}${fired || !r.enabled ? " fired" : ""}`} key={r.id}>
            <span className="time">{ts ? new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"}</span>
            <Link to="/routines" className="name truncate plain">
              {r.name}
            </Link>
            <span className="status">{status}</span>
          </div>
        );
      })}
    </>
  );
}

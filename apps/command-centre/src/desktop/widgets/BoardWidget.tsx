/**
 * Routines board (RUBRIC 1.5): time · runner · routine · status, "n/m fired
 * today" in the header, fired rows dimmed, the next row carrying an accent
 * time badge, and a footer counting the routines per runner.
 *
 * `RoutineStatus.runner` comes from F-BACKEND; while it is absent every
 * routine counts as local and the footer degrades to a single entry.
 */
import { Link } from "react-router-dom";
import { CalendarClock, Cloud, Monitor, Server } from "lucide-react";
import type { RoutineStatus, RunRecord } from "../../api";
import { useLocale, useT, type TKey } from "../../i18n";
import { EmptyState } from "../../components/primitives";
import { sameLocalDay, useDesktopRoutines, useDesktopRuns } from "../data";
import { cfgNumber, type WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

export type Runner = "local" | "service" | "remote";
const RUNNERS: Runner[] = ["local", "service", "remote"];

/** `runner` is optional in the API today: anything unknown is the local desktop. */
export function routineRunner(r: RoutineStatus): Runner {
  const raw = (r as RoutineStatus & { runner?: unknown }).runner;
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "service" || value === "daemon") return "service";
  if (value === "remote" || value === "vps" || value === "cloud" || value === "hermes") return "remote";
  return "local";
}

export function runnerCounts(routines: readonly RoutineStatus[]): Record<Runner, number> {
  const out: Record<Runner, number> = { local: 0, service: 0, remote: 0 };
  for (const r of routines) out[routineRunner(r)] += 1;
  return out;
}

function RunnerIcon({ runner }: { runner: Runner }) {
  if (runner === "remote") return <Cloud aria-hidden />;
  if (runner === "service") return <Server aria-hidden />;
  return <Monitor aria-hidden />;
}

const RUNNER_KEY: Record<Runner, TKey> = {
  local: "desktop.board.runner.local",
  service: "desktop.board.runner.service",
  remote: "desktop.board.runner.remote",
};

export default function BoardWidget({ config }: WidgetProps) {
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  return (
    <WidgetGate queries={[routines, runs]} lines={3}>
      {routines.data && runs.data && (
        <BoardBody routines={routines.data} runs={runs.data} limit={cfgNumber(config, "limit", 8)} />
      )}
    </WidgetGate>
  );
}

function BoardBody({
  routines,
  runs,
  limit,
}: {
  routines: RoutineStatus[];
  runs: RunRecord[];
  limit: number;
}) {
  const t = useT();
  const locale = useLocale();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const firedToday = runs.filter(
    (r) =>
      r.origin === "routine" &&
      r.createdAt >= todayStart.getTime() &&
      !["queued", "running"].includes(r.status),
  ).length;
  const rows = routines
    .map((r) => {
      const firedTodayAt = r.lastFiredAt && sameLocalDay(r.lastFiredAt, now) ? r.lastFiredAt : null;
      const ts = r.enabled ? (r.nextRunAt ?? firedTodayAt) : firedTodayAt;
      // "Fired" only when it already ran today and its next run is not also today (compare the full local date, not getDate()).
      const fired = !!firedTodayAt && (!r.nextRunAt || !sameLocalDay(r.nextRunAt, now));
      return { r, ts, fired, runner: routineRunner(r) };
    })
    .sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));
  const nextId = rows.find((row) => row.r.enabled && row.r.nextRunAt)?.r.id ?? null;
  const counts = runnerCounts(routines);

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
  const scheduled = routines.filter((r) => r.enabled).length || routines.length;
  return (
    <>
      <div className="board-count">{t("desktop.board.firedToday", { n: firedToday, m: scheduled })}</div>
      {rows.slice(0, limit).map(({ r, ts, fired, runner }) => {
        const isNext = r.id === nextId;
        const status = !r.enabled
          ? t("board.paused")
          : fired
            ? t("board.fired")
            : isNext
              ? t("board.next")
              : t("board.queued");
        const time = ts
          ? new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })
          : "--:--";
        return (
          <div
            className={`board-row${isNext ? " next" : ""}${fired || !r.enabled ? " fired" : ""}`}
            key={r.id}
          >
            <span
              className={`board-runner runner-${runner}`}
              title={t("desktop.board.runnerLabel", { runner: t(RUNNER_KEY[runner]) })}
              aria-label={t(RUNNER_KEY[runner])}
            >
              <RunnerIcon runner={runner} />
            </span>
            <span className={`time${isNext ? " badge-time" : ""}`}>{time}</span>
            <Link to="/routines" className="name truncate plain">
              {r.name}
            </Link>
            <span className="status">{status}</span>
          </div>
        );
      })}
      <div className="board-footer mono">
        {RUNNERS.filter((runner) => counts[runner] > 0).map((runner) => (
          <span key={runner} className={`board-foot runner-${runner}`}>
            <RunnerIcon runner={runner} /> {t(RUNNER_KEY[runner]).toUpperCase()} {counts[runner]}
          </span>
        ))}
        <span className="board-foot dim">
          {new Date(now).toLocaleString(locale, {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </>
  );
}

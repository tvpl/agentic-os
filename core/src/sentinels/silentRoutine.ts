import { intervalMs } from "../routines/schedule.js";
import { cronNextAfter } from "../routines/store.js";
import type { RoutineStatus, SilentRoutine } from "../routines/types.js";
import type { EventBus } from "../events.js";
import { emitSentinel, sentinelDedupeKey, type DedupeLookup, type SentinelFiredPayload } from "./types.js";

/**
 * "This routine went quiet." An enabled routine whose last run is older than
 * `factor` × the interval it promised is either broken or forgotten; either
 * way the human who enabled it wants to know.
 *
 * The expected interval comes from the schedule itself: the declared interval
 * for `every`/`heartbeat`, and the gap between the next two cron slots for
 * `cron`. Kinds with no rhythm (`at`, `on-exit`) are never silent.
 */

export interface SilentRoutineCandidate {
  id: string;
  name: string;
  enabled: boolean;
  /** Last time the routine actually fired, or null when it never did. */
  lastFiredAt: number | null;
  /** Fallback reference when it never fired: a routine cannot be late before it exists. */
  createdAt: number;
  /** The rhythm the routine promised, or null when it has none. */
  expectedIntervalMs: number | null;
}

/**
 * The interval a routine promises, in ms, or null when the kind has no
 * rhythm (one-shot `at`, event-driven `on-exit`, an unparsable cron).
 */
export function expectedIntervalMs(
  routine: Pick<RoutineStatus, "kind" | "every" | "heartbeat" | "schedule" | "timezone">,
  fallbackTz = "UTC",
  now = Date.now(),
): number | null {
  switch (routine.kind) {
    case "every":
      return routine.every ? intervalMs(routine.every) : null;
    case "heartbeat":
      return routine.heartbeat ? routine.heartbeat.intervalMinutes * 60_000 : null;
    case "cron": {
      if (!routine.schedule) return null;
      const tz = routine.timezone || fallbackTz;
      const first = cronNextAfter(routine.schedule, tz, now);
      const second = first === null ? null : cronNextAfter(routine.schedule, tz, first);
      if (first === null || second === null) return null;
      return Math.max(60_000, second - first);
    }
    default:
      return null; // "at" fires once; "on-exit" waits for a run, not for a clock
  }
}

/** Build the candidates from what the scheduler already reports. */
export function candidatesFromStatus(
  statuses: readonly RoutineStatus[],
  fallbackTz = "UTC",
  now = Date.now(),
): SilentRoutineCandidate[] {
  return statuses.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    lastFiredAt: r.lastFiredAt,
    createdAt: r.createdAt,
    expectedIntervalMs: expectedIntervalMs(r, fallbackTz, now),
  }));
}

export interface SilentRoutineOptions {
  /** How many intervals may pass before the routine counts as silent (default 2). */
  factor?: number;
  now?: number;
  /**
   * The scheduler's own verdict (`RoutineScheduler.silent()`, the source
   * behind `GET /api/routines/silent`). Used as context, not as a filter: a
   * routine that runs every hour is overdue long before that 30-day view
   * calls it silent, but when the view does have a reason we quote it.
   */
  silent?: readonly SilentRoutine[];
}

/**
 * Pure rule: which routines are overdue by more than `factor` intervals.
 * Disabled routines and rhythm-less kinds are never reported.
 */
export function silentRoutineAlerts(
  candidates: readonly SilentRoutineCandidate[],
  opts: SilentRoutineOptions = {},
): SentinelFiredPayload[] {
  const now = opts.now ?? Date.now();
  const factor = Math.max(1, opts.factor ?? 2);
  const reasons = new Map((opts.silent ?? []).map((r) => [r.id, r.reason]));
  const out: SentinelFiredPayload[] = [];
  for (const c of candidates) {
    if (!c.enabled) continue;
    if (!c.expectedIntervalMs || c.expectedIntervalMs <= 0) continue;
    const reference = c.lastFiredAt ?? c.createdAt;
    const overdueBy = now - reference;
    if (overdueBy <= c.expectedIntervalMs * factor) continue;
    const hours = Math.round(overdueBy / 3_600_000);
    const reason = reasons.get(c.id);
    out.push({
      sentinel: "silentRoutine",
      title: `Routine "${c.name}" went quiet`,
      body:
        c.lastFiredAt === null
          ? `It has never run, ${hours} h after it was created, and its schedule expects every ${formatMs(c.expectedIntervalMs)}.`
          : `Last run was ${hours} h ago; its schedule expects every ${formatMs(c.expectedIntervalMs)}.${
              reason === "failures" ? " Its recent runs failed." : ""
            }`,
      severity: "warn",
      href: "/routines",
      dedupeKey: sentinelDedupeKey("silentRoutine", c.id, now),
    });
  }
  return out;
}

function formatMs(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export interface SilentRoutineDeps {
  bus: EventBus;
  /** `RoutineScheduler` satisfies this (status + silent). */
  scheduler: { status(): RoutineStatus[]; silent(days?: number): SilentRoutine[] };
  dedupe?: DedupeLookup;
  timezone?: string;
  factor?: number;
  now?: () => number;
}

/** Hourly pass. Returns the payloads it emitted. */
export function checkSilentRoutines(deps: SilentRoutineDeps): SentinelFiredPayload[] {
  const now = deps.now?.() ?? Date.now();
  const statuses = deps.scheduler.status();
  const candidates = candidatesFromStatus(statuses, deps.timezone || "UTC", now);
  let silent: SilentRoutine[] | undefined;
  try {
    silent = deps.scheduler.silent();
  } catch {
    silent = undefined; // the verdict is a filter, not a requirement
  }
  const payloads = silentRoutineAlerts(candidates, { factor: deps.factor, now, silent });
  const fired: SentinelFiredPayload[] = [];
  for (const payload of payloads) {
    if (payload.dedupeKey && deps.dedupe?.hasDedupeKey(payload.dedupeKey)) continue;
    fired.push(emitSentinel(deps.bus, payload));
  }
  return fired;
}

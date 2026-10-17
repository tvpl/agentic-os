/** Routines as they cross the wire: the definition a person writes and what the scheduler reports about it. */
import { z } from "zod";
import { ProviderId, EffortLevel, SecurityProfile } from "./settings.js";

/**
 * Routines v2 (OpenClaw-style model), backwards compatible with v1 files:
 * a v1 file has only `schedule` (cron) and parses as `kind: "cron"`.
 *
 * Schedule kinds
 * - `cron`      5/6-field expression in `timezone` (v1 behaviour).
 * - `at`        one-shot at an ISO datetime; disables itself after firing
 *               with `endedReason: "run_once_fired"`.
 * - `every`     fixed interval (minutes/hours) anchored at `createdAt`.
 * - `on-exit`   fires after a run of a given skill finishes (events bus).
 * - `heartbeat` system-owned periodic check inside `activeHours`; a run whose
 *               summary contains `okToken` is quiet (no alert), anything else
 *               emits `routine.alert` on the bus.
 */

export const ScheduleKind = z.enum(["cron", "at", "every", "on-exit", "heartbeat"]);
export type ScheduleKind = z.infer<typeof ScheduleKind>;

export const RoutineRunner = z.enum(["local", "service", "remote"]);
export type RoutineRunner = z.infer<typeof RoutineRunner>;

export const RoutineContext = z.enum(["isolated", "main"]);
export type RoutineContext = z.infer<typeof RoutineContext>;

export const RoutineDelivery = z.enum(["announce", "webhook", "none"]);
export type RoutineDelivery = z.infer<typeof RoutineDelivery>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const EverySchema = z.object({
  value: z.number().int().min(1).max(10_000),
  unit: z.enum(["minutes", "hours"]).default("minutes"),
});
export type Every = z.infer<typeof EverySchema>;

export const OnExitSchema = z.object({
  /** Skill whose finished runs trigger this routine. */
  skillSlug: z.string().min(1),
  /** Run statuses that count as "finished" for the trigger. */
  statuses: z.array(z.string()).default(["done", "failed", "timed_out"]),
});
export type OnExit = z.infer<typeof OnExitSchema>;

export const ActiveHoursSchema = z.object({
  start: z.string().regex(HHMM, "HH:MM expected"),
  end: z.string().regex(HHMM, "HH:MM expected"),
  /** IANA timezone; empty = the routine's timezone (then settings.timezone). */
  tz: z.string().default(""),
});
export type ActiveHours = z.infer<typeof ActiveHoursSchema>;

export const HeartbeatSchema = z.object({
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(30),
  activeHours: ActiveHoursSchema.nullable().default(null),
  /** Quiet fires (summary contains `okToken`) produce no notification at all. */
  quiet: z.boolean().default(true),
  okToken: z.string().min(1).default("HEARTBEAT_OK"),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const RoutineSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  /** Either a skill from the catalog or a free prompt. */
  skillSlug: z.string().nullable().default(null),
  prompt: z.string().nullable().default(null),
  inputs: z.record(z.string()).default({}),
  /** Schedule kind; v1 files (cron only) omit it. */
  kind: ScheduleKind.default("cron"),
  /** 5-field cron expression, evaluated in `timezone` (kind `cron`). */
  schedule: z.string().default(""),
  /** ISO datetime for kind `at`. */
  at: z.string().nullable().default(null),
  /** Interval for kind `every`. */
  every: EverySchema.nullable().default(null),
  /** Trigger for kind `on-exit`. */
  onExit: OnExitSchema.nullable().default(null),
  /** Settings for kind `heartbeat`. */
  heartbeat: HeartbeatSchema.nullable().default(null),
  /** IANA timezone. Empty string = inherit `settings.timezone` (the scheduler resolves it). */
  timezone: z.string().default(""),
  /** Where the routine runs: this process, the installed OS service, or a remote runner. */
  runner: RoutineRunner.default("local"),
  /** Label of the remote runner (VPS name) when `runner` is `remote`. */
  remoteName: z.string().nullable().default(null),
  /** Execution context: `isolated` = fresh working dir per run; `main` = workspace default. */
  context: RoutineContext.default("main"),
  /** How results are delivered: bus notifications, a webhook POST, or nothing. */
  delivery: RoutineDelivery.default("announce"),
  webhookUrl: z.string().nullable().default(null),
  provider: ProviderId.default("claude"),
  model: z.string().nullable().default(null),
  effort: EffortLevel.default("default"),
  workingDir: z.string().nullable().default(null),
  /** What to do when the machine was off at the scheduled time. */
  missedPolicy: z.enum(["skip", "run_on_boot"]).default("skip"),
  timeoutMs: z
    .number()
    .int()
    .min(10_000)
    .default(15 * 60_000),
  maxAttempts: z.number().int().min(1).max(5).default(1),
  /** Daily spend cap for this routine's runs in USD (0 = none). A fire past the cap is skipped and alerted once a day. */
  budgetUsd: z.number().min(0).default(0),
  backoffMs: z.number().int().min(0).default(60_000),
  /** Timeouts are not retried unless the routine opts in (a hung task rarely improves on retry). */
  retryOnTimeout: z.boolean().default(false),
  /** Where run artifacts should land (defaults to artifacts/<runId>). */
  artifactsSubdir: z.string().nullable().default(null),
  notify: z.boolean().default(true),
  profile: SecurityProfile.default("read_only"),
  enabled: z.boolean().default(false),
  /** Why the routine disabled itself (e.g. `run_once_fired`, `run_once_missed`). */
  endedReason: z.string().nullable().default(null),
  createdAt: z.number().default(() => Date.now()),
});
export type Routine = z.infer<typeof RoutineSchema>;

// ---- the shapes the API answers for a routine --------------------------------------------------------------------

export const RoutineStatusSchema = RoutineSchema.extend({
  nextRunAt: z.number().nullable(),
  lastFiredAt: z.number().nullable(),
  lastStatus: z.string().nullable(),
  recentFailures: z.number(),
  healthy: z.boolean(),
  /** Effective runner: `remote` as declared, else `service` when the OS service is installed, else `local`. */
  runner: RoutineRunner,
  /** Whether this routine already fired today (settings timezone). */
  firedToday: z.boolean(),
});

export const RoutineSummarySchema = z.object({
  firedToday: z.number(),
  totalToday: z.number(),
  byRunner: z.record(z.number()),
  byKind: z.record(z.number()),
});

export const SilentRoutineSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  kind: ScheduleKind,
  lastFiredAt: z.number().nullable(),
  lastStatus: z.string().nullable(),
  failuresInWindow: z.number(),
  reason: z.enum(["never_fired", "no_fire_in_window", "failures"]),
});

export const RoutineHistoryEntrySchema = z.object({
  id: z.number(),
  runId: z.string().nullable(),
  scheduledFor: z.number().nullable(),
  firedAt: z.number(),
  status: z.string(),
  note: z.string().nullable(),
  /** Heartbeat outcome derived from the note: quiet (OK token seen) or alert. */
  outcome: z.enum(["quiet", "alert"]).nullable(),
  /** Final run status / duration when the run exists (joined from `runs`). */
  runStatus: z.string().nullable(),
  durationMs: z.number().nullable(),
});

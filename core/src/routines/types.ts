import { z } from "zod";
import { ProviderId, EffortLevel, SecurityProfile } from "../config/schema.js";

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
  intervalMinutes: z.number().int().min(1).max(24 * 60).default(30),
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
  timeoutMs: z.number().int().min(10_000).default(15 * 60_000),
  maxAttempts: z.number().int().min(1).max(5).default(1),
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

export interface RoutineStatus extends Routine {
  nextRunAt: number | null;
  lastFiredAt: number | null;
  lastStatus: string | null;
  recentFailures: number;
  healthy: boolean;
  /** Effective runner: `remote` as declared, else `service` when the OS service is installed, else `local`. */
  runner: RoutineRunner;
  /** Whether this routine already fired today (settings timezone). */
  firedToday: boolean;
}

export interface RoutineSummary {
  firedToday: number;
  totalToday: number;
  byRunner: Record<string, number>;
  byKind: Record<string, number>;
}

export interface SilentRoutine {
  id: string;
  name: string;
  enabled: boolean;
  kind: ScheduleKind;
  lastFiredAt: number | null;
  lastStatus: string | null;
  failuresInWindow: number;
  reason: "never_fired" | "no_fire_in_window" | "failures";
}

/** Settings subset the validator needs (kept narrow so callers can pass a literal). */
export interface RoutineValidationOptions {
  allowWebhooks?: boolean;
}

/**
 * Semantic validation on top of the zod shape. Throws a plain Error with a
 * user-facing message (the API maps it to 400). `validateCron` is injected
 * so this module stays free of croner.
 */
export function validateRoutine(
  routine: Routine,
  validateCronExpr: (expression: string, timezone: string) => void,
  opts: RoutineValidationOptions = {},
): void {
  if (!routine.skillSlug && !routine.prompt) {
    throw new Error("A routine needs a skill or a prompt.");
  }
  switch (routine.kind) {
    case "cron":
      if (!routine.schedule.trim()) throw new Error("A cron routine needs a schedule expression.");
      validateCronExpr(routine.schedule, routine.timezone);
      break;
    case "at": {
      if (!routine.at) throw new Error('A one-shot routine needs an "at" datetime (ISO 8601).');
      const ms = Date.parse(routine.at);
      if (!Number.isFinite(ms)) throw new Error(`Invalid "at" datetime: ${routine.at}`);
      break;
    }
    case "every":
      if (!routine.every) throw new Error('An interval routine needs "every": { value, unit }.');
      break;
    case "on-exit":
      if (!routine.onExit?.skillSlug) throw new Error('An on-exit routine needs "onExit.skillSlug".');
      if (routine.skillSlug && routine.onExit.skillSlug === routine.skillSlug) {
        throw new Error("An on-exit routine cannot trigger on its own skill (infinite loop).");
      }
      break;
    case "heartbeat":
      if (!routine.heartbeat) throw new Error('A heartbeat routine needs a "heartbeat" block.');
      if (routine.heartbeat.activeHours && routine.heartbeat.activeHours.start === routine.heartbeat.activeHours.end) {
        throw new Error("Heartbeat active hours must span at least one minute.");
      }
      break;
  }
  if (routine.runner === "remote" && !routine.remoteName) {
    throw new Error('A remote routine needs "remoteName" (the runner label, e.g. the VPS name).');
  }
  if (routine.delivery === "webhook") {
    if (!opts.allowWebhooks) {
      throw new Error('Webhook delivery is disabled: enable "routines.allowWebhooks" in Settings first.');
    }
    if (!routine.webhookUrl) throw new Error('Webhook delivery needs "webhookUrl".');
    let url: URL;
    try {
      url = new URL(routine.webhookUrl);
    } catch {
      throw new Error(`Invalid webhookUrl: ${routine.webhookUrl}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("webhookUrl must be http(s).");
    }
  }
}

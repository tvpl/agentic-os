/**
 * The routine definition lives in `@mordomo/contracts` (the API describes it in its route table and the interface
 * edits it); the core re-exports it so every existing importer keeps working. What stays here is what the engine
 * adds: the status the scheduler reports and the semantic validation.
 */
import type { Routine, RoutineRunner, ScheduleKind } from "@mordomo/contracts";

export {
  ActiveHoursSchema,
  EverySchema,
  HeartbeatSchema,
  OnExitSchema,
  RoutineContext,
  RoutineDelivery,
  RoutineRunner,
  RoutineSchema,
  ScheduleKind,
  type ActiveHours,
  type Every,
  type Heartbeat,
  type OnExit,
  type Routine,
} from "@mordomo/contracts";


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

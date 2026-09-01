import { z } from "zod";
import { ProviderId, EffortLevel, SecurityProfile } from "../config/schema.js";

export const RoutineSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  /** Either a skill from the catalog or a free prompt. */
  skillSlug: z.string().nullable().default(null),
  prompt: z.string().nullable().default(null),
  inputs: z.record(z.string()).default({}),
  /** 5-field cron expression, evaluated in `timezone`. */
  schedule: z.string(),
  timezone: z.string().default("UTC"),
  provider: ProviderId.default("claude"),
  model: z.string().nullable().default(null),
  effort: EffortLevel.default("default"),
  workingDir: z.string().nullable().default(null),
  /** What to do when the machine was off at the scheduled time. */
  missedPolicy: z.enum(["skip", "run_on_boot"]).default("skip"),
  timeoutMs: z.number().int().min(10_000).default(15 * 60_000),
  maxAttempts: z.number().int().min(1).max(5).default(1),
  backoffMs: z.number().int().min(0).default(60_000),
  /** Where run artifacts should land (defaults to artifacts/<runId>). */
  artifactsSubdir: z.string().nullable().default(null),
  notify: z.boolean().default(true),
  profile: SecurityProfile.default("read_only"),
  enabled: z.boolean().default(false),
  createdAt: z.number().default(() => Date.now()),
});
export type Routine = z.infer<typeof RoutineSchema>;

export interface RoutineStatus extends Routine {
  nextRunAt: number | null;
  lastFiredAt: number | null;
  lastStatus: string | null;
  recentFailures: number;
  healthy: boolean;
}

import { z } from "zod";
import { EffortLevel, ProviderId } from "../config/schema.js";

/** The bounds the engine holds every run request to; the HTTP routes use the same numbers. */
export const RUN_LIMITS = {
  promptMaxChars: 20_000,
  timeoutMinMs: 10_000,
  timeoutMaxMs: 3_600_000,
} as const;

/**
 * Names that stand for "the program itself" in what the engine writes down: a receipt keeps `null` as `null` in one
 * place and as `program` in another, so a person called either would be taken for the program. Not names of anyone.
 */
const RESERVED_ASKERS: ReadonlySet<string> = new Set(["null", "program"]);

/** `null` is the program itself (the CLI, an embedder, a routine); the field cannot be left out. */
const StartedBy = z
  .string()
  .min(1)
  .max(200)
  .refine((name) => !RESERVED_ASKERS.has(name), {
    message: 'startedBy "null" and "program" are reserved for the program itself: pass null',
  })
  .nullable();

const Timeout = z.number().int().min(RUN_LIMITS.timeoutMinMs).max(RUN_LIMITS.timeoutMaxMs);

export const StartPromptSchema = z
  .object({
    prompt: z.string().min(1).max(RUN_LIMITS.promptMaxChars),
    startedBy: StartedBy,
    provider: ProviderId.optional(),
    model: z.string().nullable().optional(),
    effort: EffortLevel.optional(),
    mode: z.enum(["read_only", "write"]).default("read_only"),
    cwd: z.string().optional(),
    timeoutMs: Timeout.optional(),
    sessionId: z.string().uuid().optional(),
    parentRunId: z.string().uuid().optional(),
    submissionId: z.string().uuid().optional(),
  })
  .strict();

export const StartSkillSchema = z
  .object({
    // Not held to the id pattern here: the catalog answers an unknown or malformed slug with 404, as it always did.
    slug: z.string().min(1).max(200),
    startedBy: StartedBy,
    inputs: z.record(z.string()).default({}),
    provider: ProviderId.optional(),
    model: z.string().nullable().optional(),
    effort: EffortLevel.optional(),
    cwd: z.string().optional(),
    timeoutMs: Timeout.optional(),
  })
  .strict();

export const RetrySchema = z
  .object({
    submissionId: z.string().uuid(),
    startedBy: StartedBy,
  })
  .strict();

/** What `Execution.startPrompt` needs: the prompt and who asks, plus optional provider, mode, folder and limits. */
export type StartPromptInput = z.input<typeof StartPromptSchema>;
/** What `Execution.startSkill` needs: the skill and who asks, plus optional inputs, provider and limits. */
export type StartSkillInput = z.input<typeof StartSkillSchema>;
/** What `Execution.retry` needs: the idempotency key and who asks. */
export type RetryInput = z.input<typeof RetrySchema>;

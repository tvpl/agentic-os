import { z } from "zod";

/**
 * What the service and the index worker say to each other (.specs/features/cerebro-v2, door 6). One schema for each
 * direction, parsed on receipt by both sides: a message that does not fit is not acted on (the worker refuses to
 * start; the host fails the pass), never guessed at.
 *
 * `cancel` is not a message: the worker would never hear one while it works, so the flag is a shared `Int32Array` the
 * host sets to 1 and the worker reads between two chunks.
 */

const IndexPhaseSchema = z.enum(["scan", "index", "prune", "related", "vectors"]);

const IndexProgressSchema = z.object({
  runId: z.string().optional(),
  phase: IndexPhaseSchema.optional(),
  scanned: z.number(),
  total: z.number().optional(),
  added: z.number(),
  updated: z.number(),
  removed: z.number(),
});

const IndexStatsSchema = z.object({
  scanned: z.number(),
  added: z.number(),
  updated: z.number(),
  removed: z.number(),
  skippedExcluded: z.number(),
  skippedBinary: z.number(),
  related: z.number(),
  durationMs: z.number(),
  embedded: z.number().optional(),
});

/** Service to worker: do this pass. `settings` is a copy taken when the pass started. */
export const StartMessage = z.object({
  t: z.literal("start"),
  runId: z.string(),
  dbFile: z.string(),
  homeDir: z.string(),
  platform: z.string().optional(),
  /** The settings the pass runs under (`Settings`; structured-clone safe). */
  settings: z.custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null),
  implicitRoots: z.array(z.object({ path: z.string(), area: z.string().nullable(), enabled: z.boolean() })),
  only: z.array(z.string()).optional(),
  /** `Int32Array` over this: 1 = stop at the next chunk. */
  cancel: z.custom<SharedArrayBuffer>((value) => value instanceof SharedArrayBuffer),
  /** Milliseconds the worker sleeps between two chunks, so it does not take a whole core. */
  paceMs: z.number().int().min(0),
});
export type StartMessage = z.infer<typeof StartMessage>;

export const ProgressMessage = z.object({ t: z.literal("progress"), progress: IndexProgressSchema });
export const DoneMessage = z.object({ t: z.literal("done"), stats: IndexStatsSchema });
/** `code: "index_cancelled"` is how a stop at the flag is reported; any other code is a failure. */
export const FailedMessage = z.object({
  t: z.literal("failed"),
  code: z.string(),
  message: z.string(),
  previousIndexPreserved: z.boolean(),
});

/** Worker to service. */
export const WorkerMessage = z.discriminatedUnion("t", [ProgressMessage, DoneMessage, FailedMessage]);
export type WorkerMessage = z.infer<typeof WorkerMessage>;

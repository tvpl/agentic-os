/**
 * The schemas of the events: one payload schema per `(type, version)` in `EVENT_SCHEMAS`, the envelope that carries
 * them, and the frames of a run's stream. The registry of types and versions (zod-free) is `eventRegistry.ts`.
 *
 * A schema is tolerant of a key it does not name, as a reader must be (docs/events.md); the test suite and the
 * development server close it with `checkBody` to catch an emitter that sends a key the contract does not know.
 */
import { z } from "zod";
import { SettingsSchema, ProviderId } from "./settings.js";
import {
  ApprovalKindSchema,
  ApprovalSchema,
  BackupInfoSchema,
  NotificationRecordSchema,
  RunEventSchema,
  RunOriginSchema,
  RunStatusSchema,
} from "./api/wire.js";
import {
  EVENT_VERSIONS,
  OS_EVENT_TYPES,
  RUN_FRAME_VERSIONS,
  classifyEvent,
  classifyRunFrame,
  type OsEventTypeName,
  type RunFrameType,
} from "./eventRegistry.js";

const IndexStatsSchema = z.object({
  scanned: z.number(),
  added: z.number(),
  updated: z.number(),
  removed: z.number(),
  skippedExcluded: z.number(),
  skippedBinary: z.number(),
  related: z.number(),
  durationMs: z.number(),
  /** Vectors (re)computed by the pass; present only while the semantic search is on. */
  embedded: z.number().optional(),
});

const SentinelFiredSchema = z.object({
  sentinel: z.enum(["fsWatch", "repeatedFailure", "silentRoutine", "connectorDelta", "reviewDue"]),
  messageParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  title: z.string(),
  body: z.string(),
  severity: z.enum(["info", "warn", "danger"]),
  /** Where the Command Centre should send the reader. */
  href: z.string().optional(),
  /** Rows sharing this key collapse. */
  dedupeKey: z.string().optional(),
  /** Ask the triage run to decide what this means (costs money). */
  triage: z.boolean().optional(),
});

/** Version 1 of the payload of each event type; the keys are exactly `OS_EVENT_TYPES`. */
const PAYLOADS_V1 = {
  "run.created": z.object({
    runId: z.string(),
    origin: RunOriginSchema,
    provider: ProviderId,
    sessionId: z.string().optional(),
  }),
  "run.started": z.object({ runId: z.string(), pid: z.number().nullable() }),
  "run.event": z.object({ runId: z.string(), event: RunEventSchema }),
  "run.finished": z.object({ runId: z.string(), status: RunStatusSchema, durationMs: z.number().nullable() }),
  "routine.fired": z.object({ routineId: z.string(), runId: z.string() }),
  "routine.alert": z.union([
    z.object({
      routineId: z.string(),
      runId: z.null(),
      summary: z.string(),
      reason: z.literal("budget"),
      spentUsd: z.number(),
      budgetUsd: z.number(),
    }),
    z.object({ routineId: z.string(), runId: z.string(), status: RunStatusSchema, summary: z.string() }),
  ]),
  "routine.changed": z.object({
    id: z.string(),
    action: z.string(),
    reason: z.string().nullable().optional(),
  }),
  "index.started": z.object({ runId: z.string(), mode: z.enum(["worker", "inline"]) }),
  "index.progress": z.object({
    runId: z.string().optional(),
    phase: z.enum(["scan", "index", "prune", "related", "vectors"]).optional(),
    scanned: z.number(),
    total: z.number().optional(),
    added: z.number(),
    updated: z.number(),
    removed: z.number(),
  }),
  "index.finished": z.object({ stats: IndexStatsSchema, runId: z.string().optional() }),
  "index.failed": z.object({
    code: z.string(),
    previousIndexPreserved: z.boolean(),
    runId: z.string().optional(),
  }),
  "index.cancelled": z.object({ runId: z.string() }),
  "cleanup.progress": z.object({
    scanId: z.string(),
    phase: z.enum(["inventory", "signatures", "links", "findings"]),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  "cleanup.finished": z.object({ scanId: z.string(), findings: z.number().int().min(0) }),
  "cleanup.failed": z.object({ scanId: z.string(), code: z.string().min(1) }),
  "approval.requested": z.object({
    id: z.string(),
    kind: ApprovalKindSchema,
    description: z.string(),
    runId: z.string().nullable().optional(),
  }),
  "approval.resolved": z.object({
    id: z.string(),
    kind: ApprovalKindSchema,
    status: ApprovalSchema.shape.status,
    runId: z.string().nullable(),
  }),
  "approval.expired": z.object({ count: z.number() }),
  "session.created": z.object({ sessionId: z.string(), provider: ProviderId, title: z.string() }),
  "session.updated": z.union([
    z.object({ sessionId: z.string(), deleted: z.literal(true), runsKept: z.number() }),
    z.object({ sessionId: z.string(), providerSessionId: z.string() }),
    z.object({
      sessionId: z.string(),
      lastRunId: z.string().nullable(),
      turns: z.number(),
      costUsd: z.number(),
    }),
    z.object({ sessionId: z.string(), title: z.string() }),
  ]),
  "objective.changed": z.union([
    z.object({ objectiveId: z.string(), deleted: z.literal(true) }),
    z.object({ objectiveId: z.string().optional(), stepId: z.string(), status: z.string().optional() }),
    z.object({ objectiveId: z.string().optional(), status: z.string().optional() }),
  ]),
  "settings.changed": z.object({ settings: SettingsSchema }),
  "backup.created": BackupInfoSchema,
  "notification.created": NotificationRecordSchema,
  "notification.read": z.union([z.object({ ids: z.array(z.string()) }), z.object({ all: z.literal(true) })]),
  "budget.crossed": z.object({
    level: z.union([z.literal(80), z.literal(100)]),
    day: z.string(),
    spentUsd: z.number(),
    budgetUsd: z.number(),
  }),
  "sentinel.fired": SentinelFiredSchema,
  "stream.reset": z.object({ lastId: z.number() }),
} as const satisfies { readonly [K in OsEventTypeName]: z.ZodTypeAny };

/**
 * The payload schema of each version of each type. A version never leaves this table while a release that emits or
 * stores it can still be read by a client; an incompatible change adds `2: …` next to `1: …`.
 */
export const EVENT_SCHEMAS = Object.fromEntries(
  OS_EVENT_TYPES.map((type) => [type, { 1: PAYLOADS_V1[type] }]),
) as unknown as { readonly [K in OsEventTypeName]: { readonly [version: number]: z.ZodTypeAny } };

const envelope = (type: string, v: number, payload: z.ZodTypeAny) =>
  z.object({ id: z.number(), type: z.literal(type), ts: z.number(), v: z.literal(v), payload });

/** One envelope per `(type, version)`. */
export const EVENT_ENVELOPES: ReadonlyArray<{ type: OsEventTypeName; v: number; schema: z.ZodTypeAny }> =
  OS_EVENT_TYPES.flatMap((type) =>
    EVENT_VERSIONS[type].map((v) => ({ type, v, schema: envelope(type, v, EVENT_SCHEMAS[type][v]!) })),
  );

/** Any event of the bus at any version it has had: the union is discriminated by `type` and `v`. */
export const OsEventSchema = z.union(
  EVENT_ENVELOPES.map((e) => e.schema) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
);

export type ReadEvent =
  | { readonly ok: true; readonly type: OsEventTypeName; readonly v: number; readonly event: unknown }
  | {
      readonly ok: false;
      readonly reason: "unknown_type" | "unsupported_version" | "invalid";
      readonly issues?: string[];
    };

/**
 * Read an event the way a client must: drop what it does not know (`unknown_type`, `unsupported_version`), check what
 * it does against the schema of its exact type and version (`invalid`), accept a key the schema does not name.
 */
export function readOsEvent(raw: unknown): ReadEvent {
  const kind = classifyEvent(raw);
  if (kind.kind !== "known") return { ok: false, reason: kind.kind };
  const entry = EVENT_ENVELOPES.find((e) => e.type === kind.type && e.v === kind.v)!;
  const parsed = entry.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, type: entry.type, v: entry.v, event: parsed.data };
}

// ---- the frames of a run's stream -----------------------------------------------------------------------------------

const RunStateFrame = z.object({
  type: z.literal("run_state"),
  ts: z.number(),
  /** The run's status when the stream ended; absent when the run row is gone. */
  status: RunStatusSchema.optional(),
  error: z.string().nullable().optional(),
});

/** Version 1 of each frame: the events of a run, and the final `run_state`; each carries `v`. */
const RUN_FRAMES_V1 = [
  ...RunEventSchema.options.map((option) => option.extend({ v: z.literal(1) })),
  RunStateFrame.extend({ v: z.literal(1) }),
] as unknown as [z.AnyZodObject, ...z.AnyZodObject[]];

export const RunFrameSchema = z.discriminatedUnion("type", RUN_FRAMES_V1);

/** The schema of each frame type at each version, in the order of `RUN_FRAME_TYPES`. */
export const RUN_FRAME_SCHEMAS = Object.fromEntries(
  RUN_FRAMES_V1.map((schema) => [(schema.shape.type as z.ZodLiteral<string>).value, { 1: schema }]),
) as unknown as { readonly [K in RunFrameType]: { readonly [version: number]: z.ZodTypeAny } };

export { RUN_FRAME_VERSIONS, classifyRunFrame };

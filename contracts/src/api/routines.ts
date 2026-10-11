/** Routines (scheduled work), connectors (read-only data sources), objectives (multi-step plans) and sentinels. */
import { z } from "zod";
import { ConnectorDataSchema, AuditReportSchema, ConnectorSchema } from "../connectors.js";
import {
  RoutineHistoryEntrySchema,
  RoutineSchema,
  RoutineStatusSchema,
  RoutineSummarySchema,
  SilentRoutineSchema,
} from "../routines.js";
import { EffortLevel, ProviderId } from "../settings.js";
import {
  DeletedSchema,
  IdParams,
  RunPrompt,
  RunTimeout,
  UuidParam,
  UuidParams,
  err,
  notFound,
} from "./common.js";
import { route } from "./route.js";
import { ApprovalSchema, RunRequestSpecSchema } from "./wire.js";

// ---- routines ---------------------------------------------------------------------------------------------------

const routineNotFound = notFound("The routine");

const routineWriteErrors = [
  err(400, "unknown_provider", "No adapter is registered for the provider"),
  err(
    400,
    "bad_request",
    "The routine is not valid: an unknown skill, a missing schedule or prompt, an invalid cron expression or webhook",
  ),
];

// ---- objectives -------------------------------------------------------------------------------------------------

const ObjectiveStepStatus = z.enum([
  "pending",
  "dispatched",
  "waiting_approval",
  "verifying",
  "verified",
  "blocked",
  "cancelled",
]);

const ObjectiveContextSchema = z.object({
  sources: z
    .array(z.object({ label: z.string(), path: z.string().optional(), version: z.string().optional() }))
    .optional(),
  decisions: z.array(z.string()).optional(),
  budgetUsd: z.number().nullable().optional(),
  retention: z.string().optional(),
});

const StepEvidenceSchema = z.object({
  verified: z.boolean(),
  checkedAt: z.number(),
  runId: z.string(),
  processStatus: z.string(),
  artifacts: z.array(z.object({ path: z.string(), bytes: z.number(), sha256: z.string() })),
  filesChanged: z.array(z.string()),
  missingExpected: z.array(z.string()),
  replyPresent: z.boolean(),
});

const ObjectiveStepSchema = z.object({
  id: z.string(),
  objectiveId: z.string(),
  position: z.number(),
  title: z.string(),
  request: RunRequestSpecSchema,
  dependencies: z.array(z.string()),
  resourceKeys: z.array(z.string()),
  expectedArtifacts: z.array(z.string()),
  priority: z.number(),
  status: ObjectiveStepStatus,
  runId: z.string().nullable(),
  attempt: z.number(),
  effectsUncertain: z.boolean(),
  blockedReason: z.string().nullable(),
  nextAction: z.string().nullable(),
  evidence: StepEvidenceSchema.nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const ObjectiveSchema = z.object({
  id: z.string(),
  project: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["active", "blocked", "completed", "cancelled"]),
  context: ObjectiveContextSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  steps: z.array(ObjectiveStepSchema),
});

const RunRequestInputSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1),
    kind: z.literal("prompt"),
    prompt: RunPrompt,
    mode: z.enum(["read_only", "write"]),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("system"),
    prompt: RunPrompt,
    mode: z.enum(["read_only", "write"]),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("skill"),
    skillSlug: z.string().min(1),
    inputs: z.record(z.string(), z.string()),
    mode: z.enum(["read_only", "write"]),
  }),
]);

const CreateObjectiveBody = z.object({
  project: z.string().max(200).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).default(""),
  context: z
    .object({
      sources: z
        .array(z.object({ label: z.string(), path: z.string().optional(), version: z.string().optional() }))
        .max(100)
        .optional(),
      decisions: z.array(z.string().max(2_000)).max(100).optional(),
      budgetUsd: z.number().min(0).nullable().optional(),
      retention: z.string().max(500).optional(),
    })
    .default({}),
  steps: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        request: RunRequestInputSchema,
        dependencies: z.array(z.string().uuid()).max(100).default([]),
        resourceKeys: z.array(z.string().min(1).max(500)).max(100).default([]),
        expectedArtifacts: z.array(z.string().min(1).max(500)).max(100).default([]),
        priority: z.number().int().min(-100).max(100).default(0),
      }),
    )
    .min(1)
    .max(100),
});

const DispatchBody = z.object({
  limit: z.number().int().min(1).max(8).default(2),
  provider: ProviderId.optional(),
  model: z.string().nullable().optional(),
  effort: EffortLevel.optional(),
  cwd: z.string().optional(),
  timeoutMs: RunTimeout.optional(),
});

const objectiveNotFound = notFound("The objective");

// ---- sentinels --------------------------------------------------------------------------------------------------

const SentinelStatusSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  /** The configuration of this sentinel; its keys differ by sentinel. */
  config: z.record(z.unknown()),
  lastFiredAt: z.number().nullable(),
  lastTitle: z.string().nullable(),
  /** Folders the fs sentinel watches; empty for the others. */
  watched: z.array(z.string()),
});

export const routineRoutes = {
  "routines.list": route({
    method: "GET",
    path: "/api/routines",
    summary: "Every routine with its next run and health",
    tag: "routines",
    scope: "monitor",
    responses: { 200: z.array(RoutineStatusSchema) },
  }),
  "routines.summary": route({
    method: "GET",
    path: "/api/routines/summary",
    summary: "How many routines fired today, and the count per runner and kind",
    tag: "routines",
    scope: "monitor",
    responses: { 200: RoutineSummarySchema },
  }),
  "routines.silent": route({
    method: "GET",
    path: "/api/routines/silent",
    summary: "Routines that never fired, went quiet or keep failing inside the window",
    tag: "routines",
    scope: "monitor",
    query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
    responses: { 200: z.object({ days: z.number(), routines: z.array(SilentRoutineSchema) }) },
  }),
  "routines.create": route({
    method: "POST",
    path: "/api/routines",
    summary: "Create a routine",
    tag: "routines",
    scope: "owner",
    body: RoutineSchema,
    responses: { 200: RoutineSchema },
    errors: [...routineWriteErrors, err(409, "conflict", "A routine with this id already exists")],
  }),
  "routines.update": route({
    method: "PUT",
    path: "/api/routines/:id",
    summary: "Replace a routine (the id is the one in the URL)",
    tag: "routines",
    scope: "owner",
    params: IdParams,
    body: RoutineSchema.partial({ id: true }),
    responses: { 200: RoutineSchema },
    errors: [routineNotFound, ...routineWriteErrors],
  }),
  "routines.toggle": route({
    method: "POST",
    path: "/api/routines/:id/toggle",
    summary: "Enable or disable a routine",
    tag: "routines",
    scope: "owner",
    params: IdParams,
    responses: { 200: RoutineSchema },
    errors: [routineNotFound, err(400, "bad_request", "The routine cannot be enabled as it is")],
  }),
  "routines.duplicate": route({
    method: "POST",
    path: "/api/routines/:id/duplicate",
    summary: "Copy a routine under a new id, disabled",
    tag: "routines",
    scope: "owner",
    params: IdParams,
    responses: { 200: RoutineSchema },
    errors: [routineNotFound],
  }),
  "routines.delete": route({
    method: "DELETE",
    path: "/api/routines/:id",
    summary: "Delete a routine",
    tag: "routines",
    scope: "owner",
    params: IdParams,
    responses: { 200: DeletedSchema },
    errors: [routineNotFound],
  }),
  "routines.run": route({
    method: "POST",
    path: "/api/routines/:id/run",
    summary: "Fire a routine now; execution continues in the background",
    tag: "routines",
    scope: "owner",
    params: IdParams,
    responses: { 200: z.object({ runId: z.string().nullable(), status: z.string() }) },
    errors: [
      routineNotFound,
      err(400, "unknown_provider", "No adapter is registered for the routine's provider"),
      err(400, "bad_request", "The routine's skill is not in the catalog"),
      err(409, "conflict", "The routine is already running"),
      err(409, "budget_exhausted", "The routine's daily budget is exhausted"),
    ],
  }),
  "routines.history": route({
    method: "GET",
    path: "/api/routines/:id/history",
    summary: "The last 30 times a routine fired",
    tag: "routines",
    scope: "monitor",
    params: IdParams,
    responses: { 200: z.array(RoutineHistoryEntrySchema) },
  }),

  // ---- connectors
  "connectors.list": route({
    method: "GET",
    path: "/api/connectors",
    summary: "Every connector definition",
    tag: "connectors",
    scope: "content",
    responses: { 200: z.array(ConnectorSchema) },
  }),
  "connectors.audit": route({
    method: "GET",
    path: "/api/connectors/audit",
    summary: "MCP servers found in the providers' config files, and the connectors worth setting up next",
    tag: "connectors",
    scope: "owner",
    responses: { 200: AuditReportSchema },
  }),
  "connectors.data": route({
    method: "GET",
    path: "/api/connectors/:id/data",
    summary: "Read-only data of a connector (cached; refresh=1 bypasses the cache)",
    tag: "connectors",
    scope: "content",
    params: IdParams,
    query: z.object({ refresh: z.string().optional() }),
    responses: { 200: ConnectorDataSchema },
    errors: [notFound("The connector")],
  }),
  "connectors.setup": route({
    method: "GET",
    path: "/api/connectors/:id/setup",
    summary: "The setup checklist of a connector (names only, never a secret value)",
    tag: "connectors",
    scope: "owner",
    params: IdParams,
    responses: { 200: z.object({ id: z.string(), steps: z.array(z.string()) }) },
    errors: [notFound("The connector")],
  }),
  "connectors.update": route({
    method: "PUT",
    path: "/api/connectors/:id",
    summary: "Replace a connector; enabling write operations parks an approval and keeps writes off",
    tag: "connectors",
    scope: "owner",
    params: IdParams,
    body: ConnectorSchema.partial({ id: true }),
    responses: { 200: z.object({ connector: ConnectorSchema, pendingApproval: ApprovalSchema.nullable() }) },
    errors: [notFound("The connector")],
  }),
  "connectors.create": route({
    method: "POST",
    path: "/api/connectors",
    summary: "Add a connector (it starts not configured, with writes off)",
    tag: "connectors",
    scope: "owner",
    body: ConnectorSchema,
    responses: { 200: ConnectorSchema },
    errors: [err(409, "conflict", "A connector with this id already exists")],
  }),
  "connectors.delete": route({
    method: "DELETE",
    path: "/api/connectors/:id",
    summary: "Remove a connector",
    tag: "connectors",
    scope: "owner",
    params: IdParams,
    responses: { 200: DeletedSchema },
    errors: [notFound("The connector")],
  }),

  // ---- objectives
  "objectives.list": route({
    method: "GET",
    path: "/api/objectives",
    summary: "Every objective with its steps",
    tag: "objectives",
    scope: "monitor",
    responses: { 200: z.array(ObjectiveSchema) },
  }),
  "objectives.get": route({
    method: "GET",
    path: "/api/objectives/:id",
    summary: "One objective with its steps",
    tag: "objectives",
    scope: "monitor",
    params: UuidParams,
    responses: { 200: ObjectiveSchema },
    errors: [objectiveNotFound],
  }),
  "objectives.delete": route({
    method: "DELETE",
    path: "/api/objectives/:id",
    summary: "Delete an objective",
    tag: "objectives",
    scope: "owner",
    params: UuidParams,
    responses: { 200: DeletedSchema },
    errors: [objectiveNotFound],
  }),
  "objectives.create": route({
    method: "POST",
    path: "/api/objectives",
    summary: "Create an objective from steps that depend on each other",
    tag: "objectives",
    scope: "owner",
    body: CreateObjectiveBody,
    responses: { 200: ObjectiveSchema },
    errors: [
      err(
        400,
        "invalid_objective",
        "The steps are not a valid plan (a dependency that does not exist, or a cycle)",
      ),
    ],
  }),
  "objectives.dispatch": route({
    method: "POST",
    path: "/api/objectives/:id/dispatch",
    summary: "Start the steps whose dependencies are done",
    tag: "objectives",
    scope: "owner",
    params: UuidParams,
    body: DispatchBody,
    bodyOptional: true,
    responses: {
      200: z.object({
        objectiveId: z.string(),
        dispatched: z.array(
          z.object({ stepId: z.string(), runId: z.string().nullable(), status: z.string() }),
        ),
      }),
    },
    errors: [
      objectiveNotFound,
      err(400, "unknown_provider", "No adapter is registered for the provider"),
      err(400, "bad_request", "The provider is not enabled"),
      err(403, "profile_refused", "The security profile does not allow a write run"),
      err(409, "skill_unavailable", "The skill of a step is no longer available"),
      err(409, "budget_exhausted", "The skill's daily budget is exhausted"),
      err(409, "workspace_unavailable", "The working folder cannot be used"),
      err(429, "too_many_requests", "The queue of runs is full"),
      err(500, "internal", "The dispatch did not create a run"),
    ],
  }),
  "objectives.retryStep": route({
    method: "POST",
    path: "/api/objectives/:id/steps/:stepId/retry",
    summary: "Retry a blocked step, saying whether its effects were reconciled by hand",
    tag: "objectives",
    scope: "owner",
    params: z.object({ id: UuidParam, stepId: UuidParam }),
    body: z.object({ effectsReconciled: z.boolean().default(false) }),
    bodyOptional: true,
    responses: { 200: ObjectiveStepSchema },
    errors: [
      notFound("The objective step"),
      err(409, "step_not_retryable", "The step cannot be retried as it is"),
    ],
  }),

  // ---- sentinels
  "sentinels.list": route({
    method: "GET",
    path: "/api/sentinels",
    summary: "What the system is watching: each sentinel, whether it is on, and the last time it spoke",
    tag: "sentinels",
    scope: "monitor",
    responses: { 200: z.object({ running: z.boolean(), sentinels: z.array(SentinelStatusSchema) }) },
  }),
} as const;

/**
 * The entities of the wire as zod schemas, one per type `runs.ts`, `records.ts` and `devices.ts` declare. The types
 * stay the ones the engine uses; `typetests/rest.ts` proves each schema infers a type mutually assignable to its
 * interface, so neither can drift from the other.
 */
import { z } from "zod";
import { DEVICE_SCOPES } from "../devices.js";
import { EffortLevel, ProviderId, SecurityProfile } from "../settings.js";

export const RunModeSchema = z.enum(["read_only", "write"]);
export const RunOriginSchema = z.enum(["manual", "skill", "routine", "api", "sentinel"]);
export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "done",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);

export const RunRequestSpecSchema = z.discriminatedUnion("kind", [
  z.object({ version: z.literal(1), kind: z.literal("prompt"), prompt: z.string(), mode: RunModeSchema }),
  z.object({
    version: z.literal(1),
    kind: z.literal("skill"),
    skillSlug: z.string(),
    inputs: z.record(z.string()),
    mode: RunModeSchema,
  }),
  z.object({ version: z.literal(1), kind: z.literal("system"), prompt: z.string(), mode: RunModeSchema }),
]);

export const RunUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  costUsd: z.number().nullable().optional(),
  model: z.string().optional(),
});

export const RunFailureSchema = z.object({
  code: z.enum([
    "authentication",
    "permission",
    "budget",
    "timeout",
    "cancelled",
    "interrupted",
    "provider",
    "unknown",
    "folder_not_indexed",
    "folder_protection_unsupported",
  ]),
  message: z.string(),
  recoverable: z.boolean(),
  effectsUncertain: z.boolean(),
});

export const RunRecordSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  origin: RunOriginSchema,
  provider: ProviderId,
  model: z.string().nullable(),
  effort: EffortLevel,
  status: RunStatusSchema,
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  cwd: z.string().nullable(),
  promptSummary: z.string(),
  request: RunRequestSpecSchema.nullable(),
  skillSlug: z.string().nullable(),
  routineId: z.string().nullable(),
  maxCostUsd: z.number().nullable(),
  parentRunId: z.string().nullable(),
  sessionId: z.string().nullable(),
  pid: z.number().nullable(),
  error: z.string().nullable(),
  failure: RunFailureSchema.nullable(),
  artifacts: z.array(z.string()),
  filesChanged: z.array(z.string()),
  attempts: z.number(),
  timeoutMs: z.number().nullable(),
  permissionProfile: SecurityProfile.nullable(),
  startedBy: z.string().nullable(),
  usage: RunUsageSchema.nullable(),
  contextId: z.string().nullable(),
});

/** A row of `GET /api/runs`: the run without its complete request (needed only on the detail and retry path). */
export const RunSummarySchema = RunRecordSchema.omit({ request: true });

const attempt = { attemptId: z.string().optional(), sequence: z.number().optional() };

/** Version 1 of the events of a run, as the stream and `run.event` carry them (`type` discriminates). */
export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), ts: z.number(), pid: z.number().nullable(), ...attempt }),
  z.object({
    type: z.literal("text"),
    ts: z.number(),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
    ...attempt,
  }),
  z.object({ type: z.literal("assistant"), ts: z.number(), text: z.string(), ...attempt }),
  z.object({
    type: z.literal("tool_use"),
    ts: z.number(),
    tool: z.string(),
    detail: z.string(),
    paths: z.array(z.string()).optional(),
    callId: z.string().optional(),
    phase: z.enum(["start", "end"]).optional(),
    durationMs: z.number().optional(),
    outcome: z.enum(["ok", "error", "denied"]).optional(),
    ...attempt,
  }),
  z.object({ type: z.literal("permission"), ts: z.number(), detail: z.string(), ...attempt }),
  z.object({ type: z.literal("session"), ts: z.number(), providerSessionId: z.string(), ...attempt }),
  z.object({
    type: z.literal("result"),
    ts: z.number(),
    exitCode: z.number().nullable(),
    summary: z.string(),
    durationMs: z.number(),
    timedOut: z.boolean(),
    cancelled: z.boolean().optional(),
    ...attempt,
  }),
  z.object({ type: z.literal("error"), ts: z.number(), message: z.string(), ...attempt }),
  z.object({
    type: z.literal("usage"),
    ts: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    costUsd: z.number().nullable().optional(),
    model: z.string().optional(),
    scope: z.enum(["turn", "total"]).optional(),
    ...attempt,
  }),
]);

export const ApprovalKindSchema = z.enum([
  "write_run",
  "tool_use",
  "install_software",
  "change_global_config",
  "destructive_command",
  "access_new_folder",
  "connector_write",
  "create_startup_service",
  "expose_port",
  "send_external_data",
  "overwrite_existing_config",
]);

export const ApprovalSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  kind: ApprovalKindSchema,
  description: z.string(),
  /** What the approval is about (a run request, a tool call, a folder): its keys depend on `kind`. */
  payload: z.record(z.unknown()),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  resolvedAt: z.number().nullable(),
  resolvedBy: z.string().nullable(),
  requestedBy: z.string().nullable(),
  expiresAt: z.number(),
});

export const NotificationRecordSchema = z.object({
  id: z.string(),
  kind: z.enum(["approval", "run", "routine", "index", "system", "reminder"]),
  tone: z.enum(["ok", "warn", "danger", "info"]).nullable(),
  messageKey: z.string().nullable().optional(),
  messageParams: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
  title: z.string(),
  body: z.string().nullable(),
  href: z.string().nullable(),
  approvalId: z.string().nullable(),
  runId: z.string().nullable(),
  ts: z.number(),
  read: z.boolean(),
  dedupeKey: z.string().nullable(),
});

export const SessionRecordSchema = z.object({
  id: z.string(),
  provider: ProviderId,
  providerSessionId: z.string().nullable(),
  cwd: z.string().nullable(),
  profile: SecurityProfile.nullable(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunId: z.string().nullable(),
  turns: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
});

export const ProviderCapabilitiesSchema = z.object({
  enforcesReadOnly: z.boolean(),
  supportsEffort: z.boolean(),
  promptTransport: z.enum(["stdin", "argv"]),
  streaming: z.boolean(),
  resume: z.enum(["flag", "subcommand", "none"]),
  writeConfinement: z.enum(["broker", "sandbox", "none"]),
  readConfinement: z.enum(["workdir", "none"]),
  /**
   * The provider keeps a folder handed to a run read-only (cerebro-organizar, door 5). Optional in a manifest (absent
   * reads `false`); `GET /api/providers` always says it.
   */
  protectsDirs: z.boolean().optional(),
});

export const TestedVersionsSchema = z.object({ min: z.string(), max: z.string() });
export const VersionStatusSchema = z.enum(["tested", "older", "newer", "unknown"]);

export const MetricsSampleSchema = z.object({
  ts: z.number(),
  runsTotal: z.number(),
  runs24h: z.number(),
  failed24h: z.number(),
  costTodayUsd: z.number(),
  tokensToday: z.number(),
  spendWeekUsd: z.number(),
  inboxUnread: z.number(),
  approvalsPending: z.number(),
  approvalWaitAvgMs: z.number().nullable(),
});

export const DeviceScopeSchema = z.enum(DEVICE_SCOPES);

export const DeviceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  scopes: z.array(DeviceScopeSchema),
});

export const BackupInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  createdAt: z.number(),
  sizeBytes: z.number(),
});

/** `GET /api/metrics` (runs) - kept here with the diagnostics bundle that embeds it. */
export const CostMetricsSchema = z.object({
  todayUsd: z.number(),
  weekUsd: z.number(),
  tokensToday: z.number(),
  burnRatePerHour: z.number(),
  block5h: z.object({ usedPct: z.number(), resetsAt: z.number() }).optional(),
});

export const RunMetricsSchema = z.object({
  total: z.number(),
  last7d: z.number(),
  successRate: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
  byProvider: z.array(z.object({ provider: z.string(), count: z.number(), success: z.number() })),
  running: z.number(),
  failedRecent: z.number(),
  cost: CostMetricsSchema,
  usageSeries: z.array(z.object({ ts: z.number(), tokens: z.number(), usd: z.number() })),
});

/** Runs, their conversations (sessions), their metrics and the artifacts they leave. */
import { z } from "zod";
import { EffortLevel, ProviderId } from "../settings.js";
import { PageQuery, RunPrompt, RunTimeout, UuidParam, UuidParams, err, notFound } from "./common.js";
import { route, stream } from "./route.js";
import {
  ApprovalSchema,
  RunEventSchema,
  RunMetricsSchema,
  RunModeSchema,
  RunRecordSchema,
  RunStatusSchema,
  RunSummarySchema,
  SessionRecordSchema,
} from "./wire.js";
import { RunFrameSchema } from "../eventSchemas.js";

// ---- schemas ---------------------------------------------------------------------------------------------------

/** What a started (or parked) run answers: the run, its conversation and, if a human must decide first, the approval. */
export const RunLaunchSchema = z.object({
  runId: z.string().nullable(),
  status: z.enum(["queued", "waiting_approval"]),
  /** The conversation the run belongs to (prompt runs; a skill run has none). */
  sessionId: z.string().optional(),
  pendingApproval: ApprovalSchema.optional(),
});

const PromptRunFields = {
  provider: ProviderId.optional(),
  model: z.string().nullable().optional(),
  effort: EffortLevel.optional(),
  mode: RunModeSchema.default("read_only"),
  cwd: z.string().optional(),
  timeoutMs: RunTimeout.optional(),
};

export const CreateRunBodySchema = z.object({
  /** A client-chosen key that makes the request safe to repeat: the same key and body answer the same run. */
  submissionId: z.string().uuid().optional(),
  prompt: RunPrompt,
  ...PromptRunFields,
  /** Continue this conversation instead of starting a new one. */
  sessionId: UuidParam.optional(),
});

const RunDiffSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("git"),
    file: z.string(),
    repoRoot: z.string(),
    diff: z.string(),
    truncated: z.boolean(),
    unchanged: z.boolean(),
  }),
  z.object({
    kind: z.literal("snapshot"),
    file: z.string(),
    content: z.string().nullable(),
    truncated: z.boolean(),
    untracked: z.boolean(),
    message: z.string().nullable(),
  }),
  z.object({ kind: z.literal("unavailable"), file: z.string(), message: z.string() }),
]);

const RecentArtifactSchema = z.object({
  runId: z.string(),
  file: z.string(),
  path: z.string(),
  createdAt: z.number(),
  origin: z.string(),
  skillSlug: z.string().nullable(),
  provider: z.string(),
  sizeBytes: z.number().nullable(),
});

const SessionSummarySchema = SessionRecordSchema.extend({
  runCount: z.number(),
  lastRun: z
    .object({
      id: z.string(),
      status: z.string(),
      createdAt: z.number(),
      finishedAt: z.number().nullable(),
      durationMs: z.number().nullable(),
      model: z.string().nullable(),
      promptSummary: z.string(),
    })
    .nullable(),
});

const totalCount = "The number of rows the filter matches, for pagination (the body is a plain array)";

const submissionErrors = [
  err(409, "submission_conflict", "The submissionId was used with different content, or by another caller"),
  err(
    409,
    "submission_uncertain",
    "The first attempt with this submissionId has an uncertain result: check the history",
  ),
];

/** The refusals any route that starts a run can answer. */
const startErrors = [
  err(400, "unknown_provider", "No adapter is registered for the provider"),
  err(400, "bad_request", "The provider is not enabled"),
  err(403, "profile_refused", "The security profile does not allow a write run"),
  err(
    403,
    "device_provider_refused",
    "A paired device may start runs only on a provider that keeps reads in the working folder",
  ),
  err(409, "workspace_unavailable", "The working folder cannot be used"),
  err(429, "too_many_requests", "The queue of runs is full"),
];

export const runRoutes = {
  "runs.list": route({
    method: "GET",
    path: "/api/runs",
    summary: "Runs, newest first (without their complete request)",
    tag: "runs",
    scope: "monitor",
    query: z.object({
      provider: ProviderId.optional(),
      statusGroup: z.enum(["active", "failed"]).optional(),
      order: z.enum(["asc", "desc"]).default("desc"),
      ...PageQuery,
      status: RunStatusSchema.optional(),
    }),
    responses: { 200: z.array(RunSummarySchema) },
    headers: { "x-total-count": totalCount },
  }),
  "runs.get": route({
    method: "GET",
    path: "/api/runs/:id",
    summary: "One run with its events",
    tag: "runs",
    scope: "monitor",
    params: UuidParams,
    responses: { 200: z.object({ run: RunRecordSchema, events: z.array(RunEventSchema) }) },
    errors: [notFound("The run")],
  }),
  "runs.create": route({
    method: "POST",
    path: "/api/runs",
    summary: "Start a prompt run (202 when the write waits for a human)",
    tag: "runs",
    scope: "run",
    body: CreateRunBodySchema,
    responses: { 200: RunLaunchSchema, 202: RunLaunchSchema },
    errors: [notFound("The conversation"), ...startErrors, ...submissionErrors],
  }),
  "runs.children.create": route({
    method: "POST",
    path: "/api/runs/:id/children",
    summary: "Fan several prompts out as children of a run (a squad)",
    tag: "runs",
    scope: "run",
    params: UuidParams,
    body: z.object({
      prompts: z.array(RunPrompt).min(1).max(8),
      ...PromptRunFields,
    }),
    responses: {
      200: z.object({ runs: z.array(RunLaunchSchema) }),
      202: z.object({ runs: z.array(RunLaunchSchema) }),
    },
    errors: [notFound("The run"), ...startErrors],
  }),
  "runs.children.list": route({
    method: "GET",
    path: "/api/runs/:id/children",
    summary: "The children of a run, newest first (at most 50)",
    tag: "runs",
    scope: "monitor",
    params: UuidParams,
    responses: { 200: z.array(RunRecordSchema) },
    errors: [notFound("The run")],
  }),
  "runs.diff": route({
    method: "GET",
    path: "/api/runs/:id/diff",
    summary:
      "The diff of one file a run touched (its change against HEAD in a repository, or a snapshot outside one)",
    tag: "runs",
    scope: "content",
    params: UuidParams,
    query: z.object({ file: z.string().min(1).max(4096) }),
    responses: { 200: RunDiffSchema },
    errors: [notFound("The run")],
  }),
  "runs.cancel": route({
    method: "POST",
    path: "/api/runs/:id/cancel",
    summary: "Cancel a run (false when it was not active)",
    tag: "runs",
    scope: "run",
    params: UuidParams,
    responses: { 200: z.object({ cancelled: z.boolean() }) },
  }),
  "runs.retry": route({
    method: "POST",
    path: "/api/runs/:id/retry",
    summary: "Repeat the complete typed request kept with a run",
    tag: "runs",
    scope: "run",
    params: UuidParams,
    body: z.object({ submissionId: z.string().uuid() }),
    responses: { 200: RunLaunchSchema, 202: RunLaunchSchema },
    errors: [
      notFound("The run"),
      err(409, "request_unavailable", "This older run kept no complete request to repeat safely"),
      err(409, "skill_unavailable", "The skill the run used is no longer available"),
      ...startErrors,
      ...submissionErrors,
    ],
  }),
  "runs.stream": route({
    method: "GET",
    path: "/api/runs/:id/stream",
    summary: "Server-sent events of one run: its events, then a final run_state frame",
    tag: "runs",
    scope: "monitor",
    queryToken: true,
    ticket: true,
    params: UuidParams,
    query: z.object({
      since: z.string().optional(),
      ticket: z.string().optional(),
      token: z.string().optional(),
    }),
    responses: {
      200: stream(
        RunFrameSchema,
        "Frames `data: {...}` with the persisted event id as the SSE id; Last-Event-ID (or since) resumes after it",
      ),
    },
    errors: [notFound("The run")],
  }),
  "metrics.get": route({
    method: "GET",
    path: "/api/metrics",
    summary: "Run counts, success rate, cost and the tokens series",
    tag: "metrics",
    scope: "monitor",
    responses: { 200: RunMetricsSchema },
  }),
  "artifacts.recent": route({
    method: "GET",
    path: "/api/artifacts/recent",
    summary: "The files of the latest runs",
    tag: "artifacts",
    scope: "content",
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
    responses: { 200: z.array(RecentArtifactSchema) },
  }),
  "artifacts.file": route({
    method: "GET",
    path: "/api/artifacts/file",
    summary: "Read one artifact as text (at most 2 MB), strictly inside artifacts/",
    tag: "artifacts",
    scope: "content",
    query: z.object({ p: z.string() }),
    responses: {
      200: z.object({
        path: z.string(),
        content: z.string().nullable(),
        sizeBytes: z.number().optional(),
        note: z.string().optional(),
      }),
    },
    errors: [notFound("The artifact")],
  }),
  "sessions.list": route({
    method: "GET",
    path: "/api/sessions",
    summary: "Conversations, newest activity first, each with its run count and last run",
    tag: "sessions",
    scope: "monitor",
    query: z.object({ ...PageQuery, provider: ProviderId.optional() }),
    responses: { 200: z.array(SessionSummarySchema) },
    headers: { "x-total-count": totalCount },
  }),
  "sessions.get": route({
    method: "GET",
    path: "/api/sessions/:id",
    summary: "One conversation with its runs",
    tag: "sessions",
    scope: "monitor",
    params: UuidParams,
    responses: { 200: z.object({ session: SessionRecordSchema, runs: z.array(RunRecordSchema) }) },
    errors: [notFound("The conversation")],
  }),
  "sessions.continue": route({
    method: "POST",
    path: "/api/sessions/:id/continue",
    summary: "Continue a conversation: a new run that resumes the provider session",
    tag: "sessions",
    scope: "run",
    params: UuidParams,
    body: z.object({
      submissionId: z.string().uuid().optional(),
      prompt: RunPrompt,
      mode: RunModeSchema.default("read_only"),
      effort: EffortLevel.optional(),
      model: z.string().nullable().optional(),
      timeoutMs: RunTimeout.optional(),
    }),
    responses: { 200: RunLaunchSchema, 202: RunLaunchSchema },
    errors: [notFound("The conversation"), ...startErrors, ...submissionErrors],
  }),
  "sessions.rename": route({
    method: "PATCH",
    path: "/api/sessions/:id",
    summary: "Rename a conversation",
    tag: "sessions",
    scope: "owner",
    params: UuidParams,
    body: z.object({ title: z.string().min(1).max(200) }),
    responses: { 200: SessionRecordSchema },
    errors: [notFound("The conversation")],
  }),
  "sessions.delete": route({
    method: "DELETE",
    path: "/api/sessions/:id",
    summary: "Forget a conversation; its runs stay in the history, unlinked",
    tag: "sessions",
    scope: "owner",
    params: UuidParams,
    responses: { 200: z.object({ deleted: z.boolean(), runsKept: z.number() }) },
    errors: [notFound("The conversation")],
  }),
} as const;

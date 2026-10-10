import path from "node:path";
import { createHash } from "node:crypto";
import {
  ProviderSettingsSchema,
  promptRunFields,
  type AgentAdapter,
  type Approval,
  type CreateRunInput,
  type EffortLevel,
  type GatedRunPayload,
  type PromptRunInput,
  type ProviderId,
  type ProviderSettings,
  type RunMode,
  type SecurityProfile,
  type SkillRunInput,
  type WriteGate,
  type WriteOrigin,
} from "@mordomo/core";
import type { FastifyRequest } from "fastify";
import type { AppContext } from "../context.js";

/**
 * Who made a request (docs/security.md, "Scopes"): the local token is the
 * owner at the machine, a paired device token is a `device`, and a run's
 * permission-broker credential is a `broker` bound to that run, and the credential of a memory skill's run is a
 * `run` bound to it.
 */
export type Principal =
  | { kind: "owner" }
  | { kind: "device"; deviceId: string }
  | { kind: "broker"; runId: string }
  | { kind: "run"; runId: string };

/** How an approval records its decider (`Approval.resolvedBy`). */
export function principalName(principal: Principal): string {
  if (principal.kind === "device") return `device:${principal.deviceId}`;
  if (principal.kind === "broker") return `broker:${principal.runId}`;
  if (principal.kind === "run") return `run:${principal.runId}`;
  return "owner";
}

/**
 * Who asked, by the name runs and approvals record (`RunRecord.startedBy`, `Approval.requestedBy`). The gate sets a
 * principal on every route that is not public, so a handler that reaches this without one is a route the gate did not
 * guard: it fails closed (500) instead of starting work in the name of nobody, which no rule about devices would see.
 */
export function startedByOf(req: FastifyRequest): string {
  if (!req.principal) {
    throw httpError(500, "No principal on a request that starts work", "principal_missing");
  }
  return principalName(req.principal);
}

/** Error carrying an HTTP status — the global error handler maps it 1:1. */
export function httpError(
  statusCode: number,
  message: string,
  code?: string,
): Error & { statusCode: number; code?: string } {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/**
 * A provider id is only a format: refuse one no adapter is registered for
 * (`400 unknown_provider`) before anything is created, and hand back its
 * settings (the defaults when `settings.json` has no entry for it).
 */
export function requireProvider(
  ctx: AppContext,
  id: ProviderId,
  settings = ctx.settings(),
): ProviderSettings {
  if (!ctx.providers.has(id)) throw unknownProvider(id);
  return settings.providers[id] ?? ProviderSettingsSchema.parse({});
}

/** The live adapter of a registered provider (`400 unknown_provider` otherwise). */
export function requireAdapter(ctx: AppContext, id: ProviderId): AgentAdapter {
  const adapter = ctx.adapters[id];
  if (!adapter) throw unknownProvider(id);
  return adapter;
}

function unknownProvider(id: ProviderId): Error {
  return httpError(400, `Unknown provider "${id}": no adapter is registered for it`, "unknown_provider");
}

/** Roots a user-supplied path may resolve into: the home plus enabled indexed folders (the engine's rule). */
export function grantedRoots(ctx: AppContext): string[] {
  return ctx.grantedRoots();
}

export type { GatedRunPayload, PromptRunInput, SkillRunInput, WriteGate } from "@mordomo/core";

/**
 * The write policy check `gateWrite` starts with, on its own: callers that
 * need to know a write is refused *before* they create anything (a session,
 * for instance) use this instead of duplicating the rule. The rule is the
 * engine's (`MordomoEngine.assertWriteAllowed`).
 */
export function assertWriteAllowed(ctx: AppContext, mode: RunMode, origin: WriteOrigin): void {
  ctx.assertWriteAllowed(mode, origin);
}

/**
 * Apply the security profile to a write run: refuse, ask for approval, or
 * allow (`MordomoEngine.gateWrite`). The approval payload carries everything
 * needed to launch the run once a human approves it, plus the id of the
 * `waiting_approval` run row so the pending write is visible in Runs.
 */
export function gateWrite(
  ctx: AppContext,
  mode: RunMode,
  origin: WriteOrigin,
  description: string,
  payload: GatedRunPayload,
): WriteGate {
  return ctx.gateWrite(mode, origin, description, payload);
}

function skillRunFields(ctx: AppContext, input: SkillRunInput): Omit<CreateRunInput, "profile"> {
  return ctx.skillRunFields(input);
}

/**
 * Reuse the run row an approval was gating, or create a fresh one. A row that
 * is no longer waiting (cancelled, expired) is left alone and replaced.
 */
function claimRun(
  ctx: AppContext,
  approvedRunId: string | null | undefined,
  fields: Omit<CreateRunInput, "profile">,
  profile: SecurityProfile,
): string {
  if (approvedRunId && ctx.runs.markApproved(approvedRunId)) {
    ctx.runs.setMaxCostUsd(approvedRunId, fields.maxCostUsd ?? null);
    return approvedRunId;
  }
  return ctx.runs.create({ ...fields, profile }).id;
}

export function launchPromptRun(
  ctx: AppContext,
  input: PromptRunInput,
  onError: (err: unknown, runId: string) => void,
  approvedRunId?: string | null,
): { runId: string } {
  const profile: SecurityProfile = input.mode === "write" ? ctx.settings().securityProfile : "read_only";
  const runId = claimRun(ctx, approvedRunId, promptRunFields(input), profile);
  const artifactsNote = `\n\nIf you produce files, write them into: ${path.join(ctx.paths.artifacts, runId)}`;
  ctx.runs
    .execute(runId, input.prompt + artifactsNote, input.mode)
    .catch((err: unknown) => onError(err, runId));
  return { runId };
}

export function launchSkillRun(
  ctx: AppContext,
  input: SkillRunInput,
  onError: (err: unknown, runId: string) => void,
  approvedRunId?: string | null,
): { runId: string } {
  const skill = ctx.skills.load(input.slug);
  if (!skill) throw httpError(404, "Skill not found");
  const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
  const profile: SecurityProfile = mode === "write" ? ctx.settings().securityProfile : "read_only";
  // Per-skill daily budget (follow-up 7): refused when exhausted, otherwise the remainder caps the run.
  let maxCostUsd: number | null = null;
  if (skill.budgetUsd > 0) {
    const spent = ctx.runs.committedTodayUsd({ skillSlug: skill.slug });
    if (spent >= skill.budgetUsd)
      throw httpError(
        409,
        `Daily budget of US$ ${skill.budgetUsd.toFixed(2)} for /${skill.slug} exhausted (spent or reserved US$ ${spent.toFixed(2)} today).`,
        "budget_exhausted",
      );
    maxCostUsd = skill.budgetUsd - spent;
  }
  const runId = claimRun(ctx, approvedRunId, { ...skillRunFields(ctx, input), maxCostUsd }, profile);
  const prompt = ctx.skills.buildRunPrompt(skill, input.inputs, path.join(ctx.paths.artifacts, runId));
  ctx.runs.execute(runId, prompt, mode).catch((err: unknown) => onError(err, runId));
  return { runId };
}

// ------------------------------------------------------------- sessions --

/**
 * The conversation a prompt run belongs to: the one the caller asked to
 * continue, or a fresh one titled after the prompt. Creating it here (before
 * the write gate) means a run parked in `waiting_approval` already carries its
 * session, so releasing it continues the same conversation.
 */
export function ensureSession(ctx: AppContext, input: PromptRunInput): string {
  if (input.sessionId) return input.sessionId;
  return ctx.runs.sessions.create({
    provider: input.provider,
    cwd: input.cwd,
    profile: input.mode === "write" ? ctx.settings().securityProfile : "read_only",
    title: input.prompt,
  }).id;
}

/** Body accepted by `POST /api/runs` and `POST /api/sessions/:id/continue`. */
export interface PromptRunRequest {
  submissionId?: string;
  prompt: string;
  provider?: ProviderId;
  model?: string | null;
  effort?: EffortLevel;
  mode: RunMode;
  cwd?: string;
  timeoutMs?: number;
  /** Continue this conversation instead of starting a new one. */
  sessionId?: string;
  /** Fan out from this run (a child of a squad). */
  parentRunId?: string;
}

export interface PromptRunResponse {
  statusCode: number;
  body: {
    runId: string | null;
    sessionId: string;
    status: "queued" | "waiting_approval";
    pendingApproval?: Approval;
  };
}

/**
 * One place where a prompt run is created, whether it comes from the prompt
 * box or from "continue this conversation": resolve the session's defaults
 * (provider and cwd, unless the caller overrides them), apply the write gate,
 * then launch. 202 + `waiting_approval` when the profile wants a human first.
 */
/** The longest text an approval's one-line label quotes; the approval's payload holds the whole request. */
const LABEL_QUOTE_CHARS = 600;

/**
 * A request quoted inside an approval's description (the label a chat message or a notification shows): cut, and said
 * to be cut and by how much, so nobody reads a prefix as the whole. The approval's `payload.input` is never cut, and
 * the approvals screens render it whole (`ApprovalRequest`).
 */
export function clipForLabel(text: string): string {
  if (text.length <= LABEL_QUOTE_CHARS) return text;
  return `${text.slice(0, LABEL_QUOTE_CHARS)}… (+${text.length - LABEL_QUOTE_CHARS} more characters; the approval holds the full request)`;
}

export function submitPromptRun(
  ctx: AppContext,
  body: PromptRunRequest,
  startedBy: string | null,
  onError: (err: unknown, runId: string) => void,
): PromptRunResponse {
  if (!body.submissionId) return createPromptSubmission(ctx, body, startedBy, onError);
  const { submissionId, ...payload } = body;
  // Who asked is part of the request's identity: a receipt holds the run ids of the one who made it, so the same
  // `submissionId` from another principal is a conflict, never a replay that hands over someone else's run.
  const hash = createHash("sha256")
    .update(`${startedBy}\n${JSON.stringify(payload, Object.keys(payload).sort())}`)
    .digest("hex");
  const receipt = ctx.db
    .prepare("SELECT request_hash, response FROM prompt_submissions WHERE id = ?")
    .get(submissionId) as { request_hash: string; response: string | null } | undefined;
  if (receipt) {
    if (receipt.request_hash !== hash)
      throw httpError(409, "Submission identity was reused with different content.", "submission_conflict");
    if (!receipt.response)
      throw httpError(
        409,
        "This submission has an uncertain result. Check execution history before submitting again.",
        "submission_uncertain",
      );
    return JSON.parse(receipt.response) as PromptRunResponse;
  }
  // Reserve durably before creating any run. A crash between reservation and
  // receipt refuses replay rather than risking a second external side effect.
  ctx.db
    .prepare("INSERT INTO prompt_submissions(id, request_hash, created_at) VALUES (?, ?, ?)")
    .run(submissionId, hash, Date.now());
  let result: PromptRunResponse;
  try {
    result = createPromptSubmission(ctx, payload, startedBy, onError);
  } catch (error) {
    ctx.db.prepare("DELETE FROM prompt_submissions WHERE id = ?").run(submissionId);
    throw error;
  }
  // Deliberately outside the catch: failure to write the receipt is uncertain,
  // and must never release the reservation of a run already dispatched.
  ctx.db
    .prepare("UPDATE prompt_submissions SET response = ? WHERE id = ?")
    .run(JSON.stringify(result), submissionId);
  return result;
}

function createPromptSubmission(
  ctx: AppContext,
  body: PromptRunRequest,
  startedBy: string | null,
  onError: (err: unknown, runId: string) => void,
): PromptRunResponse {
  const settings = ctx.settings();
  const session = body.sessionId ? ctx.runs.sessions.get(body.sessionId) : null;
  if (body.sessionId && !session) throw httpError(404, "Session not found");
  const provider = body.provider ?? session?.provider ?? settings.defaultProvider;
  const providerSettings = requireProvider(ctx, provider, settings);
  if (!providerSettings.enabled) throw httpError(400, `Provider ${provider} is not enabled`);
  // A device's refusal comes before the conversation is created, so it leaves nothing behind.
  ctx.runs.assertMayStart(startedBy, provider);
  // A session's cwd is re-checked against the *current* roots: a folder that
  // was granted when the conversation started may have been revoked since.
  const requested = body.cwd ?? session?.cwd ?? null;
  const cwd = ctx.resolveCwd(requested);
  const input: PromptRunInput = {
    prompt: body.prompt,
    provider,
    model: body.model !== undefined ? body.model : providerSettings.defaultModel,
    effort: body.effort ?? providerSettings.defaultEffort,
    mode: body.mode,
    cwd,
    timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    ...(body.parentRunId ? { parentRunId: body.parentRunId } : {}),
    startedBy,
  };
  // Refused writes must not leave an empty conversation behind.
  assertWriteAllowed(ctx, body.mode, "manual");
  input.sessionId = ensureSession(ctx, input);
  const gate = gateWrite(
    ctx,
    body.mode,
    "manual",
    `Write-mode prompt run with ${provider}: "${clipForLabel(body.prompt)}"`,
    { kind: "prompt", input },
  );
  if (gate.pendingApproval) {
    // 202 + the parked run row: the write is visible in Runs as `waiting_approval`.
    return {
      statusCode: 202,
      body: {
        runId: gate.runId,
        sessionId: input.sessionId,
        status: "waiting_approval",
        pendingApproval: gate.pendingApproval,
      },
    };
  }
  const { runId } = launchPromptRun(ctx, input, onError);
  return { statusCode: 200, body: { runId, sessionId: input.sessionId, status: "queued" } };
}

import path from "node:path";
import {
  events,
  resolveInsideRoots,
  writeDecision,
  type Approval,
  type CreateRunInput,
  type EffortLevel,
  type ProviderId,
  type RunMode,
  type SecurityProfile,
  type WriteOrigin,
} from "@mordomo/core";
import type { AppContext } from "../context.js";

/** Error carrying an HTTP status — the global error handler maps it 1:1. */
export function httpError(
  statusCode: number,
  message: string,
  code?: string,
): Error & { statusCode: number; code?: string } {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/** Roots a user-supplied path may resolve into: the home plus enabled indexed folders. */
export function grantedRoots(ctx: AppContext): string[] {
  return [
    ctx.paths.home,
    ...ctx
      .settings()
      .indexedFolders.filter((f) => f.enabled)
      .map((f) => f.path),
  ];
}

export interface PromptRunInput {
  prompt: string;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  mode: RunMode;
  cwd: string;
  timeoutMs: number;
  /**
   * Conversation this run belongs to. `submitPromptRun` fills it in before the
   * write gate, so a run parked for approval resumes the same conversation
   * when a human releases it.
   */
  sessionId?: string;
}

export interface SkillRunInput {
  slug: string;
  inputs: Record<string, string>;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  cwd: string;
  timeoutMs: number;
}

/** What an approved `write_run` approval replays (also its stored payload shape). */
export type GatedRunPayload =
  { kind: "prompt"; input: PromptRunInput } | { kind: "skill"; input: SkillRunInput };

export interface WriteGate {
  /** Pending approval created instead of launching the run (profile `review_before_write`). */
  pendingApproval: ReturnType<AppContext["approvals"]["request"]> | null;
  /** Run row parked in `waiting_approval` and linked to that approval. */
  runId: string | null;
}

/**
 * The write policy check `gateWrite` starts with, on its own: callers that
 * need to know a write is refused *before* they create anything (a session,
 * for instance) use this instead of duplicating the rule.
 */
export function assertWriteAllowed(ctx: AppContext, mode: RunMode, origin: WriteOrigin): void {
  if (mode !== "write") return;
  if (writeDecision(ctx.settings().securityProfile, origin) === "refuse") {
    throw httpError(
      403,
      "The current security profile does not allow write runs; change it in Settings › Security.",
      "profile_refused",
    );
  }
}

/** The run row a gated write is parked in until a human decides. */
function createGatedRun(ctx: AppContext, payload: GatedRunPayload): string {
  const fields =
    payload.kind === "skill" ? skillRunFields(ctx, payload.input) : promptRunFields(payload.input);
  return ctx.runs.create({ ...fields, profile: ctx.settings().securityProfile, status: "waiting_approval" })
    .id;
}

/**
 * Apply the security profile to a write run (audit item 39): refuse, ask for
 * approval, or allow. The approval payload carries everything needed to launch
 * the run once a human approves it in Settings › Security, plus the id of the
 * `waiting_approval` run row so the pending write is visible in Runs.
 */
export function gateWrite(
  ctx: AppContext,
  mode: RunMode,
  origin: WriteOrigin,
  description: string,
  payload: GatedRunPayload,
): WriteGate {
  if (mode !== "write") return { pendingApproval: null, runId: null };
  assertWriteAllowed(ctx, mode, origin);
  const decision = writeDecision(ctx.settings().securityProfile, origin);
  if (decision === "approval") {
    const runId = createGatedRun(ctx, payload);
    const approval = ctx.approvals.request("write_run", description, { ...payload, runId });
    events.emit("approval.requested", { id: approval.id, kind: approval.kind, description, runId });
    return { pendingApproval: approval, runId };
  }
  return { pendingApproval: null, runId: null };
}

function promptRunFields(input: PromptRunInput): Omit<CreateRunInput, "profile"> {
  return {
    origin: "manual",
    provider: input.provider,
    prompt: input.prompt,
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    mode: input.mode,
    timeoutMs: input.timeoutMs,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}

function skillRunFields(ctx: AppContext, input: SkillRunInput): Omit<CreateRunInput, "profile"> {
  const skill = ctx.skills.load(input.slug);
  if (!skill) throw httpError(404, "Skill not found");
  return {
    origin: "skill",
    provider: input.provider,
    prompt: `(skill: ${input.slug})`,
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    mode: skill.mode === "write" ? "write" : "read_only",
    timeoutMs: input.timeoutMs,
    skillSlug: input.slug,
  };
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
  if (approvedRunId && ctx.runs.markApproved(approvedRunId)) return approvedRunId;
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
  const runId = claimRun(ctx, approvedRunId, skillRunFields(ctx, input), profile);
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
  prompt: string;
  provider?: ProviderId;
  model?: string | null;
  effort?: EffortLevel;
  mode: RunMode;
  cwd?: string;
  timeoutMs?: number;
  /** Continue this conversation instead of starting a new one. */
  sessionId?: string;
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
export function submitPromptRun(
  ctx: AppContext,
  body: PromptRunRequest,
  onError: (err: unknown, runId: string) => void,
): PromptRunResponse {
  const settings = ctx.settings();
  const session = body.sessionId ? ctx.runs.sessions.get(body.sessionId) : null;
  if (body.sessionId && !session) throw httpError(404, "Session not found");
  const provider = body.provider ?? session?.provider ?? settings.defaultProvider;
  const providerSettings = settings.providers[provider];
  if (!providerSettings?.enabled) throw httpError(400, `Provider ${provider} is not enabled`);
  // A session's cwd is re-checked against the *current* roots: a folder that
  // was granted when the conversation started may have been revoked since.
  const roots = grantedRoots(ctx);
  const requested = body.cwd ?? session?.cwd ?? null;
  const cwd = requested ? resolveInsideRoots(roots, requested) : ctx.paths.home;
  const input: PromptRunInput = {
    prompt: body.prompt,
    provider,
    model: body.model !== undefined ? body.model : providerSettings.defaultModel,
    effort: body.effort ?? providerSettings.defaultEffort,
    mode: body.mode,
    cwd,
    timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
  };
  // Refused writes must not leave an empty conversation behind.
  assertWriteAllowed(ctx, body.mode, "manual");
  input.sessionId = ensureSession(ctx, input);
  const gate = gateWrite(
    ctx,
    body.mode,
    "manual",
    `Write-mode prompt run with ${provider}: "${body.prompt.slice(0, 80)}"`,
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

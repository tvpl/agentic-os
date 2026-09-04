import path from "node:path";
import {
  events,
  writeDecision,
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
  const decision = writeDecision(ctx.settings().securityProfile, origin);
  if (decision === "refuse") {
    throw httpError(
      403,
      "The current security profile does not allow write runs; change it in Settings › Security.",
      "profile_refused",
    );
  }
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

import path from "node:path";
import { events, writeDecision, type EffortLevel, type ProviderId, type RunMode, type WriteOrigin } from "@mordomo/core";
import type { AppContext } from "../context.js";

/** Error carrying an HTTP status — the global error handler maps it 1:1. */
export function httpError(statusCode: number, message: string, code?: string): Error & { statusCode: number; code?: string } {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/** Roots a user-supplied path may resolve into: the home plus enabled indexed folders. */
export function grantedRoots(ctx: AppContext): string[] {
  return [ctx.paths.home, ...ctx.settings().indexedFolders.filter((f) => f.enabled).map((f) => f.path)];
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

export interface WriteGate {
  /** Pending approval created instead of a run (profile `review_before_write`). */
  pendingApproval: ReturnType<AppContext["approvals"]["request"]> | null;
}

/**
 * Apply the security profile to a write run (audit item 39): refuse, ask for
 * approval, or allow. The approval payload carries everything needed to launch
 * the run once a human approves it in Settings › Security.
 */
export function gateWrite(ctx: AppContext, mode: RunMode, origin: WriteOrigin, description: string, payload: Record<string, unknown>): WriteGate {
  if (mode !== "write") return { pendingApproval: null };
  const decision = writeDecision(ctx.settings().securityProfile, origin);
  if (decision === "refuse") {
    throw httpError(403, "The current security profile does not allow write runs; change it in Settings › Security.", "profile_refused");
  }
  if (decision === "approval") {
    const approval = ctx.approvals.request("write_run", description, payload);
    events.emit("approval.requested", { id: approval.id, kind: approval.kind, description });
    return { pendingApproval: approval };
  }
  return { pendingApproval: null };
}

export function launchPromptRun(ctx: AppContext, input: PromptRunInput, onError: (err: unknown, runId: string) => void): { runId: string } {
  const run = ctx.runs.create({
    origin: "manual",
    provider: input.provider,
    prompt: input.prompt,
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    mode: input.mode,
    timeoutMs: input.timeoutMs,
    profile: input.mode === "write" ? ctx.settings().securityProfile : "read_only",
  });
  const artifactsNote = `\n\nIf you produce files, write them into: ${path.join(ctx.paths.artifacts, run.id)}`;
  ctx.runs.execute(run.id, input.prompt + artifactsNote, input.mode).catch((err: unknown) => onError(err, run.id));
  return { runId: run.id };
}

export function launchSkillRun(ctx: AppContext, input: SkillRunInput, onError: (err: unknown, runId: string) => void): { runId: string } {
  const skill = ctx.skills.load(input.slug);
  if (!skill) throw httpError(404, "Skill not found");
  const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
  const run = ctx.runs.create({
    origin: "skill",
    provider: input.provider,
    prompt: `(skill: ${input.slug})`,
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    mode,
    timeoutMs: input.timeoutMs,
    profile: mode === "write" ? ctx.settings().securityProfile : "read_only",
    skillSlug: input.slug,
  });
  const prompt = ctx.skills.buildRunPrompt(skill, input.inputs, path.join(ctx.paths.artifacts, run.id));
  ctx.runs.execute(run.id, prompt, mode).catch((err: unknown) => onError(err, run.id));
  return { runId: run.id };
}

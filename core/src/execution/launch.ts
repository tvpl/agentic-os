import path from "node:path";
import type { MordomoEngine } from "../engine.js";
import { promptRunFields, type PromptRunInput, type SkillRunInput } from "./inputs.js";
import type { SecurityProfile } from "../config/schema.js";
import { MordomoError } from "../errors.js";
import type { RunMode } from "../agents/types.js";
import type { CreateRunInput } from "../runs/runManager.js";

/**
 * Reuse the run row an approval was gating, or create a fresh one. A row that
 * is no longer waiting (cancelled, expired) is left alone and replaced.
 */
function claimRun(
  engine: MordomoEngine,
  approvedRunId: string | null | undefined,
  fields: Omit<CreateRunInput, "profile">,
  profile: SecurityProfile,
): string {
  if (approvedRunId && engine.runs.markApproved(approvedRunId)) {
    engine.runs.setMaxCostUsd(approvedRunId, fields.maxCostUsd ?? null);
    return approvedRunId;
  }
  return engine.runs.create({ ...fields, profile }).id;
}

/** Create (or claim) the run of a prompt and hand it to its provider without waiting for it. */
export function launchPromptRun(
  engine: MordomoEngine,
  input: PromptRunInput,
  onError: (err: unknown, runId: string) => void,
  approvedRunId?: string | null,
): { runId: string } {
  const profile: SecurityProfile = input.mode === "write" ? engine.settings().securityProfile : "read_only";
  const runId = claimRun(engine, approvedRunId, promptRunFields(input), profile);
  const artifactsNote = `\n\nIf you produce files, write them into: ${path.join(engine.paths.artifacts, runId)}`;
  engine.runs
    .execute(runId, input.prompt + artifactsNote, input.mode)
    .catch((err: unknown) => onError(err, runId));
  return { runId };
}

/** Create (or claim) the run of a skill and hand it to its provider without waiting for it. */
export function launchSkillRun(
  engine: MordomoEngine,
  input: SkillRunInput,
  onError: (err: unknown, runId: string) => void,
  approvedRunId?: string | null,
): { runId: string } {
  const skill = engine.skills.load(input.slug);
  if (!skill) throw new MordomoError(404, "Skill not found");
  const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
  const profile: SecurityProfile = mode === "write" ? engine.settings().securityProfile : "read_only";
  // Per-skill daily budget: refused when exhausted, otherwise the remainder caps the run.
  let maxCostUsd: number | null = null;
  if (skill.budgetUsd > 0) {
    const spent = engine.runs.committedTodayUsd({ skillSlug: skill.slug });
    if (spent >= skill.budgetUsd)
      throw new MordomoError(
        409,
        `Daily budget of US$ ${skill.budgetUsd.toFixed(2)} for /${skill.slug} exhausted (spent or reserved US$ ${spent.toFixed(2)} today).`,
        "budget_exhausted",
      );
    maxCostUsd = skill.budgetUsd - spent;
  }
  const runId = claimRun(engine, approvedRunId, { ...engine.skillRunFields(input), maxCostUsd }, profile);
  const prompt = engine.skills.buildRunPrompt(skill, input.inputs, path.join(engine.paths.artifacts, runId));
  engine.runs.execute(runId, prompt, mode).catch((err: unknown) => onError(err, runId));
  return { runId };
}

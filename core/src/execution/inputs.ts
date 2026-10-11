import type { RunMode } from "../agents/types.js";
import type { EffortLevel, ProviderId } from "../config/schema.js";
import type { CreateRunInput } from "../runs/runManager.js";

/** What a gated write run carries: the prompt or skill run to launch once a human approves. */
export interface PromptRunInput {
  prompt: string;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  mode: RunMode;
  cwd: string;
  timeoutMs: number;
  /** Conversation this run belongs to, so a run released from approval resumes it. */
  sessionId?: string;
  /** Squad: the run this one was fanned out from. */
  parentRunId?: string;
  /**
   * Who asked, by the names `Approval.resolvedBy` uses (`owner`, `device:<id>`); null for the CLI. Required so each
   * caller decides: a write asked by a paired device always waits for a human (`gateWrite`).
   */
  startedBy: string | null;
}

export interface SkillRunInput {
  slug: string;
  inputs: Record<string, string>;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  cwd: string;
  timeoutMs: number;
  /** First run in the lineage when this is a deliberate retry. */
  parentRunId?: string | null;
  /** Who asked (see `PromptRunInput.startedBy`). */
  startedBy: string | null;
}

/** What an approved `write_run` approval replays (also its stored payload shape). */
export type GatedRunPayload =
  { kind: "prompt"; input: PromptRunInput } | { kind: "skill"; input: SkillRunInput };

/** The run fields a free prompt run is created with. */
export function promptRunFields(input: PromptRunInput): Omit<CreateRunInput, "profile"> {
  return {
    origin: "manual",
    provider: input.provider,
    prompt: input.prompt,
    request: { version: 1, kind: "prompt", prompt: input.prompt, mode: input.mode },
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    mode: input.mode,
    timeoutMs: input.timeoutMs,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    startedBy: input.startedBy,
  };
}

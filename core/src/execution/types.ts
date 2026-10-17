import type { Approval, ApprovalKind, RunEvent, RunRecord, RunStatus } from "@mordomo/contracts";
import type { ProviderId } from "../config/schema.js";
import type { RetryInput, StartPromptInput, StartSkillInput } from "./schemas.js";

export type { RetryInput, StartPromptInput, StartSkillInput };

/** Options of the calls that start work. */
export interface StartOptions {
  /**
   * Called when the run could not even be handed to its provider after it was created (the run itself already
   * records its failure). Without it the failure is only on the run.
   */
  onError?: (error: unknown, runId: string) => void;
}

/** What starting a prompt, a skill or a repeat answers. */
export interface StartedRun {
  /** The run, or the run parked in `waiting_approval` when `status` says so. */
  runId: string;
  /** The conversation a prompt run belongs to; a skill run has none. */
  sessionId?: string;
  /** `queued`: handed to the provider. `waiting_approval`: a human has to approve `pendingApproval` first. */
  status: "queued" | "waiting_approval";
  pendingApproval?: Approval;
}

/** Options of `Execution.resolveApproval`. */
export interface ResolveApprovalOptions {
  /** The answers to an agent's question (`AskUserQuestion`): question text -> chosen answer. */
  answers?: Record<string, string>;
  /** As `StartOptions.onError`, for the run an approval releases. */
  onError?: (error: unknown, runId: string) => void;
}

/** What resolving an approval answers. */
export interface ResolvedApproval {
  id: string;
  kind: ApprovalKind;
  status: Approval["status"];
  description: string;
  /** The run an approval launched; null when it launched none (denied, or another kind). */
  runId: string | null;
}

/** Filters of `Execution.list` (newest first unless `order` says otherwise). */
export interface RunFilter {
  limit?: number;
  offset?: number;
  status?: RunStatus;
  statusGroup?: "active" | "failed";
  provider?: ProviderId;
  order?: "asc" | "desc";
  /** Only the runs of one conversation. */
  sessionId?: string;
  /** The run itself and its children. */
  parentRunId?: string;
  skillSlug?: string;
}

/** Options of `Execution.wait`. */
export interface WaitOptions {
  /** Aborting rejects the wait with the signal's reason and leaves the run alone. */
  signal?: AbortSignal;
}

/** What `Execution.smokeTest` answers. */
export interface SmokeResult {
  run: RunRecord;
  /** The run is `done` and the provider answered `MORDOMO_OK`. */
  passed: boolean;
}

/**
 * Starting, following, cancelling and approving runs: the way to run an agent from a program. The rules of the
 * engine (write policy, working folders, who may ask, who may approve) are applied here, so a program that uses
 * the engine as a library cannot go around them.
 */
export interface Execution {
  /**
   * Start a prompt run. Refuses (nothing is created) when the profile does not allow a write, when `cwd` is not a
   * granted folder, when the provider is unknown, disabled or unfit for a device; parks a write for approval when
   * the profile or the asker asks for it. With `submissionId` the call is idempotent.
   */
  startPrompt(input: StartPromptInput, options?: StartOptions): StartedRun;
  /** Start a skill: the same rules, plus the skill's own (enabled, providers it lists, required inputs, daily budget). */
  startSkill(input: StartSkillInput, options?: StartOptions): StartedRun;
  /** Repeat the complete request retained with a run; idempotent per `submissionId` and asker. */
  retry(runId: string, input: RetryInput, options?: StartOptions): StartedRun;
  /**
   * Decide an approval and apply it: an approved write is launched (the run that was parked), a denied one is
   * cancelled. A device never approves what it asked for, nor a kind that is the owner's.
   */
  resolveApproval(
    id: string,
    decision: "approved" | "denied",
    resolvedBy: string | null,
    options?: ResolveApprovalOptions,
  ): Promise<ResolvedApproval>;
  /** The approvals waiting for a decision. */
  pendingApprovals(): Approval[];
  /** A read-only run of a fixed prompt, to see that a provider answers. */
  smokeTest(provider: ProviderId, startedBy: string | null): Promise<SmokeResult>;
  get(runId: string): RunRecord | null;
  list(filter?: RunFilter): RunRecord[];
  /** Cancel a queued or running run (and the approval of a parked one). Resolves whether anything was cancelled. */
  cancel(runId: string, reason?: string): Promise<boolean>;
  /** The persisted events of a run, in order, after `afterId` (default: all). */
  events(runId: string, afterId?: number): Array<{ id: number; event: RunEvent }>;
  /** Live events of a run; the function returned stops them. */
  subscribe(runId: string, listener: (event: RunEvent, eventId?: number) => void): () => void;
  /** Resolve with the run once it has ended (`done`, `failed`, `cancelled`, `timed_out` or `interrupted`). */
  wait(runId: string, options?: WaitOptions): Promise<RunRecord>;
}

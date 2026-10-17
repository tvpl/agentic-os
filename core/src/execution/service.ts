import { createHash } from "node:crypto";
import { z } from "zod";
import {
  TERMINAL_STATUSES,
  isDeviceActor,
  type Approval,
  type ApprovalKind,
  type RunEvent,
  type RunRecord,
} from "@mordomo/contracts";
import type { RunMode } from "../agents/types.js";
import type { ProviderId } from "../config/schema.js";
import type { MordomoEngine } from "../engine.js";
import { MordomoError } from "../errors.js";
import { launchPromptRun, launchSkillRun } from "./launch.js";
import type { PromptRunInput, SkillRunInput } from "./inputs.js";
import {
  RetrySchema,
  StartPromptSchema,
  StartSkillSchema,
  type RetryInput,
  type StartPromptInput,
  type StartSkillInput,
} from "./schemas.js";
import type {
  Execution,
  ResolveApprovalOptions,
  ResolvedApproval,
  RunFilter,
  SmokeResult,
  StartOptions,
  StartedRun,
  WaitOptions,
} from "./types.js";

/**
 * The kinds a paired device holding `approve` may approve: a write run or a tool a run asked for. Everything else
 * (`expose_port` changes where the service listens, `connector_write`, ...) is the owner's, whatever scope the device
 * holds (.specs/features/escopos-dispositivo, door 3). Denying is open to every kind.
 */
const DEVICE_APPROVABLE_KINDS: ReadonlySet<ApprovalKind> = new Set(["write_run", "tool_use"]);

/** The longest text an approval's one-line label quotes; the approval's payload holds the whole request. */
const LABEL_QUOTE_CHARS = 600;

/** The prompt of `smokeTest`, and the line a run keeps of it. */
const SMOKE_SUMMARY = "Smoke test: reply with exactly MORDOMO_OK and do nothing else.";
const SMOKE_PROMPT = `${SMOKE_SUMMARY} Do not read or write any file.`;

/** The name a receipt records for a program that is nobody in particular (`startedBy: null`). */
const PROGRAM_ASKER = "program";

/**
 * A request quoted inside an approval's description (the label a chat message or a notification shows): cut, and said
 * to be cut and by how much, so nobody reads a prefix as the whole. The approval's `payload.input` is never cut, and
 * the approvals screens render it whole (`ApprovalRequest`).
 */
export function clipForLabel(text: string): string {
  if (text.length <= LABEL_QUOTE_CHARS) return text;
  return `${text.slice(0, LABEL_QUOTE_CHARS)}… (+${text.length - LABEL_QUOTE_CHARS} more characters; the approval holds the full request)`;
}

/** Body of a prompt request after validation (`StartPromptSchema` output). */
type PromptBody = z.output<typeof StartPromptSchema>;

/** What a prompt request is answered with, and what a receipt keeps of it (the same JSON the API stored before). */
interface PromptRunResponse {
  statusCode: number;
  body: StartedRun;
}

const TrustedPromptSchema = StartPromptSchema.extend({ prompt: z.string().min(1) });

const noop = (): void => undefined;

/**
 * `engine.execution`: the one door through which a run is started, followed, cancelled and approved. The HTTP
 * routes and the CLI are clients of it, so the rules live once, in the core.
 */
export class ExecutionService implements Execution {
  constructor(private readonly engine: MordomoEngine) {}

  // ------------------------------------------------------------- starting --

  startPrompt(input: StartPromptInput, options: StartOptions & { composed?: boolean } = {}): StartedRun {
    // `composed`: the prompt was assembled by the engine from its own records (an objective's context packet), so
    // the bound meant for text a caller typed does not apply.
    const body = (options.composed === true ? TrustedPromptSchema : StartPromptSchema).parse(input);
    return this.submitPrompt(body, options.onError ?? noop).body;
  }

  startSkill(input: StartSkillInput, options: StartOptions = {}): StartedRun {
    const body = StartSkillSchema.parse(input);
    const engine = this.engine;
    const skill = engine.skills.load(body.slug);
    if (!skill) throw new MordomoError(404, "Skill not found");
    if (!skill.enabled) throw new MordomoError(400, "Skill is disabled");

    const settings = engine.settings();
    const provider = body.provider ?? settings.defaultProvider;
    const providerSettings = engine.requireProvider(provider, settings);
    if (!providerSettings.enabled) throw new MordomoError(400, `Provider ${provider} is not enabled`);
    if (!skill.providers.includes(provider))
      throw new MordomoError(400, `Skill ${body.slug} does not support provider ${provider}`);
    for (const input of skill.inputs) {
      if (input.required && !body.inputs[input.name]?.trim()) {
        throw new MordomoError(400, `Missing required input: ${input.label}`);
      }
    }

    const cwd = engine.resolveCwd(body.cwd);
    const skillInput: SkillRunInput = {
      slug: body.slug,
      inputs: body.inputs,
      provider,
      model:
        body.model !== undefined ? body.model : (skill.recommendedModel ?? providerSettings.defaultModel),
      effort:
        body.effort ??
        (skill.recommendedEffort !== "default" ? skill.recommendedEffort : providerSettings.defaultEffort),
      cwd,
      timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
      startedBy: body.startedBy,
    };
    return this.gateAndLaunchSkill(
      skillInput,
      `Write-mode skill run: /${body.slug} with ${provider}`,
      options.onError ?? noop,
    );
  }

  /**
   * Gate a skill run (park it for approval or refuse it, by the profile and the asker) and launch it. The one place a
   * skill run starts: `startSkill`, `retry` and the dispatch of an objective's step all come here, each with the
   * checks that are theirs.
   */
  gateAndLaunchSkill(
    input: SkillRunInput,
    description: string,
    onError: (error: unknown, runId: string) => void,
  ): StartedRun {
    const skill = this.engine.skills.load(input.slug);
    if (!skill)
      throw new MordomoError(409, `Skill "${input.slug}" is no longer available.`, "skill_unavailable");
    const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
    const gate = this.engine.gateWrite(mode, "skill", description, { kind: "skill", input });
    if (gate.pendingApproval) {
      return {
        runId: parkedRunId(gate.runId),
        status: "waiting_approval",
        pendingApproval: gate.pendingApproval,
      };
    }
    const { runId } = launchSkillRun(this.engine, input, onError);
    return { runId, status: "queued" };
  }

  retry(runId: string, input: RetryInput, options: StartOptions = {}): StartedRun {
    const { submissionId, startedBy } = RetrySchema.parse(input);
    const engine = this.engine;
    const onError = options.onError ?? noop;
    const source = engine.runs.get(runId);
    if (!source) throw new MordomoError(404, "Run not found");
    if (!source.request) {
      throw new MordomoError(
        409,
        "This older run has no complete request to repeat safely.",
        "request_unavailable",
      );
    }
    const requestedBy = startedBy ?? PROGRAM_ASKER;
    const prior = engine.db
      .prepare("SELECT action, source_run_id, requested_by, response FROM run_action_receipts WHERE id = ?")
      .get(submissionId) as
      | { action: string; source_run_id: string; requested_by: string | null; response: string | null }
      | undefined;
    if (prior) {
      // A receipt holds the run its maker was given: it replays for that principal only (a receipt from before the
      // column existed has none and replays for nobody).
      if (prior.action !== "retry" || prior.source_run_id !== runId || prior.requested_by !== requestedBy)
        throw new MordomoError(
          409,
          "Submission identity was reused for another action.",
          "submission_conflict",
        );
      if (!prior.response)
        throw new MordomoError(
          409,
          "This retry has an uncertain result. Check execution history.",
          "submission_uncertain",
        );
      return JSON.parse(prior.response) as StartedRun;
    }
    // The provider comes from the recorded run: refuse one that is no longer
    // registered (`400 unknown_provider`) before a receipt or a run exists.
    engine.requireProvider(source.provider);
    engine.db
      .prepare(
        "INSERT INTO run_action_receipts(id, action, source_run_id, created_at, requested_by) VALUES (?, 'retry', ?, ?, ?)",
      )
      .run(submissionId, runId, Date.now(), requestedBy);
    let result: StartedRun;
    try {
      const lineage = source.parentRunId ?? source.id;
      if (source.request.kind === "skill") {
        const skillInput: SkillRunInput = {
          slug: source.request.skillSlug,
          inputs: source.request.inputs,
          provider: source.provider,
          model: source.model,
          effort: source.effort,
          cwd: source.cwd ?? engine.runs.defaultCwd(),
          timeoutMs: source.timeoutMs ?? engine.settings().limits.defaultTimeoutMs,
          parentRunId: lineage,
          startedBy,
        };
        result = this.gateAndLaunchSkill(
          skillInput,
          `Repeat /${skillInput.slug} with ${source.provider}`,
          onError,
        );
      } else {
        // Our own record, not text a caller typed: it is not held to the bounds of a new request.
        const repeated = this.submitPrompt(
          {
            submissionId,
            prompt: source.request.prompt,
            provider: source.provider,
            model: source.model,
            effort: source.effort,
            mode: source.request.mode,
            cwd: source.cwd ?? engine.runs.defaultCwd(),
            timeoutMs: source.timeoutMs ?? engine.settings().limits.defaultTimeoutMs,
            parentRunId: lineage,
            startedBy,
          },
          onError,
        );
        result = repeated.body;
      }
    } catch (error) {
      engine.db.prepare("DELETE FROM run_action_receipts WHERE id = ?").run(submissionId);
      throw error;
    }
    engine.db
      .prepare("UPDATE run_action_receipts SET response = ? WHERE id = ?")
      .run(JSON.stringify(result), submissionId);
    return result;
  }

  /**
   * One place where a prompt run is created, whether it comes from the prompt box or from "continue this
   * conversation": resolve the session's defaults (provider and cwd, unless the caller overrides them), apply the
   * write gate, then launch. `waiting_approval` when the profile wants a human first.
   */
  private submitPrompt(body: PromptBody, onError: (err: unknown, runId: string) => void): PromptRunResponse {
    if (!body.submissionId) return this.createPromptSubmission(body, onError);
    const { submissionId, ...payload } = body;
    const { startedBy, ...request } = payload;
    // Who asked is part of the request's identity: a receipt holds the run ids of the one who made it, so the same
    // `submissionId` from another principal is a conflict, never a replay that hands over someone else's run.
    const hash = createHash("sha256")
      .update(`${startedBy}\n${JSON.stringify(request, Object.keys(request).sort())}`)
      .digest("hex");
    const db = this.engine.db;
    const receipt = db
      .prepare("SELECT request_hash, response FROM prompt_submissions WHERE id = ?")
      .get(submissionId) as { request_hash: string; response: string | null } | undefined;
    if (receipt) {
      if (receipt.request_hash !== hash)
        throw new MordomoError(
          409,
          "Submission identity was reused with different content.",
          "submission_conflict",
        );
      if (!receipt.response)
        throw new MordomoError(
          409,
          "This submission has an uncertain result. Check execution history before submitting again.",
          "submission_uncertain",
        );
      return JSON.parse(receipt.response) as PromptRunResponse;
    }
    // Reserve durably before creating any run. A crash between reservation and
    // receipt refuses replay rather than risking a second external side effect.
    db.prepare("INSERT INTO prompt_submissions(id, request_hash, created_at) VALUES (?, ?, ?)").run(
      submissionId,
      hash,
      Date.now(),
    );
    let result: PromptRunResponse;
    try {
      result = this.createPromptSubmission(payload, onError);
    } catch (error) {
      db.prepare("DELETE FROM prompt_submissions WHERE id = ?").run(submissionId);
      throw error;
    }
    // Deliberately outside the catch: failure to write the receipt is uncertain,
    // and must never release the reservation of a run already dispatched.
    db.prepare("UPDATE prompt_submissions SET response = ? WHERE id = ?").run(
      JSON.stringify(result),
      submissionId,
    );
    return result;
  }

  private createPromptSubmission(
    body: Omit<PromptBody, "submissionId">,
    onError: (err: unknown, runId: string) => void,
  ): PromptRunResponse {
    const engine = this.engine;
    const settings = engine.settings();
    const session = body.sessionId ? engine.runs.sessions.get(body.sessionId) : null;
    if (body.sessionId && !session) throw new MordomoError(404, "Session not found");
    const provider = body.provider ?? session?.provider ?? settings.defaultProvider;
    const providerSettings = engine.requireProvider(provider, settings);
    if (!providerSettings.enabled) throw new MordomoError(400, `Provider ${provider} is not enabled`);
    // A device's refusal comes before the conversation is created, so it leaves nothing behind.
    engine.runs.assertMayStart(body.startedBy, provider);
    // A session's cwd is re-checked against the *current* roots: a folder that
    // was granted when the conversation started may have been revoked since.
    const requested = body.cwd ?? session?.cwd ?? null;
    const cwd = engine.resolveCwd(requested);
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
      startedBy: body.startedBy,
    };
    // Refused writes must not leave an empty conversation behind.
    engine.assertWriteAllowed(body.mode, "manual");
    input.sessionId = this.ensureSession(input);
    const gate = engine.gateWrite(
      body.mode,
      "manual",
      `Write-mode prompt run with ${provider}: "${clipForLabel(body.prompt)}"`,
      { kind: "prompt", input },
    );
    if (gate.pendingApproval) {
      // The parked run row: the write is visible in Runs as `waiting_approval`.
      return {
        statusCode: 202,
        body: {
          runId: parkedRunId(gate.runId),
          sessionId: input.sessionId,
          status: "waiting_approval",
          pendingApproval: gate.pendingApproval,
        },
      };
    }
    const { runId } = launchPromptRun(engine, input, onError);
    return { statusCode: 200, body: { runId, sessionId: input.sessionId, status: "queued" } };
  }

  /**
   * The conversation a prompt run belongs to: the one the caller asked to continue, or a fresh one titled after the
   * prompt. Creating it here (before the write gate) means a run parked in `waiting_approval` already carries its
   * session, so releasing it continues the same conversation.
   */
  private ensureSession(input: PromptRunInput): string {
    if (input.sessionId) return input.sessionId;
    return this.engine.runs.sessions.create({
      provider: input.provider,
      cwd: input.cwd,
      profile: input.mode === "write" ? this.engine.settings().securityProfile : "read_only",
      title: input.prompt,
    }).id;
  }

  // ------------------------------------------------------------ approving --

  /**
   * Resolve an approval and apply its effect: the one code path behind the Command Centre button, the Telegram
   * buttons and anything else that may decide later. Throws errors with the HTTP status the API answers with, so
   * callers that speak HTTP keep their codes and chat callers wrap it into a line of text.
   */
  async resolveApproval(
    id: string,
    decision: "approved" | "denied",
    resolvedBy: string | null,
    options: ResolveApprovalOptions = {},
  ): Promise<ResolvedApproval> {
    const engine = this.engine;
    // Sweep first: an approval past its TTL is expired here (cancelling the run
    // it gated), so resolving it answers 409 instead of silently acting on it.
    engine.expireStaleApprovals();
    // Separation of duties, where the decision is applied (so the Command Centre, a device and any later caller meet
    // it): a device approves neither what it asked for itself nor a kind that is the owner's.
    if (decision === "approved" && isDeviceActor(resolvedBy)) {
      const asked = engine.approvals.get(id);
      if (asked?.status === "pending") {
        if (!DEVICE_APPROVABLE_KINDS.has(asked.kind)) {
          throw new MordomoError(
            403,
            `Only the owner can approve a request of kind "${asked.kind}"`,
            "owner_only",
          );
        }
        if (asked.requestedBy === resolvedBy) {
          throw new MordomoError(
            403,
            "A device cannot approve what it asked for itself; approve it on the desktop, from Telegram or from another device",
            "self_approval",
          );
        }
      }
    }
    // Approving a parked write whose provider was removed since would launch nothing:
    // refuse (400 unknown_provider) and leave the approval pending.
    if (decision === "approved") {
      const pending = engine.approvals.get(id);
      const input = (pending?.payload as { input?: { provider?: unknown } } | undefined)?.input;
      if (
        pending?.status === "pending" &&
        pending.kind === "write_run" &&
        typeof input?.provider === "string"
      )
        engine.requireProvider(input.provider);
    }
    const answers = options.answers;
    const approval = engine.approvals.resolve(
      id,
      decision,
      decision === "approved" && answers && Object.keys(answers).length > 0 ? { answers } : undefined,
      resolvedBy,
    );
    if (!approval) throw new MordomoError(404, "Approval not found");
    const onError = options.onError ?? noop;
    let runId: string | null = null;
    const gatedRunId = typeof approval.payload.runId === "string" ? approval.payload.runId : null;
    if (approval.status === "approved" && approval.kind === "expose_port") {
      engine.settingsStore.update({ bindAddress: String(approval.payload.bindAddress ?? "127.0.0.1") });
    }
    if (approval.status === "approved" && approval.kind === "write_run") {
      const payload = approval.payload as { kind?: string; input?: unknown };
      if (payload.kind === "prompt" && payload.input)
        runId = launchPromptRun(engine, payload.input as PromptRunInput, onError, gatedRunId).runId;
      else if (payload.kind === "skill" && payload.input)
        runId = launchSkillRun(engine, payload.input as SkillRunInput, onError, gatedRunId).runId;
    }
    // Denied: the run parked in `waiting_approval` is cancelled, not left hanging.
    if (approval.status === "denied" && gatedRunId) {
      await engine.runs.cancel(gatedRunId, "Write approval denied");
    }
    engine.events.emit("approval.resolved", {
      id: approval.id,
      kind: approval.kind,
      status: approval.status,
      runId,
    });
    return {
      id: approval.id,
      kind: approval.kind,
      status: approval.status,
      description: approval.description,
      runId,
    };
  }

  pendingApprovals(): Approval[] {
    return this.engine.approvals.list("pending");
  }

  // ------------------------------------------------------------ following --

  async smokeTest(provider: ProviderId, startedBy: string | null): Promise<SmokeResult> {
    const engine = this.engine;
    const providerSettings = engine.requireProvider(provider);
    const run = engine.runs.create({
      origin: "manual",
      provider,
      prompt: SMOKE_SUMMARY,
      cwd: engine.runs.defaultCwd(),
      model: providerSettings.defaultModel,
      effort: "low",
      mode: "read_only",
      timeoutMs: 180_000,
      profile: "read_only",
      startedBy,
    });
    const finished = await engine.runs.execute(run.id, SMOKE_PROMPT, "read_only");
    const sawOk = engine.runs
      .eventsFor(run.id)
      .some(
        (e) =>
          (e.event.type === "assistant" || e.event.type === "result") &&
          JSON.stringify(e.event).includes("MORDOMO_OK"),
      );
    return { run: finished, passed: finished.status === "done" && sawOk };
  }

  get(runId: string): RunRecord | null {
    return this.engine.runs.get(runId);
  }

  list(filter: RunFilter = {}): RunRecord[] {
    return this.engine.runs.list(filter);
  }

  cancel(runId: string, reason?: string): Promise<boolean> {
    return this.engine.runs.cancel(runId, reason);
  }

  events(runId: string, afterId = 0): Array<{ id: number; event: RunEvent }> {
    return this.engine.runs.eventsFor(runId, afterId);
  }

  subscribe(runId: string, listener: (event: RunEvent, eventId?: number) => void): () => void {
    return this.engine.runs.onEvent(runId, listener);
  }

  wait(runId: string, options: WaitOptions = {}): Promise<RunRecord> {
    const { signal } = options;
    return new Promise<RunRecord>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      let unsubscribe: () => void = noop;
      const onAbort = () => {
        unsubscribe();
        reject(signal?.reason);
      };
      const finish = (record: RunRecord) => {
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
        resolve(record);
      };
      const check = (): boolean => {
        const record = this.engine.runs.get(runId);
        if (!record) {
          unsubscribe();
          signal?.removeEventListener("abort", onAbort);
          reject(new MordomoError(404, "Run not found"));
          return true;
        }
        if (TERMINAL_STATUSES.has(record.status)) {
          finish(record);
          return true;
        }
        return false;
      };
      // Listen before looking, so a run that ends in between is not missed.
      unsubscribe = this.engine.events.subscribe((event) => {
        if (event.type === "run.finished" && (event.payload as { runId?: string }).runId === runId) check();
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      check();
    });
  }
}

/** The id of the run parked for an approval: `gateWrite` always makes one when it makes an approval. */
function parkedRunId(runId: string | null): string {
  if (runId === null) throw new Error("a write parked for approval has no run");
  return runId;
}

import { events, isDeviceActor, requiresFullReview, type ApprovalKind } from "@mordomo/core";
import type { AppContext } from "./context.js";
import {
  launchPromptRun,
  launchSkillRun,
  requireProvider,
  type PromptRunInput,
  type SkillRunInput,
} from "./routes/common.js";

/**
 * The kinds a paired device holding `approve` may approve: a write run or a tool a run asked for. Everything else
 * (`expose_port` changes where the service listens, `connector_write`, ...) is the owner's, whatever scope the device
 * holds (.specs/features/escopos-dispositivo, door 3). Denying is open to every kind.
 */
const DEVICE_APPROVABLE_KINDS: ReadonlySet<ApprovalKind> = new Set(["write_run", "tool_use"]);

/**
 * Resolve an approval and apply its effect — the one code path behind the
 * Command Centre button, the Telegram buttons and anything else that may
 * decide later. Throws the store's 404/409 errors so HTTP callers keep their
 * status codes; chat callers wrap it into a line of text.
 */
export async function resolveApproval(
  ctx: AppContext,
  id: string,
  decision: "approved" | "denied",
  /** Who decided (`Approval.resolvedBy`): `owner`, `device:<id>`, `broker:<runId>`, `telegram:<userId>`. */
  resolvedBy: string | null,
  onError: (err: unknown, runId: string) => void,
  /**
   * The user's answers when the agent asked a question (`AskUserQuestion`):
   * question text → chosen answer. Kept on the approval, where the
   * permission tool reads them back into the tool's input.
   */
  answers?: Record<string, string>,
): Promise<{ id: string; kind: string; status: string; description: string; runId: string | null }> {
  // Sweep first: an approval past its TTL is expired here (cancelling the run
  // it gated), so resolving it answers 409 instead of silently acting on it.
  ctx.expireStaleApprovals();
  // Separation of duties, where the decision is applied (so the Command Centre, a device and any later caller meet
  // it): a device approves neither what it asked for itself nor a kind that is the owner's.
  if (decision === "approved" && isDeviceActor(resolvedBy)) {
    const asked = ctx.approvals.get(id);
    if (asked?.status === "pending") {
      if (!DEVICE_APPROVABLE_KINDS.has(asked.kind)) {
        throw Object.assign(new Error(`Only the owner can approve a request of kind "${asked.kind}"`), {
          statusCode: 403,
          code: "owner_only",
        });
      }
      if (asked.requestedBy === resolvedBy) {
        throw Object.assign(
          new Error(
            "A device cannot approve what it asked for itself; approve it on the desktop, from Telegram or from another device",
          ),
          { statusCode: 403, code: "self_approval" },
        );
      }
    }
  }
  // Approving a parked write whose provider was removed since would launch nothing:
  // refuse (400 unknown_provider) and leave the approval pending.
  if (decision === "approved") {
    const pending = ctx.approvals.get(id);
    const input = (pending?.payload as { input?: { provider?: unknown } } | undefined)?.input;
    if (pending?.status === "pending" && pending.kind === "write_run" && typeof input?.provider === "string")
      requireProvider(ctx, input.provider);
  }
  const approval = ctx.approvals.resolve(
    id,
    decision,
    decision === "approved" && answers && Object.keys(answers).length > 0 ? { answers } : undefined,
    resolvedBy,
  );
  if (!approval) throw Object.assign(new Error("Approval not found"), { statusCode: 404 });
  let runId: string | null = null;
  const gatedRunId = typeof approval.payload.runId === "string" ? approval.payload.runId : null;
  if (approval.status === "approved" && approval.kind === "expose_port") {
    ctx.settingsStore.update({ bindAddress: String(approval.payload.bindAddress ?? "127.0.0.1") });
  }
  if (approval.status === "approved" && approval.kind === "write_run") {
    const payload = approval.payload as { kind?: string; input?: unknown };
    if (payload.kind === "prompt" && payload.input)
      runId = launchPromptRun(ctx, payload.input as PromptRunInput, onError, gatedRunId).runId;
    else if (payload.kind === "skill" && payload.input)
      runId = launchSkillRun(ctx, payload.input as SkillRunInput, onError, gatedRunId).runId;
  }
  // Denied: the run parked in `waiting_approval` is cancelled, not left hanging.
  if (approval.status === "denied" && gatedRunId) {
    await ctx.runs.cancel(gatedRunId, "Write approval denied");
  }
  events.emit("approval.resolved", { id: approval.id, kind: approval.kind, status: approval.status, runId });
  return {
    id: approval.id,
    kind: approval.kind,
    status: approval.status,
    description: approval.description,
    runId,
  };
}

/** Chat-friendly wrapper: never throws, answers one line. Accepts an id prefix (≥ 8 chars) for typed commands. */
export async function resolveApprovalForChat(
  ctx: AppContext,
  idOrPrefix: string,
  decision: "approved" | "denied",
  resolvedBy: string,
): Promise<{ ok: boolean; message: string }> {
  const pending = ctx.approvals.list("pending");
  const matches = pending.filter(
    (a) => a.id === idOrPrefix || (idOrPrefix.length >= 8 && a.id.startsWith(idOrPrefix)),
  );
  if (matches.length === 0) return { ok: false, message: `No pending approval matches "${idOrPrefix}".` };
  if (matches.length > 1)
    return {
      ok: false,
      message: `"${idOrPrefix}" matches ${matches.length} approvals; send more characters.`,
    };
  // A write a paired device asked for, or a tool a run it started asks to use, is approved by someone who has read
  // all of it. A chat message carries a one-line label that cuts a long request, so chat can deny it but not approve
  // it: the owner reads the whole request in the Command Centre (Settings › Security, or the Resolver) and decides there.
  const asked = matches[0]!;
  if (decision === "approved" && requiresFullReview(asked)) {
    const who =
      typeof asked.payload.requestedByName === "string" ? asked.payload.requestedByName : "a paired device";
    const what = asked.kind === "tool_use" ? "a tool in a run it started" : "this write";
    return {
      ok: false,
      message: `${who} asked for ${what}. Read the whole request in the Command Centre (Settings › Security) and approve it there; you can deny it from here.`,
    };
  }
  try {
    const r = await resolveApproval(ctx, matches[0]!.id, decision, resolvedBy, () => undefined);
    const verb = r.status === "approved" ? "✅ Approved" : "⛔ Denied";
    return {
      ok: true,
      message: `${verb}: ${r.description.slice(0, 200)}${r.runId ? `\nRun ${r.runId.slice(0, 8)} started.` : ""}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
}

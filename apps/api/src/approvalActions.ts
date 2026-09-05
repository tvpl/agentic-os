import { events } from "@mordomo/core";
import type { AppContext } from "./context.js";
import { launchPromptRun, launchSkillRun, type PromptRunInput, type SkillRunInput } from "./routes/common.js";

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
  onError: (err: unknown, runId: string) => void,
): Promise<{ id: string; kind: string; status: string; description: string; runId: string | null }> {
  // Sweep first: an approval past its TTL is expired here (cancelling the run
  // it gated), so resolving it answers 409 instead of silently acting on it.
  ctx.expireStaleApprovals();
  const approval = ctx.approvals.resolve(id, decision);
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
  try {
    const r = await resolveApproval(ctx, matches[0]!.id, decision, () => undefined);
    const verb = r.status === "approved" ? "✅ Approved" : "⛔ Denied";
    return {
      ok: true,
      message: `${verb}: ${r.description.slice(0, 200)}${r.runId ? `\nRun ${r.runId.slice(0, 8)} started.` : ""}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
}

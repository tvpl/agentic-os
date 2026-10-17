import { requiresFullReview } from "@mordomo/core/internal";
import type { AppContext } from "./context.js";

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
    const r = await ctx.execution.resolveApproval(matches[0]!.id, decision, resolvedBy);
    const verb = r.status === "approved" ? "✅ Approved" : "⛔ Denied";
    return {
      ok: true,
      message: `${verb}: ${r.description.slice(0, 200)}${r.runId ? `\nRun ${r.runId.slice(0, 8)} started.` : ""}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
}

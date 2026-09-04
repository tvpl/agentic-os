/**
 * Pending write-run approvals, matched to the run that is waiting for them
 * (pure, tested). The API keeps approvals and runs in separate tables: an
 * approval created by the write gate carries the *input* of the run that was
 * not launched (`payload.kind` + `payload.input`), so the match is done on the
 * prompt / skill slug rather than on an id.
 */
import type { ApprovalRecord, RunRecord } from "../api";

export interface ApprovalTarget {
  kind: "prompt" | "skill" | "other";
  /** Skill slug for skill runs, else null. */
  skillSlug: string | null;
  /** Prompt for prompt runs, else null. */
  prompt: string | null;
  cwd: string | null;
  provider: string | null;
}

/** Read the launch input out of an approval payload without trusting its shape. */
export function approvalTarget(approval: ApprovalRecord): ApprovalTarget {
  const payload = (approval.payload ?? {}) as { kind?: unknown; input?: unknown };
  const input = (payload.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const kind = payload.kind === "prompt" || payload.kind === "skill" ? payload.kind : "other";
  return {
    kind,
    skillSlug: str(input.slug),
    prompt: str(input.prompt),
    cwd: str(input.cwd),
    provider: str(input.provider),
  };
}

/** Only the approvals a run view should offer to resolve inline. */
export function writeRunApprovals(approvals: readonly ApprovalRecord[] | undefined): ApprovalRecord[] {
  return (approvals ?? []).filter((a) => a.kind === "write_run" && a.status === "pending");
}

/**
 * The approval a given run is waiting for, if any: same skill slug, or a
 * prompt that starts with the run's stored summary (the summary is truncated
 * server-side). Runs that are not `waiting_approval` never match.
 */
export function approvalForRun(approvals: readonly ApprovalRecord[] | undefined, run: Pick<RunRecord, "status" | "skillSlug" | "promptSummary">): ApprovalRecord | null {
  if (run.status !== "waiting_approval") return null;
  for (const approval of writeRunApprovals(approvals)) {
    const target = approvalTarget(approval);
    if (run.skillSlug && target.skillSlug === run.skillSlug) return approval;
    if (!run.skillSlug && target.prompt && sharePrompt(target.prompt, run.promptSummary)) return approval;
  }
  return null;
}

function sharePrompt(a: string, b: string): boolean {
  const head = (s: string) => s.trim().slice(0, 60).toLowerCase();
  return head(a) === head(b);
}

/** One-line label for an approval row ("/skill-slug" or the first line of the prompt). */
export function approvalLabel(approval: ApprovalRecord, fallback: string): string {
  const target = approvalTarget(approval);
  if (target.skillSlug) return `/${target.skillSlug}`;
  const prompt = target.prompt ?? approval.description ?? "";
  const firstLine = prompt.split("\n")[0]?.trim() ?? "";
  return firstLine.slice(0, 120) || fallback;
}

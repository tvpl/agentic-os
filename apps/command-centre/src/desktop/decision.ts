/**
 * Decisions the agent is waiting on (refino items 5 and 38), in one place:
 * which approvals are pending and in what order, what each one asks in
 * words, and — for a file edit brokered mid-run — the change itself, so the
 * card can show a diff instead of a JSON blob. Pure and tested.
 */
import type { ApprovalRecord } from "../api";
import { approvalLabel, approvalTarget } from "../runs/approvals";
import { humanizeEvent, shortPath, toolInput, type Translate } from "../runs/humanize";

/** Pending first, the paused agent (a tool call) before a run not yet launched. */
export function pendingDecisions(approvals: readonly ApprovalRecord[] | undefined): ApprovalRecord[] {
  const rank = (a: ApprovalRecord) => (a.kind === "tool_use" ? 0 : a.kind === "write_run" ? 1 : 2);
  return (approvals ?? [])
    .filter((a) => a.status === "pending")
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

export interface EditPreview {
  file: string;
  /** `edit` replaces one string; `write` creates or overwrites the whole file. */
  kind: "edit" | "write";
  before: string;
  after: string;
}

/** The change a file tool wants to make, when the approval carries it. */
export function editPreview(approval: ApprovalRecord, cwd?: string | null): EditPreview | null {
  if (approval.kind !== "tool_use") return null;
  const tool = String(approval.payload?.toolName ?? "").toLowerCase();
  const input = (approval.payload?.input ?? {}) as Record<string, unknown>;
  const file =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : null;
  if (!file) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (tool === "edit" || tool === "str_replace_editor")
    return {
      file: shortPath(file, cwd),
      kind: "edit",
      before: s(input.old_string ?? input.old_str),
      after: s(input.new_string ?? input.new_str),
    };
  if (tool === "multiedit" && Array.isArray(input.edits)) {
    const edits = input.edits as Array<Record<string, unknown>>;
    return {
      file: shortPath(file, cwd),
      kind: "edit",
      before: edits.map((e) => s(e.old_string)).join("\n…\n"),
      after: edits.map((e) => s(e.new_string)).join("\n…\n"),
    };
  }
  if (tool === "write" || tool === "write_file" || tool === "create_file")
    return {
      file: shortPath(file, cwd),
      kind: "write",
      before: "",
      after: s(input.content ?? input.contents),
    };
  return null;
}

export interface DecisionText {
  /** "editei src/x.ts" / "/digest" — what the agent wants to do. */
  headline: string;
  subject: string | null;
  /** Where: the run's directory, when known. */
  where: string | null;
  /** The run this decision pauses, for "open the trace". */
  runId: string | null;
}

export function describeDecision(approval: ApprovalRecord, t: Translate, fallback: string): DecisionText {
  if (approval.kind === "tool_use") {
    const runId = typeof approval.payload?.runId === "string" ? approval.payload.runId : null;
    const human = humanizeEvent(
      {
        type: "tool_use",
        ts: approval.createdAt,
        tool: String(approval.payload?.toolName ?? "tool"),
        detail: JSON.stringify(approval.payload?.input ?? {}),
      },
      t,
    );
    return { headline: human?.text ?? fallback, subject: human?.subject ?? null, where: null, runId };
  }
  const target = approvalTarget(approval);
  return { headline: approvalLabel(approval, fallback), subject: null, where: target.cwd, runId: null };
}

/** Lines of a tiny two-sided diff: removed first, then added; long sides are cut. */
export function previewLines(p: EditPreview, max = 12): Array<{ kind: "del" | "add"; text: string }> {
  const cut = (text: string) => {
    const lines = text.split("\n");
    return lines.length > max ? [...lines.slice(0, max - 1), `… +${lines.length - max + 1}`] : lines;
  };
  const out: Array<{ kind: "del" | "add"; text: string }> = [];
  if (p.before) for (const l of cut(p.before)) out.push({ kind: "del", text: l });
  if (p.after) for (const l of cut(p.after)) out.push({ kind: "add", text: l });
  return out;
}

/** Re-exported so the dock has one import. */
export { toolInput };

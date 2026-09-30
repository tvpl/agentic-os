/**
 * Questions the agent asks (Claude Code's `AskUserQuestion`). They arrive
 * as a tool approval; answering is approving with the answers attached
 * (`POST /api/approvals/:id/resolve { decision, answers }`), which the
 * permission tool hands back to the agent in the tool's input.
 */
import type { ApprovalRecord } from "../api";

export interface QuestionOption {
  label: string;
  description?: string;
}
export interface AgentQuestion {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export function isQuestion(a: Pick<ApprovalRecord, "kind" | "payload"> | undefined | null): boolean {
  return (
    !!a && a.kind === "tool_use" && String(a.payload?.toolName ?? "").toLowerCase() === "askuserquestion"
  );
}

/** The questions an approval carries, or `null` when it is not a question. */
export function questionsOf(
  a: Pick<ApprovalRecord, "kind" | "payload"> | undefined | null,
): AgentQuestion[] | null {
  if (!a || !isQuestion(a)) return null;
  const input = (a.payload?.input ?? {}) as { questions?: unknown };
  if (!Array.isArray(input.questions)) return [];
  const out: AgentQuestion[] = [];
  for (const raw of input.questions) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    if (typeof q.question !== "string" || !q.question.trim()) continue;
    const options = Array.isArray(q.options)
      ? q.options
          .map((o) => {
            if (typeof o === "string") return { label: o };
            if (o && typeof o === "object" && typeof (o as { label?: unknown }).label === "string")
              return {
                label: (o as { label: string }).label,
                description:
                  typeof (o as { description?: unknown }).description === "string"
                    ? (o as { description: string }).description
                    : undefined,
              };
            return null;
          })
          .filter((o): o is QuestionOption => o !== null)
      : [];
    out.push({
      question: q.question,
      header: typeof q.header === "string" ? q.header : undefined,
      options,
      multiSelect: q.multiSelect === true,
    });
  }
  return out;
}

/**
 * The answers the agent receives: question text → answer. A multi-select
 * joins its picks with ", "; a written answer wins over the picks when given.
 */
export function answersFor(
  questions: readonly AgentQuestion[],
  picks: Readonly<Record<string, readonly string[]>>,
  written: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const own = (written[q.question] ?? "").trim();
    const chosen = picks[q.question] ?? [];
    const answer = own || chosen.join(", ");
    if (answer) out[q.question] = answer;
  }
  return out;
}

/** Every question has an answer. */
export function complete(
  questions: readonly AgentQuestion[],
  answers: Readonly<Record<string, string>>,
): boolean {
  return questions.length > 0 && questions.every((q) => (answers[q.question] ?? "").length > 0);
}

/**
 * A failure with a cause and a way out (refino item 43). The backend already
 * classifies (`RunFailure.code`); this turns the code into the sentence a
 * person reads and the one action that clears it. Pure and tested.
 */
import type { TKey } from "../i18n";

export type FixAction =
  | { kind: "login"; command: string | null }
  | { kind: "budget" }
  | { kind: "approvals" }
  | { kind: "retry" }
  | { kind: "provider" }
  | { kind: "none" };

export interface FailureFix {
  causeKey: TKey;
  action: FixAction;
}

const LOGIN: Record<string, string> = {
  claude: "claude auth login",
  codex: "codex login",
  cursor: "cursor login",
};

export function failureFix(
  failure: { code: string; recoverable?: boolean } | null | undefined,
  provider: string | null | undefined,
  status?: string,
): FailureFix | null {
  const code =
    failure?.code ?? (status === "timed_out" ? "timeout" : status === "cancelled" ? "cancelled" : null);
  if (!code) return null;
  switch (code) {
    case "authentication":
      return {
        causeKey: "runs.fix.auth",
        action: { kind: "login", command: provider ? (LOGIN[provider] ?? null) : null },
      };
    case "budget":
      return { causeKey: "runs.fix.budget", action: { kind: "budget" } };
    case "permission":
      return { causeKey: "runs.fix.permission", action: { kind: "approvals" } };
    case "timeout":
      return { causeKey: "runs.fix.timeout", action: { kind: "retry" } };
    case "provider":
      return { causeKey: "runs.fix.provider", action: { kind: "provider" } };
    case "cancelled":
    case "interrupted":
      return { causeKey: "runs.fix.cancelled", action: { kind: "retry" } };
    default:
      return {
        causeKey: "runs.fix.unknown",
        action: failure?.recoverable === false ? { kind: "none" } : { kind: "retry" },
      };
  }
}

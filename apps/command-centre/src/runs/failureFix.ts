/**
 * A failure with a cause and a way out (refino item 43). The backend already
 * classifies (`RunFailure.code`); this turns the code into the sentence a
 * person reads and the one action that clears it. Pure and tested.
 */
import type { ProviderSnapshot } from "../api";
import type { TKey } from "../i18n";
import { loginHint } from "./authRecovery";

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

export function failureFix(
  failure: { code: string; recoverable?: boolean } | null | undefined,
  provider: string | null | undefined,
  status?: string,
  /** The provider snapshots: where the login command comes from (`loginCommand`). */
  snapshots?: readonly Pick<ProviderSnapshot, "id" | "loginCommand">[],
): FailureFix | null {
  const code =
    failure?.code ?? (status === "timed_out" ? "timeout" : status === "cancelled" ? "cancelled" : null);
  if (!code) return null;
  switch (code) {
    case "authentication":
      return {
        causeKey: "runs.fix.auth",
        action: { kind: "login", command: loginHint(provider, snapshots) },
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

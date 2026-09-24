import type { ProviderSnapshot } from "../api";

export type ProviderProblem = "not_installed" | "login_required" | "unverified" | null;

/** What stands between this provider and a successful run, if anything definite. */
export function providerProblem(p: Pick<ProviderSnapshot, "health">): ProviderProblem {
  if (!p.health.installed) return "not_installed";
  if (p.health.authenticated === false) return "login_required";
  if (p.health.ok) return null;
  return "unverified";
}

export type GateReason = "no_provider" | "not_ready" | null;

/**
 * Should the OS ask the user to configure an AI before anything else?
 * Only definite problems block (nothing installed, login refused): an
 * unverified login is left to the smoke test, so a working setup is never
 * held hostage by a CLI that cannot report its state.
 */
export function gateReason(providers: ProviderSnapshot[] | undefined): GateReason {
  if (!providers) return null;
  const enabled = providers.filter((p) => p.enabled);
  if (enabled.length === 0) return "no_provider";
  if (enabled.some((p) => p.health.ok)) return null;
  const definite = enabled.filter((p) => {
    const problem = providerProblem(p);
    return problem === "not_installed" || problem === "login_required";
  });
  return definite.length === enabled.length ? "not_ready" : null;
}

export const PROVIDER_GATE_EVENT = "mordomo:provider-gate";
export const PROVIDER_GATE_SKIP_KEY = "mordomo.providerGate.skipped.v1";

export function providerGateSkipped(): boolean {
  try {
    return sessionStorage.getItem(PROVIDER_GATE_SKIP_KEY) === "1";
  } catch {
    return false;
  }
}
export function skipProviderGate(): void {
  try {
    sessionStorage.setItem(PROVIDER_GATE_SKIP_KEY, "1");
  } catch {
    /* storage disabled: the gate just closes for this render */
  }
}

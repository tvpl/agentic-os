import { describe, expect, it } from "vitest";
import { gateReason, providerProblem } from "./providerReadiness";
import type { ProviderSnapshot } from "../api";

const snap = (
  id: ProviderSnapshot["id"],
  enabled: boolean,
  health: Partial<ProviderSnapshot["health"]>,
): ProviderSnapshot =>
  ({
    id,
    enabled,
    isDefault: id === "claude",
    defaultModel: null,
    defaultEffort: "default",
    health: {
      ok: false,
      installed: true,
      authenticated: "unknown",
      version: "1",
      detail: "",
      checkedAt: 0,
      ...health,
    },
  }) as ProviderSnapshot;

describe("provider readiness", () => {
  it("names the definite problems and leaves unverified alone", () => {
    expect(providerProblem(snap("claude", true, { installed: false }))).toBe("not_installed");
    expect(providerProblem(snap("claude", true, { authenticated: false }))).toBe("login_required");
    expect(providerProblem(snap("claude", true, { authenticated: "unknown" }))).toBe("unverified");
    expect(providerProblem(snap("claude", true, { ok: true, authenticated: true }))).toBeNull();
  });
  it("gates only when every enabled provider definitely cannot run", () => {
    expect(gateReason(undefined)).toBeNull();
    expect(gateReason([snap("claude", false, {}), snap("codex", false, {})])).toBe("no_provider");
    expect(
      gateReason([snap("claude", true, { authenticated: false }), snap("codex", true, { installed: false })]),
    ).toBe("not_ready");
    // An unverified CLI (e.g. one that cannot report its login) is not a reason to block.
    expect(gateReason([snap("claude", true, { authenticated: "unknown" })])).toBeNull();
    expect(gateReason([snap("claude", true, { authenticated: false }), snap("codex", true, {})])).toBeNull();
    expect(
      gateReason([
        snap("claude", true, { ok: true, authenticated: true }),
        snap("codex", true, { installed: false }),
      ]),
    ).toBeNull();
  });
});

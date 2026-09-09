import { expect, it } from "vitest";
import { authRecovery } from "./authRecovery";
it("offers provider-specific login for expired authentication only", () => {
  expect(
    authRecovery("claude", "Failed to authenticate: OAuth session expired and could not be refreshed"),
  ).toBe("claude auth login");
  expect(authRecovery("codex", "Not logged in")).toBe("codex login");
  expect(authRecovery("claude", "Permission denied writing file")).toBeNull();
  expect(authRecovery("unknown", "Not logged in")).toBeNull();
});

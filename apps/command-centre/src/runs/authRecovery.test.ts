import { expect, it } from "vitest";
import { authRecovery, loginHint } from "./authRecovery";
import { failureFix } from "./failureFix";

const snapshots = [
  { id: "claude", loginCommand: "claude auth login" },
  { id: "codex", loginCommand: "codex login" },
];

it("offers provider-specific login for expired authentication only", () => {
  expect(
    authRecovery(
      "claude",
      "Failed to authenticate: OAuth session expired and could not be refreshed",
      snapshots,
    ),
  ).toBe("claude auth login");
  expect(authRecovery("codex", "Not logged in", snapshots)).toBe("codex login");
  expect(authRecovery("claude", "Permission denied writing file", snapshots)).toBeNull();
  expect(authRecovery("unknown", "Not logged in", snapshots)).toBeNull();
});

it("C20 the login command comes from the snapshot", () => {
  const acme = [...snapshots, { id: "acme", loginCommand: "acme login" }];
  expect(loginHint("acme", acme)).toBe("acme login");
  expect(authRecovery("acme", "Not logged in", acme)).toBe("acme login");
  expect(failureFix({ code: "authentication" }, "acme", "failed", acme)?.action).toEqual({
    kind: "login",
    command: "acme login",
  });
  // No snapshot for the provider (or none loaded yet): no command rather than a guess.
  expect(loginHint("acme", snapshots)).toBeNull();
  expect(loginHint("acme", undefined)).toBeNull();
});

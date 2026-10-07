import { expect, it } from "vitest";
import { providerOptions } from "./options";

it("C19 provider options come from the snapshots", () => {
  const snapshots = [{ id: "claude" }, { id: "cursor" }, { id: "codex" }, { id: "acme" }];
  expect(providerOptions(snapshots)).toEqual(["claude", "cursor", "codex", "acme"]);
  expect(providerOptions([{ id: "acme" }, { id: "claude" }])).toEqual(["acme", "claude"]);
  // Before the snapshots load there is nothing to offer, never a built-in guess.
  expect(providerOptions(undefined)).toEqual([]);
});

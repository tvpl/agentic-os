import { describe, expect, it, vi } from "vitest";
import type * as Policy from "@mordomo/contracts/policy";

// C15 (.specs/features/contratos): the UI asks the contract, it does not re-decide.
// With `writeDecision` swapped for a stub, every answer must follow the stub.
const decide = vi.hoisted(() => vi.fn());
vi.mock("@mordomo/contracts/policy", async (importOriginal) => ({
  ...(await importOriginal<typeof Policy>()),
  writeDecision: decide,
}));

import { writePolicyFor } from "./policy";

describe("writePolicyFor delegates to writeDecision", () => {
  it("C15 every known profile follows the contract's manual-run decision", () => {
    const profiles = ["read_only", "review_before_write", "controlled_write", "approved_automation"];
    const map = { allow: "allowed", approval: "approval", refuse: "refused" } as const;
    for (const decision of ["allow", "approval", "refuse"] as const) {
      decide.mockReset().mockReturnValue(decision);
      for (const profile of profiles) expect(writePolicyFor(profile), profile).toBe(map[decision]);
      expect(decide.mock.calls).toEqual(profiles.map((p) => [p, "manual"]));
    }
  });
});

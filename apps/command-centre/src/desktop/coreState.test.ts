import { describe, expect, it } from "vitest";
import { baseCoreState } from "./coreState";

describe("baseCoreState", () => {
  it("uses the most actionable persistent state", () => {
    expect(baseCoreState([])).toBe("idle");
    expect(baseCoreState([{ status: "done" }, { status: "queued" }])).toBe("queued");
    expect(baseCoreState([{ status: "queued" }, { status: "waiting_approval" }])).toBe("waiting");
    expect(baseCoreState([{ status: "waiting_approval" }, { status: "running" }])).toBe("thinking");
  });
});

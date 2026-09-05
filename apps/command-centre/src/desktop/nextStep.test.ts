import { describe, expect, it } from "vitest";
import { nextStep } from "./nextStep";

describe("nextStep", () => {
  const done = { folders: 1, runs: 3, routinesEnabled: 1, budgetUsd: 5, connectorsConfigured: 1 };
  it("walks the 7-day plan in order and ends when everything is in place", () => {
    expect(nextStep({ ...done, folders: 0, runs: 0 }, new Set())).toBe("folder");
    expect(nextStep({ ...done, runs: 0 }, new Set())).toBe("run");
    expect(nextStep({ ...done, routinesEnabled: 0 }, new Set())).toBe("routine");
    expect(nextStep({ ...done, budgetUsd: 0 }, new Set())).toBe("budget");
    expect(nextStep({ ...done, connectorsConfigured: 0 }, new Set())).toBe("connector");
    expect(nextStep(done, new Set())).toBeNull();
  });
  it("skips dismissed steps", () => {
    expect(nextStep({ ...done, folders: 0, runs: 0 }, new Set(["folder"]))).toBe("run");
  });
});

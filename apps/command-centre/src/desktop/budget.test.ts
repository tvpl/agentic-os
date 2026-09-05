import { describe, expect, it } from "vitest";
import { budgetState } from "./budget";

describe("budgetState", () => {
  it("is off without a budget", () => {
    expect(budgetState(0, 3).tone).toBe("off");
    expect(budgetState(undefined, 3).tone).toBe("off");
  });
  it("warns at 80 % and is over at 100 %", () => {
    expect(budgetState(10, 5).tone).toBe("ok");
    expect(budgetState(10, 8).tone).toBe("warn");
    expect(budgetState(10, 10).tone).toBe("over");
    expect(budgetState(10, 40).ratio).toBe(1.5);
  });
  it("ignores garbage", () => {
    expect(budgetState(Number.NaN, Number.NaN)).toEqual({ budgetUsd: 0, spentUsd: 0, ratio: 0, tone: "off" });
  });
});

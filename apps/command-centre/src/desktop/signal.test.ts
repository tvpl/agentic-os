/**
 * The signal rules decide what lights up on a desktop that is meant to stay
 * quiet, so the boundaries are pinned here rather than left to each widget.
 */
import { describe, expect, it } from "vitest";
import {
  attentionItems,
  attentionSignal,
  costSignal,
  isLit,
  pulseSignal,
  routinesSignal,
  runsSignal,
} from "./signal";

describe("what lights up", () => {
  it("lights only warn and above — the rule the quiet desktop rests on", () => {
    expect(isLit("idle")).toBe(false);
    expect(isLit("info")).toBe(false);
    expect(isLit("warn")).toBe(true);
    expect(isLit("critical")).toBe(true);
  });
});

describe("runs and routines", () => {
  it("treats work in flight as information, never an alarm", () => {
    expect(runsSignal(0).level).toBe("idle");
    expect(runsSignal(3).level).toBe("info");
  });

  it("warns only for routines that were due and did not fire", () => {
    expect(routinesSignal(0, 0).level).toBe("idle");
    expect(routinesSignal(3, 3).level).toBe("info");
    expect(routinesSignal(1, 3)).toMatchObject({ level: "warn", value: "1/3" });
    expect(routinesSignal(0, 3).level).toBe("critical");
  });
});

describe("pulse", () => {
  it("is idle with no runs rather than a perfect score", () => {
    expect(pulseSignal(0, 0)).toMatchObject({ level: "idle", value: "—" });
  });

  it("warns below half and alarms below a quarter", () => {
    expect(pulseSignal(9, 10).level).toBe("info");
    expect(pulseSignal(5, 10).level).toBe("info");
    expect(pulseSignal(4, 10).level).toBe("warn");
    expect(pulseSignal(3, 13).level).toBe("critical"); // the 23 % from the audit
    expect(pulseSignal(3, 13).value).toBe("23%");
  });

  it("clamps impossible inputs instead of rendering them", () => {
    expect(pulseSignal(20, 10).value).toBe("100%");
    expect(pulseSignal(-5, 10).value).toBe("0%");
  });
});

describe("attention", () => {
  it("stays dark at zero and lights from the first item", () => {
    expect(attentionSignal(0).level).toBe("idle");
    expect(attentionSignal(1).level).toBe("warn");
    expect(attentionSignal(4).level).toBe("warn");
    expect(attentionSignal(5).level).toBe("critical");
  });

  it("writes a singular label for one item", () => {
    expect(attentionSignal(1).label).toContain("1 item ");
    expect(attentionSignal(3).label).toContain("3 items");
  });
});

describe("attentionItems", () => {
  const none = { failures: 0, unhealthyRoutines: 0, approvals: 0, budgetHot: false };

  it("sums the four sources the widget lists", () => {
    expect(attentionItems(none)).toBe(0);
    expect(attentionItems({ ...none, failures: 2 })).toBe(2);
    expect(attentionItems({ ...none, failures: 2, unhealthyRoutines: 1, approvals: 1 })).toBe(4);
  });

  it("counts a hot budget as exactly one item, not as its overspend", () => {
    expect(attentionItems({ ...none, budgetHot: true })).toBe(1);
    expect(attentionItems({ ...none, failures: 1, budgetHot: true })).toBe(2);
  });

  it("ignores negative and fractional garbage", () => {
    expect(attentionItems({ ...none, failures: -3, approvals: 1.7 })).toBe(1);
  });
});

describe("cost", () => {
  it("is idle when no budget is configured", () => {
    expect(costSignal(undefined, 5).level).toBe("idle");
    expect(costSignal(0, 5).level).toBe("idle");
  });

  it("follows the existing budget thresholds", () => {
    expect(costSignal(3, 0.08).level).toBe("info");
    expect(costSignal(3, 2.4).level).toBe("warn"); // exactly 80 %
    expect(costSignal(3, 3).level).toBe("critical");
    expect(costSignal(3, 0.08).value).toBe("3%");
  });
});

describe("every signal fits a pod", () => {
  it("never returns a sentence as the value", () => {
    const values = [
      pulseSignal(3, 13),
      attentionSignal(12),
      costSignal(3, 2.9),
      runsSignal(7),
      routinesSignal(1, 3),
    ];
    for (const s of values) {
      expect(s.value.length, `"${s.value}" is too long for a glyph`).toBeLessThanOrEqual(5);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

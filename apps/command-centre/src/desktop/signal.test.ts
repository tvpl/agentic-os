/**
 * The signal rules decide what lights up on a desktop that is meant to stay
 * quiet, so the boundaries are pinned here rather than left to each widget.
 */
import { describe, expect, it } from "vitest";
import { dictionaries, tf } from "../i18n";
import {
  ATTENTION_FRESH_MS,
  attentionItems,
  attentionSignal,
  costSignal,
  healthSignal,
  isFreshFailure,
  isLit,
  pulseSignal,
  routinesSignal,
  runsSignal,
  withLabel,
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
  const none = { failures: 0, unhealthyRoutines: 0, approvals: 0, budgetHot: false };

  it("stays dark at zero and lights from the first fresh item", () => {
    expect(attentionSignal(none).level).toBe("idle");
    expect(attentionSignal({ ...none, failures: 1 }).level).toBe("warn");
    expect(attentionSignal({ ...none, failures: 20 }).level).toBe("warn");
  });

  it("is red only for what a human has to decide", () => {
    expect(attentionSignal({ ...none, failures: 20, unhealthyRoutines: 3 }).level).toBe("warn");
    expect(attentionSignal({ ...none, approvals: 1 }).level).toBe("critical");
    expect(attentionSignal({ ...none, budgetHot: true }).level).toBe("warn");
    expect(attentionSignal({ ...none, budgetHot: true, budgetOver: true }).level).toBe("critical");
  });

  it("keeps stale failures off the counter and out of the colour", () => {
    const s = attentionSignal({ ...none, staleFailures: 20 });
    expect(s).toMatchObject({
      level: "idle",
      value: "0",
      count: 0,
      labelKey: "desktop.signal.attention.stale",
    });
    expect(s.labelVars).toEqual({ n: 20 });
  });

  it("still accepts a bare count for callers that only have one", () => {
    expect(attentionSignal(3)).toMatchObject({ level: "warn", value: "3", count: 3 });
  });

  it("writes a singular label for one item, in both languages", () => {
    const one = attentionSignal({ ...none, failures: 1 });
    expect(withLabel(one, (k, v) => tf("en", k, v)).label).toBe("1 item worth a look");
    expect(withLabel(one, (k, v) => tf("pt-BR", k, v)).label).toBe("1 item para olhar");
    const three = attentionSignal({ ...none, failures: 3 });
    expect(withLabel(three, (k, v) => tf("pt-BR", k, v)).label).toBe("3 itens para olhar");
  });

  it("ages a failure out after a day", () => {
    const now = 10 * ATTENTION_FRESH_MS;
    expect(isFreshFailure(now - 1000, now)).toBe(true);
    expect(isFreshFailure(now - ATTENTION_FRESH_MS + 1, now)).toBe(true);
    expect(isFreshFailure(now - ATTENTION_FRESH_MS, now)).toBe(false);
    expect(isFreshFailure(null, now)).toBe(false);
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
    expect(attentionItems({ ...none, budgetHot: true, budgetOver: true })).toBe(1);
  });

  it("ignores negative and fractional garbage, and stale failures", () => {
    expect(attentionItems({ ...none, failures: -3, approvals: 1.7 })).toBe(1);
    expect(attentionItems({ ...none, staleFailures: 9 })).toBe(0);
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
      expect(s.labelKey in dictionaries.en, `${s.labelKey} is not a key`).toBe(true);
      expect(s.labelKey in dictionaries["pt-BR"], `${s.labelKey} is not translated`).toBe(true);
    }
  });

  it("never leaves an English tooltip on a Portuguese desktop", () => {
    const pt = (k: Parameters<typeof tf>[1], v?: Parameters<typeof tf>[2]) => tf("pt-BR", k, v);
    expect(withLabel(runsSignal(0), pt).label).toBe("nada executando");
    expect(withLabel(runsSignal(1), pt).label).toBe("1 execução em andamento");
    expect(withLabel(runsSignal(2), pt).label).toBe("2 execuções em andamento");
    expect(withLabel(costSignal(3, 0.08), pt).label).toBe("US$ 0.08 de 3.00 hoje");
    const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    expect(withLabel(costSignal(3, 0.08, brl), pt).label).toBe("US$ 0,08 de 3,00 hoje");
  });
});

describe("health (refino item 58)", () => {
  it("warns on a failed check or a newer version, never red", () => {
    expect(
      healthSignal({ ok: 5, warn: 1, fail: 0 }, { status: { upToDate: true, latest: "1.0.0" } }).level,
    ).toBe("idle");
    expect(healthSignal({ ok: 5, warn: 1, fail: 2 }, undefined)).toMatchObject({ level: "warn", value: "2" });
    expect(
      healthSignal({ ok: 5, warn: 0, fail: 0 }, { status: { upToDate: false, latest: "1.1.0" } }),
    ).toMatchObject({ level: "warn", value: "↑" });
    expect(healthSignal(undefined, undefined).level).toBe("idle");
  });
});

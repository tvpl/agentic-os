/**
 * What survives of the old grid module: identity and ordering, plus the one
 * rule that decides whether the desktop shows windows at all.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_STAGE_H,
  STACK_BREAKPOINT,
  WIDGET_ORDER,
  baseId,
  isWidgetId,
  nextDuplicateId,
  orderedIds,
  shouldStack,
} from "./defaultLayout";

describe("widget identity", () => {
  it("maps a duplicate id back to the widget it came from", () => {
    expect(baseId("today:2")).toBe("today");
    expect(baseId("today")).toBe("today");
    expect(baseId("a:b:c")).toBe("a");
  });

  it("recognises only registered ids", () => {
    expect(isWidgetId("today")).toBe(true);
    expect(isWidgetId("today:2")).toBe(false);
    expect(isWidgetId("nope")).toBe(false);
  });

  it("finds the next free duplicate slot", () => {
    expect(nextDuplicateId({}, "today")).toBe("today:2");
    expect(nextDuplicateId({ "today:2": {} }, "today")).toBe("today:3");
    expect(nextDuplicateId({ "today:2": {}, "today:3": {} }, "today")).toBe("today:4");
  });
});

describe("render order", () => {
  it("follows the registry and keeps a duplicate next to its base", () => {
    const ordered = orderedIds(["pulse", "today:2", "now", "today"]);
    expect(ordered.indexOf("now")).toBeLessThan(ordered.indexOf("today"));
    expect(ordered.indexOf("today")).toBeLessThan(ordered.indexOf("today:2"));
    expect(ordered.indexOf("today:2")).toBeLessThan(ordered.indexOf("pulse"));
  });

  it("puts unknown ids last instead of dropping them", () => {
    expect(orderedIds(["ghost", "now"])).toEqual(["now", "ghost"]);
  });
});

describe("when windows are not worth showing", () => {
  it("stacks on a narrow or short viewport", () => {
    expect(shouldStack(1440, 900)).toBe(false);
    expect(shouldStack(1280, 720)).toBe(false);
    expect(shouldStack(STACK_BREAKPOINT - 1, 900)).toBe(true);
    expect(shouldStack(1400, MIN_STAGE_H - 1)).toBe(true);
    expect(shouldStack(390, 844)).toBe(true);
  });
});

describe("the registry order", () => {
  it("has no duplicates", () => {
    expect(new Set(WIDGET_ORDER).size).toBe(WIDGET_ORDER.length);
  });
});

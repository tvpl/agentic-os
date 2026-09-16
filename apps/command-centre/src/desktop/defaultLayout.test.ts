/**
 * What survives of the old grid module: identity and ordering, plus the one
 * rule that decides whether the desktop shows windows at all.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_STAGE_H,
  STACK_BREAKPOINT,
  WIDGET_ORDER,
  isWidgetId,
  orderedIds,
  shouldStack,
} from "./defaultLayout";

describe("panel identity", () => {
  it("recognises only registered ids", () => {
    expect(isWidgetId("pulse")).toBe(true);
    expect(isWidgetId("today")).toBe(false);
    expect(isWidgetId("nope")).toBe(false);
  });
});

describe("render order", () => {
  it("follows the registry, then everything else by id", () => {
    const ordered = orderedIds(["pulse", "doc:/b.md", "now", "doc:/a.md"]);
    expect(ordered).toEqual(["now", "pulse", "doc:/a.md", "doc:/b.md"]);
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

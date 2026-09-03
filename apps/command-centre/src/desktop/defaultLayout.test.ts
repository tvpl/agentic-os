import { describe, expect, it } from "vitest";
import { COLS, DEFAULT_LAYOUT, MIN_ROWS, WIDGET_ORDER, clampBox, computeRows, layoutsEqual, normalizeLayout, overlaps } from "./defaultLayout";

describe("desktop layout maths", () => {
  it("default layout fits inside the minimum grid (1024x768 regression)", () => {
    for (const id of WIDGET_ORDER) {
      const b = DEFAULT_LAYOUT[id]!;
      expect(b.x + b.w).toBeLessThanOrEqual(COLS);
      expect(b.y + b.h).toBeLessThanOrEqual(MIN_ROWS);
    }
  });

  it("computeRows never goes below MIN_ROWS", () => {
    expect(computeRows(100)).toBe(MIN_ROWS);
    expect(computeRows(2000)).toBeGreaterThan(MIN_ROWS);
  });

  it("clampBox pulls an off-grid persisted box back inside", () => {
    const b = clampBox({ x: 40, y: 99, w: 50, h: 1 }, DEFAULT_LAYOUT.deck!, 18);
    expect(b.x + b.w).toBeLessThanOrEqual(COLS);
    expect(b.y + b.h).toBeLessThanOrEqual(18);
    expect(b.w).toBeLessThanOrEqual(COLS);
  });

  it("normalizeLayout drops unknown ids, keeps visibility and resolves overlaps", () => {
    const out = normalizeLayout({ ghost: { x: 0, y: 0, w: 4, h: 4 }, today: { x: 0, y: 0, w: 5, h: 6, visible: true } }, 18);
    expect(Object.keys(out)).toEqual([...WIDGET_ORDER]);
    const visible = WIDGET_ORDER.filter((id) => out[id]!.visible).map((id) => out[id]!);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) expect(overlaps(visible[i]!, visible[j]!)).toBe(false);
  });

  it("layoutsEqual is structural", () => {
    expect(layoutsEqual(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT })).toBe(true);
    expect(layoutsEqual(DEFAULT_LAYOUT, { ...DEFAULT_LAYOUT, deck: { ...DEFAULT_LAYOUT.deck!, x: 1 } })).toBe(false);
  });
});

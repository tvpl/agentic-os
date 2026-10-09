import { describe, expect, it } from "vitest";
import { boxAt, groupPresence, groupPx, labelPx, overlaps, placeLabels, type LabelAsk } from "./brainLabels";

const bounds = { x: 0, y: 0, w: 800, h: 600 };
const ask = (id: number, x: number, y: number, pri = 3, w = 80): LabelAsk => ({
  id,
  pri,
  x,
  y,
  r: 4,
  w,
  h: 14,
});

describe("label sizes", () => {
  it("stay between 12 px and a cap, whatever the distance", () => {
    expect(labelPx(3, 0.1)).toBe(12);
    expect(labelPx(3, 50)).toBe(12.5);
    expect(labelPx(0, 50)).toBe(15);
    expect(labelPx(1, 50)).toBe(13.5);
    expect(labelPx(0, 1.5)).toBeGreaterThan(labelPx(0, 0.5));
    expect(groupPx(0)).toBe(12);
    expect(groupPx(100000)).toBe(13);
  });

  it("area names fade out once their cloud fills the view, or the eye is inside it", () => {
    expect(groupPresence(0.2)).toBe(1);
    expect(groupPresence(0.5, 3)).toBe(1);
    expect(groupPresence(1.5)).toBe(0);
    expect(groupPresence(1.05)).toBeGreaterThan(0);
    expect(groupPresence(1.05)).toBeLessThan(1);
    expect(groupPresence(0.3, 0.8)).toBe(0);
    expect(groupPresence(0.3, 1.4)).toBeGreaterThan(0);
  });
});

describe("placeLabels", () => {
  it("never overlaps two labels, and prefers below the star", () => {
    const asks = [ask(1, 200, 200), ask(2, 205, 204), ask(3, 210, 208), ask(4, 600, 300)];
    const out = placeLabels(asks, { blocked: [], bounds });
    expect(out.find((p) => p.id === 4)!.side).toBe("below");
    for (const a of out) for (const b of out) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
    // the crowded ones moved to other sides rather than piling up
    expect(new Set(out.filter((p) => p.id <= 3).map((p) => p.side)).size).toBeGreaterThan(1);
  });

  it("goes in priority order: the hovered star wins its place", () => {
    const asks = [ask(1, 200, 200, 3, 300), ask(2, 202, 200, -1, 300)];
    const out = placeLabels(asks, { blocked: [], bounds });
    expect(out[0]!.id).toBe(2);
    expect(out[0]!.side).toBe("below");
  });

  it("keeps words off the floating interface and inside the free area", () => {
    const blocked = [{ x: 150, y: 190, w: 200, h: 60 }];
    const out = placeLabels([ask(1, 200, 200), ask(2, 795, 300)], { blocked, bounds });
    for (const p of out) {
      expect(overlaps(p.box, blocked[0]!)).toBe(false);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(800);
    }
    expect(out.find((p) => p.id === 2)?.side).toBe("left");
  });

  it("drops what does not fit, but forces the hovered one inside the bounds", () => {
    const blocked = [{ x: 0, y: 0, w: 800, h: 600 }];
    expect(placeLabels([ask(1, 400, 300)], { blocked, bounds })).toHaveLength(0);
    const forced = placeLabels([ask(1, 790, 590, -1)], { blocked: [], bounds });
    expect(forced).toHaveLength(1);
    expect(forced[0]!.box.x + forced[0]!.box.w).toBeLessThanOrEqual(800);
    expect(forced[0]!.box.y + forced[0]!.box.h).toBeLessThanOrEqual(600);
  });

  it("respects the cap", () => {
    const asks = Array.from({ length: 30 }, (_, i) =>
      ask(i, 40 + (i % 6) * 120, 40 + Math.floor(i / 6) * 110),
    );
    expect(placeLabels(asks, { blocked: [], bounds, max: 5 })).toHaveLength(5);
  });

  it("boxes sit beside the star with a gap", () => {
    const b = boxAt({ x: 100, y: 100, r: 10, w: 40, h: 12 }, "right", 5);
    expect(b.x).toBe(115);
    expect(b.y).toBe(94);
  });
});

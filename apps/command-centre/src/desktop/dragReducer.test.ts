import { describe, expect, it } from "vitest";
import { beginDrag, dragOffsetPx, dragTarget, nudgeBox, settleDrag, type GridDims } from "./dragReducer";
import { overlaps, type LayoutMap } from "./defaultLayout";

const m: GridDims = { cols: 24, rows: 18, cellW: 50, cellH: 40 };
const box = { x: 2, y: 2, w: 4, h: 3, visible: true };

describe("drag reducer", () => {
  it("dragTarget snaps to the nearest cell and keeps identity when unchanged", () => {
    const s = beginDrag("a", "move", 100, 100, box);
    const same = dragTarget(s, 110, 105, m); // < half a cell
    expect(same).toBe(s.target);
    const moved = dragTarget(s, 100 + 50 * 2, 100 + 40 * 3, m);
    expect(moved).toMatchObject({ x: 4, y: 5, w: 4, h: 3 });
  });

  it("dragTarget clamps moves and resizes inside the grid", () => {
    const s = beginDrag("a", "move", 0, 0, box);
    const far = dragTarget(s, 10_000, 10_000, m);
    expect(far.x + far.w).toBe(m.cols);
    expect(far.y + far.h).toBe(m.rows);
    const r = beginDrag("a", "resize", 0, 0, box);
    const tiny = dragTarget(r, -10_000, -10_000, m);
    expect(tiny.w).toBeGreaterThanOrEqual(3);
    expect(tiny.h).toBeGreaterThanOrEqual(2);
  });

  it("dragOffsetPx is the raw pointer delta", () => {
    const s = beginDrag("a", "move", 10, 20, box);
    expect(dragOffsetPx(s, 25, 5)).toEqual({ dx: 15, dy: -15 });
  });

  it("settleDrag pushes overlapped neighbours down and reports them", () => {
    const layout: LayoutMap = {
      a: { x: 0, y: 0, w: 4, h: 3, visible: true },
      b: { x: 0, y: 5, w: 4, h: 3, visible: true },
      c: { x: 10, y: 0, w: 4, h: 3, visible: true },
      hidden: { x: 0, y: 5, w: 4, h: 3, visible: false },
    };
    const { layout: next, displaced } = settleDrag(layout, "a", { ...layout.a!, y: 4 }, m);
    expect(next.a!.y).toBe(4);
    expect(displaced).toEqual(["b"]);
    expect(next.b!.y).toBe(7);
    expect(next.c).toEqual(layout.c);
    expect(next.hidden).toEqual(layout.hidden);
    const visible = Object.values(next).filter((b) => b.visible);
    for (let i = 0; i < visible.length; i++)
      for (let j = i + 1; j < visible.length; j++) expect(overlaps(visible[i]!, visible[j]!)).toBe(false);
  });

  it("settleDrag keeps a neighbour in place when there is no room below", () => {
    const layout: LayoutMap = {
      a: { x: 0, y: 0, w: 4, h: 3, visible: true },
      b: { x: 0, y: 15, w: 4, h: 3, visible: true },
    };
    const { layout: next, displaced } = settleDrag(layout, "a", { ...layout.a!, y: 14 }, m);
    expect(displaced).toEqual([]);
    expect(next.b).toEqual(layout.b);
  });

  it("nudgeBox moves with arrows, resizes with shift, ignores other keys", () => {
    expect(nudgeBox(box, "ArrowRight", false, m)).toMatchObject({ x: 3, y: 2 });
    expect(nudgeBox(box, "ArrowDown", true, m)).toMatchObject({ w: 4, h: 4 });
    expect(nudgeBox(box, "Enter", false, m)).toBeNull();
    expect(nudgeBox({ ...box, x: 0 }, "ArrowLeft", false, m)).toBeNull();
  });
});

describe("drag reducer: per-widget config survives every move", () => {
  const withConfig = { x: 0, y: 0, w: 4, h: 3, visible: true, config: { days: 14 } };

  it("dragTarget, clampMove and clampResize carry `config` through", () => {
    const s = beginDrag("a", "move", 0, 0, withConfig);
    expect(dragTarget(s, 100, 80, m).config).toEqual({ days: 14 });
    const r = beginDrag("a", "resize", 0, 0, withConfig);
    expect(dragTarget(r, 100, 80, m).config).toEqual({ days: 14 });
  });

  it("nudgeBox keeps `config` and settleDrag keeps it on the moved and displaced widgets", () => {
    const nudged = nudgeBox(withConfig, "ArrowRight", false, m);
    expect(nudged?.config).toEqual({ days: 14 });
    const layout: LayoutMap = {
      a: withConfig,
      b: { x: 0, y: 4, w: 4, h: 3, visible: true, config: { rows: 6 } },
    };
    const { layout: next, displaced } = settleDrag(layout, "a", { ...withConfig, y: 3 }, m);
    expect(displaced).toEqual(["b"]);
    expect(next.a!.config).toEqual({ days: 14 });
    expect(next.b!.config).toEqual({ rows: 6 });
  });
});

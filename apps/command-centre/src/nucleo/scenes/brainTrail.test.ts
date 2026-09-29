import { describe, expect, it } from "vitest";
import { EMPTY_TRAIL, back, current, follow, forward, jump, prune, visit } from "./brainTrail";

describe("trail", () => {
  it("records visits and ignores staying put", () => {
    let t = visit(EMPTY_TRAIL, 1);
    t = visit(t, 2);
    t = visit(t, 2);
    expect(t).toEqual({ items: [1, 2], pos: 1 });
    expect(current(t)).toBe(2);
    expect(current(EMPTY_TRAIL)).toBeNull();
  });

  it("walks back and forward, and a new way cuts the old future", () => {
    let t = [1, 2, 3].reduce((acc, id) => visit(acc, id), EMPTY_TRAIL);
    t = back(back(t));
    expect(current(t)).toBe(1);
    expect(back(t)).toBe(t);
    t = forward(t);
    expect(current(t)).toBe(2);
    t = visit(t, 9);
    expect(t.items).toEqual([1, 2, 9]);
    expect(forward(t)).toBe(t);
  });

  it("recognises a step taken some other way", () => {
    let t = [1, 2, 3].reduce((acc, id) => visit(acc, id), EMPTY_TRAIL);
    t = follow(t, 2); // the Back button
    expect(t).toEqual({ items: [1, 2, 3], pos: 1 });
    t = follow(t, 3); // Forward
    expect(t.pos).toBe(2);
    t = follow(t, 7);
    expect(t.items).toEqual([1, 2, 3, 7]);
  });

  it("jumps to a crumb keeping the future, and caps its length", () => {
    const t = [1, 2, 3, 4].reduce((acc, id) => visit(acc, id), EMPTY_TRAIL);
    expect(jump(t, 0)).toEqual({ items: [1, 2, 3, 4], pos: 0 });
    expect(jump(t, 9)).toBe(t);
    const long = Array.from({ length: 30 }, (_, i) => i).reduce((acc, id) => visit(acc, id, 5), EMPTY_TRAIL);
    expect(long.items).toEqual([25, 26, 27, 28, 29]);
    expect(long.pos).toBe(4);
  });

  it("prunes notes that are gone", () => {
    const t = { items: [1, 2, 3], pos: 1 };
    expect(prune(t, (id) => id !== 1)).toEqual({ items: [2, 3], pos: 0 });
    expect(prune(t, (id) => id !== 2)).toEqual({ items: [1, 3], pos: 1 });
    expect(prune(t, () => true)).toBe(t);
  });
});

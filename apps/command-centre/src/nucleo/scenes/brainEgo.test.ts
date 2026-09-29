import { describe, expect, it } from "vitest";
import { egoAll, egoLayout, egoMembers, shellRadii } from "./brainEgo";

// 0 is the centre; 1..4 its neighbours; 5..7 hang off 1 and 2; 8 is far away.
const adj = [[1, 2, 3, 4], [0, 5, 6], [0, 6, 7], [0], [0, 3], [1], [1, 2], [2, 8], [7]];

describe("egoMembers", () => {
  it("collects one and two hops, never the centre twice", () => {
    const m = egoMembers(0, adj);
    expect(new Set(m.hop1)).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(m.hop2)).toEqual(new Set([5, 6, 7]));
    expect(m.hop2).not.toContain(8);
    // 6 is reached from two neighbours: it comes first
    expect(m.hop2[0]).toBe(6);
    expect([1, 2]).toContain(m.parent.get(6));
    expect(m.parent.get(7)).toBe(2);
  });

  it("caps each shell, keeping the heaviest", () => {
    const m = egoMembers(0, adj, { max1: 2, max2: 1, weight: (i) => (i === 3 ? 100 : i === 4 ? 90 : 0) });
    expect(new Set(m.hop1)).toEqual(new Set([3, 4]));
    expect(m.hop2).toHaveLength(0); // 3 and 4 lead nowhere new
  });

  it("orders the first shell by sector", () => {
    const m = egoMembers(0, adj, { sector: (i) => (i % 2 === 0 ? 0 : 1) });
    expect(m.hop1.slice(0, 2).every((i) => i % 2 === 0)).toBe(true);
  });

  it("skips what is not allowed", () => {
    const m = egoMembers(0, adj, { allowed: (i) => i !== 2 });
    expect(m.hop1).not.toContain(2);
    expect(m.hop2).not.toContain(7);
  });
});

describe("egoLayout", () => {
  it("puts the centre at 0, the first shell at r1 and the second beyond", () => {
    const ego = egoLayout(0, adj);
    expect(ego.offset.get(0)).toEqual({ x: 0, y: 0, z: 0 });
    for (const j of ego.hop1) {
      const o = ego.offset.get(j)!;
      expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(ego.r1, 6);
    }
    for (const j of ego.hop2) {
      const o = ego.offset.get(j)!;
      expect(Math.hypot(o.x, o.y, o.z)).toBeGreaterThan(ego.r1 * 1.4);
    }
    expect(egoAll(ego)).toHaveLength(1 + ego.hop1.length + ego.hop2.length);
  });

  it("hangs a branch out beyond its parent", () => {
    const ego = egoLayout(0, adj);
    const p = ego.offset.get(ego.parent.get(5)!)!;
    const c = ego.offset.get(5)!;
    const cos = (p.x * c.x + p.y * c.y + p.z * c.z) / (Math.hypot(p.x, p.y, p.z) * Math.hypot(c.x, c.y, c.z));
    expect(cos).toBeGreaterThan(0.8);
  });

  it("is deterministic and grows with the crowd", () => {
    expect(egoLayout(0, adj)).toEqual(egoLayout(0, adj));
    expect(shellRadii(30, 40)[0]).toBeGreaterThan(shellRadii(3, 0)[0]);
    const [r1, r2] = shellRadii(4, 3);
    expect(r2).toBeGreaterThan(r1);
  });

  it("copes with a lonely note", () => {
    const ego = egoLayout(3, [[], [], [], []]);
    expect(ego.hop1).toEqual([]);
    expect(ego.offset.size).toBe(1);
  });
});

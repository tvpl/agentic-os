import { describe, expect, it } from "vitest";
import { sparkline, sumBy } from "./sparkline";

describe("sparkline", () => {
  it("maps values into the box and closes the area on the baseline", () => {
    const g = sparkline([0, 5, 10], 100, 24);
    expect(g.max).toBe(10);
    expect(g.line).toBe("M0,23 L50,12 L100,1");
    expect(g.area.endsWith("L100,24 L0,24 Z")).toBe(true);
    expect(g.last).toEqual({ x: 100, y: 1 });
  });

  it("keeps a flat or empty series on the baseline", () => {
    expect(sparkline([0, 0, 0], 10, 10).line).toBe("M0,9 L5,9 L10,9");
    expect(sparkline([], 10, 10)).toEqual({ line: "", area: "", last: null, max: 0 });
    expect(sparkline([7], 100, 24).line).toBe("M50,1");
  });

  it("sums a field of the series", () => {
    expect(sumBy([{ n: 1 }, { n: 2 }], (r) => r.n)).toBe(3);
    expect(sumBy([], (r: { n: number }) => r.n)).toBe(0);
  });
});

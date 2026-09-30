import { describe, expect, it } from "vitest";
import { bezier, bezierTangent, controlPoint, curveLength, quad2, sampleCurve } from "./brainCurve";

const O = { x: 0, y: 0, z: 0 };
const dist = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) =>
  Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

describe("controlPoint", () => {
  it("bows a chord away from the centre, perpendicular to the link", () => {
    const a = { x: 100, y: 0, z: 0 };
    const b = { x: 0, y: 100, z: 0 };
    const c = controlPoint(a, b, O, 0.2, 1);
    const mid = { x: 50, y: 50, z: 0 };
    expect(dist(c, O)).toBeGreaterThan(dist(mid, O));
    // perpendicular: the offset has no component along the link
    const off = { x: c.x - mid.x, y: c.y - mid.y, z: c.z - mid.z };
    expect(off.x * -100 + off.y * 100).toBeCloseTo(0, 6);
    // about bend × length
    expect(dist(c, mid)).toBeGreaterThan(0.2 * 0.85 * Math.SQRT2 * 100 - 1e-6);
    expect(dist(c, mid)).toBeLessThan(0.2 * 1.15 * Math.SQRT2 * 100 + 1e-6);
  });

  it("is stable for a diameter and depends only on the seed", () => {
    const a = { x: -50, y: 0, z: 0 };
    const b = { x: 50, y: 0, z: 0 };
    const c1 = controlPoint(a, b, O, 0.2, 7);
    const c2 = controlPoint(a, b, O, 0.2, 7);
    expect(c1).toEqual(c2);
    expect(Math.abs(c1.x)).toBeLessThan(1e-6);
    expect(Math.hypot(c1.y, c1.z)).toBeGreaterThan(10);
    expect(controlPoint(a, b, O, 0.2, 8)).not.toEqual(c1);
  });

  it("degenerates to the point for a zero-length link", () => {
    expect(controlPoint({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }, O)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("bezier", () => {
  const a = { x: 0, y: 0, z: 0 };
  const c = { x: 50, y: 100, z: 0 };
  const b = { x: 100, y: 0, z: 0 };
  it("starts at a, ends at b, passes half-way to the control point", () => {
    expect(bezier(a, c, b, 0)).toEqual(a);
    expect(bezier(a, c, b, 1)).toEqual(b);
    expect(bezier(a, c, b, 0.5)).toEqual({ x: 50, y: 50, z: 0 });
  });
  it("has tangents towards the control point at the ends", () => {
    const t0 = bezierTangent(a, c, b, 0);
    expect(t0.y / t0.x).toBeCloseTo(2);
    const t1 = bezierTangent(a, c, b, 1);
    expect(t1.y / t1.x).toBeCloseTo(-2);
  });
  it("samples n+1 points and measures longer than the chord", () => {
    expect(sampleCurve(a, c, b, 8)).toHaveLength(9);
    const len = curveLength(a, c, b);
    expect(len).toBeGreaterThan(100);
    expect(len).toBeLessThan(200);
  });
  it("has a 2D twin for the drawn curve", () => {
    expect(quad2(0, 0, 50, 100, 100, 0, 0.5)).toEqual([50, 50]);
  });
});

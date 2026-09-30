import { describe, expect, it } from "vitest";
import { distToQuad, pickBox, pickStar, releaseVelocity } from "./brainPick";

const hits = (pts: Array<[number, number, number]>) => ({
  x: pts.map((p) => p[0]),
  y: pts.map((p) => p[1]),
  r: pts.map((p) => p[2]),
  on: pts.map(() => 1),
});

describe("pickStar", () => {
  it("hits within the star's radius plus the slop; nearest wins", () => {
    const h = hits([
      [100, 100, 4],
      [112, 100, 10],
    ]);
    expect(pickStar(h, 101, 100, 4)).toBe(0);
    expect(pickStar(h, 110, 100, 4)).toBe(1);
    expect(pickStar(h, 100, 130, 4)).toBe(-1);
    // a big star reaches further
    expect(pickStar(h, 112, 115, 6)).toBe(1);
  });

  it("keeps the current star while the cursor stays close (no flicker)", () => {
    const h = hits([
      [100, 100, 5],
      [110, 100, 5],
    ]);
    // 5.5 px from star 0, 4.5 px from star 1: without a current, star 1
    expect(pickStar(h, 105.5, 100, 4)).toBe(1);
    expect(pickStar(h, 105.5, 100, 4, 0)).toBe(0);
    // but a star clearly closer takes over
    expect(pickStar(h, 109, 100, 4, 0)).toBe(1);
    // hidden stars are never picked
    expect(pickStar({ ...h, on: [0, 0] }, 100, 100, 4)).toBe(-1);
  });
});

describe("distToQuad", () => {
  it("measures the distance to the drawn curve", () => {
    // a straight "curve" along x
    expect(distToQuad(50, 10, 0, 0, 50, 0, 100, 0).d).toBeCloseTo(10);
    expect(distToQuad(50, 10, 0, 0, 50, 0, 100, 0).t).toBeCloseTo(0.5, 1);
    // a bowed one: its middle is at y = 25 (half the control's offset)
    expect(distToQuad(50, 25, 0, 0, 50, 50, 100, 0).d).toBeLessThan(0.5);
    expect(distToQuad(0, -5, 0, 0, 50, 50, 100, 0).d).toBeCloseTo(5);
  });
});

describe("pickBox / releaseVelocity", () => {
  it("finds the box under a point", () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
    ];
    expect(pickBox(boxes, 25, 5)).toBe(1);
    expect(pickBox(boxes, 15, 5)).toBe(-1);
  });

  it("measures the hand's speed at release, and nothing after a pause", () => {
    const s = [
      { t: 0, dx: 10, dy: 0 },
      { t: 16, dx: 10, dy: 2 },
      { t: 32, dx: 10, dy: 2 },
    ];
    const v = releaseVelocity(s, 40);
    expect(v.vx).toBeGreaterThan(600);
    expect(v.vy).toBeGreaterThan(0);
    expect(releaseVelocity(s, 400)).toEqual({ vx: 0, vy: 0 });
  });
});

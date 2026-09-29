import { describe, expect, it } from "vitest";
import {
  basis,
  dollyBy,
  eyeOf,
  fitView,
  flyThrust,
  orbitBy,
  panBy,
  panVelocity,
  stepCamera,
  zeroVel,
} from "./brainCamera";
import { PITCH_LIMIT, project, type Camera, type Vec3 } from "./brainSpace";

const cam = (over: Partial<Camera> = {}): Camera => ({
  yaw: 0.6,
  pitch: -0.32,
  dist: 800,
  tx: 10,
  ty: -20,
  tz: 30,
  ...over,
});
const view = { cx: 500, cy: 300, focal: 900 };
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

describe("basis", () => {
  it("is orthonormal and agrees with the projection", () => {
    const b = basis(0.9, -0.4);
    expect(dot(b.right, b.right)).toBeCloseTo(1);
    expect(dot(b.down, b.down)).toBeCloseTo(1);
    expect(dot(b.fwd, b.fwd)).toBeCloseTo(1);
    expect(dot(b.right, b.down)).toBeCloseTo(0);
    expect(dot(b.right, b.fwd)).toBeCloseTo(0);
    expect(dot(b.down, b.fwd)).toBeCloseTo(0);
    const c = cam({ yaw: 0.9, pitch: -0.4 });
    // a step to the right lands right of the centre, a step down lands below it
    const r = project(
      { x: c.tx + b.right.x * 10, y: c.ty + b.right.y * 10, z: c.tz + b.right.z * 10 },
      c,
      view,
    )!;
    const d = project(
      { x: c.tx + b.down.x * 10, y: c.ty + b.down.y * 10, z: c.tz + b.down.z * 10 },
      c,
      view,
    )!;
    expect(r.x).toBeGreaterThan(view.cx);
    expect(r.y).toBeCloseTo(view.cy);
    expect(d.y).toBeGreaterThan(view.cy);
    expect(d.x).toBeCloseTo(view.cx);
  });

  it("puts the eye at the distance, behind the focus", () => {
    const c = cam();
    const e = eyeOf(c);
    expect(Math.hypot(e.x - c.tx, e.y - c.ty, e.z - c.tz)).toBeCloseTo(c.dist);
    expect(project(e, c, view)).toBeNull();
  });
});

describe("hand gestures", () => {
  it("orbits and stops the tilt at the poles", () => {
    const c = cam();
    orbitBy(c, 0.5, -10);
    expect(c.yaw).toBeCloseTo(1.1);
    expect(c.pitch).toBe(-PITCH_LIMIT);
  });

  it("pans so what is at the focus follows the hand exactly", () => {
    const c = cam();
    const p = { x: c.tx, y: c.ty, z: c.tz };
    const before = project(p, c, view)!;
    panBy(c, 40, -25, view.focal);
    const after = project(p, c, view)!;
    expect(after.x - before.x).toBeCloseTo(40);
    expect(after.y - before.y).toBeCloseTo(-25);
    // and the velocity form points the same way
    const v = panVelocity(cam(), 40, -25, view.focal);
    const c2 = cam();
    panBy(c2, 40, -25, view.focal);
    expect(v.x).toBeCloseTo(c2.tx - 10);
    expect(v.z).toBeCloseTo(c2.tz - 30);
  });

  it("dollies towards the point under the cursor, which stays put", () => {
    const c = cam();
    const p = { x: 120, y: 40, z: -60 };
    const before = project(p, c, view)!;
    const f = dollyBy(c, p, 0.5, 70, 5000);
    expect(f).toBeCloseTo(0.5);
    expect(c.dist).toBeCloseTo(400);
    const after = project(p, c, view)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("limits the dolly to the distance range", () => {
    const c = cam({ dist: 100 });
    expect(dollyBy(c, { x: 0, y: 0, z: 0 }, 0.2, 80, 5000)).toBeCloseTo(0.8);
    expect(c.dist).toBeCloseTo(80);
    expect(dollyBy(c, { x: 0, y: 0, z: 0 }, 0.5, 80, 5000)).toBe(1);
  });
});

describe("inertia", () => {
  it("glides after a release and settles", () => {
    const c = cam();
    const v = { ...zeroVel(), yaw: 1.2 };
    let t = 0;
    let moving = true;
    const yaws: number[] = [];
    while (moving && t < 10) {
      moving = stepCamera(c, v, 1 / 60, { lo: 70, hi: 5000, anchor: null });
      yaws.push(c.yaw);
      t += 1 / 60;
    }
    expect(moving).toBe(false);
    expect(t).toBeLessThan(4);
    // it kept turning, slower and slower (1.2 / damping in total)
    expect(c.yaw - 0.6).toBeGreaterThan(0.25);
    expect(c.yaw - 0.6).toBeLessThan(0.36);
    const steps = yaws.slice(1).map((y, i) => y - yaws[i]!);
    expect(steps[0]!).toBeGreaterThan(steps[steps.length - 1]!);
  });

  it("zoom glides towards its anchor and stops at the limit", () => {
    const c = cam({ dist: 300 });
    const v = { ...zeroVel(), zoom: -8 };
    for (let k = 0; k < 120; k++)
      stepCamera(c, v, 1 / 60, { lo: 200, hi: 5000, anchor: { x: 0, y: 0, z: 0 } });
    expect(c.dist).toBeCloseTo(200);
    expect(v.zoom).toBe(0);
  });

  it("a held thrust cruises; letting go settles", () => {
    const c = cam({ yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0, dist: 500 });
    const v = zeroVel();
    const thrust = flyThrust(c, { right: 0, forward: 1, up: 0 })!;
    expect(thrust.z).toBeGreaterThan(0);
    for (let k = 0; k < 60; k++) stepCamera(c, v, 1 / 60, { lo: 70, hi: 5000, anchor: null, thrust });
    expect(c.tz).toBeGreaterThan(200);
    const z = c.tz;
    let moving = true;
    for (let k = 0; k < 600 && moving; k++)
      moving = stepCamera(c, v, 1 / 60, { lo: 70, hi: 5000, anchor: null });
    expect(moving).toBe(false);
    expect(c.tz - z).toBeGreaterThan(0);
    expect(flyThrust(c, { right: 0, forward: 0, up: 0 })).toBeNull();
    // up is up on screen
    const up = flyThrust(cam(), { right: 0, forward: 0, up: 1 })!;
    const b = basis(0.6, -0.32);
    expect(dot(up, b.down)).toBeLessThan(0);
  });
});

describe("fitView", () => {
  const pts: Vec3[] = [
    { x: 400, y: 0, z: 0 },
    { x: 380, y: 60, z: 90 },
    { x: 520, y: -40, z: -60 },
    { x: 450, y: 30, z: 140 },
  ];

  it("shows every point inside the free area, with the margin, centred", () => {
    const free = { w: 900, h: 520 };
    const fit = fitView(pts, 0.6, -0.32, 800, free.w, free.h, { margin: 40 });
    const c = { yaw: 0.6, pitch: -0.32, ...fit };
    const v = { cx: 0, cy: 0, focal: 800 };
    const sc = pts.map((p) => project(p, c, v)!);
    const xs = sc.map((p) => p.x);
    const ys = sc.map((p) => p.y);
    for (const p of sc) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(free.w / 2 - 40 + 0.5);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(free.h / 2 - 40 + 0.5);
    }
    // centred: the bounding box sits in the middle
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 0);
    // tight: one of the axes touches its margin
    const tight = Math.max(
      (Math.max(...xs) - Math.min(...xs)) / (free.w - 80),
      (Math.max(...ys) - Math.min(...ys)) / (free.h - 80),
    );
    expect(tight).toBeGreaterThan(0.95);
  });

  it("keeps a fixed centre when asked, and a floor on the distance", () => {
    const centre = { x: 400, y: 0, z: 0 };
    const fit = fitView(pts, 0.2, -0.5, 800, 600, 600, { centre, margin: 30 });
    expect(fit.tx).toBe(400);
    expect(fit.tz).toBe(0);
    const one = fitView([centre], 0, 0, 800, 600, 600, { min: 180 });
    expect(one.dist).toBe(180);
    expect(fitView([], 0, 0, 800, 600, 600, { min: 150 }).dist).toBe(150);
  });
});

import { describe, expect, it } from "vitest";
import {
  centroid,
  clusterRadius,
  easeInOutCubic,
  flightAt,
  frameDistance,
  hash01,
  layoutConstellation,
  pick,
  placeClusters,
  planFlight,
  project,
  reach,
  unproject,
  zoomAbout,
  wrapAngle,
  type Camera,
} from "./brainSpace";

const cam: Camera = { yaw: 0, pitch: 0, dist: 1000, tx: 0, ty: 0, tz: 0 };
const view = { cx: 500, cy: 400, focal: 1000 };

describe("project", () => {
  it("puts the camera target on the view centre at scale focal/dist", () => {
    const p = project({ x: 0, y: 0, z: 0 }, cam, view)!;
    expect(p.x).toBe(500);
    expect(p.y).toBe(400);
    expect(p.s).toBeCloseTo(1);
    expect(p.d).toBe(1000);
  });

  it("shrinks what is further away and culls what is behind the eye", () => {
    const near = project({ x: 100, y: 0, z: -500 }, cam, view)!;
    const far = project({ x: 100, y: 0, z: 500 }, cam, view)!;
    expect(near.s).toBeGreaterThan(far.s);
    expect(near.x - 500).toBeGreaterThan(far.x - 500);
    expect(project({ x: 0, y: 0, z: -990 }, cam, view)).toBeNull();
  });

  it("rotates with yaw: a quarter turn brings +z to the side", () => {
    const p = project({ x: 0, y: 0, z: 100 }, { ...cam, yaw: Math.PI / 2 }, view)!;
    expect(p.x).toBeCloseTo(500 - 100 * (1000 / 1000));
    expect(p.d).toBeCloseTo(1000);
  });

  it("follows the camera target", () => {
    const p = project({ x: 10, y: 20, z: 30 }, { ...cam, tx: 10, ty: 20, tz: 30 }, view)!;
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(400);
  });
});

describe("flights", () => {
  it("eases from start to end and arrives exactly", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    const f = planFlight(cam, { tx: 300, dist: 400 }, 0, 1000);
    expect(flightAt(f, 0).cam.tx).toBe(0);
    const mid = flightAt(f, 500);
    expect(mid.done).toBe(false);
    expect(mid.cam.tx).toBeCloseTo(150);
    // pulls back mid-way on a long trip
    expect(mid.cam.dist).toBeGreaterThan(700);
    const end = flightAt(f, 1200);
    expect(end.done).toBe(true);
    expect(end.cam).toMatchObject({ tx: 300, dist: 400 });
  });

  it("turns the short way round", () => {
    const f = planFlight({ ...cam, yaw: 3 }, { yaw: -3 }, 0, 100);
    expect(f.to.yaw).toBeCloseTo(3 + (2 * Math.PI - 6));
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5 + 4 * Math.PI)).toBeCloseTo(0.5);
  });

  it("clamps pitch", () => {
    expect(planFlight(cam, { pitch: 5 }, 0, 1).to.pitch).toBeLessThan(1.3);
  });
});

describe("geometry helpers", () => {
  it("centroid, reach and framing distance", () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    expect(centroid(pts)).toEqual({ x: 5, y: 0, z: 0 });
    expect(centroid([])).toEqual({ x: 0, y: 0, z: 0 });
    expect(reach(pts, { x: 5, y: 0, z: 0 })).toBe(5);
    expect(frameDistance(0)).toBe(220);
    expect(frameDistance(400)).toBeGreaterThan(1000);
  });

  it("picks the nearest point inside its radius plus slop", () => {
    const pts = [{ x: 0, y: 0, r: 4 }, null, { x: 20, y: 0, r: 4 }];
    expect(pick(pts, 18, 0)).toBe(2);
    expect(pick(pts, 3, 0)).toBe(0);
    expect(pick(pts, 100, 100)).toBe(-1);
  });

  it("hash01 is deterministic and in [0, 1)", () => {
    expect(hash01(42, 1)).toBe(hash01(42, 1));
    expect(hash01(42, 1)).not.toBe(hash01(42, 2));
    for (let i = 0; i < 200; i++) {
      const h = hash01(i, 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("layoutConstellation", () => {
  const files = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    group: i < 30 ? "a" : i < 50 ? "b" : "c",
    degree: i % 7,
  }));
  const edges = [
    { a: 0, b: 1 },
    { a: 1, b: 35 },
  ];

  it("keeps every star inside its cluster and orders clusters as asked", () => {
    const sky = layoutConstellation(files, edges, ["a", "b", "c"]);
    expect(sky.clusters.map((c) => c.key)).toEqual(["a", "b", "c"]);
    expect(sky.pos).toHaveLength(60);
    files.forEach((f, i) => {
      const cl = sky.clusters.find((c) => c.key === f.group)!;
      const p = sky.pos[i]!;
      const d = Math.hypot(p.x - cl.center.x, p.y - cl.center.y, p.z - cl.center.z);
      expect(d).toBeLessThanOrEqual(cl.radius + 1e-6);
    });
    for (const p of sky.pos) expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(sky.radius);
  });

  it("structural (weak) edges do not pull stars together", () => {
    const pair = [
      { id: 1, group: "g", degree: 1 },
      { id: 2, group: "g", degree: 1 },
      { id: 3, group: "g", degree: 0 },
    ];
    const loose = layoutConstellation(pair, [{ a: 0, b: 1, strong: false }]);
    const none = layoutConstellation(pair, []);
    const tight = layoutConstellation(pair, [{ a: 0, b: 1 }]);
    const gap = (s: typeof none) =>
      Math.hypot(s.pos[0]!.x - s.pos[1]!.x, s.pos[0]!.y - s.pos[1]!.y, s.pos[0]!.z - s.pos[1]!.z);
    expect(gap(loose)).toBeCloseTo(gap(none));
    expect(gap(tight)).toBeLessThan(gap(none));
  });

  it("is deterministic (a refresh does not scramble the sky)", () => {
    const a = layoutConstellation(files, edges, ["a", "b", "c"]);
    const b = layoutConstellation(files, edges, ["a", "b", "c"]);
    expect(a.pos).toEqual(b.pos);
  });

  it("puts the most linked note nearest its cluster centre", () => {
    const one = [
      { id: 1, group: "x", degree: 0 },
      { id: 2, group: "x", degree: 9 },
      { id: 3, group: "x", degree: 1 },
      { id: 4, group: "x", degree: 2 },
    ];
    const sky = layoutConstellation(one, []);
    const dist = sky.pos.map((p) => Math.hypot(p.x, p.y, p.z));
    expect(dist[1]).toBe(Math.min(...dist));
  });

  it("clusters do not overlap on the ring or the sphere", () => {
    for (const n of [2, 4, 6, 9, 16]) {
      const radii = Array.from({ length: n }, (_, i) => clusterRadius(10 + i * 5));
      const centers = placeClusters(radii);
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(
            centers[i]!.x - centers[j]!.x,
            centers[i]!.y - centers[j]!.y,
            centers[i]!.z - centers[j]!.z,
          );
          expect(d, `${n} clusters, ${i}–${j}`).toBeGreaterThan((radii[i]! + radii[j]!) * 0.8);
        }
    }
  });

  it("handles the empty and single-cluster skies", () => {
    expect(layoutConstellation([], []).clusters).toEqual([]);
    const sky = layoutConstellation([{ id: 1, group: "solo", degree: 0 }], []);
    expect(sky.pos[0]).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("unproject + zoomAbout", () => {
  it("inverts the projection on the target plane", () => {
    const c: Camera = { yaw: 0.7, pitch: -0.4, dist: 800, tx: 10, ty: -20, tz: 30 };
    const v = { cx: 400, cy: 300, focal: 900 };
    const w = unproject(520, 210, c, v);
    const p = project(w, c, v)!;
    expect(p.x).toBeCloseTo(520, 6);
    expect(p.y).toBeCloseTo(210, 6);
    expect(p.d).toBeCloseTo(800, 6);
  });
  it("keeps the anchor point still on screen while zooming", () => {
    const c: Camera = { yaw: 0.3, pitch: -0.2, dist: 1000, tx: 0, ty: 0, tz: 0 };
    const v = { cx: 400, cy: 300, focal: 900 };
    const anchor = unproject(600, 200, c, v);
    const z = zoomAbout(c, anchor, 0.5);
    expect(z.dist).toBe(500);
    const p = project(anchor, z, v)!;
    expect(p.x).toBeCloseTo(600, 6);
    expect(p.y).toBeCloseTo(200, 6);
  });
});

import { describe, expect, it } from "vitest";
import type { GraphData } from "../../api";
import { hitTest, screenToWorld, zoomAt } from "./hitTest";
import { layoutFiles, targetOf } from "./layouts";
import { maxDisplacement, stepWorld, tweenTransform } from "./physics";
import { RING, buildWorld, clampZoom, createWorld, groupOfNode, seededRandom, setMatched, setSelected, type World } from "./world";

function graph(n: number, areas = ["Worker", "Docs"]): GraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `file-${i}.md`,
    rel: `${areas[i % areas.length]!.toLowerCase()}/file-${i}.md`,
    path: `/ws/file-${i}.md`,
    ext: ".md",
    area: areas[i % areas.length]!,
    dir: "/ws",
    size: 100 * (i + 1),
    mtime: 1_700_000_000_000 + i,
    title: null,
    tags: [],
  }));
  return { nodes, edges: [{ source: 1, target: 2, kind: "markdown-link", why: "link" }, { source: 1, target: 999, kind: "markdown-link", why: "dangling" }, { source: 2, target: 3, kind: "same-dir", why: "" }], truncated: false, totalFiles: n };
}

function world(n = 40): World {
  const w = createWorld();
  buildWorld(w, { graph: graph(n), skills: [], routines: [], connectors: [], groupOf: (node) => groupOfNode(node, "areas"), labels: { skills: "Skills", routines: "Routines", apps: "Apps" } });
  layoutFiles(w);
  return w;
}

describe("world", () => {
  it("builds hubs per group (largest first), keeps edges that resolve, drops the rest", () => {
    const w = world(9);
    expect(w.hubs.map((h) => h.key)).toEqual(["Worker", "Docs"]);
    expect(w.hubs[0]!.count).toBe(5);
    expect(w.edges).toEqual([{ a: 0, b: 1 }]);
    expect(w.colorOf.get("Worker")).not.toBe(w.colorOf.get("Docs"));
  });

  it("a rebuild preserves positions and hub expansion", () => {
    const w = world(6);
    w.files[0]!.x = 123;
    w.hubs[1]!.expanded = false;
    buildWorld(w, { graph: graph(6), skills: [], routines: [], connectors: [], groupOf: (n) => groupOfNode(n, "areas"), labels: { skills: "", routines: "", apps: "" } });
    expect(w.files[0]!.x).toBe(123);
    expect(w.hubs[1]!.expanded).toBe(false);
  });

  it("groupOfNode uses the area or the first folder", () => {
    const n = graph(1).nodes[0]!;
    expect(groupOfNode(n, "areas")).toBe("Worker");
    expect(groupOfNode(n, "folders")).toBe("worker");
    expect(groupOfNode({ ...n, area: null, rel: "top.md" }, "areas")).toBe("unsorted");
    expect(groupOfNode({ ...n, rel: "top.md" }, "folders")).toBe("(root)");
  });

  it("search and selection are pure state changes", () => {
    const w = world(5);
    setMatched(w, "FILE-1");
    expect([...w.matched!]).toEqual([2]);
    setMatched(w, "  ");
    expect(w.matched).toBeNull();
    setSelected(w, 1);
    expect([...w.selectedEdges]).toEqual([0]);
    setSelected(w, null);
    expect(w.selectedEdges.size).toBe(0);
  });

  it("seeded random is deterministic and clampZoom bounds the scale", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(clampZoom(0.01)).toBe(0.3);
    expect(clampZoom(50)).toBe(9);
  });
});

describe("layouts", () => {
  for (const layout of ["rings", "circle", "hex"] as const) {
    it(`${layout}: every expanded file gets a finite polar target inside the routines ring`, () => {
      const w = world(60);
      w.layout = layout;
      layoutFiles(w);
      for (const n of w.files) {
        expect(Number.isFinite(n.baseAngle)).toBe(true);
        expect(n.baseRadius).toBeGreaterThan(0);
        if (layout === "rings") expect(n.baseRadius).toBeLessThanOrEqual(RING.routines - 26);
      }
    });
  }

  it("a collapsed hub gathers its files in a halo next to the hub", () => {
    const w = world(30);
    w.hubs[0]!.expanded = false;
    layoutFiles(w);
    const hub = w.hubs[0]!;
    const hx = Math.cos(hub.baseAngle) * RING.hubs;
    const hy = Math.sin(hub.baseAngle) * RING.hubs;
    for (const n of w.files.filter((f) => f.group === hub.key)) {
      const [tx, ty] = targetOf(n, 0);
      expect(Math.hypot(tx - hx, ty - hy)).toBeLessThan(30);
    }
  });

  it("is deterministic", () => {
    const a = world(25);
    const b = world(25);
    expect(a.files.map((n) => [n.baseAngle, n.baseRadius])).toEqual(b.files.map((n) => [n.baseAngle, n.baseRadius]));
  });
});

describe("physics", () => {
  it("particles converge onto their targets and rings stop when not animating", () => {
    const w = world(20);
    w.spin = 0.5;
    const before = maxDisplacement(w);
    for (let i = 0; i < 240; i++) stepWorld(w, 1 / 60, false);
    expect(w.theta).toBe(0);
    expect(maxDisplacement(w)).toBeLessThan(before * 0.01);
  });

  it("spin advances theta and rotates hubs and orbs consistently", () => {
    const w = world(5);
    w.orbs.push({ kind: "skill", id: "s", label: "/s", sub: "", baseAngle: 0, radius: RING.skills, x: 0, y: 0, active: true });
    w.spin = 1;
    stepWorld(w, 1, true);
    expect(w.theta).toBeCloseTo(0.45);
    const hub = w.hubs[0]!;
    expect(Math.hypot(hub.x, hub.y)).toBeCloseTo(RING.hubs, 5);
    const orb = w.orbs[0]!;
    expect(Math.hypot(orb.x, orb.y)).toBeCloseTo(RING.skills, 5);
    expect(Math.atan2(orb.y, orb.x)).toBeCloseTo(-0.35 * 0.45, 5);
  });

  it("tweens the transform toward the target", () => {
    const w = createWorld();
    w.target = { x: 100, y: -50, k: 2 };
    for (let i = 0; i < 60; i++) tweenTransform(w, 1 / 60);
    expect(w.transform.x).toBeCloseTo(100, 0);
    expect(w.transform.k).toBeCloseTo(2, 1);
  });
});

describe("hit testing", () => {
  it("prefers hubs, then orbs, then the nearest file within tolerance", () => {
    const w = world(3);
    stepWorld(w, 0, false);
    const hub = w.hubs[0]!;
    expect(hitTest(w, hub.x + 5, hub.y - 5).hub?.key).toBe(hub.key);
    w.orbs.push({ kind: "app", id: "a", label: "A", sub: "", baseAngle: 0, radius: RING.apps, x: RING.apps, y: 0, active: true });
    expect(hitTest(w, RING.apps + 10, 0).orb?.id).toBe("a");
    const file = w.files[0]!;
    file.x = 40;
    file.y = 40;
    expect(hitTest(w, 45, 41).file?.id).toBe(file.id);
    w.transform.k = 4;
    expect(hitTest(w, 60, 60).file).toBeUndefined();
  });

  it("maps screen to world and zooms around the cursor", () => {
    const rect = { left: 10, top: 20, width: 400, height: 300 };
    const tr = { x: 0, y: 0, k: 2 };
    const p = screenToWorld(tr, rect, 210, 170);
    expect(p).toEqual({ x: 0, y: 0, sx: 200, sy: 150 });
    const target = { x: 0, y: 0, k: 1 };
    zoomAt(target, rect, 310, 170, 2, clampZoom);
    expect(target.k).toBe(2);
    // The world point under the cursor (100, 0) must stay under it.
    expect(screenToWorld(target, rect, 310, 170).x).toBeCloseTo(100, 6);
  });
});

import { describe, expect, it } from "vitest";
import type { GraphData } from "../../api";
import { applyPlan, easeSpring, frameSector, planExplosion, startLayoutTween, tripPosition, tripsActive } from "./explosion";
import { applyVisibility, hygiene, neighbourhood, relationsOf, timelineRange, updateFocus } from "./graph";
import { hitTest, screenToWorld, zoomAt } from "./hitTest";
import { computeSectors, dirRuns, layoutFiles, orderFiles, targetOf } from "./layouts";
import { DIM_ALPHA, alphasSettled, maxDisplacement, stepWorld, transformSettled, tweenTransform } from "./physics";
import {
  DEFAULT_SETTINGS,
  RING,
  TWO_PI,
  applyFilters,
  applyGroups,
  buildWorld,
  clampZoom,
  createWorld,
  facetsOf,
  groupOfNode,
  nodeRadius,
  recencyBoost,
  refreshGraphDerived,
  seededRandom,
  setMatched,
  setSelected,
  type World,
} from "./world";

const NOW = 1_700_000_000_000 + 10 * 86_400_000;

function graph(n: number, areas = ["Worker", "Docs"]): GraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `file-${i}.md`,
    rel: `${areas[i % areas.length]!.toLowerCase()}/${i % 3 === 0 ? "sub" : "top"}/file-${i}.md`,
    path: `/ws/file-${i}.md`,
    ext: i % 5 === 0 ? ".ts" : ".md",
    area: areas[i % areas.length]!,
    dir: `/ws/${areas[i % areas.length]!.toLowerCase()}/${i % 3 === 0 ? "sub" : "top"}`,
    size: 100 * (i + 1),
    mtime: 1_700_000_000_000 + i,
    title: null,
    tags: i % 4 === 0 ? ["core"] : [],
  }));
  return {
    nodes,
    edges: [
      { source: 1, target: 2, kind: "markdown-link", why: "link" },
      { source: 1, target: 999, kind: "markdown-link", why: "dangling" },
      { source: 2, target: 3, kind: "same-dir", why: "" },
      { source: 3, target: 4, kind: "same-area", why: "area" },
    ],
    truncated: false,
    totalFiles: n,
  };
}

function world(n = 40, layout = DEFAULT_SETTINGS.layout): World {
  const w = createWorld({ ...DEFAULT_SETTINGS, layout });
  buildWorld(w, { graph: graph(n), skills: [], routines: [], connectors: [], groupOf: (node) => groupOfNode(node, "areas"), labels: { skills: "Skills", routines: "Routines", apps: "Apps" }, now: NOW });
  layoutFiles(w);
  return w;
}

describe("world", () => {
  it("builds hubs per group (largest first), keeps every typed edge that resolves, drops the rest", () => {
    const w = world(9);
    expect(w.hubs.map((h) => h.key)).toEqual(["Worker", "Docs"]);
    expect(w.hubs[0]!.count).toBe(5);
    expect(w.edges).toEqual([
      { a: 0, b: 1, kind: "markdown-link", why: "link" },
      { a: 1, b: 2, kind: "same-dir", why: "" },
      { a: 2, b: 3, kind: "same-area", why: "area" },
    ]);
    expect(w.colorOf.get("Worker")).not.toBe(w.colorOf.get("Docs"));
  });

  it("a rebuild preserves positions, pins and hub expansion", () => {
    const w = world(6);
    w.files[0]!.x = 123;
    w.files[0]!.pinned = true;
    w.hubs[1]!.expanded = false;
    buildWorld(w, { graph: graph(6), skills: [], routines: [], connectors: [], groupOf: (n) => groupOfNode(n, "areas"), labels: { skills: "", routines: "", apps: "" }, now: NOW });
    expect(w.files[0]!.x).toBe(123);
    expect(w.files[0]!.pinned).toBe(true);
    expect(w.files[0]!.fx).toBe(123);
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
    setMatched(w, "FILE-1", NOW);
    expect([...w.matched!]).toEqual([2]);
    setMatched(w, "  ", NOW);
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

describe("typed edges, degree and sizing", () => {
  it("degree counts only the enabled edge kinds and drives the radius", () => {
    const w = world(9);
    // default kinds: markdown-link + same-dir → node 2 (index 1) touches both
    expect(w.files[1]!.degree).toBe(2);
    expect(w.files[3]!.degree).toBe(0); // only a same-area edge
    expect(w.files[1]!.r).toBeGreaterThan(w.files[3]!.r);
    w.edgeKinds = new Set(["markdown-link", "same-dir", "same-area"]);
    refreshGraphDerived(w, NOW);
    expect(w.files[3]!.degree).toBe(1);
    expect(w.adjacency[2]).toEqual([1, 3]);
    w.edgeKinds = new Set();
    refreshGraphDerived(w, NOW);
    expect(w.files.every((n) => n.degree === 0)).toBe(true);
  });

  it("nodeRadius = base + log1p(degree) * 0.6 + recency boost", () => {
    const old = NOW - 30 * 86_400_000;
    expect(nodeRadius(0, old, NOW)).toBeCloseTo(1.6);
    expect(nodeRadius(3, old, NOW)).toBeCloseTo(1.6 + Math.log1p(3) * 0.6);
    expect(recencyBoost(NOW - 1000, NOW)).toBe(1.2);
    expect(recencyBoost(NOW - 3 * 86_400_000, NOW)).toBe(0.6);
    expect(recencyBoost(old, NOW)).toBe(0);
  });

  it("selection only lights up edges of enabled kinds", () => {
    const w = world(9);
    setSelected(w, 3);
    expect([...w.selectedEdges]).toEqual([1]); // same-dir edge only; same-area is off
    w.edgeKinds.add("same-area");
    setSelected(w, 3);
    expect([...w.selectedEdges]).toEqual([1, 2]);
  });
});

describe("filters and groups", () => {
  it("combines search, extension, tag, modified range and size into matched", () => {
    const w = world(20);
    w.filters = { exts: [".ts"], tags: [], modified: "all", size: "any" };
    applyFilters(w, NOW);
    expect([...w.matched!]).toEqual([1, 6, 11, 16]);
    w.filters = { exts: [".ts"], tags: ["core"], modified: "all", size: "any" };
    applyFilters(w, NOW);
    expect([...w.matched!]).toEqual([1]); // id 1 (i=0) is .ts and tagged core
    w.filters = { exts: [], tags: [], modified: "7d", size: "any" };
    applyFilters(w, NOW);
    expect(w.matched!.size).toBe(0); // everything is 10 days old
    w.filters = { exts: [], tags: [], modified: "all", size: "small" };
    w.query = "file-1";
    applyFilters(w, NOW);
    expect([...w.matched!]).toEqual([2, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    w.query = "";
    w.filters = { exts: [], tags: [], modified: "all", size: "any" };
    applyFilters(w, NOW);
    expect(w.matched).toBeNull();
  });

  it("query groups tint matching paths, first match wins", () => {
    const w = world(6);
    w.groups = [
      { query: "sub", color: "#111111" },
      { query: "worker", color: "#222222" },
    ];
    applyGroups(w);
    expect(w.files[0]!.tint).toBe("#111111"); // worker/sub
    expect(w.files[2]!.tint).toBe("#222222"); // worker/top
    expect(w.files[1]!.tint).toBeNull(); // docs/top
    w.groups = [];
    applyGroups(w);
    expect(w.files.every((n) => n.tint === null)).toBe(true);
  });

  it("facetsOf returns the top extensions and tags by count", () => {
    const f = facetsOf(graph(20).nodes, 8);
    expect(f.exts[0]).toEqual([".md", 16]);
    expect(f.exts[1]).toEqual([".ts", 4]);
    expect(f.tags).toEqual([["core", 5]]);
  });
});

describe("layouts", () => {
  for (const layout of ["arcs", "rings", "circle", "hex"] as const) {
    it(`${layout}: every expanded file gets a finite polar target inside the routines ring`, () => {
      const w = world(60, layout);
      for (const n of w.files) {
        expect(Number.isFinite(n.baseAngle)).toBe(true);
        expect(n.baseRadius).toBeGreaterThan(0);
        expect(n.baseRadius).toBeLessThan(RING.routines);
      }
    });
  }

  it("arcs: sectors are proportional to sqrt(count), files sit on rows of increasing radius in dir/mtime order", () => {
    const sectors = computeSectors([
      { key: "a", count: 400 },
      { key: "b", count: 100 },
    ]);
    expect(sectors[0]!.span / sectors[1]!.span).toBeCloseTo(2, 6);
    expect(sectors[0]!.start).toBeLessThan(sectors[1]!.start);
    const total = sectors.reduce((s, x) => s + x.span, 0);
    expect(total).toBeLessThan(TWO_PI);
    expect(total).toBeGreaterThan(TWO_PI * 0.95);

    const w = world(300, "arcs");
    const hub = w.hubs[0]!;
    expect(hub.baseAngle).toBeCloseTo(hub.sectorStart + hub.sectorSpan / 2, 9);
    const members = orderFiles(w.files.filter((n) => n.group === hub.key));
    // ordered by dir then mtime desc
    for (let i = 1; i < members.length; i++) {
      const a = members[i - 1]!;
      const b = members[i]!;
      expect(a.dir <= b.dir).toBe(true);
      if (a.dir === b.dir) expect(a.mtime).toBeGreaterThanOrEqual(b.mtime);
    }
    // radii are quantised into rows and never decrease along the ordered list
    const radii = members.map((n) => n.baseRadius);
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThanOrEqual(radii[i - 1]! - 1e-9);
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBeGreaterThan(1);
    // every file stays inside its hub sector
    for (const n of members) {
      expect(n.baseAngle).toBeGreaterThanOrEqual(hub.sectorStart - 1e-9);
      expect(n.baseAngle).toBeLessThanOrEqual(hub.sectorStart + hub.sectorSpan + 1e-9);
    }
    // sub-folders become planets at the start of their run, with counts
    const planets = w.planets.filter((p) => p.hubKey === hub.key);
    expect(planets.length).toBe(2);
    expect(planets.map((p) => p.label).sort()).toEqual(["sub", "top"]);
    const subPlanet = planets.find((p) => p.label === "sub")!;
    const firstSub = members.find((n) => n.dir.endsWith("/sub"))!;
    expect(subPlanet.count).toBe(members.filter((n) => n.dir.endsWith("/sub")).length);
    expect(subPlanet.baseAngle).toBeLessThan(firstSub.baseAngle + 1e-9);
  });

  it("dirRuns groups consecutive files of the same directory", () => {
    const list = orderFiles(world(12).files);
    const runs = dirRuns(list);
    expect(runs.reduce((s, r) => s + r.count, 0)).toBe(12);
    for (let i = 1; i < runs.length; i++) expect(runs[i]!.dir).not.toBe(runs[i - 1]!.dir);
  });

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
    expect(a.planets).toEqual(b.planets);
  });
});

describe("physics", () => {
  it("particles converge onto their targets and rings stop when not animating", () => {
    const w = world(20);
    w.spin = 0.5;
    const before = maxDisplacement(w);
    for (let i = 0; i < 240; i++) stepWorld(w, 1 / 60, false);
    expect(w.theta).toBe(0);
    expect(w.time).toBeCloseTo(4);
    expect(maxDisplacement(w)).toBeLessThan(before * 0.01);
  });

  it("pinned particles ignore the spring and force pins them via fx/fy", () => {
    const w = world(5);
    const n = w.files[0]!;
    n.pinned = true;
    n.x = 500;
    n.y = -500;
    for (let i = 0; i < 30; i++) stepWorld(w, 1 / 60, false);
    expect(n.x).toBe(500);
    expect(n.y).toBe(-500);
    expect(maxDisplacement(w)).toBeLessThan(500); // pinned nodes are not counted
    w.layout = "force";
    stepWorld(w, 1 / 60, false);
    expect(n.fx).toBe(500);
    expect(n.fy).toBe(-500);
    n.pinned = false;
    stepWorld(w, 1 / 60, false);
    expect(n.fx).toBeNull();
  });

  it("spin advances theta and rotates hubs, planets and orbs consistently", () => {
    const w = world(9, "arcs");
    w.orbs.push({ kind: "skill", id: "s", label: "/s", sub: "", baseAngle: 0, radius: RING.skills, x: 0, y: 0, active: true });
    w.spin = 1;
    stepWorld(w, 1, true);
    expect(w.theta).toBeCloseTo(0.45);
    const hub = w.hubs[0]!;
    expect(Math.hypot(hub.x, hub.y)).toBeCloseTo(RING.hubs, 5);
    const orb = w.orbs[0]!;
    expect(Math.hypot(orb.x, orb.y)).toBeCloseTo(RING.skills, 5);
    expect(Math.atan2(orb.y, orb.x)).toBeCloseTo(-0.35 * 0.45, 5);
    const p = w.planets[0]!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(p.baseRadius, 5);
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(p.baseAngle + 0.45, 5);
  });

  it("tweens the transform toward the target and reports when settled", () => {
    const w = createWorld();
    w.target = { x: 100, y: -50, k: 2 };
    expect(transformSettled(w)).toBe(false);
    for (let i = 0; i < 120; i++) tweenTransform(w, 1 / 60);
    expect(w.transform.x).toBeCloseTo(100, 0);
    expect(w.transform.k).toBeCloseTo(2, 1);
    for (let i = 0; i < 240; i++) tweenTransform(w, 1 / 60);
    expect(transformSettled(w)).toBe(true);
  });

  it("hover focus tweens neighbour alphas over ~150 ms and dims the rest", () => {
    const w = world(9);
    w.hoverId = 2; // neighbours over default kinds: 1 (link) and 3 (same-dir)
    updateFocus(w);
    expect([...w.focusSet!].sort()).toEqual([0, 1, 2]);
    expect(alphasSettled(w)).toBe(false);
    stepWorld(w, 0.05, false);
    expect(w.files[4]!.hoverAlpha).toBeLessThan(1);
    expect(w.files[4]!.hoverAlpha).toBeGreaterThan(DIM_ALPHA);
    for (let i = 0; i < 20; i++) stepWorld(w, 0.05, false);
    expect(w.files[4]!.hoverAlpha).toBe(DIM_ALPHA);
    expect(w.files[1]!.hoverAlpha).toBe(1);
    expect(alphasSettled(w)).toBe(true);
    w.hoverId = null;
    updateFocus(w);
    expect(w.focusSet).toBeNull();
  });
});

describe("local mode, timeline and hygiene", () => {
  it("neighbourhood is a BFS bounded by hops", () => {
    const adj = [[1], [0, 2], [1, 3], [2]];
    expect([...neighbourhood(adj, 0, 1)]).toEqual([0, 1]);
    expect([...neighbourhood(adj, 0, 2)]).toEqual([0, 1, 2]);
    expect([...neighbourhood(adj, 0, 3)]).toEqual([0, 1, 2, 3]);
    expect([...neighbourhood(adj, 3, 0)]).toEqual([3]);
  });

  it("local mode hides nodes beyond N hops of the selection and tweens visibility", () => {
    const w = world(9);
    w.local = true;
    w.localHops = 1;
    setSelected(w, 1);
    applyVisibility(w);
    expect(w.files.map((n) => n.visible)).toEqual([true, true, false, false, false, false, false, false, false]);
    w.localHops = 2;
    applyVisibility(w);
    expect(w.files[2]!.visible).toBe(true);
    expect(w.files[3]!.visible).toBe(false);
    stepWorld(w, 0.1, false);
    expect(w.files[3]!.visAlpha).toBeLessThan(1);
    expect(w.files[3]!.visAlpha).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) stepWorld(w, 0.1, false);
    expect(w.files[3]!.visAlpha).toBe(0);
    // hidden nodes are not hit-testable
    const hidden = w.files[3]!;
    expect(hitTest(w, hidden.x, hidden.y).file).not.toBe(hidden);
    w.local = false;
    applyVisibility(w);
    expect(w.files.every((n) => n.visible)).toBe(true);
  });

  it("timeline hides files modified after the cutoff", () => {
    const w = world(10);
    const [min, max] = timelineRange(w.files)!;
    expect(min).toBe(1_700_000_000_000);
    expect(max).toBe(1_700_000_000_009);
    w.timeline = min + 4;
    applyVisibility(w);
    expect(w.files.filter((n) => n.visible).length).toBe(5);
    expect(timelineRange([])).toBeNull();
  });

  it("relationsOf groups a node's edges by kind with counts (all kinds)", () => {
    const w = world(9);
    const rel = relationsOf(w, 3);
    expect(rel.map((r) => [r.kind, r.count])).toEqual([
      ["same-dir", 1],
      ["same-area", 1],
    ]);
    expect(rel[0]!.entries[0]).toEqual({ id: 2, name: "file-1.md", why: "" });
    expect(relationsOf(w, 999)).toEqual([]);
  });

  it("hygiene lists orphans, stale files and big unopened hubs", () => {
    const w = world(9);
    const report = hygiene(w, { now: NOW, staleDays: 5, bigHub: 3 });
    expect(report.orphans.map((n) => n.id)).toEqual([5, 6, 7, 8, 9]);
    expect(report.stale.length).toBe(9);
    expect(report.unopened).toEqual([]);
    w.hubs[0]!.expanded = false;
    expect(hygiene(w, { now: NOW, bigHub: 3 }).unopened.map((h) => h.key)).toEqual(["Worker"]);
    w.hubs[0]!.everExpanded = true;
    expect(hygiene(w, { now: NOW, bigHub: 3 }).unopened).toEqual([]);
    expect(hygiene(w, { now: NOW, staleDays: 90 }).stale).toEqual([]);
  });
});

describe("directed explosion and layout tween", () => {
  it("plans a deterministic fan: files start at the hub, staggered in arc order, with a spring curve", () => {
    const w = world(30);
    for (let i = 0; i < 300; i++) stepWorld(w, 1 / 60, false); // settle first
    const hub = w.hubs[0]!;
    hub.expanded = true;
    const a = planExplosion(w, hub);
    const b = planExplosion(w, hub);
    expect(a).toEqual(b);
    expect(a.trips.length).toBe(15);
    const ordered = orderFiles(w.files.filter((n) => n.group === hub.key));
    a.trips.forEach(({ index, trip }, i) => {
      expect(w.files[index]).toBe(ordered[i]);
      expect(trip.kind).toBe("spring");
      expect(trip.x0).toBe(hub.x);
      expect(trip.y0).toBe(hub.y);
      if (i > 0) expect(trip.t0).toBeGreaterThan(a.trips[i - 1]!.trip.t0);
    });
    applyPlan(w, a);
    expect(ordered[0]!.x).toBe(hub.x);
    expect(tripsActive(w.files)).toBe(true);
    // the spring overshoots then settles exactly on the target
    expect(easeSpring(0.6)).toBeGreaterThan(1);
    expect(easeSpring(1)).toBeCloseTo(1, 9);
    for (let i = 0; i < 80; i++) stepWorld(w, 1 / 60, false);
    expect(tripsActive(w.files)).toBe(false);
    expect(maxDisplacement(w)).toBeLessThan(1e-6);
  });

  it("collapse eases files from where they are and pinned files stay put", () => {
    const w = world(12);
    stepWorld(w, 0, false);
    const hub = w.hubs[0]!;
    const pinned = w.files.find((n) => n.group === hub.key)!;
    pinned.pinned = true;
    pinned.x = 999;
    hub.expanded = false;
    const plan = planExplosion(w, hub);
    expect(plan.trips.every((t) => t.trip.kind === "ease")).toBe(true);
    applyPlan(w, plan);
    expect(pinned.trip).toBeNull();
    expect(pinned.x).toBe(999);
  });

  it("tripPosition interpolates from start to target and ends at exactly the target", () => {
    const trip = { x0: 0, y0: 0, t0: 1, dur: 1, kind: "ease" as const };
    expect(tripPosition(trip, 0.5, 10, 20)).toEqual([0, 0]);
    const mid = tripPosition(trip, 1.5, 10, 20)!;
    expect(mid[0]).toBeGreaterThan(5);
    expect(mid[0]).toBeLessThan(10);
    expect(tripPosition(trip, 2, 10, 20)).toBeNull();
  });

  it("layout switch tweens every unpinned file from its current position with no jump", () => {
    const w = world(20, "rings");
    for (let i = 0; i < 200; i++) stepWorld(w, 1 / 60, false);
    const before = w.files.map((n) => [n.x, n.y]);
    w.layout = "arcs";
    layoutFiles(w);
    startLayoutTween(w);
    stepWorld(w, 1 / 120, false);
    w.files.forEach((n, i) => {
      // After 1/120 s of an 800 ms ease-out, a node has covered at most ~3 % of its way (no jump).
      const dist = Math.hypot(n.tx - before[i]![0]!, n.ty - before[i]![1]!);
      expect(Math.hypot(n.x - before[i]![0]!, n.y - before[i]![1]!)).toBeLessThanOrEqual(dist * 0.04 + 0.01);
    });
    for (let i = 0; i < 60; i++) stepWorld(w, 1 / 60, false);
    expect(tripsActive(w.files)).toBe(false);
    expect(maxDisplacement(w)).toBeLessThan(1e-6);
  });

  it("frameSector fits the hub and its files into the viewport", () => {
    const w = world(40, "arcs");
    const hub = w.hubs[0]!;
    const cam = frameSector(w, hub, { width: 800, height: 600 });
    expect(cam.k).toBeGreaterThan(0.3);
    expect(cam.k).toBeLessThanOrEqual(4);
    // every member's target lands inside the viewport
    for (const n of w.files.filter((f) => f.group === hub.key)) {
      const [tx, ty] = targetOf(n, w.theta);
      const sx = tx * cam.k + cam.x;
      const sy = ty * cam.k + cam.y;
      expect(Math.abs(sx)).toBeLessThanOrEqual(400);
      expect(Math.abs(sy)).toBeLessThanOrEqual(300);
    }
    expect(frameSector(w, hub, { width: 800, height: 600 })).toEqual(cam);
  });
});

describe("hit testing", () => {
  it("prefers hubs, then orbs, then planets, then the nearest file within tolerance", () => {
    const w = world(3, "rings");
    stepWorld(w, 0, false);
    const hub = w.hubs[0]!;
    expect(hitTest(w, hub.x + 5, hub.y - 5).hub?.key).toBe(hub.key);
    w.orbs.push({ kind: "app", id: "a", label: "A", sub: "", baseAngle: 0, radius: RING.apps, x: RING.apps, y: 0, active: true });
    expect(hitTest(w, RING.apps + 10, 0).orb?.id).toBe("a");
    w.planets = [{ hubKey: hub.key, dir: "/d", label: "d", count: 2, baseAngle: 0, baseRadius: 0, x: -200, y: -200 }];
    expect(hitTest(w, -203, -200).planet?.label).toBe("d");
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

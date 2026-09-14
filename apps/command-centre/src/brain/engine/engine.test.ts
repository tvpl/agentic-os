import { describe, expect, it } from "vitest";
import type { GraphData } from "../../api";
import { CLICK_CHAIN_MS, CLICK_CHAIN_PX, ClickChain, DOUBLE_CLICK_MS, shouldReuseClick } from "./clicks";
import {
  applyPlan,
  easeSpring,
  planExplosion,
  startLayoutTween,
  tripPosition,
  tripsActive,
} from "./explosion";
import {
  boundsOf,
  cancelFlight,
  centreTransform,
  contentBounds,
  fitToBounds,
  flightAt,
  hubBounds,
  planFlight,
  planetBounds,
  reserveInsets,
  restingPoint,
  sectorBounds,
  startFlight,
  stepFlight,
} from "./flight";
import { applyVisibility, hygiene, neighbourhood, relationsOf, timelineRange, updateFocus } from "./graph";
import { fileHittable, hitTest, screenToWorld, zoomAt } from "./hitTest";
import { setHubsExpanded, toggleHub } from "./hubs";
import {
  ROW_MAX_RADIUS,
  ROW_MIN_RADIUS,
  circleCluster,
  collapsedHaloRadius,
  collapsedHaloRings,
  computeSectors,
  dirRuns,
  layoutFiles,
  orderFiles,
  planArcRows,
  targetOf,
} from "./layouts";
import {
  LABEL_ATTEMPT_CAP,
  LABEL_BUDGET,
  LabelPlacer,
  LabelRanker,
  LabelWidthCache,
  fileLabelBox,
  labelAlpha,
  placeHubLabel,
  placeRanked,
  planetLabelAlpha,
  quantiseNow,
  rankLabels,
} from "../render/labels";
import {
  DIM_ALPHA,
  alphasSettled,
  maxDisplacement,
  stepWorld,
  transformSettled,
  tweenTransform,
} from "./physics";
import {
  DEFAULT_SETTINGS,
  GROUP_COLORS,
  RING,
  TWO_PI,
  applyFilters,
  applyGroups,
  buildWorld,
  clampZoom,
  createWorld,
  facetsOf,
  groupOfNode,
  minimapExtentFor,
  WORLD_EXTENT,
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

function world(
  n = 40,
  areasOrLayout: string[] | typeof DEFAULT_SETTINGS.layout = DEFAULT_SETTINGS.layout,
  layoutArg?: typeof DEFAULT_SETTINGS.layout,
): World {
  const areas = Array.isArray(areasOrLayout) ? areasOrLayout : undefined;
  const layout = Array.isArray(areasOrLayout) ? (layoutArg ?? DEFAULT_SETTINGS.layout) : areasOrLayout;
  const w = createWorld({ ...DEFAULT_SETTINGS, layout });
  buildWorld(w, {
    graph: areas ? graph(n, areas) : graph(n),
    skills: [],
    routines: [],
    connectors: [],
    groupOf: (node) => groupOfNode(node, "areas"),
    labels: { skills: "Skills", routines: "Routines", apps: "Apps" },
    now: NOW,
  });
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
    buildWorld(w, {
      graph: graph(6),
      skills: [],
      routines: [],
      connectors: [],
      groupOf: (n) => groupOfNode(n, "areas"),
      labels: { skills: "", routines: "", apps: "" },
      now: NOW,
    });
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

  it("arcs: a lone group whose files fit one row wraps its whole sector instead of bunching at the centre", () => {
    const w = world(40, "arcs");
    // Collapse everything into one group so the single hub owns ~the full ring.
    for (const n of w.files) n.group = "solo";
    w.hubs = [{ ...w.hubs[0]!, key: "solo", count: w.files.length, expanded: true }];
    layoutFiles(w);
    const hub = w.hubs[0]!;
    const members = w.files.filter((n) => n.group === "solo");
    const angles = members.map((n) => n.baseAngle).sort((a, b) => a - b);
    const used = angles[angles.length - 1]! - angles[0]!;
    // The files wrap most of the sector instead of packing into a short arc at
    // its centre (sub-folder planets take a few slots, so not quite all of it).
    expect(used).toBeGreaterThan(hub.sectorSpan * 0.75);
    // One row: every radius is the same.
    expect(new Set(members.map((n) => n.baseRadius.toFixed(6))).size).toBe(1);
    // Evenly pitched: gaps are one slot wide, or two where a planet sits between.
    const gaps = angles.slice(1).map((a, i) => a - angles[i]!);
    const unit = Math.min(...gaps);
    for (const g of gaps) expect(Math.round(g / unit)).toBeLessThanOrEqual(2);
    for (const n of members) {
      expect(n.baseAngle).toBeGreaterThanOrEqual(hub.sectorStart - 1e-9);
      expect(n.baseAngle).toBeLessThanOrEqual(hub.sectorStart + hub.sectorSpan + 1e-9);
    }
  });

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
    const members = w.files.filter((f) => f.group === hub.key);
    const haloR = collapsedHaloRadius(members.length);
    for (const n of members) {
      const [tx, ty] = targetOf(n, 0);
      expect(Math.hypot(tx - hx, ty - hy)).toBeLessThanOrEqual(haloR + 1e-6);
    }
  });

  it("collapsed halo radius grows with the count between 16 and 60, over 1–3 rings", () => {
    expect(collapsedHaloRadius(0)).toBe(16);
    expect(collapsedHaloRadius(1)).toBeGreaterThanOrEqual(16); // never tighter than the floor
    const counts = [4, 25, 100, 400];
    const radii = counts.map(collapsedHaloRadius);
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThan(radii[i - 1]!);
    // sub-linear: quadrupling the count roughly doubles the growth past the base
    expect((radii[2]! - 14) / (radii[1]! - 14)).toBeCloseTo(2, 1);
    expect(collapsedHaloRadius(1200)).toBe(60);
    expect(collapsedHaloRadius(50_000)).toBe(60); // clamped
    expect(collapsedHaloRings(5)).toBe(1);
    expect(collapsedHaloRings(40)).toBe(2);
    expect(collapsedHaloRings(500)).toBe(3);
    // A 1200-file hub is not a blob: files sit on three distinct rings, the outer one at the halo radius.
    const w = world(1200, ["Big"]);
    w.hubs[0]!.expanded = false;
    layoutFiles(w);
    const hub = w.hubs[0]!;
    const hx = Math.cos(hub.baseAngle) * RING.hubs;
    const hy = Math.sin(hub.baseAngle) * RING.hubs;
    const dists = new Set(
      w.files.map((n) => {
        const [tx, ty] = targetOf(n, 0);
        return Math.hypot(tx - hx, ty - hy).toFixed(3);
      }),
    );
    expect(dists.size).toBe(3);
    expect(Math.max(...[...dists].map(Number))).toBeCloseTo(60, 2);
  });

  it("arcs: rows never cross the routines orbit — a huge hub packs tighter and adds rows inward", () => {
    const w = world(2500, ["Huge", "Tiny"]);
    w.files.forEach((n, i) => {
      if (i > 0) n.group = "Huge";
    });
    w.hubs[0]!.count = 2499;
    w.hubs[1]!.count = 1;
    layoutFiles(w);
    for (const n of w.files) expect(n.baseRadius).toBeLessThanOrEqual(ROW_MAX_RADIUS + 1e-9);
    // A 1500-file hub keeps every row (and planet) clear of the routines ring.
    const big = world(1500, ["Big"], "arcs");
    const rows = big.files.map((n) => n.baseRadius);
    expect(Math.max(...rows)).toBeLessThan(RING.routines - 20);
    for (const p of big.planets) expect(p.baseRadius).toBeLessThan(RING.routines - 20);
    expect(new Set(rows.map((r) => r.toFixed(3))).size).toBeGreaterThan(5); // spread over many rows
    // The plan reports the tightened pitch and the inward rows.
    // A narrow sector (1.2 rad) that must hold 2 499 slots.
    const span = 1.2;
    const relaxed = planArcRows(50, span, 7, 8.5);
    expect(relaxed.spacing).toBe(7);
    expect(Math.min(...relaxed.radii)).toBe(RING.filesInner + 14);
    const packed = planArcRows(2499, span, 7, 8.5);
    expect(packed.spacing).toBeLessThan(7);
    expect(Math.min(...packed.radii)).toBeLessThan(RING.filesInner + 14);
    expect(Math.max(...packed.radii)).toBeLessThanOrEqual(ROW_MAX_RADIUS);
    const capacity = packed.radii.reduce((sum, r) => sum + Math.floor((span * r) / packed.spacing), 0);
    expect(capacity).toBeGreaterThanOrEqual(2499);
    // An absurdly narrow sector stops at the minimum pitch but still never leaves the orbit clamp.
    const floor = planArcRows(2499, 0.3, 7, 8.5);
    expect(floor.spacing).toBeCloseTo(1.6);
    expect(Math.max(...floor.radii)).toBeLessThanOrEqual(ROW_MAX_RADIUS);
  });

  it("hex: rows stay inside the routines orbit by widening the grid", () => {
    const w = world(1500, ["Big"], "hex");
    for (const n of w.files) expect(n.baseRadius).toBeLessThanOrEqual(ROW_MAX_RADIUS + 1e-9);
  });

  it("circle: a big group extends its disc inward instead of freezing at one size", () => {
    const small = circleCluster(5, 1);
    const mid = circleCluster(50, 1);
    const big = circleCluster(800, 1);
    // 13+ files used to share one 42-unit disc; now the disc keeps growing well past that.
    expect(circleCluster(13, 1).clusterR).toBeGreaterThan(42);
    expect(mid.clusterR).toBeGreaterThan(small.clusterR);
    expect(big.clusterR).toBeGreaterThan(mid.clusterR);
    expect(big.clusterR).toBeCloseTo((ROW_MAX_RADIUS - ROW_MIN_RADIUS) / 2);
    expect(circleCluster(5000, 1).clusterR).toBe(big.clusterR); // only then capped
    // A small disc sits just outside the hub ring; every disc's far edge stays on the orbit clamp.
    expect(small.centerR - small.clusterR).toBeCloseTo(RING.hubs + 26);
    for (const c of [small, mid, big])
      expect(c.centerR + c.clusterR).toBeLessThanOrEqual(ROW_MAX_RADIUS + 1e-9);
    expect(big.centerR - big.clusterR).toBeCloseTo(ROW_MIN_RADIUS);
    // Through the layout: 50 and 800 files spread over discs of different radii.
    const spread = (n: number) => {
      const w = world(n, ["Big"], "circle");
      const hub = w.hubs[0]!;
      const c = circleCluster(n, w.clusterSize);
      const gx = Math.cos(hub.baseAngle) * c.centerR;
      const gy = Math.sin(hub.baseAngle) * c.centerR;
      let far = 0;
      for (const f of w.files) {
        const [x, y] = targetOf(f, 0);
        far = Math.max(far, Math.hypot(x - gx, y - gy));
        expect(f.baseRadius).toBeLessThanOrEqual(ROW_MAX_RADIUS + 1e-9);
      }
      return far;
    };
    const r50 = spread(50);
    const r800 = spread(800);
    expect(r800).toBeGreaterThan(r50 * 1.1);
  });

  it("sixteen distinct group colours, the first ten unchanged", () => {
    expect(GROUP_COLORS.length).toBe(16);
    expect(new Set(GROUP_COLORS).size).toBe(16);
    expect(GROUP_COLORS.slice(0, 10)).toEqual([
      "#c084fc",
      "#f472b6",
      "#22d3ee",
      "#fde047",
      "#4ade80",
      "#fb923c",
      "#a5b4fc",
      "#f87171",
      "#5eead4",
      "#fbbf24",
    ]);
    const w = world(
      32,
      Array.from({ length: 16 }, (_, i) => `G${i}`),
    );
    expect(new Set(w.hubs.map((h) => h.color)).size).toBe(16);
  });

  it("is deterministic", () => {
    const a = world(25);
    const b = world(25);
    expect(a.files.map((n) => [n.baseAngle, n.baseRadius])).toEqual(
      b.files.map((n) => [n.baseAngle, n.baseRadius]),
    );
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
    w.orbs.push({
      kind: "skill",
      id: "s",
      label: "/s",
      sub: "",
      baseAngle: 0,
      radius: RING.skills,
      x: 0,
      y: 0,
      active: true,
    });
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
    expect(w.files.map((n) => n.visible)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
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

  it("fitToBounds(sectorBounds) fits the hub and its files into the viewport, deterministically", () => {
    const w = world(40, "arcs");
    const hub = w.hubs[0]!;
    const view = { width: 800, height: 600 };
    const cam = fitToBounds(sectorBounds(w, hub), view, { padding: 30, maxK: 4 });
    expect(cam.k).toBeGreaterThan(0.3);
    expect(cam.k).toBeLessThanOrEqual(4);
    // every member's target (and the hub disc) lands inside the viewport
    const hx = Math.cos(hub.baseAngle + w.theta) * RING.hubs;
    const hy = Math.sin(hub.baseAngle + w.theta) * RING.hubs;
    const pts = w.files.filter((f) => f.group === hub.key).map((n) => targetOf(n, w.theta));
    pts.push([hx, hy]);
    for (const [tx, ty] of pts) {
      expect(Math.abs(tx * cam.k + cam.x)).toBeLessThanOrEqual(400);
      expect(Math.abs(ty * cam.k + cam.y)).toBeLessThanOrEqual(300);
    }
    expect(fitToBounds(sectorBounds(w, hub), view, { padding: 30, maxK: 4 })).toEqual(cam);
  });
});

describe("click chain (double-click acts on what the first click hit)", () => {
  const A = { id: "a" };
  const B = { id: "b" };

  it("shouldReuseClick: within the time window and a few pixels of the previous click only", () => {
    const prev = { hit: A, at: 1000, x: 100, y: 100 };
    expect(shouldReuseClick(null, 1100, 100, 100)).toBe(false);
    expect(shouldReuseClick(prev, 1000 + CLICK_CHAIN_MS, 100 + CLICK_CHAIN_PX, 100)).toBe(true);
    expect(shouldReuseClick(prev, 1000 + CLICK_CHAIN_MS + 1, 100, 100)).toBe(false);
    expect(shouldReuseClick(prev, 1100, 100 + CLICK_CHAIN_PX + 1, 100)).toBe(false);
    expect(shouldReuseClick(prev, 1100, 104, 104)).toBe(true); // hypot ≈ 5.66
    expect(shouldReuseClick(prev, 900, 100, 100)).toBe(false); // clock went backwards
    expect(shouldReuseClick(prev, 1500, 100, 100, { ms: 600 })).toBe(true);
  });

  it("the second press and the dblclick reuse the first click's hit while the scene moves under the pointer", () => {
    const chain = new ClickChain<{ id: string }>();
    let liveCalls = 0;
    const live = () => {
      liveCalls++;
      return B; // the camera flight moved A away; a live hit-test now finds B
    };
    // Click 1: nothing to reuse, the live hit is A.
    expect(chain.hitForPress(0, 100, 100, () => A)).toEqual({ hit: A, reused: false });
    chain.record(A, 10, 100, 100);
    // Press 2 (200 ms later, 3 px away): reuses A, no live hit-test.
    expect(chain.hitForPress(210, 103, 101, live)).toEqual({ hit: A, reused: true });
    expect(liveCalls).toBe(0);
    chain.record(A, 220, 103, 101);
    // The dblclick that follows acts on A as well and ends the chain.
    expect(chain.hitForDoubleClick(230, live)).toBe(A);
    expect(liveCalls).toBe(0);
    expect(chain.current).toBeNull();
    // A third press is a fresh click again.
    expect(chain.hitForPress(240, 103, 101, live)).toEqual({ hit: B, reused: false });
    expect(liveCalls).toBe(1);
  });

  it("a slow or distant second press, a drag or a pinch starts a fresh hit-test", () => {
    const chain = new ClickChain<{ id: string }>();
    chain.record(A, 0, 100, 100);
    expect(chain.hitForPress(CLICK_CHAIN_MS + 50, 100, 100, () => B).reused).toBe(false);
    chain.record(A, 0, 100, 100);
    expect(chain.hitForPress(100, 140, 100, () => B).reused).toBe(false);
    chain.record(A, 0, 100, 100);
    chain.reset(); // a drag or pinch in between
    expect(chain.hitForPress(100, 100, 100, () => B)).toEqual({ hit: B, reused: false });
    // A dblclick long after the last click is hit-tested live.
    chain.record(A, 0, 100, 100);
    expect(chain.hitForDoubleClick(DOUBLE_CLICK_MS, () => B)).toBe(B);
    chain.record(A, 0, 100, 100);
    expect(chain.hitForDoubleClick(DOUBLE_CLICK_MS - 1, () => B)).toBe(A);
  });
});

describe("hit testing", () => {
  it("prefers hubs, then orbs, then planets, then the nearest file within tolerance", () => {
    const w = world(3, "rings");
    stepWorld(w, 0, false);
    const hub = w.hubs[0]!;
    expect(hitTest(w, hub.x + 5, hub.y - 5).hub?.key).toBe(hub.key);
    w.orbs.push({
      kind: "app",
      id: "a",
      label: "A",
      sub: "",
      baseAngle: 0,
      radius: RING.apps,
      x: RING.apps,
      y: 0,
      active: true,
    });
    expect(hitTest(w, RING.apps + 10, 0).orb?.id).toBe("a");
    w.planets = [
      { hubKey: hub.key, dir: "/d", label: "d", count: 2, baseAngle: 0, baseRadius: 0, x: -200, y: -200 },
    ];
    expect(hitTest(w, -203, -200).planet?.label).toBe("d");
    const file = w.files[0]!;
    file.x = 40;
    file.y = 40;
    expect(hitTest(w, 45, 41).file?.id).toBe(file.id);
    w.transform.k = 4;
    expect(hitTest(w, 60, 60).file).toBeUndefined();
  });

  it("fileHittable: faded, unmatched and out-of-group files are not clickable", () => {
    const w = world(6);
    const n = w.files[0]!;
    n.visAlpha = 1;
    expect(fileHittable(w, n)).toBe(true);
    n.visAlpha = 0.3;
    expect(fileHittable(w, n)).toBe(false);
    n.visAlpha = 1;
    w.matched = new Set([w.files[1]!.id]);
    expect(fileHittable(w, n)).toBe(false);
    expect(fileHittable(w, w.files[1]!)).toBe(true);
    w.matched = null;
    w.filterGroup = "Docs";
    expect(n.group).toBe("Worker");
    expect(fileHittable(w, n)).toBe(false);
    expect(fileHittable(w, w.files[1]!)).toBe(true); // Docs
    // hitTest honours it: the nearest file loses to a hittable one further away
    stepWorld(w, 0, false);
    n.x = 40;
    n.y = 40;
    const other = w.files[1]!;
    other.x = 44;
    other.y = 40;
    expect(hitTest(w, 40, 40).file).toBe(other);
    w.filterGroup = null;
    expect(hitTest(w, 40, 40).file).toBe(n);
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

describe("hub expand / collapse", () => {
  it("toggling a hub fans its files, records the burst and (in focus mode) closes the others", () => {
    const w = world(30);
    for (let i = 0; i < 200; i++) stepWorld(w, 1 / 60, false);
    const [first, second] = w.hubs;
    expect(first!.expanded && second!.expanded).toBe(true);
    // Collapse the first one: only it changes, its files ease back to the halo.
    expect(toggleHub(w, first!, { focusMode: true, now: 5 }).map((h) => h.key)).toEqual([first!.key]);
    expect(first!.expanded).toBe(false);
    expect(second!.expanded).toBe(true);
    expect(w.effects.at(-1)).toEqual({ x: first!.x, y: first!.y, start: 5, color: first!.color });
    expect(w.files.filter((n) => n.group === first!.key).every((n) => n.trip?.kind === "ease")).toBe(true);
    // Re-open it under focus mode: the other hub closes with it.
    const changed = toggleHub(w, first!, { focusMode: true, now: 6 });
    expect(changed.map((h) => h.key)).toEqual([first!.key, second!.key]);
    expect(first!.expanded).toBe(true);
    expect(first!.everExpanded).toBe(true);
    expect(second!.expanded).toBe(false);
    expect(w.files.filter((n) => n.group === first!.key).every((n) => n.trip?.kind === "spring")).toBe(true);
    for (let i = 0; i < 120; i++) stepWorld(w, 1 / 60, false);
    expect(tripsActive(w.files)).toBe(false);
  });

  it("setHubsExpanded moves every hub at once and reports nothing to do the second time", () => {
    const w = world(12);
    expect(setHubsExpanded(w, false).length).toBe(w.hubs.length);
    expect(w.hubs.every((h) => !h.expanded)).toBe(true);
    expect(setHubsExpanded(w, false)).toEqual([]);
    expect(setHubsExpanded(w, true).length).toBe(w.hubs.length);
    expect(w.hubs.every((h) => h.expanded && h.everExpanded)).toBe(true);
  });
});

describe("camera flights", () => {
  const view = { width: 1000, height: 800 };

  it("interpolates from the live transform to the target and lands exactly on it", () => {
    const from = { x: 0, y: 0, k: 1 };
    const to = { x: -400, y: 200, k: 2 };
    const f = planFlight(from, to, view, 10, { duration: 0.5 });
    expect(flightAt(f, 10).transform).toEqual(from);
    expect(flightAt(f, 9).transform).toEqual(from);
    const end = flightAt(f, 10.5);
    expect(end.done).toBe(true);
    expect(end.transform).toEqual(to);
    // Monotone zoom on a short trip (no dip): k grows in log space.
    const ks = [0.1, 0.25, 0.4, 0.5, 0.75, 0.9].map((u) => flightAt(f, 10 + u * 0.5).transform.k);
    for (let i = 1; i < ks.length; i++) expect(ks[i]!).toBeGreaterThan(ks[i - 1]!);
    expect(flightAt(f, 10.25).transform.k).toBeCloseTo(Math.sqrt(2), 6);
  });

  it("dips the zoom in the middle of a long pan and never below 0.3", () => {
    const from = { x: 0, y: 0, k: 2 };
    const to = { x: -5000, y: 0, k: 2 };
    const f = planFlight(from, to, view, 0, { duration: 1 });
    expect(f.dipK).toBeCloseTo(1.2);
    expect(flightAt(f, 0.5).transform.k).toBeCloseTo(1.2, 6);
    const tiny = planFlight({ x: 0, y: 0, k: 0.35 }, { x: -3000, y: 0, k: 0.35 }, view, 0);
    expect(tiny.dipK).toBe(0.3);
    // The world point under the centre travels straight from start to end.
    const mid = flightAt(f, 0.5).transform;
    expect(-mid.x / mid.k).toBeCloseTo(1250, 6);
    // A short trip does not dip.
    expect(planFlight(from, { x: -50, y: 0, k: 2 }, view, 0).dipK).toBeNull();
  });

  it("startFlight / stepFlight drive the world transform and keep the target glued to it", () => {
    const w = createWorld();
    w.time = 3;
    startFlight(w, { x: -300, y: -100, k: 3 }, view, { duration: 0.4 });
    expect(w.flight).not.toBeNull();
    expect(w.target).toEqual(w.transform);
    stepFlight(w, 3.2);
    expect(w.transform.k).toBeGreaterThan(1);
    expect(w.transform.k).toBeLessThan(3);
    expect(w.target).toEqual(w.transform);
    stepFlight(w, 3.5);
    expect(w.flight).toBeNull();
    expect(w.transform).toEqual({ x: -300, y: -100, k: 3 });
    // Zero duration (reduced motion) jumps.
    startFlight(w, { x: 0, y: 0, k: 1 }, view, { duration: 0 });
    expect(w.flight).toBeNull();
    expect(w.transform).toEqual({ x: 0, y: 0, k: 1 });
    // A flight to the same place is not restarted.
    startFlight(w, { x: -300, y: -100, k: 3 }, view);
    const first = w.flight;
    w.time = 3.1;
    startFlight(w, { x: -300.1, y: -100, k: 3 }, view);
    expect(w.flight).toBe(first);
  });

  it("cancelling mid-flight leaves the camera where it is (no jump) and a new flight restarts from there", () => {
    const w = createWorld();
    startFlight(w, { x: -800, y: 0, k: 2 }, view, { duration: 1 });
    stepFlight(w, 0.5);
    const mid = { ...w.transform };
    cancelFlight(w);
    expect(w.flight).toBeNull();
    expect(w.transform).toEqual(mid);
    expect(w.target).toEqual(mid);
    w.time = 0.5;
    startFlight(w, { x: 0, y: 0, k: 1 }, view, { duration: 1 });
    expect(w.flight!.from).toEqual(mid);
    stepFlight(w, 0.5);
    expect(w.transform).toEqual(mid);
    // Clamped zoom targets stay inside the zoom range.
    startFlight(w, { x: 0, y: 0, k: 50 }, view);
    expect(w.flight!.to.k).toBe(9);
  });

  it("fitToBounds honours panel insets: the content is centred in the free region", () => {
    const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    const plain = fitToBounds(bounds, view, { padding: 0 });
    expect(plain.k).toBe(4); // capped
    expect(plain.x).toBe(0);
    expect(plain.y).toBe(0);
    const wide = fitToBounds({ minX: -1000, minY: -100, maxX: 1000, maxY: 100 }, view, { padding: 0 });
    expect(wide.k).toBeCloseTo(0.5);
    // A 400 px preview on the left and a 300 px panel on the right leave a 300 px free band
    // whose centre is 50 px left of the canvas centre.
    const boxed = fitToBounds(bounds, view, {
      padding: 0,
      insets: { left: 400, right: 300, top: 0, bottom: 0 },
    });
    expect(boxed.k).toBeCloseTo(1.5);
    expect(boxed.x).toBeCloseTo(50);
    const centreX = (bounds.minX + bounds.maxX) / 2;
    expect(centreX * boxed.k + boxed.x).toBeCloseTo(50);
    // Off-centre content: the content centre lands at the free-region centre.
    const off = fitToBounds({ minX: 200, minY: 200, maxX: 400, maxY: 300 }, view, {
      padding: 10,
      insets: { left: 0, right: 0, top: 100, bottom: 0 },
    });
    expect(300 * off.k + off.x).toBeCloseTo(0);
    expect(250 * off.k + off.y).toBeCloseTo(50);
    expect(fitToBounds(null, view, { insets: { left: 200 } })).toEqual({ x: 100, y: 0, k: 1 });
    expect(centreTransform(100, 0, 2, { right: 100 })).toEqual({ x: -250, y: 0, k: 2 });
  });

  it("content, sector and planet bounds cover what is drawn", () => {
    const w = world(60, "arcs");
    stepWorld(w, 0, false);
    const all = contentBounds(w)!;
    for (const h of w.hubs) {
      expect(h.x).toBeGreaterThanOrEqual(all.minX);
      expect(h.x).toBeLessThanOrEqual(all.maxX);
    }
    const hub = w.hubs[0]!;
    const sector = sectorBounds(w, hub);
    for (const n of w.files.filter((f) => f.group === hub.key)) {
      const [tx, ty] = targetOf(n, w.theta);
      expect(tx).toBeGreaterThanOrEqual(sector.minX - 1e-9);
      expect(tx).toBeLessThanOrEqual(sector.maxX + 1e-9);
      expect(ty).toBeGreaterThanOrEqual(sector.minY - 1e-9);
      expect(ty).toBeLessThanOrEqual(sector.maxY + 1e-9);
    }
    const planet = w.planets.find((p) => p.hubKey === hub.key)!;
    const pb = planetBounds(w, planet);
    const members = w.files.filter((n) => n.group === hub.key && n.dir === planet.dir);
    expect(members.length).toBe(planet.count);
    for (const n of members) {
      const [tx, ty] = targetOf(n, w.theta);
      expect(tx).toBeGreaterThanOrEqual(pb.minX - 1e-9);
      expect(tx).toBeLessThanOrEqual(pb.maxX + 1e-9);
      expect(ty).toBeGreaterThanOrEqual(pb.minY - 1e-9);
      expect(ty).toBeLessThanOrEqual(pb.maxY + 1e-9);
    }
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: NaN, y: 1 },
        { x: 2, y: 3 },
      ]),
    ).toEqual({ minX: 2, minY: 3, maxX: 2, maxY: 3 });
  });

  it("hubBounds is the disc plus its halo, centred on the hub", () => {
    expect(hubBounds({ x: 100, y: -50 })).toEqual({ minX: 40, minY: -110, maxX: 160, maxY: 10 });
    expect(hubBounds({ x: 0, y: 0 }, 20)).toEqual({ minX: -20, minY: -20, maxX: 20, maxY: 20 });
    const w = world(30);
    stepWorld(w, 0, false);
    const hub = w.hubs[0]!;
    const b = hubBounds(hub, collapsedHaloRadius(hub.count));
    expect((b.minX + b.maxX) / 2).toBeCloseTo(hub.x);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(hub.y);
    const cam = fitToBounds(b, view, { padding: 40, maxK: 2.5 });
    expect(cam.k).toBe(2.5);
    expect(hub.x * cam.k + cam.x).toBeCloseTo(0);
    expect(hub.y * cam.k + cam.y).toBeCloseTo(0);
  });

  it("minimap extent covers the ring guides, then grows with content that spills past them", () => {
    const w = world(20);
    stepWorld(w, 0, false);
    expect(minimapExtentFor(w.files)).toBe(WORLD_EXTENT);
    expect(minimapExtentFor([])).toBe(WORLD_EXTENT);
    const far = w.files[0]!;
    far.x = 900;
    far.y = 0;
    expect(minimapExtentFor(w.files)).toBe(900 * 2 + 60);
    far.y = -1200;
    expect(minimapExtentFor(w.files)).toBe(1200 * 2 + 60);
    far.visAlpha = 0.1; // faded-out files do not stretch the map
    expect(minimapExtentFor(w.files)).toBe(WORLD_EXTENT);
  });

  it("reserveInsets pushes each overlay panel out along its cheapest edge and ignores hidden ones", () => {
    const canvas = { left: 0, top: 0, right: 1200, bottom: 800 };
    const topbar = { left: 0, top: 0, right: 1200, bottom: 60 };
    const preview = { left: 16, top: 76, right: 376, bottom: 784 };
    const list = { left: 16, top: 76, right: 336, bottom: 784 };
    const controls = { left: 916, top: 60, right: 1184, bottom: 700 };
    const hidden = { left: 16, top: 76, right: 16, bottom: 76 }; // display:none → 0×0
    expect(reserveInsets(canvas, [topbar, preview, controls, hidden], 16)).toEqual({
      left: 392,
      right: 300,
      top: 76,
      bottom: 16,
    });
    // The list beside the preview (wide viewports): the preview sits right of it and both count.
    const besideList = { left: 348, top: 76, right: 708, bottom: 784 };
    expect(reserveInsets(canvas, [topbar, list, besideList, controls], 16).left).toBe(724);
    // A bottom sheet reserves the bottom band, a panel outside the canvas nothing.
    const sheet = { left: 16, top: 500, right: 376, bottom: 784 };
    expect(reserveInsets(canvas, [sheet], 0)).toEqual({ left: 0, right: 0, top: 0, bottom: 300 });
    expect(reserveInsets(canvas, [{ left: 1300, top: 0, right: 1500, bottom: 800 }], 4)).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 4,
    });
    // Client coordinates: a canvas that does not start at the origin.
    const shifted = { left: 200, top: 100, right: 1400, bottom: 900 };
    expect(reserveInsets(shifted, [{ left: 200, top: 100, right: 1400, bottom: 160 }], 0).top).toBe(60);
  });

  it("restingPoint is the layout target mid-trip and the live point otherwise", () => {
    const w = world(6);
    const n = w.files[0]!;
    n.x = 500;
    n.y = 500;
    w.theta = 0.3;
    expect(restingPoint(w, n)).toEqual([500, 500]);
    n.trip = { x0: 500, y0: 500, t0: 0, dur: 1, kind: "ease" };
    expect(restingPoint(w, n)).toEqual(targetOf(n, 0.3));
    n.pinned = true;
    expect(restingPoint(w, n)).toEqual([500, 500]);
  });
});

describe("labels", () => {
  it("fade in over zoom instead of a hard cut", () => {
    expect(labelAlpha(1.0, false)).toBe(0);
    expect(labelAlpha(1.3, false)).toBe(0);
    expect(labelAlpha(1.65, false)).toBeCloseTo(0.5);
    expect(labelAlpha(2.0, false)).toBe(1);
    expect(labelAlpha(0.5, true)).toBe(1);
    expect(planetLabelAlpha(1.0)).toBe(0);
    expect(planetLabelAlpha(1.6)).toBe(1);
  });

  it("rank: selected > hovered / focus neighbours > matched > pinned > degree > recency", () => {
    const w = world(8);
    const f = w.files;
    for (const n of f) {
      n.degree = 0;
      n.mtime = NOW - 365 * 86_400_000;
    }
    f[0]!.mtime = NOW; // recent
    f[1]!.degree = 40; // hub-like
    f[2]!.pinned = true;
    w.matched = new Set([f[3]!.id]);
    w.focusSet = new Set([4]);
    w.hoverId = f[5]!.id;
    w.selectedId = f[6]!.id;
    const order = rankLabels(w, f, [0, 1, 2, 3, 4, 5, 6, 7], NOW);
    expect(order).toEqual([6, 5, 4, 3, 2, 1, 0, 7]);
    // The frame ranker gives the same order in place, and can be reused frame after frame.
    const ranker = new LabelRanker();
    for (let frame = 0; frame < 2; frame++) {
      ranker.begin(f.length);
      for (const i of [7, 0, 1, 2, 3, 4, 5, 6]) ranker.add(i);
      expect(ranker.size).toBe(8);
      expect(Array.from(ranker.rank(w, f, NOW))).toEqual([6, 5, 4, 3, 2, 1, 0, 7]);
    }
    ranker.begin(f.length);
    expect(ranker.size).toBe(0);
    // Recency is quantised to the minute so scores hold still between frames.
    const minute = Math.ceil(NOW / 60_000) * 60_000;
    expect(quantiseNow(minute + 1)).toBe(minute);
    expect(quantiseNow(minute + 59_999)).toBe(minute);
    expect(quantiseNow(minute + 60_000)).toBe(minute + 60_000);
  });

  it("placement stops after the budget is filled or the attempt cap is reached", () => {
    const ranked = Array.from({ length: 5000 }, (_, i) => i);
    let attempts = 0;
    expect(
      placeRanked(ranked, () => {
        attempts++;
        return false; // everything collides
      }),
    ).toBe(0);
    expect(attempts).toBe(LABEL_ATTEMPT_CAP);
    expect(LABEL_ATTEMPT_CAP).toBe(LABEL_BUDGET * 4);
    attempts = 0;
    expect(
      placeRanked(ranked, () => {
        attempts++;
        return true;
      }),
    ).toBe(LABEL_BUDGET);
    expect(attempts).toBe(LABEL_BUDGET);
    // Every other one collides: the budget still fills within the cap.
    attempts = 0;
    expect(placeRanked(ranked, (i) => (attempts++, i % 2 === 0))).toBe(LABEL_BUDGET);
    expect(attempts).toBe(LABEL_BUDGET * 2 - 1);
    // Fewer candidates than the cap: every one is tried.
    attempts = 0;
    expect(placeRanked([1, 2, 3], () => (attempts++, false), 10, 100)).toBe(0);
    expect(attempts).toBe(3);
  });

  it("label widths are measured once per name at the base font and invalidated on a font change", () => {
    const measured: string[] = [];
    const ctx = {
      font: "",
      measureText: (text: string) => {
        measured.push(`${ctx.font}|${text}`);
        return { width: text.length * 6 };
      },
    };
    const cache = new LabelWidthCache();
    const base = "10px mono";
    expect(cache.width(ctx, "readme.md", base, "5px mono")).toBe(54);
    expect(ctx.font).toBe("5px mono"); // the zoomed font is restored after the miss
    expect(cache.width(ctx, "readme.md", base, "2.5px mono")).toBe(54);
    expect(cache.width(ctx, "notes.md", base, "2.5px mono")).toBe(48);
    expect(measured).toEqual(["10px mono|readme.md", "10px mono|notes.md"]);
    expect(cache.size).toBe(2);
    cache.width(ctx, "readme.md", "10px serif", "5px serif");
    expect(measured.length).toBe(3);
    expect(cache.size).toBe(1);
  });

  it("collision boxes match the drawn glyphs and hub labels step outward when they overlap", () => {
    const [x1, y1, x2, y2] = fileLabelBox(10, 20, 30, 2);
    expect(x1).toBe(10);
    expect(x2).toBe(40);
    expect(y1).toBeCloseTo(20 + 1.5 - 4); // baseline − ascent
    expect(y2).toBeCloseTo(20 + 1.5 + 1.25); // baseline + descent
    const placer = new LabelPlacer();
    expect(placer.tryPlace(0, 0, 10, 10)).toBe(true);
    expect(placer.tryPlace(5, 5, 15, 15)).toBe(false);
    expect(placer.tryPlace(10, 0, 20, 10)).toBe(true);
    expect(placer.count).toBe(2);
    // Two hubs on the same vertical: the second label is pushed outward along its radius.
    const hubs = new LabelPlacer();
    const a = placeHubLabel(hubs, { x: 0, y: -100 }, 40, 10, 12);
    expect(a.free).toBe(true);
    expect(a).toMatchObject({ x: 0, y: -112 });
    const b = placeHubLabel(hubs, { x: 0, y: -104 }, 40, 10, 12);
    expect(b.free).toBe(true);
    expect(b.y).toBeLessThan(-120); // moved up (outward) by at least one label height
    // A label that cannot find a free spot within three steps reports it.
    const crowded = new LabelPlacer();
    crowded.place(-100, -300, 100, 0);
    const c = placeHubLabel(crowded, { x: 0, y: -100 }, 40, 10, 12);
    expect(c.free).toBe(false);
    expect(c.y).toBeCloseTo(-112 - 30);
  });

  it("zoomTarget scales from the flight destination while a flight is in progress", async () => {
    const { zoomTarget } = await import("./flight");
    const clamp = (k: number) => Math.max(0.3, Math.min(9, k));
    const idle = { target: { x: 10, y: -20, k: 1 }, flight: null };
    expect(zoomTarget(idle, 1.3, clamp)).toEqual({ x: 13, y: -26, k: 1.3 });
    const flying = {
      target: { x: 4, y: 4, k: 1.4 },
      flight: { to: { x: 0, y: 0, k: 1 } } as unknown as NonNullable<typeof idle.flight>,
    };
    // Reset (flight to k = 1) then zoom in twice lands on 1.69 exactly, never on the mid-flight 1.4
    const once = zoomTarget(flying as never, 1.3, clamp);
    expect(once.k).toBeCloseTo(1.3, 10);
    expect(zoomTarget({ target: once, flight: null }, 1.3, clamp).k).toBeCloseTo(1.69, 10);
    expect(zoomTarget(idle, 100, clamp).k).toBe(9);
  });
});

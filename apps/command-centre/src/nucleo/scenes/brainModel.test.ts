import { describe, expect, it } from "vitest";
import {
  CLUSTER_PALETTE,
  buildModel,
  isStrongKind,
  mixHex,
  parseHex,
  rgba,
  starLabel,
  starSize,
} from "./brainModel";
import { createStage, fitDistance, flyHome, flyTo, setModel } from "./brainStage";
import { DAY_MS } from "./brainTimeline";

const now = Date.UTC(2026, 8, 26);
const files = [
  { id: 1, name: "a.md", title: "Alpha", group: "x", degree: 2, mtime: now - DAY_MS, tint: null },
  { id: 2, name: "b.md", title: null, group: "x", degree: 1, mtime: now - 40 * DAY_MS, tint: "#112233" },
  { id: 3, name: "c.md", title: null, group: "y", degree: 1, mtime: now - 40 * DAY_MS, tint: null },
];
const edges = [
  { a: 0, b: 1, kind: "markdown-link" },
  { a: 0, b: 2, kind: "same-dir" },
];
const adjacency = [[1, 2], [0], [0]];

describe("buildModel", () => {
  const model = buildModel(files, edges, adjacency, {
    order: ["x", "y"],
    enabled: new Set(["markdown-link", "same-dir"]),
    now,
  });

  it("keeps the world's file order and names the stars", () => {
    expect(model.pos).toHaveLength(3);
    expect(model.label).toEqual(["Alpha", "b", "c"]);
    expect(model.cluster).toEqual([0, 0, 1]);
    expect(model.clusters.map((c) => c.key)).toEqual(["x", "y"]);
  });

  it("colours by cluster, honouring a query-group tint", () => {
    expect(model.color[0]).toBe(CLUSTER_PALETTE[0]);
    expect(model.color[1]).toBe("#112233");
    expect(model.color[2]).toBe(CLUSTER_PALETTE[1]);
  });

  it("sizes by links and recency, marks landmarks and strong edges", () => {
    expect(model.size[0]).toBeGreaterThan(model.size[1]!);
    expect(starSize(0, true)).toBeGreaterThan(starSize(0, false));
    expect(model.hub[0]).toBe(true);
    expect(model.edges).toEqual([
      { a: 0, b: 1, strong: true, kind: "markdown-link", why: "" },
      { a: 0, b: 2, strong: false, kind: "same-dir", why: "" },
    ]);
    expect(model.incident[0]).toEqual([0, 1]);
    expect(model.kind).toEqual(["note", "note", "note"]);
    expect(model.clusters[0]!.puffs).toHaveLength(5);
    expect(isStrongKind("related")).toBe(true);
  });

  it("only lays out enabled edge kinds", () => {
    const m = buildModel(files, edges, adjacency, { order: [], enabled: new Set(["markdown-link"]), now });
    expect(m.edges).toHaveLength(1);
  });
});

describe("labels and colours", () => {
  it("truncates long labels and strips extensions", () => {
    expect(starLabel({ name: "notes/2026-09-21.md", title: null })).toBe("notes/2026-09-21");
    expect(starLabel({ name: ".gitkeep", title: null })).toBe(".gitkeep");
    expect(starLabel({ name: "x.md", title: "A".repeat(60) }, 10)).toBe(`${"A".repeat(9)}…`);
  });

  it("mixes and converts hex colours", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("nope")).toBeNull();
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(rgba("#ff0000", 0.5)).toBe("rgba(255,0,0,0.500)");
  });
});

describe("stage", () => {
  it("sizes buffers to the model and flies within limits", () => {
    const stage = createStage();
    const model = buildModel(files, edges, adjacency, {
      order: [],
      enabled: new Set(["markdown-link"]),
      now,
    });
    setModel(stage, model);
    expect(stage.alpha).toHaveLength(3);
    expect([...stage.target]).toEqual([1, 1, 1]);
    flyTo(stage, { x: 10, y: 0, z: 0 }, 1, 0);
    expect(stage.flight!.to.dist).toBeGreaterThanOrEqual(70);
    expect(stage.flight!.to.tx).toBe(10);
    stage.reduced = true;
    flyHome(stage, 0);
    expect(stage.flight!.dur).toBe(1);
    expect(stage.flight!.to.tx).toBe(0);
  });
});

describe("fitDistance", () => {
  it("frames a radius into the free area, with a floor", () => {
    const frame = { focal: 800, freeW: 1000, freeH: 500 };
    // radius 100 filling 40 % of 500 px: 100 * 800 / 200
    expect(fitDistance({ frame }, 100, 0.4, 0)).toBeCloseTo(400);
    expect(fitDistance({ frame }, 1, 0.4, 180)).toBe(180);
    expect(fitDistance({ frame: null }, 100)).toBeGreaterThan(180);
  });
});

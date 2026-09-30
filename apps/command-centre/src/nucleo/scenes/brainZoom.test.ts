import { describe, expect, it } from "vitest";
import { distanceForLevel, labelBudget, levelName, levelWeights, zoomLevel } from "./brainZoom";

describe("zoomLevel", () => {
  it("is 0 at the overview and beyond, rises as the camera closes in, stops at 2 outside a note", () => {
    expect(zoomLevel(1000, 1000)).toBe(0);
    expect(zoomLevel(3000, 1000)).toBe(0);
    const a = zoomLevel(700, 1000);
    const b = zoomLevel(400, 1000);
    const c = zoomLevel(150, 1000);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(zoomLevel(10, 1000)).toBe(2);
    expect(zoomLevel(10, 1000, true)).toBe(3);
  });

  it("round-trips with distanceForLevel", () => {
    for (const l of [0.25, 0.5, 1, 1.5, 2])
      expect(zoomLevel(distanceForLevel(l, 900), 900)).toBeCloseTo(l, 6);
    expect(distanceForLevel(0, 900)).toBe(900);
  });

  it("names the level", () => {
    expect(levelName(0.2)).toBe("areas");
    expect(levelName(1.1)).toBe("hubs");
    expect(levelName(1.8)).toBe("notes");
    expect(levelName(3)).toBe("synapses");
  });
});

describe("levelWeights", () => {
  it("hands the sky from areas to hubs to notes", () => {
    const far = levelWeights(0);
    const mid = levelWeights(1);
    const near = levelWeights(2);
    expect(far.areas).toBe(1);
    expect(far.hubs).toBe(0);
    expect(far.notes).toBe(0);
    expect(mid.hubs).toBe(1);
    expect(mid.notes).toBe(0);
    expect(near.notes).toBe(1);
    expect(near.excerpts).toBe(1);
    expect(near.areas).toBeLessThan(far.areas);
  });

  it("gives more labels when closer and on bigger screens", () => {
    expect(labelBudget(2, 1440 * 900)).toBeGreaterThan(labelBudget(0, 1440 * 900));
    expect(labelBudget(2, 1440 * 900)).toBeGreaterThan(labelBudget(2, 400 * 300));
    expect(labelBudget(2, 1e9)).toBeLessThanOrEqual(90);
  });
});

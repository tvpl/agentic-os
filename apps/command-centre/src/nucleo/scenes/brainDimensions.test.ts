import { describe, expect, it } from "vitest";
import {
  bowCentre,
  degreeBands,
  layoutAreas,
  layoutLinks,
  layoutTime,
  layoutTypes,
  timeTicks,
  timeUnit,
} from "./brainDimensions";
import type { ContentKind } from "./brainGlyphs";

const DAY = 86_400_000;
const T0 = new Date(2026, 0, 10, 12).getTime();

describe("layoutTime", () => {
  const files = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    mtime: T0 + (i % 20) * 3 * DAY + i * 1000,
  }));
  const lay = layoutTime(files);

  it("runs older to newer along x", () => {
    const byTime = files.map((_, i) => i).sort((a, b) => files[a]!.mtime - files[b]!.mtime);
    for (let k = 1; k < byTime.length; k++)
      expect(lay.pos[byTime[k]!]!.x).toBeGreaterThanOrEqual(lay.pos[byTime[k - 1]!]!.x);
    expect(lay.axis).toBe(true);
  });

  it("winds the notes around the axis", () => {
    for (const p of lay.pos) {
      const r = Math.hypot(p.y, p.z);
      expect(r).toBeGreaterThan(30);
    }
  });

  it("marks time with rings and an axis that ends at now", () => {
    expect(lay.guides.some((g) => g.shape === "line")).toBe(true);
    expect(lay.guides.some((g) => g.label?.kind === "now")).toBe(true);
    const rings = lay.guides.filter((g) => g.label?.kind === "time");
    expect(rings.length).toBeGreaterThan(2);
    const xs = rings.map((g) => g.a.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("puts every note in exactly one time group", () => {
    const seen = lay.groups.flatMap((g) => g.members);
    expect(seen).toHaveLength(files.length);
    expect(new Set(seen).size).toBe(files.length);
    expect([...lay.groupOf].every((g) => g >= 0)).toBe(true);
  });

  it("copes with one note and with many on the same day", () => {
    expect(layoutTime([{ id: 1, mtime: T0 }]).pos).toHaveLength(1);
    const same = layoutTime(Array.from({ length: 10 }, (_, i) => ({ id: i, mtime: T0 })));
    expect(new Set(same.pos.map((p) => Math.round(p.x))).size).toBeGreaterThan(5);
  });
});

describe("time ticks", () => {
  it("chooses a unit by span", () => {
    expect(timeUnit(10)).toBe("day");
    expect(timeUnit(60)).toBe("week");
    expect(timeUnit(400)).toBe("month");
    expect(timeUnit(3000)).toBe("year");
  });
  it("lands on calendar boundaries inside the span, capped", () => {
    const ticks = timeTicks(T0, T0 + 200 * DAY, "month");
    expect(ticks.length).toBeGreaterThan(4);
    for (const t of ticks) expect(new Date(t).getDate()).toBe(1);
    expect(timeTicks(T0, T0 + 400 * DAY, "day", 12).length).toBeLessThanOrEqual(12);
    expect(timeTicks(T0, T0, "day")).toEqual([]);
  });
});

describe("layoutTypes", () => {
  const kinds: ContentKind[] = ["note", "note", "journal", "journal", "journal", "code", "note"];
  const files = kinds.map((kind, i) => ({ id: i + 1, mtime: T0 + i * DAY, kind }));
  const lay = layoutTypes(files);
  it("makes one constellation per kind, largest first (ties in legend order)", () => {
    expect(lay.groups.map((g) => g.key)).toEqual(["note", "journal", "code"]);
    expect(lay.groups[0]!.members).toHaveLength(3);
  });
  it("keeps each note inside its kind's ring", () => {
    files.forEach((_, i) => {
      const g = lay.groups[lay.groupOf[i]!]!;
      const p = lay.pos[i]!;
      expect(Math.hypot(p.x - g.centre.x, p.z - g.centre.z)).toBeLessThanOrEqual(g.radius * 1.12);
    });
    expect(lay.guides.filter((g) => g.shape === "ring")).toHaveLength(3);
  });
});

describe("layoutLinks", () => {
  // a star: 0 is linked to 1..6; 7 is an orphan.
  const files = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, degree: i === 0 ? 6 : i === 7 ? 0 : 1 }));
  const edges = [1, 2, 3, 4, 5, 6].map((b) => ({ a: 0, b }));
  const lay = layoutLinks(files, edges);
  const r = (i: number) => {
    const p = lay.pos[i]!;
    return Math.hypot(p.x, p.y / 0.32, p.z);
  };
  it("puts the hub at the core and the orphan on the halo", () => {
    for (let i = 1; i <= 6; i++) {
      expect(r(0)).toBeLessThan(r(i));
      expect(r(7)).toBeGreaterThan(r(i));
    }
  });
  it("labels the bands", () => {
    const labels = lay.guides.map((g) => g.label).filter((l) => l?.kind === "degree");
    expect(labels.length).toBe(lay.groups.length);
    expect(lay.groups.at(-1)!.label).toMatchObject({ kind: "degree", min: 0, max: 0 });
  });
  it("finds bands from the degrees", () => {
    expect(degreeBands([0, 0])).toEqual([[0, 0]]);
    const b = degreeBands([1, 1, 1, 2, 2, 3, 8, 12, 0]);
    expect(b[0]![1]).toBeNull();
    expect(b.at(-1)).toEqual([0, 0]);
  });
});

describe("layoutAreas + bowCentre", () => {
  const pos = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 300, y: 0, z: 0 },
  ];
  const clusters = [
    { key: "a", center: { x: 5, y: 0, z: 0 }, radius: 50, count: 2 },
    { key: "b", center: { x: 300, y: 0, z: 0 }, radius: 40, count: 1 },
  ];
  const lay = layoutAreas(pos, clusters, [0, 0, 1]);
  it("wraps the constellation", () => {
    expect(lay.groups.map((g) => g.members)).toEqual([[0, 1], [2]]);
  });
  it("bows a link inside a group from its centre, across groups from the middle", () => {
    const mid = { x: 1, y: 1, z: 1 };
    expect(bowCentre(lay, 0, 1, mid)).toEqual({ x: 5, y: 0, z: 0 });
    expect(bowCentre(lay, 0, 2, mid)).toEqual({ x: 0, y: 0, z: 0 });
    expect(bowCentre({ axis: true, groupOf: new Int32Array(0), groups: [] }, 0, 1, mid)).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });
});

/**
 * What the ground is made of. The field drew files alone at first and came out
 * as three faint dots on a real workspace, so these lock in the two properties
 * that fix: it carries every kind, and a point keeps its place when the
 * workspace around it changes.
 */
import { describe, expect, it } from "vitest";
import { fieldSeeds, placeField, MAX_POINTS, type FieldSources } from "./fieldPoints";

const labels = { skill: "Skills", routine: "Routines", run: "Runs", failed: "did not finish" };

const sources = (over: Partial<FieldSources> = {}): FieldSources => ({
  files: [],
  skills: [],
  routines: [],
  runs: [],
  labels,
  ...over,
});

const file = (path: string, area: string | null = "docs") => ({
  path,
  name: path.split("/").pop()!,
  area,
  title: null,
  mtime: 0,
});

describe("what the living field is made of", () => {
  it("carries every kind, not just the indexed files", () => {
    const seeds = fieldSeeds(
      sources({
        files: [file("a.md")],
        skills: [{ slug: "recall", name: "Recall", enabled: true }],
        routines: [{ id: "r1", name: "Digest", enabled: true, healthy: true }],
        runs: [{ id: "run1", status: "done", promptSummary: "Read the workspace" }],
      }),
    );
    expect(seeds.map((s) => s.kind)).toEqual(["file", "skill", "routine", "run"]);
  });

  it("leaves out what is switched off: the sky shows what is live", () => {
    const seeds = fieldSeeds(
      sources({
        skills: [
          { slug: "on", name: "On", enabled: true },
          { slug: "off", name: "Off", enabled: false },
        ],
        routines: [
          { id: "live", name: "Live", enabled: true, healthy: true },
          { id: "paused", name: "Paused", enabled: false, healthy: true },
        ],
      }),
    );
    expect(seeds.map((s) => s.id)).toEqual(["skill:on", "routine:live"]);
  });

  it("burns what is wrong, so the ground carries the same warning as the pods", () => {
    const seeds = fieldSeeds(
      sources({
        routines: [{ id: "sick", name: "Sick", enabled: true, healthy: false }],
        runs: [
          { id: "ok", status: "done", promptSummary: "fine" },
          { id: "bad", status: "failed", promptSummary: "broke" },
          { id: "slow", status: "timed_out", promptSummary: "hung" },
        ],
      }),
    );
    expect(seeds.filter((s) => s.hot).map((s) => s.id)).toEqual(["routine:sick", "run:bad", "run:slow"]);
    expect(seeds.find((s) => s.id === "run:bad")?.detail).toBe("did not finish");
    expect(seeds.find((s) => s.id === "run:ok")?.detail).toBe("Runs");
  });

  it("sends a file to a window and everything else to where it lives", () => {
    const seeds = fieldSeeds(
      sources({
        files: [file("notes/a.md")],
        skills: [{ slug: "recall", name: "Recall", enabled: true }],
        runs: [{ id: "run1", status: "done" }],
      }),
    );
    expect(seeds[0]!.open).toEqual({ file: "notes/a.md" });
    expect(seeds[1]!.open).toEqual({ route: "/skills/recall" });
    expect(seeds[2]!.open).toEqual({ route: "/runs/run1" });
  });

  it("keeps only the last handful of runs: old ones say nothing", () => {
    const runs = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, status: "done" }));
    const seeds = fieldSeeds(sources({ runs }));
    expect(seeds).toHaveLength(12);
    expect(seeds[0]!.id).toBe("run:r0");
  });

  it("never draws more than the field can hold", () => {
    const files = Array.from({ length: 500 }, (_, i) => file(`f${i}.md`));
    expect(fieldSeeds(sources({ files }))).toHaveLength(MAX_POINTS);
  });

  it("puts a point in the same place every time, whatever else is indexed", () => {
    const one = placeField(fieldSeeds(sources({ files: [file("a.md"), file("b.md")] })));
    // The same file, now surrounded by ten others and no longer first.
    const many = placeField(
      fieldSeeds(
        sources({ files: [...Array.from({ length: 10 }, (_, i) => file(`x${i}.md`)), file("a.md")] }),
      ),
    );
    const before = one.find((p) => p.id === "file:a.md")!;
    const after = many.find((p) => p.id === "file:a.md")!;
    expect(after.a).toBeCloseTo(before.a, 10);
    expect(after.r).toBeCloseTo(before.r, 10);
  });

  it("keeps every point inside the ellipse it is drawn on", () => {
    const points = placeField(
      fieldSeeds(sources({ files: Array.from({ length: 60 }, (_, i) => file(`f${i}.md`)) })),
    );
    for (const p of points) {
      expect(p.r).toBeGreaterThanOrEqual(0.14);
      expect(p.r).toBeLessThanOrEqual(1);
      expect(p.size).toBeGreaterThan(1);
    }
    // Signed speeds: the field drifts, it does not rotate as one body.
    expect(points.some((p) => p.s > 0)).toBe(true);
    expect(points.some((p) => p.s < 0)).toBe(true);
  });
});

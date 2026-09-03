import { describe, expect, it } from "vitest";
import type { ArtifactListItem } from "../api";
import { buildRingChips, chipAngle, chipLabel, chipMatches, kindOf, type RingSourceFile } from "./ringChips";

const artifact = (over: Partial<ArtifactListItem>): ArtifactListItem => ({
  id: "run1/report.md",
  file: "report.md",
  path: "/home/a/artifacts/run1/report.md",
  runId: "run1",
  skillSlug: null,
  createdAt: 2_000,
  kind: "markdown",
  title: "Report",
  folder: "run1",
  sizeBytes: 10,
  thumbnail: false,
  ...over,
});

const file = (over: Partial<RingSourceFile>): RingSourceFile => ({
  name: "notes.md",
  path: "/home/a/notes.md",
  mtime: 1_000,
  ...over,
});

describe("ring chips", () => {
  it("numbers chips in creation order, oldest first", () => {
    const chips = buildRingChips(
      [artifact({ id: "a", createdAt: 3_000 }), artifact({ id: "b", createdAt: 1_000 })],
      [file({ path: "/f", mtime: 2_000 })],
    );
    expect(chips.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(chips.map((c) => c.ts)).toEqual([1_000, 2_000, 3_000]);
    expect(chips[0]!.kind).toBe("artifact");
    expect(chips[1]!.kind).toBe("file");
  });

  it("caps the ring and prefers artifacts over graph files", () => {
    const artifacts = Array.from({ length: 5 }, (_, i) => artifact({ id: `a${i}`, createdAt: 100 + i }));
    const files = Array.from({ length: 5 }, (_, i) => file({ path: `/f${i}`, mtime: 1 + i }));
    const chips = buildRingChips(artifacts, files, 6);
    expect(chips).toHaveLength(6);
    expect(chips.filter((c) => c.kind === "artifact")).toHaveLength(5);
  });

  it("drops duplicates by id and by path", () => {
    const chips = buildRingChips(
      [artifact({ id: "same" }), artifact({ id: "same" })],
      [file({ path: "/one" }), file({ path: "/one" })],
    );
    expect(chips).toHaveLength(2);
  });

  it("derives the kind from the extension", () => {
    expect(kindOf("a.PNG")).toBe("image");
    expect(kindOf("a.webm")).toBe("video");
    expect(kindOf("a.html")).toBe("html");
    expect(kindOf("a.md")).toBe("markdown");
    expect(kindOf("a.tsx")).toBe("code");
    expect(kindOf("LICENSE")).toBe("other");
  });

  it("labels skill outputs with skill and date, everything else with its number", () => {
    const [plain] = buildRingChips([artifact({ id: "x", title: "Brand deck" })], []);
    expect(chipLabel(plain!, "en-GB")).toBe("1 · Brand deck");
    const [skill] = buildRingChips(
      [artifact({ id: "y", skillSlug: "clean-up", createdAt: Date.UTC(2026, 7, 19, 12, 0) })],
      [],
    );
    expect(chipLabel(skill!, "en-GB")).toMatch(/^\/clean-up · /);
  });

  it("matches on title, file name, skill and path, and never on an empty query", () => {
    const [chip] = buildRingChips([artifact({ id: "z", title: "OS restyle", skillSlug: "brand" })], []);
    expect(chipMatches(chip!, "restyle")).toBe(true);
    expect(chipMatches(chip!, "REPORT.MD")).toBe(true);
    expect(chipMatches(chip!, "brand")).toBe(true);
    expect(chipMatches(chip!, "  ")).toBe(false);
    expect(chipMatches(chip!, "nope")).toBe(false);
  });

  it("spreads chips over the open arc and never divides by zero", () => {
    expect(chipAngle(0, 1)).toBeCloseTo(Math.PI * 0.5, 6);
    expect(chipAngle(0, 4)).toBeCloseTo(Math.PI * 0.56, 6);
    expect(chipAngle(3, 4)).toBeCloseTo(Math.PI * 2.44, 6);
    expect(chipAngle(1, 4)).toBeLessThan(chipAngle(2, 4));
  });
});

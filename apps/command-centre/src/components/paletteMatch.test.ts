import { describe, expect, it } from "vitest";
import { fuzzyScore, highlightRange, normalize, rankItems, scoreItem } from "./paletteMatch";

describe("palette matcher", () => {
  it("normalizes case, diacritics and whitespace", () => {
    expect(normalize("  Segundo   Cérebro ")).toBe("segundo cerebro");
  });

  it("orders prefix > word boundary > substring > subsequence > none", () => {
    const prefix = fuzzyScore("sk", "skills");
    const boundary = fuzzyScore("rev", "code review");
    const sub = fuzzyScore("ode", "code review");
    const seq = fuzzyScore("cdrv", "code review");
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(seq);
    expect(seq).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "code review")).toBe(0);
  });

  it("is diacritic-insensitive and rewards short targets", () => {
    expect(fuzzyScore("cere", "Cérebro")).toBeGreaterThanOrEqual(100);
    expect(fuzzyScore("run", "Runs")).toBeGreaterThan(fuzzyScore("run", "Runs and history of everything"));
  });

  it("matches keyword aliases but never above a label prefix", () => {
    const item = { id: "reindex", label: "Reindex memory", keywords: ["rebuild", "index", "brain"] };
    expect(scoreItem(item, "rebuild")).toBeGreaterThan(0);
    expect(scoreItem(item, "rebuild")).toBeLessThanOrEqual(90);
    expect(scoreItem(item, "reindex")).toBeGreaterThan(scoreItem(item, "rebuild"));
  });

  it("ranks, filters, limits and keeps input order for ties / empty queries", () => {
    const items = [
      { id: "a", label: "Settings" },
      { id: "b", label: "Skills", keywords: ["sop"] },
      { id: "c", label: "Second Brain", keywords: ["memory", "graph"] },
      { id: "d", label: "Runs" },
    ];
    expect(rankItems(items, "").map((r) => r.item.id)).toEqual(["a", "b", "c", "d"]);
    expect(rankItems(items, "", 2).map((r) => r.item.id)).toEqual(["a", "b"]);
    expect(rankItems(items, "s").map((r) => r.item.id)).toEqual(["a", "b", "c", "d"]);
    expect(rankItems(items, "sop").map((r) => r.item.id)).toEqual(["b"]);
    expect(rankItems(items, "brain").map((r) => r.item.id)).toEqual(["c"]);
    expect(rankItems(items, "zzz")).toEqual([]);
  });

  it("highlightRange splits a substring hit and returns null otherwise", () => {
    expect(highlightRange("Second Brain", "bra")).toEqual(["Second ", "Bra", "in"]);
    expect(highlightRange("Second Brain", "")).toBeNull();
    expect(highlightRange("Second Brain", "xyz")).toBeNull();
  });
});

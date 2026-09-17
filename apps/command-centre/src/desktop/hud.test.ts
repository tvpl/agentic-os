import { describe, expect, it } from "vitest";
import { DEFAULT_HUD, addToHud, freeInstruments, normalizeHud, removeFromHud } from "./hud";

describe("normalizeHud", () => {
  it("falls back to the default composition for anything unreadable", () => {
    expect(normalizeHud(undefined)).toEqual(DEFAULT_HUD);
    expect(normalizeHud(null)).toEqual(DEFAULT_HUD);
    expect(normalizeHud("nope")).toEqual(DEFAULT_HUD);
    expect(normalizeHud({ l: [], r: [] })).toEqual(DEFAULT_HUD);
  });

  it("drops ids this version does not know and keeps the order", () => {
    expect(normalizeHud({ l: ["app:brain", "diagram", "pulse"], r: ["attention", 42] })).toEqual({
      l: ["app:brain", "pulse"],
      r: ["attention"],
    });
  });

  it("keeps an instrument on one arc only — the first that names it", () => {
    expect(normalizeHud({ l: ["pulse"], r: ["pulse", "cost"] })).toEqual({ l: ["pulse"], r: ["cost"] });
  });

  it("respects an empty side when the other one is set", () => {
    expect(normalizeHud({ l: [], r: ["cost"] })).toEqual({ l: [], r: ["cost"] });
  });
});

describe("editing", () => {
  it("removes from whichever arc holds the instrument", () => {
    expect(removeFromHud(DEFAULT_HUD, "runs").r).not.toContain("runs");
    expect(removeFromHud(DEFAULT_HUD, "app:brain").l).not.toContain("app:brain");
  });

  it("adds at the end of a side, moving an instrument that was on the other arc", () => {
    const hud = addToHud(DEFAULT_HUD, "l", "cost");
    expect(hud.l.at(-1)).toBe("cost");
    const moved = addToHud(hud, "r", "cost");
    expect(moved.l).not.toContain("cost");
    expect(moved.r.at(-1)).toBe("cost");
  });

  it("ignores an id outside the catalogue", () => {
    expect(addToHud(DEFAULT_HUD, "r", "diagram")).toBe(DEFAULT_HUD);
  });

  it("offers exactly what is not on an arc", () => {
    const free = freeInstruments(DEFAULT_HUD);
    expect(free).toContain("app:runs");
    expect(free).toContain("cost");
    expect(free).not.toContain("app:pixel");
    expect(free).not.toContain("pulse");
    expect(freeInstruments({ l: [], r: [] }).length).toBeGreaterThan(free.length);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET, dayPhase, isQuiet, readQuietHours, storeQuietHours } from "./rhythm";

const at = (h: number) => new Date(2026, 8, 22, h, 15);

describe("rhythm", () => {
  it("knows the phase of the day", () => {
    expect(dayPhase(at(6))).toBe("morning");
    expect(dayPhase(at(14))).toBe("day");
    expect(dayPhase(at(19))).toBe("evening");
    expect(dayPhase(at(23))).toBe("night");
    expect(dayPhase(at(2))).toBe("night");
  });

  it("keeps quiet across midnight and not otherwise", () => {
    expect(isQuiet(DEFAULT_QUIET, at(23))).toBe(true);
    expect(isQuiet(DEFAULT_QUIET, at(3))).toBe(true);
    expect(isQuiet(DEFAULT_QUIET, at(7))).toBe(false);
    expect(isQuiet(DEFAULT_QUIET, at(12))).toBe(false);
    expect(isQuiet({ enabled: true, start: 13, end: 14 }, at(13))).toBe(true);
    expect(isQuiet({ enabled: false, start: 0, end: 23 }, at(12))).toBe(false);
  });

  it("round-trips and clamps stored hours", () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    storeQuietHours({ enabled: true, start: 25, end: -2 }, s);
    expect(readQuietHours(s)).toEqual({ enabled: true, start: 23, end: 0 });
    m.set("mordomo.quietHours", "nope");
    expect(readQuietHours(s)).toEqual(DEFAULT_QUIET);
  });
});

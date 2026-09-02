import { describe, expect, it } from "vitest";
import { accentContrast, contrastRatio, ensureContrast, parseColor } from "./color";

describe("colour helpers (audit item 17)", () => {
  it("parses hex colours", () => {
    expect(parseColor("#f97316")).toEqual({ r: 249, g: 115, b: 22 });
    expect(parseColor("nope")).toBeNull();
  });

  it("white on the default orange fails AA, so the contrast colour must be dark", () => {
    expect(contrastRatio("#ffffff", "#f97316")).toBeLessThan(4.5);
    expect(contrastRatio(accentContrast("#f97316"), "#f97316")).toBeGreaterThanOrEqual(4.5);
  });

  it("ensureContrast returns a colour with >= 4.5:1 on both grounds", () => {
    for (const bg of ["#0b0a08", "#f5f3ee"]) {
      const text = ensureContrast("#f97316", bg, 4.5);
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

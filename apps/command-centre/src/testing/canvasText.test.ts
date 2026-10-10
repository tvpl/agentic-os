/**
 * Design-system C17, the recording canvas itself: a recorder that skipped a
 * font it cannot read would let text slip through unmeasured, so it reads
 * every unit a canvas font can carry and fails loud on the rest.
 */
import { describe, expect, it } from "vitest";
import { clearTextDrawnOn, recordingContext, textDrawnOn } from "./canvasText";
import { canvasFontPx } from "./fontSize";

const drawn = (font: string, emBase?: number) => {
  const canvas = { width: 100, height: 100 };
  const ctx = recordingContext(canvas, emBase);
  ctx.font = font;
  ctx.fillText("x", 0, 0);
  return textDrawnOn(canvas)[0]!.px;
};

describe("recording canvas (C17)", () => {
  it("C17 reads every unit and keyword of a canvas font size, and fails loud on the rest", () => {
    expect(drawn("12px monospace")).toBe(12);
    expect(drawn("700 12.5px/1.2 ui-monospace, monospace")).toBe(12.5);
    expect(drawn("8pt monospace")).toBeCloseTo(10.667, 2);
    expect(drawn("9pt monospace")).toBeCloseTo(12, 5);
    expect(drawn("0.5rem monospace")).toBe(8);
    expect(drawn("1rem monospace")).toBe(16);
    expect(drawn("0.75em monospace", 16)).toBe(12);
    expect(drawn("50% monospace", 16)).toBe(8);
    expect(drawn("1pc monospace")).toBe(16);
    expect(drawn("0.1in monospace")).toBeCloseTo(9.6, 5);
    expect(drawn("3mm monospace")).toBeCloseTo(11.339, 2);
    expect(drawn("x-small monospace")).toBe(10);
    expect(drawn("small monospace")).toBe(13);
    expect(drawn("italic small-caps bold 10px/14px serif")).toBe(10);
    // a viewport unit counts as 0, the narrowest window: under the floor
    expect(drawn("5vw monospace")).toBe(0);
    // a keyword or a unit this cannot turn into px, a size without a unit or without a family: loud
    for (const bad of [
      "smaller monospace",
      "larger monospace",
      "12 monospace",
      "12px",
      "caption",
      "monospace",
      "",
    ])
      expect(() => drawn(bad), `"${bad}"`).toThrow(/cannot read the size of canvas font/);
    expect(() => canvasFontPx("garbage")).toThrow();
  });

  it("C17 scales what a transform, a sprite blit and a density do to the size", () => {
    const sprite = { width: 96, height: 96 };
    const spriteCtx = recordingContext(sprite);
    spriteCtx.font = "20px mono";
    spriteCtx.fillText("PL", 0, 0);
    const canvas = { width: 200, height: 200 };
    const ctx = recordingContext(canvas);
    ctx.scale(0.5, 0.5);
    ctx.drawImage(sprite as never, 0, 0, 48, 48);
    // 20px baked, shown at half size (48 of 96) under a 0.5 scale: 5px
    expect(textDrawnOn(canvas)[0]!.px).toBeCloseTo(5, 5);
    // the same canvas shown at half its pixel width (density 2): half again
    expect(textDrawnOn(canvas, 100)[0]!.px).toBeCloseTo(2.5, 5);
    clearTextDrawnOn(canvas);
    expect(textDrawnOn(canvas)).toEqual([]);
  });
});

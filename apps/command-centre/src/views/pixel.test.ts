// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_BRUSH, MAX_RECENTS, brushCells, clampBrush, pushRecent, spriteMetadata } from "./PixelStudio";
import { stepFrame } from "./PixelStudio";
import { isValidMicroAppHref } from "./Settings";

describe("pixel studio brush", () => {
  it("clamps the brush to 1…4", () => {
    expect(clampBrush(0)).toBe(1);
    expect(clampBrush(1)).toBe(1);
    expect(clampBrush(MAX_BRUSH + 3)).toBe(MAX_BRUSH);
    expect(clampBrush(2.4)).toBe(2);
  });

  it("paints one cell at size 1 and a square at bigger sizes", () => {
    expect(brushCells(3, 2, 16, 1)).toEqual([2 * 16 + 3]);
    expect(brushCells(3, 2, 16, 2)).toHaveLength(4);
    expect(brushCells(5, 5, 16, 3)).toEqual([
      4 * 16 + 4,
      4 * 16 + 5,
      4 * 16 + 6,
      5 * 16 + 4,
      5 * 16 + 5,
      5 * 16 + 6,
      6 * 16 + 4,
      6 * 16 + 5,
      6 * 16 + 6,
    ]);
  });

  it("clips at the border instead of wrapping to the next row", () => {
    const cells = brushCells(0, 0, 16, 3);
    expect(cells).toEqual([0, 1, 16, 17]);
    expect(brushCells(15, 15, 16, 2).every((i) => i < 16 * 16)).toBe(true);
    expect(brushCells(15, 5, 16, 3).map((i) => i % 16)).not.toContain(0);
  });
});

describe("pixel studio recents", () => {
  it("keeps the newest first, deduped and bounded", () => {
    let list = pushRecent([], "#fff");
    list = pushRecent(list, "#000");
    list = pushRecent(list, "#fff");
    expect(list).toEqual(["#fff", "#000"]);
    for (let i = 0; i < 20; i++) list = pushRecent(list, `#00000${i % 10}`);
    expect(list).toHaveLength(MAX_RECENTS);
  });

  it("ignores the transparent colour", () => {
    expect(pushRecent(["#fff"], null)).toEqual(["#fff"]);
  });
});

describe("pixel studio frame navigation", () => {
  it("wraps at both ends", () => {
    expect(stepFrame(0, 3, -1)).toBe(2);
    expect(stepFrame(2, 3, 1)).toBe(0);
    expect(stepFrame(1, 3, 1)).toBe(2);
    expect(stepFrame(0, 0, 1)).toBe(0);
  });
});

describe("sprite sheet metadata", () => {
  it("describes the sheet an engine has to slice", () => {
    const frames = [
      ["#ff004d", null, null, null],
      [null, "#29adff", "#ff004d", null],
    ];
    const meta = spriteMetadata("hero", frames, 16, 16, 8, new Date("2026-09-03T10:00:00.000Z"));
    expect(meta).toMatchObject({
      name: "hero",
      format: "sprite-sheet",
      frames: 2,
      frameWidth: 256,
      frameHeight: 256,
      sheetWidth: 512,
      sheetHeight: 256,
      scale: 16,
      fps: 8,
      generatedAt: "2026-09-03T10:00:00.000Z",
    });
    expect(meta.palette).toEqual(["#29adff", "#ff004d"]);
    expect(JSON.parse(JSON.stringify(meta)).palette).toHaveLength(2);
  });
});

describe("micro app href validation", () => {
  it("accepts internal routes and http(s) URLs only", () => {
    expect(isValidMicroAppHref("/pixel")).toBe(true);
    expect(isValidMicroAppHref("https://example.com/app")).toBe(true);
    expect(isValidMicroAppHref("http://localhost:3000")).toBe(true);
    expect(isValidMicroAppHref("//evil.example")).toBe(false);
    expect(isValidMicroAppHref("javascript:alert(1)")).toBe(false);
    expect(isValidMicroAppHref("pixel")).toBe(false);
    expect(isValidMicroAppHref("")).toBe(false);
  });
});

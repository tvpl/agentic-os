// @vitest-environment jsdom
/**
 * Design-system C17, the agent's body: the HUD ring inscription and the
 * satellites' labels are at least 12px on screen at every canvas size and
 * pixel density. The inscription is baked on an offscreen canvas and blitted
 * (scaled by 1/dpr), so only the measured product says how large it is.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearTextDrawnOn, installRecordingCanvas, textDrawnOn } from "../../testing/canvasText";
import { EntityHud, type HudFrame, type HudPalette, type Satellite } from "./entityHud";

const FLOOR = 12;

let restore: () => void;
beforeAll(() => {
  restore = installRecordingCanvas();
});
afterAll(() => restore());

const palette: HudPalette = {
  light: false,
  agent: "rgb(34,211,238)",
  sys: "rgb(249,115,22)",
  warn: "rgb(251,191,36)",
  danger: "rgb(248,113,113)",
  ok: "rgb(74,222,128)",
  faint: "rgb(143,134,114)",
  dim: "rgb(179,170,150)",
  plate: "rgb(19,17,9)",
  fs2: 12,
  mono: "ui-monospace, monospace",
};

const frame: HudFrame = {
  time: 2,
  spinA: 0,
  spinB: 0,
  spinText: 0,
  scan: 1,
  scanPhase: 0,
  warm: 1,
  wait: 0,
  waitPulse: 0,
  speak: 0,
  speakPhase: 0,
  typing: 0,
  shockProgress: 0.5,
  shockAmp: 0,
  shockOk: true,
  dim: 1,
  energy: 1,
  coreScale: 1,
};

const satellites: Satellite[] = (["read", "write", "run", "search"] as const).map((kind, i) => ({
  id: `s${i}`,
  kind,
  label: `${kind} src/some/long/path-${i}.ts`,
  born: 0.5,
  slot: i,
}));

describe("HUD text, measured on screen (C17)", () => {
  for (const variant of ["hero", "iris"] as const) {
    for (const [size, dpr] of [
      [260, 1],
      [520, 2],
      [900, 1.5],
    ] as const) {
      it(`${variant} at ${size}px, density ${dpr}: nothing under ${FLOOR}px`, () => {
        const canvas = document.createElement("canvas");
        const hud = new EntityHud(canvas, variant);
        hud.setPalette(palette);
        hud.setMetrics(size * 1.4, size * 1.4, size, dpr);
        hud.setWord("THINKING");
        clearTextDrawnOn(canvas);
        hud.draw(frame, satellites, satellites.length);
        const drawn = textDrawnOn(canvas, size * 1.4);
        const small = drawn
          .filter((t) => t.px < FLOOR - 1e-6)
          .map((t) => `"${t.text}" at ${t.px.toFixed(2)}px`);
        expect(small, small.join("\n")).toEqual([]);
        if (variant === "hero") {
          // Not vacuous: the ring inscription and the satellites' labels are drawn.
          expect(drawn.some((t) => t.text === "T")).toBe(true);
          expect(drawn.some((t) => t.text.startsWith("read"))).toBe(true);
        }
      });
    }
  }
});

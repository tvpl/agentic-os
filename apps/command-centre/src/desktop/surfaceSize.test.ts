/**
 * @vitest-environment jsdom
 * Pure maths, but it reads the registry to check every real widget, and the
 * widgets reach `document` at module scope (same reason as registry.test.ts).
 */
import { describe, expect, it } from "vitest";
import { WIDGET_ORDER } from "./defaultLayout";
import { WIDGET_REGISTRY, hasSurface } from "./registry";
import { DEFAULT_SURFACE_MIN, GROW, availableBox, isViewportBound, surfaceBox } from "./surfaceSize";

const DESKTOP = { w: 1440, h: 900 };

describe("surfaceBox", () => {
  it("grows a widget past its minimum but not without limit", () => {
    const box = surfaceBox({ w: 420, h: 340 }, DESKTOP);
    expect(box.w).toBe(672);
    expect(box.h).toBe(544);
    expect(box.w).toBeGreaterThan(420);
    expect(box.w).toBeLessThan(availableBox(DESKTOP).w);
  });

  it("never exceeds the declared ceiling, which is what the old maximize did", () => {
    for (const id of WIDGET_ORDER) {
      const def = WIDGET_REGISTRY[id];
      if (!hasSurface(def)) continue;
      const min = def.surfaceMin ?? DEFAULT_SURFACE_MIN;
      const box = surfaceBox(def.surfaceMin, DESKTOP);
      expect(box.w, `${id}.w`).toBeLessThanOrEqual(Math.round(min.w * GROW));
      expect(box.h, `${id}.h`).toBeLessThanOrEqual(Math.round(min.h * GROW));
      // and it is still at least the minimum the widget said it needs
      expect(box.w, `${id}.w`).toBeGreaterThanOrEqual(Math.min(min.w, availableBox(DESKTOP).w));
    }
  });

  it("falls back to a modest box for widgets that never declared one", () => {
    expect(surfaceBox(undefined, DESKTOP)).toEqual({
      w: Math.round(DEFAULT_SURFACE_MIN.w * GROW),
      h: Math.round(DEFAULT_SURFACE_MIN.h * GROW),
    });
  });

  it("clamps per axis, so a short window does not also force a wide surface", () => {
    const small = { w: 1024, h: 640 };
    const min = { w: 520, h: 380 };
    const box = surfaceBox(min, small);
    const avail = availableBox(small);
    // Height is what the window cannot give (608 wanted, 468 available)…
    expect(box.h).toBe(avail.h);
    // …width still stops at the widget's own ceiling rather than filling 976.
    expect(box.w).toBe(Math.round(min.w * GROW));
    expect(box.w).toBeLessThan(avail.w);
    expect(isViewportBound(min, small)).toBe(true);
    expect(isViewportBound(min, DESKTOP)).toBe(false);
  });

  it("never returns a box the viewport cannot hold", () => {
    for (const viewport of [
      { w: 1440, h: 900 },
      { w: 1280, h: 800 },
      { w: 1024, h: 768 },
      { w: 800, h: 600 },
      { w: 400, h: 300 },
    ]) {
      for (const id of WIDGET_ORDER) {
        const box = surfaceBox(WIDGET_REGISTRY[id].surfaceMin, viewport);
        expect(box.w, `${id} @ ${viewport.w}`).toBeLessThanOrEqual(Math.max(240, viewport.w));
        expect(box.h, `${id} @ ${viewport.h}`).toBeLessThanOrEqual(Math.max(180, viewport.h));
        expect(box.w).toBeGreaterThan(0);
        expect(box.h).toBeGreaterThan(0);
      }
    }
  });
});

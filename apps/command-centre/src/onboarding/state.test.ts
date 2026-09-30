import { describe, expect, it } from "vitest";
import { clipTarget, freshProgress, parseProgress, placeCoach, TOUR_STEPS } from "./state";
import { tourCopy } from "./copy";

describe("onboarding progress", () => {
  it("recovers from absent, corrupt and incompatible storage", () => {
    for (const raw of [
      null,
      "broken",
      "null",
      "42",
      '{"version":2,"status":"completed"}',
      '{"version":1,"status":"unknown"}',
    ])
      expect(parseProgress(raw)).toEqual(freshProgress());
  });
  it("preserves skip, completion and resumable progress across visits", () => {
    for (const status of ["paused", "completed", "active"] as const) {
      const progress = { ...freshProgress(), status, step: 4, visited: ["desktop", "modes"] as const };
      expect(parseProgress(JSON.stringify(progress))).toEqual(progress);
    }
  });
  it("bounds the step and filters stale or duplicate feature ids", () => {
    expect(
      parseProgress(
        JSON.stringify({
          version: 1,
          status: "active",
          step: 200,
          visited: ["desktop", "old", "desktop", null],
          practiced: "yes",
        }),
      ),
    ).toEqual({ ...freshProgress(), status: "active", step: TOUR_STEPS.length, visited: ["desktop"] });
    expect(parseProgress('{"version":1,"status":"active","step":-3}').step).toBe(0);
    expect(parseProgress('{"version":1,"status":"active","step":1.5}').step).toBe(0);
  });
  it("provides translated, substantive content for every stop", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      const copy = tourCopy(lang);
      expect(Object.keys(copy.steps).sort()).toEqual(TOUR_STEPS.map((s) => s.id).sort());
      for (const step of TOUR_STEPS) {
        expect(copy.steps[step.id].body.length).toBeGreaterThan(40);
        expect(copy.chapters[step.chapter]).toBeTruthy();
      }
    }
  });
});

describe("spotlight geometry", () => {
  it("clips partially scrolled targets and ignores hidden ones", () => {
    expect(clipTarget({ x: -20, y: -40, width: 100, height: 100 }, 390, 844)).toEqual({
      x: 8,
      y: 8,
      width: 80,
      height: 60,
    });
    expect(clipTarget({ x: 0, y: 900, width: 100, height: 100 }, 390, 844)).toBeNull();
  });
  it("keeps the coach clear of a small target and inside mobile screens", () => {
    const card = { x: 0, y: 0, width: 390, height: 450 };
    const desktop = placeCoach({ x: 950, y: 400, width: 450, height: 450 }, 1440, 900, card);
    expect(desktop.x).toBe(20);
    const mobile = placeCoach(null, 320, 568, card);
    expect(mobile.x + mobile.width).toBeLessThanOrEqual(320);
    expect(mobile.y + mobile.height).toBeLessThanOrEqual(568);
    // On a phone the voice line is at the bottom: the coach steps up to the top.
    const voice = placeCoach({ x: 8, y: 470, width: 304, height: 90 }, 320, 568, card);
    expect(voice.y).toBe(12);
    expect(voice.y + voice.height).toBeLessThanOrEqual(470);
  });
});

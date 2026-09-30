import { describe, expect, it } from "vitest";
import type { CoreState } from "../../desktop/coreState";
import {
  GEOMETRY,
  PARAM_KEYS,
  SATELLITE_SLOTS,
  SATELLITE_TTL,
  SPARK_DURATION,
  STATE_PARAMS,
  approach,
  assignSlots,
  clamp01,
  easeInOutSine,
  easeOutCubic,
  frameInterval,
  hashId,
  inscription,
  luminance,
  orbitPoint,
  paramsOf,
  parseColour,
  renderDpr,
  satelliteAlpha,
  satelliteScale,
  shellCount,
  shortLabel,
  slotAngle,
  sparkProgress,
  speakKick,
  stateKick,
  stateWord,
  stepParams,
  waitPulse,
} from "./entityParams";

const STATES: CoreState[] = [
  "idle",
  "listening",
  "queued",
  "thinking",
  "tool",
  "responding",
  "waiting",
  "alert",
  "done",
  "cancelled",
  "interrupted",
];

describe("state table", () => {
  it("has every param, finite and non-negative, for every state", () => {
    for (const s of STATES) {
      const p = STATE_PARAMS[s];
      for (const k of PARAM_KEYS) {
        expect(Number.isFinite(p[k]), `${s}.${k}`).toBe(true);
        expect(p[k], `${s}.${k}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reads the states apart", () => {
    const t = STATE_PARAMS;
    // Work is faster and warmer (the system's amber) than rest.
    expect(t.thinking.flow).toBeGreaterThan(t.idle.flow * 3);
    expect(t.thinking.scan).toBeGreaterThan(0.5);
    expect(t.idle.scan).toBe(0);
    expect(t.thinking.warm).toBeGreaterThan(t.idle.warm);
    // Only waiting shifts to --warn; only responding speaks.
    for (const s of STATES) {
      expect(t[s].wait > 0, s).toBe(s === "waiting");
      expect(t[s].voice > 0, s).toBe(s === "responding");
    }
    // Cancelled dims; interrupted looks like alert.
    expect(t.cancelled.energy).toBeLessThan(t.idle.energy);
    expect(t.interrupted).toEqual(t.alert);
  });

  it("paramsOf returns a mutable copy", () => {
    const p = paramsOf("idle");
    p.energy = 99;
    expect(STATE_PARAMS.idle.energy).not.toBe(99);
  });
});

describe("glide", () => {
  it("approach is frame-rate independent and never overshoots", () => {
    const one = approach(0, 1, 0.1, 0.2);
    let two = 0;
    two = approach(two, 1, 0.05, 0.2);
    two = approach(two, 1, 0.05, 0.2);
    expect(two).toBeCloseTo(one, 10);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    expect(approach(0.5, 1, 0, 0.2)).toBe(0.5);
    expect(approach(0.5, 1, 0.1, 0)).toBe(1);
  });

  it("a state change is ~95% done in 400–800 ms, and not snapped", () => {
    const cur = paramsOf("idle");
    const target = STATE_PARAMS.thinking;
    const frac = () => (cur.flow - STATE_PARAMS.idle.flow) / (target.flow - STATE_PARAMS.idle.flow);
    stepParams(cur, target, 1 / 60);
    expect(frac()).toBeLessThan(0.2);
    for (let i = 1; i < 36; i++) stepParams(cur, target, 1 / 60); // 600 ms
    expect(frac()).toBeGreaterThan(0.9);
    expect(frac()).toBeLessThanOrEqual(1);
  });
});

describe("kicks", () => {
  it("fires shocks, dims and pulses on entry only", () => {
    expect(stateKick("thinking", "alert").shock).toBe("danger");
    expect(stateKick("thinking", "interrupted").shock).toBe("danger");
    expect(stateKick("responding", "done").shock).toBe("ok");
    expect(stateKick("thinking", "cancelled").dim).toBe(true);
    expect(stateKick("thinking", "tool").pulse).toBe(true);
    expect(stateKick("alert", "alert")).toEqual({ shock: null, dim: false, pulse: false });
    expect(stateKick("idle", "thinking")).toEqual({ shock: null, dim: false, pulse: false });
  });

  it("waitPulse is a 0..1 beat with a period of 1.8 s", () => {
    for (let t = 0; t < 4; t += 0.05) {
      const v = waitPulse(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(waitPulse(0.2)).toBeCloseTo(waitPulse(2.0), 6);
    expect(waitPulse(0.216)).toBeGreaterThan(0.95);
  });

  it("speakKick grows with the burst and stays in 0..1", () => {
    expect(speakKick(0)).toBe(0);
    expect(speakKick(Number.NaN)).toBe(0);
    expect(speakKick(10)).toBeLessThan(speakKick(60));
    expect(speakKick(10_000)).toBe(1);
  });
});

describe("easing", () => {
  it("clamps and hits the ends", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeInOutSine(0)).toBeCloseTo(0);
    expect(easeInOutSine(1)).toBeCloseTo(1);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
  });
});

describe("render budget", () => {
  it("caps the pixel ratio at 2, and 1.5 for a big hero", () => {
    expect(renderDpr("hero", 560, 3)).toBe(2);
    expect(renderDpr("hero", 700, 2)).toBe(1.5);
    expect(renderDpr("iris", 700, 3)).toBe(2);
    expect(renderDpr("hero", 560, 1)).toBe(1);
    expect(renderDpr("hero", 560, Number.NaN)).toBe(1);
  });

  it("uses fewer shells when small and never more than the shader's 6", () => {
    expect(shellCount("iris", 44)).toBeLessThan(shellCount("hero", 560));
    for (const s of [40, 400, 560, 700, 1200]) {
      expect(shellCount("hero", s)).toBeLessThanOrEqual(6);
      expect(shellCount("iris", s)).toBeGreaterThanOrEqual(2);
    }
  });

  it("economy runs at ~12 fps", () => {
    expect(frameInterval(false)).toBe(0);
    expect(1000 / frameInterval(true)).toBeCloseTo(12);
  });

  it("the hero's HUD rings sit outside the core and inside the element", () => {
    const g = GEOMETRY.hero;
    const radii = [g.core, g.ringA, g.ringB, g.ringText, g.satellites];
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThan(radii[i - 1]!);
    expect(g.satellites).toBeLessThan(0.5);
    expect(g.core * g.orbital).toBeLessThan(g.ringA);
    expect(GEOMETRY.iris.ringA).toBeLessThan(0.5);
  });
});

describe("satellites", () => {
  it("are born with a spark, hold, and fade out by the TTL", () => {
    expect(sparkProgress(0)).toBe(0);
    expect(sparkProgress(SPARK_DURATION / 2)).toBeCloseTo(0.5);
    expect(sparkProgress(SPARK_DURATION + 0.01)).toBe(-1);
    expect(satelliteAlpha(0)).toBe(0);
    expect(satelliteAlpha(3)).toBe(1);
    expect(satelliteAlpha(SATELLITE_TTL - 0.5)).toBeGreaterThan(0);
    expect(satelliteAlpha(SATELLITE_TTL - 0.5)).toBeLessThan(1);
    expect(satelliteAlpha(SATELLITE_TTL)).toBe(0);
    expect(satelliteAlpha(-1)).toBe(0);
    expect(satelliteScale(0)).toBeCloseTo(0.6);
    expect(satelliteScale(3)).toBeCloseTo(1);
  });

  it("keep their slot and never share one while slots are free", () => {
    const first = assignSlots(["a", "b", "c"], new Map());
    expect(new Set(first.values()).size).toBe(3);
    const second = assignSlots(["b", "c", "d", "e"], first);
    expect(second.get("b")).toBe(first.get("b"));
    expect(second.get("c")).toBe(first.get("c"));
    expect(new Set(second.values()).size).toBe(4);
    const many = Array.from({ length: SATELLITE_SLOTS }, (_, i) => `id-${i}`);
    expect(new Set(assignSlots(many, new Map()).values()).size).toBe(SATELLITE_SLOTS);
  });

  it("prefers the slot its id hashes to", () => {
    const id = "tool-call-42";
    expect(assignSlots([id], new Map()).get(id)).toBe(hashId(id) % SATELLITE_SLOTS);
    expect(hashId(id)).toBe(hashId(id));
    expect(hashId("a")).not.toBe(hashId("b"));
  });

  it("slot angles are evenly spaced around the orbit", () => {
    const step = slotAngle(1) - slotAngle(0);
    expect(step).toBeCloseTo((Math.PI * 2) / SATELLITE_SLOTS);
    const p = orbitPoint(0, 10, 5, 5);
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(5);
    const q = orbitPoint(Math.PI / 2, 10, 0, 0);
    expect(q.y).toBeCloseTo(10);
  });

  it("labels are cleaned and shortened", () => {
    expect(shortLabel("  read   file  ")).toBe("read file");
    const long = shortLabel("a very long label that will not fit on the orbit");
    expect(long.length).toBeLessThanOrEqual(22);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("text and colour", () => {
  it("writes the inscription with the state word", () => {
    expect(stateWord("thinking")).toBe("THINKING");
    expect(inscription("pensando")).toBe("MORDOMO · ONLINE · PENSANDO");
    expect(inscription("  ")).toBe("MORDOMO · ONLINE");
  });

  it("parses the colours the theme uses", () => {
    expect(parseColour("#22d3ee")).toEqual([0x22 / 255, 0xd3 / 255, 0xee / 255]);
    expect(parseColour("#fff")).toEqual([1, 1, 1]);
    expect(parseColour("rgb(255, 0, 128)")).toEqual([1, 0, 128 / 255]);
    expect(parseColour("rgba(0,0,0,0.5)")).toEqual([0, 0, 0]);
    expect(parseColour("color-mix(in srgb, red, blue)")).toBeNull();
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([1, 1, 1])).toBeCloseTo(1);
    expect(luminance(parseColour("#f5f3ee")!)).toBeGreaterThan(0.4);
    expect(luminance(parseColour("#0b0a08")!)).toBeLessThan(0.4);
  });
});

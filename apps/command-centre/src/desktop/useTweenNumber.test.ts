// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { tweenAt, useTweenNumber } from "./useTweenNumber";

describe("tweenAt", () => {
  it("starts at from, ends exactly at to, eases out in between", () => {
    expect(tweenAt(0, 100, 0, 300)).toBe(0);
    expect(tweenAt(0, 100, 300, 300)).toBe(100);
    expect(tweenAt(0, 100, 900, 300)).toBe(100);
    const mid = tweenAt(0, 100, 150, 300);
    expect(mid).toBeGreaterThan(50); // ease-out: more than half way at half time
    expect(mid).toBeLessThan(100);
    expect(tweenAt(5, 5, 10, 300)).toBe(5);
    expect(tweenAt(0, 100, 10, 0)).toBe(100);
  });
});

describe("useTweenNumber", () => {
  let now = 0;
  let frames: Array<(t: number) => void> = [];
  beforeEach(() => {
    now = 0;
    frames = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flush = (ms: number) => {
    now += ms;
    const pending = frames;
    frames = [];
    act(() => {
      for (const cb of pending) cb(now);
    });
  };

  it("renders the initial value immediately and tweens to the next one", () => {
    const { result, rerender } = renderHook(({ v }) => useTweenNumber(v, 300), { initialProps: { v: 10 } });
    expect(result.current).toBe(10);
    rerender({ v: 20 });
    expect(frames.length).toBe(1);
    flush(150);
    expect(result.current).toBeGreaterThan(10);
    expect(result.current).toBeLessThan(20);
    flush(200);
    expect(result.current).toBe(20);
    expect(frames.length).toBe(0); // settled: no more frames requested
  });

  it("jumps straight to the target under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const { result, rerender } = renderHook(({ v }) => useTweenNumber(v, 300), { initialProps: { v: 1 } });
    rerender({ v: 9 });
    expect(result.current).toBe(9);
    expect(frames.length).toBe(0);
  });
});

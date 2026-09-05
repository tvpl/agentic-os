import { describe, expect, it, vi } from "vitest";
import { createCoalescer } from "./coalesce";

describe("createCoalescer", () => {
  it("collapses a burst into one trailing call per key", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const c = createCoalescer<string>((k) => calls.push(k), 300);
    for (let i = 0; i < 25; i++) c.push("run");
    c.push("sessions");
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(299);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.sort()).toEqual(["run", "sessions"]);
    // A new burst after the window fires again.
    c.push("run");
    vi.advanceTimersByTime(300);
    expect(calls.filter((k) => k === "run")).toHaveLength(2);
    vi.useRealTimers();
  });

  it("flush runs what is pending immediately and clear drops it", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const c = createCoalescer<string>((k) => calls.push(k), 300);
    c.push("a");
    c.flush();
    expect(calls).toEqual(["a"]);
    c.push("b");
    c.clear();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["a"]);
    vi.useRealTimers();
  });
});

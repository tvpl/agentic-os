import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  ageDays,
  countPresent,
  cutoffFor,
  histogram,
  isRecent,
  presentAt,
  timelineSpan,
} from "./brainTimeline";

const now = Date.UTC(2026, 8, 26, 12);

describe("brain timeline", () => {
  it("spans from the oldest file to now, in whole days", () => {
    expect(timelineSpan([], now)).toBe(0);
    expect(timelineSpan([now - 1000], now)).toBe(1);
    expect(timelineSpan([now - 10.2 * DAY_MS, now - DAY_MS], now)).toBe(11);
  });

  it("0 days ago is no cutoff; N days ago hides what changed since", () => {
    expect(cutoffFor(0, now)).toBeNull();
    const cut = cutoffFor(5, now)!;
    expect(cut).toBe(now - 5 * DAY_MS);
    expect(presentAt(now - 6 * DAY_MS, cut)).toBe(true);
    expect(presentAt(now - 4 * DAY_MS, cut)).toBe(false);
    expect(presentAt(now, null)).toBe(true);
    expect(countPresent([now - 6 * DAY_MS, now - 4 * DAY_MS, now], cut)).toBe(1);
  });

  it("bins changes oldest first, clamping the edges", () => {
    const h = histogram(
      [now - 9.5 * DAY_MS, now - 0.5 * DAY_MS, now - 0.2 * DAY_MS, now - 30 * DAY_MS],
      now,
      10,
      5,
    );
    expect(h).toHaveLength(5);
    expect(h[0]).toBe(2);
    expect(h[4]).toBe(2);
    expect(h.reduce((a, b) => a + b, 0)).toBe(4);
    expect(histogram([now], now, 0, 3)).toEqual([0, 0, 0]);
  });

  it("ages and recency are relative to the cutoff when there is one", () => {
    expect(ageDays(now - 2.5 * DAY_MS, now)).toBe(2);
    expect(isRecent(now - DAY_MS, now)).toBe(true);
    expect(isRecent(now - 5 * DAY_MS, now)).toBe(false);
    const cut = now - 4 * DAY_MS;
    expect(isRecent(now - 5 * DAY_MS, now, cut)).toBe(true);
    expect(isRecent(now - DAY_MS, now, cut)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isValidCron, isValidTimeZone, nextCronRuns, parseCron } from "./cron";

describe("cron helper", () => {
  it("parses ranges, steps, lists and names", () => {
    const spec = parseCron("*/15 9-17 1,15 jan-mar mon-fri");
    expect([...spec.minute]).toEqual([0, 15, 30, 45]);
    expect(spec.hour.size).toBe(9);
    expect([...spec.dom]).toEqual([1, 15]);
    expect([...spec.month]).toEqual([1, 2, 3]);
    expect([...spec.dow]).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects malformed expressions", () => {
    for (const bad of ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "a b c d e", "*/0 * * * *"]) expect(isValidCron(bad)).toBe(false);
    expect(isValidCron("30 7 * * 1-5")).toBe(true);
  });

  it("computes the next runs in a timezone", () => {
    const from = Date.UTC(2026, 8, 1, 12, 0); // Tue 2026-09-01 12:00Z
    const runs = nextCronRuns("30 7 * * 1-5", "America/Sao_Paulo", 3, from);
    expect(runs).toHaveLength(3);
    // 07:30 São Paulo (UTC-3) = 10:30Z; the first match is Wed 2026-09-02.
    expect(new Date(runs[0]!).toISOString()).toBe("2026-09-02T10:30:00.000Z");
    expect(runs[1]! - runs[0]!).toBe(86_400_000);
  });

  it("weekday 7 means Sunday and empty timezone means local", () => {
    expect([...parseCron("0 0 * * 7").dow]).toEqual([0]);
    expect(isValidTimeZone("")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("returns nothing for an impossible date", () => {
    expect(nextCronRuns("0 0 31 2 *", "UTC", 2, Date.UTC(2026, 0, 1))).toEqual([]);
  });
});

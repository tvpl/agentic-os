import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  intervalMs,
  isWithinActiveHours,
  nextFires,
  nextIntervalSlot,
  wallMinutes,
  type SchedulableRoutine,
} from "./cron";
import { en } from "../locales/backend";
import { tf } from "../i18n";

const at = (iso: string) => new Date(iso).getTime();
/** The real translator, so the tests also prove the keys exist in the dictionary. */
const t = (key: string, vars?: Record<string, string | number>) => tf("en", key as keyof typeof en, vars);

describe("nextFires (routines v2 preview)", () => {
  it("mirrors nextCronRuns for cron routines", () => {
    const r: SchedulableRoutine = { kind: "cron", schedule: "0 9 * * *", timezone: "UTC" };
    const fires = nextFires(r, at("2026-09-03T08:00:00Z"), 3);
    expect(fires).toEqual([
      at("2026-09-03T09:00:00Z"),
      at("2026-09-04T09:00:00Z"),
      at("2026-09-05T09:00:00Z"),
    ]);
  });

  it("returns nothing for an invalid cron or timezone", () => {
    expect(nextFires({ kind: "cron", schedule: "nope" })).toEqual([]);
    expect(nextFires({ kind: "cron", schedule: "" })).toEqual([]);
    expect(nextFires({ kind: "cron", schedule: "0 9 * * *", timezone: "Mars/Olympus" })).toEqual([]);
  });

  it("gives a one-shot exactly one fire, and none once it has passed", () => {
    const r: SchedulableRoutine = { kind: "at", at: "2026-09-03T10:00:00Z" };
    expect(nextFires(r, at("2026-09-03T09:00:00Z"), 5)).toEqual([at("2026-09-03T10:00:00Z")]);
    expect(nextFires(r, at("2026-09-03T11:00:00Z"), 5)).toEqual([]);
    expect(nextFires({ kind: "at", at: "not a date" })).toEqual([]);
  });

  it("walks the interval grid from createdAt", () => {
    const created = at("2026-09-03T00:00:00Z");
    const r: SchedulableRoutine = {
      kind: "every",
      every: { value: 15, unit: "minutes" },
      createdAt: created,
    };
    expect(nextFires(r, at("2026-09-03T00:07:00Z"), 3)).toEqual([
      at("2026-09-03T00:15:00Z"),
      at("2026-09-03T00:30:00Z"),
      at("2026-09-03T00:45:00Z"),
    ]);
    expect(intervalMs({ value: 2, unit: "hours" })).toBe(7_200_000);
    expect(nextIntervalSlot(created, 900_000, created)).toBe(created + 900_000);
    expect(nextFires({ kind: "every", every: null })).toEqual([]);
  });

  it("skips heartbeat slots outside the active window", () => {
    const created = at("2026-09-03T00:00:00Z");
    const r: SchedulableRoutine = {
      kind: "heartbeat",
      timezone: "UTC",
      createdAt: created,
      heartbeat: { intervalMinutes: 60, activeHours: { start: "09:00", end: "12:00", tz: "UTC" } },
    };
    expect(nextFires(r, at("2026-09-03T03:00:00Z"), 4)).toEqual([
      at("2026-09-03T09:00:00Z"),
      at("2026-09-03T10:00:00Z"),
      at("2026-09-03T11:00:00Z"),
      at("2026-09-04T09:00:00Z"),
    ]);
  });

  it("handles an overnight heartbeat window", () => {
    const hours = { start: "22:00", end: "06:00", tz: "UTC" };
    expect(isWithinActiveHours(at("2026-09-03T23:00:00Z"), hours, "UTC")).toBe(true);
    expect(isWithinActiveHours(at("2026-09-03T05:00:00Z"), hours, "UTC")).toBe(true);
    expect(isWithinActiveHours(at("2026-09-03T12:00:00Z"), hours, "UTC")).toBe(false);
    expect(isWithinActiveHours(at("2026-09-03T12:00:00Z"), null, "UTC")).toBe(true);
    const r: SchedulableRoutine = {
      kind: "heartbeat",
      timezone: "UTC",
      createdAt: at("2026-09-03T00:00:00Z"),
      heartbeat: { intervalMinutes: 120, activeHours: hours },
    };
    expect(nextFires(r, at("2026-09-03T12:00:00Z"), 2)).toEqual([
      at("2026-09-03T22:00:00Z"),
      at("2026-09-04T00:00:00Z"),
    ]);
  });

  it("gives on-exit routines no scheduled fire", () => {
    expect(nextFires({ kind: "on-exit", onExit: { skillSlug: "digest" } }, Date.now(), 5)).toEqual([]);
  });

  it("reads wall-clock minutes in a timezone", () => {
    expect(wallMinutes(at("2026-09-03T12:34:00Z"), "UTC")).toBe(12 * 60 + 34);
    // UTC-03 in September.
    expect(wallMinutes(at("2026-09-03T12:34:00Z"), "America/Sao_Paulo")).toBe(9 * 60 + 34);
    expect(wallMinutes(at("2026-09-03T12:34:00Z"), "Mars/Olympus")).toBe(12 * 60 + 34);
  });
});

describe("describeSchedule", () => {
  it("describes every kind with real dictionary strings", () => {
    expect(describeSchedule({ kind: "cron", schedule: "30 7 * * 1-5" }, t)).toBe("Cron 30 7 * * 1-5");
    expect(describeSchedule({ kind: "cron", schedule: "" }, t)).toBe("No cron expression yet");
    expect(describeSchedule({ kind: "cron", schedule: "bogus" }, t)).toContain("Invalid cron");
    expect(describeSchedule({ kind: "at", at: "2026-09-03T10:00:00Z" }, t)).toBe("Once, at 2026-09-03 10:00");
    expect(describeSchedule({ kind: "at", at: null }, t)).toBe("No valid date and time yet");
    expect(describeSchedule({ kind: "every", every: { value: 15, unit: "minutes" } }, t)).toBe(
      "Every 15 min",
    );
    expect(describeSchedule({ kind: "every", every: { value: 3, unit: "hours" } }, t)).toBe("Every 3 h");
    expect(describeSchedule({ kind: "every", every: null }, t)).toBe("No interval yet");
    expect(describeSchedule({ kind: "on-exit", onExit: { skillSlug: "digest" } }, t)).toBe(
      "After every run of /digest",
    );
    expect(describeSchedule({ kind: "on-exit", onExit: null }, t)).toBe("No trigger skill yet");
    expect(describeSchedule({ kind: "heartbeat", heartbeat: { intervalMinutes: 30 } }, t)).toBe(
      "Heartbeat every 30 min",
    );
    expect(
      describeSchedule(
        {
          kind: "heartbeat",
          heartbeat: { intervalMinutes: 30, activeHours: { start: "08:00", end: "20:00" } },
        },
        t,
      ),
    ).toBe("Heartbeat every 30 min, 08:00–20:00");
    expect(describeSchedule({ kind: "heartbeat", heartbeat: null }, t)).toBe("No heartbeat settings yet");
  });

  it("treats a routine without a kind as cron and works without a translator", () => {
    expect(describeSchedule({ schedule: "0 9 * * *" }, t)).toBe("Cron 0 9 * * *");
    expect(describeSchedule({ schedule: "0 9 * * *" })).toBe("backend.sched.cron");
  });

  it("keeps every key it asks for in the dictionary", () => {
    for (const key of Object.keys(en)) {
      if (key.startsWith("backend.sched.")) expect(tf("en", key as keyof typeof en)).not.toBe(key);
    }
  });
});

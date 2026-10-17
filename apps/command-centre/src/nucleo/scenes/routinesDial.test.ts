import { describe, expect, it } from "vitest";
import {
  agendaOrder,
  arcPath,
  cronFiresBetween,
  dayMarks,
  endOfLocalDay,
  fireOutcome,
  firesBetween,
  heartbeatBand,
  localMinutes,
  minuteAngle,
  nextFiring,
  pickNext,
  polar,
  startOfLocalDay,
  type DialRoutine,
} from "./routinesDial";

// Local wall times, so the tests hold in any machine timezone.
const at = (h: number, m = 0, day = 26) => new Date(2026, 8, day, h, m).getTime();
const DAY_START = at(0);
const DAY_END = at(0, 0, 27);
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function routine(over: Partial<DialRoutine> & { name?: string }): DialRoutine & { name: string } {
  return { id: "r", name: "r", enabled: true, kind: "cron", schedule: "0 9 * * *", timezone: "", ...over };
}

describe("clock face", () => {
  it("puts midnight at the top and noon at the bottom, clockwise", () => {
    expect(minuteAngle(0)).toBe(-90);
    expect(minuteAngle(360)).toBe(0);
    expect(minuteAngle(720)).toBe(90);
    expect(polar(300, 100, -90)).toEqual([300, 200]);
    const [x, y] = polar(300, 100, 0);
    expect([x, y]).toEqual([400, 300]);
  });

  it("bounds the local day and reads local minutes", () => {
    expect(startOfLocalDay(at(15, 30))).toBe(DAY_START);
    expect(endOfLocalDay(at(15, 30))).toBe(DAY_END);
    expect(localMinutes(at(9, 30))).toBe(570);
  });

  it("draws clockwise arcs, wrapping and full circles", () => {
    expect(arcPath(300, 100, 0, 90)).toBe("M400 300 A100 100 0 0 1 300 400");
    // 270° clockwise from the right, through the bottom: the large arc.
    expect(arcPath(300, 100, 0, -90)).toMatch(/A100 100 0 1 1 300 200$/);
    expect(arcPath(300, 100, 10, 10)).toBe("");
    expect(arcPath(300, 100, 0, 360).match(/A/g)).toHaveLength(2);
  });
});

describe("firings within a day", () => {
  it("enumerates a cron with several fires a day, local zone", () => {
    const fires = cronFiresBetween("30 8,13,18 * * *", "", DAY_START, DAY_END);
    expect(fires).toEqual([at(8, 30), at(13, 30), at(18, 30)]);
  });

  it("respects weekdays (2026-09-26 is a Saturday)", () => {
    expect(cronFiresBetween("0 9 * * 1-5", "", DAY_START, DAY_END)).toEqual([]);
    expect(cronFiresBetween("0 9 * * 6", "", DAY_START, DAY_END)).toEqual([at(9)]);
  });

  it("converts another zone's wall time to the right instant", () => {
    const fires = cronFiresBetween("0 12 * * *", "UTC", DAY_START - 86_400_000, DAY_END + 86_400_000);
    for (const ts of fires) expect(new Date(ts).getUTCHours()).toBe(12);
    expect(fires.length).toBe(3);
  });

  it("returns nothing for an invalid cron or zone", () => {
    expect(cronFiresBetween("nope", "", DAY_START, DAY_END)).toEqual([]);
    expect(cronFiresBetween("0 9 * * *", "Mars/Olympus", DAY_START, DAY_END)).toEqual([]);
  });

  it("lays an interval on its grid from creation", () => {
    const r = routine({ kind: "every", every: { value: 6, unit: "hours" }, createdAt: at(3, 0, 20) });
    expect(firesBetween(r, DAY_START, DAY_END)).toEqual([at(3), at(9), at(15), at(21)]);
  });

  it("keeps a heartbeat inside its active hours", () => {
    const r = routine({
      kind: "heartbeat",
      heartbeat: { intervalMinutes: 60, activeHours: { start: "08:00", end: "11:00", tz: localTz } },
      createdAt: at(0, 0, 1),
    });
    expect(firesBetween(r, DAY_START, DAY_END)).toEqual([at(8), at(9), at(10)]);
  });

  it("fires `at` once, only on its day, and `on-exit` never", () => {
    const once = routine({ kind: "at", at: new Date(at(17, 45)).toISOString() });
    expect(firesBetween(once, DAY_START, DAY_END)).toEqual([at(17, 45)]);
    expect(firesBetween(once, DAY_END, DAY_END + 86_400_000)).toEqual([]);
    expect(firesBetween(routine({ kind: "on-exit" }), DAY_START, DAY_END)).toEqual([]);
  });
});

describe("marks", () => {
  it("draws a few fires as points and a cadence as a run", () => {
    expect(dayMarks(routine({ schedule: "0 9,18 * * *" }), DAY_START, DAY_END)).toEqual({
      kind: "points",
      times: [at(9), at(18)],
    });
    const dense = dayMarks(routine({ schedule: "*/15 * * * *" }), DAY_START, DAY_END);
    expect(dense.kind).toBe("run");
    expect(dense.kind === "run" && dense.stepMin).toBe(15);
    expect(dense.kind === "run" && dense.times.length).toBe(96);
    const every = dayMarks(
      routine({ kind: "every", every: { value: 2, unit: "hours" }, createdAt: DAY_START }),
      DAY_START,
      DAY_END,
    );
    expect(every).toMatchObject({ kind: "run", stepMin: 120 });
  });

  it("gives a heartbeat its band, and on-exit nothing", () => {
    const hb = routine({
      kind: "heartbeat",
      heartbeat: { intervalMinutes: 30, activeHours: { start: "22:00", end: "06:00", tz: localTz } },
    });
    expect(heartbeatBand(hb, DAY_START)).toEqual({ start: 1320, end: 360 });
    expect(dayMarks(hb, DAY_START, DAY_END)).toMatchObject({ kind: "band", start: 1320, end: 360 });
    expect(
      heartbeatBand(routine({ kind: "heartbeat", heartbeat: { intervalMinutes: 5 } }), DAY_START),
    ).toEqual({
      start: 0,
      end: 1440,
    });
    expect(dayMarks(routine({ kind: "on-exit" }), DAY_START, DAY_END)).toEqual({ kind: "none" });
  });
});

describe("next", () => {
  it("trusts the server's nextRunAt while it is ahead, else previews", () => {
    const now = at(10);
    expect(nextFiring(routine({ nextRunAt: at(12) }), now)).toBe(at(12));
    expect(nextFiring(routine({ nextRunAt: at(8), schedule: "0 11 * * *" }), now)).toBe(at(11));
    expect(nextFiring(routine({ enabled: false, nextRunAt: at(12) }), now)).toBeNull();
    expect(nextFiring(routine({ kind: "on-exit" }), now)).toBeNull();
  });

  it("picks the soonest and orders the agenda", () => {
    const now = at(10);
    const a = routine({ id: "a", name: "a", schedule: "0 18 * * *" });
    const b = routine({ id: "b", name: "b", schedule: "30 10 * * *" });
    const c = routine({ id: "c", name: "c", kind: "on-exit" });
    const d = routine({ id: "d", name: "d", enabled: false });
    expect(pickNext([a, b, c, d], now)).toEqual({ routine: b, at: at(10, 30) });
    expect(agendaOrder([d, c, a, b], now).map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(pickNext([c, d], now)).toBeNull();
  });
});

describe("outcomes", () => {
  it("reads run and history statuses", () => {
    expect(fireOutcome("done")).toBe("ok");
    expect(fireOutcome("timed_out")).toBe("fail");
    expect(fireOutcome(null, "failed")).toBe("fail");
    expect(fireOutcome("running")).toBe("live");
    expect(fireOutcome(null, "skipped")).toBe("skip");
    expect(fireOutcome(null, "failed_to_fire")).toBe("fail");
    expect(fireOutcome(null, "manual")).toBe("ok");
    expect(fireOutcome(null, null)).toBe("skip");
  });
});

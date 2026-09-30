import { describe, expect, it } from "vitest";
import { cronShape, scheduleInWords, weekdayNames, type Translate } from "./routinesWords";

/** A translator that shows the key and its vars, so the tests read the shape. */
const t: Translate = (key, vars) =>
  vars
    ? `${key}(${Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")})`
    : key;

describe("cronShape", () => {
  it("reads cadences", () => {
    expect(cronShape("* * * * *")).toEqual({ k: "everyMinute" });
    expect(cronShape("*/15 * * * *")).toEqual({ k: "everyNMin", n: 15 });
    expect(cronShape("0,20,40 * * * *")).toEqual({ k: "everyNMin", n: 20 });
    expect(cronShape("5 * * * *")).toEqual({ k: "hourly", minute: 5 });
    expect(cronShape("0 */3 * * *")).toEqual({ k: "everyNHours", n: 3, minute: 0 });
  });

  it("reads fixed times on days", () => {
    expect(cronShape("0 9 * * *")).toEqual({ k: "times", times: ["09:00"], days: { k: "daily" } });
    expect(cronShape("30 8,18 * * 1-5")).toEqual({
      k: "times",
      times: ["08:30", "18:30"],
      days: { k: "weekdays" },
    });
    expect(cronShape("0 10 * * sat,sun")).toMatchObject({ days: { k: "weekends" } });
    expect(cronShape("0 9 * * 1,3")).toMatchObject({ days: { k: "dow", days: [1, 3] } });
    expect(cronShape("0 7 1 * *")).toMatchObject({ days: { k: "dom", day: 1 } });
  });

  it("gives up on shapes it cannot say", () => {
    expect(cronShape("0 9 1 1 *").k).toBe("raw");
    expect(cronShape("0 9 1 * 1").k).toBe("raw");
    expect(cronShape("0 1,2,3,4,5 * * *").k).toBe("raw");
    expect(cronShape("garbage").k).toBe("raw");
  });
});

describe("scheduleInWords", () => {
  const tz = "America/Sao_Paulo";
  it("spells cron shapes, with the zone only when it is not the local one", () => {
    expect(scheduleInWords({ kind: "cron", schedule: "0 9 * * 1-5", timezone: tz }, t, "en", tz)).toBe(
      "scene.routines.w.weekdays(times=09:00)",
    );
    expect(scheduleInWords({ kind: "cron", schedule: "0 9,18 * * *", timezone: "UTC" }, t, "en", tz)).toBe(
      "scene.routines.w.daily(times=scene.routines.w.and(a=09:00,b=18:00)) (UTC)",
    );
    expect(scheduleInWords({ kind: "cron", schedule: "*/5 * * * *" }, t, "en", tz)).toBe(
      "scene.routines.w.everyNMin(n=5)",
    );
    expect(scheduleInWords({ kind: "cron", schedule: "0 9 1 1 *" }, t, "en", tz)).toBe(
      "backend.sched.cron(expr=0 9 1 1 *)",
    );
  });

  it("falls back to the editor's words for the other kinds", () => {
    expect(scheduleInWords({ kind: "every", every: { value: 30, unit: "minutes" } }, t, "en", tz)).toBe(
      "backend.sched.every.minutes(n=30)",
    );
    expect(
      scheduleInWords({ kind: "on-exit", onExit: { skillSlug: "x" }, timezone: "UTC" }, t, "en", tz),
    ).toBe("backend.sched.onExit(skill=x)");
    expect(scheduleInWords({ kind: "at", at: "2026-09-27T12:00:00Z" }, t, "en", tz)).toMatch(
      /^scene\.routines\.w\.once\(date=.+,time=.+\)$/,
    );
  });

  it("names weekdays in the locale", () => {
    expect(weekdayNames([1, 3], "en-GB")).toBe("Mon, Wed");
    expect(weekdayNames([0], "pt-BR").toLowerCase()).toBe("dom");
  });
});

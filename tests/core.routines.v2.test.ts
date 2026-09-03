import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import {
  RoutineScheduler,
  RoutineSchema,
  RoutineStore,
  RunManager,
  SettingsStore,
  SkillCatalog,
  events,
  intervalMs,
  isHeartbeatOk,
  isWithinActiveHours,
  nextAtRun,
  nextEveryRun,
  nextHeartbeatRun,
  nextIntervalSlot,
  nextRunAt,
  openDb,
  startOfDayIn,
  validateCron,
  validateRoutine,
  type AgentAdapter,
  type Db,
  type MordomoPaths,
  type ProviderId,
  type Routine,
} from "@mordomo/core";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, makeTempHome, withFakeBinPath } from "./helpers.js";

let restorePath: () => void;
beforeAll(() => {
  restorePath = withFakeBinPath();
});
afterAll(() => restorePath());

let ctx: { paths: MordomoPaths; cleanup: () => void };
let db: Db;
let settings: SettingsStore;
let runs: RunManager;
let store: RoutineStore;
let scheduler: RoutineScheduler;

const adapterFor = (_id: ProviderId): AgentAdapter =>
  new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function routine(overrides: Partial<Routine> & { id: string }): Routine {
  return RoutineSchema.parse({ name: overrides.id, prompt: "say hi", enabled: true, ...overrides });
}

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  settings = new SettingsStore(ctx.paths);
  runs = new RunManager(db, ctx.paths, () => settings.load(), adapterFor);
  store = new RoutineStore(ctx.paths);
  scheduler = new RoutineScheduler(db, ctx.paths, store, runs, new SkillCatalog(ctx.paths), () =>
    settings.load(),
  );
});

afterEach(async () => {
  scheduler.stop();
  await runs.shutdown(1000);
  await scheduler.drain();
  db.close();
  ctx.cleanup();
});

describe("routines v2 · schema and validation", () => {
  it("parses a v1 file (cron only) as kind cron with the v2 defaults", () => {
    const parsed = RoutineSchema.parse({ id: "legacy", name: "Legacy", prompt: "hi", schedule: "0 9 * * *" });
    expect(parsed.kind).toBe("cron");
    expect(parsed.runner).toBe("local");
    expect(parsed.context).toBe("main");
    expect(parsed.delivery).toBe("announce");
    expect(parsed.endedReason).toBeNull();
  });

  it("requires the fields of the declared kind", () => {
    const check = (r: Routine) => () => validateRoutine(r, validateCron);
    expect(check(routine({ id: "a", kind: "cron", schedule: "" }))).toThrow(/cron routine needs/i);
    expect(check(routine({ id: "b", kind: "at", at: null }))).toThrow(/"at" datetime/);
    expect(check(routine({ id: "c", kind: "at", at: "not a date" }))).toThrow(/Invalid "at"/);
    expect(check(routine({ id: "d", kind: "every", every: null }))).toThrow(/"every"/);
    expect(check(routine({ id: "e", kind: "on-exit", onExit: null }))).toThrow(/onExit.skillSlug/);
    expect(check(routine({ id: "f", kind: "heartbeat", heartbeat: null }))).toThrow(/heartbeat/);
    expect(
      check(
        routine({
          id: "g",
          kind: "heartbeat",
          heartbeat: {
            intervalMinutes: 10,
            quiet: true,
            okToken: "OK",
            activeHours: { start: "09:00", end: "09:00", tz: "" },
          },
        }),
      ),
    ).toThrow(/at least one minute/);
    expect(check(routine({ id: "ok", kind: "every", every: { value: 5, unit: "minutes" } }))).not.toThrow();
  });

  it("refuses an on-exit routine that would trigger on its own skill", () => {
    const r = routine({
      id: "loop",
      skillSlug: "digest",
      prompt: null,
      kind: "on-exit",
      onExit: { skillSlug: "digest", statuses: ["done"] },
    });
    expect(() => validateRoutine(r, validateCron)).toThrow(/infinite loop/i);
  });

  it("refuses webhook delivery unless the settings flag allows it, and validates the URL", () => {
    const r = routine({
      id: "hook",
      kind: "every",
      every: { value: 5, unit: "minutes" },
      delivery: "webhook",
      webhookUrl: "https://example.test/x",
    });
    expect(() => validateRoutine(r, validateCron)).toThrow(/allowWebhooks/);
    expect(() => validateRoutine(r, validateCron, { allowWebhooks: true })).not.toThrow();
    expect(() => validateRoutine({ ...r, webhookUrl: null }, validateCron, { allowWebhooks: true })).toThrow(
      /needs "webhookUrl"/,
    );
    expect(() =>
      validateRoutine({ ...r, webhookUrl: "ftp://x/y" }, validateCron, { allowWebhooks: true }),
    ).toThrow(/http\(s\)/);
    expect(() =>
      validateRoutine({ ...r, webhookUrl: "not a url" }, validateCron, { allowWebhooks: true }),
    ).toThrow(/Invalid webhookUrl/);
  });

  it("requires a remote name for a remote runner", () => {
    const r = routine({ id: "vps", kind: "every", every: { value: 5, unit: "minutes" }, runner: "remote" });
    expect(() => validateRoutine(r, validateCron)).toThrow(/remoteName/);
    expect(() => validateRoutine({ ...r, remoteName: "hermes" }, validateCron)).not.toThrow();
  });

  it("the store refuses a webhook routine by default", () => {
    const r = routine({
      id: "hooked",
      kind: "every",
      every: { value: 5, unit: "minutes" },
      delivery: "webhook",
      webhookUrl: "https://x.test/y",
    });
    expect(() => store.save(r)).toThrow(/allowWebhooks/);
    expect(() => store.save(r, { allowWebhooks: true })).not.toThrow();
  });
});

describe("routines v2 · nextRunAt per kind", () => {
  const at = (iso: string) => new Date(iso).getTime();

  it("cron keeps the v1 behaviour", () => {
    const r = routine({ id: "c", kind: "cron", schedule: "0 9 * * *", timezone: "UTC" });
    expect(nextRunAt(r, at("2026-09-03T08:00:00Z"))).toBe(at("2026-09-03T09:00:00Z"));
  });

  it("at returns the instant while it is ahead, then null", () => {
    const r = routine({ id: "a", kind: "at", at: "2026-09-03T10:00:00Z" });
    expect(nextRunAt(r, at("2026-09-03T09:00:00Z"))).toBe(at("2026-09-03T10:00:00Z"));
    expect(nextRunAt(r, at("2026-09-03T10:00:01Z"))).toBeNull();
    expect(nextAtRun(routine({ id: "a2", kind: "at", at: "nope" }), Date.now())).toBeNull();
  });

  it("every walks the grid anchored at createdAt", () => {
    const created = at("2026-09-03T00:00:00Z");
    const r = routine({ id: "e", kind: "every", every: { value: 15, unit: "minutes" }, createdAt: created });
    expect(intervalMs({ value: 15, unit: "minutes" })).toBe(900_000);
    expect(intervalMs({ value: 2, unit: "hours" })).toBe(7_200_000);
    expect(nextEveryRun(r, at("2026-09-03T00:07:00Z"))).toBe(at("2026-09-03T00:15:00Z"));
    // Exactly on a slot: the next one is strictly after.
    expect(nextEveryRun(r, at("2026-09-03T00:15:00Z"))).toBe(at("2026-09-03T00:30:00Z"));
    expect(nextIntervalSlot(created, 900_000, created - 1)).toBe(created);
  });

  it("on-exit is event driven: no scheduled time", () => {
    const r = routine({ id: "x", kind: "on-exit", onExit: { skillSlug: "digest", statuses: ["done"] } });
    expect(nextRunAt(r)).toBeNull();
  });

  it("heartbeat skips slots outside the active window, including overnight windows", () => {
    const created = at("2026-09-03T00:00:00Z");
    const day = routine({
      id: "h",
      kind: "heartbeat",
      createdAt: created,
      timezone: "UTC",
      heartbeat: {
        intervalMinutes: 60,
        quiet: true,
        okToken: "HEARTBEAT_OK",
        activeHours: { start: "09:00", end: "17:00", tz: "UTC" },
      },
    });
    expect(nextHeartbeatRun(day, at("2026-09-03T03:00:00Z"), "UTC")).toBe(at("2026-09-03T09:00:00Z"));
    expect(nextHeartbeatRun(day, at("2026-09-03T17:00:00Z"), "UTC")).toBe(at("2026-09-04T09:00:00Z"));

    const night = {
      ...day,
      heartbeat: { ...day.heartbeat!, activeHours: { start: "22:00", end: "06:00", tz: "UTC" } },
    };
    expect(nextHeartbeatRun(night, at("2026-09-03T12:00:00Z"), "UTC")).toBe(at("2026-09-03T22:00:00Z"));
    expect(
      isWithinActiveHours(at("2026-09-03T23:30:00Z"), { start: "22:00", end: "06:00", tz: "UTC" }, "UTC"),
    ).toBe(true);
    expect(
      isWithinActiveHours(at("2026-09-03T12:00:00Z"), { start: "22:00", end: "06:00", tz: "UTC" }, "UTC"),
    ).toBe(false);
    expect(isWithinActiveHours(at("2026-09-03T12:00:00Z"), null, "UTC")).toBe(true);
  });

  it("a disabled routine never reports a next run", () => {
    expect(
      nextRunAt(routine({ id: "off", kind: "every", every: { value: 1, unit: "hours" }, enabled: false })),
    ).toBeNull();
  });

  it("startOfDayIn respects the timezone", () => {
    const noonUtc = at("2026-09-03T12:00:00Z");
    expect(startOfDayIn(noonUtc, "UTC")).toBe(at("2026-09-03T00:00:00Z"));
    // UTC-03: local midnight of the 3rd is 03:00Z.
    expect(startOfDayIn(noonUtc, "America/Sao_Paulo")).toBe(at("2026-09-03T03:00:00Z"));
  });

  it("recognises the quiet token in a heartbeat summary", () => {
    expect(isHeartbeatOk("everything fine HEARTBEAT_OK", "HEARTBEAT_OK")).toBe(true);
    expect(isHeartbeatOk("disk almost full", "HEARTBEAT_OK")).toBe(false);
  });
});

describe("routines v2 · scheduler", () => {
  it("fires a one-shot and disables it with run_once_fired", async () => {
    store.save(routine({ id: "once", kind: "at", at: new Date(Date.now() + 250).toISOString() }));
    scheduler.start();
    await wait(1200);
    scheduler.stop();
    await scheduler.drain();
    const after = store.get("once")!;
    expect(after.enabled).toBe(false);
    expect(after.endedReason).toBe("run_once_fired");
    expect(scheduler.history("once").some((h) => h.status === "fired")).toBe(true);
  }, 15_000);

  it("ends a one-shot whose instant passed while the service was off (missedPolicy skip)", () => {
    store.save(routine({ id: "missed", kind: "at", at: new Date(Date.now() - 60_000).toISOString() }));
    scheduler.start();
    scheduler.stop();
    const after = store.get("missed")!;
    expect(after.enabled).toBe(false);
    expect(after.endedReason).toBe("run_once_missed");
    expect(scheduler.history("missed")[0]).toMatchObject({ status: "skipped" });
  });

  it("catches a missed one-shot up when the policy says so", async () => {
    store.save(
      routine({
        id: "boot-once",
        kind: "at",
        at: new Date(Date.now() - 60_000).toISOString(),
        missedPolicy: "run_on_boot",
      }),
    );
    scheduler.start();
    await wait(80);
    scheduler.stop();
    await scheduler.drain();
    expect(scheduler.history("boot-once")[0]).toMatchObject({ status: "caught_up" });
    expect(store.get("boot-once")!.endedReason).toBe("run_once_fired");
  }, 15_000);

  it("fires an on-exit routine when a run of the trigger skill finishes", async () => {
    store.save(
      routine({
        id: "after-digest",
        kind: "on-exit",
        onExit: { skillSlug: "workspace-digest", statuses: ["queued"] },
      }),
    );
    store.save(
      routine({
        id: "after-other",
        kind: "on-exit",
        onExit: { skillSlug: "something-else", statuses: ["queued"] },
      }),
    );
    scheduler.start();
    const trigger = runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "trigger",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      skillSlug: "workspace-digest",
    });
    events.emit("run.finished", { runId: trigger.id, status: trigger.status });
    for (let i = 0; i < 40 && scheduler.history("after-digest").length === 0; i++) await wait(50);
    scheduler.stop();
    await scheduler.drain();
    const history = scheduler.history("after-digest");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]!.note).toContain(trigger.id);
    // A routine listening on another skill must not fire.
    expect(scheduler.history("after-other")).toHaveLength(0);
  }, 15_000);

  it.skipIf(!FAKE_CLIS_RUNNABLE)(
    "marks a heartbeat fire quiet when the summary carries the OK token",
    async () => {
      // The fake CLI always answers "All done. …", so that string is our OK token.
      store.save(
        routine({
          id: "hb-quiet",
          kind: "heartbeat",
          heartbeat: { intervalMinutes: 60, quiet: true, okToken: "All done", activeHours: null },
        }),
      );
      await scheduler.fire("hb-quiet");
      await scheduler.drain();
      expect(scheduler.history("hb-quiet")[0]!.outcome).toBe("quiet");
    },
    20_000,
  );

  it.skipIf(!FAKE_CLIS_RUNNABLE)(
    "raises an alert when a heartbeat fire does not carry the token",
    async () => {
      store.save(
        routine({
          id: "hb-alert",
          kind: "heartbeat",
          heartbeat: { intervalMinutes: 60, quiet: true, okToken: "HEARTBEAT_OK", activeHours: null },
        }),
      );
      const alerts: unknown[] = [];
      const off = events.subscribe(
        (e) => e.type === ("routine.alert" as typeof e.type) && alerts.push(e.payload),
      );
      try {
        await scheduler.fire("hb-alert");
        await scheduler.drain();
      } finally {
        off();
      }
      expect(scheduler.history("hb-alert")[0]!.outcome).toBe("alert");
      expect(alerts).toHaveLength(1);
    },
    20_000,
  );

  it.skipIf(!FAKE_CLIS_RUNNABLE)(
    "tags routine runs with the routine id and honours the isolated context",
    async () => {
      store.save(
        routine({ id: "iso", kind: "every", every: { value: 60, unit: "minutes" }, context: "isolated" }),
      );
      const { runId } = await scheduler.fire("iso");
      await scheduler.drain();
      const record = runs.get(runId)!;
      expect(record.routineId).toBe("iso");
      expect(record.origin).toBe("routine");
      expect(record.cwd).not.toBe(ctx.paths.home);
    },
    20_000,
  );

  it("keeps a silent delivery out of the event bus", async () => {
    store.save(
      routine({ id: "quiet", kind: "every", every: { value: 60, unit: "minutes" }, delivery: "none" }),
    );
    const seen: unknown[] = [];
    const off = events.subscribe((e) => e.type === "routine.fired" && seen.push(e.payload));
    try {
      await scheduler.fire("quiet");
      await scheduler.drain();
    } finally {
      off();
    }
    expect(seen).toHaveLength(0);
  }, 20_000);
});

describe("routines v2 · runner, summary and hygiene", () => {
  it("reports the runner from the routine file and the service probe", () => {
    store.save(routine({ id: "local-one", kind: "every", every: { value: 60, unit: "minutes" } }));
    store.save(
      routine({
        id: "remote-one",
        kind: "every",
        every: { value: 60, unit: "minutes" },
        runner: "remote",
        remoteName: "hermes",
      }),
    );
    const byId = new Map(scheduler.status().map((r) => [r.id, r]));
    expect(byId.get("remote-one")!.runner).toBe("remote");
    // No OS unit is installed inside a temp home, so a non-remote routine is local.
    expect(byId.get("local-one")!.runner).toBe("local");
  });

  it("summarises fired/total today and the counts per runner and kind", async () => {
    // Pin the clock to midday UTC: "due today" is a wall-clock question, and an
    // hourly routine created in the last hour of the day is genuinely due
    // tomorrow. Only Date is faked so the scheduler's real timers still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
    try {
      store.save(routine({ id: "a", kind: "every", every: { value: 60, unit: "minutes" } }));
      store.save(routine({ id: "b", kind: "cron", schedule: "0 3 1 1 *" })); // far away: not due today
      store.save(
        routine({
          id: "c",
          kind: "every",
          every: { value: 60, unit: "minutes" },
          runner: "remote",
          remoteName: "hermes",
        }),
      );
      await scheduler.fire("a");
      await scheduler.drain();
      const summary = scheduler.summary();
      expect(summary.firedToday).toBe(1);
      expect(summary.totalToday).toBeGreaterThanOrEqual(2);
      expect(summary.byRunner).toMatchObject({ local: 2, remote: 1 });
      expect(summary.byKind).toMatchObject({ every: 2, cron: 1 });
      expect(scheduler.status().find((r) => r.id === "a")!.firedToday).toBe(true);
      expect(scheduler.status().find((r) => r.id === "b")!.firedToday).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it("lists silent routines with the reason", async () => {
    store.save(routine({ id: "never", kind: "every", every: { value: 60, unit: "minutes" } }));
    const silent = scheduler.silent(30);
    expect(silent.map((s) => s.id)).toContain("never");
    expect(silent.find((s) => s.id === "never")!.reason).toBe("never_fired");
    await Promise.resolve();
  });

  it.skipIf(!FAKE_CLIS_RUNNABLE)(
    "counts failures inside the window as the reason",
    async () => {
      process.env.FAKE_CLAUDE_FAIL = "1";
      try {
        store.save(routine({ id: "flaky", kind: "every", every: { value: 60, unit: "minutes" } }));
        await scheduler.fire("flaky");
        await scheduler.drain();
        const entry = scheduler.silent(30).find((s) => s.id === "flaky")!;
        expect(entry.reason).toBe("failures");
        expect(entry.failuresInWindow).toBeGreaterThan(0);
      } finally {
        delete process.env.FAKE_CLAUDE_FAIL;
      }
    },
    20_000,
  );
});

import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { Cron } from "croner";
import {
  RoutineScheduler,
  RoutineStore,
  RoutineSchema,
  RunManager,
  SettingsStore,
  SkillCatalog,
  openDb,
  events,
  previousScheduledTime,
  type Db,
  type MordomoPaths,
  type AgentAdapter,
  type ProviderId,
  type Routine,
  type RunRecord,
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
  return RoutineSchema.parse({
    name: overrides.id,
    prompt: "say hi",
    schedule: "0 0 1 1 *",
    enabled: true,
    ...overrides,
  });
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
  delete process.env.FAKE_CLAUDE_HANG;
  delete process.env.FAKE_CLAUDE_FAIL;
});

describe("routine scheduler", () => {
  it.skipIf(!FAKE_CLIS_RUNNABLE)("fire() resolves with the real run id before the run finishes", async () => {
    store.save(routine({ id: "manual" }));
    const fired: unknown[] = [];
    const off = events.subscribe((e) => e.type === "routine.fired" && fired.push(e.payload));
    try {
      const { runId, status } = await scheduler.fire("manual");
      expect(status).toBe("queued");
      expect(["queued", "running"]).toContain(runs.get(runId)!.status);
      expect(fired).toEqual([{ routineId: "manual", runId }]);
      await scheduler.drain();
      expect(runs.get(runId)!.status).toBe("done");
      const history = scheduler.history("manual");
      expect(history[0]).toMatchObject({ runId, status: "fired", note: "Manual test run." });
    } finally {
      off();
    }
  });

  it("throws 404 for unknown routines and 400 for a missing skill", async () => {
    await expect(scheduler.fire("nope")).rejects.toMatchObject({ statusCode: 404 });
    store.save(routine({ id: "noskill", prompt: null, skillSlug: "does-not-exist" }));
    await expect(scheduler.fire("noskill")).rejects.toMatchObject({ statusCode: 400 });
    expect(runs.list()).toHaveLength(0);
  });

  it("fires on schedule and records failed_to_fire from the cron tick", async () => {
    store.save(routine({ id: "tick", schedule: "* * * * * *" }));
    store.save(routine({ id: "broken", schedule: "* * * * * *", prompt: null, skillSlug: "missing" }));
    scheduler.start();
    await wait(1600);
    scheduler.stop();
    await scheduler.drain();
    expect(scheduler.history("tick").some((h) => h.status === "fired" && h.runId)).toBe(true);
    expect(scheduler.history("broken")[0]).toMatchObject({ status: "failed_to_fire", runId: null });
    expect(scheduler.history("broken")[0]!.note).toContain("missing");
  }, 10_000);

  it.skipIf(!FAKE_CLIS_RUNNABLE)(
    "skips ticks while a previous firing is still in flight",
    async () => {
      process.env.FAKE_CLAUDE_HANG = "1";
      store.save(routine({ id: "slow", schedule: "* * * * * *", timeoutMs: 60_000 }));
      scheduler.start();
      await wait(2600);
      scheduler.stop();
      const history = scheduler.history("slow");
      expect(history.filter((h) => h.status === "fired")).toHaveLength(1);
      expect(history.filter((h) => h.status === "skipped").length).toBeGreaterThanOrEqual(1);
      await expect(scheduler.fire("slow")).rejects.toMatchObject({ statusCode: 409 });
    },
    15_000,
  );

  it("retries as a new run linked by parentRunId", async () => {
    process.env.FAKE_CLAUDE_FAIL = "1";
    store.save(routine({ id: "retry", maxAttempts: 2, backoffMs: 0 }));
    const { runId } = await scheduler.fire("retry");
    await scheduler.drain();
    const chain = runs.list({ parentRunId: runId }).sort((a, b) => a.attempts - b.attempts);
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ id: runId, parentRunId: null, attempts: 1, status: "failed" });
    expect(chain[1]).toMatchObject({ parentRunId: runId, attempts: 2, status: "failed" });
    expect(chain[1]!.id).not.toBe(runId);
    expect(scheduler.history("retry")[0]!.note).toContain("Retry 2/2");
  });

  it("catches up a missed run_on_boot routine once, filling in the run id", async () => {
    store.save(routine({ id: "boot", schedule: "* * * * *", missedPolicy: "run_on_boot" }));
    store.save(routine({ id: "skip", schedule: "* * * * *", missedPolicy: "skip" }));
    scheduler.start();
    await wait(50);
    scheduler.stop();
    await scheduler.drain();
    const history = scheduler.history("boot");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "caught_up" });
    expect(history[0]!.runId).toBeTruthy();
    expect(history[0]!.scheduledFor).toBeLessThan(Date.now());
    expect(scheduler.history("skip")).toHaveLength(0);
    // Second boot: already caught up for that slot.
    scheduler.start();
    scheduler.stop();
    expect(scheduler.history("boot")).toHaveLength(1);
  });

  it("uses settings.timezone when the routine has none", () => {
    settings.update({ timezone: "America/Sao_Paulo" });
    store.save(routine({ id: "tz", schedule: "0 12 * * *", timezone: "" }));
    const status = scheduler.status().find((r) => r.id === "tz")!;
    const expected = new Cron("0 12 * * *", { timezone: "America/Sao_Paulo", paused: true })
      .nextRun()!
      .getTime();
    const utc = new Cron("0 12 * * *", { timezone: "UTC", paused: true }).nextRun()!.getTime();
    expect(status.nextRunAt).toBe(expected);
    expect(status.nextRunAt).not.toBe(utc);
  });
});

describe("retry policy (fake run manager)", () => {
  function fakeRuns(statuses: RunRecord["status"][]) {
    const created: Array<{ id: string; parentRunId: string | null; attempts: number }> = [];
    const records = new Map<string, RunRecord>();
    let n = 0;
    const fake = {
      create(input: { parentRunId?: string | null; attempts?: number }) {
        const id = `r${++n}`;
        created.push({ id, parentRunId: input.parentRunId ?? null, attempts: input.attempts ?? 1 });
        const rec = {
          id,
          status: "queued",
          parentRunId: input.parentRunId ?? null,
          attempts: input.attempts ?? 1,
        } as RunRecord;
        records.set(id, rec);
        return rec;
      },
      async execute(id: string) {
        const rec = records.get(id)!;
        rec.status = statuses[Math.min(created.length - 1, statuses.length - 1)]!;
        return rec;
      },
      get: (id: string) => records.get(id) ?? null,
    };
    return { fake: fake as unknown as RunManager, created };
  }

  it("does not retry a timeout unless retryOnTimeout is set", async () => {
    for (const [retryOnTimeout, expected] of [
      [false, 1],
      [true, 3],
    ] as const) {
      const { fake, created } = fakeRuns(["timed_out"]);
      const s = new RoutineScheduler(db, ctx.paths, store, fake, new SkillCatalog(ctx.paths), () =>
        settings.load(),
      );
      store.save(routine({ id: `t-${retryOnTimeout}`, maxAttempts: 3, backoffMs: 0, retryOnTimeout }));
      await s.fire(`t-${retryOnTimeout}`);
      await s.drain();
      expect(created).toHaveLength(expected);
    }
  });

  it("stop() cancels the backoff sleep", async () => {
    const { fake, created } = fakeRuns(["failed"]);
    const s = new RoutineScheduler(db, ctx.paths, store, fake, new SkillCatalog(ctx.paths), () =>
      settings.load(),
    );
    s.start();
    store.save(routine({ id: "backoff", maxAttempts: 3, backoffMs: 60_000 }));
    await s.fire("backoff");
    await wait(30);
    const started = Date.now();
    s.stop();
    await s.drain();
    expect(Date.now() - started).toBeLessThan(500);
    expect(created).toHaveLength(1);
  });
});

describe("previousScheduledTime", () => {
  const at = (iso: string) => new Date(iso).getTime();

  it("finds the last slot before now for frequent schedules without walking a week", () => {
    expect(previousScheduledTime("*/5 * * * *", "UTC", at("2026-09-01T10:03:00Z"))).toBe(
      at("2026-09-01T10:00:00Z"),
    );
    expect(previousScheduledTime("* * * * *", "UTC", at("2026-09-01T10:03:30Z"))).toBe(
      at("2026-09-01T10:03:00Z"),
    );
    // Exactly on a slot: the previous one is strictly before now.
    expect(previousScheduledTime("*/5 * * * *", "UTC", at("2026-09-01T10:05:00Z"))).toBe(
      at("2026-09-01T10:00:00Z"),
    );
  });

  it("handles gaps larger than the typical period", () => {
    // Sunday 2026-09-06: last weekday 09:00 was Friday 2026-09-04.
    expect(previousScheduledTime("0 9 * * 1-5", "UTC", at("2026-09-06T12:00:00Z"))).toBe(
      at("2026-09-04T09:00:00Z"),
    );
    expect(previousScheduledTime("0 3 1 * *", "UTC", at("2026-09-15T00:00:00Z"))).toBe(
      at("2026-09-01T03:00:00Z"),
    );
  });

  it("returns null for invalid schedules", () => {
    expect(previousScheduledTime("not a cron", "UTC", Date.now())).toBeNull();
  });
});

describe("per-routine budgets", () => {
  it("skips a fire once the routine's daily budget is spent, alerts once, and caps the next run", async () => {
    store.save(routine({ id: "budgeted", budgetUsd: 0.5 }));
    const alerts: unknown[] = [];
    const off = events.subscribe((e) => {
      if (e.type === "routine.alert") alerts.push(e.payload);
    });
    try {
      // First fire: nothing spent yet; the run carries the remaining budget as its cap.
      const first = await scheduler.fire("budgeted");
      expect(runs.get(first.runId)!.maxCostUsd).toBeCloseTo(0.5, 6);
      await wait(400);
      // Pretend the provider billed US$ 0.6 for it.
      db.prepare("UPDATE runs SET cost_usd = ? WHERE id = ?").run(0.6, first.runId);
      expect(runs.spentTodayUsd({ routineId: "budgeted" })).toBeCloseTo(0.6, 6);

      await expect(scheduler.fire("budgeted")).rejects.toMatchObject({
        statusCode: 409,
        code: "budget_exhausted",
      });
      await expect(scheduler.fire("budgeted")).rejects.toMatchObject({ code: "budget_exhausted" });
      const history = scheduler.history("budgeted");
      const skipped = history.filter((h) => h.status === "skipped" && /Daily budget/.test(h.note ?? ""));
      expect(skipped).toHaveLength(2);
      expect(history.some((h) => h.status === "failed_to_fire")).toBe(false);
      expect(alerts).toHaveLength(1); // once a day, however many skips
      expect(runs.list({ routineId: "budgeted" }).length).toBe(1);
    } finally {
      off();
    }
  });
});

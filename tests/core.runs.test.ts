import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ApprovalStore,
  RunManager,
  SettingsStore,
  openDb,
  events,
  type Db,
  type MordomoPaths,
  type AgentAdapter,
  type ProviderId,
  type RunEvent,
  type CreateRunInput,
} from "@mordomo/core";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

let restorePath: () => void;
beforeAll(() => {
  restorePath = withFakeBinPath();
});
afterAll(() => restorePath());

let ctx: { paths: MordomoPaths; cleanup: () => void };
let db: Db;
let manager: RunManager;
let store: SettingsStore;

function adapterFor(_id: ProviderId): AgentAdapter {
  return new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
}

function input(overrides: Partial<CreateRunInput> = {}): CreateRunInput {
  return {
    origin: "manual",
    provider: "claude",
    prompt: "x",
    cwd: ctx.paths.home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 30_000,
    profile: "read_only",
    ...overrides,
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  store = new SettingsStore(ctx.paths);
  manager = new RunManager(db, ctx.paths, () => store.load(), adapterFor);
});

afterEach(async () => {
  await manager.shutdown(1000);
  if (db.open) db.close();
  ctx.cleanup();
  delete process.env.FAKE_CLAUDE_HANG;
  delete process.env.FAKE_CLAUDE_FAIL;
});

describe("run manager", () => {
  it("executes a run end-to-end with persisted, redacted events, pid and bus events", async () => {
    const seen: string[] = [];
    const unsubscribe = events.subscribe((e) => seen.push(e.type));
    try {
      const run = manager.create(input({ prompt: "Do the thing with password=SuperSecretValue99" }));
      expect(run.status).toBe("queued");
      expect(run.promptSummary).not.toContain("SuperSecretValue99");

      const finished = await manager.execute(run.id, "Say OK", "read_only");
      expect(finished.status).toBe("done");
      expect(finished.exitCode).toBe(0);
      expect(finished.durationMs).toBeGreaterThan(0);
      expect(finished.pid).toEqual(expect.any(Number));

      const persisted = manager.eventsFor(run.id);
      expect(persisted.length).toBeGreaterThan(2);
      const allData = JSON.stringify(persisted);
      expect(allData).not.toContain("sk-test1234567890abcdef");
      expect(allData).toContain("[REDACTED");

      const log = fs.readFileSync(path.join(ctx.paths.logs, "runs.jsonl"), "utf8");
      expect(log).toContain("run_finished");
      expect(log).not.toContain("SuperSecretValue99");

      for (const type of ["run.created", "run.started", "run.event", "run.finished"])
        expect(seen).toContain(type);
    } finally {
      unsubscribe();
    }
  });

  it("collects artifacts produced into the run's artifacts dir", async () => {
    const run = manager.create(input({ origin: "skill", prompt: "digest", skillSlug: "workspace-digest" }));
    process.env.FAKE_CLAUDE_ARTIFACT_DIR = path.join(ctx.paths.artifacts, run.id);
    try {
      const finished = await manager.execute(run.id, "digest", "read_only");
      expect(finished.status).toBe("done");
      expect(finished.artifacts).toEqual([path.join(run.id, "digest.md")]);
    } finally {
      delete process.env.FAKE_CLAUDE_ARTIFACT_DIR;
    }
  });

  it("marks failures with an actionable error", async () => {
    process.env.FAKE_CLAUDE_FAIL = "1";
    const run = manager.create(input());
    const finished = await manager.execute(run.id, "x", "read_only");
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("exited with code 1");
  });

  it("cancels a running run and reports whether anything was cancelled", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    const run = manager.create(input({ prompt: "hang", timeoutMs: 60_000 }));
    const executing = manager.execute(run.id, "hang", "read_only");
    await wait(700);
    const pid = manager.get(run.id)!.pid;
    expect(pid).toEqual(expect.any(Number));
    expect(await manager.cancel(run.id)).toBe(true);
    expect(await manager.cancel(run.id)).toBe(false); // already requested
    const finished = await executing;
    expect(finished.status).toBe("cancelled");
    expect(alive(pid!)).toBe(false);
    expect(await manager.cancel(run.id)).toBe(false); // finished
  }, 20_000);

  it("cancel before spawn wins the race: nothing is spawned", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    const run = manager.create(input({ prompt: "hang", timeoutMs: 60_000 }));
    const executing = manager.execute(run.id, "hang", "read_only");
    // Same tick: the adapter has not built its invocation yet.
    expect(await manager.cancel(run.id)).toBe(true);
    const finished = await executing;
    expect(finished.status).toBe("cancelled");
    expect(finished.pid).toBeNull();
    expect(manager.eventsFor(run.id).some((e) => e.event.type === "started")).toBe(false);
  });

  it("cancels a queued run that execute() has not picked up yet", async () => {
    const run = manager.create(input());
    expect(await manager.cancel(run.id)).toBe(true);
    expect(manager.get(run.id)!.status).toBe("cancelled");
    // A late execute() must not resurrect it.
    const after = await manager.execute(run.id, "x", "read_only");
    expect(after.status).toBe("cancelled");
  });

  it("times out hung runs with a distinct status and a clear message", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    const run = manager.create(input({ prompt: "hang", timeoutMs: 1500 }));
    const finished = await manager.execute(run.id, "hang", "read_only");
    expect(finished.status).toBe("timed_out");
    expect(finished.error).toContain("Timed out");
  }, 20_000);

  it("shutdown cancels hanging runs, marks them interrupted and kills the process", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    const run = manager.create(input({ prompt: "hang", timeoutMs: 60_000 }));
    const executing = manager.execute(run.id, "hang", "read_only");
    await wait(700);
    const pid = manager.get(run.id)!.pid!;
    expect(alive(pid)).toBe(true);
    const started = Date.now();
    await manager.shutdown(3000);
    expect(Date.now() - started).toBeLessThan(6000);
    const finished = await executing;
    expect(finished.status).toBe("interrupted");
    expect(alive(pid)).toBe(false);
    // After shutdown, new executions settle immediately as interrupted.
    const late = manager.create(input());
    expect((await manager.execute(late.id, "x", "read_only")).status).toBe("interrupted");
  }, 20_000);

  it("recovers interrupted runs on boot and terminates live orphans", async () => {
    const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    orphan.unref();
    const stale = manager.create(input({ origin: "routine" }));
    db.prepare("UPDATE runs SET status = 'running', pid = ? WHERE id = ?").run(orphan.pid, stale.id);
    const queued = manager.create(input());
    try {
      expect(manager.recoverInterrupted()).toBe(2);
      expect(manager.get(stale.id)!.status).toBe("interrupted");
      expect(manager.get(stale.id)!.error).toContain("SIGTERM");
      expect(manager.get(queued.id)!.status).toBe("interrupted");
      await wait(300);
      expect(alive(orphan.pid!)).toBe(false);
    } finally {
      try {
        process.kill(orphan.pid!, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  });

  it("refuses to queue more than maxConcurrentRuns * 10 runs", () => {
    const limit = store.load().limits.maxConcurrentRuns * 10;
    for (let i = 0; i < limit; i++) manager.create(input());
    expect(() => manager.create(input())).toThrow(expect.objectContaining({ statusCode: 429 }));
  });

  it("links retries through parentRunId", () => {
    const first = manager.create(input({ origin: "routine" }));
    const retry = manager.create(input({ origin: "routine", parentRunId: first.id, attempts: 2 }));
    expect(first.parentRunId).toBeNull();
    expect(retry.parentRunId).toBe(first.id);
    expect(retry.attempts).toBe(2);
    expect(
      manager
        .list({ parentRunId: first.id })
        .map((r) => r.id)
        .sort(),
    ).toEqual([first.id, retry.id].sort());
  });

  it("prunes expired events and caps events per run keeping head and tail", () => {
    const run = manager.create(input());
    const insert = db.prepare("INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, 'text', ?)");
    const many = db.transaction(() => {
      for (let i = 0; i < 6000; i++) insert.run(run.id, Date.now(), JSON.stringify({ type: "text", i }));
    });
    many();
    const old = manager.create(input());
    db.prepare("UPDATE runs SET status = 'done' WHERE id = ?").run(old.id);
    insert.run(old.id, Date.now() - 400 * 86_400_000, JSON.stringify({ type: "text", text: "ancient" }));

    const result = manager.prune({ keepDays: 30, keepEvents: 5000 });
    expect(result.eventsExpired).toBe(1);
    expect(result.eventsCapped).toBe(1000);
    const rows = db.prepare("SELECT data FROM run_events WHERE run_id = ? ORDER BY id").all(run.id) as Array<{
      data: string;
    }>;
    expect(rows.length).toBe(5001); // 500 head + 4500 tail + truncation marker
    expect(JSON.parse(rows[0]!.data).i).toBe(0);
    expect(JSON.parse(rows[499]!.data).i).toBe(499);
    expect(JSON.parse(rows[500]!.data).i).toBe(1500);
    expect(JSON.parse(rows[5000]!.data).text).toContain("pruned");
  });

  it("prunes finished runs by age and count, trims routine_history and keeps approved-gated runs", () => {
    const day = 86_400_000;
    const finish = (id: string, at: number) =>
      db
        .prepare("UPDATE runs SET status = 'done', finished_at = ?, created_at = ? WHERE id = ?")
        .run(at, at, id);
    const insertEvent = db.prepare(
      "INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, 'text', '{}')",
    );

    const ancient = manager.create(input({ prompt: "ancient" }));
    finish(ancient.id, Date.now() - 200 * day);
    insertEvent.run(ancient.id, Date.now());
    const recent = manager.create(input({ prompt: "recent" }));
    finish(recent.id, Date.now() - day);
    const live = manager.create(input({ prompt: "still queued" })); // status stays 'queued'
    // An old run still referenced by a pending approval must survive.
    const gated = manager.create(input({ prompt: "gated", status: "waiting_approval" }));
    db.prepare("UPDATE runs SET status = 'cancelled', finished_at = ?, created_at = ? WHERE id = ?").run(
      Date.now() - 200 * day,
      Date.now() - 200 * day,
      gated.id,
    );
    new ApprovalStore(db).request("write_run", "gated write", { kind: "prompt", runId: gated.id });

    db.prepare("INSERT INTO routine_history (routine_id, fired_at, status) VALUES ('r', ?, 'fired')").run(
      Date.now() - 200 * day,
    );
    db.prepare("INSERT INTO routine_history (routine_id, fired_at, status) VALUES ('r', ?, 'fired')").run(
      Date.now(),
    );

    const result = manager.prune({ keepRunDays: 90, keepHistoryDays: 90, keepRuns: 0, vacuum: false });
    expect(result.runsDeleted).toBe(1);
    expect(result.historyDeleted).toBe(1);
    expect(result.vacuumed).toBe(false);
    expect(manager.get(ancient.id)).toBeNull();
    expect(manager.eventsFor(ancient.id)).toHaveLength(0);
    expect(manager.get(recent.id)).not.toBeNull();
    expect(manager.get(live.id)?.status).toBe("queued");
    expect(manager.get(gated.id)).not.toBeNull(); // pinned by the pending approval
    expect((db.prepare("SELECT COUNT(*) c FROM routine_history").get() as { c: number }).c).toBe(1);

    // Newest-N cap: only finished, unpinned runs are considered.
    expect(
      manager.prune({ keepRuns: 1, keepRunDays: 3650, keepHistoryDays: 3650, vacuum: false }).runsDeleted,
    ).toBe(0);
    expect(manager.get(recent.id)).not.toBeNull();

    // The weekly VACUUM only runs once per interval.
    expect(manager.prune({ vacuum: true }).vacuumed).toBe(true);
    expect(manager.prune().vacuumed).toBe(false);
  });

  it("waiting_approval runs become queued when approved and cancellable when not", async () => {
    const run = manager.create(input({ status: "waiting_approval" }));
    expect(run.status).toBe("waiting_approval");
    // execute() ignores a run that is not queued yet.
    expect((await manager.execute(run.id, "x", "read_only")).status).toBe("waiting_approval");
    expect(manager.markApproved(run.id)).toBe(true);
    expect(manager.get(run.id)?.status).toBe("queued");
    expect(manager.markApproved(run.id)).toBe(false);

    const denied = manager.create(input({ status: "waiting_approval" }));
    expect(await manager.cancel(denied.id, "Write approval denied")).toBe(true);
    expect(manager.get(denied.id)?.status).toBe("cancelled");
    expect(manager.get(denied.id)?.error).toBe("Write approval denied");
  });

  it("kills the child when the event stream consumer abandons it", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    const adapter = adapterFor("claude");
    let pid: number | null = null;
    const started = Date.now();
    for await (const event of adapter.execute({
      runId: "abandoned",
      prompt: "hang",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      artifactsDir: path.join(ctx.paths.artifacts, "abandoned"),
    })) {
      if (event.type === "started") {
        pid = (event as Extract<RunEvent, { type: "started" }>).pid;
        break;
      }
    }
    expect(Date.now() - started).toBeLessThan(8000);
    expect(pid).toEqual(expect.any(Number));
    expect(alive(pid!)).toBe(false);
  }, 20_000);

  it("computes metrics", async () => {
    const run = manager.create(input({ prompt: "ok" }));
    await manager.execute(run.id, "ok", "read_only");
    const metrics = manager.metrics();
    expect(metrics.total).toBe(1);
    expect(metrics.successRate).toBe(1);
    expect(metrics.byProvider[0]).toMatchObject({ provider: "claude", count: 1, success: 1 });
  });
});

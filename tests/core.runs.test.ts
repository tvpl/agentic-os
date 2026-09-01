import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RunManager,
  SettingsStore,
  openDb,
  type Db,
  type MordomoPaths,
  type AgentAdapter,
  type ProviderId,
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

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  store = new SettingsStore(ctx.paths);
  manager = new RunManager(db, ctx.paths, () => store.load(), adapterFor);
});

afterEach(() => {
  db.close();
  ctx.cleanup();
});

describe("run manager", () => {
  it("executes a run end-to-end with persisted, redacted events", async () => {
    const run = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "Do the thing with password=SuperSecretValue99",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
    });
    expect(run.status).toBe("queued");
    // Prompt summary in DB must already be redacted
    expect(run.promptSummary).not.toContain("SuperSecretValue99");

    const finished = await manager.execute(run.id, "Say OK", "read_only");
    expect(finished.status).toBe("done");
    expect(finished.exitCode).toBe(0);
    expect(finished.durationMs).toBeGreaterThan(0);

    const events = manager.eventsFor(run.id);
    expect(events.length).toBeGreaterThan(2);
    // The fake CLI emits an sk- token in its result; persisted events must be redacted.
    const allData = JSON.stringify(events);
    expect(allData).not.toContain("sk-test1234567890abcdef");
    expect(allData).toContain("[REDACTED");

    // JSONL log exists and is redacted too
    const logFile = path.join(ctx.paths.logs, "runs.jsonl");
    const log = fs.readFileSync(logFile, "utf8");
    expect(log).toContain("run_finished");
    expect(log).not.toContain("SuperSecretValue99");
  });

  it("collects artifacts produced into the run's artifacts dir", async () => {
    const run = manager.create({
      origin: "skill",
      provider: "claude",
      prompt: "digest",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      skillSlug: "workspace-digest",
    });
    // The fake claude writes an artifact when FAKE_CLAUDE_ARTIFACT_DIR is set.
    process.env.FAKE_CLAUDE_ARTIFACT_DIR = path.join(ctx.paths.artifacts, run.id);
    try {
      const finished = await manager.execute(run.id, "digest", "read_only");
      expect(finished.status).toBe("done");
      expect(finished.artifacts).toEqual([path.join(run.id, "digest.md")]);
      expect(fs.existsSync(path.join(ctx.paths.artifacts, run.id, "digest.md"))).toBe(true);
    } finally {
      delete process.env.FAKE_CLAUDE_ARTIFACT_DIR;
    }
  });

  it("marks failures with an actionable error", async () => {
    process.env.FAKE_CLAUDE_FAIL = "1";
    try {
      const run = manager.create({
        origin: "manual",
        provider: "claude",
        prompt: "x",
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
      });
      const finished = await manager.execute(run.id, "x", "read_only");
      expect(finished.status).toBe("failed");
      expect(finished.error).toContain("exited with code 1");
    } finally {
      delete process.env.FAKE_CLAUDE_FAIL;
    }
  });

  it("cancels a running run", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    try {
      const run = manager.create({
        origin: "manual",
        provider: "claude",
        prompt: "hang",
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 60_000,
        profile: "read_only",
      });
      const executing = manager.execute(run.id, "hang", "read_only");
      await new Promise((r) => setTimeout(r, 700));
      const cancelled = await manager.cancel(run.id);
      expect(cancelled).toBe(true);
      const finished = await executing;
      expect(finished.status).toBe("cancelled");
    } finally {
      delete process.env.FAKE_CLAUDE_HANG;
    }
  }, 20_000);

  it("times out hung runs with a clear message", async () => {
    process.env.FAKE_CLAUDE_HANG = "1";
    try {
      const run = manager.create({
        origin: "manual",
        provider: "claude",
        prompt: "hang",
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 1500,
        profile: "read_only",
      });
      const finished = await manager.execute(run.id, "hang", "read_only");
      expect(finished.status).toBe("failed");
      expect(finished.error).toContain("Timed out");
    } finally {
      delete process.env.FAKE_CLAUDE_HANG;
    }
  }, 20_000);

  it("recovers interrupted runs on boot", () => {
    const run = manager.create({
      origin: "routine",
      provider: "claude",
      prompt: "x",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 1000,
      profile: "read_only",
    });
    db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(run.id);
    const recovered = manager.recoverInterrupted();
    expect(recovered).toBe(1);
    expect(manager.get(run.id)!.status).toBe("interrupted");
  });

  it("computes metrics", async () => {
    const run = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "ok",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
    });
    await manager.execute(run.id, "ok", "read_only");
    const metrics = manager.metrics();
    expect(metrics.total).toBe(1);
    expect(metrics.successRate).toBe(1);
    expect(metrics.byProvider[0]).toMatchObject({ provider: "claude", count: 1, success: 1 });
  });
});

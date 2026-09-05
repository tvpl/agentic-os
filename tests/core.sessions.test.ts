import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import path from "node:path";
import {
  RunManager,
  SettingsStore,
  openDb,
  events,
  type Db,
  type SessionStore,
  type MordomoPaths,
  type AgentAdapter,
  type ProviderId,
} from "@mordomo/core";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { CursorAdapter } from "@mordomo/adapter-cursor";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

let restorePath: () => void;
beforeAll(() => {
  restorePath = withFakeBinPath();
});
afterAll(() => restorePath());

let ctx: { paths: MordomoPaths; cleanup: () => void };
let db: Db;
let manager: RunManager;
let sessions: SessionStore;
let store: SettingsStore;

function adapterFor(id: ProviderId): AgentAdapter {
  if (id === "cursor") return new CursorAdapter({ binaryPath: path.join(FAKE_BIN, "cursor-agent") });
  return new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
}

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  store = new SettingsStore(ctx.paths);
  manager = new RunManager(db, ctx.paths, () => store.load(), adapterFor);
  sessions = manager.sessions;
});

afterEach(async () => {
  await manager.shutdown(1000);
  if (db.open) db.close();
  ctx.cleanup();
});

describe("session store", () => {
  it("creates a conversation with redacted title and empty counters", () => {
    const seen: string[] = [];
    const unsubscribe = events.subscribe((e) => seen.push(e.type));
    try {
      const session = sessions.create({
        provider: "claude",
        cwd: ctx.paths.home,
        profile: "read_only",
        title: "  Summarise\n the token sk-test1234567890abcdefTOKEN  ",
      });
      expect(session.providerSessionId).toBeNull();
      expect(session.turns).toBe(0);
      expect(session.costUsd).toBe(0);
      expect(session.title).not.toContain("sk-test1234567890abcdef");
      expect(session.title.startsWith("Summarise the token")).toBe(true);
      expect(sessions.get(session.id)?.provider).toBe("claude");
      expect(seen).toContain("session.created");
    } finally {
      unsubscribe();
    }
  });

  it("captures the provider session id once and follows a fork", () => {
    const session = sessions.create({ provider: "claude", cwd: null, profile: null, title: "t" });
    expect(sessions.captureProviderSessionId(session.id, "abc")).toBe(true);
    expect(sessions.captureProviderSessionId(session.id, "abc")).toBe(false); // unchanged
    expect(sessions.get(session.id)?.providerSessionId).toBe("abc");
    expect(sessions.captureProviderSessionId(session.id, "def")).toBe(true); // resumed run forked
    expect(sessions.get(session.id)?.providerSessionId).toBe("def");
  });

  it("accumulates turns, tokens and cost as runs finish", () => {
    const session = sessions.create({ provider: "claude", cwd: null, profile: null, title: "t" });
    const seen: string[] = [];
    const unsubscribe = events.subscribe((e) => seen.push(e.type));
    try {
      sessions.recordRun(session.id, {
        runId: "run-1",
        usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
      });
      sessions.recordRun(session.id, {
        runId: "run-2",
        usage: { inputTokens: 50, outputTokens: 5, costUsd: 0.005 },
      });
      // A provider that reports nothing must not break the accumulators.
      sessions.recordRun(session.id, { runId: "run-3", usage: null });
    } finally {
      unsubscribe();
    }
    const after = sessions.get(session.id)!;
    expect(after.turns).toBe(3);
    expect(after.inputTokens).toBe(150);
    expect(after.outputTokens).toBe(25);
    expect(after.costUsd).toBeCloseTo(0.015, 6);
    expect(after.lastRunId).toBe("run-3");
    expect(seen.filter((t) => t === "session.updated")).toHaveLength(3);
    expect(sessions.recordRun("missing-session", { runId: "run-4" })).toBeNull();
  });

  it("lists newest first with the last run summary and its run count", () => {
    const older = sessions.create({ provider: "claude", cwd: null, profile: null, title: "older" });
    const newer = sessions.create({ provider: "claude", cwd: null, profile: null, title: "newer" });
    const run = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "hello",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      sessionId: newer.id,
    });
    sessions.recordRun(newer.id, { runId: run.id, usage: null });

    const list = sessions.list();
    expect(list.map((s) => s.id)).toEqual([newer.id, older.id]);
    expect(list[0]?.runCount).toBe(1);
    expect(list[0]?.lastRun?.id).toBe(run.id);
    expect(list[0]?.lastRun?.promptSummary).toBe("hello");
    expect(list[1]?.lastRun).toBeNull();
    expect(sessions.count()).toBe(2);
  });

  it("deleting a conversation keeps its runs and only clears the link", () => {
    const session = sessions.create({ provider: "claude", cwd: null, profile: null, title: "t" });
    const run = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "hello",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      sessionId: session.id,
    });
    expect(manager.get(run.id)?.sessionId).toBe(session.id);
    expect(sessions.delete(session.id)).toEqual({ deleted: true, runsKept: 1 });
    expect(sessions.get(session.id)).toBeNull();
    expect(manager.get(run.id)?.sessionId).toBeNull();
    expect(sessions.delete(session.id)).toEqual({ deleted: false, runsKept: 0 });
  });
});

describe("run manager × sessions (fake claude CLI)", () => {
  it("captures the provider session id on the first run and resumes it on the next", async () => {
    const session = sessions.create({
      provider: "claude",
      cwd: ctx.paths.home,
      profile: "read_only",
      title: "conversation",
    });
    const first = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "hello",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      sessionId: session.id,
    });
    await manager.execute(first.id, "hello", "read_only");

    const afterFirst = sessions.get(session.id)!;
    // The adapter named the conversation up front and the fake CLI echoed it back.
    expect(afterFirst.providerSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(afterFirst.turns).toBe(1);
    expect(afterFirst.lastRunId).toBe(first.id);

    const second = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "and again",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      sessionId: session.id,
    });
    await manager.execute(second.id, "and again", "read_only");

    const afterSecond = sessions.get(session.id)!;
    expect(afterSecond.providerSessionId).toBe(afterFirst.providerSessionId);
    expect(afterSecond.turns).toBe(2);
    expect(afterSecond.lastRunId).toBe(second.id);
    expect(manager.list({ sessionId: session.id })).toHaveLength(2);

    // The resumed run went through `claude --resume <id>`: the fake echoes the
    // id it was given, so the session event of run 2 carries the same one.
    const sessionEvents = manager
      .eventsFor(second.id)
      .map((e) => e.event)
      .filter((e) => e.type === "session");
    expect(sessionEvents.length).toBeGreaterThan(0);
    expect(sessionEvents.every((e) => e.providerSessionId === afterFirst.providerSessionId)).toBe(true);
  });
});

describe("run manager × emulated sessions (fake cursor-agent, no resume flag)", () => {
  it("folds the earlier turns into the prompt instead of starting fresh", async () => {
    const session = sessions.create({
      provider: "cursor",
      cwd: ctx.paths.home,
      profile: "read_only",
      title: "c",
    });
    const mk = (prompt: string) =>
      manager.create({
        origin: "manual",
        provider: "cursor",
        prompt,
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        sessionId: session.id,
      });
    const first = mk("Remember the code ORCHID-42.");
    await manager.execute(first.id, "Remember the code ORCHID-42.", "read_only");
    const firstEvents = manager.eventsFor(first.id).map((e) => e.event);
    expect(firstEvents.some((e) => e.type === "text" && /session emulated/.test(e.text))).toBe(false);

    const second = mk("What was the code?");
    await manager.execute(second.id, "What was the code?", "read_only");
    const evs = manager.eventsFor(second.id).map((e) => e.event);
    expect(evs.some((e) => e.type === "text" && /session emulated: 1 earlier turn/.test(e.text))).toBe(true);
    // The fake CLI only says this when the folded transcript reached its prompt.
    expect(evs.some((e) => e.type === "assistant" && /Recalled ORCHID-42/.test(e.text))).toBe(true);
    // No "starting fresh" warning any more: the adapter was not asked to resume.
    expect(evs.some((e) => e.type === "text" && /resumeSupported: false/.test(e.text))).toBe(false);
    expect(sessions.get(session.id)!.turns).toBe(2);
  });
});

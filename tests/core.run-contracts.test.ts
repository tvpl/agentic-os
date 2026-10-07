import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EventBus,
  RunManager,
  SettingsStore,
  openDb,
  triageSentinel,
  type AgentAdapter,
  type AgentRun,
  type Db,
  type RunEvent,
  classifyRunFailure,
} from "@mordomo/core";
import { claudeManifest } from "@mordomo/adapter-claude";
import { makeTempHome } from "./helpers.js";

describe("durable run contracts", () => {
  let temp: ReturnType<typeof makeTempHome>;
  let db: Db;
  let settings: ReturnType<SettingsStore["load"]>;
  let manager: RunManager;
  let adapter: AgentAdapter;

  beforeEach(() => {
    temp = makeTempHome("mordomo-run-contract-");
    db = openDb(temp.paths).db;
    settings = new SettingsStore(temp.paths).load();
    settings.providers.claude.enabled = true;
  });

  afterEach(async () => {
    await manager?.shutdown(100);
    db.close();
    temp.cleanup();
  });

  it("persists the complete typed request instead of reconstructing it from the summary", () => {
    adapter = {} as AgentAdapter;
    manager = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    const prompt = "context ".repeat(100);
    const run = manager.create({
      origin: "manual",
      provider: "claude",
      prompt,
      request: { version: 1, kind: "prompt", prompt, mode: "read_only" },
      cwd: temp.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 42_000,
      profile: "read_only",
    });
    expect(run.promptSummary.length).toBe(500);
    expect(manager.get(run.id)?.request).toEqual({ version: 1, kind: "prompt", prompt, mode: "read_only" });
  });

  it("serializes turns of one provider session", async () => {
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const started: AgentRun[] = [];
    let active = 0;
    let peak = 0;
    adapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute(run: AgentRun): AsyncIterable<RunEvent> {
        const index = started.push(run) - 1;
        peak = Math.max(peak, ++active);
        await gates[index]!.promise;
        active--;
        yield { type: "result", ts: Date.now(), exitCode: 0, summary: "ok", durationMs: 1, timedOut: false };
      },
    } as AgentAdapter;
    manager = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    const session = manager.sessions.create({
      provider: "claude",
      providerSessionId: "provider-1",
      cwd: temp.paths.home,
      profile: "read_only",
      title: "one",
    });
    const make = (sessionId: string, prompt: string) =>
      manager.create({
        origin: "manual",
        provider: "claude",
        prompt,
        cwd: temp.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 10_000,
        profile: "read_only",
        sessionId,
      });
    const first = make(session.id, "first");
    const second = make(session.id, "second");
    const p1 = manager.execute(first.id, "first", "read_only");
    const p2 = manager.execute(second.id, "second", "read_only");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toHaveLength(1);
    expect(manager.get(second.id)?.status).toBe("queued");
    gates[0]!.resolve();
    await p1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toHaveLength(2);
    expect(peak).toBe(1);
    gates[1]!.resolve();
    await p2;
  });

  it("keeps different provider sessions parallel", async () => {
    const gate = Promise.withResolvers<void>();
    let active = 0;
    let peak = 0;
    adapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute(): AsyncIterable<RunEvent> {
        peak = Math.max(peak, ++active);
        await gate.promise;
        active--;
        yield { type: "result", ts: Date.now(), exitCode: 0, summary: "ok", durationMs: 1, timedOut: false };
      },
    } as AgentAdapter;
    settings.limits.maxConcurrentRuns = 2;
    manager = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    const makeSession = (title: string) =>
      manager.sessions.create({
        provider: "claude",
        providerSessionId: title,
        cwd: temp.paths.home,
        profile: "read_only",
        title,
      });
    const makeRun = (sessionId: string, prompt: string) =>
      manager.create({
        origin: "manual",
        provider: "claude",
        prompt,
        cwd: temp.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 10_000,
        profile: "read_only",
        sessionId,
      });
    const p1 = manager.execute(makeRun(makeSession("one").id, "one").id, "one", "read_only");
    const p2 = manager.execute(makeRun(makeSession("two").id, "two").id, "two", "read_only");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBe(2);
    gate.resolve();
    await Promise.all([p1, p2]);
  });

  it("cancels a turn waiting for its session without starting the provider", async () => {
    const gate = Promise.withResolvers<void>();
    let starts = 0;
    adapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute(): AsyncIterable<RunEvent> {
        starts++;
        await gate.promise;
        yield { type: "result", ts: Date.now(), exitCode: 0, summary: "ok", durationMs: 1, timedOut: false };
      },
    } as AgentAdapter;
    manager = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    const session = manager.sessions.create({
      provider: "claude",
      providerSessionId: "provider-1",
      cwd: temp.paths.home,
      profile: "read_only",
      title: "one",
    });
    const make = (prompt: string) =>
      manager.create({
        origin: "manual",
        provider: "claude",
        prompt,
        cwd: temp.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 10_000,
        profile: "read_only",
        sessionId: session.id,
      });
    const first = make("first");
    const second = make("second");
    const p1 = manager.execute(first.id, "first", "read_only");
    const p2 = manager.execute(second.id, "second", "read_only");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await manager.cancel(second.id)).toBe(true);
    expect((await p2).status).toBe("cancelled");
    expect(manager.get(second.id)?.failure?.code).toBe("cancelled");
    expect(starts).toBe(1);
    gate.resolve();
    await p1;
  });

  it("reserves triage budget before concurrent work is admitted", async () => {
    const gate = Promise.withResolvers<void>();
    adapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute(): AsyncIterable<RunEvent> {
        await gate.promise;
        yield {
          type: "usage",
          ts: Date.now(),
          scope: "total",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0.2,
        };
        yield { type: "assistant", ts: Date.now(), text: '{"action":"ignore","summary":"ok","proposal":""}' };
        yield { type: "result", ts: Date.now(), exitCode: 0, summary: "ok", durationMs: 1, timedOut: false };
      },
    } as AgentAdapter;
    settings.sentinels.triage.enabled = true;
    settings.sentinels.triage.dailyBudgetUsd = 0.25;
    manager = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    const deps = {
      db,
      bus: new EventBus(),
      runs: manager,
      notifications: { add: () => ({ id: "unused" }) },
      getSettings: () => settings,
      cwd: temp.paths.home,
    };
    const payload = (title: string) => ({
      sentinel: "repeatedFailure" as const,
      severity: "warn" as const,
      title,
      body: "fixture",
      triage: true,
    });
    const first = triageSentinel(deps, payload("one"));
    const second = await triageSentinel(deps, payload("two"));
    expect(second.skipped).toBe("budget_exhausted");
    expect(manager.list({ limit: 10 })[0]?.maxCostUsd).toBe(0.25);
    gate.resolve();
    expect((await first).runId).toBeTruthy();
  });

  it("classifies actionable failures without losing uncertainty", () => {
    expect(classifyRunFailure("OAuth session expired", "failed")).toMatchObject({
      code: "authentication",
      recoverable: false,
    });
    expect(classifyRunFailure("Permission denied", "failed")).toMatchObject({
      code: "permission",
      recoverable: false,
    });
    expect(classifyRunFailure("Budget exhausted", "failed")).toMatchObject({
      code: "budget",
      recoverable: false,
    });
    expect(classifyRunFailure("Timed out", "timed_out", true)).toMatchObject({
      code: "timeout",
      effectsUncertain: true,
    });
  });

  it("adds stable attempt and sequence metadata to persisted events", async () => {
    adapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute(): AsyncIterable<RunEvent> {
        yield { type: "tool_use", ts: 10, tool: "read", detail: "file", callId: "call-1", phase: "start" };
        yield {
          type: "tool_use",
          ts: 25,
          tool: "read",
          detail: "ok",
          callId: "call-1",
          phase: "end",
          outcome: "ok",
        };
        yield { type: "result", ts: 30, exitCode: 0, summary: "ok", durationMs: 20, timedOut: false };
      },
    } as AgentAdapter;
    manager = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    const run = manager.create({
      origin: "manual",
      provider: "claude",
      prompt: "metadata",
      cwd: temp.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 10_000,
      profile: "read_only",
    });
    await manager.execute(run.id, "metadata", "read_only");
    const persisted = manager
      .eventsFor(run.id)
      .filter((row) => row.event.type === "tool_use")
      .map((row) => row.event);
    expect(persisted.map((event) => event.attemptId)).toEqual([run.id, run.id]);
    expect(persisted.map((event) => event.sequence)).toEqual([1, 2]);
    expect(persisted[1]).toMatchObject({ callId: "call-1", phase: "end", durationMs: 15, outcome: "ok" });
  });
});

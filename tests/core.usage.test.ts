import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  RunManager,
  SettingsStore,
  openDb,
  hasColumn,
  type Db,
  type MordomoPaths,
  type AgentAdapter,
  type AgentRun,
  type RunEvent,
  type CreateRunInput,
} from "@mordomo/core";
import { UsageFolder } from "../core/src/runs/runManager.js";
import { claudeStreamParser, parseClaudeUsage, dominantModel } from "@mordomo/adapter-claude";
import { codexStreamParser, parseCodexUsage } from "@mordomo/adapter-codex";
import { cursorStreamParser, parseCursorUsage } from "@mordomo/adapter-cursor";
import { makeTempHome } from "./helpers.js";

type UsageEvent = Extract<RunEvent, { type: "usage" }>;
const usageOf = (events: RunEvent[] | null): UsageEvent[] =>
  (events ?? []).filter((e): e is UsageEvent => e.type === "usage");

describe("claude stream-json usage parsing", () => {
  it("emits per-turn usage from assistant messages and a total from result", () => {
    const parser = claudeStreamParser();
    parser.parseLine('{"type":"system","subtype":"init","model":"claude-sonnet-5","session_id":"s"}');
    const turn = usageOf(
      parser.parseLine(
        '{"type":"assistant","message":{"model":"claude-sonnet-5","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":12,"output_tokens":34,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}',
      ),
    );
    expect(turn).toHaveLength(1);
    expect(turn[0]).toMatchObject({
      scope: "turn",
      inputTokens: 12,
      outputTokens: 34,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
      costUsd: null,
      model: "claude-sonnet-5",
    });

    const total = usageOf(
      parser.parseLine(
        '{"type":"result","subtype":"success","is_error":false,"result":"done","total_cost_usd":0.0421,"usage":{"input_tokens":50,"output_tokens":80,"cache_read_input_tokens":3000,"cache_creation_input_tokens":400},"modelUsage":{"claude-haiku-4-5":{"outputTokens":5},"claude-opus-5":{"outputTokens":75}}}',
      ),
    );
    expect(total).toHaveLength(1);
    expect(total[0]).toMatchObject({
      scope: "total",
      inputTokens: 50,
      outputTokens: 80,
      cacheReadTokens: 3000,
      cacheWriteTokens: 400,
      costUsd: 0.0421,
      model: "claude-opus-5",
    });
    expect(parser.summarize("", "", 0)).toBe("done");
  });

  it("falls back to the session model and tolerates results without usage", () => {
    const parser = claudeStreamParser();
    parser.parseLine('{"type":"system","subtype":"init","model":"fake-sonnet"}');
    const onlyCost = usageOf(
      parser.parseLine('{"type":"result","subtype":"success","result":"ok","total_cost_usd":0.01}'),
    );
    expect(onlyCost[0]).toMatchObject({
      scope: "total",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.01,
      model: "fake-sonnet",
    });
    expect(
      usageOf(claudeStreamParser().parseLine('{"type":"result","subtype":"success","result":"ok"}')),
    ).toHaveLength(0);
    expect(
      usageOf(
        claudeStreamParser().parseLine(
          '{"type":"assistant","message":{"content":[{"type":"text","text":"no usage here"}]}}',
        ),
      ),
    ).toHaveLength(0);
  });

  it("helpers reject malformed blocks", () => {
    expect(parseClaudeUsage(null)).toBeNull();
    expect(parseClaudeUsage({ foo: 1 })).toBeNull();
    expect(parseClaudeUsage({ input_tokens: "x", output_tokens: 3 })).toEqual({
      inputTokens: 0,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(dominantModel(undefined)).toBeNull();
    expect(dominantModel({ a: { outputTokens: 1 }, b: null })).toBe("a");
  });
});

describe("codex JSONL usage parsing", () => {
  it("parses turn.completed usage as a total without a price", () => {
    const parser = codexStreamParser();
    // thread.started now also reports the conversation id (Onda 1 sessions).
    expect(parser.parseLine('{"type":"thread.started","thread_id":"t","model":"gpt-5.2-codex"}')).toEqual([
      { type: "session", ts: expect.any(Number), providerSessionId: "t" },
    ]);
    const ev = usageOf(
      parser.parseLine(
        '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5,"cached_input_tokens":7}}',
      ),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      scope: "total",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 7,
      costUsd: null,
      model: "gpt-5.2-codex",
    });
  });

  it("parses the older msg.token_count shape", () => {
    const parser = codexStreamParser();
    const ev = usageOf(
      parser.parseLine(
        '{"msg":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":40},"last_token_usage":{"input_tokens":1,"output_tokens":1}}}}',
      ),
    );
    expect(ev[0]).toMatchObject({ scope: "total", inputTokens: 100, outputTokens: 40 });
    expect(parseCodexUsage({})).toBeNull();
    expect(usageOf(parser.parseLine('{"type":"turn.completed"}'))).toHaveLength(0);
  });
});

describe("cursor usage parsing (best effort)", () => {
  it("reads usage from assistant messages and results when present", () => {
    const parser = cursorStreamParser();
    const turn = usageOf(
      parser.parseLine(
        '{"type":"assistant","message":{"model":"sonnet-4.5","usage":{"inputTokens":3,"outputTokens":4},"content":[{"type":"text","text":"x"}]}}',
      ),
    );
    expect(turn[0]).toMatchObject({ scope: "turn", inputTokens: 3, outputTokens: 4, model: "sonnet-4.5" });
    const total = usageOf(
      parser.parseLine('{"type":"result","result":"ok","usage":{"prompt_tokens":30,"completion_tokens":40}}'),
    );
    expect(total[0]).toMatchObject({ scope: "total", inputTokens: 30, outputTokens: 40, costUsd: null });
    expect(usageOf(parser.parseLine('{"type":"result","result":"ok"}'))).toHaveLength(0);
    expect(parseCursorUsage("nope")).toBeNull();
  });
});

describe("UsageFolder", () => {
  it("sums turns until a total replaces them, keeping the model", () => {
    const f = new UsageFolder();
    expect(f.value()).toBeNull();
    f.fold({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 10, costUsd: null, model: "m1" });
    f.fold({ inputTokens: 3, outputTokens: 4, cacheWriteTokens: 5, costUsd: null });
    expect(f.value()).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      costUsd: null,
      model: "m1",
    });
    f.fold({ scope: "total", inputTokens: 100, outputTokens: 200, costUsd: 0.5 });
    expect(f.value()).toEqual({ inputTokens: 100, outputTokens: 200, costUsd: 0.5, model: "m1" });
  });

  it("adds costs across turns when every turn is priced", () => {
    const f = new UsageFolder();
    f.fold({ inputTokens: 1, outputTokens: 1, costUsd: 0.1 });
    f.fold({ inputTokens: 1, outputTokens: 1, costUsd: 0.2 });
    expect(f.value()?.costUsd).toBeCloseTo(0.3, 6);
  });
});

describe("run manager usage persistence and cost metrics", () => {
  let home: { paths: MordomoPaths; cleanup: () => void };
  let db: Db;
  let manager: RunManager;

  /** Adapter stub that streams a scripted event list (no process spawned). */
  function stubAdapter(script: (run: AgentRun) => RunEvent[]): AgentAdapter {
    return {
      id: "claude",
      execute: (run: AgentRun) =>
        (async function* () {
          for (const e of script(run)) yield e;
        })(),
    } as unknown as AgentAdapter;
  }

  const input = (overrides: Partial<CreateRunInput> = {}): CreateRunInput => ({
    origin: "manual",
    provider: "claude",
    prompt: "x",
    cwd: home.paths.home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 30_000,
    profile: "read_only",
    ...overrides,
  });

  beforeEach(() => {
    home = makeTempHome();
    db = openDb(home.paths).db;
  });
  afterEach(async () => {
    await manager?.shutdown(500);
    if (db.open) db.close();
    home.cleanup();
  });

  it("migration adds the usage columns", () => {
    for (const c of [
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "cost_usd",
      "usage_model",
    ]) {
      expect(hasColumn(db, "runs", c), c).toBe(true);
    }
  });

  it("stores folded usage on the row, exposes it in records and aggregates cost metrics", async () => {
    const store = new SettingsStore(home.paths);
    const now = Date.now();
    manager = new RunManager(
      db,
      home.paths,
      () => store.load(),
      () =>
        stubAdapter(() => [
          { type: "started", ts: now, pid: null },
          {
            type: "usage",
            ts: now,
            scope: "turn",
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: 100,
            costUsd: null,
            model: "claude-sonnet-5",
          },
          { type: "assistant", ts: now, text: "hello" },
          {
            type: "usage",
            ts: now,
            scope: "total",
            inputTokens: 40,
            outputTokens: 60,
            cacheReadTokens: 500,
            cacheWriteTokens: 50,
            costUsd: 0.25,
          },
          { type: "result", ts: now, exitCode: 0, summary: "ok", durationMs: 5, timedOut: false },
        ]),
    );
    const run = manager.create(input());
    expect(run.usage).toBeNull();
    const finished = await manager.execute(run.id, "x", "read_only");
    expect(finished.status).toBe("done");
    expect(finished.usage).toEqual({
      inputTokens: 40,
      outputTokens: 60,
      cacheReadTokens: 500,
      cacheWriteTokens: 50,
      costUsd: 0.25,
      model: "claude-sonnet-5",
    });

    // The usage event itself is persisted so the SSE replay carries it.
    const types = manager.eventsFor(run.id).map((e) => e.event.type);
    expect(types.filter((t) => t === "usage")).toHaveLength(2);

    expect(manager.list({ limit: 10 })[0]?.usage?.costUsd).toBe(0.25);
    expect(manager.list({ limit: 10, offset: 1 })).toHaveLength(0);
    expect(manager.count()).toBe(1);

    const m = manager.metrics();
    expect(m.cost.todayUsd).toBeCloseTo(0.25, 6);
    expect(m.cost.weekUsd).toBeCloseTo(0.25, 6);
    expect(m.cost.burnRatePerHour).toBeCloseTo(0.25, 6);
    expect(m.cost.tokensToday).toBe(650);
    expect(m.cost.block5h).toBeUndefined();
    expect(m.usageSeries).toHaveLength(24);
    expect(m.usageSeries[23]?.tokens).toBe(650);
    expect(m.usageSeries[23]?.usd).toBeCloseTo(0.25, 6);
  });

  it("writes usage on the row while the run is still streaming", async () => {
    const store = new SettingsStore(home.paths);
    const now = Date.now();
    let midRun: unknown;
    manager = new RunManager(
      db,
      home.paths,
      () => store.load(),
      () =>
        ({
          id: "claude",
          execute: (run: AgentRun) =>
            (async function* () {
              yield { type: "started", ts: now, pid: null } as RunEvent;
              yield {
                type: "usage",
                ts: now,
                scope: "turn",
                inputTokens: 5,
                outputTokens: 6,
                costUsd: 0.05,
              } as RunEvent;
              // The manager has folded and persisted the frame before it asks for the next event.
              midRun = manager.get(run.runId)?.usage;
              yield {
                type: "result",
                ts: now,
                exitCode: 0,
                summary: "ok",
                durationMs: 1,
                timedOut: false,
              } as RunEvent;
            })(),
        }) as unknown as AgentAdapter,
    );
    const run = manager.create(input());
    await manager.execute(run.id, "x", "read_only");
    expect(midRun).toMatchObject({ inputTokens: 5, outputTokens: 6, costUsd: 0.05 });
  });

  it("keeps usage null and metrics at zero when no provider reports it", async () => {
    const store = new SettingsStore(home.paths);
    manager = new RunManager(
      db,
      home.paths,
      () => store.load(),
      () =>
        stubAdapter(() => [
          { type: "started", ts: Date.now(), pid: null },
          { type: "result", ts: Date.now(), exitCode: 0, summary: "ok", durationMs: 1, timedOut: false },
        ]),
    );
    const run = manager.create(input());
    const finished = await manager.execute(run.id, "x", "read_only");
    expect(finished.usage).toBeNull();
    const m = manager.metrics();
    expect(m.cost).toEqual({ todayUsd: 0, weekUsd: 0, tokensToday: 0, burnRatePerHour: 0 });
    expect(m.usageSeries.every((p) => p.tokens === 0 && p.usd === 0)).toBe(true);
  });
});

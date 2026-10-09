/**
 * Typed adapters (`.specs/features/adaptadores-tipados`): what each CLI prints
 * is a contract, and a strange line never sinks a run.
 *
 * The fixtures under `tests/fixtures/streams/` were written from the official
 * SDK message types, not recorded from a real CLI (none is installed here):
 * `@anthropic-ai/claude-agent-sdk` 0.3.291 (`SDKMessage`, `sdk.d.ts`) for
 * `claude/*.jsonl`, and `@openai/codex-sdk` 0.160.1 (`ThreadEvent`,
 * `dist/index.d.ts`) for `codex/*.jsonl`. `codex/item-type-legacy.jsonl` is the
 * same run as `codex/item-type-current.jsonl` in the earlier `item_type` spelling, and
 * `codex/legacy-msg.jsonl` is the oldest `{ msg: { type } }` shape.
 *
 * The `*.events.json` files are the event sequences the parsers emitted for
 * those fixtures BEFORE this feature (built from the base commit f1de763,
 * `ts` dropped), checked by hand and committed: the typed parsers must emit
 * exactly the same.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ClaudeStreamMessage, CodexStreamEvent } from "@mordomo/contracts";
import {
  RunManager,
  SettingsStore,
  executeInvocation,
  installedVersion,
  openDb,
  type AgentAdapter,
  type AgentRun,
  type Db,
  type LineParser,
  type MordomoPaths,
  type ProviderId,
  type RunEvent,
  versionStatus,
} from "@mordomo/core";
import { ClaudeAdapter, claudeManifest, claudeStreamParser } from "@mordomo/adapter-claude";
import { CodexAdapter, codexManifest, codexStreamParser } from "@mordomo/adapter-codex";
import { cursorManifest, cursorStreamParser } from "@mordomo/adapter-cursor";
import { exceedsShapeBudget } from "../core/src/agents/streamTally.js";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

const STREAMS = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "streams");

const fixtureLines = (rel: string): string[] =>
  fs
    .readFileSync(path.join(STREAMS, rel), "utf8")
    .split("\n")
    .filter((l) => l.trim());

const jsonlIn = (dir: string): string[] =>
  fs
    .readdirSync(path.join(STREAMS, dir))
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => `${dir}/${f}`);

/** What a parser emits for a whole fixture, with `ts` dropped (non-JSON lines become text, as in baseExec). */
function eventsOf(parser: LineParser, rel: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of fixtureLines(rel)) {
    const events = parser.parseLine(line) ?? [
      { type: "text", ts: 0, stream: "stdout", text: line } as RunEvent,
    ];
    for (const { ts: _ts, ...rest } of events) out.push(rest);
  }
  return out;
}

const expected = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(STREAMS, rel), "utf8"));

describe("S1 - the CLI messages have a type", () => {
  it("C1 every fixture line matches its schema", () => {
    const claude = jsonlIn("claude");
    const codex = jsonlIn("codex");
    expect(claude.length).toBeGreaterThanOrEqual(3);
    expect(codex.length).toBeGreaterThanOrEqual(4);
    for (const rel of claude) {
      for (const line of fixtureLines(rel)) {
        const r = ClaudeStreamMessage.safeParse(JSON.parse(line));
        expect(r.success, `${rel}: ${line.slice(0, 120)} ${r.error?.message ?? ""}`).toBe(true);
      }
    }
    for (const rel of codex) {
      for (const line of fixtureLines(rel)) {
        const r = CodexStreamEvent.safeParse(JSON.parse(line));
        expect(r.success, `${rel}: ${line.slice(0, 120)} ${r.error?.message ?? ""}`).toBe(true);
      }
    }

    // Passthrough: a field a new CLI adds is kept, at the top and inside nested objects.
    const result = JSON.parse(fixtureLines("claude/complete-run.jsonl").at(-1)!) as Record<string, unknown>;
    const claudeExtra = ClaudeStreamMessage.parse({
      ...result,
      novo: 1,
      usage: { ...(result.usage as object), novo: 2 },
    }) as Record<string, unknown>;
    expect(claudeExtra.novo).toBe(1);
    expect((claudeExtra.usage as Record<string, unknown>).novo).toBe(2);

    const item = JSON.parse(
      fixtureLines("codex/item-type-current.jsonl").find((l) => l.includes("agent_message"))!,
    );
    const codexExtra = CodexStreamEvent.parse({
      ...item,
      novo: 1,
      item: { ...item.item, novo: 2 },
    }) as Record<string, unknown>;
    expect(codexExtra.novo).toBe(1);
    expect((codexExtra.item as Record<string, unknown>).novo).toBe(2);
  });

  it("C2 the stream schemas are part of the contract", async () => {
    const contracts = await import("@mordomo/contracts");
    expect(contracts.ClaudeStreamMessage).toBe(ClaudeStreamMessage);
    expect(contracts.CodexStreamEvent).toBe(CodexStreamEvent);
    expect(typeof contracts.ClaudeStreamMessage.safeParse).toBe("function");
    expect(typeof contracts.CodexStreamEvent.safeParse).toBe("function");
    // Door 1 commits the two schemas; the pieces they are built from stay module-internal.
    const streamNames = Object.keys(contracts).filter((n) => /^(Claude|Codex)|Stream|SessionId/.test(n));
    expect(streamNames.sort()).toEqual([
      "ClaudeStreamMessage",
      "CodexStreamEvent",
      "KnownStreamTypes",
      "SessionId",
    ]);
  });

  it("C3 the claude parser keeps its event sequence", () => {
    const parser = claudeStreamParser();
    expect(eventsOf(parser, "claude/complete-run.jsonl")).toEqual(
      expected("claude/complete-run.events.json"),
    );
    expect(parser.finish!()).toEqual([]);
  });

  it("C4 both codex item shapes parse alike", () => {
    const want = expected("codex/item-type.events.json");
    // The files a `file_change` wrote now travel as `paths` (C15); everything else is as before the feature.
    const withoutPaths = (events: Array<Record<string, unknown>>) =>
      events.map(({ paths: _paths, ...rest }) => rest);
    const filePaths = (events: Array<Record<string, unknown>>) =>
      events.filter((e) => e.paths).map((e) => e.paths);
    const current = codexStreamParser();
    const currentEvents = eventsOf(current, "codex/item-type-current.jsonl");
    expect(withoutPaths(currentEvents)).toEqual(want);
    expect(filePaths(currentEvents)).toEqual([
      ["/home/owner/project/README.md"],
      ["/home/owner/project/README.md"],
    ]);
    expect(current.finish!()).toEqual([]);
    const earlier = codexStreamParser();
    const earlierEvents = eventsOf(earlier, "codex/item-type-legacy.jsonl");
    expect(withoutPaths(earlierEvents)).toEqual(want);
    expect(filePaths(earlierEvents)).toEqual(filePaths(currentEvents));
    expect(earlier.finish!()).toEqual([]);
    const legacy = codexStreamParser();
    expect(eventsOf(legacy, "codex/legacy-msg.jsonl")).toEqual(expected("codex/legacy-msg.events.json"));
    expect(legacy.finish!()).toEqual([]);
  });
});

/** A RunManager over a temp home whose adapters run the fake CLIs. */
function useManager(): { manager: () => RunManager; paths: () => MordomoPaths } {
  let ctx: { paths: MordomoPaths; cleanup: () => void };
  let db: Db;
  let manager: RunManager;
  const adapterFor = (id: ProviderId): AgentAdapter =>
    id === "codex"
      ? new CodexAdapter({ binaryPath: path.join(FAKE_BIN, "codex") })
      : new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
  beforeEach(() => {
    ctx = makeTempHome();
    db = openDb(ctx.paths).db;
    const store = new SettingsStore(ctx.paths);
    manager = new RunManager(db, ctx.paths, () => store.load(), adapterFor);
  });
  afterEach(async () => {
    await manager.shutdown(1000);
    if (db.open) db.close();
    ctx.cleanup();
  });
  return { manager: () => manager, paths: () => ctx.paths };
}

async function runFake(
  manager: RunManager,
  home: MordomoPaths,
  provider: ProviderId,
  prompt: string,
): Promise<{ status: string; events: RunEvent[]; files: string[] }> {
  const run = manager.create({
    origin: "manual",
    provider,
    prompt,
    cwd: home.home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 30_000,
    profile: "read_only",
  });
  const done = await manager.execute(run.id, prompt, "read_only");
  return {
    status: done.status,
    events: manager.eventsFor(run.id).map((e) => e.event),
    files: manager.get(run.id)?.filesChanged ?? [],
  };
}

/** A run of a fake CLI (claude by default) through the real pipeline (`executeInvocation`), no database. */
async function pipe(
  prompt: string,
  parser: LineParser,
  home: string,
  cli: { bin: string; args: string[] } = { bin: "claude", args: ["-p"] },
): Promise<RunEvent[]> {
  const executable = path.join(FAKE_BIN, cli.bin);
  const run: AgentRun = {
    runId: "typed",
    prompt,
    cwd: home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 30_000,
    profile: "read_only",
    artifactsDir: home,
  };
  const out: RunEvent[] = [];
  for await (const event of executeInvocation(
    run,
    { executable, args: cli.args, env: {}, stdin: prompt, description: `fake ${cli.bin}` },
    parser,
    [executable],
  )) {
    out.push(event);
  }
  return out;
}

/** A parser that adds up the time spent in its `parseLine`: the part of a run that blocks the daemon's event loop. */
function timed(parser: LineParser): { parser: LineParser; spentMs: () => number } {
  let spent = 0;
  return {
    parser: {
      ...parser,
      parseLine(line) {
        const t0 = performance.now();
        try {
          return parser.parseLine(line);
        } finally {
          spent += performance.now() - t0;
        }
      },
    },
    spentMs: () => spent,
  };
}

const textsOf = (events: RunEvent[]): string[] => events.flatMap((e) => (e.type === "text" ? [e.text] : []));
const HINT = "Usage, cost or the file list may be incomplete; check the CLI version in Settings › Providers.";

describe("S1 - the fake codex", () => {
  const h = useManager();

  it("C5 the fake codex speaks the current format", async () => {
    const out = execFileSync(path.join(FAKE_BIN, "codex"), ["exec", "--json", "hello"], { encoding: "utf8" });
    const items = out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { type: string; item?: Record<string, unknown> })
      .filter((e) => e.item);
    expect(items.length).toBeGreaterThan(0);
    for (const e of items) {
      expect(typeof e.item!.type).toBe("string");
      expect(e.item).not.toHaveProperty("item_type");
    }

    const { status, events } = await runFake(h.manager(), h.paths(), "codex", "hello");
    expect(status).toBe("done");
    expect(events.find((e) => e.type === "assistant")).toMatchObject({ text: "Codex fake reply." });
    expect(events.find((e) => e.type === "usage")).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(events.some((e) => e.type === "text" && e.text.includes("unrecognized"))).toBe(false);
  });
});

describe("S2 - a strange line never sinks a run", () => {
  const h = useManager();
  const MiB = 1024 * 1024;
  const parsers: Record<string, () => LineParser> = {
    claude: claudeStreamParser,
    codex: codexStreamParser,
    cursor: cursorStreamParser,
  };

  it("C6 a strange line never throws", () => {
    const big = {
      claude: JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "x".repeat(MiB) }] },
      }),
      codex: JSON.stringify({
        type: "item.completed",
        item: { id: "i", type: "agent_message", text: "x".repeat(MiB) },
      }),
      cursor: JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "x".repeat(MiB) }] },
      }),
    };
    // Valid JSON that is not an object, and objects whose nested shapes are wrong.
    const notObjects = ["null", "[]", "[1]", '"str"', "42", "true"];
    const badShapes = [
      '{"type":"assistant","message":{"content":5}}',
      '{"type":"assistant","message":{"content":[null,5,"x",[]]}}',
      '{"type":"assistant","message":null}',
      '{"type":"assistant","message":"text"}',
      '{"type":"assistant","message":{"content":{"a":1},"usage":"x"}}',
      '{"type":"user","message":{"content":[null]}}',
      '{"type":"result","usage":5,"modelUsage":[1]}',
      '{"type":"item.completed","item":null}',
      '{"type":"item.completed","item":{"type":"file_change","changes":5}}',
      '{"type":"turn.completed","usage":[]}',
      '{"msg":null}',
      '{"msg":{"type":5}}',
      '{"type":5}',
      "{}",
    ];
    for (const [name, make] of Object.entries(parsers)) {
      const parser = make();
      // `null` is the LineParser contract for "not mine": executeInvocation turns it into a `text` event.
      expect(parser.parseLine("oi"), name).toBeNull();
      expect(parser.parseLine('{"type":"assistant"'), name).toBeNull();
      for (const line of notObjects) expect(parser.parseLine(line), `${name} ${line}`).toBeNull();
      for (const line of badShapes) {
        expect(() => parser.parseLine(line), `${name} ${line}`).not.toThrow();
      }
      const bigLine = big[name as keyof typeof big];
      expect(bigLine.length).toBeGreaterThanOrEqual(MiB);
      expect(() => parser.parseLine(bigLine), name).not.toThrow();
      expect(() => parser.finish?.(), name).not.toThrow();
    }
  });

  it("C7 unknown lines become one warning", async () => {
    const { status, events } = await runFake(h.manager(), h.paths(), "claude", "hello [[unknown:novidade]]");
    expect(status).toBe("done");
    const warnings = events.filter((e) => e.type === "text" && e.text.includes("unrecognized"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      type: "text",
      stream: "stderr",
      text: `[mordomo] claude emitted 2 unrecognized line(s): unknown type novidade. ${HINT}`,
    });
    const resultAt = events.findIndex((e) => e.type === "result");
    expect(resultAt).toBeGreaterThan(-1);
    expect(events.indexOf(warnings[0]!)).toBeLessThan(resultAt);
  });

  it("C8 a known run has no warning", async () => {
    const { status, events } = await runFake(h.manager(), h.paths(), "claude", "hello");
    expect(status).toBe("done");
    expect(events.some((e) => e.type === "result")).toBe(true);
    expect(events.filter((e) => JSON.stringify(e).includes("unrecognized"))).toEqual([]);
  });

  it("C9 a wrong needed field is unrecognized, never NaN or negative", () => {
    // A field the line is about (the cost of a result, the usage of a turn) rejects the line.
    const claude = claudeStreamParser();
    expect(claude.parseLine('{"type":"result","subtype":"success","total_cost_usd":"x"}')).toEqual([]);
    expect(claude.parseLine('{"type":"result","subtype":"success","total_cost_usd":-1}')).toEqual([]);
    expect(claude.parseLine('{"type":"result","subtype":"success","total_cost_usd":1e999}')).toEqual([]);
    expect(claude.finish!()).toMatchObject([
      {
        text: `[mordomo] claude emitted 3 unrecognized line(s): known type result with an invalid field. ${HINT}`,
      },
    ]);

    const codex = codexStreamParser();
    const fromCodex = [
      '{"type":"turn.completed","usage":{"input_tokens":4,"output_tokens":"x"}}',
      '{"type":"turn.completed","usage":{"input_tokens":-4,"output_tokens":1}}',
      '{"type":"turn.completed","usage":{"input_tokens":1e999,"output_tokens":1}}',
    ].map((l) => codex.parseLine(l));
    expect(fromCodex).toEqual([[], [], []]);
    expect(codex.finish!()).toMatchObject([
      {
        text: `[mordomo] codex emitted 3 unrecognized line(s): known type turn.completed with an invalid field. ${HINT}`,
      },
    ]);

    // Legacy token_count: the usage blocks are strict for that message type alone.
    const legacy = codexStreamParser();
    expect(
      legacy.parseLine('{"msg":{"type":"token_count","info":{"total_token_usage":{"input_tokens":-1}}}}'),
    ).toEqual([]);
    expect(
      legacy.parseLine('{"msg":{"type":"exec_command_begin","info":5,"token_usage":"x"}}'),
    ).toMatchObject([{ type: "tool_use", tool: "exec_command_begin" }]);
  });

  it("C18 the warning names the real reason and prints only safe text", () => {
    const claude = claudeStreamParser();
    claude.parseLine('{"type":"novidade"}');
    claude.parseLine('{"type":"result","subtype":"success","total_cost_usd":"x"}');
    claude.parseLine('{"type":"x\\n\\u001b[31mred\\u202e' + "a".repeat(100) + '"}');
    claude.parseLine('{"no":"type"}');
    const [warning] = claude.finish!() as Array<Extract<RunEvent, { type: "text" }>>;
    expect(warning!.text).toBe(
      "[mordomo] claude emitted 4 unrecognized line(s): unknown type novidade, " +
        "known type result with an invalid field, unknown type x???31mred?" +
        "a".repeat(40 - "x???31mred?".length) +
        `, unknown type (no type). ${HINT}`,
    );
    // No control or bidi character survives into the trace.
    expect([...warning!.text].filter((c) => c < " " || c === "\u202e")).toEqual([]);

    // Codex items name their own type: `item.completed` alone would hide what changed.
    const codex = codexStreamParser();
    codex.parseLine('{"type":"item.completed","item":{"id":"i","type":"collab_tool_call"}}');
    codex.parseLine('{"type":"item.completed","item":{"id":"i","type":"agent_message","text":{"a":1}}}');
    codex.parseLine('{"type":"item.completed","item":{"id":"i","item_type":"agent_message","text":{"a":1}}}');
    codex.parseLine('{"type":"thread.started","thread_id":"-x"}');
    codex.parseLine('{"msg":{"type":"token_count","info":5}}');
    expect(codex.finish!()).toMatchObject([
      {
        text:
          "[mordomo] codex emitted 5 unrecognized line(s): unknown type item.completed/collab_tool_call, " +
          "known type item.completed/agent_message with an invalid field, known type thread.started with an invalid field, " +
          `known type msg.token_count with an invalid field. ${HINT}`,
      },
    ]);
  });

  it("C19 a provider session id is a plain token, here and on the command line", async () => {
    const good = "9a3c1e2f-5b7d-4c8e-9f10-2a3b4c5d6e7f";
    const claude = claudeStreamParser();
    expect(claude.parseLine(`{"type":"system","subtype":"init","session_id":"${good}"}`)).toMatchObject([
      { type: "session", providerSessionId: good },
      { type: "text" },
    ]);
    // Real control characters (JSON.stringify turns them into escapes on the wire and the parser reads them back):
    // a line break, a carriage return, a tab and NUL are in no way the two characters backslash + `n`.
    const bad = [
      "-rf",
      "a b",
      "a\nb",
      "a\n",
      "\nabc",
      "a\rb",
      "a\r",
      "a\tb",
      "a\u0000b",
      "a/b",
      "..",
      "../x",
      "",
      "x".repeat(201),
      "é",
    ];
    // The tail is `[\w.:-]`: every other printable ASCII character, and anything past ASCII, is refused.
    for (let code = 0x20; code < 0x7f; code++) {
      const ch = String.fromCharCode(code);
      if (!/[\w.:-]/.test(ch)) bad.push(`a${ch}b`);
    }
    bad.push("aé", "a\u0080", "a\uffff", "a\u{1F600}");
    expect(bad.some((id) => id.includes("\n"))).toBe(true); // a real LF, not backslash + n
    for (const id of bad) {
      expect(
        claude.parseLine(JSON.stringify({ type: "system", subtype: "init", session_id: id })),
        id,
      ).toEqual([]);
    }
    const codex = codexStreamParser();
    expect(codex.parseLine(`{"type":"thread.started","thread_id":"${good}"}`)).toMatchObject([
      { type: "session", providerSessionId: good },
    ]);
    for (const id of bad) {
      expect(codex.parseLine(JSON.stringify({ type: "thread.started", thread_id: id })), id).toEqual([]);
      expect(
        codex.parseLine(JSON.stringify({ msg: { type: "session_configured", session_id: id } })),
        id,
      ).toEqual([]);
      expect(
        codex.parseLine(JSON.stringify({ msg: { type: "token_count", session_id: id, info: null } })),
        id,
      ).toEqual([]);
      // The oldest shape also carries the id at the top of the line, beside `msg`.
      expect(codex.parseLine(JSON.stringify({ session_id: id, msg: { type: "x" } })), id).toEqual([]);
    }
    expect(codexStreamParser().parseLine(`{"session_id":"${good}","msg":{"type":"x"}}`)).toMatchObject([
      { type: "session", providerSessionId: good },
    ]);

    // What an earlier version stored is checked again before it reaches argv.
    const run = (providerSessionId: string): AgentRun => ({
      runId: "r",
      prompt: "hi",
      cwd: os.tmpdir(),
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 1000,
      profile: "read_only",
      artifactsDir: os.tmpdir(),
      resume: { providerSessionId },
    });
    const claudeAdapter = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
    const codexAdapter = new CodexAdapter({ binaryPath: path.join(FAKE_BIN, "codex") });
    for (const id of ["--dangerously-evil", "-x", "abc\ndef", "abc\tdef", "a/b", ".."]) {
      const c = await claudeAdapter.buildInvocation(run(id), "new-session");
      expect(c.args, id).not.toContain(id);
      expect(c.args, id).toContain("--session-id");
      expect((await codexAdapter.buildInvocation(run(id))).args, id).not.toContain(id);
    }
    expect((await claudeAdapter.buildInvocation(run(good), "new")).args).toEqual(
      expect.arrayContaining(["--resume", good]),
    );
    expect((await codexAdapter.buildInvocation(run(good))).args).toEqual(
      expect.arrayContaining(["resume", good]),
    );
  });

  it("C20 a bad decorative field does not drop the line", () => {
    const claude = claudeStreamParser();
    const message = (extra: Record<string, unknown>) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", id: "t1", name: "Write", input: { file_path: "/a.ts" } },
          ],
          ...extra,
        },
      });
    const kept = [
      { type: "assistant", text: "hello" },
      { type: "tool_use", tool: "Write" },
    ];
    // The text and the tool call survive a usage block (or model) of the wrong shape ...
    for (const extra of [
      { usage: { input_tokens: null, output_tokens: 3 } },
      { usage: { input_tokens: "x" } },
      { usage: { input_tokens: -4, output_tokens: 1 } },
      { usage: "x", model: 5 },
    ]) {
      expect(claude.parseLine(message(extra)), JSON.stringify(extra)).toMatchObject(kept);
    }
    // ... and a null usage is simply absent.
    expect(claude.parseLine(message({ usage: null }))).toMatchObject(kept);
    // The cost of a result survives its usage block, and its modelUsage, being wrong.
    for (const extra of [
      { usage: null },
      { usage: { input_tokens: "x" } },
      { modelUsage: 5 },
      { usage: [1] },
    ]) {
      const events = claude.parseLine(
        JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.25, result: "ok", ...extra }),
      );
      expect(events, JSON.stringify(extra)).toMatchObject([{ type: "usage", scope: "total", costUsd: 0.25 }]);
      for (const e of events ?? []) {
        if (e.type === "usage") expect(e.inputTokens).toBe(0);
      }
    }
    // A bad usage block is ignored but not forgotten: the warning counts it (null and absent are not drift).
    const [warning] = claude.finish!() as Array<Extract<RunEvent, { type: "text" }>>;
    expect(warning!.text).toContain(
      "emitted 6 unrecognized line(s): known type assistant with an invalid field, known type result with an invalid field.",
    );

    // The same holds for every other field that only labels a line. A `model` of the wrong type reads as absent:
    // the Claude `system` line still starts the session ...
    const labels = claudeStreamParser();
    expect(labels.parseLine('{"type":"system","subtype":"init","session_id":"s1","model":5}')).toMatchObject([
      { type: "session", providerSessionId: "s1" },
      { type: "text", text: "[claude session started: model=?]" },
    ]);
    // ... a `modelUsage` entry with a bad `outputTokens` is skipped, not the whole map ...
    expect(
      labels.parseLine(
        '{"type":"result","subtype":"success","total_cost_usd":1,"modelUsage":{"a":{"outputTokens":"x"},"b":{"outputTokens":5}}}',
      ),
    ).toMatchObject([{ type: "usage", scope: "total", costUsd: 1, model: "b" }]);
    expect(labels.finish!()).toEqual([]);

    // ... a Codex event keeps its usage (and the model, when it is a string) ...
    const codex = codexStreamParser();
    expect(
      codex.parseLine('{"type":"turn.completed","model":5,"usage":{"input_tokens":4,"output_tokens":2}}'),
    ).toEqual([expect.objectContaining({ type: "usage", inputTokens: 4, outputTokens: 2 })]);
    expect(
      codex.parseLine(
        '{"type":"turn.completed","model":"gpt-x","usage":{"input_tokens":1,"output_tokens":1}}',
      ),
    ).toMatchObject([{ type: "usage", model: "gpt-x" }]);
    // ... and so does a message of the oldest shape, whose `message` or `model` is not a string.
    expect(codex.parseLine('{"msg":{"type":"exec_command_begin","message":5,"command":"ls"}}')).toMatchObject(
      [{ type: "tool_use", tool: "exec_command_begin" }],
    );
    expect(codex.parseLine('{"model":5,"msg":{"type":"exec_command_end","exit_code":0}}')).toMatchObject([
      { type: "tool_use", tool: "exec_command_end" },
    ]);
    expect(codex.finish!()).toEqual([]);
  });

  it("C21 a failed codex turn is never silent", () => {
    const parser = codexStreamParser();
    const events = eventsOf(parser, "codex/failed-turn.jsonl");
    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", stream: "stderr", text: "[codex] error: command timed out" },
      { type: "text", stream: "stderr", text: "[codex] error: Reconnecting... 1/5" },
      { type: "text", stream: "stderr", text: "[codex] turn failed: stream disconnected before completion" },
    ]);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(parser.finish!()).toEqual([]);
    // Without a message there is still a line saying the turn failed.
    expect(codexStreamParser().parseLine('{"type":"turn.failed"}')).toMatchObject([
      { type: "text", text: "[codex] turn failed" },
    ]);
  });

  it("C26 the text of a CLI failure is one plain line and cannot pose as a notice", () => {
    // A newline, colour and cursor escapes, bidi and line separators, a bell, a window-title sequence: none survives.
    const hostile =
      "x\n[mordomo] claude emitted 0 unrecognized line(s)\u001b[31m\u202e\u2028\r\u0007red\u001b]0;title\u0007end";
    const plain = "[codex] turn failed: x [mordomo] claude emitted 0 unrecognized line(s) redend";
    const parser = codexStreamParser();
    const textOf = (line: unknown) => {
      const [event] = parser.parseLine(JSON.stringify(line)) ?? [];
      return event?.type === "text" ? event.text : event;
    };
    expect(textOf({ type: "turn.failed", error: { message: hostile } })).toBe(plain);
    expect(textOf({ type: "error", message: hostile })).toBe(plain.replace("turn failed", "error"));
    expect(textOf({ type: "item.completed", item: { type: "error", message: hostile } })).toBe(
      plain.replace("turn failed", "error"),
    );
    // The oldest shape's error takes the same road (it becomes a permission note).
    expect(parser.parseLine(JSON.stringify({ msg: { type: "error", message: hostile } }))).toMatchObject([
      { type: "permission", detail: "x [mordomo] claude emitted 0 unrecognized line(s) redend" },
    ]);
    // No character that could break the line or the terminal reaches the trace.
    expect([...plain].filter((c) => c < " " || c === "\u202e")).toEqual([]);

    // Cut at 400 characters, never in the middle of a surrogate pair, and a megabyte costs nothing.
    const long = textOf({ type: "error", message: "😀".repeat(300) }) as string;
    expect(long).toBe(`[codex] error: ${"😀".repeat(199)}…`);
    const started = performance.now();
    const huge = textOf({ type: "error", message: "\u001b[".repeat(2_000_000) + "tail" }) as string;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(huge).toBe("[codex] error");
    // A message that is only control characters says nothing, like no message.
    expect(textOf({ type: "turn.failed", error: { message: "\n\u202e " } })).toBe("[codex] turn failed");
  });

  it("C32 every bidi, zero-width and other format character of a CLI failure becomes a space", () => {
    // The class the filter promises (Unicode `Cf`), one code point at a time: a filter that handles `U+202E` alone,
    // or only the zero-width ones, leaves the rest to reorder or hide text in the trace.
    const ranges: Array<[string, number, number]> = [
      ["zero-width and direction marks", 0x200b, 0x200f],
      ["embedding and override", 0x202a, 0x202e],
      ["word joiner and invisible operators", 0x2060, 0x2064],
      ["isolates", 0x2066, 0x2069],
      ["byte order mark / zero-width no-break space", 0xfeff, 0xfeff],
      ["soft hyphen", 0x00ad, 0x00ad],
      ["arabic letter mark", 0x061c, 0x061c],
      ["language tag", 0xe0001, 0xe0001],
      ["tag letter", 0xe0041, 0xe0041],
    ];
    const parser = codexStreamParser();
    const failure = (message: string) => {
      const [event] = parser.parseLine(JSON.stringify({ type: "turn.failed", error: { message } })) ?? [];
      return event?.type === "text" ? event.text : event;
    };
    let tried = 0;
    for (const [what, from, to] of ranges) {
      for (let code = from; code <= to; code++) {
        const ch = String.fromCodePoint(code);
        const label = `${what} U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
        expect(failure(`a${ch}b`), label).toBe("[codex] turn failed: a b");
        // Alone it is nothing to say; around text it neither survives nor glues two words together.
        expect(failure(`${ch}${ch}`), label).toBe("[codex] turn failed");
        expect(failure(`end${ch}`), label).toBe("[codex] turn failed: end");
        tried++;
      }
    }
    expect(tried).toBe(5 + 5 + 5 + 4 + 1 + 1 + 1 + 1 + 1);
  });

  it("C22 a throwing parser, or a huge line, costs that line and nothing more", async () => {
    const home = h.paths().home;
    // A parser that throws on every line, on finish and on summarize still lets the run end with its result.
    const generic = await pipe(
      "hello",
      {
        parseLine() {
          throw new TypeError("boom");
        },
        summarize() {
          throw new Error("nope");
        },
        finish() {
          throw new Error("late");
        },
      },
      home,
    );
    expect(generic.some((e) => e.type === "error")).toBe(false);
    expect(textsOf(generic)).toEqual([
      "[mordomo] a line of provider output could not be read and was skipped.",
      "[mordomo] the output parser failed while closing the run; the trace may be incomplete.",
    ]);
    expect(generic.at(-1)).toMatchObject({ type: "result", exitCode: 0, summary: "" });

    // A parser that counts dropped lines gets one call per line, and says so once in its warning.
    let dropped = 0;
    const counting = await pipe(
      "hello",
      {
        parseLine() {
          throw new Error("boom");
        },
        summarize: () => "",
        dropped: () => void dropped++,
      },
      home,
    );
    expect(dropped).toBe(4);
    expect(counting.at(-1)).toMatchObject({ type: "result", exitCode: 0 });

    // A 1 MiB line arrives in many chunks and is read whole ...
    const long = await pipe("hello [[long]]", claudeStreamParser(), home);
    const longText = long.find((e) => e.type === "assistant" && e.text.length > 1000);
    expect(longText?.type === "assistant" && longText.text.length).toBe(MiB);
    expect(textsOf(long).filter((t) => t.includes("unrecognized"))).toEqual([]);

    // ... a 5 MiB line (over the 4 MiB cap) is dropped and counted once, and the run goes on.
    const huge = await pipe("hello [[huge]]", claudeStreamParser(), home);
    expect(huge.some((e) => e.type === "assistant" && e.text.length > 1000)).toBe(false);
    expect(textsOf(huge).filter((t) => t.includes("unrecognized"))).toEqual([
      `[mordomo] claude emitted 1 unrecognized line(s): an unreadable line. ${HINT}`,
    ]);
    expect(huge.some((e) => e.type === "tool_use")).toBe(true);
    expect(huge.at(-1)).toMatchObject({ type: "result", exitCode: 0 });
    // The parser that does not count (cursor) gets the generic note, once.
    const cursor = await pipe("hello [[huge]] [[huge]]", cursorStreamParser(), home);
    expect(textsOf(cursor).filter((t) => t.includes("could not be read"))).toHaveLength(1);
  });

  it("C23 a stream that ends without a newline still yields its last line", async () => {
    // The `result` line carries the cost; a CLI that exits right after printing it leaves no `\n` behind.
    const events = await pipe("hello [[nonl]]", claudeStreamParser(), h.paths().home);
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      type: "usage",
      scope: "total",
      costUsd: 0.5,
    });
    expect(events.at(-1)).toMatchObject({ type: "result", exitCode: 0, summary: "No newline." });
    expect(textsOf(events).filter((t) => t.includes("unrecognized"))).toEqual([]);
    // It is parsed as a line, not echoed as raw text.
    expect(events.some((e) => e.type === "text" && e.text.includes("total_cost_usd"))).toBe(false);
  });

  it("C31 an unterminated last line is counted, whether it is over the size cap or of an unknown type", async () => {
    const home = h.paths().home;
    // Over the cap (5 MiB) and no `\n`: dropped and counted once as unreadable, never echoed as text, the run ends.
    const huge = await pipe("hello [[nonl-huge]]", claudeStreamParser(), home);
    expect(huge.some((e) => e.type === "text" && e.text.length > 1000)).toBe(false);
    expect(huge.some((e) => e.type === "assistant" && e.text.length > 1000)).toBe(false);
    expect(textsOf(huge).filter((t) => t.includes("unrecognized"))).toEqual([
      `[mordomo] claude emitted 1 unrecognized line(s): an unreadable line. ${HINT}`,
    ]);
    expect(huge.at(-1)).toMatchObject({ type: "result", exitCode: 0 });
    // The parser that does not count (cursor) gets the generic note for it, once.
    const cursor = await pipe("hello [[nonl-huge]]", cursorStreamParser(), home);
    expect(textsOf(cursor).filter((t) => t.includes("could not be read"))).toHaveLength(1);

    // An unknown type as the unterminated last line is part of the one warning, which is emitted at the close.
    const unknown = await pipe("hello [[unknown:novidade]] [[nonl-unknown]]", claudeStreamParser(), home);
    const warnings = textsOf(unknown).filter((t) => t.includes("unrecognized"));
    expect(warnings).toEqual([
      `[mordomo] claude emitted 3 unrecognized line(s): unknown type novidade, unknown type ultima. ${HINT}`,
    ]);
    expect(unknown.some((e) => e.type === "text" && e.text.includes('"ultima"'))).toBe(false);
    const warningAt = unknown.findIndex((e) => e.type === "text" && e.text.includes("unrecognized"));
    expect(warningAt).toBeGreaterThan(-1);
    expect(warningAt).toBeLessThan(unknown.findIndex((e) => e.type === "result"));
    // Alone, it is the whole warning.
    const only = await pipe("hello [[nonl-unknown]]", claudeStreamParser(), home);
    expect(textsOf(only).filter((t) => t.includes("unrecognized"))).toEqual([
      `[mordomo] claude emitted 1 unrecognized line(s): unknown type ultima. ${HINT}`,
    ]);
  });

  it("C24 a hostile wrong-shape array line costs a skipped line, not seconds of the event loop", async () => {
    const home = h.paths().home;
    // A ~4 MB line (under the 4 MiB cap) whose list holds two million `1`s: a schema that reported every wrong
    // element took 14 s (codex) and 4 s (claude) and 567 MB here. Now the line is counted and never checked.
    const cases = [
      {
        provider: "claude",
        parser: claudeStreamParser(),
        cli: { bin: "claude", args: ["-p"] },
        label: "type assistant with an oversized structure",
        after: (events: RunEvent[]) =>
          expect(events.at(-1)).toMatchObject({
            type: "result",
            exitCode: 0,
            summary: expect.stringContaining("All done"),
          }),
      },
      {
        provider: "codex",
        parser: codexStreamParser(),
        cli: { bin: "codex", args: ["exec", "--json", "[[wide]]"] },
        label: "type item.completed/file_change with an oversized structure",
        after: (events: RunEvent[]) => {
          expect(events.find((e) => e.type === "assistant")).toMatchObject({ text: "Codex fake reply." });
          expect(events.find((e) => e.type === "usage")).toMatchObject({ inputTokens: 10, outputTokens: 5 });
          expect(events.at(-1)).toMatchObject({ type: "result", exitCode: 0 });
        },
      },
    ];
    for (const c of cases) {
      const t = timed(c.parser);
      const events = await pipe("hello [[wide]]", t.parser, home, c.cli);
      expect(t.spentMs(), c.provider).toBeLessThan(1000);
      expect(
        textsOf(events).filter((x) => x.includes("unrecognized")),
        c.provider,
      ).toEqual([`[mordomo] ${c.provider} emitted 1 unrecognized line(s): ${c.label}. ${HINT}`]);
      expect(
        events.some((e) => e.type === "error"),
        c.provider,
      ).toBe(false);
      // The skipped line is counted, never echoed: a 4 MB line must not reach the trace as text (nor the journal).
      expect(
        events.some((e) => e.type === "text" && (e.text.length > 1000 || e.text.includes("1,1,1,1"))),
        c.provider,
      ).toBe(false);
      c.after(events);
    }

    // The budget itself: an array past 10 000 items, or past 50 000 values in all (members and elements, nested).
    const list = (n: number) => Array.from({ length: n }, () => 1);
    expect(exceedsShapeBudget({ a: list(10_000) })).toBe(false);
    expect(exceedsShapeBudget({ a: list(10_001) })).toBe(true);
    expect(
      exceedsShapeBudget({
        a: [list(9_000), list(9_000), list(9_000), list(9_000), list(9_000), list(9_000)],
      }),
    ).toBe(true);
    expect(exceedsShapeBudget(Object.fromEntries(list(60_000).map((_, i) => [`k${i}`, i])))).toBe(true);
    let deep: unknown = 1;
    for (let i = 0; i < 200_000; i++) deep = [deep];
    expect(exceedsShapeBudget(deep)).toBe(true); // 200 000 values; and walking it does not overflow the stack
    // A real line stays well inside it: a patch of 3000 files is read, and keeps its first 200 paths.
    const patch = codexStreamParser();
    const big = Array.from({ length: 3000 }, (_, i) => ({ path: `/repo/f${i}.ts`, kind: "update" }));
    const [tool] =
      patch.parseLine(
        JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: big } }),
      ) ?? [];
    expect(tool?.type === "tool_use" && tool.paths).toHaveLength(200);
    expect(patch.finish!()).toEqual([]);
  });
});

describe("fixtures (extra)", () => {
  it("every fixture parses without an unrecognized-line warning", () => {
    for (const rel of jsonlIn("claude")) {
      const parser = claudeStreamParser();
      eventsOf(parser, rel);
      expect(parser.finish!(), rel).toEqual([]);
    }
    for (const rel of jsonlIn("codex")) {
      const parser = codexStreamParser();
      eventsOf(parser, rel);
      expect(parser.finish!(), rel).toEqual([]);
    }
  });

  it("names at most ten distinct types and counts every line", () => {
    const parser = claudeStreamParser();
    for (let i = 0; i < 12; i++) parser.parseLine(`{"type":"t${i}"}`);
    parser.parseLine('{"no":"type"}');
    expect(parser.finish!()).toMatchObject([
      {
        text:
          "[mordomo] claude emitted 13 unrecognized line(s): unknown type t0, unknown type t1, unknown type t2, " +
          "unknown type t3, unknown type t4, unknown type t5, unknown type t6, unknown type t7, unknown type t8, " +
          `unknown type t9, …. ${HINT}`,
      },
    ]);
  });
});

/** Run `fn` with the fake claude answering `--version` with `version`. */
async function withFakeClaudeVersion<T>(version: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.FAKE_CLAUDE_VERSION;
  process.env.FAKE_CLAUDE_VERSION = version;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.FAKE_CLAUDE_VERSION;
    else process.env.FAKE_CLAUDE_VERSION = before;
  }
}

describe("S3 - the installed version is checked", () => {
  it("C10 claude and codex declare the range they were developed against, cursor declares none", () => {
    expect(claudeManifest.testedVersions).toEqual({ min: "2.0.0", max: "2.1.291" });
    expect(codexManifest.testedVersions).toEqual({ min: "0.100.0", max: "0.160.1" });
    for (const manifest of [claudeManifest, codexManifest]) {
      const range = manifest.testedVersions!;
      // min <= max: both ends fall inside their own range.
      expect(versionStatus(range, range.min), manifest.id).toBe("tested");
      expect(versionStatus(range, range.max), manifest.id).toBe("tested");
    }
    // No recording or schema of cursor-agent exists to anchor a range: its status is `unknown`, never "newer".
    expect(cursorManifest.testedVersions).toBeUndefined();
    expect(versionStatus(cursorManifest.testedVersions, "2026.10.01-abc")).toBe("unknown");
  });

  it("C11 the version status follows the range", () => {
    const range = { min: "2.0.0", max: "2.1.291" };
    expect(versionStatus(range, "2.1.0 (Claude Code)")).toBe("tested");
    expect(versionStatus(range, "0.0.1")).toBe("older");
    expect(versionStatus(range, "99.0.0")).toBe("newer");
    expect(versionStatus(range, "dev build")).toBe("unknown");
    expect(versionStatus(range, "2.0.0")).toBe("tested");
    expect(versionStatus(range, "2.1.291 (Claude Code)")).toBe("tested");
    // Extra edges: numeric, not lexical, comparison; first semver wins; nothing read; a pre-release is its release.
    expect(versionStatus(range, "2.1.1000")).toBe("newer");
    expect(versionStatus(range, "codex-cli 2.10.0 (build 3.0.0)")).toBe("newer");
    expect(versionStatus(range, "2.1.0-beta.1")).toBe("tested");
    expect(versionStatus(range, null)).toBe("unknown");
    expect(versionStatus(undefined, "2.1.0")).toBe("unknown");
    expect(versionStatus({ min: "x", max: "2.0.0" }, "2.1.0")).toBe("unknown");
    // The parsed version is what screens show.
    expect(installedVersion("codex-cli 0.99.0-fake")).toBe("0.99.0");
    expect(installedVersion("9.9.9-fake (Claude Code)")).toBe("9.9.9");
    expect(installedVersion("2025.09.18-abcdef")).toBe("2025.9.18");
    expect(installedVersion("dev build")).toBeNull();
    expect(installedVersion(null)).toBeNull();
  });

  describe("GET /api/providers", () => {
    let restorePath: () => void;
    let cleanup: () => void;
    let ctx: AppContext;
    let app: FastifyInstance;

    beforeAll(async () => {
      restorePath = withFakeBinPath();
      const tmp = makeTempHome("mordomo-typed-api-");
      cleanup = tmp.cleanup;
      ctx = new AppContext(tmp.paths.home);
      const settings = ctx.settings();
      settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
      settings.setupCompleted = true;
      ctx.settingsStore.save(settings);
      ctx.reloadAdapters();
      app = await buildServer(ctx);
    });

    afterAll(async () => {
      await app.close();
      ctx.close();
      restorePath();
      cleanup();
    });

    type Snapshot = {
      id: string;
      installedVersion: string | null;
      versionStatus: string;
      testedVersions: { min: string; max: string } | null;
    };
    const snapshots = async (claudeVersion: string): Promise<Record<string, Snapshot>> => {
      const res = await withFakeClaudeVersion(claudeVersion, () =>
        app.inject({
          method: "GET",
          url: "/api/providers?force=1",
          headers: { "x-mordomo-token": ctx.token() },
        }),
      );
      expect(res.statusCode).toBe(200);
      const list = res.json() as Snapshot[];
      expect(list.map((s) => s.id).sort()).toEqual(["claude", "codex", "cursor"]);
      return Object.fromEntries(list.map((s) => [s.id, s]));
    };

    it("C12 an older CLI is reported as older", async () => {
      const snap = await snapshots("0.0.1");
      expect(snap.claude).toMatchObject({ installedVersion: "0.0.1", versionStatus: "older" });
    });

    it("C13 snapshots carry the version status", async () => {
      const snap = await snapshots("2.1.0");
      // Fake CLIs: claude 2.1.0 (asked for), codex 0.99.0-fake, cursor 2025.01.15.
      expect(snap.claude).toMatchObject({
        installedVersion: "2.1.0",
        versionStatus: "tested",
        testedVersions: { min: "2.0.0", max: "2.1.291" },
      });
      expect(snap.codex).toMatchObject({
        installedVersion: "0.99.0",
        versionStatus: "older",
        testedVersions: { min: "0.100.0", max: "0.160.1" },
      });
      expect(snap.cursor).toMatchObject({
        installedVersion: "2025.1.15",
        versionStatus: "unknown",
        testedVersions: null,
      });
    });
  });
});

describe("S4 - writes reach filesChanged", () => {
  const h = useManager();
  const WINDOWS = "C:\\work\\b.ts";
  const change = (changes: Array<{ path: string; kind?: string }>) => ({
    type: "item.completed",
    item: { id: "item_9", type: "file_change", changes, status: "completed" },
  });

  it("C15 every path of a codex file_change counts as changed", async () => {
    const parse = codexStreamParser();
    const events = parse.parseLine(
      JSON.stringify(
        change([
          { path: "/home/owner/project/a.md", kind: "update" },
          { path: WINDOWS, kind: "add" },
        ]),
      ),
    );
    const tool = events?.find((e) => e.type === "tool_use");
    expect(tool?.type === "tool_use" && codexManifest.writeToolPattern.test(tool.tool)).toBe(true);
    // The paths are data on the event: a Windows path keeps its single backslashes.
    expect(tool).toMatchObject({ paths: ["/home/owner/project/a.md", WINDOWS] });
    expect(tool?.type === "tool_use" && tool.detail).toBe('{"status":"completed"}');

    // End to end through the RunManager: the fake codex patches seven files, two short and five long ones.
    const { status, files } = await runFake(h.manager(), h.paths(), "codex", "[[patch]] do it");
    expect(status).toBe("done");
    const long = "/home/owner/project/" + "d".repeat(80);
    expect(files).toEqual([
      "/home/owner/project/a.md",
      WINDOWS,
      ...[1, 2, 3, 4, 5].map((n) => `${long}/${n}.ts`),
    ]);
  });

  it("C16 the paths of a patch are neither cut nor unbounded", () => {
    const parse = codexStreamParser();
    const many = Array.from({ length: 300 }, (_, i) => ({ path: `/repo/${"p".repeat(50)}/file-${i}.ts` }));
    const [tool] = parse.parseLine(JSON.stringify(change(many))) ?? [];
    expect(tool?.type === "tool_use" && tool.paths).toHaveLength(200);
    expect(tool?.type === "tool_use" && tool.paths?.[199]).toBe(`/repo/${"p".repeat(50)}/file-199.ts`);
    // Whole paths only: each one is verbatim, with no ellipsis, whatever its length (up to 4096).
    const longPath = "/" + "x".repeat(2000);
    const [one] =
      parse.parseLine(
        JSON.stringify(change([{ path: longPath }, { path: "" }, { path: "/" + "y".repeat(5000) }])),
      ) ?? [];
    expect(one?.type === "tool_use" && one.paths).toEqual([longPath]);
    // A file_change without a list says nothing about files (the run manager then reads `detail`, as before).
    const [bare] =
      parse.parseLine('{"type":"item.completed","item":{"type":"file_change","status":"completed"}}') ?? [];
    expect(bare).not.toHaveProperty("paths");
  });

  /** A run of a stub adapter that yields `produced` (then a clean `result`): the run's `filesChanged` and its journaled events. */
  async function runStub(produced: RunEvent[]): Promise<{ files: string[]; journaled: RunEvent[] }> {
    const adapter: AgentAdapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute() {
        yield { type: "started", ts: Date.now(), pid: null } as RunEvent;
        yield* produced;
        yield {
          type: "result",
          ts: Date.now(),
          exitCode: 0,
          summary: "ok",
          durationMs: 1,
          timedOut: false,
          cancelled: false,
        } as RunEvent;
      },
    } as unknown as AgentAdapter;
    const ctx = makeTempHome("mordomo-typed-stub-");
    const db = openDb(ctx.paths).db;
    try {
      const store = new SettingsStore(ctx.paths);
      const manager = new RunManager(
        db,
        ctx.paths,
        () => store.load(),
        () => adapter,
      );
      const run = manager.create({
        origin: "manual",
        provider: "claude",
        prompt: "write it",
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
      });
      const done = await manager.execute(run.id, "write it", "read_only");
      expect(done.status).toBe("done");
      const result = {
        files: manager.get(run.id)?.filesChanged ?? [],
        journaled: manager.eventsFor(run.id).map((e) => e.event),
      };
      await manager.shutdown(1000);
      return result;
    } finally {
      db.close();
      ctx.cleanup();
    }
  }
  const write = (extra: Record<string, unknown>): RunEvent =>
    ({ type: "tool_use", ts: Date.now(), tool: "Write", detail: "{}", phase: "start", ...extra }) as RunEvent;

  it("C17 a tool without paths records its first path only, as before", async () => {
    const { files } = await runStub([
      write({
        detail: JSON.stringify({ file_path: "/repo/a.ts", content: "cd /var/www && cat /etc/hosts" }),
      }),
      write({
        tool: "Edit",
        detail: JSON.stringify({ file_path: "/repo/with, comma.ts", old_string: "/etc/passwd" }),
      }),
    ]);
    expect(files).toEqual(["/repo/a.ts", "/repo/with,"]);
  });

  it("C25 the run manager does not trust the paths an adapter lists", async () => {
    const longest = "/" + "y".repeat(4095);
    const valid = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `/repo/${tag}-${i}.ts`);
    const { files, journaled } = await runStub([
      // Wrong kinds, an empty path and one of 4097 characters are ignored (4096 is the longest kept); of the
      // good ones only 200 count, in order.
      write({
        paths: [1, null, {}, "", "/ok/first.ts", longest, "/" + "z".repeat(4096), ...valid(300, "a")],
      }),
      // `paths` that is not a list is ignored: the tool's `detail` is read instead, as for any tool without it.
      write({ paths: "/etc/shadow", detail: JSON.stringify({ file_path: "/repo/fallback.ts" }) }),
      write({ paths: { length: 99999 }, detail: JSON.stringify({ file_path: "/repo/fallback2.ts" }) }),
      // Event after event of 200 fresh files each: the run's list stops at 5000.
      ...Array.from({ length: 30 }, (_, n) => write({ paths: valid(200, `b${n}`) })),
    ]);
    expect(files.slice(0, 4)).toEqual(["/ok/first.ts", longest, "/repo/a-0.ts", "/repo/a-1.ts"]);
    expect(files[199]).toBe("/repo/a-197.ts");
    expect(files).not.toContain("/repo/a-198.ts");
    expect(files.slice(200, 202)).toEqual(["/repo/fallback.ts", "/repo/fallback2.ts"]);
    expect(files).not.toContain("/etc/shadow");
    expect(files).toHaveLength(5000);
    // What is journaled (and streamed) is the bounded list too, not what the adapter sent.
    const tools = journaled.filter((e) => e.type === "tool_use");
    expect(tools[0]).toMatchObject({ paths: expect.arrayContaining(["/ok/first.ts"]) });
    expect(tools[0]?.type === "tool_use" && tools[0].paths).toHaveLength(200);
    expect(tools[1]).not.toHaveProperty("paths");
    expect(tools[2]).not.toHaveProperty("paths");
  });

  it("C30 the 5000-file cap holds for the detail source too, and across both sources", async () => {
    const detail = (file: string) => write({ detail: JSON.stringify({ file_path: file }) });
    // Only `detail` (a tool without `paths`): one file per event, 5001 events, the run lists 5000.
    const onlyDetail = await runStub(Array.from({ length: 5001 }, (_, i) => detail(`/w/f-${i}.ts`)));
    expect(onlyDetail.files).toHaveLength(5000);
    expect(onlyDetail.files[0]).toBe("/w/f-0.ts");
    expect(onlyDetail.files[4999]).toBe("/w/f-4999.ts");
    expect(onlyDetail.files).not.toContain("/w/f-5000.ts");

    // Both sources share one budget: 4998 files from `detail`, then a patch of three, then one more from `detail`.
    const mixed = await runStub([
      ...Array.from({ length: 4998 }, (_, i) => detail(`/w/d-${i}.ts`)),
      write({ paths: ["/p/1.ts", "/p/2.ts", "/p/3.ts"] }),
      detail("/w/late.ts"),
    ]);
    expect(mixed.files).toHaveLength(5000);
    expect(mixed.files.slice(4998)).toEqual(["/p/1.ts", "/p/2.ts"]);
    expect(mixed.files).not.toContain("/p/3.ts");
    expect(mixed.files).not.toContain("/w/late.ts");
  });
});

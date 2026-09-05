import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ClaudeAdapter, claudeStreamParser } from "@mordomo/adapter-claude";
import { CursorAdapter } from "@mordomo/adapter-cursor";
import { CodexAdapter } from "@mordomo/adapter-codex";
import type { AgentRun, RunEvent } from "@mordomo/core";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

let restorePath: () => void;
beforeAll(() => {
  for (const bin of ["claude", "cursor-agent", "codex"]) {
    fs.chmodSync(path.join(FAKE_BIN, bin), 0o755);
  }
  restorePath = withFakeBinPath();
});
afterAll(() => restorePath());

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: `test-${Math.random().toString(36).slice(2)}`,
    prompt: "Say OK",
    cwd: process.cwd(),
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 20_000,
    profile: "read_only",
    artifactsDir: fs.mkdtempSync("/tmp/mordomo-art-"),
    ...overrides,
  };
}

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("claude adapter (against fake CLI)", () => {
  const adapter = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });

  it("detects binary, version and probes --help flags", async () => {
    const det = await adapter.detect();
    expect(det.installed).toBe(true);
    expect(det.version).toContain("fake");
    expect(det.supportedFlags).toContain("--output-format");
    expect(det.supportedFlags).toContain("--print");
    expect(det.notes).toEqual([]);
  });

  it("builds a read-only invocation without bypass flags", async () => {
    const run = makeRun();
    const inv = await adapter.buildInvocation(run);
    expect(inv.args).toContain("--permission-mode");
    expect(inv.args).toContain("default");
    expect(inv.args.join(" ")).not.toContain("bypassPermissions");
    expect(inv.args.join(" ")).toContain(run.artifactsDir);
    expect(inv.stdin).toBe("Say OK");
  });

  it("streams normalized events and summarizes the result", async () => {
    const run = makeRun();
    const events = await collect(adapter.execute(run));
    const types = events.map((e) => e.type);
    expect(types).toContain("started");
    expect(types).toContain("assistant");
    expect(types).toContain("tool_use");
    const result = events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>;
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("All done");
  });

  it("names a new conversation with --session-id and resumes one with --resume", async () => {
    await adapter.detect();
    const fresh = await adapter.buildInvocation(makeRun());
    expect(fresh.args).toContain("--session-id");
    expect(fresh.args[fresh.args.indexOf("--session-id") + 1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.args).not.toContain("--resume");

    const resumed = await adapter.buildInvocation(
      makeRun({ sessionId: "local-session", resume: { providerSessionId: "abc-123" } }),
    );
    expect(resumed.args).toContain("--resume");
    expect(resumed.args[resumed.args.indexOf("--resume") + 1]).toBe("abc-123");
    expect(resumed.args).not.toContain("--session-id");
  });

  it("emits a session event before the process and from the stream", async () => {
    const events = await collect(adapter.execute(makeRun({ resume: { providerSessionId: "abc-123" } })));
    const sessionEvents = events.filter((e) => e.type === "session") as Array<
      Extract<RunEvent, { type: "session" }>
    >;
    // Announced up front, then confirmed by the CLI's init line (same id, so
    // the parser reports it once).
    expect(sessionEvents.map((e) => e.providerSessionId)).toEqual(["abc-123", "abc-123"]);
    expect(events.indexOf(sessionEvents[0]!)).toBeLessThan(events.findIndex((e) => e.type === "started"));
  });

  it("parses session_id out of a stream-json init line", () => {
    const parser = claudeStreamParser();
    const parsed = parser.parseLine('{"type":"system","subtype":"init","session_id":"abc"}');
    expect(parsed).toEqual([
      { type: "session", ts: expect.any(Number), providerSessionId: "abc" },
      { type: "text", ts: expect.any(Number), stream: "stdout", text: "[claude session started: model=?]" },
    ]);
    // The id repeats on every line; it is only reported when it changes.
    expect(parser.parseLine('{"type":"assistant","session_id":"abc","message":{"content":[]}}')).toEqual([]);
    expect(parser.parseLine('{"type":"assistant","session_id":"def","message":{"content":[]}}')).toEqual([
      { type: "session", ts: expect.any(Number), providerSessionId: "def" },
    ]);
  });

  it("reports authentication without exposing credentials", async () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const isolated = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude"), homeDir: paths.home });
      const status = await isolated.authenticate();
      expect(status.detail).not.toMatch(/sk-|token=/i);
      fs.mkdirSync(path.join(paths.home, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(paths.home, ".claude", ".credentials.json"), "{}");
      const after = await isolated.authenticate();
      expect(after.authenticated).toBe(true);
      expect(after.method).toBe("session");
    } finally {
      cleanup();
    }
  });
});

describe("cursor adapter (against fake CLI)", () => {
  const adapter = new CursorAdapter({ binaryPath: path.join(FAKE_BIN, "cursor-agent") });

  it("detects and probes flags", async () => {
    const det = await adapter.detect();
    expect(det.installed).toBe(true);
    expect(det.supportedFlags).toContain("--force");
  });

  it("authenticates via `status` without touching tokens", async () => {
    const status = await adapter.authenticate();
    expect(status.authenticated).toBe(true);
  });

  it("never passes --force on read-only runs", async () => {
    await adapter.detect();
    const ro = await adapter.buildInvocation(makeRun({ mode: "read_only" }));
    expect(ro.args).not.toContain("--force");
    const wr = await adapter.buildInvocation(makeRun({ mode: "write" }));
    expect(wr.args).toContain("--force");
  });

  it("says resumeSupported: false instead of resuming", async () => {
    await adapter.detect();
    const events = await collect(adapter.execute(makeRun({ resume: { providerSessionId: "x" } })));
    const note = events.find((e) => e.type === "text" && e.text.includes("resumeSupported: false"));
    expect(note).toBeDefined();
    expect(events.some((e) => e.type === "session")).toBe(false);
  });

  it("streams events", async () => {
    const events = await collect(adapter.execute(makeRun()));
    expect(events.some((e) => e.type === "assistant")).toBe(true);
    const result = events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>;
    expect(result.exitCode).toBe(0);
  });
});

describe("codex adapter (against fake CLI)", () => {
  const adapter = new CodexAdapter({ binaryPath: path.join(FAKE_BIN, "codex") });

  it("detects exec flags via probing", async () => {
    const det = await adapter.detect();
    expect(det.installed).toBe(true);
    expect(det.supportedFlags).toContain("--sandbox");
    expect(det.supportedFlags).toContain("--json");
  });

  it("uses sandbox read-only and never danger-full-access", async () => {
    await adapter.detect();
    const inv = await adapter.buildInvocation(makeRun());
    expect(inv.args).toContain("--sandbox");
    expect(inv.args[inv.args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(inv.args.join(" ")).not.toContain("danger-full-access");
  });

  it("resumes through `exec resume <id>` when the CLI advertises it", async () => {
    await adapter.detect();
    const inv = await adapter.buildInvocation(makeRun({ resume: { providerSessionId: "thread-9" } }));
    expect(inv.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(inv.args[inv.args.length - 2]).toBe("thread-9"); // session id, then the prompt
    expect(inv.args[inv.args.length - 1]).toBe("Say OK");
    const fresh = await adapter.buildInvocation(makeRun());
    expect(fresh.args).not.toContain("resume");
  });

  it("reports the thread id as a session event", async () => {
    const events = await collect(adapter.execute(makeRun()));
    const session = events.find((e) => e.type === "session") as Extract<RunEvent, { type: "session" }>;
    expect(session.providerSessionId).toBe("fake");
  });

  it("parses codex JSONL events", async () => {
    const events = await collect(adapter.execute(makeRun()));
    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    const assistant = events.find((e) => e.type === "assistant") as Extract<RunEvent, { type: "assistant" }>;
    expect(assistant.text).toContain("Codex fake reply");
  });
});

describe("missing CLI handling", () => {
  it("reports a clean not-installed result instead of crashing", async () => {
    const adapter = new CodexAdapter({ binaryPath: null });
    const original = process.env.PATH;
    process.env.PATH = "/nonexistent-dir-for-test";
    try {
      const det = await adapter.detect();
      expect(det.installed).toBe(false);
      expect(det.notes[0]).toContain("not found on PATH");
      const health = await adapter.healthCheck();
      expect(health.ok).toBe(false);
      expect(health.installed).toBe(false);
    } finally {
      process.env.PATH = original;
    }
  });
});

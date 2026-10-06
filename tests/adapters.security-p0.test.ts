import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { CursorAdapter } from "@mordomo/adapter-cursor";
import { CodexAdapter } from "@mordomo/adapter-codex";
import type { AgentRun, RunEvent } from "@mordomo/core";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, withFakeBinPath } from "./helpers.js";

/**
 * Security P0 (.specs/features/seguranca-p0): the permission broker's secrets
 * never reach argv, and a prompt never becomes a CLI option.
 */

let restorePath: () => void;
beforeAll(() => {
  restorePath = withFakeBinPath();
});
afterAll(() => restorePath());

const LOCAL_TOKEN = "local-token-0123456789abcdef0123456789abcdef";
const BROKER_CREDENTIAL = "brk_test-broker-credential-0123456789";

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: `sec-${Math.random().toString(36).slice(2)}`,
    prompt: "Say OK",
    cwd: process.cwd(),
    model: null,
    effort: "default",
    mode: "write",
    timeoutMs: 20_000,
    profile: "review_before_write",
    artifactsDir: fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-art-")),
    permissionBroker: {
      command: process.execPath,
      args: ["cli.js", "mcp", "permission"],
      env: {
        MORDOMO_URL: "http://127.0.0.1:4777",
        MORDOMO_TOKEN: BROKER_CREDENTIAL,
        MORDOMO_RUN_ID: "11111111-1111-4111-8111-111111111111",
        MORDOMO_LOCAL_TOKEN_CANARY: LOCAL_TOKEN,
      },
    },
    ...overrides,
  };
}

async function drain(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function mcpConfigPath(args: string[]): string {
  const i = args.indexOf("--mcp-config");
  expect(i).toBeGreaterThanOrEqual(0);
  return args[i + 1]!;
}

function leftoverConfigDirs(runId: string): string[] {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`mordomo-mcp-${runId}`));
}

describe("claude broker config stays off argv", () => {
  const adapter = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });

  it("C10 the brokered claude invocation keeps secrets off argv", async () => {
    const run = makeRun();
    const inv = await adapter.buildInvocation(run);
    for (const arg of inv.args) {
      expect(arg).not.toContain(BROKER_CREDENTIAL);
      expect(arg).not.toContain(LOCAL_TOKEN);
    }
    const file = mcpConfigPath(inv.args);
    expect(path.isAbsolute(file)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    const config = JSON.parse(fs.readFileSync(file, "utf8")) as {
      mcpServers: { mordomo: { env: Record<string, string> } };
    };
    expect(config.mcpServers.mordomo.env.MORDOMO_TOKEN).toBe(BROKER_CREDENTIAL);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("C11 the MCP config file is 0600", async () => {
    const run = makeRun();
    const inv = await adapter.buildInvocation(run);
    const file = mcpConfigPath(inv.args);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it.skipIf(!FAKE_CLIS_RUNNABLE)("C12 the MCP config file is gone after the run", async () => {
    const ok = makeRun();
    await drain(adapter.execute(ok));
    expect(leftoverConfigDirs(ok.runId)).toEqual([]);

    const failing = makeRun();
    process.env.FAKE_CLAUDE_FAIL = "1";
    let events: RunEvent[];
    try {
      events = await drain(adapter.execute(failing));
    } finally {
      delete process.env.FAKE_CLAUDE_FAIL;
    }
    const result = events.find((e) => e.type === "result") as Extract<RunEvent, { type: "result" }>;
    expect(result.exitCode).not.toBe(0);
    expect(leftoverConfigDirs(failing.runId)).toEqual([]);
  });
});

describe("a dashed prompt is never a CLI option", () => {
  it("C22 a dashed prompt is never a codex flag", async () => {
    const adapter = new CodexAdapter({ binaryPath: path.join(FAKE_BIN, "codex") });
    const inv = await adapter.buildInvocation(
      makeRun({ prompt: "--help", mode: "read_only", profile: "read_only", permissionBroker: undefined }),
    );
    expect(inv.args[inv.args.length - 1]).toBe(" --help");
  });

  it("C23 a dashed prompt is never a cursor flag", async () => {
    const adapter = new CursorAdapter({ binaryPath: path.join(FAKE_BIN, "cursor-agent") });
    const inv = await adapter.buildInvocation(
      makeRun({ prompt: "--help", mode: "write", profile: "controlled_write", permissionBroker: undefined }),
    );
    const last = inv.args[inv.args.length - 1]!;
    expect(last.startsWith("-")).toBe(false);
    expect(last.trim()).toBe("--help");
  });
});

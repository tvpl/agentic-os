import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "../apps/api/src/mcp/stdio.js";
import { decide } from "../apps/api/src/mcp/permission.js";
import { mordomoTools } from "../apps/api/src/mcp/mordomo.js";

/** The stdio MCP servers: protocol subset, the permission decision loop, the mordomo tools. */

const server = {
  name: "t",
  version: "0",
  tools: [
    {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      handler: async (a: Record<string, unknown>) => String(a.text ?? ""),
    },
  ],
};

describe("MCP stdio server", () => {
  it("answers initialize, tools/list and tools/call", async () => {
    const init = await handleMcpRequest({ id: 1, method: "initialize", params: {} }, server);
    expect((init as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("t");
    const list = await handleMcpRequest({ id: 2, method: "tools/list" }, server);
    expect((list as { result: { tools: Array<{ name: string }> } }).result.tools[0]!.name).toBe("echo");
    const call = await handleMcpRequest(
      { id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } },
      server,
    );
    expect((call as { result: { content: Array<{ text: string }> } }).result.content[0]!.text).toBe("hi");
    expect(await handleMcpRequest({ method: "notifications/initialized" }, server)).toBeNull();
    const bad = await handleMcpRequest({ id: 4, method: "tools/call", params: { name: "nope" } }, server);
    expect((bad as { error: { code: number } }).error.code).toBe(-32602);
  });
});

describe("permission decide()", () => {
  const withEnv = async (fn: () => Promise<void>) => {
    const prev = { ...process.env };
    process.env.MORDOMO_URL = "http://127.0.0.1:1";
    process.env.MORDOMO_TOKEN = "t";
    process.env.MORDOMO_RUN_ID = "r";
    process.env.MORDOMO_APPROVAL_TIMEOUT_MS = "2000";
    try {
      await fn();
    } finally {
      process.env = prev;
    }
  };

  it("allows once the approval is approved", async () => {
    await withEnv(async () => {
      let polls = 0;
      const call = async <T>(method: string, path: string): Promise<T> => {
        if (method === "POST" && path === "/api/approvals/tool") return { id: "a1", status: "pending" } as T;
        polls += 1;
        return { id: "a1", status: polls >= 2 ? "approved" : "pending" } as T;
      };
      const out = JSON.parse(
        await decide(
          { tool_name: "Bash", input: { command: "ls" } },
          { call, sleep: async () => undefined, now: Date.now },
        ),
      );
      expect(out).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
      expect(polls).toBe(2);
    });
  });

  it("denies on timeout and resolves the approval as denied", async () => {
    await withEnv(async () => {
      const seen: string[] = [];
      let t = 0;
      const call = async <T>(method: string, path: string): Promise<T> => {
        seen.push(`${method} ${path}`);
        return { id: "a2", status: "pending" } as T;
      };
      const out = JSON.parse(
        await decide(
          { tool_name: "Write", input: {} },
          { call, sleep: async () => undefined, now: () => (t += 1500) },
        ),
      );
      expect(out.behavior).toBe("deny");
      expect(seen).toContain("POST /api/approvals/a2/resolve");
    });
  });
});

describe("mordomo MCP tools", () => {
  it("formats recall and skills through the API", async () => {
    const api = {
      get: async <T>(path: string): Promise<T> => {
        if (path.startsWith("/api/memory/recall"))
          return { answerContext: [{ path: "a.md", section: "S", excerpt: "x", score: 3 }] } as T;
        if (path === "/api/skills") return [{ slug: "s", name: "S", description: "d", enabled: true }] as T;
        return { items: [] } as T;
      },
      post: async <T>(): Promise<T> => ({ runId: "r", status: "queued" }) as T,
    };
    const tools = mordomoTools(api);
    const by = (n: string) => tools.find((t) => t.name === n)!;
    expect(await by("recall").handler({ question: "q" })).toContain("a.md § S");
    expect(await by("skills_list").handler({})).toBe("/s — S: d");
    expect(await by("inbox_unread").handler({})).toBe("Inbox is empty.");
    await expect(by("recall").handler({})).rejects.toThrow(/question/);
  });
});

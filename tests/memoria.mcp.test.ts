import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpApi, mordomoTools, type McpApi } from "../apps/api/src/mcp/mordomo.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * cerebro-memoria-confiavel S3, the MCP tools (C44, C46, door 9): `mordomoTools` over an API that records every call it
 * is sent, and over a real server listening on a port (`httpApi` with the owner's token, as `mordomo mcp` calls it).
 */

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** An API that records each call and answers what the routes would. */
function recorder(): { api: McpApi; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (p: string): unknown => {
    if (p === "/api/v1/memory/proposals") return { proposal: { id: "mp_0123456789abcdef" } };
    if (p.startsWith("/api/v1/memory/recall")) return { answerContext: [] };
    if (p.startsWith("/api/v1/memory/note")) {
      return { path: "/x.md", version: "sha256:0", editable: true, content: "" };
    }
    return {};
  };
  const api: McpApi = {
    get: async <T>(p: string) => {
      calls.push({ method: "GET", path: p });
      return answer(p) as T;
    },
    post: async <T>(p: string, body: unknown) => {
      calls.push({ method: "POST", path: p, body });
      return answer(p) as T;
    },
    put: async <T>(p: string, body: unknown) => {
      calls.push({ method: "PUT", path: p, body });
      return answer(p) as T;
    },
  };
  return { api, calls };
}

const tool = (api: McpApi, name: string) => {
  const found = mordomoTools(api).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const WAITING = /^Proposal mp_[0-9a-f]{16} is waiting for review in the MordomoOS inbox\.$/;

let w: MemoriaWorld;
let live: McpApi;
const runIdBefore = process.env.MORDOMO_RUN_ID;
beforeAll(async () => {
  delete process.env.MORDOMO_RUN_ID;
  w = await memoriaWorld("mordomo-memoria-mcp-");
  await w.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = w.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  live = httpApi(`http://127.0.0.1:${port}`, w.ctx.token());
}, 60_000);
afterAll(async () => {
  if (runIdBefore !== undefined) process.env.MORDOMO_RUN_ID = runIdBefore;
  await w.close();
});

describe("C44 the MCP write tools propose", () => {
  it("C44 facts_assert, note_create and note_save each send exactly one POST /api/v1/memory/proposals with their kind and fields, never the routes that write, and answer the waiting sentence", async () => {
    const cases: Array<[string, Json, Json]> = [
      [
        "facts_assert",
        { subject: "usuário", predicate: "prefere", object: "commits em português" },
        { kind: "fact", subject: "usuário", predicate: "prefere", object: "commits em português" },
      ],
      [
        "note_create",
        { title: "Pelo agente", content: "texto", area: "Trabalho", tags: ["ab"], frontMatter: true },
        {
          kind: "note_create",
          title: "Pelo agente",
          content: "texto",
          area: "Trabalho",
          tags: ["ab"],
          frontMatter: true,
        },
      ],
      [
        "note_save",
        { path: "/home/x/memory/notes/a.md", content: "novo", baseVersion: `sha256:${"a".repeat(64)}` },
        {
          kind: "note_save",
          path: "/home/x/memory/notes/a.md",
          content: "novo",
          baseVersion: `sha256:${"a".repeat(64)}`,
        },
      ],
    ];
    for (const [name, args, body] of cases) {
      const { api, calls } = recorder();
      const answer = await tool(api, name).handler(args);
      expect(answer, name).toBe("Proposal mp_0123456789abcdef is waiting for review in the MordomoOS inbox.");
      expect(calls, name).toEqual([{ method: "POST", path: "/api/v1/memory/proposals", body }]);
      expect(
        calls.some(
          (c) => c.path.startsWith("/api/v1/memory/facts") || c.path.startsWith("/api/v1/memory/notes"),
        ),
      ).toBe(false);
    }
  });

  it("C44 against a real server: three proposals wait, and no fact and no note exists", async () => {
    const facts = () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM facts").get() as { c: number }).c;
    const before = facts();
    const note = await w.call("POST", "/api/memory/notes", { title: "Nota MCP", content: "um" });
    expect(note.status).toBe(201);
    const answers = [
      await tool(live, "facts_assert").handler({ subject: "s", predicate: "p", object: "o" }),
      await tool(live, "note_create").handler({ title: "Nota proposta", content: "x" }),
      await tool(live, "note_save").handler({
        path: note.body.path,
        content: "dois",
        baseVersion: note.body.version,
      }),
    ];
    for (const a of answers) expect(a).toMatch(WAITING);
    expect(facts()).toBe(before);
    expect(fs.existsSync(path.join(w.memory, "notes", "nota-proposta.md"))).toBe(false);
    expect(fs.readFileSync(note.body.path, "utf8")).toBe("# Nota MCP\n\num\n");
    const listed = await w.call("GET", "/api/memory/proposals?status=pending");
    expect((listed.body.items as Json[]).map((i) => [i.kind, i.author]).sort()).toEqual(
      [
        ["fact", "mcp"],
        ["note_create", "mcp"],
        ["note_save", "mcp"],
      ].sort(),
    );
  });

  it("C44 facts_query, note_read and recall send the requests of before", async () => {
    const { api, calls } = recorder();
    await tool(api, "facts_query").handler({ subject: "s", predicate: "p" });
    await tool(api, "note_read").handler({ path: "/m/notes/a.md" });
    await tool(api, "recall").handler({ question: "o que", k: 3 });
    expect(calls).toEqual([
      { method: "GET", path: "/api/v1/memory/facts?subject=s&predicate=p" },
      { method: "GET", path: `/api/v1/memory/note?p=${encodeURIComponent("/m/notes/a.md")}` },
      { method: "GET", path: `/api/v1/memory/recall?q=${encodeURIComponent("o que")}&k=3` },
    ]);
  });
});

describe("C46 journal_append says an agent wrote it", () => {
  it("C46 journal_append sends { text, author: agent }, and with a section { text, section, author: agent }", async () => {
    const { api, calls } = recorder();
    await tool(api, "journal_append").handler({ text: "uma linha" });
    await tool(api, "journal_append").handler({ text: "outra", section: "Decisions" });
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/v1/memory/journal/append"],
      ["POST", "/api/v1/memory/journal/append"],
    ]);
    expect(calls[0]!.body).toEqual({ text: "uma linha", author: "agent" });
    expect(calls[1]!.body).toEqual({ text: "outra", section: "Decisions", author: "agent" });
  });
});

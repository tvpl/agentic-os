import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it, vi } from "vitest";
import { recordAgentUsage } from "@mordomo/core/internal";
import { handleMcpRequest } from "../apps/api/src/mcp/stdio.js";
import { httpApi, mordomoTools } from "../apps/api/src/mcp/mordomo.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-perguntar, batch B, S7 (API, door 7): `GET /api/mcp` (the clients, their commands, the tools
 * and the agents' usage) and the usage record every read of an agent adds to, at the boundary: `app.inject` against
 * `buildServer`, and the MCP tools over an `httpApi` pointed at the same server listening on `127.0.0.1:0`. The user
 * home the config files are read from is a temp folder the test sets (`HOME`). The record at its own layer is
 * `perguntar.layer.test.ts` C55.
 */

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

interface UsageWorld extends MemoriaWorld {
  mcp: (name: string, args?: Json, client?: string) => Promise<{ text: string; isError: boolean }>;
  overview: () => Promise<{ status: number; body: Json }>;
  usage: () => Promise<Json>;
  mcpHeaders: () => Record<string, string>;
}

async function fresh<T>(fn: (w: UsageWorld) => Promise<T>): Promise<T> {
  const w = await memoriaWorld(`mordomo-perguntar-usage-${++seq}-`);
  await w.app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = w.app.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const token = w.ctx.token();
  const world = Object.assign(w, {
    async mcp(name: string, args: Json = {}, client = "claude-code") {
      const res = (await handleMcpRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
        { name: "mordomo", version: "0", tools: mordomoTools(httpApi(url, token, () => client)) },
      )) as { result: { content: Array<{ text: string }>; isError?: boolean } };
      return { text: res.result.content[0]!.text, isError: res.result.isError === true };
    },
    overview: () => w.call("GET", "/api/mcp"),
    async usage() {
      const res = await w.call("GET", "/api/mcp");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.usage as Json;
    },
    mcpHeaders: () => ({
      "content-type": "application/json",
      "x-mordomo-token": token,
      "x-mordomo-as": "mcp",
      "x-mordomo-client": "claude-code",
    }),
  });
  try {
    return await fn(world);
  } finally {
    await w.close();
  }
}

/** A user home of its own for the length of `fn` (`HOME`, which `os.homedir()` reads). */
async function withUserHome<T>(files: Record<string, string>, fn: (home: string) => Promise<T>): Promise<T> {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-perguntar-userhome-")));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  }
  const before = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.HOME;
    else process.env.HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const servers = (map: Record<string, Json>) => JSON.stringify({ mcpServers: map });
const code = (r: { status: number; body: Json }) => [r.status, r.body?.error?.code];
const client = (body: Json, id: string) => (body.clients as Json[]).find((c) => c.id === id)!;
const pick = (c: Json) => ({ connected: c.connected, source: c.source, unreadable: c.unreadable });

describe("C51 the clients' connection at the boundary", () => {
  it("C51 GET /api/mcp, one case per row: a mordomo server, a command named mordomo, .cmd and .exe, another server, an absent file, codex's TOML, a file that does not parse", async () => {
    await fresh(async (w) => {
      const rows: Array<[string, Record<string, string>, string, (home: string) => Json]> = [
        [
          "mcpServers.mordomo in ~/.claude.json",
          { ".claude.json": servers({ mordomo: { command: "mordomo", args: ["mcp"] } }) },
          "claude",
          (home) => ({ connected: true, source: path.join(home, ".claude.json"), unreadable: undefined }),
        ],
        [
          "a server named brain whose command is /usr/local/bin/mordomo",
          { ".claude.json": servers({ brain: { command: "/usr/local/bin/mordomo" } }) },
          "claude",
          (home) => ({ connected: true, source: path.join(home, ".claude.json"), unreadable: undefined }),
        ],
        [
          "command mordomo.cmd",
          { ".cursor/mcp.json": servers({ brain: { command: "mordomo.cmd" } }) },
          "cursor",
          (home) => ({
            connected: true,
            source: path.join(home, ".cursor", "mcp.json"),
            unreadable: undefined,
          }),
        ],
        [
          "command C:\\bin\\mordomo.exe",
          { ".cursor/mcp.json": servers({ brain: { command: "C:\\bin\\mordomo.exe" } }) },
          "cursor",
          (home) => ({
            connected: true,
            source: path.join(home, ".cursor", "mcp.json"),
            unreadable: undefined,
          }),
        ],
        [
          "a server named mordomo-old whose command is node",
          { ".claude.json": servers({ "mordomo-old": { command: "node", args: ["x.js"] } }) },
          "claude",
          () => ({ connected: false, source: undefined, unreadable: undefined }),
        ],
        [
          "~/.cursor/mcp.json absent",
          {},
          "cursor",
          () => ({ connected: false, source: undefined, unreadable: undefined }),
        ],
        [
          "[mcp_servers.mordomo] in ~/.codex/config.toml",
          { ".codex/config.toml": '[mcp_servers.mordomo]\ncommand = "mordomo"\nargs = ["mcp"]\n' },
          "codex",
          (home) => ({
            connected: true,
            source: path.join(home, ".codex", "config.toml"),
            unreadable: undefined,
          }),
        ],
        [
          "a file that does not parse",
          { ".claude.json": "{ not json" },
          "claude",
          (home) => ({ connected: false, source: path.join(home, ".claude.json"), unreadable: true }),
        ],
      ];
      for (const [label, files, id, want] of rows) {
        await withUserHome(files, async (home) => {
          const res = await w.overview();
          expect(res.status, label).toBe(200);
          const got = client(res.body, id);
          expect(pick(got), label).toEqual(want(home));
          expect("source" in got, `${label}: source`).toBe(want(home).source !== undefined);
        });
      }
    });
  });
});

describe("C52 the command of each client", () => {
  it("C52 claude, cursor and codex each carry their command byte-exact and their name", async () => {
    await fresh(async (w) => {
      await withUserHome({}, async () => {
        const res = await w.overview();
        expect(res.status).toBe(200);
        expect((res.body.clients as Json[]).map((c) => [c.id, c.name, c.command])).toEqual([
          ["claude", "Claude Code", "claude mcp add mordomo -- mordomo mcp"],
          [
            "cursor",
            "Cursor",
            '{\n  "mcpServers": {\n    "mordomo": {\n      "command": "mordomo",\n      "args": [\n        "mcp"\n      ]\n    }\n  }\n}',
          ],
          ["codex", "Codex", '[mcp_servers.mordomo]\ncommand = "mordomo"\nargs = ["mcp"]'],
        ]);
      });
    });
  });
});

describe("C102 the file each block is pasted into (batch E, plan.md Landing row 10)", () => {
  it("C102 GET /api/mcp names ~/.cursor/mcp.json for Cursor and ~/.codex/config.toml for Codex, connected or not, and nothing for Claude Code, whose command is a command", async () => {
    await fresh(async (w) => {
      for (const files of [
        {},
        { ".cursor/mcp.json": servers({ mordomo: { command: "mordomo", args: ["mcp"] } }) },
      ])
        await withUserHome(files, async () => {
          const res = await w.overview();
          expect(res.status).toBe(200);
          expect((res.body.clients as Json[]).map((c) => [c.id, c.connected, c.pasteInto])).toEqual([
            ["claude", false, undefined],
            ["cursor", Object.keys(files).length > 0, "~/.cursor/mcp.json"],
            ["codex", false, "~/.codex/config.toml"],
          ]);
          expect((res.body.clients as Json[])[0]).not.toHaveProperty("pasteInto");
        });
    });
  });
});

describe("C53 the tools of GET /api/mcp", () => {
  it("C53 the 13 tools in tools/list order, each read, propose or owner", async () => {
    await fresh(async (w) => {
      const res = await w.overview();
      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([
        { name: "recall", kind: "read" },
        { name: "skills_list", kind: "read" },
        { name: "skills_run", kind: "owner" },
        { name: "journal_append", kind: "propose" },
        { name: "facts_assert", kind: "propose" },
        { name: "facts_query", kind: "read" },
        { name: "note_create", kind: "propose" },
        { name: "note_read", kind: "read" },
        { name: "note_save", kind: "propose" },
        { name: "inbox_unread", kind: "owner" },
        { name: "search", kind: "read" },
        { name: "links", kind: "read" },
        { name: "hygiene", kind: "read" },
      ]);
    });
  });
});

const countOf = (list: Json[], name: string) => (list.find((c) => c.name === name)?.calls as number) ?? 0;
const readsOf = (usage: Json, p: string) =>
  ((usage.paths as Json[]).find((x) => x.path === p)?.reads as number) ?? 0;

describe("C54 the reads that are counted", () => {
  it("C54 an MCP recall, search, links and note_read count; a run's rc_ recall counts for run:claude; the owner, a device, skills_list, facts_query and the writes do not", async () => {
    await fresh(async (w) => {
      const notes = path.join(w.memory, "notes");
      const a = w.put(path.join(notes, "a.md"), "# A\n\n## Girafa\n\nA girafa come folhas.\n");
      const b = w.put(path.join(notes, "b.md"), "# B\n\n## Girafa\n\nA girafa bebe água.\n");
      const c = w.put(
        path.join(notes, "c.md"),
        "# C\n\n## Girafa\n\nA girafa dorme em pé. Veja [a](a.md).\n",
      );
      await w.index();
      // the recall returns 2 sections of 2 files (k: 2)
      const recalled = await w.call(
        "GET",
        "/api/memory/recall?q=girafa&k=2&record=false",
        undefined,
        w.mcpHeaders(),
      );
      const recallPaths = [...new Set((recalled.body.answerContext as Json[]).map((x) => x.path as string))];
      expect(recallPaths).toHaveLength(2);
      expect((recalled.body.answerContext as Json[]).length).toBe(2);
      let before = await w.usage();
      expect(before.calls).toBe(1);
      // the call above was the route itself under the principal mcp; the tool says the same
      let after = before;
      const step = async (fn: () => Promise<unknown>) => {
        before = await w.usage();
        await fn();
        after = await w.usage();
      };
      await step(() => w.mcp("recall", { question: "girafa", k: 2 }));
      expect(after.calls - before.calls).toBe(1);
      expect(countOf(after.byTool, "recall") - countOf(before.byTool, "recall")).toBe(1);
      expect(countOf(after.byClient, "claude-code") - countOf(before.byClient, "claude-code")).toBe(1);
      for (const p of recallPaths) expect(readsOf(after, p) - readsOf(before, p), p).toBe(1);

      await step(() => w.mcp("search", { query: "girafa" }));
      expect(after.calls - before.calls).toBe(1);
      for (const p of [a, b, c]) expect(readsOf(after, p) - readsOf(before, p), p).toBe(1);

      await step(() => w.mcp("links", { path: c }));
      expect(countOf(after.byTool, "links") - countOf(before.byTool, "links")).toBe(1);
      expect([a, b, c].map((p) => readsOf(after, p) - readsOf(before, p))).toEqual([0, 0, 1]);

      await step(() => w.mcp("note_read", { path: b }));
      expect(countOf(after.byTool, "note_read") - countOf(before.byTool, "note_read")).toBe(1);
      expect([a, b, c].map((p) => readsOf(after, p) - readsOf(before, p))).toEqual([0, 1, 0]);

      const run = w.run("read_only");
      await step(() => w.call("GET", "/api/memory/recall?q=girafa&record=false", undefined, run.headers));
      expect(after.calls - before.calls).toBe(1);
      expect(countOf(after.byClient, "run:claude") - countOf(before.byClient, "run:claude")).toBe(1);
      expect(countOf(after.byTool, "recall") - countOf(before.byTool, "recall")).toBe(1);

      const nothing: Array<[string, () => Promise<unknown>]> = [
        ["the owner's recall", () => w.call("GET", "/api/memory/recall?q=girafa")],
        [
          "a device's search",
          () => w.call("GET", "/api/memory/search?q=girafa", undefined, w.device(["content"])),
        ],
        ["skills_list", () => w.mcp("skills_list")],
        ["facts_query", () => w.mcp("facts_query")],
        ["facts_assert", () => w.mcp("facts_assert", { subject: "s", predicate: "p", object: "o" })],
        ["note_create", () => w.mcp("note_create", { title: "Nova" })],
        ["journal_append", () => w.mcp("journal_append", { text: "linha" })],
      ];
      for (const [label, fn] of nothing) {
        await step(fn);
        expect(after, label).toEqual(before);
      }
    });
  });
});

describe("C56 the most read paths", () => {
  it("C56 at most 20, by reads, then lastAt, then path; fileId for an index row only; an excluded and a hidden path are not listed but stay counted", async () => {
    await fresh(async (w) => {
      const notes = path.join(w.memory, "notes");
      const indexed = Array.from({ length: 22 }, (_, i) =>
        w.put(path.join(notes, `n${String(i).padStart(2, "0")}.md`), `# N${i}\n`),
      );
      const excluded = w.put(path.join(notes, "fora", "e.md"), "# E\n");
      const hidden = w.put(path.join(w.memory, "privado", "h.md"), "# H\n");
      await w.index();
      const res = await w.call("PUT", "/api/settings", {
        excludes: [...w.ctx.settings().excludes, "fora"],
        folderAccess: [{ path: path.dirname(hidden), agents: "hide", devices: "write" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const outside = path.join(notes, "nao-indexada.md");
      // reads: the excluded and the hidden most of all; n00 and n01 3 each (n01 later), outside 3 (earliest), the rest 1
      let calls = 0;
      const read = (paths: string[], now: number) => {
        recordAgentUsage(w.ctx.db, { tool: "search", client: "claude-code", paths }, now);
        calls += 1;
      };
      for (let i = 0; i < 5; i++) read([excluded, hidden], 1_000 + i);
      read([outside], 2_000);
      read([outside], 2_001);
      read([outside], 2_002);
      for (let i = 0; i < 3; i++) read([indexed[0]!], 3_000 + i);
      for (let i = 0; i < 3; i++) read([indexed[1]!], 4_000 + i);
      read(indexed.slice(2), 5_000);
      const usage = await w.usage();
      expect(usage.calls).toBe(calls);
      const listed = usage.paths as Json[];
      expect(listed).toHaveLength(20);
      expect(listed.map((x) => x.path)).not.toContain(excluded);
      expect(listed.map((x) => x.path)).not.toContain(hidden);
      expect(listed.slice(0, 3).map((x) => [x.path, x.reads])).toEqual([
        [indexed[1], 3],
        [indexed[0], 3],
        [outside, 3],
      ]);
      // the rest: one read each at the same moment, by path
      expect(listed.slice(3).map((x) => x.path)).toEqual(indexed.slice(2, 19));
      const idOf = (p: string) =>
        (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(p) as { id: number }).id;
      expect(listed[0]).toEqual({ path: indexed[1], reads: 3, lastAt: 4_002, fileId: idOf(indexed[1]!) });
      expect(listed[2]).toEqual({ path: outside, reads: 3, lastAt: 2_002 });
      for (const entry of listed.slice(3)) expect(entry.fileId).toBe(idOf(entry.path as string));
    });
  });
});

describe("C57 an unreadable record", () => {
  it("C57 absent, not json, v 2 and paths as a list each read as the empty usage, and the next agent read starts a record of calls 1", async () => {
    await fresh(async (w) => {
      w.put(path.join(w.memory, "notes", "a.md"), "# A\n\nUma girafa.\n");
      await w.index();
      const empty = { since: null, calls: 0, byTool: [], byClient: [], paths: [] };
      const states: Array<[string, string | null]> = [
        ["absent", null],
        ["not json", "not json"],
        ["v 2", '{"v":2}'],
        [
          "paths a list",
          JSON.stringify({ v: 1, since: 1, calls: 4, byTool: {}, byClient: {}, paths: ["/a.md"] }),
        ],
      ];
      for (const [label, value] of states) {
        w.ctx.db.prepare("DELETE FROM meta WHERE key = 'agents.usage'").run();
        if (value !== null)
          w.ctx.db.prepare("INSERT INTO meta (key, value) VALUES ('agents.usage', ?)").run(value);
        const res = await w.overview();
        expect(res.status, label).toBe(200);
        expect(res.body.usage, label).toEqual(empty);
        const searched = await w.mcp("search", { query: "girafa" });
        expect(searched.isError, searched.text).toBe(false);
        const next = await w.usage();
        expect(next.calls, label).toBe(1);
        expect(next.since, label).toEqual(expect.any(Number));
      }
    });
  });
});

describe("C58 two reads at once", () => {
  it("C58 two MCP search calls started together end with calls 2", async () => {
    await fresh(async (w) => {
      w.put(path.join(w.memory, "notes", "a.md"), "# A\n\nUma girafa.\n");
      await w.index();
      const [one, two] = await Promise.all([
        w.mcp("search", { query: "girafa" }),
        w.mcp("search", { query: "girafa" }),
      ]);
      expect([one.isError, two.isError]).toEqual([false, false]);
      const usage = await w.usage();
      expect(usage.calls).toBe(2);
      expect(usage.byTool).toEqual([{ name: "search", calls: 2, lastAt: expect.any(Number) }]);
    });
  });
});

describe("C59 who may call GET /api/mcp", () => {
  it("C59 through /api and /api/v1: the owner passes; a device with every scope 403 owner_only; a run's rc_ 403 forbidden; the principal mcp 403 forbidden", async () => {
    await fresh(async (w) => {
      const device = w.device(["content", "monitor", "run", "approve"]);
      const run = w.run("write").headers;
      for (const url of ["/api/mcp", "/api/v1/mcp"]) {
        expect((await w.call("GET", url)).status, url).toBe(200);
        expect(code(await w.call("GET", url, undefined, device)), url).toEqual([403, "owner_only"]);
        expect(code(await w.call("GET", url, undefined, run)), url).toEqual([403, "forbidden"]);
        expect(code(await w.call("GET", url, undefined, w.mcpHeaders())), url).toEqual([403, "forbidden"]);
      }
    });
  });
});

describe("C60 the config files are read, never written, and no credential is returned", () => {
  it("C60 every homeConfigFiles of the manifests is read through discoverMcpServers; their bytes and mtimes are unchanged; TOKEN=abc reads TOKEN=[hidden]", async () => {
    await fresh(async (w) => {
      const files = {
        ".claude.json": servers({ other: { command: "node" } }),
        // the second file of Claude Code's manifest: found there
        ".claude/settings.json": servers({ mordomo: { command: "mordomo", args: ["mcp"] } }),
        ".cursor/mcp.json": servers({ mordomo: { command: "env TOKEN=abc mordomo", args: ["mcp"] } }),
        ".codex/config.toml": '[mcp_servers.mordomo]\ncommand = "mordomo"\n',
      };
      expect(
        w.ctx.providers
          .manifests()
          .flatMap((m) => m.homeConfigFiles)
          .sort(),
      ).toEqual(Object.keys(files).sort());
      await withUserHome(files, async (home) => {
        const old = new Date("2026-01-02T03:04:05Z");
        const stat = () =>
          Object.keys(files).map((rel) => {
            const full = path.join(home, rel);
            return [rel, fs.readFileSync(full).toString("base64"), fs.statSync(full).mtimeMs];
          });
        for (const rel of Object.keys(files)) fs.utimesSync(path.join(home, rel), old, old);
        const before = stat();
        const res = await w.overview();
        expect(res.status).toBe(200);
        expect(stat()).toEqual(before);
        const claude = client(res.body, "claude");
        expect([claude.connected, claude.source]).toEqual([
          true,
          path.join(home, ".claude", "settings.json"),
        ]);
        const cursor = client(res.body, "cursor");
        expect(cursor.server).toEqual({ name: "mordomo", command: "env TOKEN=[hidden] mordomo" });
        expect(client(res.body, "codex").connected).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain("abc");
      });
    });
  });
});

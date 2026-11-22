import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { handleMcpRequest } from "../apps/api/src/mcp/stdio.js";
import { httpApi, mordomoTools, type McpApi } from "../apps/api/src/mcp/mordomo.js";
import { MCP_ROUTES } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";
import { mcpRecorder } from "./helpers/mcpRecorder.js";
import { runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-perguntar, batch B, S6 (doors 4 and 5): `mordomo mcp` reads as agents. Proven through
 * `handleMcpRequest` and `mordomoTools` over an `httpApi` pointed at a `buildServer` that listens on `127.0.0.1:0`, so
 * the headers, the principal and the route table are the real ones; the CLI's `initialize` at the built `mordomo mcp`
 * over its stdio (C38). The owner's differential is the same tools over the owner's token and no header.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

/** The API as the owner's own program calls it: the owner's token and no `x-mordomo-as` (the differential). */
function ownerApi(baseUrl: string, token: string): McpApi {
  const call = async <T>(method: string, p: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${p}`, {
      method,
      headers: { "content-type": "application/json", "x-mordomo-token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok)
      throw Object.assign(new Error(`${method} ${p} → ${res.status}: ${text}`), { status: res.status });
    return (text ? JSON.parse(text) : {}) as T;
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}

interface ToolAnswer {
  text: string;
  isError: boolean;
}

async function callTool(api: McpApi, name: string, args: Json = {}): Promise<ToolAnswer> {
  const res = (await handleMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    { name: "mordomo", version: "0", tools: mordomoTools(api) },
  )) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  return { text: res.result.content[0]!.text, isError: res.result.isError === true };
}

interface McpWorld extends RunWorld {
  url: string;
  /** The tools as `mordomo mcp` calls them (`httpApi`: the owner's token, `x-mordomo-as: mcp`, this client). */
  mcp: (name: string, args?: Json, client?: string) => Promise<ToolAnswer>;
  /** The same tools over the owner's token with no header. */
  owner: (name: string, args?: Json) => Promise<ToolAnswer>;
  /** A request to the listening server with these headers. */
  fetchAs: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
  ) => Promise<{ status: number; body: Json }>;
  mcpHeaders: (client?: string) => Record<string, string>;
  hideFromAgents: (folder: string) => Promise<void>;
}

async function mcpWorld(): Promise<McpWorld> {
  const w = await runWorld(`mordomo-perguntar-mcp-${++seq}-`);
  await w.app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = w.app.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const token = w.ctx.token();
  const mcpHeaders = (client = "claude-code") => ({
    "content-type": "application/json",
    "x-mordomo-token": token,
    "x-mordomo-as": "mcp",
    "x-mordomo-client": client,
  });
  return Object.assign(w, {
    url,
    mcp: (name: string, args: Json = {}, client = "claude-code") =>
      callTool(
        httpApi(url, token, () => client),
        name,
        args,
      ),
    owner: (name: string, args: Json = {}) => callTool(ownerApi(url, token), name, args),
    async fetchAs(method: string, p: string, headers: Record<string, string>, body?: unknown) {
      const res = await fetch(`${url}${p}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
    },
    mcpHeaders,
    async hideFromAgents(folder: string) {
      const res = await w.call("PUT", "/api/settings", {
        folderAccess: [{ path: folder, agents: "hide", devices: "write" }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await w.index();
    },
  });
}

async function fresh<T>(fn: (w: McpWorld) => Promise<T>): Promise<T> {
  const w = await mcpWorld();
  try {
    return await fn(w);
  } finally {
    await w.close();
  }
}

const code = (r: { status: number; body: Json }) => [r.status, r.body?.error?.code];

/** One valid call of each of the 13 tools (C36, C50). */
const ONE_CALL: Array<[string, Json]> = [
  ["recall", { question: "zebra" }],
  ["skills_list", {}],
  ["skills_run", { slug: "workspace-digest" }],
  ["journal_append", { text: "uma linha" }],
  ["facts_assert", { subject: "s", predicate: "p", object: "o" }],
  ["facts_query", {}],
  ["note_create", { title: "Nota" }],
  ["note_read", { path: "/n.md" }],
  ["note_save", { path: "/n.md", content: "x", baseVersion: "sha256:0" }],
  ["inbox_unread", {}],
  ["search", { query: "zebra" }],
  ["links", { path: "/n.md" }],
  ["hygiene", {}],
];

describe("C36 every call carries the token, the principal and the client", () => {
  it("C36 httpApi sends x-mordomo-token, x-mordomo-as: mcp and x-mordomo-client on every call of each of the 13 tools", async () => {
    const recorder = await mcpRecorder();
    try {
      const api = httpApi(recorder.url, "owner-token", () => "claude-code");
      for (const [name, args] of ONE_CALL) {
        const before = recorder.seen.length;
        const answer = await callTool(api, name, args);
        expect(answer.isError, `${name}: ${answer.text}`).toBe(false);
        const calls = recorder.seen.slice(before);
        expect(calls.length, name).toBeGreaterThan(0);
        for (const call of calls) {
          expect(
            [call.headers["x-mordomo-token"], call.headers["x-mordomo-as"], call.headers["x-mordomo-client"]],
            `${name} ${call.method} ${call.path}`,
          ).toEqual(["owner-token", "mcp", "claude-code"]);
        }
      }
      expect(recorder.seen.length).toBeGreaterThanOrEqual(13);
    } finally {
      await recorder.close();
    }
  });
});

describe("C38 the built mordomo mcp names its client", () => {
  /** Run the built `mordomo mcp` with these lines on its stdin until the answer of `id` 2. */
  async function serve(url: string, home: string, lines: Json[]): Promise<Json[]> {
    const child = spawn(process.execPath, [CLI, "mcp"], {
      cwd: repoRoot,
      env: { ...process.env, MORDOMO_HOME: home, MORDOMO_URL: url, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const answers: Json[] = [];
    let out = "";
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`mordomo mcp did not answer: ${err}`)), 60_000);
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        const parts = out.split("\n");
        out = parts.pop() ?? "";
        for (const line of parts.filter((l) => l.trim())) {
          const answer = JSON.parse(line) as Json;
          answers.push(answer);
          if (answer.id === 2) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });
    for (const line of lines) child.stdin.write(`${JSON.stringify(line)}\n`);
    await done;
    child.stdin.end();
    await new Promise((resolve) => child.on("close", resolve));
    return answers;
  }

  it("C38 after initialize with clientInfo claude-code a recall reaches the server with x-mordomo-client claude-code; without clientInfo, desconhecido", async () => {
    expect(fs.existsSync(CLI), `${CLI}: run npm run build first`).toBe(true);
    const recorder = await mcpRecorder();
    const home = makeTempHome("mordomo-perguntar-mcp-cli-");
    try {
      const recall = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "recall", arguments: { question: "zebra" } },
      };
      const named = await serve(recorder.url, home.paths.home, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "claude-code", version: "2" } },
        },
        recall,
      ]);
      expect(named.find((a) => a.id === 2)?.result?.isError).not.toBe(true);
      const first = recorder.seen.filter((s) => s.path.startsWith("/api/v1/memory/recall"));
      expect(first.map((s) => [s.headers["x-mordomo-as"], s.headers["x-mordomo-client"]])).toEqual([
        ["mcp", "claude-code"],
      ]);
      recorder.seen.length = 0;
      await serve(recorder.url, home.paths.home, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        recall,
      ]);
      const second = recorder.seen.filter((s) => s.path.startsWith("/api/v1/memory/recall"));
      expect(second.map((s) => [s.headers["x-mordomo-as"], s.headers["x-mordomo-client"]])).toEqual([
        ["mcp", "desconhecido"],
      ]);
    } finally {
      await recorder.close();
      home.cleanup();
    }
  }, 120_000);
});

describe("C39 the principal at the boundary", () => {
  it("C39 over the listening server: the owner's token with x-mordomo-as mcp reads as agents and calls only MCP_ROUTES; owner and MCP are 400 validation; a device, a run and the broker are judged as they are", async () => {
    await fresh(async (w) => {
      const secret = w.put(
        path.join(w.memory, "notes", "privado", "segredo.md"),
        "# Segredo\n\n## Zebra\n\nA zebra secreta.\n",
      );
      await w.index();
      await w.hideFromAgents(path.dirname(secret));
      const token = w.ctx.token();
      const owner = { "content-type": "application/json", "x-mordomo-token": token };
      const recall = "/api/v1/memory/recall?q=zebra&record=false";
      // the owner: the hidden note is recalled; the principal mcp: it is not (audience agents)
      const asOwner = await w.fetchAs("GET", recall, owner);
      expect(asOwner.status).toBe(200);
      expect(JSON.stringify(asOwner.body)).toContain(secret);
      const asMcp = await w.fetchAs("GET", recall, w.mcpHeaders());
      expect(asMcp.status).toBe(200);
      expect(JSON.stringify(asMcp.body)).not.toContain(secret);
      // the principal mcp outside its routes, and the two other values of the header
      expect(code(await w.fetchAs("GET", "/api/v1/settings", w.mcpHeaders()))).toEqual([403, "forbidden"]);
      for (const value of ["owner", "MCP"]) {
        expect(code(await w.fetchAs("GET", recall, { ...owner, "x-mordomo-as": value })), value).toEqual([
          400,
          "validation",
        ]);
      }
      // another credential with the header is judged as it is: a device (content) reads as a device and is refused an
      // owner route as a device is; a run's rc_ and the broker's brk_ keep their own lists
      const device = { ...w.device(["content"]), "x-mordomo-as": "mcp" };
      const deviceRecall = await w.fetchAs("GET", recall, device);
      expect(deviceRecall.status).toBe(200);
      expect(JSON.stringify(deviceRecall.body)).toContain(secret);
      expect(code(await w.fetchAs("GET", "/api/v1/devices", device))).toEqual([403, "owner_only"]);
      const run = { ...w.run("read_only").headers, "x-mordomo-as": "mcp" };
      expect(code(await w.fetchAs("GET", "/api/v1/skills", run))).toEqual([403, "forbidden"]);
      expect((await w.fetchAs("GET", "/api/v1/memory/journal?days=1", run)).status).toBe(200);
      const held = w.ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "held open",
        cwd: w.home,
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 60_000,
        profile: "review_before_write",
      } as never);
      const brk = w.ctx.permissionBrokerFor({
        id: held.id,
        permissionProfile: "review_before_write",
      } as never)!.env.MORDOMO_TOKEN!;
      expect(brk.startsWith("brk_")).toBe(true);
      const broker = { "content-type": "application/json", "x-mordomo-token": brk, "x-mordomo-as": "mcp" };
      const refused = await w.fetchAs("GET", recall, broker);
      expect(code(refused)).toEqual([403, "forbidden"]);
      expect(refused.body.error.message).toBe("The permission broker cannot call this route");
    });
  });
});

describe("C40 the tools read as agents", () => {
  it("C40 with memory/notes/privado/ hidden from agents, recall, search, note_read, facts_query, links and hygiene return nothing of segredo.md; with the owner's token and no header they do", async () => {
    await fresh(async (w) => {
      w.put(
        path.join(w.memory, "notes", "aberto.md"),
        "# Aberto\n\n## Zebra\n\nA zebra listrada mora no zoológico.\n",
      );
      const secret = w.put(
        path.join(w.memory, "notes", "privado", "segredo.md"),
        "# Segredo\n\n## Zebra\n\nA zebra secreta mora aqui.\n",
      );
      await w.index();
      const fact = await w.call("POST", "/api/memory/facts", {
        subject: "zebra",
        predicate: "mora em",
        object: "um lugar secreto",
        sourcePath: secret,
      });
      expect(fact.status, JSON.stringify(fact.body)).toBe(201);
      await w.hideFromAgents(path.dirname(secret));
      const calls: Array<[string, Json]> = [
        ["recall", { question: "zebra" }],
        ["search", { query: "zebra" }],
        ["note_read", { path: secret }],
        ["facts_query", {}],
        ["links", { path: secret }],
        ["hygiene", {}],
      ];
      for (const [name, args] of calls) {
        const agent = await w.mcp(name, args);
        const mine = await w.owner(name, args);
        expect(mine.isError, `${name} as the owner: ${mine.text}`).toBe(false);
        // nothing the server answered names the file or holds its words: an error for the two tools that ask for it
        // by its path, and no path, excerpt, fact or orphan line in the others
        expect(agent.text, name).not.toContain("secreta");
        expect(agent.text, name).not.toContain("um lugar secreto");
        if (name === "note_read" || name === "links") {
          expect(agent.isError, `${name}: ${agent.text}`).toBe(true);
        } else {
          expect(agent.isError, `${name}: ${agent.text}`).toBe(false);
          expect(agent.text, name).not.toContain("segredo.md");
        }
      }
      // the differential: the owner's answers hold what the agent's do not
      expect((await w.owner("recall", { question: "zebra" })).text).toContain(secret);
      expect((await w.owner("search", { query: "zebra" })).text).toContain(secret);
      expect((await w.owner("note_read", { path: secret })).text).toContain("A zebra secreta mora aqui.");
      expect((await w.owner("facts_query")).text).toContain("um lugar secreto");
      expect((await w.owner("links", { path: secret })).text).toMatch(/^Backlinks:/);
      expect((await w.owner("hygiene")).text).toContain(`- ${secret}`);
      // the agent still reads what is not hidden
      expect((await w.mcp("search", { query: "zebra" })).text).toContain(
        path.join(w.memory, "notes", "aberto.md"),
      );
    });
  });
});

describe("C41 MCP_ROUTES is the 11 routes of the 13 tools", () => {
  it("C41 MCP_ROUTES equals the 11 routes, and each passes through /api and /api/v1 with the principal mcp", async () => {
    expect([...MCP_ROUTES].sort()).toEqual(
      [
        "GET /api/memory/recall",
        "GET /api/skills",
        "POST /api/skills/:slug/run",
        "POST /api/memory/journal/append",
        "POST /api/memory/proposals",
        "GET /api/memory/facts",
        "GET /api/memory/note",
        "GET /api/notifications",
        "GET /api/memory/search",
        "GET /api/memory/links",
        "GET /api/memory/hygiene",
      ].sort(),
    );
    await fresh(async (w) => {
      const note = w.put(path.join(w.memory, "notes", "aberto.md"), "# Aberto\n\n## Zebra\n\nA zebra.\n");
      await w.index();
      const calls: Array<[string, string, unknown]> = [
        ["GET", "/memory/recall?q=zebra&record=false", undefined],
        ["GET", "/skills", undefined],
        ["POST", "/skills/workspace-digest/run", { inputs: {} }],
        ["POST", "/memory/journal/append", { text: "pelo mcp", author: "agent" }],
        ["POST", "/memory/proposals", { kind: "fact", subject: "s", predicate: "p", object: "o" }],
        ["GET", "/memory/facts", undefined],
        ["GET", `/memory/note?p=${encodeURIComponent(note)}`, undefined],
        ["GET", "/notifications", undefined],
        ["GET", "/memory/search?q=zebra", undefined],
        ["GET", "/memory/links?p=notes/aberto.md", undefined],
        ["GET", "/memory/hygiene", undefined],
      ];
      const reached = new Set<string>();
      for (const prefix of ["/api", "/api/v1"]) {
        for (const [method, rest, body] of calls) {
          const res = await w.fetchAs(method, `${prefix}${rest}`, w.mcpHeaders(), body);
          expect(res.status, `${method} ${prefix}${rest} ${JSON.stringify(res.body)}`).toBeLessThan(300);
          reached.add(
            `${method} /api${rest.replace(/\?.*$/, "").replace("/skills/workspace-digest/", "/skills/:slug/")}`,
          );
        }
      }
      expect([...reached].sort()).toEqual([...MCP_ROUTES].sort());
      for (const run of w.ctx.runs.list({ limit: 100 })) await w.ctx.execution.wait(run.id);
    });
  });
});

describe("C43 the tool search", () => {
  it("C43 three matching files give three lines path — excerpt in the route's order, no parenthesis without a section; no match and a missing query", async () => {
    await fresh(async (w) => {
      const notes = ["a", "b", "c"].map((n) =>
        w.put(path.join(w.memory, "notes", `${n}.md`), `# ${n}\n\nO onboarding de ${n} dura uma semana.\n`),
      );
      await w.index();
      const route = await w.fetchAs("GET", "/api/v1/memory/search?q=onboarding&limit=10", w.mcpHeaders());
      expect(route.status).toBe(200);
      const order = (route.body as unknown as Json[]).map((h) => h.path as string);
      expect([...order].sort()).toEqual([...notes].sort());
      const answer = await w.mcp("search", { query: "onboarding" });
      expect(answer.isError).toBe(false);
      const lines = answer.text.split("\n");
      expect(lines).toHaveLength(3);
      lines.forEach((line, i) => {
        expect(line.startsWith(`${order[i]} — `), line).toBe(true);
        expect(line.slice(order[i]!.length).startsWith(" (")).toBe(false);
        expect(line.length).toBeGreaterThan(order[i]!.length + 3);
      });
      expect(await w.mcp("search", { query: "xyzzyplugh" })).toEqual({
        text: "No file matched.",
        isError: false,
      });
      expect(await w.mcp("search", {})).toEqual({ text: "query is required", isError: true });
    });
  });

  it("C43 limit 1 gives one line, 20 at most 20, 0 and 21 clamp to 1 and 20, and no limit at most 10", async () => {
    await fresh(async (w) => {
      for (let i = 0; i < 25; i++) {
        w.put(
          path.join(w.memory, "notes", `kiwi-${String(i).padStart(2, "0")}.md`),
          `# Kiwi ${i}\n\nUm kiwi maduro.\n`,
        );
      }
      await w.index();
      const lines = async (args: Json) =>
        (await w.mcp("search", { query: "kiwi", ...args })).text.split("\n").length;
      expect(await lines({ limit: 1 })).toBe(1);
      expect(await lines({ limit: 20 })).toBe(20);
      expect(await lines({ limit: 0 })).toBe(1);
      expect(await lines({ limit: 21 })).toBe(20);
      expect(await lines({})).toBe(10);
    });
  });

  it("C43 the query reaches the route with limit clamped, mode=text and context=; a hit with a section reads path (section) — excerpt", async () => {
    const recorder = await mcpRecorder();
    try {
      const api = httpApi(recorder.url, "t", () => "claude-code");
      const sent = async (args: Json) => {
        recorder.seen.length = 0;
        await callTool(api, "search", { query: "onboarding", ...args });
        return new URL(recorder.seen[0]!.path, "http://x").searchParams;
      };
      expect((await sent({})).get("limit")).toBe("10");
      expect((await sent({ limit: 0 })).get("limit")).toBe("1");
      expect((await sent({ limit: 21 })).get("limit")).toBe("20");
      expect((await sent({ limit: 20 })).get("limit")).toBe("20");
      expect((await sent({ mode: "text" })).get("mode")).toBe("text");
      expect((await sent({ context: "cliente-x" })).get("context")).toBe("cliente-x");
      expect((await sent({})).has("mode")).toBe(false);
    } finally {
      await recorder.close();
    }
    const api: McpApi = {
      get: async <T>() =>
        [
          { path: "/m/a.md", section: "Decisão", snippet: "O onboarding dura" },
          { path: "/m/b.md", snippet: "sem seção" },
        ] as T,
      post: async <T>() => ({}) as T,
      put: async <T>() => ({}) as T,
    };
    expect((await callTool(api, "search", { query: "onboarding" })).text).toBe(
      "/m/a.md (Decisão) — O onboarding dura\n/m/b.md — sem seção",
    );
  });
});

describe("C44 the tool links", () => {
  it("C44 a.md reads Backlinks: b.md, then Links: c.md and zz.md (quebrado); a missing path and a hidden one the same File not found; a missing path argument", async () => {
    await fresh(async (w) => {
      const notes = path.join(w.memory, "notes");
      const a = w.put(path.join(notes, "a.md"), "# A\n\nVeja [c](c.md) e [zz](zz.md).\n");
      const b = w.put(path.join(notes, "b.md"), "# B\n\nVeja [a](a.md).\n");
      const c = w.put(path.join(notes, "c.md"), "# C\n\nNada.\n");
      const hidden = w.put(path.join(notes, "privado", "h.md"), "# H\n\nVeja [a](../a.md).\n");
      await w.index();
      await w.hideFromAgents(path.dirname(hidden));
      const answer = await w.mcp("links", { path: a });
      expect(answer).toEqual({
        text: ["Backlinks:", `- ${b}`, "Links:", `- ${c}`, `- ${path.join(notes, "zz.md")} (quebrado)`].join(
          "\n",
        ),
        isError: false,
      });
      const missing = path.join(notes, "nao-existe.md");
      expect(await w.mcp("links", { path: missing })).toEqual({
        text: `File not found: ${missing}`,
        isError: true,
      });
      expect(await w.mcp("links", { path: hidden })).toEqual({
        text: `File not found: ${hidden}`,
        isError: true,
      });
      // the hidden file is there for the owner: the two refusals above are the folder's, not the path's
      expect((await w.owner("links", { path: hidden })).isError).toBe(false);
      expect(await w.mcp("links", {})).toEqual({ text: "path is required", isError: true });
    });
  });
});

describe("C45 GET /api/memory/links takes p", () => {
  it("C45 an absolute p, a p relative to memory/ and ?id= answer the same body; both or neither 400 validation; a p of no row 404; a p hidden from devices 404 for a device", async () => {
    await fresh(async (w) => {
      const notes = path.join(w.memory, "notes");
      const a = w.put(path.join(notes, "a.md"), "# A\n\nVeja [c](c.md).\n");
      w.put(path.join(notes, "c.md"), "# C\n");
      const shut = w.put(path.join(notes, "fechado", "x.md"), "# X\n");
      await w.index();
      const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(a) as { id: number }).id;
      const byId = await w.call("GET", `/api/memory/links?id=${id}`);
      expect(byId.status).toBe(200);
      expect(byId.body.file.path).toBe(a);
      const absolute = await w.call("GET", `/api/memory/links?p=${encodeURIComponent(a)}`);
      const relative = await w.call("GET", `/api/memory/links?p=${encodeURIComponent("notes/a.md")}`);
      expect([absolute.status, absolute.body]).toEqual([200, byId.body]);
      expect([relative.status, relative.body]).toEqual([200, byId.body]);
      expect(code(await w.call("GET", `/api/memory/links?id=${id}&p=notes/a.md`))).toEqual([
        400,
        "validation",
      ]);
      expect(code(await w.call("GET", "/api/memory/links"))).toEqual([400, "validation"]);
      expect(code(await w.call("GET", "/api/memory/links?p=notes/zz.md"))).toEqual([404, "not_found"]);
      const res = await w.call("PUT", "/api/settings", {
        folderAccess: [{ path: path.dirname(shut), agents: "write", devices: "hide" }],
      });
      expect(res.status).toBe(200);
      await w.index();
      const device = w.device(["content"]);
      const p = `/api/memory/links?p=${encodeURIComponent(shut)}`;
      const hiddenForDevice = await w.call("GET", p, undefined, device);
      const missingForDevice = await w.call(
        "GET",
        "/api/memory/links?p=notes/fechado/zz.md",
        undefined,
        device,
      );
      expect(code(hiddenForDevice)).toEqual([404, "not_found"]);
      expect(hiddenForDevice.body).toEqual(missingForDevice.body);
      expect((await w.call("GET", p)).status).toBe(200);
    });
  });
});

describe("C46 the tool hygiene", () => {
  it("C46 12 orphans, 3 broken links, 1 broken router pointer and 2 stale files give lists of 10, 3, 1 and 2 lines; perKind 20 gives 12 orphans, 0 and 21 clamp; the hidden orphan is in no list", async () => {
    await fresh(async (w) => {
      const notes = path.join(w.memory, "notes");
      const old = (Date.now() - 200 * 86_400_000) / 1000;
      // eleven orphan notes, and the day of the journal the routers make (an orphan too): twelve
      const orphans: string[] = [];
      for (let i = 1; i <= 11; i++)
        orphans.push(w.put(path.join(notes, `orfa-${String(i).padStart(2, "0")}.md`), `# Órfã ${i}\n`));
      w.put(
        path.join(notes, "ponte.md"),
        "# Ponte\n\nVeja [alvo](alvo.md), [x](sumiu-1.md), [y](sumiu-2.md) e [[sumiu-3]].\n",
      );
      w.put(path.join(notes, "alvo.md"), "# Alvo\n");
      const s1 = w.put(path.join(notes, "parada-1.md"), "# Parada 1\n\nVeja [p2](parada-2.md).\n");
      const s2 = w.put(path.join(notes, "parada-2.md"), "# Parada 2\n");
      const hidden = w.put(path.join(notes, "privado", "escondida.md"), "# Escondida\n");
      for (const f of [s1, s2, hidden]) fs.utimesSync(f, old, old);
      await w.index();
      expect((await w.call("POST", "/api/memory/routers")).status).toBe(200);
      fs.writeFileSync(
        path.join(w.memory, "areas", "ponteiros.md"),
        `# Ponteiros\n\n- \`${path.join(notes, "nunca-existiu.md")}\`\n`,
      );
      await w.hideFromAgents(path.dirname(hidden));
      const lists = (text: string): Record<string, string[]> => {
        const out: Record<string, string[]> = {};
        let current = "";
        for (const line of text.split("\n")) {
          const head = /^(.+) \((\d+)\):$/.exec(line);
          if (head) {
            current = head[1]!;
            out[current] = [];
          } else out[current]!.push(line);
        }
        return out;
      };
      const counts = (text: string) => Object.values(lists(text)).map((l) => l.length);
      const answer = await w.mcp("hygiene");
      expect(answer.isError, answer.text).toBe(false);
      const got = lists(answer.text);
      expect(Object.keys(got)).toEqual(["Orphans", "Broken links", "Broken router pointers", "Stale files"]);
      const journal = path.join(w.memory, "journal");
      orphans.push(...fs.readdirSync(journal).map((name) => path.join(journal, name)));
      expect(orphans).toHaveLength(12);
      expect(counts(answer.text)).toEqual([10, 3, 1, 2]);
      expect(got["Broken links"]!.every((l) => l.startsWith(`- ${path.join(notes, "ponte.md")}:`))).toBe(
        true,
      );
      expect(got["Broken router pointers"]![0]).toContain(path.join(notes, "nunca-existiu.md"));
      expect([...got["Stale files"]!].sort()).toEqual([
        `- ${s1}: Untouched for 200 d.`,
        `- ${s2}: Untouched for 200 d.`,
      ]);
      const all = await w.mcp("hygiene", { perKind: 20 });
      expect(counts(all.text)).toEqual([12, 3, 1, 2]);
      expect([...lists(all.text).Orphans!].sort()).toEqual(orphans.map((o) => `- ${o}`).sort());
      expect(counts((await w.mcp("hygiene", { perKind: 0 })).text)).toEqual([1, 1, 1, 1]);
      expect(counts((await w.mcp("hygiene", { perKind: 21 })).text)).toEqual([12, 3, 1, 2]);
      for (const perKind of [undefined, 20, 21]) {
        expect((await w.mcp("hygiene", perKind === undefined ? {} : { perKind })).text).not.toContain(
          "escondida",
        );
      }
      // the hidden file is an orphan and stale for the owner: it is the folder that keeps it out
      const mine = await w.owner("hygiene", { perKind: 20 });
      expect(lists(mine.text).Orphans).toContain(`- ${hidden}`);
      expect(lists(mine.text)["Stale files"]!.some((l) => l.startsWith(`- ${hidden}:`))).toBe(true);
    });
  });
});

describe("C47 the writes stay proposals", () => {
  it("C47 facts_assert, note_create and note_save under the principal mcp answer the waiting sentence, store a proposal by mcp, and write nothing to memory/", async () => {
    await fresh(async (w) => {
      const note = await w.call("POST", "/api/memory/notes", { title: "Nota MCP", content: "um" });
      expect(note.status).toBe(201);
      const snapshot = () => {
        const out: Record<string, string> = {};
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out[full] = fs.readFileSync(full, "utf8");
          }
        };
        walk(w.memory);
        return out;
      };
      const before = snapshot();
      const facts = () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM facts").get() as { c: number }).c;
      const factsBefore = facts();
      const answers = [
        await w.mcp("facts_assert", { subject: "s", predicate: "p", object: "o" }),
        await w.mcp("note_create", { title: "Nota proposta", content: "x" }),
        await w.mcp("note_save", { path: note.body.path, content: "dois", baseVersion: note.body.version }),
      ];
      const ids: string[] = [];
      for (const a of answers) {
        expect(a.isError, a.text).toBe(false);
        const m = /^Proposal (mp_[0-9a-f]{16}) is waiting for review in the MordomoOS inbox\.$/.exec(a.text);
        expect(m, a.text).not.toBeNull();
        ids.push(m![1]!);
      }
      const listed = await w.call("GET", "/api/memory/proposals?status=pending");
      expect(
        (listed.body.items as Json[])
          .filter((i) => ids.includes(i.id))
          .map((i) => [i.kind, i.author])
          .sort(),
      ).toEqual(
        [
          ["fact", "mcp"],
          ["note_create", "mcp"],
          ["note_save", "mcp"],
        ].sort(),
      );
      expect(facts()).toBe(factsBefore);
      expect(snapshot()).toEqual(before);
    });
  });
});

describe("C48 what the principal mcp keeps as today", () => {
  it("C48 skills_run starts a run by owner with the skill's profile; inbox_unread lists the owner's unread; journal_append marks the agent with no folder check", async () => {
    await fresh(async (w) => {
      const ownerRun = await w.call("POST", "/api/skills/workspace-digest/run", { inputs: {} });
      expect(ownerRun.status, JSON.stringify(ownerRun.body)).toBeLessThan(300);
      const viaMcp = await w.mcp("skills_run", { slug: "workspace-digest" });
      expect(viaMcp.isError, viaMcp.text).toBe(false);
      const started = JSON.parse(viaMcp.text) as { runId: string };
      const mine = w.ctx.runs.get(ownerRun.body.runId)!;
      const theirs = w.ctx.runs.get(started.runId)!;
      expect(theirs.startedBy).toBe("owner");
      expect(mine.startedBy).toBe("owner");
      expect(theirs.profile).toBe(mine.profile);
      expect(theirs.skillSlug).toBe("workspace-digest");
      await w.ctx.execution.wait(mine.id);
      await w.ctx.execution.wait(theirs.id);

      w.ctx.db.prepare("UPDATE notifications SET read = 1").run();
      w.ctx.notifications.add({ kind: "system", title: "Uma aprovação espera", body: "do dono" } as never);
      const inbox = await w.mcp("inbox_unread");
      expect(inbox.isError, inbox.text).toBe(false);
      expect(inbox.text).toMatch(/^- \d{4}-\d{2}-\d{2}T[^ ]+ Uma aprovação espera — do dono$/);

      const journal = path.join(w.memory, "journal");
      fs.mkdirSync(journal, { recursive: true });
      await w.hideFromAgents(journal);
      const appended = await w.mcp("journal_append", { text: "uma linha do agente" });
      expect(appended).toEqual({ text: "Appended.", isError: false });
      const day = await w.call("GET", "/api/memory/journal");
      expect(day.status).toBe(200);
      expect(day.body.content).toContain("uma linha do agente (autor:: agente)");
    });
  });
});

describe("C50 the tool list", () => {
  it("C50 tools/list is the 13 tools in order, and search, links and hygiene carry door 4's input schemas", async () => {
    const api: McpApi = {
      get: async <T>() => ({}) as T,
      post: async <T>() => ({}) as T,
      put: async <T>() => ({}) as T,
    };
    const list = (await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { name: "mordomo", version: "0", tools: mordomoTools(api) },
    )) as { result: { tools: Array<{ name: string; inputSchema: Json }> } };
    const tools = list.result.tools;
    expect(tools.map((t) => t.name)).toEqual(ONE_CALL.map(([name]) => name));
    expect(tools.map((t) => t.name)).toHaveLength(13);
    expect(tools.slice(10).map((t) => ({ name: t.name, inputSchema: t.inputSchema }))).toEqual([
      {
        name: "search",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            mode: { type: "string", enum: ["auto", "text", "semantic"] },
            context: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "links",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      { name: "hygiene", inputSchema: { type: "object", properties: { perKind: { type: "number" } } } },
    ]);
  });
});

import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "../apps/api/src/mcp/stdio.js";
import { httpApi, mordomoTools, type McpApi } from "../apps/api/src/mcp/mordomo.js";
import { MCP_ROUTES } from "../apps/api/src/server.js";
import { mcpRecorder } from "./helpers/mcpRecorder.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { recordedSource } from "./helpers/resumosWorld.js";

// The day the tool summary names is a local day (L-050): a zone that is not UTC.
process.env.TZ = "America/Sao_Paulo";

/**
 * .specs/features/cerebro-entidades-resumos, batch B, S3 (door 7): the MCP tools `entities` and `entity`, called through
 * `handleMcpRequest` and `mordomoTools` over an `httpApi` pointed at a `buildServer` listening on `127.0.0.1:0`, so the
 * headers, the principal `mcp` and its route list are the real ones.
 */

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

interface McpWorld extends MemoriaWorld {
  root: string;
  mcp: (name: string, args?: Json) => Promise<ToolAnswer>;
}

async function fresh(run: (w: McpWorld) => Promise<void>): Promise<void> {
  const base = await memoriaWorld("mordomo-entidades-mcp-");
  try {
    await base.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = base.app.server.address() as AddressInfo;
    const api = httpApi(`http://127.0.0.1:${port}`, base.ctx.token(), () => "claude-code");
    const w = Object.assign(base, {
      root: base.indexedRoot("acervo"),
      mcp: (name: string, args: Json = {}) => callTool(api, name, args),
    });
    await run(w);
  } finally {
    await base.close();
  }
}

describe("C39 the tool entities", () => {
  it("C39 query ban gives the line name (kind, n arquivos); kind tag filters; no match is No entity matched.", async () => {
    await fresh(async (w) => {
      w.put(path.join(w.root, "a.md"), "notas #banho #financeiro\nReunião com Banco Central.\n");
      w.put(path.join(w.root, "b.md"), "notas #financeiro\nVisita ao Banco Central.\n");
      w.put(path.join(w.root, "c.md"), "notas #financeiro\n");
      await w.index();
      expect(await w.mcp("entities", { query: "ban" })).toEqual({
        text: "Banco Central (termo, 2 arquivos)\nbanho (tag, 1 arquivos)",
        isError: false,
      });
      expect(await w.mcp("entities", { kind: "tag" })).toEqual({
        text: "financeiro (tag, 3 arquivos)\nbanho (tag, 1 arquivos)",
        isError: false,
      });
      expect(await w.mcp("entities", { query: "zzz" })).toEqual({
        text: "No entity matched.",
        isError: false,
      });
    });
  });

  it("C39 limit 1 and 50 kept, 0 and 51 clamped to 1 and 50, none at most 20", async () => {
    await fresh(async (w) => {
      for (let f = 0; f < 3; f++) {
        w.put(
          path.join(w.root, `tags${f}.md`),
          `${Array.from({ length: 20 }, (_, i) => `#t${String(f * 20 + i).padStart(2, "0")}`).join(" ")}\n`,
        );
      }
      await w.index();
      const lines = async (args: Json) => (await w.mcp("entities", args)).text.split("\n").length;
      expect(await lines({ limit: 1 })).toBe(1);
      expect(await lines({ limit: 50 })).toBe(50);
      expect(await lines({ limit: 0 })).toBe(1);
      expect(await lines({ limit: 51 })).toBe(50);
      expect(await lines({})).toBe(20);
    });
    // what reaches the route: limit clamped, q and kind as given
    const recorder = await mcpRecorder();
    try {
      const api = httpApi(recorder.url, "t", () => "claude-code");
      const sent = async (args: Json) => {
        recorder.seen.length = 0;
        await callTool(api, "entities", args);
        return new URL(recorder.seen[0]!.path, "http://x");
      };
      expect((await sent({})).searchParams.get("limit")).toBe("20");
      expect((await sent({ limit: 0 })).searchParams.get("limit")).toBe("1");
      expect((await sent({ limit: 51 })).searchParams.get("limit")).toBe("50");
      const full = await sent({ query: "ban", kind: "tag", limit: 7 });
      expect(full.pathname).toBe("/api/v1/memory/entities");
      expect([
        full.searchParams.get("q"),
        full.searchParams.get("kind"),
        full.searchParams.get("limit"),
      ]).toEqual(["ban", "tag", "7"]);
    } finally {
      await recorder.close();
    }
  });
});

describe("C40 the tool entity", () => {
  it("C40 by name and by key the same text: name, kind, aliases, mentions path:line — excerpt, related; unknown and missing", async () => {
    await fresh(async (w) => {
      const home = w.put(
        path.join(w.root, "pessoas", "Ana Souza.md"),
        "---\ntype: profile\ntitle: Ana Souza\naliases: [A. Souza]\n---\nficha.\n",
      );
      const note = w.put(path.join(w.root, "ata.md"), "notas #reuniao\nFalei com Ana Souza hoje.\n");
      await w.index();
      const byName = await w.mcp("entity", { name: "ana souza" });
      const byKey = await w.mcp("entity", { key: "perfil:ana souza" });
      expect(byName.isError, byName.text).toBe(false);
      expect(byName).toEqual(byKey);
      expect(byName.text).toBe(
        [
          "Ana Souza (perfil)",
          "Aliases: A. Souza",
          // the route's mentions, by path then line: the home note's two names (its header's lines) and the note's text
          "Mentions (3):",
          `- ${note}:2 — Falei com Ana Souza hoje.`,
          `- ${home}:1 — title: Ana Souza`,
          `- ${home}:1 — aliases: [A. Souza]`,
          "Related:",
          "- reuniao (tag, 1 arquivos em comum)",
        ].join("\n"),
      );
      // an alias finds it too
      expect(await w.mcp("entity", { name: "A. Souza" })).toEqual(byName);
      expect(await w.mcp("entity", { name: "Bruno Lima" })).toEqual({
        text: "Entity not found: Bruno Lima",
        isError: true,
      });
      expect(await w.mcp("entity", { key: "perfil:bruno lima" })).toEqual({
        text: "Entity not found: perfil:bruno lima",
        isError: true,
      });
      expect(await w.mcp("entity", {})).toEqual({ text: "name or key is required", isError: true });
    });
  });

  it("C40 at most 20 mentions", async () => {
    await fresh(async (w) => {
      for (let i = 0; i < 25; i++)
        w.put(path.join(w.root, `n${String(i).padStart(2, "0")}.md`), `Falei com Bruno Lima ${i}.\n`);
      await w.index();
      const answer = await w.mcp("entity", { name: "Bruno Lima" });
      expect(answer.isError, answer.text).toBe(false);
      expect(answer.text.split("\n").filter((l) => /\.md:\d+ — /.test(l))).toHaveLength(20);
    });
  });
});

// ---- batch C, S5 and C41 (door 7): the tool summary, and the three tools as agents read ---------------------------

/** "Now" of the claims: 24/11/2026 10:00 local. */
const NOW = new Date(2026, 10, 24, 10, 0).getTime();
const BEFORE = NOW - 3 * 86_400_000;

/** A new indexed folder of `area`. */
function areaRoot(w: McpWorld, name: string, area: string): string {
  const dir = w.outside(name);
  w.update((s) => {
    s.indexedFolders = [...s.indexedFolders, { path: dir, area, enabled: true }];
  });
  return dir;
}

function note(w: McpWorld, file: string, text: string, mtime: number): string {
  w.put(file, text);
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
  return file;
}

/** A finished run of brain-summarize of `area`, started at `startedAt`, whose summary.json is `content`. */
function seedSummary(
  w: McpWorld,
  runId: string,
  area: string,
  sources: Array<{ path: string; size: number; mtime: number; sha256: string }>,
  startedAt: number,
  content: Json,
): void {
  w.ctx.db
    .prepare(
      "INSERT INTO runs (id, created_at, started_at, finished_at, origin, provider, status, duration_ms, skill_slug, started_by) VALUES (?, ?, ?, ?, 'skill', 'claude', 'done', 1000, 'brain-summarize', 'owner')",
    )
    .run(runId, startedAt, startedAt, startedAt + 1000);
  w.ctx.db
    .prepare(
      "INSERT INTO summary_runs (run_id, scope_kind, scope_id, sources, started_at) VALUES (?, 'area', ?, ?, ?)",
    )
    .run(runId, area, JSON.stringify(sources), startedAt);
  const dir = path.join(w.ctx.paths.artifacts, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(content));
}

describe("C69 the tool summary", () => {
  it("C69 fresh: Resumo atual de 24/11/2026., then each paragraph followed by (<path> § <section>) per citation", async () => {
    await fresh(async (w) => {
      const root = areaRoot(w, "projetos", "Projetos");
      const a = note(w, path.join(root, "a.md"), "# A\n\n## Decisão\n\nO Atlas sai em março.\n", BEFORE);
      const b = note(w, path.join(root, "b.md"), "# B\n\n## Fato\n\nA Borba contrata.\n", BEFORE);
      await w.index();
      seedSummary(w, "resumo-fresco", "Projetos", [recordedSource(a), recordedSource(b)], NOW, {
        v: 1,
        paragraphs: [
          {
            text: "O Atlas sai em março.",
            citations: [
              { path: a, section: "Decisão" },
              { path: b, section: "Fato" },
            ],
          },
          { text: "A Borba contrata.", citations: [{ path: b, section: "Fato" }] },
        ],
      });
      expect(await w.mcp("summary", { area: "Projetos" })).toEqual({
        text: [
          "Resumo atual de 24/11/2026.",
          "",
          `O Atlas sai em março. (${a} § Decisão) (${b} § Fato)`,
          "",
          `A Borba contrata. (${b} § Fato)`,
        ].join("\n"),
        isError: false,
      });
    });
  });

  it("C69 stale with 3 changed, 1 removed and 2 added: Resumo velho: 3 fontes mudaram, 1 saiu, 2 arquivos novos.", async () => {
    await fresh(async (w) => {
      const root = areaRoot(w, "docs", "Documentos");
      const changed = ["a", "b", "c"].map((n) =>
        note(w, path.join(root, `${n}.md`), `# ${n}\n\n## Fato\n\nTexto ${n}.\n`, BEFORE),
      );
      for (const n of ["novo1", "novo2"]) note(w, path.join(root, `${n}.md`), `# ${n}\n`, NOW + 3_600_000);
      await w.index();
      // as the run recorded them: each of the three a byte shorter and with other bytes; a fourth gone since
      const recorded = [
        ...changed.map((file) => ({
          ...recordedSource(file),
          size: fs.statSync(file).size - 1,
          sha256: "0".repeat(64),
        })),
        { path: path.join(root, "saiu.md"), size: 10, mtime: BEFORE, sha256: "1".repeat(64) },
      ];
      seedSummary(w, "resumo-velho", "Documentos", recorded, NOW, {
        v: 1,
        paragraphs: [{ text: "Três textos.", citations: [{ path: changed[0]!, section: "Fato" }] }],
      });
      expect(await w.mcp("summary", { area: "Documentos" })).toEqual({
        text: [
          "Resumo velho: 3 fontes mudaram, 1 saiu, 2 arquivos novos.",
          "",
          `Três textos. (${changed[0]} § Fato)`,
        ].join("\n"),
        isError: false,
      });
    });
  });

  it("C69 missing: Ainda não há resumo de Projetos.", async () => {
    await fresh(async (w) => {
      areaRoot(w, "projetos", "Projetos");
      await w.index();
      expect(await w.mcp("summary", { area: "Projetos" })).toEqual({
        text: "Ainda não há resumo de Projetos.",
        isError: false,
      });
    });
  });

  it("C69 { area: nope } is an isError; neither area nor context is area or context is required", async () => {
    await fresh(async (w) => {
      const nope = await w.mcp("summary", { area: "nope" });
      expect(nope.isError).toBe(true);
      expect(nope.text).toBe("No area is named nope.");
      expect(await w.mcp("summary", {})).toEqual({ text: "area or context is required", isError: true });
    });
    // what reaches the route: the scope's kind and id, through /api/v1
    const recorder = await mcpRecorder();
    try {
      const api = httpApi(recorder.url, "t", () => "claude-code");
      await callTool(api, "summary", { area: "Finanças" });
      await callTool(api, "summary", { context: "cliente-x" });
      expect(recorder.seen.map((r) => [r.method, r.path])).toEqual([
        ["GET", `/api/v1/memory/summaries/area/${encodeURIComponent("Finanças")}`],
        ["GET", "/api/v1/memory/summaries/context/cliente-x"],
      ]);
    } finally {
      await recorder.close();
    }
  });
});

describe("C41 the three new tools read as an agent", () => {
  it("C41 an entity of a folder hidden from agents is in no answer of entities, entity or summary", async () => {
    await fresh(async (w) => {
      const root = areaRoot(w, "projetos", "Projetos");
      const aberta = note(
        w,
        path.join(root, "aberta.md"),
        "# Aberta\n\n## Fato\n\nO Atlas existe.\n",
        BEFORE,
      );
      const hidden = path.join(root, "sigilo");
      const b = note(w, path.join(hidden, "b.md"), "# B\n\n## Fato\n\nO Projeto Sigilo avança.\n", BEFORE);
      note(w, path.join(hidden, "c.md"), "# C\n\nVisita ao Projeto Sigilo.\n", BEFORE);
      await w.index();
      // the summary was written while the folder was still read by agents
      seedSummary(w, "resumo-sigilo", "Projetos", [recordedSource(aberta), recordedSource(b)], NOW, {
        v: 1,
        paragraphs: [
          { text: "O Atlas existe.", citations: [{ path: aberta, section: "Fato" }] },
          { text: "O Projeto Sigilo avança.", citations: [{ path: b, section: "Fato" }] },
        ],
      });
      expect((await w.mcp("summary", { area: "Projetos" })).text).toContain("Projeto Sigilo");
      expect((await w.mcp("entities", { query: "proj" })).text).toBe("Projeto Sigilo (termo, 2 arquivos)");

      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "hide", devices: "read" }];
      });
      await w.index();
      // the owner still reads the entity
      const owner = await w.call("GET", "/api/memory/entities?q=proj");
      expect(owner.body.items.map((e: Json) => [e.key, e.files])).toEqual([["termo:projeto sigilo", 2]]);

      const answers = [
        await w.mcp("entities", { query: "proj" }),
        await w.mcp("entities", {}),
        await w.mcp("entity", { name: "Projeto Sigilo" }),
        await w.mcp("entity", { key: "termo:projeto sigilo" }),
        await w.mcp("summary", { area: "Projetos" }),
      ];
      expect(answers[0]).toEqual({ text: "No entity matched.", isError: false });
      expect(answers[2]).toEqual({ text: "Entity not found: Projeto Sigilo", isError: true });
      expect(answers[3]).toEqual({ text: "Entity not found: termo:projeto sigilo", isError: true });
      // the two answers of entity name only what was asked; the others name nothing of the hidden folder
      for (const answer of [answers[0]!, answers[1]!, answers[4]!])
        expect(answer.text).not.toMatch(/sigilo/i);
      expect(answers[4]).toEqual({ text: "Ainda não há resumo de Projetos.", isError: false });
    });
  });

  it("C41 the routes the three tools call are in MCP_ROUTES, which is exactly the 11 of the C10 list plus the entities, one entity and one summary", async () => {
    expect([...MCP_ROUTES].sort()).toEqual(
      [
        // the 11 of C10
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
        // the three of door 7
        "GET /api/memory/entities",
        "GET /api/memory/entities/:key",
        "GET /api/memory/summaries/:kind/:id",
      ].sort(),
    );
    expect(MCP_ROUTES.size).toBe(14);
    const recorder = await mcpRecorder();
    try {
      const api = httpApi(recorder.url, "t", () => "claude-code");
      await callTool(api, "entities", { query: "ana" });
      await callTool(api, "entity", { key: "perfil:ana souza" });
      await callTool(api, "entity", { name: "ana" });
      await callTool(api, "summary", { area: "Projetos" });
      await callTool(api, "summary", { context: "alfa" });
      const routes = recorder.seen.map(
        (r) =>
          `${r.method} ${new URL(r.path, "http://x").pathname
            .replace(/^\/api\/v1\//, "/api/")
            .replace(/\/entities\/.+$/, "/entities/:key")
            .replace(/\/summaries\/.+$/, "/summaries/:kind/:id")}`,
      );
      expect([...new Set(routes)].sort()).toEqual(
        [
          "GET /api/memory/entities",
          "GET /api/memory/entities/:key",
          "GET /api/memory/summaries/:kind/:id",
        ].sort(),
      );
      for (const route of routes) expect(MCP_ROUTES.has(route), route).toBe(true);
      for (const r of recorder.seen) expect(r.headers["x-mordomo-as"]).toBe("mcp");
    } finally {
      await recorder.close();
    }
  });
});

// ---- batch E, the cross-cutting checks of the MCP (C95, C96) -------------------------------------------------------

/** The 13 tools of C10, in tools/list order. */
const C10_TOOLS = [
  "recall",
  "skills_list",
  "skills_run",
  "journal_append",
  "facts_assert",
  "facts_query",
  "note_create",
  "note_read",
  "note_save",
  "inbox_unread",
  "search",
  "links",
  "hygiene",
];

describe("C95 the MCP tool list", () => {
  it("C95 tools/list is the 13 of C10 then entities, entity and summary with door 7's input schemas, and GET /api/mcp gives the three kind read", async () => {
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
    expect(tools.map((t) => t.name)).toEqual([...C10_TOOLS, "entities", "entity", "summary"]);
    expect(tools).toHaveLength(16);
    // door 7: entities (query?, kind? of the four kinds, limit?), entity (name or key), summary (area or context)
    expect(tools.slice(13).map((t) => ({ name: t.name, inputSchema: t.inputSchema }))).toEqual([
      {
        name: "entities",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            kind: { type: "string", enum: ["perfil", "projeto", "tag", "termo"] },
            limit: { type: "number" },
          },
        },
      },
      {
        name: "entity",
        inputSchema: { type: "object", properties: { name: { type: "string" }, key: { type: "string" } } },
      },
      {
        name: "summary",
        inputSchema: {
          type: "object",
          properties: { area: { type: "string" }, context: { type: "string" } },
        },
      },
    ]);

    await fresh(async (w) => {
      const res = await w.call("GET", "/api/mcp");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body.tools as Json[]).map((t) => t.name)).toEqual(tools.map((t) => t.name));
      expect((res.body.tools as Json[]).slice(13)).toEqual([
        { name: "entities", kind: "read" },
        { name: "entity", kind: "read" },
        { name: "summary", kind: "read" },
      ]);
    });
  });
});

describe("C96 the agents' usage counts the new reads", () => {
  const usage = async (w: McpWorld): Promise<Json> => {
    const res = await w.call("GET", "/api/mcp");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.usage as Json;
  };
  const countOf = (u: Json, name: string) =>
    ((u.byTool as Json[]).find((c) => c.name === name)?.calls as number) ?? 0;
  const readsOf = (u: Json, p: string) =>
    ((u.paths as Json[]).find((x) => x.path === p)?.reads as number) ?? 0;

  it("C96 an MCP entity adds 1 to byTool.entity and 1 read per mentioned path; the owner's read of the entity adds nothing", async () => {
    await fresh(async (w) => {
      const home = w.put(
        path.join(w.root, "pessoas", "Ana Souza.md"),
        "---\ntype: profile\ntitle: Ana Souza\naliases: [A. Souza]\n---\nficha.\n",
      );
      // two mentions in one file: still one read of it
      const ata = w.put(path.join(w.root, "ata.md"), "Falei com Ana Souza hoje.\nE com A. Souza depois.\n");
      const outra = w.put(path.join(w.root, "outra.md"), "Ana Souza mandou o plano.\n");
      const fora = w.put(path.join(w.root, "fora.md"), "Nada de pessoas aqui.\n");
      await w.index();
      const before = await usage(w);

      const answer = await w.mcp("entity", { name: "Ana Souza" });
      expect(answer.isError, answer.text).toBe(false);
      const after = await usage(w);
      expect(after.calls - before.calls).toBe(1);
      expect(countOf(after, "entity") - countOf(before, "entity")).toBe(1);
      expect([home, ata, outra, fora].map((p) => readsOf(after, p) - readsOf(before, p))).toEqual([
        1, 1, 1, 0,
      ]);

      // by key, the same: one more call and one more read of each mentioned path
      await w.mcp("entity", { key: "perfil:ana souza" });
      const byKey = await usage(w);
      expect(countOf(byKey, "entity") - countOf(after, "entity")).toBe(1);
      expect([home, ata, outra, fora].map((p) => readsOf(byKey, p) - readsOf(after, p))).toEqual([
        1, 1, 1, 0,
      ]);

      // the owner's read of the same route is not an agent's
      expect(
        (await w.call("GET", `/api/memory/entities/${encodeURIComponent("perfil:ana souza")}`)).status,
      ).toBe(200);
      expect(await usage(w)).toEqual(byKey);
    });
  });

  it("C96 an MCP summary adds 1 to byTool.summary and 1 read per cited path; a source it does not cite and the owner's read add nothing", async () => {
    await fresh(async (w) => {
      const root = areaRoot(w, "projetos", "Projetos");
      const a = note(w, path.join(root, "a.md"), "# A\n\n## Decisão\n\nO Atlas sai em março.\n", BEFORE);
      const b = note(w, path.join(root, "b.md"), "# B\n\n## Fato\n\nA Borba contrata.\n", BEFORE);
      const c = note(w, path.join(root, "c.md"), "# C\n\n## Nada\n\nSem citação.\n", BEFORE);
      await w.index();
      seedSummary(
        w,
        "resumo-c96",
        "Projetos",
        [recordedSource(a), recordedSource(b), recordedSource(c)],
        NOW,
        {
          v: 1,
          paragraphs: [
            {
              text: "O Atlas sai em março.",
              citations: [
                { path: a, section: "Decisão" },
                { path: b, section: "Fato" },
              ],
            },
            // a cited twice: one read of it
            { text: "A decisão do Atlas.", citations: [{ path: a, section: "Decisão" }] },
          ],
        },
      );
      const before = await usage(w);
      const answer = await w.mcp("summary", { area: "Projetos" });
      expect(answer.isError, answer.text).toBe(false);
      const after = await usage(w);
      expect(after.calls - before.calls).toBe(1);
      expect(countOf(after, "summary") - countOf(before, "summary")).toBe(1);
      expect([a, b, c].map((p) => readsOf(after, p) - readsOf(before, p))).toEqual([1, 1, 0]);

      expect((await w.call("GET", "/api/memory/summaries/area/Projetos")).status).toBe(200);
      expect(await usage(w)).toEqual(after);
    });
  });
});

import path from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "../apps/api/src/mcp/stdio.js";
import { httpApi, mordomoTools, type McpApi } from "../apps/api/src/mcp/mordomo.js";
import { mcpRecorder } from "./helpers/mcpRecorder.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

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

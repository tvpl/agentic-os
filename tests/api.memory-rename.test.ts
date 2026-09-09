import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

it("rename converges across search, graph and preview without validating the stale source", async () => {
  const temp = makeTempHome();
  const ctx = new AppContext(temp.paths.home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token() };
  const old = path.join(temp.paths.memory, "antes.md");
  const next = path.join(temp.paths.memory, "depois.md");
  try {
    fs.writeFileSync(old, "# Navegação\nreferenciarenomeada preserva decisões.");
    await ctx.indexer.indexAllAsync();
    fs.renameSync(old, next);
    await ctx.indexer.indexAllAsync();
    const search = await app.inject({ url: "/api/memory/search?q=referenciarenomeada", headers });
    expect(search.json().map((item: { path: string }) => item.path)).toEqual([next]);
    const graph = await app.inject({ url: "/api/memory/graph", headers });
    expect(graph.json().nodes.some((item: { path: string }) => item.path === old)).toBe(false);
    expect(graph.json().nodes.some((item: { path: string }) => item.path === next)).toBe(true);
    const stale = await app.inject({ url: `/api/memory/preview?p=${encodeURIComponent(old)}`, headers });
    expect(stale.statusCode).toBe(404);
    expect(stale.json().error.code).toBe("source_missing");
    const preview = await app.inject({ url: `/api/memory/preview?p=${encodeURIComponent(next)}`, headers });
    expect(preview.json().content).toContain("preserva decisões");
  } finally {
    await app.close();
    ctx.close();
    temp.cleanup();
  }
});

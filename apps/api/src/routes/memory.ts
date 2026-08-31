import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  buildGraph,
  checkRouters,
  generateRouters,
  listFacets,
  previewFile,
  relatedFiles,
  searchFiles,
} from "@mordomo/core";
import type { AppContext } from "../context.js";

export function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/memory/status", async () => {
    const last = ctx.indexer.lastIndex();
    const facets = listFacets(ctx.db);
    return { lastIndex: last, facets };
  });

  app.post("/api/memory/index", async () => {
    const stats = ctx.indexer.indexAll();
    return { stats };
  });

  app.get("/api/memory/search", async (req) => {
    const q = z
      .object({
        q: z.string().default(""),
        area: z.string().optional(),
        ext: z.string().optional(),
        dir: z.string().optional(),
        tag: z.string().optional(),
        modifiedAfter: z.coerce.number().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query);
    return searchFiles(ctx.db, { query: q.q, ...q });
  });

  app.get("/api/memory/graph", async (req) => {
    const q = z
      .object({
        area: z.string().optional(),
        dir: z.string().optional(),
        q: z.string().optional(),
        maxNodes: z.coerce.number().int().min(10).max(4000).optional(),
      })
      .parse(req.query);
    return buildGraph(ctx.db, { area: q.area, dir: q.dir, query: q.q, maxNodes: q.maxNodes });
  });

  app.get("/api/memory/related", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.query);
    return relatedFiles(ctx.db, id);
  });

  app.get("/api/memory/preview", async (req) => {
    const { p } = z.object({ p: z.string() }).parse(req.query);
    // previewFile enforces root containment + secret blocklist (403 on violation).
    try {
      return previewFile(ctx.settings(), [ctx.paths.home], p);
    } catch (err) {
      throw Object.assign(new Error((err as Error).message), { statusCode: 403 });
    }
  });

  /**
   * Open a file with the OS default application — explicit user action only.
   * The executable is a fixed platform constant; the path is containment-checked.
   */
  app.post("/api/memory/open", async (req) => {
    const { p } = z.object({ p: z.string() }).parse(req.body);
    const roots = [
      ...ctx.settings().indexedFolders.filter((f) => f.enabled).map((f) => f.path),
      ctx.paths.home,
    ];
    let resolved: string;
    try {
      const { resolveInsideRoots } = await import("@mordomo/core");
      resolved = resolveInsideRoots(roots, p);
    } catch (err) {
      throw Object.assign(new Error((err as Error).message), { statusCode: 403 });
    }
    const { spawn } = await import("node:child_process");
    const [exe, args] =
      process.platform === "darwin"
        ? ["open", [resolved]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", resolved]]
          : ["xdg-open", [resolved]];
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* opener missing (headless) — the UI already shows the path */
    });
    child.unref();
    return { opened: resolved };
  });

  app.post("/api/memory/routers", async () => {
    const result = generateRouters(ctx.db, ctx.paths, ctx.settings());
    return { written: result.written };
  });

  app.get("/api/memory/routers/check", async () => checkRouters(ctx.db, ctx.paths, ctx.settings()));
}

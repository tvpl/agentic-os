import type { FastifyInstance } from "fastify";
import {
  applyCleanup,
  cleanupInventory,
  cleanupScanFor,
  resolveCleanupScope,
  saveCleanupDecisions,
  undoCleanup,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

/**
 * The guided cleanup (.specs/features/cerebro-faxina-guiada, door 5): the inventory of a scope, the scans of it, the
 * owner's decisions, the apply and the undo. The rules are the core's (`core/src/memory/cleanup.ts`, `cleanupScan.ts`,
 * `cleanupApply.ts`); the scans are the engine's (`ctx.cleanup`).
 */
export function registerCleanupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const env = () => ({ paths: ctx.paths, settings: ctx.settings() });

  /** What a scope holds, from the index rows alone (AC 1 to AC 5). */
  bind(app, "memory.cleanup.inventory", async ({ query }) => {
    const scope = resolveCleanupScope(env(), { context: query.context, dir: query.dir });
    return cleanupInventory(ctx.db, env(), scope);
  });

  /** Start a scan (AC 7, AC 15): `202` with its id; the progress goes on the bus as `cleanup.*`. */
  bind(app, "memory.cleanup.scans.start", async ({ body }, _req, reply) => {
    const scanId = ctx.cleanup.start({ context: body.context, dir: body.dir });
    reply.code(202);
    return { scanId };
  });

  bind(app, "memory.cleanup.scans.get", async ({ params: { id } }) => {
    const scan = ctx.cleanup.get(id);
    if (!scan) throw httpError(404, `No cleanup scan is called ${id}.`, "not_found");
    const { scopeKey: _key, ...view } = scan;
    return view;
  });

  /** The owner's answers to findings of the newest scan of a scope (AC 19 to AC 22, AC 25). */
  bind(app, "memory.cleanup.decisions", async ({ body }) =>
    saveCleanupDecisions(ctx.db, cleanupScanFor(ctx.cleanup, body.scanId, "decide"), body.decisions),
  );

  /** Move what was marked under memory/ to the archive, and list what lies outside it (AC 27 to AC 31). */
  bind(app, "memory.cleanup.apply", async ({ body }) => {
    const scan = cleanupScanFor(ctx.cleanup, body.scanId, "apply");
    return applyCleanup({ ...env(), db: ctx.db, indexer: ctx.indexer }, scan);
  });

  /** Move back what an apply archived, by its manifest (AC 32, AC 34). */
  bind(app, "memory.cleanup.undo", async ({ body }) =>
    undoCleanup({ ...env(), db: ctx.db, indexer: ctx.indexer }, body.manifest),
  );
}

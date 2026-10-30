import type { FastifyInstance } from "fastify";
import { cleanupInventory, resolveCleanupScope } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

/**
 * The guided cleanup (.specs/features/cerebro-faxina-guiada, door 5): the inventory of a scope and the scans of it. The
 * rules are the core's (`core/src/memory/cleanup.ts`, `cleanupScan.ts`); the scans are the engine's (`ctx.cleanup`).
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
}

import type { FastifyInstance } from "fastify";
import {
  applyCleanup,
  cleanupInventory,
  cleanupScanFor,
  resolveCleanupScope,
  scanCleanupScope,
  saveCleanupDecisions,
  recordMove,
  undoCleanup,
} from "@mordomo/core/internal";
import { accessView } from "../access.js";
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
  /** Each move the apply or the undo makes is recorded in the history (.specs/features/cerebro-memoria-confiavel, AC 22). */
  const moves = () => {
    const e = { db: ctx.db, ...env() };
    return {
      ...e,
      indexer: ctx.indexer,
      history: { moved: (from: string, to: string) => recordMove(e, from, to, "owner") },
    };
  };

  /** What a scope holds, from the index rows alone (AC 1 to AC 5). */
  bind(app, "memory.cleanup.inventory", async ({ query }, req) => {
    // The caller's view of the settings: no folder, count or group from a folder hidden from it (door 12).
    const seen = { paths: ctx.paths, settings: accessView(ctx, req.principal).settings };
    const scope = resolveCleanupScope(seen, { context: query.context, dir: query.dir });
    return cleanupInventory(ctx.db, seen, scope);
  });

  /** Start a scan (AC 7, AC 15): `202` with its id; the progress goes on the bus as `cleanup.*`. */
  bind(app, "memory.cleanup.scans.start", async ({ body }, _req, reply) => {
    const scanId = ctx.cleanup.start({ context: body.context, dir: body.dir });
    reply.code(202);
    return { scanId };
  });

  bind(app, "memory.cleanup.scans.get", async ({ params: { id } }, req) => {
    const scan = ctx.cleanup.get(id);
    if (!scan) throw httpError(404, `No cleanup scan is called ${id}.`, "not_found");
    const { scopeKey: _key, ...view } = scan;
    // A scan is the owner's, over every file. A device is told of its findings as if the folders hidden from it were not
    // there (cerebro-memoria-confiavel, door 12): a finished scan's findings are worked out again over the device's view
    // (a link into a hidden note is a link that leads nowhere, a note only a hidden one links to is an orphan); while
    // it runs, no finding that names a file it may not be told of.
    const access = accessView(ctx, req.principal);
    if (access.audience === null) return view;
    if (view.status === "finished") {
      const seen = { paths: ctx.paths, settings: access.settings };
      const request = view.scope.kind === "dir" ? { dir: view.scope.path } : { context: view.scope.id };
      const again = await scanCleanupScope(ctx.db, seen, resolveCleanupScope(seen, request));
      return { ...view, findings: again.findings, decided: again.decided };
    }
    const told = (p: string | undefined) => p === undefined || access.allowsPath(p);
    return {
      ...view,
      findings: view.findings.filter(
        (f) => f.files.every((file) => told(file.path)) && told(f.detail.target) && told(f.detail.folder),
      ),
    };
  });

  /** The owner's answers to findings of the newest scan of a scope (AC 19 to AC 22, AC 25). */
  bind(app, "memory.cleanup.decisions", async ({ body }) =>
    saveCleanupDecisions(ctx.db, cleanupScanFor(ctx.cleanup, body.scanId, "decide"), body.decisions),
  );

  /** Move what was marked under memory/ to the archive, and list what lies outside it (AC 27 to AC 31). */
  bind(app, "memory.cleanup.apply", async ({ body }) => {
    const scan = cleanupScanFor(ctx.cleanup, body.scanId, "apply");
    return applyCleanup(moves(), scan);
  });

  /** Move back what an apply archived, by its manifest (AC 32, AC 34). */
  bind(app, "memory.cleanup.undo", async ({ body }) => undoCleanup(moves(), body.manifest));
}

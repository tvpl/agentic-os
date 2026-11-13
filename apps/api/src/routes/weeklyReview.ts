import type { FastifyInstance } from "fastify";
import {
  archiveWeek,
  decideLoop,
  findContext,
  finishWeek,
  recordFileVersion,
  recordMove,
  weeklyReview,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

/** How long a decision that wrote a note waits for the index pass over it before it answers anyway (the pass goes on). */
const INDEX_WAIT_MS = 2_000;

/**
 * The weekly review (.specs/features/cerebro-rituais, doors 1 to 5): the list, the owner's decision on one open loop, the
 * week's archive and its finish. The rules are the core's (`core/src/memory/weeklyReview.ts`, `loops.ts`). Owner only
 * (door 2).
 */
export function registerWeeklyReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The context a query or a body names: null for none or `all`, `400 validation` for an id that names none (G26). */
  const contextOf = (value: string | undefined) => {
    const context = findContext(ctx.settings(), value);
    if (context === undefined) throw httpError(400, `No work context is called ${value}.`, "validation");
    return context;
  };

  bind(app, "memory.weeklyReview.list", async ({ query: q }) => {
    const context = contextOf(q.context);
    return weeklyReview({ db: ctx.db, paths: ctx.paths, settings: ctx.settings() }, { context });
  });

  /** Wait for the index pass over these paths, up to `INDEX_WAIT_MS` (the pass goes on), so the next list reads it. */
  const indexed = async (paths: string[]) => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      ctx.indexer.requestIndexPaths(paths).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, INDEX_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  };

  /** Each move is recorded in the history, as the cleanup's (.specs/features/cerebro-memoria-confiavel, AC 22). */
  bind(app, "memory.weeklyReview.archive", async ({ body }) => {
    const env = { db: ctx.db, paths: ctx.paths, settings: ctx.settings() };
    // From the check of the paths to the count of the week, nothing waits: two calls naming one file move it once.
    const result = archiveWeek(
      { ...env, indexer: ctx.indexer, history: { moved: (from, to) => recordMove(env, from, to, "owner") } },
      body,
    );
    if (result.moved.length > 0) await indexed(result.moved.flatMap((m) => [m.from, m.to]));
    return result;
  });

  bind(app, "memory.weeklyReview.finish", async ({ body }) => {
    const result = finishWeek({ db: ctx.db, paths: ctx.paths, settings: ctx.settings() }, body);
    ctx.indexer.requestIndexPaths([result.journal.path]).catch(() => undefined);
    return result;
  });

  bind(app, "memory.weeklyReview.loops", async ({ body }) => {
    const context = contextOf(body.context);
    const settings = ctx.settings();
    const history = (
      file: string,
      bytes: Uint8Array | string,
      origin: "create" | "save" | "properties" | "task",
    ) => {
      recordFileVersion({ db: ctx.db, paths: ctx.paths, settings }, file, bytes, "owner", origin);
    };
    const result = decideLoop({ db: ctx.db, paths: ctx.paths, settings, history }, { ...body, context });
    if (result.created) {
      // The next list reads the project's new task or the new note from the index.
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        ctx.indexer.requestIndexPaths([result.created.path]).catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, INDEX_WAIT_MS);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
    }
    return result;
  });
}

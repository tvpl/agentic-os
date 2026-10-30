import type { FastifyInstance } from "fastify";
import {
  classifyNotePath,
  decideReview,
  parseEscopoList,
  parseNaturezaList,
  reviewsDue,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { requireContext } from "./contexts.js";

/** How long a decision waits for the index pass over its path before it answers anyway (the pass goes on). */
const INDEX_WAIT_MS = 2_000;

/**
 * The periodic reviews (.specs/features/cerebro-natureza, doors 4 to 6): the queue of what fell due, and the owner's
 * decision on one file. The rules are the core's (`core/src/memory/reviews.ts`, `reviewDecisions.ts`).
 */
export function registerReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  const env = () => ({ paths: ctx.paths, settings: ctx.settings() });

  /** What fell due, or what has no nature (AC 17 to AC 23, AC 46). Reads the settings at each request (C39). */
  bind(app, "memory.reviews.list", async ({ query: q }) => {
    const context = requireContext(ctx, q.context);
    const notes = env();
    const editable = (file: string): boolean => {
      try {
        return classifyNotePath(notes, file).editable;
      } catch {
        return false;
      }
    };
    return reviewsDue(
      ctx.db,
      { ...notes, editable },
      {
        kind: q.kind ?? "due",
        context,
        ...(q.natureza !== undefined ? { natureza: parseNaturezaList(q.natureza)! } : {}),
        ...(q.escopo !== undefined ? { escopo: parseEscopoList(q.escopo)! } : {}),
        ...(q.limit !== undefined ? { limit: q.limit } : {}),
      },
    );
  });

  /**
   * One decision (AC 27 to AC 36). The answer waits, up to `INDEX_WAIT_MS`, for the pass over that one path, so that the
   * next list reads the note as it now is (AC 36).
   */
  bind(app, "memory.reviews.decide", async ({ body }) => {
    const result = decideReview({ db: ctx.db, ...env() }, body);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      ctx.indexer.requestIndexPaths([result.path]).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, INDEX_WAIT_MS);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    return result;
  });
}

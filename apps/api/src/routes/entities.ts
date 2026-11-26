import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CorrectionError,
  correctionItem,
  entityDetail,
  listEntities,
  writeCorrection,
} from "@mordomo/core/internal";
import { accessView, type AccessView } from "../access.js";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";
import { contextFilter } from "./contexts.js";
import { recordAgentRead } from "./memory.js";
import { findSuggestion } from "./suggestions.js";

/** The entities of an audience, cached by who reads and what is hidden from them (door 2; the recall's graph, door 5). */
export const entityView = (ctx: AppContext, view: AccessView): ReturnType<AppContext["entities"]["read"]> =>
  ctx.entities.read(
    `${view.audience ?? "owner"}\u0000${JSON.stringify(view.settings.excludes)}`,
    view.rowFilter(),
    // the owner's accepted names list with no mention; any other audience reads one only through a mention
    view.audience !== null,
  );

/**
 * The entities of the second brain (.specs/features/cerebro-entidades-resumos, doors 2 to 4): the list and one entity,
 * read by the caller's audience (the owner, a paired device, a run's credential and the principal `mcp` each over the
 * files it reads, `accessView`), and the owner's corrections. With `memory.entities.enabled` off, each answers `409
 * entities_disabled`.
 */
export function registerEntityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const enabled = () => {
    if (!ctx.settings().memory.entities.enabled) {
      throw httpError(409, "The entities are off (memory.entities.enabled).", "entities_disabled");
    }
  };
  const viewOf = (view: AccessView) => entityView(ctx, view);
  /** The files of a work context, by id (AC 31); undefined for none, `404 context_not_found` for an unknown id. */
  const withinOf = (view: AccessView, context: string | undefined) => {
    const inside = contextFilter(ctx, context, view.settings);
    if (!inside) return undefined;
    const rows = ctx.db.prepare("SELECT id, root, rel FROM files").all() as Array<{
      id: number;
      root: string;
      rel: string;
    }>;
    const ids = new Set(rows.filter((r) => inside(r)).map((r) => r.id));
    return (fileId: number) => ids.has(fileId);
  };
  const owner = (req: FastifyRequest) => viewOf(accessView(ctx, req.principal));

  bind(app, "memory.entities.list", async ({ query: q }, req) => {
    enabled();
    const view = accessView(ctx, req.principal);
    const inContext = withinOf(view, q.context);
    // `file` (Landing 8a): the mentions of that one file, within the context when both are given.
    const within =
      q.file === undefined
        ? inContext
        : (fileId: number) => fileId === q.file && (inContext === undefined || inContext(fileId));
    return listEntities(viewOf(view), { ...q, within });
  });

  bind(app, "memory.entities.get", async ({ params: { key }, query: q }, req) => {
    enabled();
    const view = accessView(ctx, req.principal);
    const detail = entityDetail(ctx.db, viewOf(view), key, withinOf(view, q.context));
    if (!detail) throw httpError(404, "The entity does not exist.", "not_found");
    // An agent's read (the tool `entity`, or a run's credential) counts once, with each file it was given a mention of.
    recordAgentRead(
      ctx,
      req,
      "entity",
      detail.mentions.map((m) => m.path),
    );
    return detail;
  });

  bind(app, "memory.entities.corrections", async ({ body }, req) => {
    enabled();
    let written;
    try {
      // `accept` and `reject` name a suggestion as today's check lets it through (door 10).
      written = writeCorrection(ctx.db, owner(req), body, Date.now(), (id) => findSuggestion(ctx, id));
    } catch (error) {
      if (!(error instanceof CorrectionError)) throw error;
      switch (error.reason) {
        case "validation":
          throw httpError(400, error.message, "validation");
        case "not_found":
          throw httpError(404, error.message, "not_found");
        case "correction_conflict":
          throw httpError(409, error.message, "correction_conflict");
        case "too_many_corrections":
          throw httpError(409, error.message, "too_many_corrections");
      }
    } finally {
      ctx.entities.invalidate();
    }
    const { id, action, names, createdAt } = correctionItem(written);
    const after = owner(req);
    const entity =
      body.key !== undefined
        ? (after.byKey.get(body.key) ?? after.byNorm.get(written.a))
        : after.byNorm.get(written.a);
    return {
      correction: { id, action, names, createdAt },
      ...(entity
        ? {
            entity: {
              key: entity.key,
              kind: entity.kind,
              name: entity.name,
              aliases: entity.aliases,
              files: entity.files,
              mentions: entity.mentions,
            },
          }
        : {}),
    };
  });
}

/** Work contexts (.specs/features/cerebro-contextos): a named scope over the indexed folders and the notes. */
import { z } from "zod";
import { CONTEXT_ID, CONTEXT_LIMITS, ContextNameSchema, isAbsolutePath } from "../workContext.js";
import { IdParams, err, settingsWriteErrors } from "./common.js";
import { route } from "./route.js";

// ---- schemas ---------------------------------------------------------------------------------------------------

/** `ok`; `missing`: the folder no longer exists; `not_indexed`: it exists and is no longer inside an enabled indexed folder or `memory/`, or the policy hides it. */
export const CONTEXT_PATH_STATES = ["ok", "missing", "not_indexed"] as const;

export const ContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** In the order the owner gave them; the first is the main one. */
  paths: z.array(z.object({ path: z.string(), state: z.enum(CONTEXT_PATH_STATES) })),
  /** `memory/notes/<id>/`, the context's own notes (it may not exist yet). */
  notesDir: z.string(),
  /** `memory/notes/<id>/_resumo.md` when it exists, else `null`. */
  brief: z.string().nullable(),
  /** `memory/contexts/<id>.md`, the map the routers generate. */
  map: z.string(),
  /** Indexed rows that belong to the context: their real path is a real path of an `ok` path, or below it. */
  files: z.number(),
});

const ContextPaths = z
  .array(z.string().min(1).max(4096).refine(isAbsolutePath, "a context path is absolute"))
  .min(1)
  .max(CONTEXT_LIMITS.paths);

/** The `context` of a read: a context's `id`, or `all` for the whole index. */
export const ContextQuery = z.string().min(1).max(64).optional();

export const contextNotFound = err(404, "context_not_found", "The context names no work context");

/** None of a work context's paths is `ok`: there is no folder to write into or to start a run in. */
export const contextUnavailable = err(
  409,
  "context_unavailable",
  "None of the work context's paths is ok: there is no folder to write into",
);

/**
 * The `contextId` of a run request (.specs/features/cerebro-contextos, door 3): the id of a work context. Any text up to
 * 64 characters, so an id that names no context is `404 context_not_found` rather than a validation error.
 */
export const ContextIdField = z.string().min(1).max(64).optional();

const pathNotIndexed = err(
  400,
  "context_path_not_indexed",
  "A path is not a folder inside an enabled indexed folder or memory/, today's policy hides it, or it holds a link into the home's config/ or logs/",
);

// ---- routes ----------------------------------------------------------------------------------------------------

export const contextRoutes = {
  "contexts.list": route({
    method: "GET",
    path: "/api/contexts",
    summary:
      "The work contexts, with the state of each path and the number of indexed files that belong to each",
    tag: "contexts",
    scope: "content",
    responses: { 200: z.object({ contexts: z.array(ContextSchema) }) },
  }),
  "contexts.create": route({
    method: "POST",
    path: "/api/contexts",
    summary: "Create a work context; without an id it is made from the name, with -2 to -99 when it is taken",
    tag: "contexts",
    scope: "owner",
    body: z.object({
      name: ContextNameSchema,
      paths: ContextPaths,
      id: z.string().regex(CONTEXT_ID).optional(),
    }),
    responses: { 201: ContextSchema },
    errors: [
      pathNotIndexed,
      err(409, "context_exists", "The id given is taken, or ninety-nine contexts already have the name"),
      ...settingsWriteErrors,
    ],
  }),
  "contexts.update": route({
    method: "PATCH",
    path: "/api/contexts/:id",
    summary: "Rename a work context or change its paths; the id never changes",
    tag: "contexts",
    scope: "owner",
    params: IdParams,
    body: z.object({ name: ContextNameSchema.optional(), paths: ContextPaths.optional() }),
    responses: { 200: ContextSchema },
    errors: [pathNotIndexed, contextNotFound, ...settingsWriteErrors],
  }),
  "contexts.delete": route({
    method: "DELETE",
    path: "/api/contexts/:id",
    summary: "Delete a work context and its map; its notes in memory/notes/<id>/ stay where they are",
    tag: "contexts",
    scope: "owner",
    params: IdParams,
    responses: { 200: z.object({ deleted: z.literal(true), id: z.string() }) },
    errors: [contextNotFound, ...settingsWriteErrors],
  }),
} as const;

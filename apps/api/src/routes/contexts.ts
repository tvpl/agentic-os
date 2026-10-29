import type { FastifyInstance } from "fastify";
import type { Settings } from "@mordomo/core";
import {
  changedContext,
  contextMembership,
  describeContexts,
  findContext,
  newContext,
  removeContextMap,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

type WorkContext = Settings["contexts"][number];

/** The rules of a context read the settings as they are now. */
const envOf = (ctx: AppContext, settings: Settings = ctx.settings()) => ({ paths: ctx.paths, settings });

/**
 * The work context a read names (`context=<id>`; `all` or nothing is the whole index): the test that keeps its files
 * (door 6), `undefined` for the whole index, `404 context_not_found` for an id that names none.
 */
export function contextFilter(
  ctx: AppContext,
  value: string | undefined,
): ((row: { root: string; rel: string }) => boolean) | undefined {
  const context = requireContext(ctx, value);
  return context ? contextMembership(envOf(ctx), context) : undefined;
}

/** The context `value` names, `null` for the whole index, `404 context_not_found` for an id that names none. */
export function requireContext(ctx: AppContext, value: string | undefined): WorkContext | null {
  const context = findContext(ctx.settings(), value);
  if (context === undefined) throw httpError(404, `No work context is called ${value}.`, "context_not_found");
  return context;
}

export function registerContextRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "contexts.list", async () => ({ contexts: describeContexts(ctx.db, envOf(ctx)) }));

  bind(app, "contexts.create", async ({ body }, _req, reply) => {
    let created: WorkContext | null = null;
    // Read-modify-write in one step of the store: the rules see the contexts the save replaces.
    const saved = ctx.settingsStore.update((current) => {
      created = newContext(envOf(ctx, current), body);
      return { contexts: [...current.contexts, created] };
    });
    reply.code(201);
    return describeContexts(ctx.db, envOf(ctx, saved), created!)[0]!;
  });

  bind(app, "contexts.update", async ({ params: { id }, body }) => {
    let changed: WorkContext | null = null;
    const saved = ctx.settingsStore.update((current) => {
      const next = changedContext(envOf(ctx, current), id, body);
      changed = next;
      return { contexts: current.contexts.map((c) => (c.id === id ? next : c)) };
    });
    return describeContexts(ctx.db, envOf(ctx, saved), changed!)[0]!;
  });

  bind(app, "contexts.delete", async ({ params: { id } }) => {
    ctx.settingsStore.update((current) => {
      if (!current.contexts.some((c) => c.id === id)) {
        throw httpError(404, `No work context is called ${id}.`, "context_not_found");
      }
      return { contexts: current.contexts.filter((c) => c.id !== id) };
    });
    // The map goes with the context; its notes (memory/notes/<id>/) stay where they are.
    removeContextMap(ctx.paths, id);
    const prefs = ctx.uiPreferences.load();
    if (prefs.activeContext === id) ctx.uiPreferences.save({ ...prefs, activeContext: null });
    return { deleted: true as const, id };
  });
}

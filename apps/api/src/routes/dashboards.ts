import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";

/**
 * The dashboards (.specs/features/cerebro-paineis, door 6): the reads are `content`, every write is the owner's. The
 * rules are the core's (`core/src/dashboards/`); a `GET` reads no source, and a stale snapshot is refreshed after the
 * answer is sent.
 */
export function registerDashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  const dashboards = ctx.dashboards;

  bind(app, "dashboards.list", async () => dashboards.list());

  bind(app, "dashboards.create", async ({ body }, _req, reply) => {
    const created = dashboards.create(body);
    reply.code(201);
    return created;
  });

  bind(app, "dashboards.get", async ({ params: { id }, query: { since } }) => {
    const found = dashboards.get(id, Date.now(), since);
    if (found.stale) {
      // Answer with the stored snapshot, then refresh (amendment 13): the refresh starts after this answer is made.
      setImmediate(() => dashboards.refreshIfStale(id));
    }
    return {
      definition: found.definition,
      version: found.version,
      snapshot: found.snapshot,
      stale: found.stale,
      highlights: found.highlights,
    };
  });

  bind(
    app,
    "dashboards.update",
    async ({ params: { id }, body }) => {
      const saved = dashboards.update(id, body.definition, body.baseVersion);
      return { definition: saved.definition, version: saved.version };
    },
    {
      // A dashboard that does not exist is a 404 before its body is read, and nothing is created.
      precheck: ({ params: { id } }) => {
        dashboards.store.require(id);
      },
    },
  );

  bind(app, "dashboards.delete", async ({ params: { id } }) => ({ archived: dashboards.archive(id) }));

  bind(app, "dashboards.refresh", async ({ params: { id } }) => ({
    snapshot: await dashboards.refresh(id, { fresh: true }),
  }));
}

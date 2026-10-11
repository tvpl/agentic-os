import type { FastifyInstance } from "fastify";
import {
  ConnectorDataCache,
  ConnectorSchema,
  fetchConnectorData,
  homeConfigFilesOf,
  runAudit,
  setupChecklist,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

export function registerConnectorRoutes(app: FastifyInstance, ctx: AppContext): void {
  // One cache per server process; the TTL comes from settings at read time.
  const cache = new ConnectorDataCache(ctx.settings().connectors.dataCacheTtlMs);

  bind(app, "connectors.list", async () => ctx.connectors.list());

  bind(app, "connectors.audit", async () =>
    runAudit(ctx.connectors, undefined, homeConfigFilesOf(ctx.providers.manifests())),
  );

  /**
   * Read-only connector data (F-BACKEND item 27): today's calendar, recent
   * mail, … Never writes; the client refuses any tool outside the connector's
   * declared read mapping. `?refresh=1` bypasses the 5-minute TTL cache.
   */
  bind(app, "connectors.data", async ({ params: { id }, query: { refresh } }) => {
    const connector = ctx.connectors.get(id);
    if (!connector) throw httpError(404, "Connector not found");
    const settings = ctx.settings();
    const data = await cache.read(
      id,
      () =>
        fetchConnectorData(connector, {
          allowedCommands: settings.connectors.allowedCommands,
          timeoutMs: settings.connectors.dataTimeoutMs,
          cwd: ctx.paths.home,
          tz: settings.timezone,
        }),
      refresh === "1" || refresh === "true",
    );
    // A successful read is a use: record it so the registry shows freshness.
    if (data.status === "ok" && connector.lastUsedAt !== data.syncedAt) {
      try {
        ctx.connectors.save({
          ...connector,
          lastUsedAt: data.syncedAt,
          status: connector.status === "not_configured" ? "configured" : connector.status,
        });
      } catch {
        /* the read succeeded; a bookkeeping failure must not fail the request */
      }
    }
    return data;
  });

  /** The setup checklist alone (install command, env var NAMES, allowlist step) — never any secret value. */
  bind(app, "connectors.setup", async ({ params: { id } }) => {
    const connector = ctx.connectors.get(id);
    if (!connector) throw httpError(404, "Connector not found");
    return {
      id,
      steps: setupChecklist(connector, { allowedCommands: ctx.settings().connectors.allowedCommands }),
    };
  });

  bind(
    app,
    "connectors.update",
    async ({ params: { id }, body }) => {
      const existing = ctx.connectors.get(id)!;
      // The id in the URL names the connector; the body may leave its own out.
      const updated = ConnectorSchema.parse({ ...body, id });
      cache.invalidate(id);

      // Enabling write operations on a connector is always approval-gated.
      if (updated.writeEnabled && !existing.writeEnabled) {
        const approval = ctx.approvals.request(
          "connector_write",
          `Enable WRITE operations for connector "${existing.name}" (${existing.writeOperations.join(", ") || "unspecified"}).`,
          { connectorId: id },
        );
        return {
          connector: ctx.connectors.save({ ...updated, writeEnabled: false }),
          pendingApproval: approval,
        };
      }
      return { connector: ctx.connectors.save(updated), pendingApproval: null };
    },
    {
      // The connector is looked for before the body is read, as it always was.
      precheck: ({ params: { id } }) => {
        if (!ctx.connectors.get(id)) throw httpError(404, "Connector not found");
      },
    },
  );

  bind(app, "connectors.create", async ({ body: connector }) => {
    if (ctx.connectors.get(connector.id)) throw httpError(409, `Connector "${connector.id}" already exists`);
    // New connectors always start not-configured with writes off.
    return ctx.connectors.save({ ...connector, status: "not_configured", writeEnabled: false });
  });

  bind(app, "connectors.delete", async ({ params: { id } }) => {
    if (!ctx.connectors.remove(id)) throw httpError(404, "Connector not found");
    cache.invalidate(id);
    return { deleted: id };
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ConnectorDataCache,
  ConnectorSchema,
  fetchConnectorData,
  runAudit,
  setupChecklist,
} from "@mordomo/core";
import type { AppContext } from "../context.js";
import { httpError } from "./common.js";
import { IdParams } from "./params.js";

const DataQuery = z.object({ refresh: z.string().optional() });

export function registerConnectorRoutes(app: FastifyInstance, ctx: AppContext): void {
  // One cache per server process; the TTL comes from settings at read time.
  const cache = new ConnectorDataCache(ctx.settings().connectors.dataCacheTtlMs);

  app.get("/api/connectors", async () => ctx.connectors.list());

  app.get("/api/connectors/audit", async () =>
    runAudit(ctx.connectors, undefined, [
      ...new Set(ctx.providers.manifests().flatMap((m) => m.homeConfigFiles)),
    ]),
  );

  /**
   * Read-only connector data (F-BACKEND item 27): today's calendar, recent
   * mail, … Never writes; the client refuses any tool outside the connector's
   * declared read mapping. `?refresh=1` bypasses the 5-minute TTL cache.
   */
  app.get("/api/connectors/:id/data", async (req) => {
    const { id } = IdParams.parse(req.params);
    const { refresh } = DataQuery.parse(req.query ?? {});
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
  app.get("/api/connectors/:id/setup", async (req) => {
    const { id } = IdParams.parse(req.params);
    const connector = ctx.connectors.get(id);
    if (!connector) throw httpError(404, "Connector not found");
    return {
      id,
      steps: setupChecklist(connector, { allowedCommands: ctx.settings().connectors.allowedCommands }),
    };
  });

  app.put("/api/connectors/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const existing = ctx.connectors.get(id);
    if (!existing) throw httpError(404, "Connector not found");
    const updated = ConnectorSchema.parse({ ...(req.body as object), id });
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
  });

  app.post("/api/connectors", async (req) => {
    const connector = ConnectorSchema.parse(req.body);
    if (ctx.connectors.get(connector.id)) throw httpError(409, `Connector "${connector.id}" already exists`);
    // New connectors always start not-configured with writes off.
    return ctx.connectors.save({ ...connector, status: "not_configured", writeEnabled: false });
  });

  app.delete("/api/connectors/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!ctx.connectors.remove(id)) throw httpError(404, "Connector not found");
    cache.invalidate(id);
    return { deleted: id };
  });
}

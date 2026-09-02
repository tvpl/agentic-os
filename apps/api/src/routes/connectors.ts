import type { FastifyInstance } from "fastify";
import { ConnectorSchema, runAudit } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { httpError } from "./common.js";
import { IdParams } from "./params.js";

export function registerConnectorRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/connectors", async () => ctx.connectors.list());

  app.get("/api/connectors/audit", async () => runAudit(ctx.connectors));

  app.put("/api/connectors/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const existing = ctx.connectors.get(id);
    if (!existing) throw httpError(404, "Connector not found");
    const updated = ConnectorSchema.parse({ ...(req.body as object), id });

    // Enabling write operations on a connector is always approval-gated.
    if (updated.writeEnabled && !existing.writeEnabled) {
      const approval = ctx.approvals.request(
        "connector_write",
        `Enable WRITE operations for connector "${existing.name}" (${existing.writeOperations.join(", ") || "unspecified"}).`,
        { connectorId: id },
      );
      return { connector: ctx.connectors.save({ ...updated, writeEnabled: false }), pendingApproval: approval };
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
    return { deleted: id };
  });
}

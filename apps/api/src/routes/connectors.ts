import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ConnectorSchema, runAudit } from "@mordomo/core";
import type { AppContext } from "../context.js";

export function registerConnectorRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/connectors", async () => ctx.connectors.list());

  app.get("/api/connectors/audit", async () => runAudit(ctx.connectors));

  app.put("/api/connectors/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const existing = ctx.connectors.get(id);
    if (!existing) throw Object.assign(new Error("Connector not found"), { statusCode: 404 });
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
    if (ctx.connectors.get(connector.id)) {
      throw Object.assign(new Error(`Connector "${connector.id}" already exists`), { statusCode: 409 });
    }
    // New connectors always start not-configured with writes off.
    return ctx.connectors.save({ ...connector, status: "not_configured", writeEnabled: false });
  });

  app.delete("/api/connectors/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!ctx.connectors.remove(id)) throw Object.assign(new Error("Connector not found"), { statusCode: 404 });
    return { deleted: id };
  });
}

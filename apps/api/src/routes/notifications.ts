import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { httpError } from "./common.js";

/**
 * The persisted inbox (Onda 2). Rows are written by the recorder that listens
 * on the event bus (approvals, failed runs, routine alerts, budget crossings);
 * the Command Centre seeds its feed from here on load and reports reads back,
 * so closing the tab no longer loses what needs attention.
 *
 * The inbox is one list, the owner's: a paired device reads it (`monitor`) but does not clear it. Marking read and
 * deleting change what the owner finds when they open it, so both are the owner's (escopos-dispositivo, round 1); the
 * Command Centre on a device marks rows read on that screen and lets the server's refusal pass.
 */
const IdParams = z.object({ id: z.string().regex(/^n_[0-9a-f-]{8,64}$/i) });

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/notifications", { config: { scope: "monitor" } }, async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        unread: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    return {
      items: ctx.notifications.list({ limit: q.limit, unreadOnly: q.unread === true }),
      unread: ctx.notifications.unreadCount(),
    };
  });

  app.post("/api/notifications/read", { config: { scope: "owner" } }, async (req) => {
    const body = z
      .object({
        ids: z
          .array(z.string().regex(/^n_[0-9a-f-]{8,64}$/i))
          .max(500)
          .optional(),
        all: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    if (body.all) return { updated: ctx.notifications.markAllRead() };
    if (!body.ids || body.ids.length === 0) throw httpError(400, "Pass ids or all: true");
    return { updated: ctx.notifications.markRead(body.ids) };
  });

  app.delete("/api/notifications/:id", { config: { scope: "owner" } }, async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!ctx.notifications.delete(id)) throw httpError(404, "Notification not found");
    return { deleted: true };
  });
}

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
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
export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "notifications.list", async ({ query: q }) => {
    return {
      items: ctx.notifications.list({ limit: q.limit, unreadOnly: q.unread === true }),
      unread: ctx.notifications.unreadCount(),
    };
  });

  bind(app, "notifications.read", async ({ body }) => {
    if (body.all) return { updated: ctx.notifications.markAllRead() };
    if (!body.ids || body.ids.length === 0) throw httpError(400, "Pass ids or all: true");
    return { updated: ctx.notifications.markRead(body.ids) };
  });

  bind(app, "notifications.delete", async ({ params: { id } }) => {
    if (!ctx.notifications.delete(id)) throw httpError(404, "Notification not found");
    return { deleted: true as const };
  });
}

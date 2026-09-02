import type { FastifyInstance } from "fastify";
import { events, type OsEvent } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { lastEventId, openSse } from "./sse.js";

/**
 * `GET /api/events` — one SSE feed over the process event bus (runs, routines,
 * indexing, approvals, settings, backups). Clients resume with `Last-Event-ID`
 * (or `?since=<id>`); events still in the bus ring buffer are replayed.
 * Token auth is enforced by the global onRequest hook (`?token=` accepted).
 */
export function registerEventRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get("/api/events", async (req, reply) => {
    const since = lastEventId(req);
    const ch = openSse(req, reply);
    // Without a resume point nothing is replayed: start after the current id.
    let seen = since ?? events.lastId;
    const push = (e: OsEvent) => {
      if (e.id <= seen) return; // already sent (replay/live overlap)
      seen = e.id;
      ch.send({ id: e.id, event: e.type, data: e });
    };
    // Subscribe before replaying so nothing emitted in between is lost.
    ch.onClose(events.subscribe(push));
    for (const e of events.since(seen)) push(e);
    ch.comment(`connected lastEventId=${events.lastId}`);
    return reply;
  });
}

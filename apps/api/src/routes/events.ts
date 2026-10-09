import type { FastifyInstance } from "fastify";
import { OS_EVENT_VERSION, events, type OsEvent } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { lastEventId, openSse } from "./sse.js";

/**
 * `GET /api/events` — one SSE feed over the process event bus (runs, routines,
 * indexing, approvals, settings, backups). Clients resume with `Last-Event-ID`
 * (or `?since=<id>`); events still in the bus ring buffer are replayed. Event ids
 * restart with the process, so a resume point ahead of the last id belongs to a
 * previous process: the first frame is then `stream.reset` and the whole ring
 * is replayed, instead of silently dropping every event up to that old id.
 * Token auth is enforced by the global onRequest hook (`?token=` accepted).
 */
export function registerEventRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get("/api/events", { config: { queryToken: true } }, async (req, reply) => {
    const since = lastEventId(req);
    const ch = openSse(req, reply);
    const stale = since !== null && since > events.lastId;
    if (stale) {
      // Not emitted on the bus: it concerns this connection only. Its `id:` moves the
      // browser's resume point to this process's range.
      const reset: OsEvent<"stream.reset"> = {
        id: events.lastId,
        type: "stream.reset",
        ts: Date.now(),
        v: OS_EVENT_VERSION,
        payload: { lastId: events.lastId },
      };
      ch.send({ id: reset.id, event: reset.type, data: reset });
    }
    // Without a resume point nothing is replayed: start after the current id.
    let seen = stale ? 0 : (since ?? events.lastId);
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

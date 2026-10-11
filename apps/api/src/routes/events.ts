import type { FastifyInstance } from "fastify";
import type { OsEvent } from "@mordomo/core";
import { OS_EVENT_VERSION } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { ticketKey } from "../tickets.js";
import { httpError } from "./common.js";
import { lastEventId, openSse } from "./sse.js";

/**
 * `GET /api/events` — one SSE feed over the engine's event bus (runs, routines,
 * indexing, approvals, settings, backups). Clients resume with `Last-Event-ID`
 * (or `?since=<id>`); events still in the bus ring buffer are replayed. Event ids
 * restart with the process, so a resume point ahead of the last id belongs to a
 * previous process: the first frame is then `stream.reset` and the whole ring
 * is replayed, instead of silently dropping every event up to that old id.
 * Auth is enforced by the global onRequest hook: the owner's `?token=` or a stream ticket (`?ticket=`, minted by
 * `POST /api/stream-tickets` below); a device's token is not accepted in the URL.
 */
export function registerEventRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * A one-use ticket (30 s) to open `GET /api/events` or one run's stream, for a client that cannot send a header
   * (`EventSource`). It carries the principal that asked, so the stream is judged as that principal, and it opens
   * only the stream it was asked for (door 5 of `.specs/features/escopos-dispositivo`).
   */
  bind(app, "streams.ticket", async ({ body }, req) => {
    const key =
      body.target === "events"
        ? ticketKey("/api/events", {})
        : ticketKey("/api/runs/:id/stream", { id: body.runId });
    const minted = req.principal ? ctx.streamTickets.mint(req.principal, key) : null;
    if (!minted) {
      throw httpError(429, "Too many stream tickets are waiting to be used", "too_many_requests");
    }
    return minted;
  });

  bind(app, "events.stream", async (_call, req, reply) => {
    const since = lastEventId(req);
    const ch = openSse(req, reply);
    const stale = since !== null && since > ctx.events.lastId;
    if (stale) {
      // Not emitted on the bus: it concerns this connection only. Its `id:` moves the
      // browser's resume point to this process's range.
      const reset: OsEvent<"stream.reset"> = {
        id: ctx.events.lastId,
        type: "stream.reset",
        ts: Date.now(),
        v: OS_EVENT_VERSION,
        payload: { lastId: ctx.events.lastId },
      };
      ch.send({ id: reset.id, event: reset.type, data: reset });
    }
    // Without a resume point nothing is replayed: start after the current id.
    let seen = stale ? 0 : (since ?? ctx.events.lastId);
    const push = (e: OsEvent) => {
      if (e.id <= seen) return; // already sent (replay/live overlap)
      seen = e.id;
      ch.send({ id: e.id, event: e.type, data: e });
    };
    // Subscribe before replaying so nothing emitted in between is lost.
    ch.onClose(ctx.events.subscribe(push));
    for (const e of ctx.events.since(seen)) push(e);
    ch.comment(`connected lastEventId=${ctx.events.lastId}`);
    return reply;
  });
}

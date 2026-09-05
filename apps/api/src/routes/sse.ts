import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Server-Sent Events helper shared by `/api/events` and `/api/runs/:id/stream`.
 * - `reply.hijack()` so Fastify stops managing the response lifecycle;
 * - `id:` lines so browsers resume with `Last-Event-ID`;
 * - a heartbeat comment every 15 s keeps proxies and idle sockets alive;
 * - cleanup callbacks run exactly once, on client close or explicit end;
 * - every open channel is tracked so `closeAllSse()` (server shutdown) can
 *   end them instead of leaving `app.close()` waiting on live connections.
 */

export interface SseFrame {
  id?: number | string;
  event?: string;
  data: unknown;
}

export interface SseChannel {
  send(frame: SseFrame): void;
  comment(text: string): void;
  end(): void;
  onClose(fn: () => void): void;
  readonly closed: boolean;
}

const OPEN_CHANNELS = new Set<SseChannel>();

export function closeAllSse(): void {
  for (const ch of [...OPEN_CHANNELS]) ch.end();
}

/** `Last-Event-ID` header, or `?since=` query, as a non-negative integer. */
export function lastEventId(req: FastifyRequest): number | null {
  const header = req.headers["last-event-id"];
  const query = (req.query as Record<string, string | undefined> | undefined)?.since;
  const raw = (Array.isArray(header) ? header[0] : header) ?? query;
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function openSse(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { heartbeatMs?: number } = {},
): SseChannel {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    // Security headers are normally added by the onSend hook, which a hijacked
    // reply bypasses.
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  raw.flushHeaders?.();

  let closed = false;
  const cleanups: Array<() => void> = [];
  const heartbeat = setInterval(() => {
    if (!closed) raw.write(`: ping ${Date.now()}\n\n`);
  }, opts.heartbeatMs ?? 15_000);
  heartbeat.unref?.();

  const runCleanups = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    OPEN_CHANNELS.delete(channel);
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* cleanup must never throw into the stream */
      }
    }
  };

  const channel: SseChannel = {
    get closed() {
      return closed;
    },
    send(frame) {
      if (closed) return;
      let out = "";
      if (frame.id !== undefined) out += `id: ${frame.id}\n`;
      if (frame.event) out += `event: ${frame.event}\n`;
      out += `data: ${JSON.stringify(frame.data)}\n\n`;
      raw.write(out);
    },
    comment(text) {
      if (!closed) raw.write(`: ${text.replace(/\r?\n/g, " ")}\n\n`);
    },
    end() {
      if (closed) return;
      runCleanups();
      try {
        raw.end();
      } catch {
        /* socket already gone */
      }
    },
    onClose(fn) {
      if (closed) fn();
      else cleanups.push(fn);
    },
  };
  OPEN_CHANNELS.add(channel);
  req.raw.on("close", runCleanups);
  raw.on("close", runCleanups);
  return channel;
}

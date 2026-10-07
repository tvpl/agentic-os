import type { FastifyReply, FastifyRequest } from "fastify";
import { successorHeaders } from "../apiVersion.js";

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
  opts: { heartbeatMs?: number; maxBufferedBytes?: number } = {},
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
    ...successorHeaders(req),
  });
  raw.flushHeaders?.();

  let closed = false;
  let blocked = false;
  let bufferedBytes = 0;
  const pending: string[] = [];
  const maxBufferedBytes = opts.maxBufferedBytes ?? 1_048_576;
  const cleanups: Array<() => void> = [];
  const write = (value: string) => {
    if (closed) return;
    if (blocked) {
      const bytes = Buffer.byteLength(value);
      if (bufferedBytes + bytes > maxBufferedBytes) {
        channel.end();
        return;
      }
      pending.push(value);
      bufferedBytes += bytes;
      return;
    }
    blocked = !raw.write(value);
  };
  const drain = () => {
    blocked = false;
    while (!closed && !blocked && pending.length > 0) {
      const value = pending.shift()!;
      bufferedBytes -= Buffer.byteLength(value);
      blocked = !raw.write(value);
    }
  };
  raw.on("drain", drain);
  const heartbeat = setInterval(() => {
    write(`: ping ${Date.now()}\n\n`);
  }, opts.heartbeatMs ?? 15_000);
  heartbeat.unref?.();

  const runCleanups = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    raw.off("drain", drain);
    pending.length = 0;
    bufferedBytes = 0;
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
      write(out);
    },
    comment(text) {
      write(`: ${text.replace(/\r?\n/g, " ")}\n\n`);
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

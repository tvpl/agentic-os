import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { openSse } from "../apps/api/src/routes/sse.js";

describe("SSE backpressure", () => {
  it("closes a stalled client when its bounded queue is exhausted", () => {
    const raw = Object.assign(new EventEmitter(), {
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      end: vi.fn(),
      write: vi.fn(() => false),
    });
    const requestRaw = new EventEmitter();
    const channel = openSse({ raw: requestRaw } as never, { hijack: vi.fn(), raw } as never, {
      heartbeatMs: 60_000,
      maxBufferedBytes: 32,
    });
    channel.send({ data: "first write blocks" });
    channel.send({ data: "this frame cannot fit in the bounded queue" });
    expect(channel.closed).toBe(true);
    expect(raw.end).toHaveBeenCalledOnce();
  });

  it("flushes queued frames after drain", () => {
    let calls = 0;
    const raw = Object.assign(new EventEmitter(), {
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      end: vi.fn(),
      write: vi.fn(() => ++calls > 1),
    });
    const channel = openSse({ raw: new EventEmitter() } as never, { hijack: vi.fn(), raw } as never, {
      heartbeatMs: 60_000,
      maxBufferedBytes: 1_000,
    });
    channel.send({ data: "one" });
    channel.send({ data: "two" });
    expect(raw.write).toHaveBeenCalledTimes(1);
    raw.emit("drain");
    expect(raw.write).toHaveBeenCalledTimes(2);
    channel.end();
  });
});

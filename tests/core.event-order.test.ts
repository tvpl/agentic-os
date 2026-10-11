import { expect, it } from "vitest";
import { EventBus } from "@mordomo/core/internal";

it("delivers nested notifications after their source event to every SSE-style observer", () => {
  const bus = new EventBus();
  bus.subscribe((event) => {
    if (event.type === "index.finished")
      bus.emit("notification.created", {
        id: "n1",
        kind: "index",
        tone: null,
        title: "Indexed",
        body: null,
        href: null,
        approvalId: null,
        runId: null,
        ts: 0,
        read: false,
        dedupeKey: null,
      });
  });
  let cursor = 0;
  const received: string[] = [];
  bus.subscribe((event) => {
    if (event.id <= cursor) return;
    cursor = event.id;
    received.push(event.type);
  });
  bus.emit("index.finished", {
    stats: {
      scanned: 1,
      added: 0,
      updated: 0,
      removed: 0,
      skippedExcluded: 0,
      skippedBinary: 0,
      related: 0,
      durationMs: 1,
    },
  });
  expect(received).toEqual(["index.finished", "notification.created"]);
  expect(bus.since(0).map((event) => event.id)).toEqual([1, 2]);
});

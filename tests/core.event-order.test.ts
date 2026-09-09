import { expect, it } from "vitest";
import { EventBus } from "@mordomo/core";

it("delivers nested notifications after their source event to every SSE-style observer", () => {
  const bus = new EventBus();
  bus.subscribe((event) => {
    if (event.type === "index.finished") bus.emit("notification.created", { title: "Indexed" });
  });
  let cursor = 0;
  const received: string[] = [];
  bus.subscribe((event) => {
    if (event.id <= cursor) return;
    cursor = event.id;
    received.push(event.type);
  });
  bus.emit("index.finished", { stats: { scanned: 1 } });
  expect(received).toEqual(["index.finished", "notification.created"]);
  expect(bus.since(0).map((event) => event.id)).toEqual([1, 2]);
});

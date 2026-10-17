import { expect, it } from "vitest";
import { EventBus } from "@mordomo/core/internal";

it("an event that matches its schema passes", () => {
  const event = new EventBus().emit("index.failed", {
    code: "index_scan_incomplete",
    previousIndexPreserved: true,
  });
  expect(event.type).toBe("index.failed");
});

import { it } from "vitest";
import { EventBus } from "@mordomo/core/internal";

it("an event that departs from its schema fails the test that made it", () => {
  new EventBus().emit("index.failed", { surprise: true } as never);
});

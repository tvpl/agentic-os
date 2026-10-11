import { afterAll, it } from "vitest";
import { EventBus } from "@mordomo/core/internal";

it("the test itself is clean", () => undefined);

// Hooks of a file close in the reverse order they were registered: this one runs before the guard's own.
afterAll(() => {
  new EventBus().emit("index.failed", { surprise: true } as never);
});

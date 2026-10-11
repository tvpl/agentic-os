import { defineConfig } from "vitest/config";
import base from "../../../vitest.config";

/** The root configuration (aliases, the event guard in `setupFiles`) over the fixtures of the guard's self-test only. */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    root: new URL("../../..", import.meta.url).pathname,
    include: ["tests/fixtures/event-guard/*.fixture.ts"],
    exclude: [],
  },
});

import { defineConfig } from "vitest/config";

/** Frontend unit tests: pure modules (layout maths, cron, colour, i18n parity). */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

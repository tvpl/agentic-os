import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mordomo/core": path.resolve(__dirname, "core/src/index.ts"),
      "@mordomo/adapter-claude": path.resolve(__dirname, "adapters/claude/src/index.ts"),
      "@mordomo/adapter-cursor": path.resolve(__dirname, "adapters/cursor/src/index.ts"),
      "@mordomo/adapter-codex": path.resolve(__dirname, "adapters/codex/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "core/src/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    testTimeout: 30_000,
    pool: "forks",
  },
});

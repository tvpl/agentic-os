import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mordomo/core": path.resolve(import.meta.dirname, "core/src/index.ts"),
      "@mordomo/adapter-claude": path.resolve(import.meta.dirname, "adapters/claude/src/index.ts"),
      "@mordomo/adapter-cursor": path.resolve(import.meta.dirname, "adapters/cursor/src/index.ts"),
      "@mordomo/adapter-codex": path.resolve(import.meta.dirname, "adapters/codex/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "core/src/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    testTimeout: 30_000,
    pool: "forks",
  },
});

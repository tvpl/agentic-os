import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mordomo/contracts/policy": path.resolve(import.meta.dirname, "contracts/src/policy.ts"),
      "@mordomo/contracts/events": path.resolve(import.meta.dirname, "contracts/src/eventRegistry.ts"),
      "@mordomo/contracts": path.resolve(import.meta.dirname, "contracts/src/index.ts"),
      "@mordomo/core/internal": path.resolve(import.meta.dirname, "core/src/internal.ts"),
      "@mordomo/core": path.resolve(import.meta.dirname, "core/src/index.ts"),
      "@mordomo/adapter-claude": path.resolve(import.meta.dirname, "adapters/claude/src/index.ts"),
      "@mordomo/adapter-cursor": path.resolve(import.meta.dirname, "adapters/cursor/src/index.ts"),
      "@mordomo/adapter-codex": path.resolve(import.meta.dirname, "adapters/codex/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "core/src/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    // Every event the bus announces in a test file is checked against its schema (AC 28 of contratos-rest).
    setupFiles: ["tests/helpers/eventGuard.ts"],
    testTimeout: 30_000,
    pool: "forks",
  },
});

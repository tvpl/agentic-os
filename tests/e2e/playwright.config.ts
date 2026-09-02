import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4777";
// Prefer a pre-installed Chromium (containers without `playwright install`); otherwise Playwright's own.
const PREINSTALLED = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const executablePath = fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "../../test-results",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]]
    : "list",
  use: {
    baseURL: BASE_URL,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node tests/e2e/serve.mjs",
    cwd: "../..",
    // TCP readiness: every API route (including /api/health) needs the local token.
    port: 4777,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

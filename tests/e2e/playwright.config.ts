import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { returningUserState } from "./returning-user";

const PORT = Number(process.env.MORDOMO_E2E_PORT ?? 4788);
const BASE_URL = `http://127.0.0.1:${PORT}`;
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
    // Existing workflows model a returning user. The onboarding spec explicitly
    // overrides this with a fresh browser to exercise the first-visit journey.
    storageState: returningUserState(BASE_URL),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The native macOS shell is a WKWebView: opt in with MORDOMO_E2E_WEBKIT=1 after `npx playwright install webkit`.
    ...(process.env.MORDOMO_E2E_WEBKIT === "1"
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
  webServer: {
    command: "node tests/e2e/serve.mjs",
    cwd: "../..",
    // TCP readiness: every API route (including /api/health) needs the local token.
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

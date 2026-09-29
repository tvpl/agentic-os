import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppContext } from "../../apps/api/dist/context.js";
import { startServer } from "../../apps/api/dist/server.js";
import { FAKE_BIN } from "./home.mjs";

const PORT = 4795;

/**
 * First run of a packaged install: an empty home, nothing configured. The
 * wizard must find the (fake) CLIs on PATH, let the user re-detect, and end
 * on the Núcleo with the settings persisted — without any terminal step.
 */
test("a fresh home is configured entirely from the browser", async ({ browser }) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-wizard-"));
  const home = path.join(container, "home");
  const originalPath = process.env.PATH;
  // The in-process server resolves provider CLIs from this process's PATH.
  process.env.PATH = `${FAKE_BIN}${path.delimiter}${originalPath ?? ""}`;
  fs.mkdirSync(path.join(home, "config"), { recursive: true });
  fs.writeFileSync(path.join(home, "config", "settings.json"), JSON.stringify({ version: 1, port: PORT }));
  const server = await startServer(home);
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${PORT}` });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();

    // Providers: the fake CLIs are found; codex is not logged in in the fixture → guidance + Detect again.
    const claude = page.getByTestId("setup-provider-claude");
    await expect(claude).toContainText("9.9.9-fake");
    await expect(claude.getByRole("checkbox")).toBeChecked();
    const codex = page.getByTestId("setup-provider-codex");
    await expect(codex.getByRole("checkbox")).toBeEnabled();
    await codex.getByRole("checkbox").uncheck();
    await codex.getByRole("button", { name: "Detect again" }).click();
    await expect(codex.getByRole("button", { name: "Detect again" })).toBeEnabled();
    // Re-detecting an unchanged CLI keeps the user's choice.
    await expect(codex.getByRole("checkbox")).not.toBeChecked();
    // The terminal path is offered, folded away.
    await expect(page.getByText("Prefer the terminal?")).toBeVisible();
    await expect(page.getByText("npx mordomo setup")).toBeHidden();
    await page.getByRole("button", { name: "Next" }).click();

    // Identity → Folders → Connect data → Desktop → Finish.
    await page.getByLabel("System name").fill("Wizard OS");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.locator(".os-root")).toBeVisible();
    await expect(page.locator('.nu-shell[data-scene="nucleo"]')).toBeVisible();

    // Persisted on the server, not only in the page.
    const ctx = new AppContext(home);
    try {
      const settings = ctx.settings();
      expect(settings.setupCompleted).toBe(true);
      expect(settings.systemName).toBe("Wizard OS");
      expect(settings.providers.claude.enabled).toBe(true);
      expect(settings.providers.codex.enabled).toBe(false);
      expect(settings.providers.claude.binaryPath).toBe(path.join(FAKE_BIN, "claude"));
    } finally {
      ctx.close();
    }
    expect(errors).toEqual([]);
  } finally {
    process.env.PATH = originalPath;
    await context.close();
    await server.close();
    fs.rmSync(container, { recursive: true, force: true });
  }
});

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackup, ensureDirs, resolvePaths, restoreBackup } from "@mordomo/core";
import { AppContext } from "../../apps/api/dist/context.js";
import { startServer } from "../../apps/api/dist/server.js";
import { returningUserState } from "./returning-user";

test("a backup restored into an emptied home has usable files and sessions in the browser", async ({
  browser,
}) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-restore-browser-"));
  const home = path.join(container, "home");
  const paths = resolvePaths(home);
  ensureDirs(paths);
  const original = new AppContext(home);
  const settings = original.settings();
  settings.setupCompleted = true;
  settings.language = "en";
  settings.port = 4794;
  for (const provider of Object.values(settings.providers)) provider.enabled = false;
  original.settingsStore.save(settings);
  const source = path.join(paths.memory, "restore-proof.md");
  fs.writeFileSync(source, "# Restore proof\nA fonte e sua referência continuam utilizáveis.");
  await original.indexer.indexAllAsync();
  const session = original.runs.sessions.create({
    provider: "claude",
    cwd: home,
    profile: "read_only",
    title: "Restored conversation",
  });
  const snapshot = await createBackup(paths, original.db, { includeArtifacts: true });
  fs.cpSync(snapshot.path, path.join(container, "snapshot"), { recursive: true });
  original.close();
  fs.rmSync(home, { recursive: true, force: true });
  ensureDirs(paths);
  fs.cpSync(path.join(container, "snapshot"), path.join(paths.backups, snapshot.name), { recursive: true });
  restoreBackup(paths, snapshot.name);
  const server = await startServer(home);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4794",
    storageState: returningUserState("http://127.0.0.1:4794"),
  });
  try {
    // Every provider is disabled in this home, so the "connect your AI first"
    // gate would cover the page: model a user who chose "Continue anyway".
    await context.addInitScript(
      (k: string) => sessionStorage.setItem(k, "1"),
      "mordomo.providerGate.skipped.v1",
    );
    const page = await context.newPage();
    await page.goto("/#/brain");
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page.locator(".brain2-list").getByRole("option", { name: "restore-proof.md", exact: true }).click();
    await expect(page.locator(".brain2-preview")).toContainText(
      "A fonte e sua referência continuam utilizáveis.",
    );
    const response = await context.request.get(`/api/sessions/${session.id}`, {
      headers: { "x-mordomo-token": server.ctx.token() },
    });
    expect(response.ok()).toBe(true);
    expect((await response.json()).session.title).toBe("Restored conversation");
    expect(server.ctx.db.pragma("quick_check", { simple: true })).toBe("ok");
  } finally {
    await context.close();
    await server.close();
    fs.rmSync(container, { recursive: true, force: true });
  }
});

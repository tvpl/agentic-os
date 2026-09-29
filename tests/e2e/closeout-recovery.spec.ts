import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { E2E_HOME } from "./home.mjs";
import { arrived, openBrainList, openClassicBrain, openShell } from "./shell";

const headers = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN! });
const reindex = async (request: APIRequestContext) =>
  expect((await request.post("/api/memory/index", { headers: headers() })).ok()).toBe(true);

test("removing a selected source offers recovery in the constellation", async ({ page, request }) => {
  const file = path.join(E2E_HOME, "memory", "vanishing-star.md");
  fs.writeFileSync(file, "# Vanishing star\nThis isolated star will be removed.");
  try {
    await reindex(request);
    await openShell(page, "/brain");
    const list = await openBrainList(page);
    await list.locator("button[data-file]").filter({ hasText: "vanishing-star.md" }).click();
    await expect(page.locator(".bs-sheet")).toContainText("This isolated star");
    fs.unlinkSync(file);
    await reindex(request);
    const missing = page.locator(".bs-missing");
    await expect(missing).toBeVisible();
    await expect(missing.getByRole("button", { name: "Refresh index", exact: true })).toBeVisible();
    await missing.getByRole("button", { name: "Close", exact: true }).click();
    await expect(missing).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]sel=/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("removing a selected source preserves the classic map's zoom and offers recovery", async ({
  page,
  request,
}) => {
  const file = path.join(E2E_HOME, "memory", "vanishing-source.md");
  fs.writeFileSync(file, "# Vanishing source\nThis isolated source will be removed.");
  try {
    await reindex(request);
    await openShell(page, "/brain");
    const map = await openClassicBrain(page);
    await map.getByRole("button", { name: "List view", exact: true }).click();
    await map.locator(".brain2-list button[data-file]").filter({ hasText: "vanishing-source.md" }).click();
    await expect(map.locator(".brain2-preview")).toContainText("This isolated source");
    await map.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
    await expect(map.getByLabel("Zoom", { exact: true })).toHaveText("100%");
    await map.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(map.getByLabel("Zoom", { exact: true })).toHaveText("130%");
    const zoom = await map.getByLabel("Zoom", { exact: true }).textContent();
    fs.unlinkSync(file);
    await reindex(request);
    await expect(map.locator(".brain-missing-source")).toBeVisible();
    await expect(map.getByLabel("Zoom", { exact: true })).toHaveText(zoom!);
    await map.locator(".brain-missing-source").getByRole("button", { name: "Close", exact: true }).click();
    await expect(map.locator(".brain-missing-source")).toHaveCount(0);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("a low-height modal keeps close and submit reachable with keyboard", async ({ page }) => {
  await openShell(page, "/skills", { width: 720, height: 450 });
  await page
    .getByRole("button", { name: /new skill/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const result = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The modal's Escape is its own: the scene stays.
  await expect(page).toHaveURL(/#\/skills$/);
  await arrived(page, "skills");
});

import { resetStage } from "./stage";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { E2E_HOME } from "./home.mjs";

test("removing a selected source preserves zoom and offers recovery", async ({ page, request }) => {
  await resetStage(request);
  const file = path.join(E2E_HOME, "memory", "vanishing-source.md");
  const headers = { "x-mordomo-token": process.env.MORDOMO_TOKEN! };
  fs.writeFileSync(file, "# Vanishing source\nThis isolated source will be removed.");
  try {
    expect((await request.post("/api/memory/index", { headers })).ok()).toBe(true);
    await page.goto("/#/brain");
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await page.locator(".brain2-list button[data-file]").filter({ hasText: "vanishing-source.md" }).click();
    await expect(page.locator(".brain2-preview")).toContainText("This isolated source");
    await page.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
    await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("100%");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("130%");
    const zoom = await page.getByLabel("Zoom", { exact: true }).textContent();
    fs.unlinkSync(file);
    expect((await request.post("/api/memory/index", { headers })).ok()).toBe(true);
    await expect(page.locator(".brain-missing-source")).toBeVisible();
    await expect(page.getByLabel("Zoom", { exact: true })).toHaveText(zoom!);
    await page.locator(".brain-missing-source").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".brain-missing-source")).toHaveCount(0);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("a low-height modal keeps close and submit reachable with keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto("/#/skills");
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
});

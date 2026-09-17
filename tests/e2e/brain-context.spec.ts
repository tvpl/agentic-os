import { resetStage, openAppFromPalette } from "./stage";
import { test, expect, type Route } from "@playwright/test";

test("a late file preview cannot reopen a selection the user already closed", async ({ page, request }) => {
  await resetStage(request);
  let pending: Route | undefined;
  await page.route("**/api/memory/preview?*", (route) => {
    pending = route;
  });
  await page.goto("/#/brain");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.locator(".brain2-list button[data-file]").first().click();
  await expect(page.locator(".brain2-preview")).toBeVisible();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator(".brain2-preview").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".brain2-preview")).toHaveCount(0);
  const response = page.waitForResponse((r) => r.url().includes("/api/memory/preview?"));
  await pending!.fulfill({ json: { kind: "text", content: "Late fixture", message: null } });
  await response;
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.locator(".brain2-preview")).toHaveCount(0);
});

test("brain keeps its selection while other apps open beside it", async ({ page }) => {
  // The brain is a panel now (G2): its selection lives in the panel, not in
  // the browser's history, and switching apps opens another panel beside it
  // instead of replacing the page.
  await page.goto("/#/brain");
  const brain = page.locator('[data-panel="app:brain"]');
  await brain.getByRole("button", { name: "List view", exact: true }).click();
  const files = brain.locator(".brain2-list button[data-file]");
  await expect(files.first()).toBeVisible();
  await files.first().click();
  const first = (await files.first().getAttribute("title")) ?? "";
  await files.nth(1).click();
  const second = (await files.nth(1).getAttribute("title")) ?? "";
  expect(second).not.toBe(first);
  await expect(brain.locator(".brain2-preview")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await openAppFromPalette(page, "Pixel Studio");
  await expect(page.locator('[data-panel="app:pixel"] .pxs-stage')).toBeVisible();
  await page.locator('.pod-arc.l .pod[data-pod="app:brain"]').click();
  await expect(brain.locator(".brain2-list")).toBeVisible();
  await expect(brain.locator(".brain2-preview")).toBeVisible();
  await expect(brain.locator(".brain2-preview")).toContainText(second.split("/").pop()!);
});

test("zoom, query and selected source survive leaving the brain", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/brain");
  const brain = page.locator('[data-panel="app:brain"]');
  await brain.getByRole("button", { name: "List view", exact: true }).click();
  const source = brain.locator(".brain2-list button[data-file]").first();
  const name = (await source.innerText()).trim();
  await source.click();
  const query = brain.locator(".brain2-panel input").first();
  await query.fill(name);
  await brain.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
  await brain.getByRole("button", { name: "Zoom in", exact: true }).click();
  await brain.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(brain.getByLabel("Zoom", { exact: true })).toHaveText("169%");
  await openAppFromPalette(page, "Pixel Studio");
  await expect(page.locator('[data-panel="app:pixel"] .pxs-stage')).toBeVisible();
  await page.locator('.pod-arc.l .pod[data-pod="app:brain"]').click();
  await expect(query).toHaveValue(name);
  await expect(brain.getByLabel("Zoom", { exact: true })).toHaveText("169%");
  await expect(brain.locator(".brain2-preview")).toContainText(name);
  await page.screenshot({ path: "artifacts/execution-2026-09-07/brain-context.png" });
});

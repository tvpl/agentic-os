import { test, expect, type Route } from "@playwright/test";

test("a late file preview cannot reopen a selection the user already closed", async ({ page }) => {
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

test("brain preserves selection and panels between apps and supports selection history", async ({ page }) => {
  await page.goto("/#/brain");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const files = page.locator(".brain2-list button[data-file]");
  await expect(files.first()).toBeVisible();
  await files.first().click();
  const first = new URL(await page.url()).hash;
  await files.nth(1).click();
  await expect.poll(() => new URL(page.url()).hash).not.toBe(first);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(first);
  await expect(page.locator(".brain2-preview")).toBeVisible();
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  await dock.getByRole("button", { name: "Pixel Studio", exact: true }).click();
  await expect(page.locator(".pxs-stage")).toBeVisible();
  await dock.getByRole("button", { name: "Second Brain", exact: true }).click();
  await expect(page.locator(".brain2-list")).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe(first);
  await expect(page.locator(".brain2-preview")).toBeVisible();
});

test("zoom, query and selected source survive leaving the brain", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/brain");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const source = page.locator(".brain2-list button[data-file]").first();
  const name = (await source.innerText()).trim();
  await source.click();
  const query = page.locator(".brain2-panel input").first();
  await query.fill(name);
  await page.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("169%");
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  await dock.getByRole("button", { name: "Pixel Studio", exact: true }).click();
  await expect(page.locator(".pxs-stage")).toBeVisible();
  await dock.getByRole("button", { name: "Second Brain", exact: true }).click();
  await expect(query).toHaveValue(name);
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("169%");
  await expect(page.locator(".brain2-preview")).toContainText(name);
  await page.screenshot({ path: "artifacts/execution-2026-09-07/brain-context.png" });
});

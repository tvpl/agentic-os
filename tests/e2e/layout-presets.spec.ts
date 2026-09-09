import { test, expect } from "@playwright/test";

test("a named layout restores cards without losing the console draft", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await request.put("/api/settings", {
    headers: { "x-mordomo-token": process.env.MORDOMO_TOKEN! },
    data: { language: "en", dashboardLayout: { now: { x: 4, y: 1, w: 6, h: 6, visible: true } } },
  });
  await page.goto("/#/");
  const now = page.locator('[data-widget-id="now"]');
  const prompt = page.locator('[data-widget-id="prompt"] textarea');
  await expect(now).toBeVisible();
  await prompt.fill("Keep my working context");
  await page.getByRole("button", { name: "Edit layout", exact: true }).click();
  await page.getByRole("button", { name: "Saved layouts", exact: true }).click();
  await page.getByLabel("Layout name", { exact: true }).fill("My desktop");
  await page.getByRole("button", { name: "Save current layout", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "My desktop", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/layout-presets.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await now.getByRole("button", { name: /hide widget/i }).click();
  await expect(now).toHaveCount(0);
  await page.getByRole("button", { name: "Saved layouts", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "My desktop", exact: true }).click();
  await expect(now).toBeVisible();
  await expect(prompt).toHaveValue("Keep my working context");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Pixel Studio", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(now).toBeVisible();
  await expect(prompt).toHaveValue("Keep my working context");
});

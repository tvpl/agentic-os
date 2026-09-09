import { test, expect } from "@playwright/test";

test("Portuguese desktop remains usable at a 200 percent equivalent CSS viewport", async ({
  browser,
  baseURL,
}) => {
  // Physical 1440x900 viewport at 2x density: 720x450 CSS pixels, the layout
  // space of 200% browser zoom. This does not exercise native Chrome menus.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 720, height: 450 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  try {
    await context.route("**/api/meta", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), language: "pt-BR" } });
    });
    const page = await context.newPage();
    await page.goto("/#/");
    await expect(page.locator(".desktop-widgets.stacked")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(2);
    await page.keyboard.press("Control+M");
    const menu = page.getByRole("dialog");
    await expect(menu).toBeVisible();
    await menu.getByRole("option", { name: "Segundo Cérebro", exact: true }).click();
    await expect(page.locator(".brain2")).toBeVisible();
    await page.getByRole("button", { name: "Restaurar zoom e posição", exact: true }).click();
    await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("100%");
    await page.screenshot({ path: "artifacts/execution-2026-09-07/reflow-200-equivalent.png" });
  } finally {
    await context.close();
  }
});

import { test, expect } from "@playwright/test";
import { openClassicBrain } from "./shell";

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
    await expect(page.locator('.nu-shell[data-scene="nucleo"]')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(2);
    // The voice line fits whole, the pendências stay in their corner and the
    // telemetry does not run off the edge.
    await expect(page.locator(".cons-input")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("pending-hub")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("nu-clock")).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Control+M");
    const menu = page.getByRole("dialog");
    await expect(menu).toBeVisible();
    await menu.getByRole("option", { name: "Segundo Cérebro", exact: true }).click();
    await expect(page.locator('.nu-shell[data-scene="brain"] .bs')).toBeVisible();
    const map = await openClassicBrain(page);
    await map.getByRole("button", { name: "Restaurar zoom e posição", exact: true }).click();
    await expect(map.getByLabel("Zoom", { exact: true })).toHaveText("100%");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(2);
    await page.screenshot({ path: "artifacts/execution-2026-09-07/reflow-200-equivalent.png" });
  } finally {
    await context.close();
  }
});

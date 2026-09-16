import { test, expect } from "@playwright/test";
import { stageBoxes } from "./stage";

/**
 * Regressions for the 2026-09 rework: the service-health banner, per-widget
 * minimum sizes, and the Second Brain camera that flies when a file is chosen.
 */

test("a stale build shows the service banner and its restart button calls the API", async ({ page }) => {
  await page.route("**/api/system/info", async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...json,
        build: { installedAt: Date.now(), startedAt: Date.now() - 60_000, stale: true },
        siblings: [],
      },
    });
  });
  let restarted = false;
  await page.route("**/api/system/restart", (route) => {
    restarted = true;
    return route.fulfill({ json: { ok: true, pid: 1 } });
  });
  await page.goto("/#/");
  const banner = page.getByTestId("service-banner");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: /restart service now|reiniciar serviço agora/i }).click();
  await expect.poll(() => restarted).toBe(true);
  await expect(banner).toContainText(/restarting|reiniciando/i);
});

test("a widget cannot be resized below its declared minimum", async ({ page, request }) => {
  // The stage opens clear (F7): the window under test has to be put on it, and
  // comfortably above its own floor (WINDOW_MIN.now = 360 × 200) so that the
  // shrinking has somewhere to go before it stops.
  await stageBoxes(request, { now: { x: 120, y: 40, w: 560, h: 420 } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/");
  const now = page.locator('[data-panel="now"]');
  await expect(now).toBeVisible();
  const handle = now.locator(".panel-grip");
  await handle.focus();
  const before = (await now.boundingBox())!;
  // Arrow keys on the grip shrink the window; far more presses than it can take.
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowUp");
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(400);
  // WINDOW_MIN.now = 360 × 200 CSS pixels (redesign F4a).
  await expect.poll(async () => (await now.boundingBox())!.width).toBeGreaterThanOrEqual(360);
  const after = (await now.boundingBox())!;
  expect(after.height).toBeGreaterThanOrEqual(200);
  expect(after.width).toBeLessThan(before.width);
  // Reset lives in the palette now that the edit bar is gone (G1).
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("reset layout");
  await page.getByRole("option", { name: /reset layout|resetar layout/i }).click();
  await page.getByRole("button", { name: /^(confirm|confirmar)$/i }).click();
  await page.waitForTimeout(600);
});

test("choosing a file in the brain flies the camera in and opens the preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/brain");
  await page.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("100%");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await page.locator(".brain2-list button[data-file]").first().click();
  await expect(page.locator(".brain2-preview")).toBeVisible();
  await expect
    .poll(async () =>
      parseInt((await page.getByLabel("Zoom", { exact: true }).innerText()).replace("%", ""), 10),
    )
    .toBeGreaterThanOrEqual(170);
});

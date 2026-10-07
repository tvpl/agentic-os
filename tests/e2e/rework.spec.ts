import { test, expect } from "@playwright/test";
import { openBrainList, openClassicBrain, openShell, overlaps } from "./shell";

/**
 * Regressions for the 2026-09 rework: the service-health banner, and the
 * Second Brain camera that flies when a file is chosen.
 */

test("a stale build shows the service banner and its restart button calls the API", async ({ page }) => {
  await page.route("**/api/v1/system/info", async (route) => {
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
  await page.route("**/api/v1/system/restart", (route) => {
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

test("choosing a file in the classic map flies the camera in and opens the preview", async ({ page }) => {
  await openShell(page, "/brain", { width: 1440, height: 900 });
  const map = await openClassicBrain(page);
  await map.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
  await expect(map.getByLabel("Zoom", { exact: true })).toHaveText("100%");
  await map.getByRole("button", { name: "List view", exact: true }).click();
  await map.locator(".brain2-list button[data-file]").first().click();
  await expect(map.locator(".brain2-preview")).toBeVisible();
  await expect
    .poll(async () =>
      parseInt((await map.getByLabel("Zoom", { exact: true }).innerText()).replace("%", ""), 10),
    )
    .toBeGreaterThanOrEqual(170);
});

test("choosing a star in the constellation opens its reading sheet and a deep link to it", async ({
  page,
}) => {
  await openShell(page, "/brain", { width: 1440, height: 900 });
  const list = await openBrainList(page);
  const file = list.locator("button[data-file]").first();
  const path = await file.getAttribute("title");
  await file.click();
  const sheet = page.locator(".bs-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".bs-sheet-path")).toHaveAttribute("title", path!);
  // The sheet stands clear of the voice line and of the telemetry.
  const box = (await sheet.boundingBox())!;
  const voice = (await page.locator(".nu-voice .cons-row").boundingBox())!;
  const tele = (await page.locator(".nu-tele").boundingBox())!;
  expect(overlaps(box, voice)).toBe(false);
  expect(overlaps(box, tele)).toBe(false);
  // The choice is a link: a reload lands on the same star.
  const url = page.url();
  expect(url).toMatch(/[?&]sel=\d+/);
  await page.reload();
  await expect(page.locator(".bs-sheet .bs-sheet-path")).toHaveAttribute("title", path!);
});

/**
 * Visual regression over the component gallery (audit item 42): every story
 * section is screenshotted in both themes and compared with the committed
 * baselines under tests/e2e/gallery.spec.ts-snapshots/.
 * Regenerate on purpose with: npm run test:e2e -- gallery --update-snapshots
 */
import { test, expect } from "@playwright/test";

const SECTIONS = [
  "buttons",
  "badges",
  "fields",
  "controls",
  "states",
  "dialogs",
  "primitives",
  "widgets",
  "now",
  "timeline",
  "nucleo-layer",
  "frame-layer",
];

for (const theme of ["dark", "light"] as const) {
  test.describe(`gallery · ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      // Freeze time: the Today widget and the Now panel render clocks and countdowns.
      await page.clock.install({ time: new Date("2026-09-02T14:30:00Z") });
      await page.clock.setFixedTime(new Date("2026-09-02T14:30:00Z"));
      await page.goto(`/gallery.html?theme=${theme}`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
    });

    for (const id of SECTIONS) {
      test(`section ${id}`, async ({ page }) => {
        const section = page.locator(`#story-${id}`);
        await expect(section).toBeVisible();
        await expect(section).toHaveScreenshot(`${id}-${theme}.png`, {
          animations: "disabled",
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  });
}

/**
 * C10 (design-system): the gallery draws the primitives inside both
 * interfaces, each with the stylesheet that dresses them there.
 */
test("C10 the gallery shows both layers", async ({ page }) => {
  await page.goto("/gallery.html");
  await page.evaluate(() => document.fonts.ready);
  const radius = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).borderRadius);

  // Núcleo: .nu-shell with luz.css loaded, so a button is a pill and the dialog a glass sheet.
  const nucleo = page.locator("#story-nucleo-layer");
  await expect(nucleo.locator(".nu-shell .nu-scene.luz")).toBeVisible();
  await expect(nucleo.locator("button.btn")).not.toHaveCount(0);
  await expect(nucleo.locator(".badge")).not.toHaveCount(0);
  await expect(nucleo.locator("input.input").first()).toBeVisible();
  await expect(nucleo.getByRole("dialog")).toBeVisible();
  expect(await radius("#story-nucleo-layer button.btn")).toBe("999px");
  expect(await radius("#story-nucleo-layer [role=dialog]")).toBe("26px");

  // App frame: [data-shell="moldura"] with moldura.css (the frame's own custom properties),
  // and its dialog keeps the frame's look even though the page also holds a Núcleo.
  const frame = page.locator('#story-frame-layer [data-shell="moldura"]');
  await expect(frame).toBeVisible();
  expect(await frame.evaluate((el) => getComputedStyle(el).getPropertyValue("--mold-nav-w").trim())).toBe(
    "232px",
  );
  await expect(frame.locator("button.btn")).not.toHaveCount(0);
  await expect(frame.locator(".badge")).not.toHaveCount(0);
  await expect(frame.locator("input.input").first()).toBeVisible();
  await expect(frame.getByRole("dialog")).toBeVisible();
  expect(await radius('#story-frame-layer [role="dialog"]')).toBe("8px");
});

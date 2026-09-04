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
  "widgets",
  "now",
  "timeline",
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

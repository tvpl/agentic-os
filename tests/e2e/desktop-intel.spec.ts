/**
 * Refino Onda 3: the panels that give the OS's intelligence a face — what it
 * is watching, what it knows, today's journal and the mission — open on the
 * stage and read their real endpoints.
 */
import { test, expect, type Page } from "@playwright/test";
import { resetStage } from "./stage";

async function openDesktop(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("[data-console]")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetStage(request);
});

test("the arrange event opens the intelligence panels and each reads its endpoint", async ({ page }) => {
  await openDesktop(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("mordomo:arrange", { detail: ["sentinels", "facts", "journal", "mission"] }),
    ),
  );
  const sentinels = page.locator('[data-panel="sentinels"]');
  await expect(sentinels).toBeVisible();
  // Six rows: the four sentinels, the repeat detector and the triage run.
  await expect(sentinels.locator(".sentinel-row")).toHaveCount(6);
  await expect(sentinels.locator(".panel-body")).not.toContainText(/not found/i);

  await expect(page.locator('[data-panel="facts"]')).toBeVisible();
  await expect(page.locator('[data-panel="journal"]')).toBeVisible();
  await expect(page.locator('[data-panel="mission"]')).toBeVisible();
  // Four panels: past three, they keep their spots rather than reflowing into columns.
  await expect(page.locator(".panel")).toHaveCount(4);
});

test("the deck finds a skill by what it does and shows its card", async ({ page }) => {
  await openDesktop(page);
  await page.keyboard.press("ControlOrMeta+j");
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  await deck.locator(".deck-search").fill("review");
  await expect(deck.locator(".deck-focus-slug")).toContainText("/code-review");
  await page.keyboard.press("Escape");
  await expect(deck).toHaveCount(0);
});

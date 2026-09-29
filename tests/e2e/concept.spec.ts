/**
 * The immersive concept across the whole system
 * (.specs/features/conceito-em-todo-sistema): every scene speaks the same
 * language as the Núcleo and the conversation, shows one thing in focus and
 * the rest on demand, says each cause once, and lets the agent take any
 * focused item. Each test is named after the check it proves (C1…C36).
 */
import { test, expect, type Page } from "@playwright/test";
import { arrived, currentScene, openShell } from "./shell";

/* ---- S5: connectors ------------------------------------------------------------ */

async function openConnectors(page: Page, viewport = { width: 1440, height: 900 }) {
  await openShell(page, "/connectors", viewport);
  await arrived(page, "connectors");
  const cards = page.getByTestId("connector-card");
  await expect(cards.first()).toBeVisible();
  return cards;
}

test("C27 connector steps never wrap", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    const cards = await openConnectors(page, viewport);
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      await card.locator(".cx-card-head").click();
      await expect(card).toHaveAttribute("data-open", "");
      const labels = card.locator(".conn-steps .conn-step-t");
      await expect(labels).toHaveCount(3);
      // An inline label that wraps has one client rect per line.
      const lines = await labels.evaluateAll((els) => els.map((el) => el.getClientRects().length));
      expect(lines, `card ${i} at ${viewport.width}px`).toEqual([1, 1, 1]);
    }
  }
});

test("C28 a tall scene scrolls instead of clipping", async ({ page }) => {
  const cards = await openConnectors(page, { width: 1280, height: 720 });
  // Open the tallest card: the scene is then taller than the room above the line.
  await cards.first().locator(".cx-card-head").click();
  await cards.first().locator(".conn-steps button").first().click();
  const scroller = currentScene(page).locator(".nu-scene-app");
  const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const last = page.getByTestId("connector-card").last();
  await expect
    .poll(async () => {
      const box = (await last.boundingBox())!;
      const floor = await page.locator(".nu-voice").evaluate((el) => el.getBoundingClientRect().top);
      const bottom = await scroller.evaluate((el) => el.getBoundingClientRect().bottom);
      return box.y + box.height <= Math.min(floor, bottom);
    })
    .toBe(true);
});

test("C29 connectors are cards with a state orb", async ({ page }) => {
  const cards = await openConnectors(page);
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await expect(card.locator(".cx-orb")).toHaveAttribute("data-state", /^(ok|off|warn|danger)$/);
    await expect(card.locator(".cx-name")).not.toBeEmpty();
    await expect(card.locator(".cx-purpose")).not.toBeEmpty();
    // Closed, a card shows no steps.
    await expect(card.locator(".conn-steps")).toHaveCount(0);
  }
  // Glass: rounded, never chamfered.
  const style = await cards.first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { clip: s.clipPath, radius: parseFloat(s.borderTopLeftRadius) };
  });
  expect(style.clip).toBe("none");
  expect(style.radius).toBeGreaterThanOrEqual(10);
});

test("C30 one connector open at a time", async ({ page }) => {
  const cards = await openConnectors(page);
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const a = cards.nth(0);
  const b = cards.nth(1);
  await a.locator(".cx-card-head").click();
  await expect(a).toHaveAttribute("data-open", "");
  await expect(a.locator(".cx-card-head")).toHaveAttribute("aria-expanded", "true");
  await expect(a.locator(".conn-steps")).toBeVisible();
  await b.locator(".cx-card-head").click();
  await expect(b).toHaveAttribute("data-open", "");
  await expect(b.locator(".conn-steps")).toBeVisible();
  await expect(a).not.toHaveAttribute("data-open", /.*/);
  await expect(a.locator(".cx-card-head")).toHaveAttribute("aria-expanded", "false");
  await expect(a.locator(".conn-steps")).toHaveCount(0);
});

test("C31 audit is a pill in the header", async ({ page }) => {
  await openConnectors(page);
  const audit = page.locator(".cx-head").getByTestId("connectors-audit");
  await expect(audit).toBeVisible();
  const style = await audit.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      clip: s.clipPath,
      radius: parseFloat(s.borderTopLeftRadius),
      h: el.getBoundingClientRect().height,
    };
  });
  expect(style.clip).toBe("none");
  // A pill: the radius is at least half the height.
  expect(style.radius).toBeGreaterThanOrEqual(style.h / 2 - 1);
});

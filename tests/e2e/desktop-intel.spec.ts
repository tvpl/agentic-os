/**
 * Refino Onda 3, in the immersive shell: the instruments that give the OS's
 * intelligence a face — what it is watching, what it knows, today's journal
 * and the mission — are projected as lâminas and read their real endpoints.
 */
import { test, expect } from "@playwright/test";
import { arrived, lamina, laminaIds, liveLaminas, openShell } from "./shell";

const arrange = (ids: string[]) => window.dispatchEvent(new CustomEvent("mordomo:arrange", { detail: ids }));

test("the arrange event projects the intelligence instruments, two at a time, each reading its endpoint", async ({
  page,
}) => {
  await openShell(page);
  // Two lâminas at most: an arrangement names up to two instruments.
  await page.evaluate(arrange, ["sentinels", "facts", "journal", "mission"]);
  await expect(liveLaminas(page)).toHaveCount(2);
  expect(await laminaIds(page)).toEqual(["sentinels", "facts"]);
  const sentinels = lamina(page, "sentinels");
  // Six rows: the four sentinels, the repeat detector and the triage run.
  await expect(sentinels.locator(".sentinel-row")).toHaveCount(6);
  await expect(sentinels.locator(".nu-lamina-body")).not.toContainText(/not found/i);
  await expect(lamina(page, "facts").locator(".nu-lamina-body")).not.toContainText(/not found/i);

  // The next arrangement takes their place.
  await page.evaluate(arrange, ["journal", "mission"]);
  await expect.poll(() => laminaIds(page)).toEqual(["journal", "mission"]);
  for (const id of ["journal", "mission"]) {
    await expect(lamina(page, id)).toBeVisible();
    await expect(lamina(page, id).locator(".nu-lamina-body")).not.toContainText(/not found/i);
  }
});

test("an arrangement with an app travels to its scene and projects the instruments there", async ({
  page,
}) => {
  await openShell(page);
  await page.evaluate(arrange, ["app:runs", "pulse", "attention", "cost"]);
  await expect(page).toHaveURL(/#\/runs$/);
  await arrived(page, "runs");
  // Projected after the travel, so arriving did not dissolve them.
  await expect.poll(() => laminaIds(page)).toEqual(["pulse", "attention"]);
});

test("the palette's “organizar” composes the scene an intent needs", async ({ page }) => {
  await openShell(page);
  await page.keyboard.press("Control+M");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("organizar revisar código");
  await dialog.getByRole("option").first().click();
  await expect(dialog).toHaveCount(0);
  // Reviewing code is the Runs scene, with what needs attention beside it
  // (desktop/arrange.ts: the first app named is the scene).
  await expect(page).toHaveURL(/#\/runs$/);
  await arrived(page, "runs");
  await expect.poll(() => laminaIds(page)).toEqual(["attention"]);
});

test("the deck finds a skill by what it does and shows its card", async ({ page }) => {
  await openShell(page);
  await page.keyboard.press("ControlOrMeta+j");
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  await deck.locator(".deck-search").fill("review");
  await expect(deck.locator(".deck-focus-slug")).toContainText("/code-review");
  await page.keyboard.press("Escape");
  await expect(deck).toHaveCount(0);
});

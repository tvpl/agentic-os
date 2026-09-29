import { test, expect } from "@playwright/test";
import { arrived, currentScene, lamina, openAppFromPalette, openShell } from "./shell";

test("Pixel Studio draws, undoes, adds frames, exports PNG and saves a viewable artifact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/pixel");
  const canvas = page.getByLabel("Canvas", { exact: true });
  const blank = await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
  await canvas.click({ position: { x: 30, y: 30 } });
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).not.toBe(blank);
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL())).toBe(blank);
  await canvas.click({ position: { x: 60, y: 60 } });
  await page.locator("#pxs-name").fill("gauntlet-sprite");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Frame as PNG (16×)" }).click();
  expect((await download).suggestedFilename()).toBe("gauntlet-sprite.png");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".pxs-frame")).toHaveCount(2);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/microapps/pixel/save") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await page.goto("/#/artifacts");
  await page.locator(".art-find input").fill("gauntlet-sprite.png");
  await page.locator(".art-card").first().click();
  // The picture opens as a lâmina out of its tile.
  const image = page.locator('article.nu-lamina[data-lamina^="doc:"] img.doc-media');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test("routine lifecycle: create, edit, enable, execute, inspect history and delete", async ({ page }) => {
  await openShell(page, "/routines");
  await arrived(page, "routines");
  await page.getByRole("button", { name: "+ New routine", exact: true }).click();
  await page.locator("#rt-name").fill("Gauntlet daily workflow");
  await page.locator("#rt-prompt").fill("Summarize this test workspace");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const item = (name: string) => page.locator(".rts-item").filter({ hasText: name });
  await expect(item("Gauntlet daily workflow")).toBeVisible();
  // A line of the agenda unfolds into its details and every action; the choice is in the URL.
  await item("Gauntlet daily workflow").locator(".rts-row").click();
  await expect(page).toHaveURL(/#\/routines\?r=/);
  const details = page.getByRole("region", { name: /Gauntlet daily workflow/ });
  await details.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("#rt-name").fill("Gauntlet daily revised");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const revised = item("Gauntlet daily revised");
  await expect(revised).toBeVisible();
  const open = page.getByRole("region", { name: /Gauntlet daily revised/ });
  await expect(open).toBeVisible();
  await open.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(open.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await open.getByRole("button", { name: "Run now", exact: true }).click();
  // Outside the Runs scene, the run is projected beside the routines as a trace.
  const trace = lamina(page, "run:", "^=");
  await expect(trace.locator(".run-title .badge")).toHaveText(/done/i, { timeout: 20000 });
  await expect(page).toHaveURL(/#\/routines\?r=/);
  // Read, then dismissed: the routine is where it was.
  await trace.getByRole("button", { name: /^(Dismiss|Dispensar): / }).click();
  await expect(lamina(page, "run:", "^=")).toHaveCount(0);
  await open.getByRole("button", { name: "History", exact: true }).click();
  const history = open.getByRole("list", { name: "History" });
  await expect(history.locator("li").first()).toContainText(/done/i);
  // A firing's run opens its trace from the history too.
  await expect(history.getByRole("button", { name: /open run/i }).first()).toBeVisible();
  await open.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(revised).toHaveCount(0);
});

test("every launcher app opens usable content", async ({ page }) => {
  await openShell(page);
  // Every app is a scene now; the palette travels to it.
  for (const [name, scene, target] of [
    ["Second Brain", "brain", ".bs"],
    ["Skills", "skills", ".sks-tools"],
    ["Routines", "routines", ".rts-side"],
    ["Runs", "runs", ".rs-scene"],
    ["Connectors", "connectors", ".page"],
    ["Pixel Studio", "pixel", ".pxs-stage"],
    ["Settings", "settings", ".page"],
    ["Core", "nucleo", ".nu-nucleo"],
  ]) {
    await openAppFromPalette(page, name!);
    await arrived(page, scene!);
    await expect(currentScene(page).locator(target!).first()).toBeVisible();
  }
});

import { test, expect } from "@playwright/test";
import { resetStage, settled, stageWith } from "./stage";

test("spaces keep their own windows and the dock follows app navigation", async ({ page, request }) => {
  // This spec drags a window between spaces, so it puts one on the stage.
  await stageWith(request, "routines");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  const consoleWidget = page.locator("[data-console]");
  const routines = page.locator('[data-panel="routines"]');
  await consoleWidget.locator("textarea").fill("Continue this after exploring");

  // Rearrange Work, then leave it.
  const header = routines.locator(".panel-title");
  await settled(routines);
  const g = (await header.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 300, g.y + g.height / 2 + 140, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await routines.boundingBox())!.x).toBeGreaterThan(240);
  const arranged = (await routines.boundingBox())!;

  await dock.getByRole("button", { name: "Research", exact: true }).click();
  // A fresh space starts from the default composition, not the one just left —
  // and since F7 the default composition is a clear stage, so the window that
  // was just dragged around Work is simply not here.
  await expect(routines).toHaveCount(0);
  // The draft belongs to the console, not to a space.
  await expect(consoleWidget.locator("textarea")).toHaveValue("Continue this after exploring");

  // The Second Brain is still one click away, from its pod.
  await page.locator('.pod-arc.l .pod[data-pod="app:brain"]').click();
  await expect(page.locator(".brain2")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => Number((await page.locator(".zoom-readout").innerText()).replace("%", "")))
    .toBeGreaterThan(110);
  await page.screenshot({ animations: "disabled", path: "artifacts/qa-workspace-brain.png" });

  // Back to Work: the arrangement is where it was left, across a reload too.
  await dock.getByRole("button", { name: "Work", exact: true }).click();
  await expect.poll(async () => (await routines.boundingBox())!.x).toBeCloseTo(arranged.x, -1);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect.poll(async () => (await routines.boundingBox())!.x).toBeCloseTo(arranged.x, -1);
  await page.screenshot({ animations: "disabled", path: "artifacts/qa-workspace-overview.png" });

  await page.goto("about:blank");
  await resetStage(request);
});

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
  await page.locator("#art-q").fill("gauntlet-sprite.png");
  await page.locator(".art-card").first().click();
  const image = page.locator(".art-lightbox img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test("routine lifecycle: create, edit, enable, execute, inspect history and delete", async ({ page }) => {
  await page.goto("/#/routines");
  await page.getByRole("button", { name: "New routine", exact: true }).click();
  await page.locator("#rt-name").fill("Gauntlet daily workflow");
  await page.locator("#rt-prompt").fill("Summarize this test workspace");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const card = page.locator(".routine-card").filter({ hasText: "Gauntlet daily workflow" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Edit Gauntlet/ }).click();
  await page.locator("#rt-name").fill("Gauntlet daily revised");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const revised = page.locator(".routine-card").filter({ hasText: "Gauntlet daily revised" });
  await revised.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(revised.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await revised.getByRole("button", { name: "Test now", exact: true }).click();
  await expect(page.locator(".run-title .badge")).toHaveText(/done/i, { timeout: 20000 });
  // The trace opened as a panel over the Routines app (G3): bring the app back to the front.
  await page.locator('[data-panel="app:routines"] .panel-title').click();
  await revised.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("dialog").locator("tbody .badge").first()).toHaveText(/done/i);
  await page.keyboard.press("Escape");
  await revised.getByRole("button", { name: /Delete Gauntlet/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(revised).toHaveCount(0);
});

test("every launcher app opens usable content", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // Every app is a panel on the stage now (G2); the desktop never goes away.
  for (const [name, target] of [
    ["Second Brain", '[data-panel="app:brain"] .brain2'],
    ["Skills", '[data-panel="app:skills"] .page'],
    ["Routines", '[data-panel="app:routines"] .page'],
    ["Runs", '[data-panel="app:runs"] .page'],
    ["Connectors", '[data-panel="app:connectors"] .page'],
    ["Pixel Studio", '[data-panel="app:pixel"] .pxs-stage'],
    ["Settings", '[data-panel="app:settings"] .page'],
    ["Dashboard", ".desktop"],
  ]) {
    await page.keyboard.press("Control+M");
    await page.getByRole("dialog").getByRole("option", { name, exact: true }).click();
    await expect(page.locator(".launcher")).toHaveCount(0);
    await expect(page.locator(target)).toBeVisible();
  }
});

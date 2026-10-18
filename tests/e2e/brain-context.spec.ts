import { test, expect, type Route } from "@playwright/test";
import {
  arrived,
  openAppFromPalette,
  openBrainList,
  openClassicBrain,
  openShell,
  travelBySpine,
} from "./shell";

test("a late file preview cannot reopen a selection the user already closed", async ({ page }) => {
  let pending: Route | undefined;
  await page.route("**/api/v1/memory/preview?*", (route) => {
    pending = route;
  });
  await openShell(page, "/brain");
  const list = await openBrainList(page);
  await list.locator("button[data-file]").first().click();
  const sheet = page.locator(".bs-sheet");
  await expect(sheet).toBeVisible();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await sheet.getByRole("button", { name: /^(Close|Fechar) · Esc$/ }).click();
  await expect(sheet).toHaveCount(0);
  const response = page.waitForResponse((r) => r.url().includes("/api/v1/memory/preview?"));
  await pending!.fulfill({ json: { kind: "text", content: "Late fixture", message: null } });
  await response;
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.locator(".bs-sheet")).toHaveCount(0);
  await expect(page.getByText("Late fixture")).toHaveCount(0);
});

test("the brain keeps its selection and query while you travel to another scene and back", async ({
  page,
}) => {
  await openShell(page, "/brain");
  const list = await openBrainList(page);
  const files = list.locator("button[data-file]");
  await files.first().click();
  const first = (await files.first().getAttribute("title")) ?? "";
  await files.nth(1).click();
  const second = (await files.nth(1).getAttribute("title")) ?? "";
  expect(second).not.toBe(first);
  const sheet = page.locator(".bs-sheet");
  await expect(sheet.locator(".bs-sheet-path")).toHaveAttribute("title", second);
  // The selection is a place: it is in the URL.
  await expect(page).toHaveURL(/#\/brain\?(.*&)?sel=\d+/);
  const search = page.locator(".bs-search input");
  await search.fill("brain");
  await expect(page).toHaveURL(/[?&]q=brain/);

  await openAppFromPalette(page, "Pixel Studio");
  await arrived(page, "pixel");
  await expect(page.locator(".pxs-stage")).toBeVisible();
  // Back to the bare `/brain`: where you were comes back. (Pixel Studio owns the digit keys as its tools, so the
  // way back is the spine, not key 2.)
  await travelBySpine(page, "brain");
  await expect(page.locator(".bs-sheet .bs-sheet-path")).toHaveAttribute("title", second);
  await expect(page.locator(".bs-search input")).toHaveValue("brain");
  // And the Back button walks the same way.
  await page.goto("/#/");
  await arrived(page, "nucleo");
  await page.goBack();
  await arrived(page, "brain");
  await expect(page.locator(".bs-sheet .bs-sheet-path")).toHaveAttribute("title", second);
});

test("the classic map keeps its zoom, query and selected source across scenes", async ({ page }) => {
  await openShell(page, "/brain", { width: 1440, height: 900 });
  const map = await openClassicBrain(page);
  await map.getByRole("button", { name: "List view", exact: true }).click();
  const source = map.locator(".brain2-list button[data-file]").first();
  const name = (await source.innerText()).trim();
  await source.click();
  const query = map.locator(".brain2-panel input").first();
  await query.fill(name);
  await map.getByRole("button", { name: "Reset zoom and position", exact: true }).click();
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await map.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(map.getByLabel("Zoom", { exact: true })).toHaveText("169%");
  await openAppFromPalette(page, "Pixel Studio");
  await arrived(page, "pixel");
  await expect(page.locator(".pxs-stage")).toBeVisible();
  await travelBySpine(page, "brain");
  // Still the classic map, where it was left.
  const back = page.locator(".bs-classic .brain2");
  await expect(back.locator(".brain2-panel input").first()).toHaveValue(name);
  await expect(back.getByLabel("Zoom", { exact: true })).toHaveText("169%");
  await expect(back.locator(".brain2-preview")).toContainText(name);
  await page.screenshot({ path: "artifacts/execution-2026-09-07/brain-context.png" });
});

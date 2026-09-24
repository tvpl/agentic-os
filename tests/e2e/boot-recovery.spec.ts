import { expect, test } from "@playwright/test";

test("rejects HTML cached as JavaScript and recovers the real app", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".os-root")).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const asset = await page.locator('script[type="module"]').getAttribute("src");
  expect(asset).toMatch(/^\/assets\/main-.*\.js$/);
  await page.evaluate(async (url) => {
    const cache = await caches.open("mordomo-shell-v2");
    await cache.put(
      url!,
      new Response("<!doctype html><title>stale shell</title>", { headers: { "content-type": "text/html" } }),
    );
  }, asset);
  await page.reload();
  await expect(page.locator(".os-root")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        const cache = await caches.open("mordomo-shell-v2");
        return (await cache.match(url!))?.headers.get("content-type");
      }, asset),
    )
    .toContain("javascript");
});

test.describe("without a service worker", () => {
  // A worker installed by the first visit fetches assets itself, outside
  // page.route(): block it so the failure is deterministic and the plain
  // boot-recovery path (no worker yet) is what gets exercised.
  test.use({ serviceWorkers: "block" });
  test("shows a recovery action when the entry bundle fails, then retries successfully", async ({ page }) => {
    await page.route("**/assets/main-*.js", (route) => route.abort("failed"));
    await page.goto("/");
    await expect(page.locator("#boot-reload")).toBeVisible();
    await expect(page.locator("#boot-message")).toContainText(/could not start|Não foi possível/);
    await page.unroute("**/assets/main-*.js");
    await page.locator("#boot-reload").click();
    await expect(page.locator(".os-root")).toBeVisible();
    await expect(page.locator("#boot-status")).toHaveCount(0);
  });
});

import { test, expect } from "@playwright/test";
import { stageBoxes } from "./stage";

test("two browser contexts preserve competing layouts until an explicit resolution", async ({
  page,
  request,
  browser,
}) => {
  const headers = { "x-mordomo-token": process.env.MORDOMO_TOKEN! };
  // Stage pixels (redesign F4a), side by side so both title bars are clickable.
  // Seeded through the stage helper so the app panels a neighbouring spec
  // left open (G2) are parked first — one of them over the Now plate meant
  // the ✕ under test was never reachable.
  await request.put("/api/settings", { headers, data: { language: "en" } });
  await stageBoxes(request, {
    now: { x: 24, y: 24, w: 420, h: 300 },
    pulse: { x: 470, y: 24, w: 420, h: 300 },
  });
  await page.goto("/#/");
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const second = await other.newPage();
    await second.goto("/#/");
    await expect(page.locator('[data-panel="now"]')).toBeVisible();
    await expect(second.locator('[data-panel="pulse"]')).toBeVisible();
    // The edit mode that used to freeze the second window's base is gone
    // (G1). What makes a conflict real is that the second window has not
    // seen the first one's write: keep its settings refetch from landing.
    let settled = false;
    await second.route("**/api/settings", (route) => {
      if (route.request().method() === "GET" && settled) return route.abort();
      return route.continue();
    });
    settled = true;
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT" && r.ok(),
    );
    await page
      .locator('[data-panel="now"]')
      .getByRole("button", { name: /^close|^fechar/i })
      .click();
    await saved;
    await second
      .locator('[data-panel="pulse"]')
      .getByRole("button", { name: /^close|^fechar/i })
      .click();
    const conflict = second.getByText("Another window changed this layout. Your local edits are preserved.");
    await expect(conflict).toBeVisible();
    await expect(second.locator('[data-panel="now"]')).toBeVisible();
    await second.unroute("**/api/settings");
    await second.getByRole("button", { name: "Save my layout instead", exact: true }).click();
    await expect(conflict).toHaveCount(0);
    await second.reload();
    await expect(second.locator('[data-panel="now"]')).toBeVisible();
    await expect(second.locator('[data-panel="pulse"]')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

import { test, expect } from "@playwright/test";

test("two browser contexts preserve competing layouts until an explicit resolution", async ({
  page,
  request,
  browser,
}) => {
  const headers = { "x-mordomo-token": process.env.MORDOMO_TOKEN! };
  // Stage pixels (redesign F4a), side by side so both title bars are clickable.
  const box = { x: 24, y: 24, w: 420, h: 300, z: 1, visible: true };
  await request.put("/api/settings", {
    headers,
    data: {
      language: "en",
      dashboardLayout: { now: box, pulse: { ...box, x: 470, z: 2 } },
    },
  });
  await page.goto("/#/");
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const second = await other.newPage();
    await second.goto("/#/");
    await expect(page.locator('[data-widget-id="now"]')).toBeVisible();
    await expect(second.locator('[data-widget-id="pulse"]')).toBeVisible();
    // Keep both local bases while the first writer publishes its change.
    await second.getByRole("button", { name: "Edit layout", exact: true }).click();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/settings") && r.request().method() === "PUT" && r.ok(),
    );
    await page
      .locator('[data-widget-id="now"]')
      .getByRole("button", { name: /hide widget/i })
      .click();
    await saved;
    await second
      .locator('[data-widget-id="pulse"]')
      .getByRole("button", { name: /hide widget/i })
      .click();
    const conflict = second.getByText("Another window changed this layout. Your local edits are preserved.");
    await expect(conflict).toBeVisible();
    await expect(second.locator('[data-widget-id="now"]')).toBeVisible();
    await second.getByRole("button", { name: "Save my layout instead", exact: true }).click();
    await expect(conflict).toHaveCount(0);
    await second.reload();
    await expect(second.locator('[data-widget-id="now"]')).toBeVisible();
    await expect(second.locator('[data-widget-id="pulse"]')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

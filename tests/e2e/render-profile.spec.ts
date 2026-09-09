import { test, expect } from "@playwright/test";

test("visual economy persists and system reduced motion wins over immersive", async ({ page }) => {
  await page.goto("/#/settings?tab=theme");
  const profile = page.getByLabel("Visual performance", { exact: true });
  await profile.selectOption("economy");
  await expect(page.locator("html")).toHaveAttribute("data-render-profile", "economy");
  await page.reload();
  await expect(profile).toHaveValue("economy");
  await profile.selectOption("immersive");
  await expect(page.locator("html")).toHaveAttribute("data-render-profile", "immersive");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-render-profile", "economy");
  await expect(profile).toHaveValue("immersive");
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Second Brain", exact: true })
    .click();
  await expect(page.locator(".brain2 canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".brain2-list button[data-file]").first()).toBeVisible();
});

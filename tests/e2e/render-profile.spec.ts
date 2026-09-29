import { test, expect } from "@playwright/test";
import { openBrainList, travel } from "./shell";

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
  // The brain still answers in the economic profile: the sky is drawn still,
  // and its accessible list is there.
  await travel(page, "2", "brain");
  await expect(page.locator(".bs canvas").first()).toBeVisible();
  await openBrainList(page);
});

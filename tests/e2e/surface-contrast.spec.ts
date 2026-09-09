import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["dark", "light"]) {
  for (const route of [
    "/",
    "/skills",
    "/routines",
    "/runs",
    "/connectors",
    "/settings",
    "/brain",
    "/pixel",
  ]) {
    test(`surface contrast ${theme} ${route}`, async ({ page }) => {
      await page.route("**/api/meta", async (interception) => {
        const response = await interception.fetch();
        await interception.fulfill({ response, json: { ...(await response.json()), theme } });
      });
      await page.goto(`/#${route}`);
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready);
      const result = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      ).toEqual([]);
    });
  }
}

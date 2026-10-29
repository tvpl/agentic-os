/**
 * A failed request of the brain screens is said, not shown as "nothing found" (.specs/features/cerebro-correcoes,
 * C23, C25, C26): the search of the app frame's Second Brain and of the Núcleo brain scene, and the related files of
 * the Núcleo reader, in both themes, with axe over the error state.
 *
 * The interface and the theme are fed to the app through the two responses it reads them from, and the failures are
 * made by intercepting the one route each, so no test writes shared server state.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openBrainList } from "./shell";

type Theme = "dark" | "light";
type Shell = "moldura" | "nucleo";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SEARCH = /\/api\/(v1\/)?memory\/search\?/;
const RELATED = /\/api\/(v1\/)?memory\/related\?/;
const FAILED = /^(Search failed\.|A busca falhou\.)/;
const RETRY = /^(Try again|Tentar de novo)$/;

async function open(page: Page, shell: Shell, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), shell } });
  });
  await page.route("**/api/v1/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), theme } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/brain");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
}

const searchBox = (page: Page, shell: Shell) =>
  shell === "moldura" ? page.locator(".brain2 input.input").first() : page.locator(".bs-search input");

/** A search that succeeds with one known hit, then one that fails the way `fail` says. */
async function searchThenFail(page: Page, shell: Shell, fail: "500" | "network"): Promise<void> {
  let failing = false;
  await page.route(SEARCH, async (route) => {
    if (!failing)
      return route.fulfill({ json: [{ id: 1, name: "achado-antes.md", rel: "achado-antes.md" }] });
    if (fail === "500")
      return route.fulfill({ status: 500, json: { error: { code: "internal", message: "boom" } } });
    return route.abort("failed");
  });
  const box = searchBox(page, shell);
  await box.fill("antes");
  await expect(page.getByText("achado-antes.md").first()).toBeVisible();
  failing = true;
  await box.fill("depois");
  await expect(page.getByRole("alert").filter({ hasText: FAILED })).toBeVisible();
}

for (const shell of ["moldura", "nucleo"] as const) {
  for (const fail of ["500", "network"] as const) {
    test(`C23 a failed search (${fail}) on the ${shell} brain says so, with an icon and Try again, and no earlier hit`, async ({
      page,
    }) => {
      await open(page, shell, "dark");
      await searchThenFail(page, shell, fail);
      const alert = page.getByRole("alert").filter({ hasText: FAILED });
      await expect(alert.locator("svg")).toHaveCount(1);
      await expect(alert.getByRole("button", { name: RETRY })).toBeVisible();
      await expect(page.getByText("achado-antes.md")).toHaveCount(0);
    });
  }
}

test("C25 related files that fail to load are said in the Núcleo reader, with Try again, and none of the last node's", async ({
  page,
}) => {
  await open(page, "nucleo", "dark");
  let failing = false;
  await page.route(RELATED, async (route) => {
    if (!failing) return route.continue();
    return route.fulfill({ status: 500, json: { error: { code: "internal", message: "boom" } } });
  });
  const list = await openBrainList(page);
  const files = list.locator("button[data-file]");
  await files.first().click();
  await expect(page.locator(".bs-sheet")).toBeVisible();
  failing = true;
  await files.nth(1).click();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: /^(Could not load related files\.|Não foi possível carregar os relacionados\.)/ });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: RETRY })).toBeVisible();
  await expect(page.locator(".bs-rail-sec").filter({ hasText: /Nearby|Por perto/ })).toHaveCount(0);
});

for (const theme of ["dark", "light"] as const) {
  for (const shell of ["moldura", "nucleo"] as const) {
    test(`C26 the failed search of the ${shell} brain is 12px or more and has no serious axe violation (${theme})`, async ({
      page,
    }) => {
      await open(page, shell, theme);
      await searchThenFail(page, shell, "500");
      const alert = page.getByRole("alert").filter({ hasText: FAILED });
      const sizes = await alert.evaluate((el) =>
        [el, ...Array.from(el.querySelectorAll("*"))]
          .filter((node) => (node.textContent ?? "").trim().length > 0)
          .map((node) => parseFloat(getComputedStyle(node).fontSize)),
      );
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
      await page.waitForTimeout(300);
      const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id),
      ).toEqual([]);
    });
  }
}

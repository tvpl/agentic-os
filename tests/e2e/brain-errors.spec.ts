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
async function searchThenFail(page: Page, shell: Shell, fail: "500" | "403" | "network"): Promise<void> {
  let failing = false;
  await page.route(SEARCH, async (route) => {
    if (!failing)
      return route.fulfill({ json: [{ id: 1, name: "achado-antes.md", rel: "achado-antes.md" }] });
    if (fail === "500")
      return route.fulfill({ status: 500, json: { error: { code: "internal", message: "boom" } } });
    if (fail === "403")
      return route.fulfill({ status: 403, json: { error: { code: "scope_required", message: "no" } } });
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
  for (const fail of ["500", "403", "network"] as const) {
    test(`C23 a failed search (${fail}) on the ${shell} brain says so, with an icon and Try again, and no earlier hit`, async ({
      page,
    }) => {
      await open(page, shell, "dark");
      await searchThenFail(page, shell, fail);
      const alert = page.getByRole("alert").filter({ hasText: FAILED });
      await expect(alert.locator("svg")).toHaveCount(1);
      await expect(alert.getByRole("button", { name: RETRY })).toBeVisible();
      await expect(page.getByText("achado-antes.md")).toHaveCount(0);
      // in the place of the hits: right after the search box in the frame, inside the results in the Núcleo; the
      // message comes before the button
      const placed =
        shell === "moldura"
          ? page.locator(".brain2 input.input + .brain-request-failed")
          : page.locator(".bs-results .brain-request-failed");
      await expect(placed).toBeVisible();
      await expect(page.locator(shell === "moldura" ? ".brain-hits" : ".bs-hits")).toHaveCount(0);
      expect(await alert.evaluate((el) => el.lastElementChild?.tagName)).toBe("BUTTON");
      expect(await alert.evaluate((el) => el.firstElementChild?.textContent)).toMatch(FAILED);
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
  // in the place of the list: a section of the reader's rail, and no "Close, but not linked" list beside it (the
  // guard itself is proven on the component, BrainSceneReader.related.test.tsx)
  await expect(page.locator(".bs-reader .bs-rail .bs-rail-sec .brain-request-failed")).toBeVisible();
  await expect(
    page.locator(".bs-rail-sec").filter({ hasText: /Close, but not linked|Perto, sem ligação/ }),
  ).toHaveCount(0);
});

/** The smallest computed font size of the text inside an element (messages are 13px or more: design-system). */
async function smallestText(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) =>
      Math.min(
        ...[el, ...Array.from(el.querySelectorAll("*"))]
          .filter((node) =>
            Array.from(node.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? "").trim()),
          )
          .map((node) => parseFloat(getComputedStyle(node).fontSize)),
      ),
    );
}

async function seriousViolations(page: Page): Promise<string[]> {
  await page.waitForTimeout(300);
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

for (const theme of ["dark", "light"] as const) {
  for (const shell of ["moldura", "nucleo"] as const) {
    test(`C26 the failed search of the ${shell} brain is 13px or more and has no serious axe violation (${theme})`, async ({
      page,
    }) => {
      await open(page, shell, theme);
      await searchThenFail(page, shell, "500");
      // the message is running text (13px or more); the button's label is a label (12px or more): design-system
      expect(await smallestText(page, ".brain-request-failed-text")).toBeGreaterThanOrEqual(13);
      expect(await smallestText(page, ".brain-request-failed button")).toBeGreaterThanOrEqual(12);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
  test(`C26 the failed related files of the Núcleo reader are 13px or more and have no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await open(page, "nucleo", theme);
    await page.route(RELATED, (route) =>
      route.fulfill({ status: 500, json: { error: { code: "internal", message: "boom" } } }),
    );
    const list = await openBrainList(page);
    await list.locator("button[data-file]").first().click();
    const failed = page.locator(".bs-rail .brain-request-failed");
    await expect(failed).toBeVisible();
    expect(await smallestText(page, ".bs-rail .brain-request-failed-text")).toBeGreaterThanOrEqual(13);
    expect(await smallestText(page, ".bs-rail .brain-request-failed button")).toBeGreaterThanOrEqual(12);
    expect(await seriousViolations(page)).toEqual([]);
  });
}

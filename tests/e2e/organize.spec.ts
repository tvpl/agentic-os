/**
 * Settings › Memory › Agents' stance in a real browser (.specs/features/cerebro-organizar, C41 and C43; plan AC 31-33,
 * amendment 10; design-system/design.md): where the group sits on the Memory tab and that the Contexts section did not
 * move, and, in the light and the dark theme, its sizes (12px or more, 13px for the options and the sentences), the
 * error as an icon plus text, and axe at WCAG A/AA.
 *
 * The stance is real state of the isolated e2e home; a failing save is the route answering 500, fed through the
 * response the page reads. The theme is fed through the responses the app reads, as `contexts.spec.ts` does.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Theme = "dark" | "light";
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TITLE = "Agents' stance";

async function open(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), shell: "moldura" } });
  });
  await page.route("**/api/v1/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), theme } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/settings?tab=memory");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

/** The same request the page makes, with the page's own token. */
async function api(page: Page, method: string, url: string, body?: unknown): Promise<number> {
  return page.evaluate(
    async ([m, u, b]) => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="mordomo-token"]')?.content ?? "";
      const res = await fetch(u as string, {
        method: m as string,
        headers: { "x-mordomo-token": token, ...(b ? { "content-type": "application/json" } : {}) },
        ...(b ? { body: JSON.stringify(b) } : {}),
      });
      return res.status;
    },
    [method, url, body],
  );
}

const group = (page: Page) => page.getByRole("group", { name: TITLE });

/** Every element under `scope` that draws its own text, with its computed size. */
async function sizesUnder(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const out: Array<{ text: string; px: number }> = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of [root, ...root.querySelectorAll("*")] as HTMLElement[]) {
        if (el.closest("svg, [aria-hidden='true']")) continue;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        const rect = el.getBoundingClientRect();
        if (!own || !rect.width || !rect.height) continue;
        out.push({ text: own.slice(0, 60), px: parseFloat(getComputedStyle(el).fontSize) });
      }
    return out;
  }, scope);
}

/** Nothing under 12px, and the lines that are options or sentences (not the label) at 13px. */
async function sized(page: Page, prose: string[]) {
  const sizes = await sizesUnder(page, "fieldset.stance");
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.filter((s) => s.px < 12)).toEqual([]);
  for (const line of prose) {
    const found = sizes.filter((s) => s.text.startsWith(line));
    expect(found.length, `${line} on screen`).toBeGreaterThan(0);
    for (const s of found) expect(s.px, line).toBeGreaterThanOrEqual(13);
  }
}

async function axe(page: Page) {
  const inGroup = await new AxeBuilder({ page }).include("fieldset.stance").withTags(WCAG_TAGS).analyze();
  expect(
    inGroup.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  const whole = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    whole.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

test.afterEach(async ({ page }) => {
  if (page.url().startsWith("http"))
    await api(page, "PUT", "/api/v1/settings", { memory: { agentStance: "neutral" } });
});

test("C41 on Settings › Memory the group Agents' stance is the last block, below the registries field, and the Contexts section still sits right after the indexed folders", async ({
  page,
}) => {
  await open(page, "dark");
  const g = group(page);
  await expect(g).toBeVisible();
  // The last element of the tab's card.
  const last = await g.evaluate((el) => el.parentElement!.lastElementChild === el);
  expect(last).toBe(true);
  const registries = (await page.locator("#st-registries").boundingBox())!;
  const box = (await g.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(registries.y + registries.height - 1);

  const section = page.locator(".ctx-settings");
  await expect(section).toBeVisible();
  const addFolder = (await page.locator("#st-newfolder").boundingBox())!;
  const contexts = (await section.boundingBox())!;
  const areas = (await page.locator("#st-areas").boundingBox())!;
  expect(contexts.y).toBeGreaterThanOrEqual(addFolder.y + addFolder.height - 1);
  expect(contexts.y + contexts.height).toBeLessThanOrEqual(areas.y + 1);
});

for (const theme of THEMES) {
  test(`C43 the group reads at 12px or more (13px for the options and the sentences), shows a failed save as an icon and a text, and passes axe at WCAG A/AA (${theme})`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page, theme);
    const g = group(page);
    await g.scrollIntoViewIfNeeded();
    await expect(g.getByRole("radio", { name: "Neutral" })).toBeChecked();
    await sized(page, ["Neutral", "Contest what conflicts with the goals", "How the compiled AGENTS.md"]);
    await axe(page);

    // A save the service refuses: the reason beside an icon, and the option that was saved still checked.
    await page.route(/\/api\/v1\/settings$/, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({
        status: 500,
        json: { error: { code: "internal", message: "Internal error" }, message: "Internal error" },
      });
    });
    await g.getByRole("radio", { name: "Contest what conflicts with the goals" }).click();
    const alert = g.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert.locator("svg")).toHaveCount(1);
    await expect(alert).not.toHaveText("");
    await expect(g.getByRole("radio", { name: "Neutral" })).toBeChecked();
    await sized(page, [(await alert.innerText()).trim().slice(0, 20)]);
    await axe(page);
    await page.unroute(/\/api\/v1\/settings$/);
  });
}

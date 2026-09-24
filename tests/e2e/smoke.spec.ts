/**
 * Command Centre smoke: every route renders without console errors, the app
 * chrome never covers page actions (audit item 12), the desktop stacks on a
 * phone, and axe finds no serious/critical violations.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES: Array<[string, string]> = [
  ["desktop", "/#/"],
  ["skills", "/#/skills"],
  ["skill-detail", "/#/skills/workspace-digest"],
  ["brain", "/#/brain"],
  ["routines", "/#/routines"],
  ["runs", "/#/runs"],
  ["connectors", "/#/connectors"],
  ["pixel", "/#/pixel"],
  ["settings", "/#/settings"],
];

async function open(page: Page, route: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  const response = await page.goto(route);
  expect(response?.ok(), "app document must load successfully").toBe(true);
  await expect(page.locator(".os-root")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  return errors;
}

for (const [name, route] of ROUTES) {
  test(`route ${name} renders cleanly`, async ({ page }) => {
    const errors = await open(page, route);
    expect(errors, errors.join("\n")).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
}

test("panel chrome does not overlap page actions", async ({ page }) => {
  // `/skills` is a deep link into the Skills panel (G2).
  await open(page, "/#/skills");
  const panel = page.locator('[data-panel="app:skills"]');
  const chrome = panel.locator(".panel-head");
  await expect(chrome).toBeVisible();
  const newSkill = panel.getByRole("button", { name: /new skill|nova skill/i }).first();
  await expect(newSkill).toBeVisible();
  const a = await chrome.boundingBox();
  const b = await newSkill.boundingBox();
  expect(a && b && a.y + a.height <= b.y + 1, "chrome must sit above the page header").toBe(true);
  await newSkill.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Escape inside the modal must not close the panel (audit item 14).
  await expect(panel).toBeVisible();
});

test("launcher opens with Ctrl+M and searches skills", async ({ page }) => {
  await open(page, "/#/");
  await page.keyboard.press("Control+M");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("digest");
  await expect(dialog.getByRole("option").first()).toContainText(/digest/i);
  await page.keyboard.press("Enter");
  // The skill opens inside the Skills panel; the URL hands itself back to the desktop.
  const panel = page.locator('[data-panel="app:skills"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: /digest/i }).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test("desktop stacks widgets on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/#/");
  await expect(page.locator(".desktop-widgets.stacked")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});

test("run detail streams a fake run to completion", async ({ page }) => {
  await open(page, "/#/runs");
  // The Runs app is a panel beside the console now (G2): the prompt and the
  // Run button have to be the app's own, not the console's.
  const runs = page.locator('[data-panel="app:runs"]');
  await runs
    .getByLabel(/prompt/i)
    .first()
    .fill("hello from e2e");
  await runs
    .getByRole("button", { name: /^run|executar/i })
    .first()
    .click();
  // The run's trace opens as its own panel beside the Runs app (G3).
  const trace = page.locator('[data-panel^="run:"]');
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".run-title .badge")).toHaveText(/done|conclu/i, { timeout: 20_000 });
});

for (const [name, route] of [
  ["desktop", "/#/"],
  ["skills", "/#/skills"],
  ["settings", "/#/settings"],
  ["brain", "/#/brain"],
  ["runs", "/#/runs"],
  ["routines", "/#/routines"],
  ["connectors", "/#/connectors"],
] as const) {
  test(`axe: no serious violations on ${name}`, async ({ page }) => {
    await open(page, route);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

/**
 * Command Centre smoke: every route renders without console errors, the
 * shell's chrome never covers a scene's actions (audit item 12), and axe
 * finds no serious/critical violations. (The phone layout is covered by
 * nucleo-shell.spec.ts.)
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openRunFromTurn, sendPrompt } from "./shell";

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

test("the shell's chrome does not cover a scene's actions, and a modal's Escape is its own", async ({
  page,
}) => {
  await open(page, "/#/skills");
  // The scene's actions live under its "+" (conceito em todo o sistema, AC 23).
  const newSkill = page.getByTestId("skills-more");
  await expect(newSkill).toBeVisible();
  // Nothing of the HUD, the spine or the voice line is drawn over it.
  const onTop = await newSkill.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(onTop, "the scene's action is covered").toBe(true);
  await newSkill.click();
  await page.getByRole("menuitem", { name: /new skill|nova skill/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Escape inside the modal must not take the scene away (audit item 14).
  await expect(page).toHaveURL(/#\/skills$/);
  await expect(page.locator('.nu-scene.on[data-scene="skills"]')).toBeVisible();
  // The same for a production view's page actions.
  await page.goto("/#/connectors");
  await expect(page.locator('.nu-scene.on[data-scene="connectors"] .page')).toBeVisible();
  // Once the zoom into the scene is over: mid-travel the page is still growing
  // out of where the journey started, and the scene being left is drawn over it.
  await expect(page.locator("section.nu-scene")).toHaveCount(1);
  await expect(page.locator(".nu-scene.on")).not.toHaveClass(/\bin-zoom\b/);
  const action = page.locator('[data-onboarding="connectors"] .page button:visible').first();
  const clear = await action.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(clear, "the page's first action is covered").toBe(true);
});

test("launcher opens with Ctrl+M and searches skills", async ({ page }) => {
  await open(page, "/#/");
  await page.keyboard.press("Control+M");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("digest");
  await expect(dialog.getByRole("option").first()).toContainText(/digest/i);
  await page.keyboard.press("Enter");
  // The skill is chosen on the Skills scene's ring, and the URL names it.
  await expect(page).toHaveURL(/#\/skills\/[^/]*digest/);
  await expect(page.locator('.nu-scene.on[data-scene="skills"] .sks-name')).toContainText(/digest/i);
});

test("run detail streams a fake run to completion", async ({ page }) => {
  await open(page, "/#/");
  // The voice line is the one place to type a request (refino item 12 took
  // the prompt form out of the Runs app).
  const id = await sendPrompt(page, "hello from e2e");
  // The conversation follows it; its "Open run →" projects the trace beside the core.
  await openRunFromTurn(page);
  const trace = page.locator(`article.nu-lamina[data-lamina="run:${id}"]`);
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

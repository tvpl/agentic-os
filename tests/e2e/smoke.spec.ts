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

// escopos-dispositivo, C42: the page keeps its event stream, and the stream is opened with a ticket, not a token.
test("C42 the event stream opens with a ticket and no token in any URL", async ({ page }) => {
  const urls: string[] = [];
  const posts: string[] = [];
  page.on("request", (req) => {
    urls.push(req.url());
    if (req.method() === "POST" && req.url().includes("/stream-tickets")) posts.push(req.url());
  });
  const errors = await open(page, "/#/");
  expect(errors, errors.join("\n")).toEqual([]);
  // The stream is up: the shell asked for a ticket and opened the feed with it.
  await expect.poll(() => urls.some((u) => /\/api\/v1\/events\?ticket=tk_/.test(u))).toBe(true);
  expect(posts.length).toBeGreaterThan(0);
  // Nothing the browser requested carries the token in its URL.
  expect(urls.filter((u) => /[?&]token=/.test(u))).toEqual([]);
  // And the feed delivers: an event the server emits reaches the page (the run list refetches on `run.created`).
  const token = process.env.MORDOMO_TOKEN!;
  const before = urls.filter((u) => /\/api\/v1\/runs(\?|$)/.test(u)).length;
  const created = await page.request.post("/api/v1/runs", {
    headers: { "x-mordomo-token": token, "content-type": "application/json" },
    data: { prompt: "ticket smoke", mode: "read_only" },
  });
  expect(created.ok()).toBe(true);
  await expect
    .poll(() => urls.filter((u) => /\/api\/v1\/runs(\?|$)/.test(u)).length, { timeout: 15_000 })
    .toBeGreaterThan(before);
});

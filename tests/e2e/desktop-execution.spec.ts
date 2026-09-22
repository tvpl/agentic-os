/**
 * Execution on the stage (redesign G3): a run is a panel, its inputs are a
 * panel, its result is a panel, and every one of them is something the
 * console can point at. Nothing here leaves the desktop.
 */
import { test, expect, type Page } from "@playwright/test";
import { resetStage } from "./stage";

async function openDesktop(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("[data-console]")).toBeVisible();
}

test("console → trace panel → result panel → reference in the next prompt", async ({ page, request }) => {
  await resetStage(request);
  await openDesktop(page);
  const consolePanel = page.locator("[data-console]");
  // The fake provider writes `report.md` into this run's own artifacts directory.
  await consolePanel.locator("textarea").fill("write me a report [[artifact:report.md]]");
  await consolePanel
    .getByRole("button", { name: /^run|executar/i })
    .first()
    .click();
  // The trace opens as a panel on the stage, on top, with the run's own title.
  const trace = page.locator('[data-panel^="run:"]');
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".panel-title")).toHaveText(/^run-[0-9a-f]{8}/);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  // The result lands beside it — once, as one panel, readable.
  const result = page.locator('[data-panel^="doc:"]');
  await expect(result).toHaveCount(1);
  await expect(result.locator(".panel-title")).toHaveText("report.md");
  await expect(result.locator(".panel-body")).toContainText("Written by the fake provider");
  // The desktop is still the page; the URL never left it.
  await expect(page.locator(".desktop")).toHaveCount(1);
  await expect(page).toHaveURL(/#\/$/);
  // Both are in the dock as open panels, and both are referenceable from the console.
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(dock.getByRole("button", { name: /Open panels: run-/ })).toHaveCount(1);
  await expect(dock.getByRole("button", { name: "Open panels: report.md" })).toHaveCount(1);
  await result.locator(".panel-ref").click();
  await expect(consolePanel.locator("textarea")).toHaveValue(/^@report\.md /);
  await trace.locator(".panel-ref").click();
  await expect(consolePanel.locator("textarea")).toHaveValue(/@report\.md @run-[0-9a-f]{8} $/);
});

test("a skill with required inputs asks on the stage, then runs; the form leaves when the run arrives", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await openDesktop(page);
  await page.keyboard.press("ControlOrMeta+j");
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  // The seat shows the skill's name; the title carries the slug.
  await deck.locator('.deck-skill[title^="/code-review"]').click();
  const form = page.locator('[data-panel="form:code-review"]');
  await expect(form).toBeVisible();
  await expect(form.locator(".panel-title")).toHaveText("/code-review · inputs");
  await expect(deck).toHaveCount(0);
  // An empty required field is refused in place, not by the server.
  await form.getByRole("button", { name: /^run|executar/i }).click();
  await expect(form.locator("[aria-invalid='true']")).toHaveCount(1);
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(page.locator('[data-panel^="run:"]')).toHaveCount(0);
  await form.locator("input, textarea").first().fill("apps/command-centre");
  await form.getByRole("button", { name: /^run|executar/i }).click();
  const trace = page.locator('[data-panel^="run:"]');
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".panel-title")).toHaveText(/^run-[0-9a-f]{8} · \/code-review$/);
  // The form's job is done: it is gone, from the stage and from the dock.
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open panels: /code-review · inputs" })).toHaveCount(0);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
});

test("a write-mode skill waits in the approvals panel; approving opens its trace", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await openDesktop(page);
  await page.keyboard.press("ControlOrMeta+j");
  await page.locator('.skill-deck .deck-skill[title^="/consolidate-memory"]').click();
  const approvals = page.locator('[data-panel="approvals"]');
  await expect(approvals).toBeVisible();
  await expect(approvals).toHaveClass(/\bon\b/);
  await expect(approvals.locator(".panel-body")).toContainText(/consolidate-memory/);
  // A pending decision is "waiting for you", not an alarm (refino item 21).
  await expect(page.locator(".desktop")).toHaveAttribute("data-core", "waiting");
  await approvals
    .getByRole("button", { name: /^approve|aprovar/i })
    .first()
    .click();
  const trace = page.locator('[data-panel^="run:"]');
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".panel-title")).toHaveText(/\/consolidate-memory$/);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  await expect(approvals.locator(".panel-body")).not.toContainText(/consolidate-memory/);
});

test("a run's route is a deep link into its trace panel", async ({ page, request }) => {
  await resetStage(request);
  await openDesktop(page);
  const consolePanel = page.locator("[data-console]");
  await consolePanel.locator("textarea").fill("hello from a deep link");
  await consolePanel
    .getByRole("button", { name: /^run|executar/i })
    .first()
    .click();
  const trace = page.locator('[data-panel^="run:"]');
  await expect(trace).toHaveCount(1);
  const id = (await trace.getAttribute("data-panel"))!.slice("run:".length);
  await trace.getByRole("button", { name: /^close|^fechar/i }).click();
  await expect(trace).toHaveCount(0);
  await page.goto(`/#/runs/${id}`);
  await expect(page.locator(`[data-panel="run:${id}"]`)).toBeVisible();
  await expect(page.locator(".desktop")).toHaveCount(1);
  await expect(page).toHaveURL(/#\/$/);
});

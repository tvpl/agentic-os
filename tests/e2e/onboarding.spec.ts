import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: { cookies: [], origins: [] } });
const key = "mordomo.onboarding.v1";

test("first visit can skip, stays dismissed after reload, and resumes from Settings", async ({ page }) => {
  await page.goto("/#/");
  const guide = page.getByTestId("onboarding");
  await expect(guide.getByRole("heading", { name: /Your next step/ })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("welcome-desktop.png") });
  await guide.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".desktop")).toBeVisible();
  await page.waitForTimeout(1700);
  await expect(guide).toHaveCount(0);
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "OS guide", exact: true }).click();
  await guide.getByRole("button", { name: "Let's get started" }).click();
  await guide.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(guide.getByRole("heading", { name: "A space that moves with you." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.locator(".os-root")).not.toHaveAttribute("inert");
  await page.getByRole("button", { name: "OS guide", exact: true }).click();
  await guide.getByRole("button", { name: "Continue where I left off" }).click();
  await expect(guide.getByRole("heading", { name: "A space that moves with you." })).toBeVisible();
});

test("interactive journey visits real apps, practices safely and hands off a draft", async ({ page }) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    // Switching space is a settings write, and the tour teaches it on purpose.
    // What must stay untouched is the user's work: runs, skills, routines.
    if (
      request.url().includes("/api/") &&
      !request.url().includes("/api/settings") &&
      ["POST", "PUT", "DELETE", "PATCH"].includes(request.method())
    )
      writes.push(request.url());
  });
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "mordomo.console.workspaceDraft.v1",
      JSON.stringify({ version: 1, text: "Existing draft", cwd: "/tmp", sessionId: null }),
    ),
  );
  await page.goto("/#/");
  const guide = page.getByTestId("onboarding");
  await guide.getByRole("button", { name: "Let's get started" }).click();
  await guide.getByRole("button", { name: "Next step", exact: true }).click();
  // The tour now teaches spaces (redesign F6), not the old display modes.
  const realSpaces = page.locator('[data-onboarding="modes"]');
  await realSpaces.getByRole("button", { name: "Research", exact: true }).click();
  await expect(realSpaces.getByRole("button", { name: "Research", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(guide.getByRole("status")).toContainText("as you left it");
  await guide.getByRole("button", { name: "Ops", exact: true }).click();
  await guide.getByRole("button", { name: "Next step", exact: true }).click();
  await guide.getByRole("button", { name: "Use an example" }).click();
  await expect(guide.getByLabel("Practice draft")).toContainText("Do not change anything");
  await guide.getByLabel("Practice draft").fill("Summarize this folder without changing files.");
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("console-practice.png") });
  await guide.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings\?tab=providers$/);
  await expect(page.locator("#settings-tabs-panel-providers")).toBeVisible();
  await page.reload();
  await expect(guide.getByRole("heading", { name: "Choose who works with you." })).toBeVisible();
  for (const route of ["brain", "skills", "runs"]) {
    await guide.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.locator(".ob-spotlight")).toBeVisible();
  }
  await guide.getByRole("button", { name: "Approve without checking" }).click();
  await expect(guide.getByRole("status")).toContainText("First check");
  await guide.getByRole("button", { name: "Review the action and decide" }).click();
  await expect(guide.getByRole("status")).toContainText("Exactly");
  await guide.getByRole("button", { name: "Next step", exact: true }).click();
  await guide.getByRole("button", { name: "View generations" }).click();
  await expect(page).toHaveURL(/#\/generations$/);
  await expect(page.locator('[data-onboarding="generations"]')).toBeVisible();
  for (const route of ["routines", "connectors", "pixel", "settings"]) {
    await guide.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}`));
  }
  await guide.getByRole("button", { name: "Security", exact: true }).click();
  await expect(page.locator("#settings-tabs-panel-security")).toBeVisible();
  await guide.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.locator("#settings-tabs-panel-notifications")).toBeVisible();
  await guide.getByRole("button", { name: "Finish the journey" }).click();
  await expect(guide).toContainText("12/12 areas explored");
  await guide.getByRole("button", { name: "Bring draft to console" }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.locator(".promptw-input")).toHaveValue(
    "Existing draft\n\nSummarize this folder without changing files.",
  );
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  const stored = await page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
  expect(stored.status).toBe("completed");
});

test("mobile, Portuguese, reduced motion, keyboard and accessible welcome", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), language: "pt-BR" } });
  });
  await page.goto("/#/");
  const guide = page.getByTestId("onboarding");
  await expect(guide.getByRole("heading", { name: /Seu próximo passo/ })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("welcome-mobile.png") });
  const violations = (await new AxeBuilder({ page }).include(".onboarding").analyze()).violations.filter(
    (v) => ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(violations).toEqual([]);
  await guide.getByRole("button", { name: "Vamos começar" }).click();
  for (let i = 0; i < 2; i++) await guide.getByRole("button", { name: "Próximo passo", exact: true }).click();
  await expect(guide.getByRole("textbox")).toBeVisible();
  await expect(page.locator(".ob-spotlight")).toBeVisible();
  await expect
    .poll(async () => (await page.locator('[data-widget-id="prompt"]').boundingBox())?.y)
    .toBeLessThan(150);
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("practice-mobile.png") });
  await page.keyboard.press("Tab");
  expect(await guide.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  const box = await guide.locator(".ob-dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(
    await page.locator(".ob-step-content").evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
});

test("command palette reopens a completed guide and restart starts at the desktop", async ({ page }) => {
  await page.addInitScript(
    (name) =>
      localStorage.setItem(name, JSON.stringify({ version: 1, status: "completed", step: 12, visited: [] })),
    key,
  );
  await page.goto("/#/");
  await expect(page.locator(".desktop")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByRole("combobox").fill("guide");
  await page.getByRole("option", { name: /Interactive OS guide/ }).click();
  const guide = page.getByTestId("onboarding");
  await guide.getByRole("button", { name: "Let's get started" }).click();
  await expect(guide.getByRole("heading", { name: "Your day starts here." })).toBeVisible();
});

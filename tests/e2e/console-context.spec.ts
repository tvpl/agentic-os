import { test, expect } from "@playwright/test";

test("draft keeps its selected project across app navigation and reload", async ({ page }) => {
  await page.goto("/#/");
  const widget = page.locator('[data-widget-id="prompt"]');
  const picker = widget.locator("select.promptw-cwd");
  await expect(picker.locator("option")).not.toHaveCount(1);
  const folder = await picker.locator("option").nth(1).getAttribute("value");
  expect(folder).toBeTruthy();
  await picker.selectOption(folder!);
  await widget.locator("textarea").fill("Review the mobile workspace");
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  await dock.getByRole("button", { name: "Pixel Studio", exact: true }).click();
  await expect(page.locator(".pxs-stage")).toBeVisible();
  // Back to the desktop: the dock's Dashboard app, not a mode.
  await dock.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(picker).toHaveValue(folder!);
  await expect(widget.locator("textarea")).toHaveValue("Review the mobile workspace");
  await page.reload();
  await expect(picker).toHaveValue(folder!);
  await expect(widget.locator("textarea")).toHaveValue("Review the mobile workspace");
  // Verify the actual submission target without invoking even the fake provider.
  let submitted: { cwd?: string } | undefined;
  await page.route("**/api/runs", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 409,
      json: { error: { code: "fixture", message: "Submission inspected" } },
    });
  });
  await widget.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => submitted?.cwd).toBe(folder);
});

test("a draft whose project disappeared cannot silently run in the home directory", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "mordomo.console.workspaceDraft.v1",
      JSON.stringify({
        version: 1,
        text: "Edit files",
        cwd: "/missing/mobile-project",
        sessionId: null,
      }),
    ),
  );
  await page.goto("/#/");
  const widget = page.locator('[data-widget-id="prompt"]');
  await expect(widget.getByText(/saved project folder is unavailable/)).toBeVisible();
  await expect(widget.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await widget.locator("select.promptw-cwd").selectOption("");
  await expect(widget.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  await expect(widget.locator("textarea")).toHaveValue("Edit files");
});

test("brain reference reaches the console without replacing the draft or executing a task", async ({
  page,
}) => {
  let launches = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/(runs|sessions\/[^/]+\/runs)$/.test(new URL(request.url()).pathname)
    )
      launches++;
  });
  await page.goto("/#/");
  const widget = page.locator('[data-widget-id="prompt"]');
  await widget.locator("textarea").fill("Keep my existing request");
  const picker = widget.locator("select.promptw-cwd");
  const folder = await picker.locator("option").nth(1).getAttribute("value");
  await picker.selectOption(folder!);
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Second Brain", exact: true })
    .click();
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const source = page.locator(".brain2-list button[data-file]").first();
  const sourcePath = await source.getAttribute("title");
  await source.click();
  await page.getByRole("button", { name: "Use in console", exact: true }).click();
  await expect(widget.locator("textarea")).toHaveValue(new RegExp("^Keep my existing request"));
  expect(await widget.locator("textarea").inputValue()).toContain(JSON.stringify(sourcePath));
  await expect(picker).toHaveValue(folder!);
  await expect(widget).toBeVisible();
  expect(launches).toBe(0);
});

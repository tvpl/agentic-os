import { test, expect } from "@playwright/test";
import {
  arrived,
  foldConversation,
  openAppFromPalette,
  openBrainList,
  openConversation,
  openShell,
  openVoiceControls,
  travelBySpine,
} from "./shell";

test("draft keeps its selected project across scene travel and reload", async ({ page }) => {
  await openShell(page);
  const widget = page.locator("[data-console]");
  const side = await openVoiceControls(page);
  const picker = side.locator("select.cons-cwd");
  await expect(picker.locator("option")).not.toHaveCount(1);
  const folder = await picker.locator("option").nth(1).getAttribute("value");
  expect(folder).toBeTruthy();
  await picker.selectOption(folder!);
  await widget.locator("textarea").fill("Review the mobile workspace");
  // Another scene: the voice line is the same one, in the same place.
  await openAppFromPalette(page, "Pixel Studio");
  await arrived(page, "pixel");
  await expect(page.locator(".pxs-stage")).toBeVisible();
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
  await openShell(page);
  const widget = page.locator("[data-console]");
  // The reason is in the conversation, the moment you go to the line — not
  // behind the controls button.
  await openConversation(page);
  await expect(widget.getByText(/saved project folder is unavailable/)).toBeVisible();
  await expect(widget.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  const side = await openVoiceControls(page);
  await side.locator("select.cons-cwd").selectOption("");
  await expect(widget.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  await expect(widget.locator("textarea")).toHaveValue("Edit files");
});

test("brain reference reaches the voice line without replacing the draft or executing a task", async ({
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
  await openShell(page);
  const widget = page.locator("[data-console]");
  await widget.locator("textarea").fill("Keep my existing request");
  const side = await openVoiceControls(page);
  const picker = side.locator("select.cons-cwd");
  const folder = await picker.locator("option").nth(1).getAttribute("value");
  await picker.selectOption(folder!);
  // The conversation folds back into the line before you go somewhere else.
  await foldConversation(page);
  await travelBySpine(page, "brain");
  const list = await openBrainList(page);
  const source = list.locator("button[data-file]").first();
  const sourcePath = await source.getAttribute("title");
  await source.click();
  await page
    .locator(".bs-sheet")
    .getByRole("button", { name: /^(Reference in the voice line|Referenciar na voz)$/ })
    .click();
  // The reference arrives by event once the preview is read.
  await expect.poll(() => widget.locator("textarea").inputValue()).toContain(JSON.stringify(sourcePath));
  await expect(widget.locator("textarea")).toHaveValue(new RegExp("^Keep my existing request"));
  await expect(widget.locator("textarea")).toBeFocused();
  await expect(picker).toHaveValue(folder!);
  await expect(widget).toBeVisible();
  expect(launches).toBe(0);
});

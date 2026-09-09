import { test, expect } from "@playwright/test";

test("microapps and onboarding navigate to usable content without reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/");
  await page.locator('.microapp-row[href="#/brain"]').click();
  await expect(page.locator(".brain2")).toBeVisible();
  await expect(page.locator(".desktop")).toHaveCount(0);
  await page.getByRole("button", { name: /zoom in|aproximar/i }).click();
  await page.locator(".brain-panel-toggle").click();
  await expect(page.locator(".brain2-panel")).toHaveClass(/collapsed/);
  await page.keyboard.press("/");
  await expect(page.locator(".brain2-panel input").first()).toBeFocused();
  await page.getByRole("button", { name: /back to.*os|voltar ao os/i }).click();
  await page.locator('.microapp-row[href="#/pixel"]').click();
  await expect(page.locator(".app-frame-title")).toHaveText(/Pixel Studio/);
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: /back to.*os|voltar ao os/i }).click();
  const step = page.locator(".now-next-actions a");
  if (await step.count()) {
    await step.click();
    await expect(page.locator(".desktop")).toHaveCount(0);
    await expect(page.locator(".app-frame")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("console maximizes, restores, resizes and Now stays hidden after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/");
  const consoleWidget = page.locator('[data-widget-id="prompt"]');
  const input = consoleWidget.locator("textarea");
  await input.fill("Keep my draft");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/qa-desktop.png" });
  const original = await consoleWidget.boundingBox();
  await consoleWidget.getByRole("button", { name: /^Maximize:/ }).click();
  await expect(consoleWidget).toHaveClass(/maximized/);
  expect((await consoleWidget.boundingBox())!.width).toBeGreaterThan(original!.width);
  await expect(input).toHaveValue("Keep my draft");
  await page.screenshot({ path: "artifacts/qa-console.png" });
  await page.keyboard.press("Escape");
  await expect(consoleWidget).not.toHaveClass(/maximized/);
  await consoleWidget.locator(".widget-resize").focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await consoleWidget.boundingBox())!.height).toBeLessThan(original!.height);
  await page
    .locator('[data-widget-id="now"]')
    .getByRole("button", { name: /hide widget|ocultar widget/i })
    .click();
  await expect(page.locator('[data-widget-id="now"]')).toHaveCount(0);
  await page.waitForTimeout(1000); // persisted layout mutation is debounced
  await page.reload();
  await expect(consoleWidget).toBeVisible();
  await expect(page.locator('[data-widget-id="now"]')).toHaveCount(0);
});

test("Portuguese notification opens its destination, not just its read state", async ({ page }) => {
  await page.route("**/api/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), language: "pt-BR" } });
  });
  await page.route("**/api/notifications?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "n_fixture",
            kind: "index",
            title: "Index finished",
            body: "7 scanned · 5 added",
            ts: Date.now(),
            read: false,
            href: "/brain",
          },
        ],
        unread: 1,
      },
    }),
  );
  await page.goto("/#/");
  await page.locator(".bell").click();
  await expect(page.locator(".bell-pop")).toContainText("Indexação concluída");
  await page.locator(".bell-pop .inbox-main").click();
  await expect(page.locator(".brain2")).toBeVisible();
  await expect(page.locator(".desktop")).toHaveCount(0);
});

test("expired Claude authentication explains recovery and opens provider settings", async ({ page }) => {
  const run = {
    id: "auth-fixture",
    sessionId: "session-fixture",
    provider: "claude",
    status: "failed",
    promptSummary: "Read workspace",
    createdAt: Date.now(),
    error: "Failed to authenticate: OAuth session expired and could not be refreshed",
    durationMs: 2400,
  };
  await page.addInitScript(() => localStorage.setItem("mordomo.console.session", "session-fixture"));
  await page.route("**/api/sessions/session-fixture", (route) =>
    route.fulfill({
      json: { session: { id: "session-fixture", provider: "claude", turns: 1, costUsd: 0 }, runs: [run] },
    }),
  );
  await page.route("**/api/runs/auth-fixture", (route) => route.fulfill({ json: { run, events: [] } }));
  await page.goto("/#/");
  await expect(page.locator(".auth-recovery")).toContainText("claude auth login");
  await page.locator(".auth-recovery a").click();
  await expect(page).toHaveURL(/#\/settings\?tab=providers/);
  await expect(page.locator(".app-frame-title")).toHaveText(/settings/i);
  await expect(page.locator(".desktop")).toHaveCount(0);
});

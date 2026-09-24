import { test, expect, type Page } from "@playwright/test";

type Health = { ok: boolean; installed: boolean; authenticated: boolean | "unknown" };
/** Serve the real provider list with the health each test needs. */
async function mockProviders(
  page: Page,
  health: Record<string, Partial<Health>>,
  enabled: Record<string, boolean>,
) {
  await page.route("**/api/providers*", async (route) => {
    const response = await route.fetch();
    const data = (await response.json()).map((p: { id: string; health: Health; enabled: boolean }) => ({
      ...p,
      enabled: enabled[p.id] ?? p.enabled,
      isDefault: p.id === "claude",
      health: { ...p.health, ...(health[p.id] ?? {}) },
    }));
    await route.fulfill({ response, json: data });
  });
}

test("a signed-out AI is configured before anything else, and the console refuses to run blind", async ({
  page,
}) => {
  const signedOut = {
    claude: { ok: false, installed: true, authenticated: false },
    codex: { ok: false, installed: false, authenticated: false },
  };
  await mockProviders(page, signedOut, { claude: true, codex: true, cursor: false });
  await page.goto("/#/");
  const gate = page.getByTestId("provider-gate");
  await expect(gate.getByRole("heading", { name: "Connect your AI first" })).toBeVisible();
  await expect(gate.getByTestId("gate-provider-claude")).toContainText("login required");
  await expect(gate.getByTestId("gate-provider-claude")).toContainText("claude auth login");
  await expect(gate.getByTestId("gate-provider-codex")).toContainText("not found on this computer");
  await expect(gate.getByTestId("gate-provider-codex")).toContainText("npm install -g @openai/codex");
  // The tour waits behind the gate.
  await page.waitForTimeout(1700);
  await expect(page.getByTestId("onboarding")).toHaveCount(0);

  await gate.getByRole("button", { name: "Continue anyway" }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByTestId("provider-state")).toHaveText("login required");

  // Console pre-flight: no run is created for a provider that cannot answer.
  const runs: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/runs$/.test(request.url())) runs.push(request.url());
  });
  await page.locator(".cons-input").fill("List the files in this folder");
  await page.locator(".cons-input").press("Meta+Enter");
  await expect(page.getByTestId("console-preflight")).toContainText("claude auth login");
  expect(runs).toEqual([]);
});

test("the gate closes by itself once a provider checks out", async ({ page }) => {
  let signedIn = false;
  await page.route("**/api/providers*", async (route) => {
    const response = await route.fetch();
    const data = (await response.json()).map((p: { id: string; health: Health; enabled: boolean }) => ({
      ...p,
      enabled: p.id === "claude",
      isDefault: p.id === "claude",
      health: signedIn
        ? { ...p.health, ok: true, installed: true, authenticated: true }
        : { ...p.health, ok: false, installed: true, authenticated: false },
    }));
    await route.fulfill({ response, json: data });
  });
  await page.goto("/#/");
  const gate = page.getByTestId("provider-gate");
  await expect(gate).toBeVisible();
  signedIn = true;
  await gate.getByRole("button", { name: "Check again" }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByTestId("provider-state")).toHaveCount(0);
});

test("an unverified login never blocks the OS", async ({ page }) => {
  await mockProviders(
    page,
    { claude: { ok: false, installed: true, authenticated: "unknown" } },
    { claude: true, codex: false, cursor: false },
  );
  await page.goto("/#/");
  await expect(page.locator(".desktop")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("provider-gate")).toHaveCount(0);
  await expect(page.getByTestId("provider-state")).toHaveText("login not verified");
});

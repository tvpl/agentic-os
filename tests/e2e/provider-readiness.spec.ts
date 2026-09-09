import { test, expect } from "@playwright/test";

test("unverified authentication is not green or labelled OK and can be checked again", async ({ page }) => {
  await page.route("**/api/providers?*", async (route) => {
    const response = await route.fetch();
    const verified = new URL(route.request().url()).searchParams.get("force") === "1";
    const data = (await response.json()).map((provider: { id: string; health: object }) => ({
      ...provider,
      isDefault: provider.id === "claude",
      health: {
        ...provider.health,
        installed: true,
        ok: verified,
        authenticated: verified ? true : "unknown",
      },
    }));
    await route.fulfill({ response, json: data });
  });
  // Both the ordinary query and the explicit forced query are covered.
  await page.route("**/api/providers", async (route) => {
    const response = await route.fetch();
    const data = (await response.json()).map((provider: { id: string; health: object }) => ({
      ...provider,
      isDefault: provider.id === "claude",
      health: { ...provider.health, installed: true, ok: false, authenticated: "unknown" },
    }));
    await route.fulfill({ response, json: data });
  });
  await page.goto("/#/");
  await expect(page.locator(".os-topbar > .side").first().locator(".dot")).toHaveClass(/warn/);
  await page.goto("/#/settings?tab=providers");
  const provider = page.locator(".provider-row").first();
  await expect(provider.locator(".meta")).toContainText("not verified");
  await page.getByRole("button", { name: "Verify providers again" }).click();
  await expect(provider.locator(".meta")).toContainText(/auth.*ok/i);
  await expect(provider.locator(".provider-head .dot")).toHaveClass(/ok/);
});

test("failed indexing preserves the brain and explains recovery in Portuguese", async ({ page }) => {
  await page.route("**/api/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), language: "pt-BR" } });
  });
  await page.route("**/api/memory/index", (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "index_scan_incomplete", message: "Index scan incomplete" } },
    }),
  );
  await page.goto("/#/brain");
  await expect(page.locator(".brain2 canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Atualizar índice", exact: true }).click();
  await expect(page.getByText(/O índice anterior foi preservado/)).toBeVisible();
  await expect(page.locator(".brain-progress")).toHaveCount(0);
  await expect(page.locator(".brain2 canvas").first()).toBeVisible();
});

test("a remote indexing failure clears an observer's progress through the event stream", async ({ page }) => {
  // Controlled transport fixture: exercises named SSE listeners, not a live failure.
  await page.addInitScript(() => {
    class FixtureEventSource extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      constructor() {
        super();
        window.addEventListener("fixture-os-event", this.receive);
        queueMicrotask(() => this.onopen?.());
      }
      receive = (event: Event) => {
        const detail = (event as CustomEvent<{ type: string; payload: unknown }>).detail;
        this.dispatchEvent(
          new MessageEvent(detail.type, {
            data: JSON.stringify({ ...detail, id: 100, ts: Date.now() }),
          }),
        );
      };
      close() {
        this.readyState = 2;
        window.removeEventListener("fixture-os-event", this.receive);
      }
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEventSource });
  });
  await page.goto("/#/brain");
  await expect(page.locator(".brain2 canvas").first()).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fixture-os-event", {
        detail: { type: "index.progress", payload: { scanned: 50, total: 200 } },
      }),
    ),
  );
  await expect(page.locator(".brain-progress")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("fixture-os-event", {
        detail: {
          type: "index.failed",
          payload: { code: "index_scan_incomplete", previousIndexPreserved: true },
        },
      }),
    ),
  );
  await expect(page.locator(".brain-progress")).toHaveCount(0);
  await expect(page.locator(".brain2 canvas").first()).toBeVisible();
});

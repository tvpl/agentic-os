import { expect, test } from "@playwright/test";

/**
 * The console's context (redesign F5): what is open on the stage is what the
 * agent can be pointed at. Its own file — it opens document windows, and a
 * spec that rearranges the desktop must not leak that into its neighbours.
 */

const HEADERS = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN! });

test("a searched file lands on the stage and the console can point the agent at it", async ({
  page,
  request,
}) => {
  const reset = () => request.put("/api/settings", { headers: HEADERS(), data: { dashboardLayout: {} } });
  await reset();
  await page.route("**/api/artifacts/list*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "a1",
            file: "plan.md",
            path: "/tmp/plan.md",
            runId: "1",
            skillSlug: null,
            createdAt: Date.now(),
            kind: "markdown",
            title: "Plan",
            folder: "1",
            sizeBytes: 10,
            thumbnail: false,
          },
        ],
        total: 1,
        skills: [],
        folders: [],
      },
    }),
  );
  await page.route("**/api/memory/preview*", (route) =>
    route.fulfill({ json: { kind: "text", content: "line one\nline two" } }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);

  // Search puts the file on the stage rather than in a modal that closes.
  await page.keyboard.press("/");
  await page.locator(".art-search-input").fill("plan");
  await page.locator(".art-hit").first().click();
  const doc = page.locator('[data-panel="doc:/tmp/plan.md"]');
  await expect(doc).toBeVisible();
  await expect(doc.locator(".doc-body")).toContainText("line two");

  // It is a window like any other: it appears in the camera view too.
  await page.keyboard.press("\\");
  await expect(page.locator(".desktop-widgets.overview")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".desktop-widgets.overview")).toHaveCount(0);

  // The context chip writes the reference into the draft.
  const input = page.locator(".cons-input");
  // The chip carries the panel's glyph before its reference (G4).
  await expect(page.locator(".cons-tray .chp")).toHaveText(/@plan\.md$/);
  await page.locator(".cons-tray .chp").click();
  await expect(input).toHaveValue("@plan.md ");

  // And the request carries the path behind the name the user typed.
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/runs") && r.method() === "POST");
  await input.fill("summarise @plan.md");
  await page.getByRole("button", { name: /^(Run|Executar)$/ }).click();
  const body = (await sent).postDataJSON() as { prompt: string };
  expect(body.prompt).toContain("summarise @plan.md");
  expect(body.prompt).toContain('"/tmp/plan.md"');

  await page.goto("about:blank");
  await reset();
});

test("typing @ offers the open documents and Tab completes one", async ({ page, request }) => {
  const reset = () => request.put("/api/settings", { headers: HEADERS(), data: { dashboardLayout: {} } });
  // Seed a document window straight into the layout: the point here is the
  // completion, not how the file got onto the stage.
  await request.put("/api/settings", {
    headers: HEADERS(),
    data: {
      dashboardLayout: {
        "doc:/tmp/report.md": { x: 40, y: 40, w: 420, h: 300, z: 20, visible: true },
      },
    },
  });
  await page.route("**/api/memory/preview*", (route) =>
    route.fulfill({ json: { kind: "text", content: "the report" } }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator('[data-panel="doc:/tmp/report.md"]')).toBeVisible();

  const input = page.locator(".cons-input");
  // No reference yet, so no tether.
  await expect(page.locator(".tethers path")).toHaveCount(0);
  await input.fill("look at @rep");
  const option = page.locator('.cons-ac [role="option"]');
  await expect(option).toContainText("@report.md");
  await input.press("Tab");
  await expect(input).toHaveValue("look at @report.md ");
  // A complete reference draws a line from the console to that window.
  await expect(page.locator(".tethers path")).toHaveCount(1);
  await input.fill("never mind");
  await expect(page.locator(".tethers path")).toHaveCount(0);

  await page.goto("about:blank");
  await reset();
});

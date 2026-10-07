import { expect, test, type Page } from "@playwright/test";
import { arrived, foldConversation, lamina, openShell, openVoiceControls, project } from "./shell";

/**
 * The voice line's context (redesign F5, immersive shell): what is projected
 * beside the core — and the scene you are in — is what the agent can be
 * pointed at. One search (⌘F) finds files, and a file it finds is projected.
 */

async function stubPlan(page: Page, path: string, title: string) {
  await page.route("**/api/v1/artifacts/list*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "a1",
            file: "plan.md",
            path,
            runId: "1",
            skillSlug: "sdd-plan",
            createdAt: Date.now(),
            kind: "markdown",
            title,
            folder: "1",
            sizeBytes: 120,
            thumbnail: false,
          },
        ],
        total: 1,
        skills: [],
        folders: [],
      },
    }),
  );
}

test("the one search lists artifact matches in their own group and projects the one chosen", async ({
  page,
}) => {
  await stubPlan(page, "/runs/1/plan.md", "Redesign plan");
  await openShell(page);
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(".art-search-input").fill("plan");
  // One search, grouped (refino item 52): the artifact group holds the match.
  const hit = page.locator(".art-search-group").first().locator(".art-hit");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("Redesign plan");
  // Choosing a match projects the file beside the core rather than opening a
  // modal that closes with itself.
  await hit.click();
  await expect(page.locator(".art-search-input")).toHaveCount(0);
  await expect(lamina(page, "doc:/runs/1/plan.md")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});

test("a searched file is projected and the voice line can point the agent at it", async ({ page }) => {
  await stubPlan(page, "/tmp/plan.md", "Plan");
  await page.route("**/api/v1/memory/preview*", (route) =>
    route.fulfill({ json: { kind: "text", content: "line one\nline two" } }),
  );
  await openShell(page);

  await page.keyboard.press("ControlOrMeta+f");
  await page.locator(".art-search-input").fill("plan");
  // Skills answer first; the artifact group arrives with the listing.
  await page.locator(".art-hit", { hasText: "/tmp/plan.md" }).click();
  const doc = lamina(page, "doc:/tmp/plan.md");
  await expect(doc).toBeVisible();
  await expect(doc.locator(".nu-lamina-title")).toHaveText("plan.md");
  await expect(doc.locator(".doc-body")).toContainText("line two");

  // The context chip writes the reference into the draft.
  const input = page.locator(".cons-input");
  const side = await openVoiceControls(page);
  const chip = side.locator(".cons-tray .chp", { hasText: "@plan.md" });
  await expect(chip).toHaveText(/@plan\.md$/);
  await expect(chip).not.toHaveClass(/\bon\b/);
  await chip.click();
  await expect(input).toHaveValue("@plan.md ");
  // A chip the draft points at is lit: what the agent will be looking at.
  await expect(chip).toHaveClass(/\bon\b/);

  // And the request carries the path behind the name the user typed.
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/v1/runs") && r.method() === "POST");
  await input.fill("summarise @plan.md");
  await page.getByRole("button", { name: /^(Run|Executar)$/ }).click();
  const body = (await sent).postDataJSON() as { prompt: string };
  expect(body.prompt).toContain("summarise @plan.md");
  expect(body.prompt).toContain('"/tmp/plan.md"');
});

test("typing @ offers the projected documents and Tab completes one", async ({ page }) => {
  await page.route("**/api/v1/memory/preview*", (route) =>
    route.fulfill({ json: { kind: "text", content: "the report" } }),
  );
  await openShell(page);
  // The point here is the completion, not how the file got projected.
  await project(page, "doc:/tmp/report.md");
  await expect(lamina(page, "doc:/tmp/report.md")).toBeVisible();

  const input = page.locator(".cons-input");
  await input.fill("look at @rep");
  const option = page.locator('.cons-ac [role="option"]');
  await expect(option).toContainText("@report.md");
  await input.press("Tab");
  await expect(input).toHaveValue("look at @report.md ");
  await expect(page.locator(".cons-ac")).toHaveCount(0);
  // The lâmina's own @ref button writes the same reference (the conversation
  // folded first: while it is open, the scene behind it is dimmed).
  await input.fill("");
  await foldConversation(page);
  await lamina(page, "doc:/tmp/report.md").locator(".nu-lamina-ref").click();
  await expect(input).toHaveValue("@report.md ");
});

test("typing @ in a scene offers the scene itself beside the lâminas", async ({ page }) => {
  await openShell(page, "/runs");
  await arrived(page, "runs");
  await project(page, "attention");
  await expect(page.locator("article.nu-lamina:not(.bye)")).toHaveCount(1);
  const input = page.locator(".cons-input");
  await input.fill("@");
  const options = page.locator('.cons-ac [role="option"]');
  await expect(options).toHaveCount(2);
  // The lâmina first (newest projection), then the scene you are in.
  await expect(options.last()).toContainText(/Runs|Execuções/);
  await input.press("Escape");
  await expect(page.locator(".cons-ac")).toHaveCount(0);
  // Escape in the line closed the completion, not the scene.
  await expect(page).toHaveURL(/#\/runs$/);
});

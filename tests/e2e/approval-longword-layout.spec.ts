/**
 * A word with no space in a held request (a hash, a path, a token), measured in a real browser
 * (.specs/features/escopos-dispositivo, C60). The one-line description keeps the first 600 characters of the prompt, so a
 * word of 64, 150 or 700 characters used to widen the whole card past the screen and carry Approve with it. In both
 * shells and at 390, 800 and 1440 px, on the Settings › Security card, the inline card of the Runs page and the Núcleo's
 * Resolver: Approve and Deny are on screen, inside the card, and the page does not scroll sideways.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

const headers = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN!, "content-type": "application/json" });
const LENGTHS = [64, 150, 700];
const WIDTHS = [390, 800, 1440];

test.use({ serviceWorkers: "block" });

/** The label the server builds for a prompt (`clipForLabel`): the first 600 characters, then how many were left out. */
function label(prompt: string): string {
  const clipped =
    prompt.length <= 600
      ? prompt
      : `${prompt.slice(0, 600)}… (+${prompt.length - 600} more characters; the approval holds the full request)`;
  return `Write-mode prompt run with claude: "${clipped}"`;
}

async function stub(page: Page, width: number, n: number) {
  const now = Date.now();
  const word = "A".repeat(n);
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/v1/approvals", (route) =>
    route.fulfill({
      json: [
        {
          id: "appr_word",
          createdAt: now - 60_000,
          kind: "write_run",
          description: label(word),
          payload: {
            kind: "prompt",
            requestedByName: "Pixel",
            input: {
              prompt: word,
              provider: "claude",
              mode: "write",
              cwd: "/home/me/notes",
              startedBy: "device:0123456789abcdef",
            },
          },
          status: "pending",
          resolvedAt: null,
          resolvedBy: null,
          requestedBy: "device:0123456789abcdef",
          expiresAt: now + 3_600_000,
        },
        {
          id: "appr_tool",
          createdAt: now - 30_000,
          kind: "tool_use",
          description: `Bash: $ ${word.slice(0, 150)}`,
          payload: { runId: "r1", toolName: "Bash", input: { command: word } },
          status: "pending",
          resolvedAt: null,
          resolvedBy: null,
          requestedBy: "device:0123456789abcdef",
          expiresAt: now + 3_600_000,
        },
      ],
    }),
  );
}

async function onScreen(page: Page, button: Locator, what: string) {
  await expect(button, what).toBeVisible();
  const box = await button.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, `${what} has a box`).not.toBeNull();
  expect(box!.x, `${what} left edge`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} right edge (viewport ${viewport.width})`).toBeLessThanOrEqual(
    viewport.width + 1,
  );
}

async function noSidewaysScroll(page: Page, what: string) {
  const measures = await page.evaluate(() => {
    const widest = Array.from(
      document.querySelectorAll<HTMLElement>(".card, .approval-inline, .nu-focus-item"),
    ).reduce((max, el) => Math.max(max, el.getBoundingClientRect().width), 0);
    const panel = document.querySelector<HTMLElement>(".app-panel");
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
      widest,
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(measures.page, `${what} the page scrolls sideways`).toBeLessThanOrEqual(2);
  expect(measures.panel, `${what} the panel scrolls sideways`).toBeLessThanOrEqual(2);
  expect(measures.widest, `${what} a card is wider than the screen`).toBeLessThanOrEqual(
    measures.viewport + 1,
  );
}

for (const shell of ["moldura", "nucleo"] as const) {
  test(`C60 a word with no space does not push Approve off the Security card or the Runs card: ${shell}`, async ({
    page,
    request,
  }) => {
    const set = await request.put("/api/ui-preferences", { headers: headers(), data: { shell } });
    expect(set.ok()).toBe(true);
    for (const n of LENGTHS) {
      for (const width of WIDTHS) {
        const what = `${shell} ${n} chars ${width}px`;
        await stub(page, width, n);
        await page.goto(`/?w=${width}-${n}#/settings?tab=security`);
        await expect(page.locator(".boot-screen")).toHaveCount(0);
        const panel = page.locator("#settings-tabs-panel-security");
        const rows = panel
          .locator(".list-row")
          .filter({ has: page.getByRole("button", { name: "Approve" }) });
        await expect(rows).toHaveCount(2);
        for (const [i, row] of (await rows.all()).entries()) {
          await row.scrollIntoViewIfNeeded();
          await onScreen(
            page,
            row.getByRole("button", { name: "Approve" }),
            `${what} security row ${i} Approve`,
          );
          await onScreen(page, row.getByRole("button", { name: "Deny" }), `${what} security row ${i} Deny`);
        }
        await noSidewaysScroll(page, `${what} security`);

        // The Runs page, with the inline card, is the Moldura's (the Núcleo has no such page).
        if (shell === "moldura") {
          await page.goto(`/?w=${width}-${n}-r#/runs`);
          await expect(page.locator(".boot-screen")).toHaveCount(0);
          const card = page.locator(".approval-inline").first();
          await expect(card).toBeVisible();
          await onScreen(page, card.getByRole("button", { name: "Approve" }), `${what} runs Approve`);
          await onScreen(page, card.getByRole("button", { name: "Deny" }), `${what} runs Deny`);
          await noSidewaysScroll(page, `${what} runs`);
        }
      }
    }
  });
}

for (const width of WIDTHS) {
  test(`C60 a word with no space does not push Approve off the Núcleo's Resolver: ${width}px`, async ({
    page,
    request,
  }) => {
    const set = await request.put("/api/ui-preferences", { headers: headers(), data: { shell: "nucleo" } });
    expect(set.ok()).toBe(true);
    for (const n of LENGTHS) {
      const what = `resolver ${n} chars ${width}px`;
      await stub(page, width, n);
      await page.goto(`/?w=${width}-${n}#/`);
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      await expect(page.locator(".nu-shell")).toBeVisible();
      await page.getByTestId("pending-hub").click();
      const focus = page.locator(".nu-focus");
      await expect(focus).toBeVisible();
      await onScreen(page, focus.getByRole("button", { name: /^Approve/ }).first(), `${what} Approve`);
      await onScreen(page, focus.getByRole("button", { name: /^Deny/ }).first(), `${what} Deny`);
      await noSidewaysScroll(page, what);
    }
  });
}

import { test, expect } from "@playwright/test";
import {
  arrived,
  bloomCore,
  foldConversation,
  lamina,
  liveLaminas,
  openClassicBrain,
  openConversation,
  openPendingFocus,
  entityPainted,
  openShell,
  overlaps,
  project,
  reading,
  travelBySpine,
} from "./shell";

test("apps open as scenes, keep their own controls, and a route is a deep link", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openShell(page, "/", { width: 1440, height: 1000 });
  // The spine takes you into the brain: a place of its own, full screen.
  await travelBySpine(page, "brain");
  await expect(page).toHaveURL(/#\/brain$/);
  await expect(page.locator('.nu-scene.on [data-onboarding="brain"] .bs')).toBeVisible();
  // The classic map is one click away and its own controls keep working.
  const map = await openClassicBrain(page);
  // It stands between the HUD and the whole voice: nothing of it is under either.
  const clear = await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) =>
      a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1;
    const chrome = [".nu-hub", ".nu-title", ".nu-tele", ".nu-spine", ".nu-voice"].map((s) =>
      box(document.querySelector(s)!),
    );
    return [".brain2-topbar button", ".brain2-panel", ".zoom-stack", ".brain2-legend"].flatMap((s) =>
      Array.from(document.querySelectorAll(`.bs-classic ${s}`))
        .filter((el) => chrome.some((c) => hit(box(el), c)))
        .map(() => s),
    );
  });
  expect(clear).toEqual([]);
  await map.getByRole("button", { name: /zoom in|aproximar/i }).click();
  await map.locator(".brain-panel-toggle").click();
  await expect(map.locator(".brain2-panel")).toHaveClass(/collapsed/);
  // Its page chrome is gone: the scene is the frame.
  await expect(map.getByRole("button", { name: /back to.*os|voltar ao os/i })).toHaveCount(0);
  await page.getByRole("button", { name: /Back to the constellation|Voltar à constelação/ }).click();
  await expect(page.locator(".bs-classic")).toHaveCount(0);
  await expect(page.locator(".bs")).toBeVisible();
  // Every scene is on the spine, the ones past the main five too.
  await travelBySpine(page, "pixel");
  await expect(page.locator('[data-onboarding="pixel"] canvas').first()).toBeVisible();
  // A route is a deep link: the scene, on the tab it names, and the URL stays.
  await page.goto("/#/settings?tab=security");
  await arrived(page, "settings");
  await expect(page.locator('[data-onboarding="settings"] #settings-tabs-panel-security')).toBeVisible();
  await expect(page).toHaveURL(/#\/settings\?tab=security$/);
  expect(errors).toEqual([]);
});

test("the voice line keeps its place through a run and a dismissed lâmina stays gone after reload", async ({
  page,
}) => {
  await openShell(page, "/", { width: 1440, height: 1000 });
  const voice = page.locator("[data-console]");
  const input = voice.locator("textarea");
  // One instrument beside the core, so there is something around the line to change.
  await project(page, "now");
  const now = lamina(page, "now");
  await expect(now).toBeVisible();
  // Not a lâmina: no dismiss, not something the tray offers as context.
  await expect(voice.locator(".nu-lamina-head")).toHaveCount(0);
  const row = (await page.locator(".nu-voice .cons-row").boundingBox())!;
  await expect(now).not.toHaveClass(/\bfresh\b/);
  expect(overlaps((await now.boundingBox())!, row)).toBe(false);
  await input.fill("Keep my draft");
  await page.screenshot({ path: "artifacts/qa-desktop.png" });
  // The line lights while a run is in flight and goes quiet when it ends.
  await expect(voice).not.toHaveClass(/\bbusy\b/);
  await input.fill("hello [[sleep:3]]");
  await input.press("Enter");
  await expect(voice).toHaveClass(/\bbusy\b/);
  await expect(voice).not.toHaveClass(/\bbusy\b/, { timeout: 20_000 });
  // The draft was sent, so it is gone; folded, the line is where it was.
  await expect(input).toHaveValue("");
  await foldConversation(page);
  await expect
    .poll(async () => {
      const b = (await page.locator(".nu-voice .cons-row").boundingBox())!;
      return [Math.round(b.x), Math.round(b.y + b.height)];
    })
    .toEqual([Math.round(row.x), Math.round(row.y + row.height)]);
  // Sending projected nothing (the conversation followed the run); the instrument is still there.
  await expect(lamina(page, "run:", "^=")).toHaveCount(0);
  await expect(now).toBeVisible();
  await now.getByRole("button", { name: /^(Dismiss|Dispensar): / }).click();
  await expect(lamina(page, "now")).toHaveCount(0);
  await page.reload();
  await expect(voice).toBeVisible();
  await expect(page.locator('[data-lamina="now"]')).toHaveCount(0);
  await expect(lamina(page, "run:", "^=")).toHaveCount(0);
});

test("the readings and the pendências light only what needs you", async ({ page }) => {
  // Two runs the user has to look at; everything else is calm — approvals
  // included, which would make the pendências a decision (refino item 21).
  await page.route("**/api/v1/approvals", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/runs?*", (route) =>
    route.fulfill({
      json: [
        { id: "a", status: "failed", createdAt: Date.now(), promptSummary: "fixture run x" },
        { id: "b", status: "timed_out", createdAt: Date.now(), promptSummary: "fixture run y" },
      ],
    }),
  );
  await openShell(page, "/", { width: 1440, height: 900 });
  // Two of two runs failed: the last 24 hours earn colour; the rest stays muted
  // (the readings are folded into the core until it is touched).
  await bloomCore(page);
  await expect(page.locator('.nu-reading[data-reading="pulse"]')).toHaveAttribute("data-l", "warn");
  await expect(page.locator('.nu-reading[data-reading="pulse"] .v')).toHaveText(/0 ok · 2/);
  for (const quiet of ["now", "routine", "cost"])
    await expect(page.locator(`.nu-reading[data-reading="${quiet}"]`)).toHaveAttribute(
      "data-l",
      /^(idle|info)$/,
    );
  // What needs you is the pendências' business (top-left), not the
  // telemetry's: the failures are something to fix; cost and runs in flight
  // stay quiet. (The provider reading is the fake CLI's own state.)
  const hub = page.locator(".nu-hub");
  await expect(hub).toHaveAttribute("data-level", "fix");
  await expect
    .poll(async () => Number(await hub.locator(".nu-hub-n").textContent()))
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".nu-tele .nu-t[data-item]")).not.toHaveCount(0);
  await expect(page.locator('.nu-tele .nu-t[data-item="attention"], .nu-tele .nu-bell')).toHaveCount(0);
  for (const quiet of ["cost", "runs"])
    await expect(page.locator(`.nu-t[data-item="${quiet}"]`)).toHaveAttribute("data-l", /^(idle|info)$/);
  // A lit reading is an entry point, not a label: it projects its instrument.
  await expect(liveLaminas(page)).toHaveCount(0);
  await (await reading(page, "pulse")).click();
  await expect(lamina(page, "pulse")).toBeVisible();
  // And the pendências hold both failures, first in line, as things to fix.
  const focus = await openPendingFocus(page);
  const queue = focus.locator("nav.nu-focus-queue button");
  await expect(queue.filter({ hasText: "fixture run x" })).toHaveAttribute("data-level", "fix");
  await expect(queue.filter({ hasText: "fixture run y" })).toHaveAttribute("data-level", "fix");
  const levels = await queue.evaluateAll((els) => els.map((el) => el.getAttribute("data-level")));
  expect(levels.slice(0, 2)).toEqual(["fix", "fix"]);
});

test("the skill deck fans out over the voice line and closes with Escape", async ({ page }) => {
  await page.route("**/api/v1/skills", (route) =>
    route.fulfill({
      json: [
        {
          slug: "smoke-test",
          name: "Smoke test",
          description: "",
          triggers: [],
          inputs: [],
          providers: [],
          recommendedModel: null,
          recommendedEffort: "medium",
          mode: "read_only",
          enabled: true,
          version: "1",
          guardrails: [],
          successCriteria: [],
          resources: [],
          bodyLineCount: 0,
          thick: false,
          body: "",
          skillFile: "smoke-test/SKILL.md",
        },
      ],
    }),
  );
  await openShell(page, "/", { width: 1440, height: 900 });
  await page.keyboard.press("ControlOrMeta+j");
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  await expect(deck.locator(".deck-skill")).toHaveCount(1);
  // The scene stays behind it: the deck is a layer, not a place.
  await expect(page.locator("[data-console]")).toBeVisible();
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-scene", "nucleo");
  await page.screenshot({ path: "artifacts/qa-deck.png" });
  await page.keyboard.press("Escape");
  await expect(deck).toHaveCount(0);
  // Escape closed the deck and nothing else: still home.
  await expect(page).toHaveURL(/#\/$/);
  // ⌘J is the same gesture from the voice line.
  await page.locator("[data-console] textarea").click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.locator(".skill-deck")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".skill-deck")).toHaveCount(0);
});

test("the field, the core and the iris are painted, not blank canvases", async ({ page }) => {
  // Painting is the point: the full render profile, whatever the battery says.
  await page.addInitScript(() => localStorage.setItem("mordomo.renderProfile", "immersive"));
  await openShell(page, "/", { width: 1440, height: 900 });
  const lit = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      if (canvas.width === 0 || canvas.height === 0) return 0;
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 20) n++;
      return n;
    });
  // A tab loaded in the background gets no animation frames, and a resize
  // wipes a canvas: both used to leave the ground blank.
  await expect(page.locator("canvas.nu-field")).toBeVisible();
  await expect.poll(() => lit("canvas.nu-field")).toBeGreaterThan(200);
  // The agent's body (WebGL, or its 2D fallback) and its iris on the voice line.
  for (const body of [".nu-core-orb", ".nu-iris-orb"]) {
    await expect(page.locator(`${body} canvas`).first()).toBeVisible();
    await expect.poll(() => entityPainted(page, body)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => lit("canvas.nu-field")).toBeGreaterThan(200);
  await expect.poll(() => entityPainted(page, ".nu-core-orb")).toBe(true);
});

test("Portuguese notification opens its destination, not just its read state", async ({ page }) => {
  await page.route("**/api/v1/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), language: "pt-BR" } });
  });
  await page.route("**/api/v1/notifications?*", (route) =>
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
  await openShell(page);
  // Notices live in the pendências, said in the UI's language.
  const focus = await openPendingFocus(page);
  // A quiet notice waits in the folded history (conceito em todo o sistema, AC 8).
  await focus.locator("details.nu-focus-history summary").click();
  await focus.locator("nav.nu-focus-queue button", { hasText: "Indexação concluída" }).click();
  const item = focus.locator("section.nu-focus-item");
  await expect(item).toContainText("Indexação concluída");
  await item.getByRole("button", { name: "Abrir", exact: true }).click();
  await expect(focus).toHaveCount(0);
  // `/brain` is the brain scene.
  await expect(page).toHaveURL(/#\/brain$/);
  await arrived(page, "brain");
  await expect(page.locator(".bs")).toBeVisible();
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
  await page.route("**/api/v1/sessions/session-fixture", (route) =>
    route.fulfill({
      json: { session: { id: "session-fixture", provider: "claude", turns: 1, costUsd: 0 }, runs: [run] },
    }),
  );
  await page.route("**/api/v1/runs/auth-fixture", (route) => route.fulfill({ json: { run, events: [] } }));
  await openShell(page);
  // The failed turn says how to recover, in the conversation.
  await openConversation(page);
  await expect(page.locator(".auth-recovery code")).toHaveText("claude auth login");
  await page.locator(".auth-recovery a").click();
  // The link is a deep link into the Settings scene, on the providers tab.
  await expect(page).toHaveURL(/#\/settings\?tab=providers$/);
  await arrived(page, "settings");
  await expect(page.locator('[data-onboarding="settings"] #settings-tabs-panel-providers')).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { resetStage, stageBoxes } from "./stage";

test("apps open as panels on the stage and nothing leaves the desktop", async ({ page, request }) => {
  await resetStage(request);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // A pod opens its app as a panel (G2): the desktop stays, the URL stays.
  await page.locator('.pod-arc.l .pod[data-pod="app:brain"]').click();
  const brain = page.locator('[data-panel="app:brain"]');
  await expect(brain).toBeVisible();
  await expect(brain.locator(".brain2")).toBeVisible();
  await expect(page.locator(".desktop")).toHaveCount(1);
  await expect(page).toHaveURL(/#\/$/);
  // The app's own controls keep working inside the plate.
  await brain.getByRole("button", { name: /zoom in|aproximar/i }).click();
  await brain.locator(".brain-panel-toggle").click();
  await expect(brain.locator(".brain2-panel")).toHaveClass(/collapsed/);
  // Its page chrome is gone: the plate is the frame now.
  await expect(brain.getByRole("button", { name: /back to.*os|voltar ao os/i })).toHaveCount(0);
  await brain.getByRole("button", { name: /^close|^fechar/i }).click();
  await expect(brain).toHaveCount(0);
  await page.locator('.pod-arc.l .pod[data-pod="app:pixel"]').click();
  const pixel = page.locator('[data-panel="app:pixel"]');
  await expect(pixel.locator(".panel-title")).toHaveText(/Pixel Studio/);
  await expect(pixel.locator("canvas").first()).toBeVisible();
  // A route is a deep link into a panel: the same app, the same plate.
  await page.goto("/#/settings?tab=security");
  const settings = page.locator('[data-panel="app:settings"]');
  await expect(settings).toBeVisible();
  await expect(settings.locator("#settings-tabs-panel-security")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  expect(errors).toEqual([]);
});

test("the console is fixed over the stage and Now stays hidden after reload", async ({ page, request }) => {
  // One companion on the stage: this spec is about the console keeping its
  // place while the desktop around it changes, so there has to be something
  // to change.
  await stageBoxes(request, { now: { x: 860, y: 60, w: 420, h: 300 } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const consolePlate = page.locator("[data-console]");
  const input = consolePlate.locator("textarea");
  await input.fill("Keep my draft");
  await page.screenshot({ path: "artifacts/qa-desktop.png" });
  // Not a window (G4): no title bar, no park, no close, not in the dock's
  // panel list — and the prototype's geometry: centred over the dock, capped
  // at 860 px, its whole body inside the viewport.
  await expect(consolePlate.locator(".panel-head")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Open panels: Console$/ })).toHaveCount(0);
  const box = (await consolePlate.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1);
  expect(box.width).toBeLessThanOrEqual(860);
  expect(box.y + box.height).toBeLessThanOrEqual(1000);
  // The frame lights while a run is in flight and goes quiet when it ends.
  await expect(consolePlate).not.toHaveClass(/\bbusy\b/);
  await input.fill("hello [[sleep:3]]");
  await input.press("Enter");
  await expect(consolePlate).toHaveClass(/\bbusy\b/);
  await expect(consolePlate).not.toHaveClass(/\bbusy\b/, { timeout: 20_000 });
  // The draft was sent, so it is gone; the plate did not move an inch.
  await expect(input).toHaveValue("");
  await expect.poll(async () => (await consolePlate.boundingBox())!.x).toBeCloseTo(box.x, 0);
  await page
    .locator('[data-panel="now"]')
    .getByRole("button", { name: /^close|^fechar/i })
    .click();
  await expect(page.locator('[data-panel="now"]')).toHaveCount(0);
  await page.waitForTimeout(1000); // persisted layout mutation is debounced
  await page.reload();
  await expect(consolePlate).toBeVisible();
  await expect(page.locator('[data-panel="now"]')).toHaveCount(0);

  // The e2e home is shared by every later spec, so this one hands the desktop
  // back the way it found it.
  await page.goto("about:blank");
  await resetStage(request);
});

test("the pods light only what needs a decision", async ({ page, request }) => {
  await resetStage(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Two runs the user has to look at; everything else is calm — including
  // approvals, which would turn the reading red (refino item 21).
  await page.route("**/api/approvals", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/runs?*", (route) =>
    route.fulfill({
      json: [
        { id: "a", status: "failed", createdAt: Date.now(), promptSummary: "x" },
        { id: "b", status: "timed_out", createdAt: Date.now(), promptSummary: "y" },
      ],
    }),
  );
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // Two of two runs failed, so two readings earn colour: the decisions to make
  // and the success rate. Everything else stays muted.
  await expect(page.locator('.pod-arc.r .pod[data-pod="attention"]')).toHaveAttribute("data-level", "warn");
  await expect(page.locator('.pod-arc.r .pod[data-pod="pulse"]')).toHaveAttribute("data-level", "critical");
  // Every other reading stays muted: an unlit arc is the resting state.
  const levels = await page.$$eval(".pod-arc.r .pod:not(.lit)", (els) =>
    els.map((e) => e.getAttribute("data-level")),
  );
  expect(levels.length).toBeGreaterThan(1);
  expect(levels.every((l) => l === "idle" || l === "info")).toBe(true);
  // A lit reading is an entry point, not a label: the pod puts its panel on the
  // stage (F7), which is also how most windows arrive now that it opens clear.
  await expect(page.locator('[data-panel="attention"]')).toHaveCount(0);
  await page.locator('.pod-arc.r .pod[data-pod="attention"]').click();
  await expect(page.locator('[data-panel="attention"]')).toBeVisible();
});

test("the skill deck fans out over the console and runs what is picked", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/skills", (route) =>
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
  await resetStage(request);
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // ⌘J fans the deck out over the console (the skills pod opens the Skills app since G2).
  await page.keyboard.press("ControlOrMeta+j");
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  await expect(deck.locator(".deck-skill")).toHaveCount(1);
  // The desktop stays visible behind it: the deck is a layer, not a page.
  await expect(page.locator("[data-console]")).toBeVisible();
  await page.screenshot({ path: "artifacts/qa-deck.png" });
  await page.keyboard.press("Escape");
  await expect(deck).toHaveCount(0);
  // ⌘J is the same gesture from the keyboard, console focus included.
  await page.locator("[data-console] textarea").click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.locator(".skill-deck")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".skill-deck")).toHaveCount(0);
});

test("the ground carries the whole workspace, not only the indexed files", async ({ page, request }) => {
  await resetStage(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const field = page.locator("canvas.living-field");
  await expect(field).toBeVisible();
  // Files alone came out as three faint dots on a real workspace; skills,
  // routines and runs are memory too, and together they make a sky.
  await expect.poll(async () => Number((await field.getAttribute("data-points")) ?? 0)).toBeGreaterThan(20);
  // It has actually painted — a tab loaded in the background gets no animation
  // frames, and a resize wipes the canvas, so both used to leave it blank.
  const lit = await field.evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 20) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(1000);
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
  // `/brain` is a deep link into the brain panel: the desktop stays (G2).
  await expect(page.locator('[data-panel="app:brain"] .brain2')).toBeVisible();
  await expect(page.locator(".desktop")).toHaveCount(1);
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
  // The link is a deep link into the Settings panel, on the providers tab.
  const settings = page.locator('[data-panel="app:settings"]');
  await expect(settings).toBeVisible();
  await expect(settings.locator("#settings-tabs-panel-providers")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator(".desktop")).toHaveCount(1);
});

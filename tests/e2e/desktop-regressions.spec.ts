import { test, expect } from "@playwright/test";
import { resetStage, stageBoxes, stageWith } from "./stage";

test("apps and onboarding navigate to usable content without reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/");
  // The apps live on the left arc now (redesign F7): one pod, one app.
  await page.locator('.pod-arc.l .pod[data-pod="/brain"]').click();
  await expect(page.locator(".brain2")).toBeVisible();
  await expect(page.locator(".desktop")).toHaveCount(0);
  await page.getByRole("button", { name: /zoom in|aproximar/i }).click();
  await page.locator(".brain-panel-toggle").click();
  await expect(page.locator(".brain2-panel")).toHaveClass(/collapsed/);
  await page.keyboard.press("/");
  await expect(page.locator(".brain2-panel input").first()).toBeFocused();
  await page.getByRole("button", { name: /back to.*os|voltar ao os/i }).click();
  await page.locator('.pod-arc.l .pod[data-pod="/pixel"]').click();
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

test("console maximizes, restores, resizes and Now stays hidden after reload", async ({ page, request }) => {
  // The console and one companion: this spec is about a surface opening over a
  // desktop that is still there behind it, so there has to be something behind.
  // The console is given room above its floor (WINDOW_MIN.prompt = 380 × 260),
  // because the spec shrinks it and expects that to do something.
  await stageBoxes(request, {
    prompt: { x: 120, y: 60, w: 700, h: 420 },
    now: { x: 860, y: 60, w: 420, h: 300 },
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/");
  const consoleWidget = page.locator('[data-panel="prompt"]');
  const input = consoleWidget.locator("textarea");
  await input.fill("Keep my draft");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/qa-desktop.png" });
  const original = await consoleWidget.boundingBox();
  // Expanding opens a surface over the desktop (redesign F2): the widget is no
  // longer stretched to the viewport and the desktop behind is not erased.
  await consoleWidget.getByRole("button", { name: /^Maximize:/ }).click();
  const surface = page.locator(".surface");
  await expect(surface).toBeVisible();
  const surfaceBox = (await surface.boundingBox())!;
  expect(surfaceBox.width).toBeGreaterThan(0);
  // Capped by the widget's declared ceiling, not by the window.
  expect(surfaceBox.width).toBeLessThan(1440 - 40);
  // The rest of the desktop stays on screen behind the veil.
  await expect(page.locator('[data-panel="now"]')).toBeVisible();
  // The body moved into the surface and carried the draft with it.
  await expect(surface.locator("textarea")).toHaveValue("Keep my draft");
  await page.screenshot({ path: "artifacts/qa-console.png" });
  await page.keyboard.press("Escape");
  await expect(surface).toHaveCount(0);
  // …and back again, still intact.
  await expect(input).toHaveValue("Keep my draft");
  // Polled: closing plays a 200 ms FLIP, so an immediate read catches it mid-flight.
  await expect.poll(async () => (await consoleWidget.boundingBox())!.width).toBeCloseTo(original!.width, 0);
  await consoleWidget.locator(".panel-grip").focus();
  // The console sits at its minimum height by default, so shrink its width.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await consoleWidget.boundingBox())!.width).toBeLessThan(original!.width);
  await page
    .locator('[data-panel="now"]')
    .getByRole("button", { name: /^close|^fechar/i })
    .click();
  await expect(page.locator('[data-panel="now"]')).toHaveCount(0);
  await page.waitForTimeout(1000); // persisted layout mutation is debounced
  await page.reload();
  await expect(consoleWidget).toBeVisible();
  await expect(page.locator('[data-panel="now"]')).toHaveCount(0);

  // The e2e home is shared by every later spec, so this one hands the desktop
  // back the way it found it.
  await page.goto("about:blank");
  await resetStage(request);
});

test("the pods light only what needs a decision", async ({ page, request }) => {
  await resetStage(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Two runs the user has to look at; everything else is calm.
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
  await stageWith(request, "prompt");
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // The skills pod fans the deck out rather than leaving the desktop.
  await page.locator('.pod-arc.l .pod[data-pod="/skills"]').click();
  const deck = page.locator(".skill-deck");
  await expect(deck).toHaveClass(/open/);
  await expect(deck.locator(".deck-skill")).toHaveCount(1);
  // The desktop stays visible behind it: the deck is a layer, not a page.
  await expect(page.locator('[data-panel="prompt"]')).toBeVisible();
  await page.screenshot({ path: "artifacts/qa-deck.png" });
  await page.keyboard.press("Escape");
  await expect(deck).toHaveCount(0);
  // ⌘J is the same gesture from the keyboard, console focus included.
  await page.locator('[data-panel="prompt"] textarea').click();
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

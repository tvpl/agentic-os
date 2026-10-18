/**
 * The immersive concept across the whole system
 * (.specs/features/conceito-em-todo-sistema): every scene speaks the same
 * language as the Núcleo and the conversation, shows one thing in focus and
 * the rest on demand, says each cause once, and lets the agent take any
 * focused item. Each test is named after the check it proves (C1…C36).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { arrived, currentScene, openShell } from "./shell";

/** Wait for every finite animation on the page to end (entrances, not the breathing loops). */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/* ---- S5: connectors ------------------------------------------------------------ */

async function openConnectors(page: Page, viewport = { width: 1440, height: 900 }) {
  await openShell(page, "/connectors", viewport);
  await arrived(page, "connectors");
  const cards = page.getByTestId("connector-card");
  await expect(cards.first()).toBeVisible();
  return cards;
}

test("C27 connector steps never wrap", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    const cards = await openConnectors(page, viewport);
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      await card.locator(".cx-card-head").click();
      await expect(card).toHaveAttribute("data-open", "");
      const labels = card.locator(".conn-steps .conn-step-t");
      await expect(labels).toHaveCount(3);
      // An inline label that wraps has one client rect per line.
      const lines = await labels.evaluateAll((els) => els.map((el) => el.getClientRects().length));
      expect(lines, `card ${i} at ${viewport.width}px`).toEqual([1, 1, 1]);
    }
  }
});

test("C28 a tall scene scrolls instead of clipping", async ({ page }) => {
  const cards = await openConnectors(page, { width: 1280, height: 720 });
  // Open the tallest card: the scene is then taller than the room above the line.
  await cards.first().locator(".cx-card-head").click();
  await cards.first().locator(".conn-steps button").first().click();
  const scroller = currentScene(page).locator(".nu-scene-app");
  const { scrollHeight, clientHeight } = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  const last = page.getByTestId("connector-card").last();
  await expect
    .poll(async () => {
      const box = (await last.boundingBox())!;
      const floor = await page.locator(".nu-voice").evaluate((el) => el.getBoundingClientRect().top);
      const bottom = await scroller.evaluate((el) => el.getBoundingClientRect().bottom);
      return box.y + box.height <= Math.min(floor, bottom);
    })
    .toBe(true);
});

test("C29 connectors are cards with a state orb", async ({ page }) => {
  const cards = await openConnectors(page);
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await expect(card.locator(".cx-orb")).toHaveAttribute("data-state", /^(ok|off|warn|danger)$/);
    await expect(card.locator(".cx-name")).not.toBeEmpty();
    await expect(card.locator(".cx-purpose")).not.toBeEmpty();
    // Closed, a card shows no steps.
    await expect(card.locator(".conn-steps")).toHaveCount(0);
  }
  // Glass: rounded, never chamfered.
  const style = await cards.first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { clip: s.clipPath, radius: parseFloat(s.borderTopLeftRadius) };
  });
  expect(style.clip).toBe("none");
  expect(style.radius).toBeGreaterThanOrEqual(10);
});

test("C30 one connector open at a time", async ({ page }) => {
  const cards = await openConnectors(page);
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const a = cards.nth(0);
  const b = cards.nth(1);
  await a.locator(".cx-card-head").click();
  await expect(a).toHaveAttribute("data-open", "");
  await expect(a.locator(".cx-card-head")).toHaveAttribute("aria-expanded", "true");
  await expect(a.locator(".conn-steps")).toBeVisible();
  await b.locator(".cx-card-head").click();
  await expect(b).toHaveAttribute("data-open", "");
  await expect(b.locator(".conn-steps")).toBeVisible();
  await expect(a).not.toHaveAttribute("data-open", /.*/);
  await expect(a.locator(".cx-card-head")).toHaveAttribute("aria-expanded", "false");
  await expect(a.locator(".conn-steps")).toHaveCount(0);
});

test("C31 audit is a pill in the header", async ({ page }) => {
  await openConnectors(page);
  const audit = page.locator(".cx-head").getByTestId("connectors-audit");
  await expect(audit).toBeVisible();
  const style = await audit.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      clip: s.clipPath,
      radius: parseFloat(s.borderTopLeftRadius),
      h: el.getBoundingClientRect().height,
    };
  });
  expect(style.clip).toBe("none");
  // A pill: the radius is at least half the height.
  expect(style.radius).toBeGreaterThanOrEqual(style.h / 2 - 1);
});

/* ---- S2: the resolver ------------------------------------------------------------ */

const ROUTINE_ID = "concept-nightly";
const JSON_ERROR = "Expected ',' or '}' after property value in JSON at position 234 (line 1 column 235)";

interface PendingSeed {
  approvals?: Record<string, unknown>[];
  runs?: Record<string, unknown>[];
  notices?: Record<string, unknown>[];
  /** Make the first routine unhealthy, with this id. */
  sickRoutine?: boolean;
  budgetOver?: boolean;
  providerLogin?: boolean;
}

const decision = (id: string, at = Date.now() - 60_000) => ({
  id,
  createdAt: at,
  kind: "write_run",
  description: `Write-mode prompt run with claude: ${id}`,
  payload: { kind: "prompt", input: { prompt: id } },
  status: "pending",
  resolvedAt: null,
});
const question = (id: string, at = Date.now() - 30_000) => ({
  id,
  createdAt: at,
  kind: "tool_use",
  description: "AskUserQuestion",
  payload: {
    toolName: "AskUserQuestion",
    input: {
      questions: [{ question: "Por onde começamos?", options: [{ label: "Testes" }, { label: "Docs" }] }],
    },
  },
  status: "pending",
  resolvedAt: null,
});
const failedRun = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "failed",
  createdAt: Date.now() - 120_000,
  finishedAt: Date.now() - 100_000,
  promptSummary: `fixture ${id}`,
  skillSlug: null,
  routineId: null,
  provider: "claude",
  error: JSON_ERROR,
  failure: null,
  ...extra,
});
const noticeRow = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "system",
  title,
  ts: Date.now() - 10_000,
  read: false,
  tone: "warn",
  ...extra,
});

/** Replace everything the pendências read with the seed; resolving an approval removes it. */
async function seedPending(page: Page, seed: PendingSeed) {
  const state = { approvals: [...(seed.approvals ?? [])] };
  await page.route("**/api/v1/approvals", (route) => route.fulfill({ json: state.approvals }));
  await page.route("**/api/v1/approvals/*/resolve", async (route) => {
    const id = decodeURIComponent(route.request().url().split("/approvals/")[1]!.split("/")[0]!);
    state.approvals = state.approvals.filter((a) => a.id !== id);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/runs/*/retry", (route) => route.fulfill({ json: { runId: null } }));
  await page.route("**/api/v1/runs?*", async (route) => {
    const real = (await (await route.fetch()).json()) as Array<{ status: string }>;
    const quiet = real.filter((r) => r.status !== "failed" && r.status !== "timed_out");
    await route.fulfill({ json: [...(seed.runs ?? []), ...quiet] });
  });
  await page.route(/\/api\/v1\/routines(\?.*)?$/, async (route) => {
    const real = (await (await route.fetch()).json()) as Array<Record<string, unknown>>;
    await route.fulfill({
      json: real.map((r, i) =>
        seed.sickRoutine && i === 0
          ? {
              ...r,
              id: ROUTINE_ID,
              name: "Nightly memory consolidation",
              enabled: true,
              healthy: false,
              recentFailures: 2,
              lastStatus: "failed",
              lastFiredAt: Date.now() - 90_000,
            }
          : { ...r, healthy: true },
      ),
    });
  });
  await page.route("**/api/v1/notifications?*", (route) =>
    route.fulfill({ json: { items: seed.notices ?? [], unread: (seed.notices ?? []).length } }),
  );
  await page.route(/\/api\/v1\/settings(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const real = (await (await route.fetch()).json()) as { limits?: Record<string, unknown> };
    await route.fulfill({ json: { ...real, limits: { ...(real.limits ?? {}), dailyBudgetUsd: 10 } } });
  });
  await page.route(/\/api\/v1\/metrics(\?.*)?$/, async (route) => {
    const real = (await (await route.fetch()).json()) as { cost?: Record<string, unknown> };
    await route.fulfill({
      json: { ...real, cost: { ...(real.cost ?? {}), todayUsd: seed.budgetOver ? 1_000 : 0 } },
    });
  });
  await page.route(/\/api\/v1\/providers(\?.*)?$/, async (route) => {
    const real = (await (await route.fetch()).json()) as Array<Record<string, unknown>>;
    if (!seed.providerLogin) return route.fulfill({ json: real });
    const def = real.find((p) => p.isDefault) ?? real[0]!;
    const sick = { ...def, health: { ...(def.health as object), ok: false, authenticated: false } };
    // A healthy second provider keeps the provider gate open.
    const spare = {
      ...def,
      id: "concept-spare",
      isDefault: false,
      health: { ...(def.health as object), ok: true },
    };
    await route.fulfill({ json: [...real.map((p) => (p === def ? sick : p)), spare] });
  });
}

async function openResolver(page: Page) {
  await openShell(page, "/");
  await arrived(page, "nucleo");
  await page.getByTestId("pending-hub").click();
  const focus = page.locator('div.nu-focus[role="dialog"]');
  await expect(focus).toBeVisible();
  return focus;
}
/** The live rows of the queue (the folded history aside). */
const queueRows = (focus: ReturnType<Page["locator"]>) =>
  focus.locator("nav.nu-focus-queue > ol > li > button");

test("C7 the resolver shows each cause once", async ({ page }) => {
  await seedPending(page, {
    sickRoutine: true,
    runs: [
      failedRun("f-nightly-1", { routineId: ROUTINE_ID, skillSlug: "consolidate-memory" }),
      failedRun("f-nightly-2", { routineId: ROUTINE_ID, skillSlug: "consolidate-memory" }),
    ],
    notices: [
      noticeRow("t1", "The run exceeded its time limit"),
      noticeRow("t2", "The run exceeded its time limit", { ts: Date.now() - 20_000 }),
      noticeRow("t3", "The run exceeded its time limit", { ts: Date.now() - 30_000 }),
    ],
  });
  const focus = await openResolver(page);
  const ids = await queueRows(focus).evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  expect(ids).toEqual(expect.arrayContaining([`routine:${ROUTINE_ID}`, "notice:t1"]));
  expect(ids).toHaveLength(2);
  await expect(queueRows(focus).filter({ hasText: "×3" })).toHaveCount(1);
  // The hub counts the causes, not the repetitions.
  await expect(page.locator(".nu-hub .nu-hub-n")).toHaveText("2");
});

test("C8 quiet notices wait in a folded history", async ({ page }) => {
  await seedPending(page, {
    notices: [
      noticeRow("loud", "Worth a look"),
      noticeRow("q1", "Old news one", { tone: "info" }),
      noticeRow("q2", "Old news two", { ts: Date.now() - 3 * 86_400_000 }),
    ],
  });
  const focus = await openResolver(page);
  await expect(queueRows(focus)).toHaveCount(1);
  await expect(queueRows(focus).first()).toHaveAttribute("data-id", "notice:loud");
  const history = focus.locator("details.nu-focus-history");
  await expect(history).toHaveCount(1);
  await expect(history).not.toHaveAttribute("open", /.*/);
  await expect(history.locator("summary")).toHaveText(/(History|Histórico) \(2\)/);
  // At the end of the queue.
  const last = await focus
    .locator("nav.nu-focus-queue")
    .evaluate((nav) => nav.lastElementChild?.matches("details.nu-focus-history"));
  expect(last).toBe(true);
  await history.locator("summary").click();
  await expect(history.locator("button[data-id]")).toHaveCount(2);
});

test("C9 one card, the agent's reading first, one primary action", async ({ page }) => {
  await seedPending(page, {
    approvals: [question("q-1"), decision("d-1")],
    sickRoutine: true,
    runs: [failedRun("f-stray")],
    notices: [noticeRow("n-1", "Worth a look")],
    budgetOver: true,
    providerLogin: true,
  });
  const focus = await openResolver(page);
  const kinds = await queueRows(focus).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")));
  expect(new Set(kinds)).toEqual(
    new Set(["question", "decision", "provider", "budget", "failure", "routine", "notice"]),
  );
  const n = await queueRows(focus).count();
  for (let i = 0; i < n; i++) {
    await queueRows(focus).nth(i).click();
    const card = focus.locator("section.nu-focus-item");
    await expect(card).toHaveAttribute("data-kind", kinds[i]!);
    const first = await card.evaluate((el) => el.firstElementChild?.className ?? "");
    expect(first, `card ${kinds[i]}`).toContain("nu-focus-reading");
    await expect(card.locator(".nu-focus-reading")).not.toBeEmpty();
    await expect(card.locator(".nu-act.primary"), `primary of ${kinds[i]}`).toHaveCount(1);
    // Centred in the stage beside the queue.
    const [c, st] = await Promise.all([card.boundingBox(), focus.locator(".nu-focus-stage").boundingBox()]);
    expect(
      Math.abs(c!.x + c!.width / 2 - (st!.x + st!.width / 2)),
      `centre of ${kinds[i]}`,
    ).toBeLessThanOrEqual(4);
    expect(await card.locator(".nu-focus-acts .nu-act:not(.primary)").count()).toBeLessThanOrEqual(3);
  }
});

test("C10 the resolver says an error once", async ({ page }) => {
  await seedPending(page, { runs: [failedRun("f-json")] });
  const focus = await openResolver(page);
  const card = focus.locator("section.nu-focus-item");
  await expect(card).toHaveAttribute("data-kind", "failure");
  const text = await card.innerText();
  expect(text.split(JSON_ERROR).length - 1).toBe(1);
});

test("C11 moving through the queue animates and counts", async ({ page }) => {
  await seedPending(page, {
    approvals: [decision("d-1"), decision("d-2", Date.now() - 90_000)],
    runs: [failedRun("f-1")],
  });
  const focus = await openResolver(page);
  const pos = focus.locator(".nu-focus-pos");
  await expect(pos).toHaveText(/^1 (de|of) 3$/);
  const card = focus.locator("section.nu-focus-item");
  await page.keyboard.press("ArrowDown");
  await expect(pos).toHaveText(/^2 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "down");
  const motion = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      name: s.animationName,
      ms: parseFloat(s.animationDuration) * (s.animationDuration.endsWith("ms") ? 1 : 1000),
    };
  });
  expect(motion.name).not.toBe("none");
  expect(motion.ms).toBeGreaterThan(0);
  expect(motion.ms).toBeLessThanOrEqual(400);
  await page.keyboard.press("k");
  await expect(pos).toHaveText(/^1 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "up");
  await page.keyboard.press("j");
  await expect(pos).toHaveText(/^2 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "down");
  await page.keyboard.press("ArrowUp");
  await expect(pos).toHaveText(/^1 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "up");
  await queueRows(focus).nth(2).click();
  await expect(pos).toHaveText(/^3 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "down");
});

test("C12 a resolved item leaves and the next takes focus", async ({ page }) => {
  test.setTimeout(60_000); // five items, each resolved through the service: about 22 s, near the 30 s default
  await seedPending(page, {
    approvals: [question("q-1"), decision("d-ok"), decision("d-no", Date.now() - 90_000)],
    runs: [failedRun("f-rerun"), failedRun("f-hush", { finishedAt: Date.now() - 200_000 })],
    // One item that stays, so every resolution has a next item to focus.
    notices: [noticeRow("n-stay", "Worth a look", { ts: Date.now() - 5 * 60_000 })],
  });
  const focus = await openResolver(page);
  const resolveOne = async (id: string, act: () => Promise<void>) => {
    await focus.locator(`nav.nu-focus-queue button[data-id="${id}"]`).click();
    await expect(focus.locator("section.nu-focus-item")).toHaveAttribute("data-id", id);
    // The ghost of a resolved item lives 480 ms: watch for it from before the action instead of polling a window
    // that a loaded machine can miss.
    await page.evaluate(() => {
      const seen = window as unknown as { __ghostSeen: boolean };
      seen.__ghostSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(".nu-focus-ghost")) seen.__ghostSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await act();
    await expect(focus.locator(`nav.nu-focus-queue button[data-id="${id}"]`)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __ghostSeen: boolean }).__ghostSeen))
      .toBe(true);
    await expect(focus.locator("nav.nu-focus-queue button[aria-current='true']")).toHaveCount(1);
    await expect(focus.locator("section.nu-focus-item")).not.toHaveAttribute("data-id", id);
  };
  const card = focus.locator("section.nu-focus-item");
  await resolveOne("decision:d-ok", () => card.getByRole("button", { name: /Approve|Aprovar/ }).click());
  await resolveOne("decision:d-no", () => card.getByRole("button", { name: /Deny|Negar/ }).click());
  await resolveOne("question:q-1", async () => {
    await card.getByRole("radio", { name: "Testes" }).click();
    await card.getByRole("button", { name: /Answer|Responder/ }).click();
  });
  await resolveOne("failure:f-rerun", () =>
    card.getByRole("button", { name: /run again|executar de novo/i }).click(),
  );
  await resolveOne("failure:f-hush", () => card.getByRole("button", { name: /silence|silenciar/i }).click());
});

test("C13 an empty queue says nothing needs you", async ({ page }) => {
  await seedPending(page, {});
  const focus = await openResolver(page);
  const clear = focus.locator(".nu-focus-clear");
  await expect(clear).toContainText(/Nothing needs you|Nada precisa de você/);
  await expect(clear.getByTestId("focus-entity")).toBeVisible();
  await clear.getByRole("button", { name: /Back to the system|Voltar ao sistema/ }).click();
  await expect(focus).toHaveCount(0);
});

/* ---- S3: runs, an overview or one run ------------------------------------------------ */

const TOKEN = { "x-mordomo-token": process.env.MORDOMO_TOKEN ?? "" };
let RUN_ID = "";

/** A real run, shown to the UI as a failed one with an error. */
async function seedRun(page: Page, request: APIRequestContext) {
  if (!RUN_ID) {
    const res = await request.post("/api/runs", {
      headers: TOKEN,
      data: { prompt: "concept run for the river", mode: "read_only" },
    });
    RUN_ID = ((await res.json()) as { runId: string }).runId;
    await expect
      .poll(
        async () =>
          (
            (await (await request.get(`/api/runs/${RUN_ID}`, { headers: TOKEN })).json()) as {
              run: { status: string };
            }
          ).run.status,
        { timeout: 20_000 },
      )
      .toMatch(/done|failed/);
  }
  // Alone in its stretch of the river, so it keeps its own capsule however many runs came before.
  const alone = Date.now() - 5 * 3_600_000;
  const failed = (r: Record<string, unknown>) => ({
    ...r,
    createdAt: alone,
    startedAt: alone,
    finishedAt: alone + 60_000,
    status: "failed",
    error: JSON_ERROR,
    failure: null,
    skillSlug: "consolidate-memory",
  });
  await page.route("**/api/v1/runs?*", async (route) => {
    const real = (await (await route.fetch()).json()) as Array<Record<string, unknown>>;
    await route.fulfill({ json: real.map((r) => (r.id === RUN_ID ? failed(r) : r)) });
  });
  await page.route(`**/api/v1/runs/${RUN_ID}`, async (route) => {
    const real = (await (await route.fetch()).json()) as {
      run: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
    };
    await route.fulfill({
      json: {
        ...real,
        run: failed(real.run),
        events: [...real.events, { type: "error", message: JSON_ERROR, ts: Date.now() }],
      },
    });
  });
}

const runView = (page: Page) => page.locator(".rs-run");
const riverWrap = (page: Page) => page.locator(".rs-river-wrap");

async function openRuns(page: Page, request: APIRequestContext, path?: string) {
  await seedRun(page, request);
  await openShell(page, path ?? "/runs");
  await arrived(page, "runs");
}
async function chooseRun(page: Page) {
  await page.locator(`.rs-cap[data-mark="${RUN_ID}"]`).click();
  await expect(runView(page)).toBeVisible();
}

test("C14 the runs overview is only the river", async ({ page, request }) => {
  await openRuns(page, request);
  await expect(riverWrap(page)).toBeVisible();
  await expect(page.locator(".rs-head")).toBeVisible();
  await expect(runView(page)).toHaveCount(0);
});

test("C15 a chosen run replaces the overview", async ({ page, request }) => {
  await openRuns(page, request);
  await chooseRun(page);
  await expect.poll(async () => (await riverWrap(page).boundingBox())!.height).toBeLessThanOrEqual(120);
  await expect(runView(page)).toHaveCount(1);
  // The run view takes the rest of the scene: below the strip, down to the voice line.
  const strip = (await riverWrap(page).boundingBox())!;
  const view = (await runView(page).boundingBox())!;
  expect(view.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
});

test("C16 the run view has summary, steps and log", async ({ page, request }) => {
  await openRuns(page, request);
  await chooseRun(page);
  const tabs = runView(page).getByRole("tab");
  await expect(tabs).toHaveText([/Summary|Resumo/, /Steps|Passos/, /Log/]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(runView(page).getByRole("tabpanel")).toHaveAttribute("data-tab", "summary");
  await tabs.nth(1).click();
  await expect(runView(page).getByRole("tabpanel")).toHaveAttribute("data-tab", "steps");
  await expect(runView(page).locator(".rs-chain .rs-step").first()).toBeVisible();
  await tabs.nth(2).click();
  await expect(runView(page).getByRole("tabpanel")).toHaveAttribute("data-tab", "log");
});

test("C17 the summary starts with the agent and its actions", async ({ page, request }) => {
  await openRuns(page, request);
  await chooseRun(page);
  const panel = runView(page).getByRole("tabpanel");
  const first = await panel.evaluate((el) => el.firstElementChild?.className ?? "");
  expect(first).toContain("rs-agent-line");
  await expect(panel.locator(".rs-agent-line")).not.toBeEmpty();
  const acts = panel.locator(".rs-run-acts");
  await expect(acts.getByRole("button", { name: /run again|executar de novo/i })).toBeVisible();
  await expect(acts.getByRole("button", { name: /continue|continuar/i })).toBeVisible();
  await expect(acts.getByRole("button", { name: /ask the agent|perguntar ao agente/i })).toBeVisible();
});

test("C18 a run says its error once", async ({ page, request }) => {
  await openRuns(page, request);
  await chooseRun(page);
  const count = async () => (await runView(page).innerText()).split(JSON_ERROR).length - 1;
  // Each section is its own view: in each, once it has loaded, the error is said once.
  for (const tab of [/Summary|Resumo/, /Steps|Passos/, /^Log$/]) {
    await runView(page).getByRole("tab", { name: tab }).click();
    await expect.poll(count, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect(await count(), String(tab)).toBe(1);
  }
});

test("C19 Esc gives the river back", async ({ page, request }) => {
  await openRuns(page, request);
  const full = (await riverWrap(page).boundingBox())!.height;
  await chooseRun(page);
  await page.locator("body").click({ position: { x: 5, y: 450 } });
  await page.keyboard.press("Escape");
  const leaving = page.locator(".rs-run.bye");
  await expect(leaving).toHaveCount(1);
  const ms = await leaving.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) * 1000);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThanOrEqual(450);
  await expect(runView(page)).toHaveCount(0);
  await expect
    .poll(async () => Math.round((await riverWrap(page).boundingBox())!.height))
    .toBe(Math.round(full));
  // The back control does the same.
  await chooseRun(page);
  await runView(page)
    .getByRole("button", { name: /back to the river|voltar ao rio/i })
    .click();
  await expect(runView(page)).toHaveCount(0);
});

test("C20 a run's route opens its view", async ({ page, request }) => {
  await seedRun(page, request);
  await openRuns(page, request, `/runs/${RUN_ID}`);
  await expect(runView(page)).toBeVisible();
  await expect(runView(page)).toHaveAttribute("data-id", RUN_ID);
});

/* ---- S1: one language in every scene -------------------------------------------------- */

const LANGUAGE_SCENES: ReadonlyArray<[string, string]> = [
  ["runs", "/runs"],
  ["skills", "/skills"],
  ["routines", "/routines"],
  ["connectors", "/connectors"],
  ["artifacts", "/artifacts"],
  ["generations", "/generations"],
  ["pixel", "/pixel"],
  ["settings", "/settings"],
];

/** Every visible control of the scene that is chamfered or square-cornered. */
async function squareControls(page: Page): Promise<string[]> {
  return currentScene(page)
    .locator("button, input, textarea, select, [role='dialog']")
    .evaluateAll((els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        })
        .flatMap((el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const raw = s.borderTopLeftRadius;
          const radius = raw.endsWith("%")
            ? (parseFloat(raw) / 100) * Math.min(r.width, r.height)
            : parseFloat(raw) || 0;
          if (s.clipPath === "none" && radius >= 10) return [];
          const name = `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
          const text = (el.textContent ?? "").trim().slice(0, 24) || el.getAttribute("aria-label") || "";
          return [`${name} "${text}" clip=${s.clipPath} r=${raw}`];
        }),
    );
}

test("C1 every control in every scene is rounded glass", async ({ page }) => {
  for (const [scene, path] of LANGUAGE_SCENES) {
    await openShell(page, path);
    await arrived(page, scene);
    // Let a lazy scene finish drawing its controls.
    await page.waitForTimeout(800);
    const square = await squareControls(page);
    expect(square, `square controls in ${scene}`).toEqual([]);
  }
  // The Resolver speaks it too.
  await seedPending(page, { approvals: [decision("d-look")], runs: [failedRun("f-look")] });
  const focus = await openResolver(page);
  await settle(page);
  const square = await focus.locator("button, input, textarea").evaluateAll((els) =>
    els
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.clipPath !== "none" || (parseFloat(s.borderTopLeftRadius) || 0) < 10;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`),
  );
  expect(square, "square controls in the Resolver").toEqual([]);
});

test("C2 no native select in the gallery, connector and skill scenes", async ({ page }) => {
  for (const [scene, path] of [
    ["artifacts", "/artifacts"],
    ["generations", "/generations"],
    ["connectors", "/connectors"],
    ["skills", "/skills"],
  ] as const) {
    await openShell(page, path);
    await arrived(page, scene);
    await page.waitForTimeout(800);
    await expect(currentScene(page).locator("select:visible"), scene).toHaveCount(0);
  }
});

/** A dialog the shell raises from a scene: the write gate of a connector. */
async function openWriteGate(page: Page) {
  const cards = await openConnectors(page);
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    await cards.nth(i).locator(".cx-card-head").click();
    const ask = cards.nth(i).getByRole("button", { name: /request write|solicitar escrita/i });
    if (await ask.count()) {
      await ask.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      return { dialog, trigger: ask };
    }
  }
  throw new Error("no connector offers a write gate");
}

test("C3 a dialog rises as a sheet over the veil", async ({ page }) => {
  // The conversation's veil, to compare with.
  await openShell(page, "/connectors");
  await arrived(page, "connectors");
  await page.locator(".cons-input").focus();
  await expect(page.locator(".nu-dialog-veil")).toBeVisible();
  await settle(page);
  const convVeil = await page.locator(".nu-dialog-veil").evaluate((el) => ({
    bf: getComputedStyle(el).backdropFilter,
    bg: getComputedStyle(el).backgroundImage,
  }));
  await page.keyboard.press("Escape");
  const { dialog } = await openWriteGate(page);
  const entering = await dialog.evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, duration: s.animationDuration };
  });
  await settle(page);
  const look = await dialog.evaluate((el) => {
    const s = getComputedStyle(el);
    const veil = getComputedStyle(el.parentElement!);
    return {
      clip: s.clipPath,
      radius: parseFloat(s.borderTopLeftRadius),
      glass: s.backdropFilter,
      veilBlur: veil.backdropFilter,
      veilBg: veil.backgroundImage,
    };
  });
  expect(look.clip).toBe("none");
  expect(look.radius).toBeGreaterThanOrEqual(20);
  expect(look.glass).toContain("blur");
  expect(entering.name).not.toBe("none");
  const secs = (v: string) =>
    Math.max(...v.split(",").map((x) => parseFloat(x) * (x.includes("ms") ? 1 : 1000)));
  expect(secs(entering.duration)).toBeLessThanOrEqual(450);
  expect(look.veilBlur).toContain("blur");
  // The same veil: the same blur and the same glow.
  expect(look.veilBlur).toBe(convVeil.bf);
  expect(look.veilBg).toBe(convVeil.bg);
});

test("C4 a dialog folds on Esc and on the veil and gives focus back", async ({ page }) => {
  const first = await openWriteGate(page);
  // Visible is not ready: a dialog takes the focus, and listens for Escape, a moment after it is drawn.
  const ready = () =>
    expect
      .poll(() => page.getByRole("dialog").evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
  await ready();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(first.trigger).toBeFocused();
  await first.trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await ready();
  // The layer arms its click-outside a tick after it mounts: click again only while the dialog is still there (the
  // corner is the pending hub once it is gone).
  await expect(async () => {
    if (await page.getByRole("dialog").count()) await page.mouse.click(8, 8);
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(first.trigger).toBeFocused();
});

/* ---- S4: skills, the ring in the middle and the rest on demand ----------------------------- */

async function openSkills(page: Page) {
  await openShell(page, "/skills");
  await arrived(page, "skills");
  await expect(page.locator(".sks-focus")).toBeVisible();
}

test("C22 skill filters are one search and one row of chips", async ({ page }) => {
  await openSkills(page);
  const bar = page.locator(".sks-bar");
  await expect(bar).toBeVisible();
  const search = bar.locator("input[type='search']");
  await expect(search).toHaveCount(1);
  const pill = await search.evaluate((el) => {
    const s = getComputedStyle(el);
    return parseFloat(s.borderTopLeftRadius) >= el.getBoundingClientRect().height / 2 - 1;
  });
  expect(pill).toBe(true);
  const chips = bar.locator(".sks-chips > button");
  expect(await chips.count()).toBeGreaterThan(3);
  const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  // Above the ring.
  const barBox = (await bar.boundingBox())!;
  const stageBox = (await page.locator(".sks-stage").boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(stageBox.y + 1);
  // Nothing else filters on the side any more: the one row of chips is the bar's.
  await expect(page.locator(".sks-chips")).toHaveCount(1);
  await expect(bar.locator(".sks-chips")).toHaveCount(1);
});

test("C23 one plus menu holds marketplace, export and new", async ({ page }) => {
  await openSkills(page);
  const scene = currentScene(page);
  for (const name of [/^(Marketplace)$/i, /export|exportar/i, /new skill|nova skill/i])
    await expect(scene.getByRole("button", { name })).toHaveCount(0);
  const more = page.getByTestId("skills-more");
  await expect(more).toHaveAttribute("aria-haspopup", "menu");
  await more.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    /Marketplace/i,
    /export|exportar/i,
    /new skill|nova skill/i,
  ]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("C24 skill details wait to be asked", async ({ page }) => {
  await openSkills(page);
  await expect(page.locator(".sks-read")).toHaveCount(0);
  await page
    .locator(".sks-focus")
    .getByRole("button", { name: /^(details|detalhes)$/i })
    .click();
  const read = page.locator(".sks-read");
  await expect(read).toBeVisible();
  await expect(read).toContainText(/Recent runs|Execuções recentes|History|Histórico/i);
  await expect(read).toContainText(/Model|Modelo/i);
  await expect(read).toContainText(/Inputs|Entradas/i);
  await page
    .locator(".sks-focus")
    .getByRole("button", { name: /^(details|detalhes)$/i })
    .click();
  await expect(read).toHaveCount(0);
});

test("C25 skill dialogs are the shell's sheet", async ({ page }) => {
  await openSkills(page);
  const isSheet = async () => {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const look = await dialog.evaluate((el) => ({
      modal: el.classList.contains("modal"),
      veil: el.parentElement?.classList.contains("modal-backdrop") ?? false,
      radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
      glass: getComputedStyle(el).backdropFilter,
    }));
    expect(look.modal && look.veil).toBe(true);
    expect(look.radius).toBeGreaterThanOrEqual(20);
    expect(look.glass).toContain("blur");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  };
  for (const item of [/Marketplace/i, /new skill|nova skill/i]) {
    await page.getByTestId("skills-more").click();
    await page.getByRole("menuitem", { name: item }).click();
    await isSheet();
  }
  await page
    .locator(".sks-focus")
    .getByRole("button", { name: /^(edit|editar)$/i })
    .click();
  await isSheet();
});

test("C26 an empty marketplace says so and offers one action", async ({ page }) => {
  await page.route("**/api/v1/skills/registry*", async (route) => {
    const real = (await (await route.fetch()).json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...real, registries: [], skills: [], errors: [] } });
  });
  await openSkills(page);
  await page.getByTestId("skills-more").click();
  await page.getByRole("menuitem", { name: /Marketplace/i }).click();
  const empty = page.getByRole("dialog").locator(".market-empty");
  await expect(empty).toBeVisible();
  await expect(empty.locator("p")).toHaveCount(1);
  await expect(empty.getByRole("link")).toHaveText(/configure registries|configurar registros/i);
  await expect(page.getByRole("dialog").locator("input")).toHaveCount(0);
});

/* ---- S6: the galleries ------------------------------------------------------------------- */

const GALLERIES = [
  ["artifacts", "/artifacts"],
  ["generations", "/generations"],
] as const;

/** A few artifacts of different kinds, so every gallery has something to show and filter. */
async function seedArtifacts(page: Page) {
  const now = Date.now();
  const item = (id: string, kind: string, file: string, skillSlug: string | null) => ({
    id,
    path: `artifacts/${file}`,
    file,
    folder: "artifacts",
    title: file,
    kind,
    sizeBytes: 1200,
    createdAt: now - 3_600_000,
    thumbnail: false,
    skillSlug,
    runId: null,
  });
  await page.route(/\/api\/v1\/artifacts\/list(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [
          item("a1", "image", "concept-one.png", "pixel"),
          item("a2", "video", "concept-two.mp4", "pixel"),
          item("a3", "markdown", "concept-notes.md", "consolidate-memory"),
        ],
        total: 3,
        skills: ["consolidate-memory", "pixel"],
      },
    }),
  );
}

test("C32 one search field per gallery", async ({ page }) => {
  await seedArtifacts(page);
  for (const [scene, path] of GALLERIES) {
    await openShell(page, path);
    await arrived(page, scene);
    const s = currentScene(page);
    await expect(s.locator("input[type='search']:visible")).toHaveCount(1);
    // No second, visible copy of its label beside it.
    const said = await s.evaluate((el) => {
      const input = el.querySelector<HTMLInputElement>("input[type='search']")!;
      const words = input.placeholder.trim();
      return [...el.querySelectorAll("label, span, p")].filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && n.textContent?.trim() === words;
      }).length;
    });
    expect(said, scene).toBe(0);
  }
});

test("C33 gallery filters are chips", async ({ page }) => {
  await seedArtifacts(page);
  for (const [scene, path] of GALLERIES) {
    await openShell(page, path);
    await arrived(page, scene);
    const chipsOf = currentScene(page).locator(".art-filters");
    for (const group of ["kind", "origin", "period"])
      expect(
        await chipsOf.locator(`[data-filter="${group}"] > button`).count(),
        `${scene} ${group}`,
      ).toBeGreaterThan(1);
  }
  // Generations offers only the kinds it holds.
  await expect(currentScene(page).locator('.art-filters [data-filter="kind"] > button')).toHaveText([
    /all|todos/i,
    /image|imagens/i,
    /video|vídeo/i,
  ]);
  await openShell(page, "/artifacts");
  await arrived(page, "artifacts");
  const bar = currentScene(page).locator(".art-filters");
  for (const group of ["kind", "origin", "period"]) {
    const chips = bar.locator(`[data-filter="${group}"] > button`);
    expect(await chips.count(), group).toBeGreaterThan(1);
    const pill = await chips
      .first()
      .evaluate(
        (el) =>
          parseFloat(getComputedStyle(el).borderTopLeftRadius) >= el.getBoundingClientRect().height / 2 - 1,
      );
    expect(pill, group).toBe(true);
  }
  await bar.locator('[data-filter="kind"] > button', { hasText: /^(notes|notas)$/i }).click();
  await expect(currentScene(page).locator(".art-card")).toHaveCount(1);
  await expect(bar.locator('[data-filter="kind"] > button[aria-pressed="true"]')).toHaveText(
    /^(notes|notas)$/i,
  );
});

test("C34 a gallery item opens from its tile", async ({ page }) => {
  await seedArtifacts(page);
  await openShell(page, "/artifacts");
  await arrived(page, "artifacts");
  const tile = currentScene(page).locator(".art-card").first();
  // Where the tile is at the very press (its hover lifts it).
  const pressed = tile.evaluate(
    (el) =>
      new Promise<{ x: number; y: number; w: number; h: number }>((resolve) =>
        el.addEventListener(
          "pointerdown",
          () => {
            const r = el.getBoundingClientRect();
            resolve({ x: r.left, y: r.top, w: r.width, h: r.height });
          },
          { once: true, capture: true },
        ),
      ),
  );
  await tile.click();
  const from = await pressed;
  const lam = page.locator('article.nu-lamina[data-lamina^="doc:"]');
  await expect(lam).toHaveCount(1);
  // Freeze the entrance on its first frame and read where the lâmina actually is.
  const start = await lam.evaluate((el) => {
    const a = el.getAnimations().find((x) => !(x instanceof CSSAnimation));
    if (!a) return null;
    a.pause();
    a.currentTime = 0;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  expect(start, "the lâmina grows from somewhere").toMatchObject({ x: expect.any(Number) });
  const at = start as { x: number; y: number };
  // Its first frame starts on the tile that was pressed: on its corner.
  expect(Math.abs(at.x - from.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(at.y - from.y)).toBeLessThanOrEqual(4);
});

test("C35 an empty filter offers to clear", async ({ page }) => {
  await seedArtifacts(page);
  for (const [scene, path] of GALLERIES) {
    await openShell(page, path);
    await arrived(page, scene);
    const s = currentScene(page);
    await s.locator("input[type='search']").fill("nothing-matches-this");
    await expect(s.locator(".art-card")).toHaveCount(0);
    const empty = s.locator(".art-empty");
    await expect(empty).toContainText(/Nothing here with these filters|Nada aqui com esses filtros/);
    await empty.getByRole("button", { name: /clear filters|limpar filtros/i }).click();
    await expect(s.locator(".art-card").first()).toBeVisible();
    await expect(s.locator("input[type='search']")).toHaveValue("");
  }
});

/* ---- S7: the agent takes any focused item -------------------------------------------------- */

/** The voice line after "ask the agent": open, with an @reference to the item in it. */
async function askedAbout(page: Page, about: RegExp) {
  await expect(page.getByTestId("voice")).toHaveAttribute("data-open", "");
  const line = page.locator(".cons-input");
  await expect(line).toHaveValue(/@\S+/);
  const ref = /@(\S+)/.exec(await line.inputValue())![1]!;
  expect(ref, "the reference names the item").toMatch(about);
  // The reference resolves: the line's context offers it.
  await expect(page.locator(".cons-tray, #cons-side").getByText(`@${ref}`).first()).toBeAttached();
}

test("C36 ask the agent carries the item", async ({ page, request }) => {
  // A pendência: a failed run in the Resolver.
  await seedPending(page, { runs: [failedRun("f-ask")] });
  let focus = await openResolver(page);
  await focus
    .locator("section.nu-focus-item")
    .getByRole("button", { name: /ask the agent|perguntar ao agente/i })
    .click();
  await askedAbout(page, /f-ask/);
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // A run in focus.
  await openRuns(page, request);
  await chooseRun(page);
  await runView(page)
    .getByRole("button", { name: /ask the agent|perguntar ao agente/i })
    .click();
  await askedAbout(page, new RegExp(RUN_ID.slice(0, 6)));
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // A skill, from its details.
  await openSkills(page);
  const slug = ((await page.locator(".sks-focus .sks-cmd").textContent()) ?? "").replace("/", "").trim();
  await page
    .locator(".sks-focus")
    .getByRole("button", { name: /^(details|detalhes)$/i })
    .click();
  await page
    .locator(".sks-read")
    .getByRole("button", { name: /ask the agent|perguntar ao agente/i })
    .click();
  await askedAbout(page, new RegExp(slug));

  // A connector, opened.
  const cards = await openConnectors(page);
  await cards.first().locator(".cx-card-head").click();
  const id = (await cards.first().getAttribute("data-id")) ?? "";
  await cards
    .first()
    .getByRole("button", { name: /ask the agent|perguntar ao agente/i })
    .click();
  await askedAbout(page, new RegExp(id.split(/[^a-z0-9]/i)[0]!, "i"));

  // An artifact, from its lâmina.
  await seedArtifacts(page);
  await openShell(page, "/artifacts");
  await arrived(page, "artifacts");
  await currentScene(page).locator(".art-card").first().click();
  focus = page.locator('article.nu-lamina[data-lamina^="doc:"]');
  await focus.getByRole("button", { name: /ask the agent|perguntar ao agente/i }).click();
  await askedAbout(page, /concept/);
});

for (const theme of ["dark", "light"] as const)
  test(`C5 the new glass surfaces keep their contrast (${theme})`, async ({ page, request }) => {
    const surfaces: ReadonlyArray<[string, () => Promise<string>]> = [
      [
        "resolver",
        async () => {
          await seedPending(page, { runs: [failedRun("f-contrast")] });
          await openResolver(page);
          return "section.nu-focus-item";
        },
      ],
      [
        "connector",
        async () => {
          const cards = await openConnectors(page);
          await cards.first().locator(".cx-card-head").click();
          return "[data-testid='connector-card'][data-open]";
        },
      ],
      [
        "skills bar",
        async () => {
          await openSkills(page);
          return ".sks-bar";
        },
      ],
      [
        "run view",
        async () => {
          await openRuns(page, request);
          await chooseRun(page);
          return ".rs-run";
        },
      ],
      [
        "dialog sheet",
        async () => {
          await openWriteGate(page);
          return "[role='dialog']";
        },
      ],
      [
        "galleries",
        async () => {
          await openShell(page, "/artifacts");
          await arrived(page, "artifacts");
          return ".art-filters";
        },
      ],
    ];
    {
      for (const [name, open] of surfaces) {
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await page.route("**/api/v1/meta", async (interception) => {
          const response = await interception.fetch();
          await interception.fulfill({ response, json: { ...(await response.json()), theme } });
        });
        const selector = await open();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        // Read once everything has risen: mid-entrance text is still fading in.
        await settle(page);
        const result = await new AxeBuilder({ page })
          .include(selector)
          .withRules(["color-contrast"])
          .analyze();
        expect(
          result.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`)),
          `${name} in ${theme}`,
        ).toEqual([]);
      }
    }
  });

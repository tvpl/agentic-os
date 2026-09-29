/**
 * The immersive concept across the whole system
 * (.specs/features/conceito-em-todo-sistema): every scene speaks the same
 * language as the Núcleo and the conversation, shows one thing in focus and
 * the rest on demand, says each cause once, and lets the agent take any
 * focused item. Each test is named after the check it proves (C1…C36).
 */
import { test, expect, type Page } from "@playwright/test";
import { arrived, currentScene, openShell } from "./shell";

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
  await page.route("**/api/approvals", (route) => route.fulfill({ json: state.approvals }));
  await page.route("**/api/approvals/*/resolve", async (route) => {
    const id = decodeURIComponent(route.request().url().split("/approvals/")[1]!.split("/")[0]!);
    state.approvals = state.approvals.filter((a) => a.id !== id);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/runs/*/retry", (route) => route.fulfill({ json: { runId: null } }));
  await page.route("**/api/runs?*", async (route) => {
    const real = (await (await route.fetch()).json()) as Array<{ status: string }>;
    const quiet = real.filter((r) => r.status !== "failed" && r.status !== "timed_out");
    await route.fulfill({ json: [...(seed.runs ?? []), ...quiet] });
  });
  await page.route(/\/api\/routines(\?.*)?$/, async (route) => {
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
  await page.route("**/api/notifications?*", (route) =>
    route.fulfill({ json: { items: seed.notices ?? [], unread: (seed.notices ?? []).length } }),
  );
  await page.route(/\/api\/settings(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const real = (await (await route.fetch()).json()) as { limits?: Record<string, unknown> };
    await route.fulfill({ json: { ...real, limits: { ...(real.limits ?? {}), dailyBudgetUsd: 10 } } });
  });
  await page.route(/\/api\/metrics(\?.*)?$/, async (route) => {
    const real = (await (await route.fetch()).json()) as { cost?: Record<string, unknown> };
    await route.fulfill({
      json: { ...real, cost: { ...(real.cost ?? {}), todayUsd: seed.budgetOver ? 1_000 : 0 } },
    });
  });
  await page.route(/\/api\/providers(\?.*)?$/, async (route) => {
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
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
  await page.keyboard.press("k");
  await expect(pos).toHaveText(/^1 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "up");
  await queueRows(focus).nth(2).click();
  await expect(pos).toHaveText(/^3 (de|of) 3$/);
  await expect(card).toHaveAttribute("data-dir", "down");
});

test("C12 a resolved item leaves and the next takes focus", async ({ page }) => {
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
    await act();
    await expect(focus.locator(`nav.nu-focus-queue button[data-id="${id}"]`)).toHaveCount(0);
    await expect(focus.locator(".nu-focus-ghost")).toHaveCount(1);
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

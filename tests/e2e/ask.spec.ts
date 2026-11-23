/**
 * "Perguntar" in a real browser (.specs/features/cerebro-perguntar, C79, C95, C97, C98; design.md "Vista - Perguntar"):
 * the citations wrap at 320px and lead to `/brain?sel=<fileId>`; no serious axe violation in both shells and both themes,
 * empty, answering, a reason-first answer with its provocation (the Fold open) and refused; the view's own chunk, fetched
 * only when `/brain/ask` opens; and the plan's independent test of S5 on the real service, whose provider is the fake
 * CLI: `[[answer]]` in the question makes the fake run copy `artifacts/e2e-answer.json` (written here) into its own
 * directory as `answer.json`, and `[[sleep:N]]` keeps it running N seconds.
 *
 * The notes are real files of the isolated e2e home (a folder under `memory/notes/`), indexed through the API with the
 * page's own token and taken away (and the index redone) after each test. The states of C95 are the routes' answers as
 * the service gives them, answered by the browser so each state is on screen when axe reads it. The interface reads
 * pt-BR, so the claims' own words are the ones asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_HOME } from "./home.mjs";

type Shell = "moldura" | "nucleo";
type Theme = "dark" | "light";
const SHELLS: Shell[] = ["moldura", "nucleo"];
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const stamp = Date.now().toString(36);
const MEMORY = path.join(E2E_HOME, "memory");
const ANSWER = path.join(E2E_HOME, "artifacts", "e2e-answer.json");
/** What a test wrote, taken away after it. */
const made: string[] = [];

type Patch = (json: any) => any;
async function seed(page: Page, shell: Shell, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fed = (patch: Patch) => async (route: Route) => {
    try {
      const response = await route.fetch();
      if (!response.ok()) return await route.fulfill({ response });
      await route.fulfill({ response, json: patch(await response.json()) });
    } catch {
      /* disposed with the page it was for */
    }
  };
  // No remembered mode or scope: each test starts from the first open (direct, the whole brain).
  await page.route(
    /\/api\/(v1\/)?ui-preferences(\?.*)?$/,
    fed((j) => ({ ...j, shell, activeContext: null, brain: { ...(j.brain ?? {}), ask: undefined } })),
  );
  await page.route(
    "**/api/v1/meta",
    fed((j) => ({ ...j, theme, language: "pt-BR" })),
  );
}

async function open(page: Page, shell: Shell, theme: Theme, at: string, width = 1440) {
  await seed(page, shell, theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
}

async function api(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ([m, u, b]) => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="mordomo-token"]')?.content ?? "";
      const res = await fetch(u as string, {
        method: m as string,
        headers: { "x-mordomo-token": token, ...(b ? { "content-type": "application/json" } : {}) },
        ...(b ? { body: JSON.stringify(b) } : {}),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [method, url, body],
  );
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  made.push(file);
}

interface Notes {
  onboarding: string;
  plano: string;
  contrato: string;
}
/** Three notes: the decision (the markers of the fake run are words of it, so the recall finds every keyword). */
async function makeNotes(page: Page): Promise<Notes> {
  const folder = path.join(MEMORY, "notes", `e2e-perguntar-${stamp}`);
  made.push(folder);
  const notes = {
    onboarding: path.join(folder, "onboarding.md"),
    plano: path.join(folder, "plano.md"),
    contrato: path.join(folder, "contrato.md"),
  };
  write(
    notes.onboarding,
    `# Onboarding ${stamp}\n\n## Decisão\n\nDecidi fazer o onboarding em duas etapas. Marcadores do teste: answer sleep.\n`,
  );
  write(
    notes.plano,
    `---\nnatureza: plano\n---\n\n# Plano ${stamp}\n\n## Próximos passos\n\nTestar com três clientes.\n`,
  );
  write(notes.contrato, `# Contrato ${stamp}\n\n## Cláusula\n\nO contrato pede uma etapa só.\n`);
  const indexed = await api(page, "POST", "/api/v1/memory/index");
  expect(indexed.status, JSON.stringify(indexed.json)).toBe(200);
  return notes;
}

/** The answer the fake run copies: two paragraphs and a provocation, or the reason-first feedback. */
function answerFile(n: Notes, reasonFirst = false, cites = 0) {
  const decisao = { path: n.onboarding, section: "Decisão" };
  const passos = { path: n.plano, section: "Próximos passos" };
  const many = Array.from({ length: cites }, (_, i) => (i % 2 ? passos : decisao));
  write(
    ANSWER,
    JSON.stringify({
      v: 1,
      paragraphs: [
        { text: "Você decidiu fazer o onboarding em duas etapas.", citations: [decisao] },
        {
          text: "O próximo passo é **testar** com três clientes.",
          citations: cites ? many : [decisao, passos],
        },
      ],
      ...(reasonFirst
        ? {
            takeFeedback: {
              agrees: [],
              disagrees: [{ text: "As notas pedem duas etapas.", citations: [decisao] }],
              missing: [],
            },
          }
        : {}),
      provocation: {
        kind: "contradiz",
        text: "O contrato pede uma etapa só.",
        citation: { path: n.contrato, section: "Cláusula" },
      },
    }),
  );
}

test.afterEach(async ({ page }) => {
  for (const f of made.splice(0)) fs.rmSync(f, { recursive: true, force: true });
  if (page.url().startsWith("http")) await api(page, "POST", "/api/v1/memory/index").catch(() => undefined);
});

const view = (page: Page) => page.locator(".ask");
const ASK_ITEM = /\/api\/v1\/memory\/ask\/([^/?]+)$/;

/** Ask `question` in the view and wait for its run to be answered; the ask's id. */
async function ask(page: Page, question: string): Promise<string> {
  await view(page).getByRole("textbox", { name: "Pergunta", exact: true }).fill(question);
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/memory/ask") && r.request().method() === "POST",
  );
  await view(page).getByRole("button", { name: "Perguntar", exact: true }).click();
  const response = await posted;
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(202);
  return json.id as string;
}

/* ---------------- C79: the citations, in a real browser ---------------- */

test("C79 the moldura at 320px: each paragraph with its citations, which wrap (flex-wrap: wrap, no horizontal scroll), and a click on one reaches /brain?sel=<fileId>", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, "moldura", "dark", "/brain");
  const n = await makeNotes(page);
  answerFile(n, false, 6);
  await page.goto("/#/brain/ask");
  await expect(view(page).locator("h1")).toHaveText("Perguntar ao cérebro");
  const id = await ask(page, "O que decidi sobre o onboarding? [[answer]]");
  await expect(view(page).locator(".ask-par")).toHaveCount(2, { timeout: 30_000 });
  await page.setViewportSize({ width: 320, height: 800 });
  const rows = view(page).locator(".ask-par .ask-cites");
  await expect(rows.nth(1).locator(".ask-cite")).toHaveCount(6);
  for (let i = 0; i < 2; i++) {
    const row = rows.nth(i);
    expect(await row.evaluate((el) => getComputedStyle(el).flexWrap)).toBe("wrap");
    const fits = await row.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        scroll: el.scrollWidth <= el.clientWidth + 1,
        inside: [...el.querySelectorAll(".ask-cite")].every(
          (c) => c.getBoundingClientRect().right <= box.right + 1,
        ),
      };
    });
    expect(fits).toEqual({ scroll: true, inside: true });
  }
  // The six citations take more than one line at 320px: they wrapped.
  const tops = await rows
    .nth(1)
    .locator(".ask-cite")
    .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(tops).toBeGreaterThan(1);
  expect(await view(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const detail = await api(page, "GET", `/api/v1/memory/ask/${id}`);
  const fileId = detail.json.answer.paragraphs[1].citations[1].fileId as number;
  await page.setViewportSize({ width: 1440, height: 900 });
  await view(page)
    .locator(".ask-par")
    .nth(1)
    .getByRole("button", { name: "plano.md § Próximos passos" })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`#/brain\\?sel=${fileId}(&|$)`));
});

/* ---------------- C95: axe in both shells, both themes, four states ---------------- */

const NOW = Date.now();
const CITE = (name: string, section: string, fileId: number, natureza?: string) => ({
  path: `${E2E_HOME}/memory/notes/${name}`,
  section,
  name,
  fileId,
  ...(natureza ? { natureza } : {}),
});
const ITEMS = [
  {
    id: "e2e-running",
    question: "O que está parado?",
    mode: "direct",
    scope: { kind: "all" },
    status: "running",
    startedAt: NOW - 60_000,
  },
  {
    id: "e2e-answered",
    question: "O que decidi sobre o onboarding?",
    mode: "reason_first",
    scope: { kind: "all" },
    status: "answered",
    startedAt: NOW - 120_000,
    finishedAt: NOW - 78_000,
  },
  {
    id: "e2e-refused",
    question: "Quem é a Ana?",
    mode: "direct",
    scope: { kind: "all" },
    status: "refused",
    startedAt: NOW - 180_000,
    finishedAt: NOW - 170_000,
  },
];
const RUN = { provider: "claude", startedAt: NOW - 120_000, finishedAt: NOW - 78_000 };
const DETAILS: Record<string, unknown> = {
  "e2e-running": { ...ITEMS[0], run: { provider: "claude", startedAt: NOW - 60_000 } },
  "e2e-answered": {
    ...ITEMS[1],
    take: "Acho que o onboarding devia ser uma etapa só, sem formulário.",
    answer: {
      paragraphs: [
        {
          text: "Você decidiu fazer o onboarding em duas etapas.",
          citations: [CITE("onboarding.md", "Decisão", 1)],
        },
        {
          text: "O próximo passo é **testar** com três clientes.",
          citations: [CITE("onboarding.md", "Decisão", 1), CITE("plano.md", "Próximos passos", 2, "plano")],
        },
      ],
      takeFeedback: {
        agrees: [
          { text: "As notas também pedem menos passos.", citations: [CITE("onboarding.md", "Decisão", 1)] },
        ],
        disagrees: [
          { text: "A decisão foi por duas etapas.", citations: [CITE("onboarding.md", "Decisão", 1)] },
        ],
        missing: [
          {
            text: "Nenhuma nota fala do custo.",
            citations: [CITE("plano.md", "Próximos passos", 2, "plano")],
          },
        ],
      },
      provocation: {
        kind: "contradiz",
        text: "O contrato pede uma etapa só.",
        citation: CITE("contrato.md", "Cláusula", 3, "opiniao"),
      },
    },
    run: RUN,
  },
  "e2e-refused": {
    ...ITEMS[2],
    reason: "A citação do parágrafo 1 nomeia /x/memory/notes/ana.md, que o índice não tem.",
    run: { provider: "claude", startedAt: NOW - 180_000, finishedAt: NOW - 170_000 },
  },
};

/** The list and each ask answered as the service would, by the browser. */
async function states(page: Page, items: unknown[]) {
  await page.route(/\/api\/v1\/memory\/ask(\?.*)?$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { items } }) : route.fallback(),
  );
  await page.route(ASK_ITEM, (route) => {
    const id = decodeURIComponent(ASK_ITEM.exec(route.request().url())![1]!);
    return route.fulfill({ json: DETAILS[id] });
  });
}

async function serious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C95 /brain/ask in the ${shell}, ${theme}: empty, answering, a reason-first answer with its provocation (the Fold open) and refused, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await open(page, shell, theme, "/brain");
      await states(page, []);
      await page.evaluate(() => document.fonts.ready);
      await page.goto("/#/brain/ask");
      const v = view(page);
      await expect(v.locator("h1")).toHaveText("Perguntar ao cérebro");
      // empty
      await expect(v.getByText("Nenhuma pergunta ainda.")).toBeVisible();
      expect(await serious(page)).toEqual([]);
      // answering
      await page.unroute(/\/api\/v1\/memory\/ask(\?.*)?$/);
      await states(page, ITEMS);
      await page.reload();
      await expect(v.locator(".ask-row")).toHaveCount(3);
      await v.locator(".ask-row", { hasText: "O que está parado?" }).click();
      await expect(v.getByRole("status")).toHaveText("Lendo as suas notas e escrevendo a resposta…");
      expect(await serious(page)).toEqual([]);
      // a reason-first answer with its provocation, the Fold open
      await v.locator(".ask-row", { hasText: "O que decidi sobre o onboarding?" }).click();
      await expect(v.locator(".ask-take")).toBeVisible();
      await v.getByRole("button", { name: "Ver a resposta do cérebro" }).click();
      await expect(v.locator(".ask-par").first()).toBeVisible();
      await expect(v.locator(".ask-provocation")).toBeVisible();
      expect(await serious(page)).toEqual([]);
      // refused
      await v.locator(".ask-row", { hasText: "Quem é a Ana?" }).click();
      await expect(v.locator(".ask-band")).toContainText("A resposta não passou na conferência das fontes.");
      expect(await serious(page)).toEqual([]);
    });

/* ---------------- C97: the view's own chunk ---------------- */

test("C97 opening /brain fetches no chunk of the view; opening /brain/ask fetches its own chunk (AskView)", async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
  });
  await open(page, "moldura", "dark", "/brain");
  await expect(
    page.locator(".brain-topbar-actions").getByRole("button", { name: "Perguntar" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(scripts.filter((s) => /\/assets\/AskView-[\w-]+\.js$/.test(s))).toEqual([]);
  await page.locator(".brain-topbar-actions").getByRole("button", { name: "Perguntar" }).click();
  await expect(view(page).locator("h1")).toHaveText("Perguntar ao cérebro");
  expect(scripts.filter((s) => /\/assets\/AskView-[\w-]+\.js$/.test(s))).toHaveLength(1);
});

/* ---------------- C98: the whole flow on the real service ---------------- */

test("C98 the moldura: ask directly with the fake CLI, see the answering state, the 2 paragraphs with their citations and the provocation, and a citation reaching /brain?sel=<id>; then Raciocine primeiro with a 25-character view shows Sua visão first", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page, "moldura", "light", "/brain");
  const n = await makeNotes(page);
  answerFile(n);
  await page.goto("/#/brain/ask");
  const v = view(page);
  await expect(v.locator("h1")).toHaveText("Perguntar ao cérebro");
  await expect(v.getByRole("tab", { name: "Perguntar direto" })).toHaveAttribute("aria-selected", "true");
  const id = await ask(page, "O que decidi sobre o onboarding? [[answer]] [[sleep:3]]");
  await expect(v.getByRole("status")).toHaveText("Lendo as suas notas e escrevendo a resposta…");
  await expect(v.getByText("Isso usa uma execução do Claude.")).toBeVisible();
  const pars = v.locator(".ask-par");
  await expect(pars).toHaveCount(2, { timeout: 30_000 });
  await expect(pars.nth(0).locator(".ask-md")).toHaveText("Você decidiu fazer o onboarding em duas etapas.");
  await expect(pars.nth(1).locator(".ask-md")).toHaveText("O próximo passo é testar com três clientes.");
  await expect(pars.nth(0).locator(".ask-cite")).toHaveText(["onboarding.md § Decisão"]);
  await expect(pars.nth(1).locator(".ask-cite")).toHaveText([
    "onboarding.md § Decisão",
    "plano.md § Próximos passos",
  ]);
  await expect(pars.nth(1).locator(".nb")).toHaveCount(1);
  const provocation = v.locator(".ask-provocation");
  await expect(provocation).toContainText("Uma nota contradiz isto");
  await expect(provocation).toContainText("O contrato pede uma etapa só.");
  await expect(provocation.locator(".ask-cite")).toHaveText(["contrato.md § Cláusula"]);
  await expect(v.locator(".ask-how")).toContainText("Respondida por Claude em");
  const detail = await api(page, "GET", `/api/v1/memory/ask/${id}`);
  expect(detail.json.status).toBe("answered");
  const fileId = detail.json.answer.paragraphs[0].citations[0].fileId as number;
  await pars.nth(0).getByRole("button", { name: "onboarding.md § Decisão" }).click();
  await expect(page).toHaveURL(new RegExp(`#/brain\\?sel=${fileId}(&|$)`));

  // Raciocine primeiro, with a 25-character view.
  answerFile(n, true);
  await page.goto("/#/brain/ask");
  await expect(v.locator("h1")).toHaveText("Perguntar ao cérebro");
  await v.getByRole("tab", { name: "Raciocine primeiro" }).click();
  const take = "Duas etapas são demais ok";
  expect(take).toHaveLength(25);
  await v.getByRole("textbox", { name: "Sua visão", exact: true }).fill(take);
  await expect(v.getByText("25 caracteres")).toBeVisible();
  await ask(page, "O que decidi sobre o onboarding? [[answer]]");
  const answer = v.locator(".ask-answer");
  await expect(answer).toBeVisible({ timeout: 30_000 });
  await expect(answer.locator("h2").first()).toHaveText("Sua visão");
  await expect(answer.locator(".ask-take-text")).toHaveText(take);
  await expect(answer.locator(".ask-fb h2")).toHaveText(["Onde discordam"]);
  await expect(answer.getByRole("button", { name: "Ver a resposta do cérebro" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

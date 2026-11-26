/**
 * "Entidades" and "Resumos" in a real browser (.specs/features/cerebro-entidades-resumos, C101, C119, C130, C131;
 * design.md "Vista - Entidades", "Painel da entidade" and "Vista - Resumos"). Entidades: the two columns at 1280×800 in both shells (the list 320px on the left, the entity's panel the
 * rest), the regions of each column one under the other, one column at 700px wide where an open entity replaces the
 * list with "Voltar" at the top, and no horizontal scroll at 360px.
 *
 * The notes are real files of the isolated e2e home (a folder under `memory/notes/`), indexed through the API with the
 * page's own token and taken away (and the index redone) after each test. The entity's "TALVEZ SEJA A MESMA" and
 * "Correções" are the route's answer as the service gives it, with one duplicate and one correction added by the
 * browser, so the arrangement is measured with every section on screen and nothing is written to the home's
 * corrections. The interface reads pt-BR, so the claims' own words are the ones asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_HOME } from "./home.mjs";

type Shell = "moldura" | "nucleo";
type Theme = "dark" | "light";
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHELLS: Shell[] = ["moldura", "nucleo"];
const stamp = Date.now().toString(36);
const MEMORY = path.join(E2E_HOME, "memory");
/** What a test wrote, taken away after it. */
const made: string[] = [];

type Patch = (json: any) => any;
const fed = (patch: Patch) => async (route: Route) => {
  try {
    const response = await route.fetch();
    if (!response.ok()) return await route.fulfill({ response });
    await route.fulfill({ response, json: patch(await response.json()) });
  } catch {
    /* disposed with the page it was for */
  }
};

async function open(page: Page, shell: Shell, at: string, width = 1280, theme: Theme = "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(
    /\/api\/(v1\/)?ui-preferences(\?.*)?$/,
    fed((j) => ({ ...j, shell, activeContext: null })),
  );
  await page.route(
    "**/api/v1/meta",
    fed((j) => ({ ...j, theme, language: "pt-BR" })),
  );
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
}

async function api(page: Page, method: string, url: string): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ([m, u]) => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="mordomo-token"]')?.content ?? "";
      const res = await fetch(u as string, { method: m as string, headers: { "x-mordomo-token": token } });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [method, url],
  );
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  made.push(file);
}

/** A profile note and two notes that name it; answers the entity's name and key. */
async function makeNotes(page: Page): Promise<{ name: string; key: string }> {
  const folder = path.join(MEMORY, "notes", `e2e-entidades-${stamp}`);
  made.push(folder);
  const name = `Ana ${stamp}`;
  write(
    path.join(folder, "ana.md"),
    `---\ntype: profile\ntitle: ${name}\naliases: [Aninha]\n---\ncontato.\n`,
  );
  write(path.join(folder, "reuniao.md"), `# Reunião\n\nFalei com [${name}](ana.md) sobre o plano.\n`);
  write(path.join(folder, "visita.md"), `# Visita\n\nVisita com [[ana]] ao cliente.\n`);
  const indexed = await api(page, "POST", "/api/v1/memory/index");
  expect(indexed.status, JSON.stringify(indexed.json)).toBe(200);
  return { name, key: `perfil:ana ${stamp}` };
}

test.afterEach(async ({ page }) => {
  for (const f of made.splice(0)) fs.rmSync(f, { recursive: true, force: true });
  if (page.url().startsWith("http")) await api(page, "POST", "/api/v1/memory/index").catch(() => undefined);
});

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: ReturnType<Page["locator"]>): Promise<Box> => {
  const b = await l.boundingBox();
  expect(b, "a box on screen").not.toBeNull();
  return b!;
};
/** Each box's top strictly greater than the one before. */
const downward = (boxes: Box[], what: string[]) => {
  for (let i = 1; i < boxes.length; i++)
    expect(boxes[i]!.y, `${what[i]} under ${what[i - 1]}`).toBeGreaterThan(boxes[i - 1]!.y);
};

for (const shell of SHELLS)
  test(`C101 /brain/entities in the ${shell} at 1280×800: the list column 320px on the left with header, tabs, search, the AI card and the list; the panel the rest with its header, MENÇÕES, APARECE JUNTO COM, TALVEZ SEJA A MESMA and Correções; one column at 700px with Voltar; no horizontal scroll at 360px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, shell, "/brain");
    const { name, key } = await makeNotes(page);
    await page.route(
      /\/api\/v1\/memory\/entities\/perfil(:|%3A)/,
      fed((j) => ({
        ...j,
        duplicates: [{ key: "termo:ana sousa", name: "Ana Sousa", similarity: 0.82 }],
        corrections: [
          { id: 9001, action: "rename", names: [key.slice(7)], name, createdAt: Date.now(), undoneAt: null },
        ],
      })),
    );
    await page.goto(`/#/brain/entities?key=${encodeURIComponent(key)}`);
    const v = page.locator(".ent-view");
    await expect(v.locator("h1")).toHaveText("Entidades");
    await expect(v.locator(".ent-pname")).toHaveText(name);
    if (shell === "nucleo") await expect(page.locator(".nu-shell .bs-notes .ent-view")).toHaveCount(1);

    // two columns: the list 320px on the left, the panel taking the rest
    const cols = await box(v.locator(".ent-cols"));
    const list = await box(v.locator(".ent-listcol"));
    const side = await box(v.locator(".ent-panelcol"));
    expect(Math.abs(list.width - 320), `list ${list.width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(list.x - cols.x)).toBeLessThanOrEqual(1);
    expect(side.x).toBeGreaterThanOrEqual(list.x + list.width);
    expect(
      Math.abs(side.x + side.width - (cols.x + cols.width)),
      "the panel reaches the right edge",
    ).toBeLessThanOrEqual(1);

    // the list column, top to bottom
    const listParts = [
      v.locator(".ent-head h1"),
      v.locator(".ent-head .ent-small"),
      v.getByRole("tablist"),
      v.getByPlaceholder("Buscar por nome"),
      v.locator(".ent-ai"),
      v.locator(".ent-list"),
    ];
    await expect(v.getByRole("tab", { name: /^Perfis \(\d+\)$/ })).toBeVisible();
    await expect(v.locator(".ent-ai .ent-ai-title")).toHaveText("Sugestões por IA");
    const listBoxes = await Promise.all(listParts.map(box));
    downward(listBoxes, ["title", "support line", "tabs", "search", "AI card", "list"]);
    for (const b of listBoxes) expect(b.x + b.width).toBeLessThanOrEqual(list.x + list.width + 1);

    // the panel, top to bottom; the menu at the right of the header
    const p = v.locator(".ent-panel");
    await expect(p.locator(".ent-mentions h3")).toHaveText(/^MENÇÕES \(\d+\)$/);
    await expect(p.locator(".ent-dups h3")).toHaveText("TALVEZ SEJA A MESMA");
    await expect(p.locator(".ent-corrections .notes-fold-head")).toHaveText("Correções (1)");
    const panelParts = [
      p.locator(".ent-phead"),
      p.locator(".ent-mentions h3"),
      p.locator(".ent-related h3"),
      p.locator(".ent-dups h3"),
      p.locator(".ent-corrections .notes-fold-head"),
    ];
    await expect(p.locator(".ent-related h3")).toHaveText("APARECE JUNTO COM");
    downward(await Promise.all(panelParts.map(box)), [
      "header",
      "MENÇÕES",
      "APARECE JUNTO COM",
      "TALVEZ SEJA A MESMA",
      "Correções",
    ]);
    const title = await box(p.locator(".ent-pname"));
    const chip = await box(p.locator(".ent-phead .ent-chip"));
    const menu = await box(p.locator(".ent-menu"));
    await expect(p.locator(".ent-phead .ent-chip")).toHaveText("Perfil");
    expect(chip.x).toBeGreaterThan(title.x);
    expect(menu.x).toBeGreaterThan(chip.x + chip.width);
    expect(
      Math.abs(menu.x + menu.width - (side.x + side.width)),
      "the menu at the right",
    ).toBeLessThanOrEqual(2);
    await expect(p.getByRole("button", { name: "Voltar" })).toBeHidden();

    // 700px: one column; the list alone, then the panel in its place with Voltar at its top
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto("/#/brain/entities");
    await expect(v.locator(".ent-listcol")).toBeVisible();
    await expect(v.locator(".ent-panelcol")).toBeHidden();
    const row = v.locator(".ent-pick", { hasText: name });
    await expect(row).toBeVisible();
    await row.click();
    await expect(v.locator(".ent-pname")).toHaveText(name);
    await expect(v.locator(".ent-listcol")).toBeHidden();
    const back = p.getByRole("button", { name: "Voltar" });
    await expect(back).toBeVisible();
    const one = await box(v.locator(".ent-panelcol"));
    const cols700 = await box(v.locator(".ent-cols"));
    expect(Math.abs(one.width - cols700.width), "one column").toBeLessThanOrEqual(1);
    expect((await box(back)).y).toBeLessThan((await box(p.locator(".ent-pname"))).y);
    await back.click();
    await expect(v.locator(".ent-listcol")).toBeVisible();

    // 360px: no horizontal scroll, with an entity open and without
    await page.setViewportSize({ width: 360, height: 800 });
    for (const at of ["/brain/entities", `/brain/entities?key=${encodeURIComponent(key)}`]) {
      await page.goto(`/#${at}`);
      await expect(v.locator("h1")).toBeAttached();
      const fits = await v.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits, `the view scrolls sideways at 360px (${at})`).toBe(true);
      const page360 = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(page360, `the page scrolls sideways at 360px (${at})`).toBe(true);
    }
  });

/* ---------------- Resumos: the summaries as the service gives them, answered by the browser ---------------- */

const DAY = 24 * 3_600_000;
const SCOPE_AREA = { kind: "area", id: "Projetos", name: "Projetos" };
const LIST = [
  {
    scope: SCOPE_AREA,
    state: "stale",
    generatedAt: Date.now() - DAY,
    changes: { changed: 3, removed: 1, added: 2 },
    running: false,
  },
  { scope: { kind: "area", id: "Pessoas", name: "Pessoas" }, state: "missing", running: false },
  {
    scope: { kind: "context", id: "atlas", name: "Atlas" },
    state: "fresh",
    generatedAt: Date.now() - DAY,
    running: false,
  },
];
const cite = (name: string, section: string, fileId: number) => ({
  path: `${MEMORY}/notes/${name}`,
  section,
  name,
  fileId,
});
const DETAIL = {
  ...LIST[0],
  paragraphs: [
    {
      text: "Os projetos seguem em duas frentes: o onboarding e o contrato.",
      citations: [cite("onboarding.md", "Decisão", 1), cite("contrato.md", "Cláusula", 2)],
    },
    { text: "O orçamento fechou **no prazo**.", citations: [cite("plano.md", "Próximos passos", 3)] },
  ],
  sources: [
    { fileId: 1, path: `${MEMORY}/notes/onboarding.md`, name: "onboarding.md", state: "same" },
    { fileId: 2, path: `${MEMORY}/notes/contrato.md`, name: "contrato.md", state: "changed" },
    { path: `${MEMORY}/notes/velha.md`, name: "velha.md", state: "removed" },
  ],
  run: {
    id: "e2e-run",
    provider: "claude",
    startedAt: Date.now() - DAY,
    finishedAt: Date.now() - DAY + 42_000,
  },
};

/** The list and the open scope's summary answered as the service would, by the browser. */
async function summaries(page: Page, items: unknown[] = LIST) {
  await page.route(/\/api\/v1\/memory\/summaries(\?.*)?$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { items } }) : route.fallback(),
  );
  await page.route(/\/api\/v1\/memory\/summaries\/(area|context)\/[^/?]+$/, (route) =>
    route.fulfill({ json: DETAIL }),
  );
}

for (const shell of SHELLS)
  test(`C119 /brain/summaries in the ${shell} at 1280×800: the list column 320px on the left with the header and the groups ÁREAS and CONTEXTOS; the open summary the rest with its header, the stale band, the paragraphs, Fontes and the card; one column at 700px with Voltar; no horizontal scroll at 360px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, shell, "/brain");
    await summaries(page);
    await page.goto("/#/brain/summaries?kind=area&id=Projetos");
    const v = page.locator(".sum-view");
    await expect(v.locator("h1")).toHaveText("Resumos");
    await expect(v.locator(".sum-pname")).toHaveText("Projetos");
    if (shell === "nucleo") await expect(page.locator(".nu-shell .bs-notes .sum-view")).toHaveCount(1);

    // two columns: the list 320px on the left, the summary taking the rest
    const cols = await box(v.locator(".sum-cols"));
    const list = await box(v.locator(".sum-listcol"));
    const side = await box(v.locator(".sum-panelcol"));
    expect(Math.abs(list.width - 320), `list ${list.width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(list.x - cols.x)).toBeLessThanOrEqual(1);
    expect(side.x).toBeGreaterThanOrEqual(list.x + list.width);
    expect(
      Math.abs(side.x + side.width - (cols.x + cols.width)),
      "the summary reaches the right edge",
    ).toBeLessThanOrEqual(1);

    // the list column, top to bottom: title, support line, ÁREAS, its rows, CONTEXTOS
    const groups = v.locator(".sum-group h2");
    await expect(groups).toHaveText(["ÁREAS", "CONTEXTOS"]);
    await expect(v.locator(".sum-head .sum-small")).toContainText("Gerar um resumo usa uma execução do");
    const listBoxes = await Promise.all(
      [
        v.locator(".sum-head h1"),
        v.locator(".sum-head .sum-small"),
        groups.nth(0),
        v.locator(".sum-row").first(),
        groups.nth(1),
      ].map(box),
    );
    downward(listBoxes, ["title", "support line", "ÁREAS", "first row", "CONTEXTOS"]);
    for (const b of listBoxes) expect(b.x + b.width).toBeLessThanOrEqual(list.x + list.width + 1);
    await expect(v.locator(".sum-pick[aria-current='true']")).toHaveCount(1);

    // the open summary, top to bottom; Atualizar at the right of the header
    const p = v.locator(".sum-panel");
    await expect(p.locator(".sum-stale")).toContainText(
      "Desde então: 3 fontes mudaram, 1 saiu, 2 arquivos novos.",
    );
    await expect(p.locator(".sum-par")).toHaveCount(2);
    await expect(p.locator(".notes-fold-head")).toHaveText("Fontes (3)");
    await expect(p.locator(".sum-how h2")).toHaveText("Como este resumo foi feito");
    downward(
      await Promise.all(
        [
          p.locator(".sum-phead"),
          p.locator(".sum-stale"),
          p.locator(".sum-par").first(),
          p.locator(".notes-fold-head"),
          p.locator(".sum-how"),
        ].map(box),
      ),
      ["header", "stale band", "paragraphs", "Fontes", "card"],
    );
    const title = await box(p.locator(".sum-pname"));
    const kind = await box(p.locator(".sum-phead .sum-small"));
    const update = await box(p.locator(".sum-phead > button"));
    expect(kind.x).toBeGreaterThan(title.x);
    expect(update.x).toBeGreaterThan(kind.x + kind.width);
    expect(
      Math.abs(update.x + update.width - (side.x + side.width)),
      "Atualizar at the right",
    ).toBeLessThanOrEqual(2);
    await expect(p.getByRole("button", { name: "Voltar" })).toBeHidden();

    // 700px: one column; the list alone, then the summary in its place with Voltar at its top
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto("/#/brain/summaries");
    await expect(v.locator(".sum-listcol")).toBeVisible();
    await expect(v.locator(".sum-panelcol")).toBeHidden();
    await v.locator(".sum-pick", { hasText: "Projetos" }).click();
    await expect(v.locator(".sum-pname")).toHaveText("Projetos");
    await expect(v.locator(".sum-listcol")).toBeHidden();
    const back = p.getByRole("button", { name: "Voltar" });
    await expect(back).toBeVisible();
    const one = await box(v.locator(".sum-panelcol"));
    const cols700 = await box(v.locator(".sum-cols"));
    expect(Math.abs(one.width - cols700.width), "one column").toBeLessThanOrEqual(1);
    expect((await box(back)).y).toBeLessThan((await box(p.locator(".sum-pname"))).y);
    await back.click();
    await expect(v.locator(".sum-listcol")).toBeVisible();

    // 360px: no horizontal scroll, with a summary open and without
    await page.setViewportSize({ width: 360, height: 800 });
    for (const at of ["/brain/summaries", "/brain/summaries?kind=area&id=Projetos"]) {
      await page.goto(`/#${at}`);
      await expect(v.locator("h1")).toBeAttached();
      const fits = await v.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits, `the view scrolls sideways at 360px (${at})`).toBe(true);
      const page360 = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(page360, `the page scrolls sideways at 360px (${at})`).toBe(true);
    }
  });

/* ---------------- C130: axe in both shells and both themes, and the two chunks ---------------- */

async function serious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

/** The content box of an element (its border box less its border and padding), and its border box's vertical span. */
type Content = { left: number; right: number; top: number; bottom: number };
const contentOf = (l: ReturnType<Page["locator"]>): Promise<Content> =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const px = (p: string) => parseFloat(cs.getPropertyValue(p)) || 0;
    return {
      left: r.left + px("border-left-width") + px("padding-left"),
      right: r.right - px("border-right-width") - px("padding-right"),
      top: r.top,
      bottom: r.bottom,
    };
  });

/** `item` ends at the right edge of `container`'s content box (1px) and its vertical centre is inside the container. */
async function atRight(
  item: ReturnType<Page["locator"]>,
  container: ReturnType<Page["locator"]>,
  what: string,
) {
  const c = await contentOf(container);
  const b = await box(item);
  expect(
    Math.abs(b.x + b.width - c.right),
    `${what}: right edge ${b.x + b.width} against ${c.right}`,
  ).toBeLessThanOrEqual(1);
  const middle = b.y + b.height / 2;
  expect(middle, `${what}: centre ${middle} inside ${c.top}..${c.bottom}`).toBeGreaterThanOrEqual(c.top);
  expect(middle, `${what}: centre ${middle} inside ${c.top}..${c.bottom}`).toBeLessThanOrEqual(c.bottom);
}

const SUGGESTION = {
  id: "e2e:0",
  kind: "perfil",
  name: "Bruno Lima",
  aliases: ["Bruno"],
  evidence: [
    {
      fileId: 1,
      path: `${MEMORY}/notes/reuniao.md`,
      line: 3,
      excerpt: "Falei com Bruno Lima sobre o plano.",
    },
  ],
  state: "pending",
};

for (const shell of SHELLS)
  test(`C138 the right-aligned items in the ${shell}: the card's toggle and Pedir sugestões agora, each suggestion's Aceitar and Recusar, each entity row's count and each summary row's button, at the right of their container's content box; none overflows at 360px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, shell, "/brain");
    const { name, key } = await makeNotes(page);
    await page.route(/\/api\/v1\/memory\/entities\/suggestions(\?.*)?$/, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: {
              items: [SUGGESTION, { ...SUGGESTION, id: "e2e:1", name: "Carla Dias", aliases: [] }],
              lastBatch: {
                id: "e2e",
                status: "done",
                startedAt: Date.now() - DAY,
                finishedAt: Date.now() - DAY + 9_000,
              },
            },
          })
        : route.fallback(),
    );
    await page.goto(`/#/brain/entities?key=${encodeURIComponent(key)}`);
    const v = page.locator(".ent-view");
    await expect(v.locator(".ent-pname")).toHaveText(name);
    await expect(v.locator(".ent-sugg")).toHaveCount(2);

    const measure = async (width: number) => {
      const tag = `at ${width}px`;
      const card = v.locator(".ent-ai");
      await atRight(card.locator(".ent-ai-top button"), card, `the toggle ${tag}`);
      await atRight(card.locator(".ent-ai-state button"), card, `Pedir sugestões agora ${tag}`);
      for (const [i, sugg] of (await v.locator(".ent-sugg").all()).entries()) {
        await atRight(
          sugg.getByRole("button", { name: "Recusar" }),
          sugg,
          `Recusar of suggestion ${i + 1} ${tag}`,
        );
        const accept = await box(sugg.getByRole("button", { name: "Aceitar" }));
        const reject = await box(sugg.getByRole("button", { name: "Recusar" }));
        expect(accept.x + accept.width, `Aceitar ends before Recusar ${tag}`).toBeLessThanOrEqual(
          reject.x + 1,
        );
      }
      const row = v.locator(".ent-pick", { hasText: name });
      await atRight(row.locator(".ent-count"), row, `the count of ${name} ${tag}`);
      const overflow = await v.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(overflow, `the view scrolls sideways ${tag}`).toBe(true);
    };
    await measure(1280);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/#/brain/entities");
    await expect(v.locator(".ent-sugg")).toHaveCount(2);
    await measure(360);

    // the summaries' rows
    await summaries(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/#/brain/summaries?kind=area&id=Projetos");
    const s = page.locator(".sum-view");
    await expect(s.locator(".sum-row")).toHaveCount(3);
    const measureRows = async (width: number) => {
      for (const [i, row] of (await s.locator(".sum-row").all()).entries()) {
        await atRight(row.locator("button.btn.sm"), row, `the button of summary row ${i + 1} at ${width}px`);
      }
      const overflow = await s.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(overflow, `the summaries scroll sideways at ${width}px`).toBe(true);
    };
    await measureRows(1280);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/#/brain/summaries");
    await expect(s.locator(".sum-row")).toHaveCount(3);
    await measureRows(360);
  });

for (const theme of THEMES)
  for (const shell of SHELLS) {
    test(`C130 /brain/entities in the ${shell}, ${theme}: the list with an entity open and AI suggestions, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await open(page, shell, "/brain", 1280, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const { name, key } = await makeNotes(page);
      await page.route(/\/api\/v1\/memory\/entities\/suggestions(\?.*)?$/, (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              json: {
                items: [
                  {
                    id: "e2e:0",
                    kind: "perfil",
                    name: "Bruno Lima",
                    aliases: ["Bruno"],
                    evidence: [
                      {
                        fileId: 1,
                        path: `${MEMORY}/notes/reuniao.md`,
                        line: 3,
                        excerpt: "Falei com Bruno Lima.",
                      },
                    ],
                    state: "pending",
                  },
                ],
                lastBatch: {
                  id: "e2e",
                  status: "done",
                  startedAt: Date.now() - DAY,
                  finishedAt: Date.now() - DAY + 9_000,
                },
              },
            })
          : route.fallback(),
      );
      await page.evaluate(() => document.fonts.ready);
      await page.goto(`/#/brain/entities?key=${encodeURIComponent(key)}`);
      const v = page.locator(".ent-view");
      await expect(v.locator(".ent-pname")).toHaveText(name);
      await expect(v.locator(".ent-sugg")).toHaveCount(1);
      expect(await serious(page)).toEqual([]);
    });

    test(`C130 /brain/summaries in the ${shell}, ${theme}: a stale summary open, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await open(page, shell, "/brain", 1280, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await summaries(page);
      await page.evaluate(() => document.fonts.ready);
      await page.goto("/#/brain/summaries?kind=area&id=Projetos");
      const v = page.locator(".sum-view");
      await expect(v.locator(".sum-stale")).toBeVisible();
      await expect(v.locator(".sum-par")).toHaveCount(2);
      expect(await serious(page)).toEqual([]);
      // the fold open as well: the sources are on screen
      await v.getByRole("button", { name: "Fontes (3)" }).click();
      await expect(v.locator(".sum-sources li")).toHaveCount(3);
      expect(await serious(page)).toEqual([]);
    });
  }

for (const [name, button, route, heading] of [
  ["EntitiesView", "Entidades", "/brain/entities", "Entidades"],
  ["SummariesView", "Resumos", "/brain/summaries", "Resumos"],
] as const)
  test(`C130 opening /brain fetches no chunk of ${name}; opening ${route} fetches its own chunk once`, async ({
    page,
  }) => {
    const scripts: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
    });
    await open(page, "moldura", "/brain");
    await summaries(page);
    const toolbar = page.locator(".brain-topbar-actions");
    await expect(toolbar.getByRole("button", { name: button, exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const chunk = new RegExp(`/assets/${name}-[\\w-]+\\.js$`);
    expect(scripts.filter((s) => chunk.test(s))).toEqual([]);
    expect(scripts.filter((s) => /\/assets\/(Entities|Summaries)View-[\w-]+\.js$/.test(s))).toEqual([]);
    await toolbar.getByRole("button", { name: button, exact: true }).click();
    await expect(page.locator("h1", { hasText: heading })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#${route}`));
    expect(scripts.filter((s) => chunk.test(s))).toHaveLength(1);
  });

/* ---------------- C131: the stylesheets change no other screen ---------------- */

/** The console's skill-input form, the ask view and the notes view, measured as the browser lays them out. */
async function layouts(page: Page) {
  const form = page.locator('[data-testid="console-ask"]');
  const fields = form.locator(".ask-fields");
  await expect(fields).toBeVisible();
  const consoleForm = await form.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      padding: s.padding,
      overflow: s.overflow,
      minHeight: s.minHeight,
      fontSize: s.fontSize,
      color: s.color,
    };
  });
  const style = await fields.evaluate((el) => {
    const s = getComputedStyle(el);
    return { display: s.display, columns: s.gridTemplateColumns };
  });
  const labels = fields.locator(".ask-field");
  await expect(labels).toHaveCount(2);
  const consoleOut = {
    own: consoleForm,
    display: style.display,
    tracks: style.columns.split(/\s+/).filter((t) => t !== "" && parseFloat(t) > 0).length,
    box: await box(fields),
    tops: [(await box(labels.nth(0))).y, (await box(labels.nth(1))).y],
  };
  const measured = async (selector: string) => {
    const el = page.locator(selector).first();
    await expect(el).toBeVisible();
    const css = await el.evaluate((n) => {
      const s = getComputedStyle(n);
      return { display: s.display, columns: s.gridTemplateColumns, padding: s.padding, fontSize: s.fontSize };
    });
    return { ...css, box: await box(el) };
  };
  await page.evaluate(() => void (location.hash = "#/brain/ask"));
  const ask = await measured(".ask .ask-col");
  await page.evaluate(() => void (location.hash = "#/brain/notes"));
  const notes = await measured(".notes-view");
  await page.evaluate(() => void (location.hash = "#/brain"));
  return { console: consoleOut, ask, notes };
}

test("C131 the Núcleo at 1280×800: the console's skill-input form, the ask view and the notes view keep their display, grid tracks and box (within 1px) after /brain/entities and /brain/summaries have been opened once", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await open(page, "nucleo", "/brain");
  await page.setViewportSize({ width: 1280, height: 800 });
  await summaries(page);
  // no rule of the two views is loaded yet
  await expect(page.locator(".ent-cols, .sum-cols")).toHaveCount(0);
  const input = page.locator(".cons-input");
  await expect(input).toBeVisible();
  await input.fill("/brainstorm");
  await input.press("Enter");
  const before = await layouts(page);
  expect(before.console.display).toBe("grid");
  expect(before.console.tracks, "two columns before").toBe(2);

  // open both views once: their chunks and stylesheets load
  await page.evaluate(() => void (location.hash = "#/brain/entities"));
  await expect(page.locator(".ent-view .ent-cols")).toBeVisible();
  await expect(page.locator(".ent-view .ent-cols")).toHaveCSS("display", "grid");
  await page.evaluate(() => void (location.hash = "#/brain/summaries"));
  await expect(page.locator(".sum-view .sum-cols")).toBeVisible();
  await expect(page.locator(".sum-view .sum-cols")).toHaveCSS("display", "grid");
  await page.evaluate(() => void (location.hash = "#/brain"));
  await expect(page.locator(".sum-view")).toHaveCount(0);

  const after = await layouts(page);
  const same = (a: Record<string, any>, b: Record<string, any>, what: string) => {
    expect(a.display, `${what} display`).toBe(b.display);
    expect(a.columns ?? "", `${what} grid tracks`).toBe(b.columns ?? "");
    expect(a.padding ?? "", `${what} padding`).toBe(b.padding ?? "");
    for (const k of ["x", "y", "width", "height"] as const)
      expect(Math.abs(a.box[k] - b.box[k]), `${what} box ${k}`).toBeLessThanOrEqual(1);
  };
  same(after.console, before.console, "the console's fields");
  expect(after.console.tracks, "two columns after").toBe(2);
  expect(after.console.own, "the form's own padding, overflow, least height, size and colour").toEqual(
    before.console.own,
  );
  expect(Math.abs(after.console.tops[0]! - after.console.tops[1]!)).toBeLessThanOrEqual(1);
  same(after.ask, before.ask, "the ask view");
  same(after.notes, before.notes, "the notes view");
});

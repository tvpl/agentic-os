/**
 * The guided cleanup in a real browser (.specs/features/cerebro-faxina-guiada, C51, C55, C80, C81; design.md "Tela -
 * Assistente de faxina"; plan.md amendment 11): the four entries in their places in both shells, the cards of step 2
 * and the grid's columns at two widths, the five steps at 12px or more (13px for sentences) with their states marked by
 * an icon and text and no serious axe violation in both themes and both shells, and the gallery's entry.
 *
 * The notes are real files of the isolated e2e home, under a folder of `memory/notes/` made for each test, written and
 * indexed through the API with the page's own token; the archive an apply makes is undone by the wizard itself, and the
 * folder, the contexts and the active context are taken away after each test. The interface reads pt-BR, so the claims'
 * own words are the ones asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_HOME, REPO_ROOT } from "./home.mjs";

type Shell = "moldura" | "nucleo";
type Theme = "dark" | "light";
const SHELLS: Shell[] = ["moldura", "nucleo"];
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const stamp = Date.now().toString(36);
const NOTES = path.join(E2E_HOME, "memory", "notes");
const DOCS = path.join(REPO_ROOT, "docs");
let folder = "";

async function seed(page: Page, shell: Shell, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A request the page abandons (a reload) is disposed under the handler: that one needs no answer.
  const fed = (patch: Record<string, unknown>) => async (route: Route) => {
    try {
      const response = await route.fetch();
      if (!response.ok()) return await route.fulfill({ response });
      await route.fulfill({ response, json: { ...(await response.json()), ...patch } });
    } catch {
      /* disposed with the page it was for */
    }
  };
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, fed({ shell }));
  await page.route("**/api/v1/meta", fed({ theme, language: "pt-BR" }));
}

async function open(
  page: Page,
  shell: Shell,
  theme: Theme,
  at: string,
  viewport = { width: 1440, height: 900 },
) {
  await seed(page, shell, theme);
  await page.setViewportSize(viewport);
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
}

/** The same request the page makes, with the page's own token. */
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

/** Four notes under memory/notes/<folder>/: two with the same bytes, one other, one more; indexed. */
async function makeNotes(page: Page, name: string): Promise<string> {
  folder = `e2e-faxina-${stamp}-${name}`;
  const same = `# Igual ${stamp}\n\nO mesmo texto, nas duas notas, palavra por palavra.\n`;
  const bodies: Array<[string, string]> = [
    [`Igual A ${stamp}`, same],
    [`Igual B ${stamp}`, same],
    [`Outra ${stamp}`, `# Outra ${stamp}\n\nUm texto diferente de todos.\n`],
    [`Mais uma ${stamp}`, `# Mais uma ${stamp}\n\nE ainda outro texto.\n`],
  ];
  for (const [title, content] of bodies) {
    const res = await api(page, "POST", "/api/v1/memory/notes", { title, folder, content });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
  }
  // Same bytes for the two "Igual" notes, whatever the creation added.
  const dir = path.join(NOTES, folder);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("igual"));
  expect(files).toHaveLength(2);
  fs.writeFileSync(path.join(dir, files[1]!), fs.readFileSync(path.join(dir, files[0]!)));
  const indexed = await api(page, "POST", "/api/v1/memory/index");
  expect(indexed.status, JSON.stringify(indexed.json)).toBe(200);
  return dir;
}

async function makeContext(page: Page): Promise<{ id: string; name: string }> {
  const made = await api(page, "POST", "/api/v1/contexts", { name: `Faxina ${stamp}`, paths: [DOCS] });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  return made.json;
}

test.afterEach(async ({ page }) => {
  if (!page.url().startsWith("http")) return;
  await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: null }).catch(() => undefined);
  const list = await api(page, "GET", "/api/v1/contexts").catch(() => ({ json: null }));
  for (const c of (list.json?.contexts ?? []) as Array<{ id: string }>)
    await api(page, "DELETE", `/api/v1/contexts/${c.id}`).catch(() => undefined);
  if (folder) fs.rmSync(path.join(NOTES, folder), { recursive: true, force: true });
  folder = "";
  await api(page, "POST", "/api/v1/memory/index").catch(() => undefined);
});

const wizard = (page: Page) => page.getByRole("dialog", { name: "Faxina guiada" });
const stepIs = (page: Page, text: string) => expect(wizard(page).locator(".cln-now")).toHaveText(text);
const chosen = async (page: Page, name: string | null) => {
  const radios = wizard(page).getByRole("radio");
  await expect(radios.first()).toBeVisible();
  if (name) await expect(wizard(page).getByRole("radio", { name: new RegExp(name) })).toBeChecked();
  else for (const r of await radios.all()) await expect(r).not.toBeChecked();
};
async function closeWizard(page: Page) {
  await wizard(page).locator(".cln-foot").getByRole("button", { name: "Fechar" }).click();
  await expect(wizard(page)).toHaveCount(0);
}
async function palette(page: Page) {
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox");
  await expect(box).toBeVisible();
  await box.fill("Faxina guiada");
  await page
    .getByRole("option", { name: /Faxina guiada/ })
    .first()
    .click();
}

/* ---------------- C51: the four entries ---------------- */

test("C51 the moldura: the selector's item after the actions separator and before Novo contexto…, at step 2; the graph's Faxina third of .brain-topbar-actions, at step 1 with the context; the palette, at step 1 with it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "moldura", "dark", "/brain");
  const ctx = await makeContext(page);
  await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: ctx.id });
  await page.reload();
  await expect(page.locator('[data-shell="moldura"]')).toBeVisible();

  // The selector's menu.
  await page.locator("button.ctx-sel").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const rows = await menu
    .locator(":scope > *")
    .evaluateAll((els) => els.map((el) => ({ role: el.getAttribute("role"), text: el.textContent ?? "" })));
  const lastSep = rows.map((r) => r.role).lastIndexOf("separator");
  expect(rows.slice(lastSep + 1).map((r) => r.text)).toEqual([
    "Fazer faxina neste contexto",
    "Novo contexto…",
    "Gerenciar contextos",
  ]);
  await menu.getByRole("menuitem", { name: "Fazer faxina neste contexto" }).click();
  await stepIs(page, "Etapa 2 de 5 · O que tem aqui");
  await expect(wizard(page).locator(".cln-scope-line")).toHaveText(ctx.name);
  await closeWizard(page);

  // The graph's action row: the third .btn.sm, by name and by place.
  const row = page.locator(".brain-topbar-actions");
  const buttons = row.locator("button.btn.sm");
  await expect(buttons).toHaveCount(3);
  await expect(buttons.nth(0)).toHaveAccessibleName("Atualizar índice");
  await expect(buttons.nth(1)).toHaveAccessibleName("Modo apresentação (p)");
  await expect(buttons.nth(2)).toHaveAccessibleName("Faxina");
  const order = await row.evaluate((el) =>
    [...el.querySelectorAll("button")].map((b) =>
      b.classList.contains("os-chip") ? "chip" : (b.getAttribute("aria-label") ?? b.textContent!.trim()),
    ),
  );
  expect(order.slice(0, 3)).toEqual(["Atualizar índice", "Modo apresentação (p)", "Faxina"]);
  expect(order.slice(3).every((x) => x === "chip")).toBe(true);
  const boxes = await Promise.all([0, 1, 2].map((i) => buttons.nth(i).boundingBox()));
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  await buttons.nth(2).click();
  await stepIs(page, "Etapa 1 de 5 · Escopo");
  await chosen(page, ctx.name);
  await closeWizard(page);

  // The palette.
  await palette(page);
  await stepIs(page, "Etapa 1 de 5 · Escopo");
  await chosen(page, ctx.name);
  await closeWizard(page);

  // With Todo o cérebro: no item in the menu, nothing chosen from the button.
  await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: null });
  await page.reload();
  await page.locator("button.ctx-sel").click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Fazer faxina neste contexto" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator(".brain-topbar-actions").getByRole("button", { name: "Faxina" }).click();
  await stepIs(page, "Etapa 1 de 5 · Escopo");
  await chosen(page, null);
});

test("C51 the Núcleo: Faxina the last row of bs-menu-acts after Salvar como visão padrão, and the palette, both at step 1 with the context", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "nucleo", "dark", "/brain");
  const ctx = await makeContext(page);
  await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: ctx.id });
  await page.reload();
  await expect(page.locator(".bs canvas").first()).toBeVisible();
  await page.locator(".bs-more").click();
  const acts = page.locator(".bs-menu .bs-menu-acts > button");
  await expect(acts.last()).toHaveText("Faxina");
  const texts = await acts.allTextContents();
  expect(texts.at(-2)).toBe("Salvar como visão padrão");
  await acts.last().click();
  await stepIs(page, "Etapa 1 de 5 · Escopo");
  await chosen(page, ctx.name);
  await closeWizard(page);
  await palette(page);
  await stepIs(page, "Etapa 1 de 5 · Escopo");
  await chosen(page, ctx.name);
});

/* ---------------- C55: the cards and the grid ---------------- */

test("C55 step 2's cards in order with what each holds, the grid in two columns at 1 280 px and one at 600 px", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "moldura", "dark", "/brain", { width: 1280, height: 900 });
  const dir = await makeNotes(page, "c55");
  await page.locator(".brain-topbar-actions").getByRole("button", { name: "Faxina" }).click();
  await wizard(page).getByLabel("Ou uma pasta…").fill(dir);
  await expect(wizard(page).locator(".cln-chosen")).toHaveText(/^4 arquivos, última mudança há 0 dias$/);
  await wizard(page).getByRole("button", { name: "Ver o que tem aqui" }).click();
  await stepIs(page, "Etapa 2 de 5 · O que tem aqui");
  const cards = wizard(page).locator(".cln-grid > .cln-card");
  await expect(cards).toHaveCount(5);
  await expect(cards.locator("h3")).toHaveText(["Arquivos", "Por tipo", "Idade", "Maiores pastas", "Grupos"]);
  await expect(cards.nth(0).locator(".cln-big")).toHaveText("4");
  await expect(cards.nth(1).locator("li .cln-label")).toHaveText([
    "notas",
    "texto",
    "PDF",
    "imagem",
    "código",
    "outros",
  ]);
  await expect(cards.nth(1).locator("li .cln-num")).toHaveText(["4", "0", "0", "0", "0", "0"]);
  await expect(cards.nth(2).locator("li .cln-label")).toHaveText([
    "até 30 dias",
    "31-90",
    "91-365",
    "mais de um ano",
  ]);
  await expect(cards.nth(2).locator("li").last()).toHaveClass(/cln-warn/);
  await expect(cards.nth(2).locator("li").last().locator(".cln-num")).toContainText("parados");
  const at = async () =>
    await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  const wide = await at();
  expect(new Set(wide).size).toBe(2);
  expect(wide[0]).toBeLessThan(wide[1]!);
  await page.setViewportSize({ width: 600, height: 900 });
  await expect.poll(async () => new Set(await at()).size).toBe(1);
});

/* ---------------- C80: the five steps, both themes, both shells ---------------- */

async function serious(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder.include(include);
  const result = await builder.analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

/** Every element with text of its own under `scope`: what it says and the size it is drawn at. */
async function sizesUnder(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const out: Array<{ text: string; px: number }> = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of [root, ...root.querySelectorAll("*")] as HTMLElement[]) {
        if (el.closest("svg, [aria-hidden='true'], .sr-only")) continue;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        const rect = el.getBoundingClientRect();
        if (!own || !rect.width || !rect.height) continue;
        out.push({ text: own.slice(0, 60), px: parseFloat(getComputedStyle(el).fontSize) });
      }
    return out;
  }, scope);
}
/** Nothing under 12px, and the sentences at 13px or more. */
async function sized(page: Page, prose: string[]) {
  const sizes = await sizesUnder(page, '[role="dialog"]');
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.filter((s) => s.px < 12)).toEqual([]);
  for (const line of prose) {
    const found = sizes.filter((s) => s.text.startsWith(line));
    expect(found.length, `${line} on screen`).toBeGreaterThan(0);
    for (const s of found) expect(s.px, line).toBeGreaterThanOrEqual(13);
  }
}
/** A state on screen says itself with an icon and a text. */
async function marked(page: Page, selector: string) {
  const els = wizard(page).locator(selector);
  expect(await els.count(), selector).toBeGreaterThan(0);
  for (const el of await els.all()) {
    await expect(el.locator("svg").first()).toBeAttached();
    await expect(el).toHaveText(/\S/);
  }
}

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C80 the five steps in the ${shell}, ${theme}: 12px or more, sentences at 13px, states with an icon and text, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await open(page, shell, theme, "/brain");
      const dir = await makeNotes(page, `${shell}-${theme}`);
      await page.evaluate(() => document.fonts.ready);
      await palette(page);

      // 1 · Escopo
      await stepIs(page, "Etapa 1 de 5 · Escopo");
      await wizard(page).getByLabel("Ou uma pasta…").fill(dir);
      await expect(wizard(page).locator(".cln-chosen")).toHaveText(/^4 arquivos/);
      await sized(page, ["4 arquivos, última mudança"]);
      expect(await serious(page)).toEqual([]);
      await wizard(page).getByRole("button", { name: "Ver o que tem aqui" }).click();

      // 2 · O que tem aqui
      await stepIs(page, "Etapa 2 de 5 · O que tem aqui");
      await expect(wizard(page).locator(".cln-grid > .cln-card")).toHaveCount(5);
      await expect(wizard(page).locator(".cln-step[data-done] svg")).toHaveCount(1);
      await marked(page, ".cln-step[data-done]");
      await sized(page, []);
      expect(await serious(page)).toEqual([]);
      await wizard(page).getByRole("button", { name: "Procurar o que decidir" }).click();

      // 3 · Achados
      await stepIs(page, "Etapa 3 de 5 · Achados");
      await expect(wizard(page).getByRole("tab", { name: /^Duplicatas \(1\)$/ })).toBeVisible();
      await wizard(page)
        .getByRole("tab", { name: /^Duplicatas/ })
        .click();
      await sized(page, ["Mesmos bytes que"]);
      await marked(page, ".cln-why");
      expect(await serious(page)).toEqual([]);
      await wizard(page).locator(".cln-cards > li").first().getByRole("button", { name: "Arquivar" }).click();
      await expect(wizard(page).locator(".cln-finding[data-answered]")).toHaveCount(1);
      await marked(page, ".cln-finding[data-answered]");
      await expect(wizard(page).locator(".cln-finding[data-answered]")).toContainText("Respondido");
      await sized(page, ["Este escopo não tem nota-resumo."]);
      expect(await serious(page)).toEqual([]);
      await wizard(page).getByRole("button", { name: "Conferir mudanças" }).click();

      // 4 · Conferir
      await stepIs(page, "Etapa 4 de 5 · Conferir");
      await expect(wizard(page).locator(".cln-review h3").first()).toHaveText("Vai para o arquivo (2)");
      await sized(page, ["2 mudanças"]);
      expect(await serious(page)).toEqual([]);
      await wizard(page).getByRole("button", { name: "Aplicar" }).click();

      // 5 · Pronto, then undone
      await stepIs(page, "Etapa 5 de 5 · Pronto");
      await expect(wizard(page).locator(".cln-totals .cln-big").first()).toHaveText("2");
      await expect(wizard(page).locator(".cln-step[data-done] svg")).toHaveCount(4);
      await sized(page, []);
      expect(await serious(page)).toEqual([]);
      await wizard(page).locator(".cln-foot").getByRole("button", { name: "Desfazer" }).click();
      await expect(wizard(page).locator(".cln-undone")).toHaveText("Desfeito: 2 arquivos voltaram.");
      await marked(page, ".cln-undone");
      await sized(page, ["Desfeito: 2 arquivos voltaram."]);
      expect(await serious(page)).toEqual([]);
      expect(fs.readdirSync(dir).filter((f) => f.startsWith("igual"))).toHaveLength(2);
    });

/* ---------------- C81: the gallery ---------------- */

for (const theme of THEMES)
  test(`C81 the gallery has a cleanup-wizard entry (the step bar, inventory cards, a finding card of each answer row, the review list) with no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-cleanup");
    await expect(story.locator("ol.cln-steps > li")).toHaveCount(5);
    await expect(story.locator(".cln-grid > .cln-card")).toHaveCount(5);
    const cards = story.locator(".cln-cards > li");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByRole("button", { name: "Merge" })).toBeVisible();
    await expect(cards.nth(1).getByRole("button", { name: "Merge" })).toHaveCount(0);
    await expect(cards.nth(1).getByRole("button", { name: "Archive" })).toBeVisible();
    await expect(story.locator(".cln-review .cln-plan li")).toHaveCount(2);
    expect(await serious(page, "#story-cleanup")).toEqual([]);
  });

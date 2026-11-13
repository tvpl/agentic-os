/**
 * "Revisão semanal" and the mention fold in a real browser (.specs/features/cerebro-rituais, C76, C98, C99, C101;
 * design.md "Página - Revisão semanal", "Entradas", "Painel da nota - dobra Menções sem link"): the entries in their
 * places in both shells (the graph's `.btn.sm` after "Revisões (N)" or after "Faxina", the scene menu's last row, the
 * palette, a `weeklyReview` inbox row), the page and the fold at 12px or more (13px for sentences), keyboard-operable
 * in the order of C79, C81 and C89 and with no serious axe violation in both themes and both shells, the gallery's
 * entry, and the plan's independent tests of S1, S2, S4, S5, S6 and S8 on the real service.
 *
 * The loops, the projects, the inbox file and the notes are real files of the isolated e2e home (a journal day of
 * their own, a folder under `memory/notes/`, a file of `memory/inbox/`), indexed through the API with the page's own
 * token and taken away (and the index redone) after each test. Requests that would leave a decision of this week
 * behind in C98 (where only the keyboard is the claim) are answered by the browser, so C101's "1", "1" and "1" are
 * the only decisions of the week. The interface reads pt-BR, so the claims' own words are the ones asserted.
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
  await page.route(
    /\/api\/(v1\/)?ui-preferences(\?.*)?$/,
    fed((j) => ({ ...j, shell })),
  );
  await page.route(
    "**/api/v1/meta",
    fed((j) => ({ ...j, theme, language: "pt-BR" })),
  );
}

async function open(page: Page, shell: Shell, theme: Theme, at: string) {
  await seed(page, shell, theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
}

/** Every answer of the week's list, changed by `patch` (an empty step, a finished week). */
async function patchWeek(page: Page, patch: Patch) {
  await page.route(/\/api\/v1\/memory\/weekly-review(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    try {
      const response = await route.fetch();
      await route.fulfill({ response, json: patch(await response.json()) });
    } catch {
      /* disposed */
    }
  });
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
const localDay = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const project = (title: string, status: string, body = "Notas do projeto.") =>
  `---\ntitle: ${title}\ntype: project\nstatus: ${status}\n---\n\n# ${title}\n\n${body}\n`;

interface World {
  folder: string;
  loops: string[];
  app: string;
  site: string;
  inbox: string;
}
/**
 * Two open loops on a journal day of their own, an active, a paused (unless `paused` is false: a project of this week
 * counts as reviewed, G28) and a done project, and an inbox file.
 */
async function makeWeek(page: Page, name: string, daysAgo: number, paused = true): Promise<World> {
  const folder = path.join(MEMORY, "notes", `e2e-semana-${stamp}-${name}`);
  const loops = [`Ligar para a Ana ${name} ${stamp}`, `Pagar o boleto ${name} ${stamp}`];
  write(
    path.join(MEMORY, "journal", `${localDay(daysAgo)}.md`),
    `# ${localDay(daysAgo)}\n\n## Open loops\n\n${loops.map((l) => `- ${l}`).join("\n")}\n`,
  );
  const app = `App ${name} ${stamp}`;
  const site = `Site ${name} ${stamp}`;
  write(path.join(folder, `app-${stamp}.md`), project(app, "active"));
  if (paused) write(path.join(folder, `pausa-${stamp}.md`), project(`Pausa ${name} ${stamp}`, "paused"));
  write(path.join(folder, `site-${stamp}.md`), project(site, "done"));
  const inbox = `entrada-${name}-${stamp}.md`;
  write(path.join(MEMORY, "inbox", inbox), `# Entrada ${stamp}\n\nPara ver.\n`);
  made.push(folder);
  const indexed = await api(page, "POST", "/api/v1/memory/index");
  expect(indexed.status, JSON.stringify(indexed.json)).toBe(200);
  return { folder, loops, app, site, inbox };
}

/** A note due for review (a plano reviewed long ago), so "Revisões (N)" is on screen. */
async function makeDue(page: Page, name: string): Promise<number> {
  const folder = path.join(MEMORY, "notes", `e2e-semana-due-${stamp}-${name}`);
  write(
    path.join(folder, `plano-${stamp}.md`),
    `---\nnatureza: plano\nlast_reviewed: 2025-01-02\n---\n\nVamos lançar ${stamp}.\n`,
  );
  made.push(folder);
  expect((await api(page, "POST", "/api/v1/memory/index")).status).toBe(200);
  const due = await api(page, "GET", "/api/v1/memory/reviews?kind=due");
  expect(due.json.total).toBeGreaterThanOrEqual(1);
  return due.json.total as number;
}

test.afterEach(async ({ page }) => {
  for (const f of made.splice(0)) fs.rmSync(f, { recursive: true, force: true });
  if (page.url().startsWith("http")) await api(page, "POST", "/api/v1/memory/index").catch(() => undefined);
});

const week = (page: Page) => page.locator(".wk");
async function palette(page: Page) {
  const launcher = page.locator(".launcher");
  await expect(async () => {
    if (!(await launcher.isVisible())) await page.keyboard.press("Control+k");
    await expect(launcher.getByRole("combobox")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await launcher.getByRole("combobox").fill("Revisão semanal");
  await launcher
    .getByRole("option", { name: /^Revisão semanal/ })
    .first()
    .click();
}
const rowOrder = (page: Page) =>
  page
    .locator(".brain-topbar-actions")
    .evaluate((el) =>
      [...el.querySelectorAll("button")].map((b) =>
        b.classList.contains("os-chip") ? "chip" : (b.getAttribute("aria-label") ?? b.textContent!.trim()),
      ),
    );

/* ---------------- C76: the entries ---------------- */

test("C76 the moldura: Revisão semanal the .btn.sm right after Faxina with no Revisões and right after Revisões (N) with some, before the chips; Check and Concluída em 12/11 on a finished week; the palette and a weeklyReview inbox row, each to /brain/weekly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, "moldura", "dark", "/brain");
  const buttons = page.locator(".brain-topbar-actions button.btn.sm");
  // N = 0: right after Faxina (G17)
  await expect(buttons.filter({ hasText: "Revisão semanal" })).toHaveCount(1);
  let order = await rowOrder(page);
  expect(order.slice(0, 4)).toEqual([
    "Atualizar índice",
    "Modo apresentação (p)",
    "Faxina",
    "Revisão semanal",
  ]);
  expect(order.slice(4).every((x) => x === "chip")).toBe(true);

  // N > 0: right after Revisões (N)
  const total = await makeDue(page, "c76");
  await page.reload();
  await expect(buttons).toHaveCount(5);
  order = await rowOrder(page);
  expect(order.slice(0, 5)).toEqual([
    "Atualizar índice",
    "Modo apresentação (p)",
    "Faxina",
    `Revisões (${total})`,
    "Revisão semanal",
  ]);
  expect(order.slice(5).every((x) => x === "chip")).toBe(true);
  const weekly = buttons.nth(4);
  await expect(weekly).toHaveAccessibleName("Revisão semanal");
  await expect(weekly.locator("svg.lucide-calendar-check")).toHaveCount(1);
  const boxes = await Promise.all([3, 4].map((i) => buttons.nth(i).boundingBox()));
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  await weekly.click();
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  await expect(week(page).locator("h1")).toHaveText("Revisão semanal");

  // the palette
  await page.goto("/#/");
  await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  await palette(page);
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  await expect(week(page).locator("h1")).toHaveText("Revisão semanal");

  // a finished week (12/11, local noon): Check and the title
  const finishedAt = new Date(2026, 10, 12, 12, 0).getTime();
  await patchWeek(page, (j) => ({ ...j, finishedAt }));
  await page.goto("/#/brain");
  await page.reload();
  const done = page.locator(".brain-topbar-actions button.btn.sm", { hasText: "Revisão semanal" });
  await expect(done.locator("svg.lucide-check")).toHaveCount(1);
  await expect(done).toHaveAttribute("title", "Concluída em 12/11");
  await page.unroute(/\/api\/v1\/memory\/weekly-review(\?.*)?$/);

  // a weeklyReview row of the inbox, as the sentinel writes it
  await page.route(/\/api\/v1\/notifications(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "n_weekly_e2e",
            kind: "system",
            title: "Time for the weekly review",
            body: "3 open loops, 2 projects to review.",
            ts: Date.now(),
            read: false,
            href: "/brain/weekly",
            messageKey: "sentinel.weeklyReview",
            messageParams: { loops: 3, projects: 2 },
            tone: "info",
          },
        ],
      },
    }),
  );
  await page.goto("/#/");
  await page.reload();
  await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  await page.locator(".mold-bell").click();
  await page
    .getByRole("button", { name: /Hora da revisão semanal: 3 laços abertos, 2 projetos para revisar\./ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  await expect(week(page).locator("h1")).toHaveText("Revisão semanal");
});

test("C76 the Núcleo: Revisão semanal the last row of bs-menu-acts, after Faxina with no Revisões and after Revisões (N) with some, and the palette, each to the brain's panel at /brain/weekly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, "nucleo", "dark", "/brain");
  await expect(page.locator(".bs canvas").first()).toBeVisible();
  const acts = page.locator(".bs-menu .bs-menu-acts > button");
  await page.locator(".bs-more").click();
  await expect(acts.last()).toHaveText("Revisão semanal");
  expect((await acts.allTextContents()).at(-2)).toBe("Faxina");
  await page.keyboard.press("Escape");

  const total = await makeDue(page, "c76n");
  await page.reload();
  await expect(page.locator(".bs canvas").first()).toBeVisible();
  await page.locator(".bs-more").click();
  await expect(acts.last()).toHaveText("Revisão semanal");
  const texts = await acts.allTextContents();
  expect(texts.at(-2)).toBe(`Revisões (${total})`);
  await acts.last().click();
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  await expect(page.locator(".nu-shell .bs-notes .wk h1")).toHaveText("Revisão semanal");

  await page.goto("/#/");
  await expect(page.locator(".nu-shell")).toBeVisible();
  await palette(page);
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  await expect(page.locator(".nu-shell .bs-notes .wk h1")).toHaveText("Revisão semanal");
});

/* ---------------- C98: the page and the fold, both themes, both shells ---------------- */

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
        out.push({ text: own.slice(0, 80), px: parseFloat(getComputedStyle(el).fontSize) });
      }
    return out;
  }, scope);
}
async function sized(page: Page, scope: string, prose: string[]) {
  const sizes = await sizesUnder(page, scope);
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.filter((s) => s.px < 12)).toEqual([]);
  for (const line of prose) {
    const found = sizes.filter((s) => s.text.includes(line));
    expect(found.length, `${line} on screen`).toBeGreaterThan(0);
    for (const s of found) expect(s.px, line).toBeGreaterThanOrEqual(13);
  }
}
/** What the focused control says: its text, its label or its placeholder. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "";
    if (el instanceof HTMLInputElement && el.type === "checkbox")
      return `checkbox:${el.closest("label")?.textContent?.trim() ?? ""}`;
    return (
      el.textContent?.trim() ||
      el.getAttribute("aria-label") ||
      (el as HTMLInputElement).placeholder ||
      ""
    ).trim();
  });
async function tabs(page: Page, n: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    seen.push(await focused(page));
    await page.keyboard.press("Tab");
  }
  return seen;
}
async function step(page: Page, name: string, n: number) {
  await week(page).locator(".wk-steps").getByRole("button", { name }).click();
  await expect(week(page).locator(".wk-now")).toHaveText(`Etapa ${n} de 5 · ${name}`);
}

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C98 the page in the ${shell}, ${theme}: each step with a list, step 1 empty, step 5 finished and the note panel's mention fold at 12px or more, sentences at 13px, the actions by Tab in the order of C79, C81 and C89 and Enter, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await open(page, shell, theme, "/brain");
      const w = await makeWeek(page, `${shell[0]}${theme[0]}`, shell === "moldura" ? 3 : 4);
      // Requests that would leave a decision of this week behind: answered here (the claim is the keyboard).
      await page.route(/\/api\/v1\/memory\/weekly-review\/archive$/, (route) =>
        route.fulfill({ json: { manifest: null, moved: [], skipped: [], proposals: null } }),
      );
      await page.evaluate(() => document.fonts.ready);
      await page.goto("/#/brain/weekly");
      const wk = week(page);
      await expect(wk.locator("h1")).toHaveText("Revisão semanal");

      // Step 1, a list: the loop's actions in the order of C79, Enter opens "Virar projeto"'s field.
      const loop = wk.locator(".wk-item", { hasText: w.loops[0]! });
      await expect(loop).toBeVisible();
      await expect(wk.locator(".wk-item", { hasText: w.inbox })).toBeVisible();
      await sized(page, ".wk", [w.loops[0]!, "Laços abertos"]);
      expect(await serious(page)).toEqual([]);
      await loop.getByRole("button", { name: "Fechar" }).focus();
      expect(await tabs(page, 5)).toEqual(["Fechar", "Manter", "Algum dia", "Virar projeto", "Virar tarefa"]);
      await loop.getByRole("button", { name: "Virar projeto" }).focus();
      await page.keyboard.press("Enter");
      await expect(loop.getByRole("textbox", { name: "Virar projeto" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");

      // Step 2, a list: the field, Adicionar, then the actions in the order of C81; Enter on Revisado reviews it.
      await step(page, "Atualizar", 2);
      const app = wk.locator(".wk-item", { hasText: w.app });
      await expect(app).toBeVisible();
      await sized(page, ".wk", [w.app]);
      expect(await serious(page)).toEqual([]);
      // "Adicionar" waits for a text (disabled, out of the Tab order, while the field is empty)
      await app.getByRole("textbox").fill("Ligar");
      await app.getByRole("textbox").focus();
      expect(await tabs(page, 6)).toEqual([
        "O que é o próximo passo concreto?",
        "Adicionar",
        "Revisado",
        "Concluído",
        "Pausar",
        "Abrir",
      ]);
      await app.getByRole("button", { name: "Revisado" }).focus();
      await page.keyboard.press("Enter");
      await expect(app).toContainText("revisado hoje");

      // Step 3, a list (the paused project).
      await step(page, "Algum dia", 3);
      await expect(
        wk.locator(".wk-item", { hasText: `Pausa ${shell[0]}${theme[0]} ${stamp}` }),
      ).toBeVisible();
      await sized(page, ".wk", []);
      expect(await serious(page)).toEqual([]);

      // Step 4, a list: the boxes then "Arquivar N" in the order of C89; Enter on it archives (answered here).
      await step(page, "Arquivar", 4);
      const box = wk.getByRole("checkbox", { name: w.site });
      await expect(box).toBeChecked();
      await sized(page, ".wk", ["Vão para memory/archive/ com desfazer. Nada é apagado."]);
      expect(await serious(page)).toEqual([]);
      const boxes = await wk.getByRole("checkbox").count();
      await wk.getByRole("checkbox").first().focus();
      const seen = await tabs(page, boxes + 1);
      expect(seen.slice(0, boxes).every((s) => s.startsWith("checkbox:"))).toBe(true);
      expect(seen).toContain(`checkbox:${w.site}`);
      expect(seen[boxes]).toBe(`Arquivar ${boxes}`);
      await wk.getByRole("button", { name: `Arquivar ${boxes}` }).focus();
      await page.keyboard.press("Enter");
      await expect(wk.getByText("Arquivados: 0.")).toBeVisible();

      // Step 5 finished, and step 1 empty (both as the service would answer them).
      await patchWeek(page, (j) => ({
        ...j,
        finishedAt: Date.now(),
        counts: { loops: 3, projects: 2, archived: 1 },
        loops: { items: [], total: 0 },
        inbox: { items: [], total: 0 },
      }));
      await page.reload();
      await expect(wk.locator(".wk-now")).toHaveText("Etapa 5 de 5 · Pronto");
      await expect(wk.locator(".wk-num")).toHaveText(["3", "2", "1"]);
      await sized(page, ".wk", ["Revisão desta semana concluída em"]);
      expect(await serious(page)).toEqual([]);
      await step(page, "Esvaziar", 1);
      await expect(wk.getByText("Nada solto. Todo laço tem decisão.")).toBeVisible();
      await sized(page, ".wk", ["Nada solto. Todo laço tem decisão."]);
      expect(await serious(page)).toEqual([]);
      await page.unroute(/\/api\/v1\/memory\/weekly-review(\?.*)?$/);

      // The note panel with the mention fold open.
      const target = path.join(w.folder, `Curso ${stamp}.md`);
      write(target, `---\ntitle: Curso ${stamp}\n---\n\n# Curso ${stamp}\n`);
      write(path.join(w.folder, `fonte-${stamp}.md`), `# Fonte\n\nO curso ${stamp} atrasou de novo.\n`);
      expect((await api(page, "POST", "/api/v1/memory/index")).status).toBe(200);
      await page.goto(`/#/brain/notes?open=${encodeURIComponent(target)}`);
      const close = page.getByRole("button", { name: "Fechar conversa" });
      if (await close.isVisible()) await close.click();
      const fold = page.locator(".notes-panel .notes-fold", { hasText: "Menções sem link" });
      await expect(fold.locator(".notes-fold-head button")).toHaveText("Menções sem link (1)");
      await expect(fold.locator(".notes-fold-head button")).toHaveAttribute("aria-expanded", "true");
      await expect(fold.locator(".mf-item mark")).toHaveText(`curso ${stamp}`);
      await sized(page, ".notes-panel", []);
      expect(await serious(page)).toEqual([]);
    });

/* ---------------- C99: the gallery ---------------- */

for (const theme of THEMES)
  test(`C99 the gallery has a weekly-review entry (the step bar, a loop item, a project item, a locked project item, the archive list, a mention item) with no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-weekly");
    await expect(story.locator(".wk-steps > .wk-step")).toHaveCount(5);
    await expect(story.locator('.wk-steps [aria-current="step"]')).toHaveCount(1);
    await expect(story.locator(".wk-item .wk-loop")).toHaveCount(1);
    const projects = story.locator(".wk-list > .wk-item:has(.wk-title):not(.wk-check)");
    await expect(projects).toHaveCount(2);
    await expect(projects.nth(1).locator("svg.lucide-lock")).toHaveCount(1);
    await expect(story.locator(".wk-check")).toHaveCount(2);
    await expect(story.locator(".mf-item")).toHaveCount(1);
    await expect(story.locator(".mf-item mark")).toHaveText("curso de marco");
    expect(await serious(page, "#story-weekly")).toEqual([]);
  });

/* ---------------- C101: the plan's independent tests ---------------- */

test("C101 both shells: the palette opens Revisão semanal; Fechar takes a loop out, Adicionar gives a project its next action, Arquivar 1 moves a done project, Concluir revisão ends on Pronto with 1, 1 and 1; in the notes view Curso de Março shows the mention of o curso de marco atrasou and Linkar writes [[Curso de Março|curso de marco]] and the mention leaves", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await open(page, "moldura", "dark", "/");
  const w = await makeWeek(page, "c101", 6, false);
  const target = path.join(w.folder, "Curso de Março.md");
  write(target, `---\ntitle: Curso de Março\n---\n\n# Curso de Março\n\nAs aulas.\n`);
  const sources = ["diario-a", "diario-b"].map((name) => path.join(w.folder, `${name}-${stamp}.md`));
  const heads = ["Diário A", "Diário B"];
  sources.forEach((s, i) => write(s, `# ${heads[i]}\n\nHoje o curso de marco atrasou de novo.\n`));
  expect((await api(page, "POST", "/api/v1/memory/index")).status).toBe(200);
  // the inbox file of the world is not part of this flow
  fs.rmSync(path.join(MEMORY, "inbox", w.inbox), { force: true });
  expect((await api(page, "POST", "/api/v1/memory/index")).status).toBe(200);

  // the moldura: the palette, then the week
  await palette(page);
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  const wk = week(page);
  await expect(wk.locator("h1")).toHaveText("Revisão semanal");
  const loop = wk.locator(".wk-item", { hasText: w.loops[0]! });
  await loop.getByRole("button", { name: "Fechar" }).click();
  await expect(loop).toHaveCount(0);
  await expect(wk.locator(".wk-item", { hasText: w.loops[1]! })).toBeVisible();
  expect(
    (await api(page, "GET", "/api/v1/memory/weekly-review")).json.loops.items.map((l: any) => l.text),
  ).not.toContain(w.loops[0]);

  await step(page, "Atualizar", 2);
  const app = wk.locator(".wk-item", { hasText: w.app });
  await app.getByRole("textbox").fill("Ligar para o fornecedor");
  await app.getByRole("button", { name: "Adicionar" }).click();
  await expect(app).toContainText("Próxima ação: Ligar para o fornecedor");
  expect(fs.readFileSync(path.join(w.folder, `app-${stamp}.md`), "utf8")).toContain(
    "- [ ] Ligar para o fornecedor",
  );

  await step(page, "Arquivar", 4);
  await expect(wk.getByRole("checkbox", { name: w.site })).toBeChecked();
  await wk.getByRole("button", { name: "Arquivar 1" }).click();
  await expect(wk.getByText("Arquivados: 1.")).toBeVisible();
  expect(fs.existsSync(path.join(w.folder, `site-${stamp}.md`))).toBe(false);

  await step(page, "Pronto", 5);
  await wk.getByRole("button", { name: "Concluir revisão" }).click();
  await expect(wk.getByText("Revisão da semana concluída.")).toBeVisible();
  await expect(wk.locator(".wk-num")).toHaveText(["1", "1", "1"]);
  await expect(wk.locator(".wk-num-label")).toHaveText([
    "laços decididos",
    "projetos revisados",
    "arquivados",
  ]);

  // the moldura's notes view: the mention, Linkar, the link written, the mention gone
  async function linkIn(i: number, scope: string) {
    const source = sources[i]!;
    await page.goto(`/#/brain/notes?open=${encodeURIComponent(target)}`);
    const close = page.getByRole("button", { name: "Fechar conversa" });
    if (await close.isVisible()) await close.click();
    const fold = page.locator(`${scope} .notes-panel .notes-fold`, { hasText: "Menções sem link" });
    const item = fold.locator(".mf-item", { has: page.getByRole("button", { name: heads[i], exact: true }) });
    await expect(item.locator(".mf-excerpt")).toContainText("o curso de marco atrasou");
    await expect(item.locator("mark")).toHaveText("curso de marco");
    await item.getByRole("button", { name: "Linkar" }).click();
    await expect(item).toHaveCount(0);
    await expect(fold.getByRole("status")).toHaveText(`Linkado em ${heads[i]}.`);
    expect(fs.readFileSync(source, "utf8")).toBe(
      `# ${heads[i]}\n\nHoje o [[Curso de Março|curso de marco]] atrasou de novo.\n`,
    );
  }
  await linkIn(0, '[data-shell="moldura"]');

  // the Núcleo: the palette opens the week, finished, with the same numbers; its notes view links the other mention
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await seed(page, "nucleo", "dark");
  await page.goto("/#/");
  await page.reload();
  await expect(page.locator(".nu-shell")).toBeVisible();
  await palette(page);
  await expect(page).toHaveURL(/#\/brain\/weekly/);
  const nwk = page.locator(".nu-shell .bs-notes .wk");
  await expect(nwk.locator(".wk-now")).toHaveText("Etapa 5 de 5 · Pronto");
  await expect(nwk.getByText(/^Revisão desta semana concluída em \d+\/\d\d\.$/)).toBeVisible();
  await expect(nwk.locator(".wk-num")).toHaveText(["1", "1", "1"]);
  await linkIn(1, ".nu-shell");
});

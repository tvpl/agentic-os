/**
 * "Revisões" in a real browser (.specs/features/cerebro-natureza, C70, C90, C91; design.md "Tela - Revisões"; plan.md
 * amendment 10): the entries in their places in both shells (the graph's fourth `.btn.sm`, the scene menu's last row,
 * the palette, a `reviewDue` inbox row), the screen with a list, with an empty list, on "Sem classificação" and with
 * the "Virou realidade" dialog at 12px or more (13px for sentences), keyboard-operable in the order of C75 and with no
 * serious axe violation in both themes and both shells, and the gallery's entry.
 *
 * The notes are real files of the isolated e2e home, under a folder of `memory/notes/` made for each test with an old
 * `last_reviewed`, indexed through the API with the page's own token, and taken away (and the index redone) after it.
 * The interface reads pt-BR, so the claims' own words are the ones asserted.
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
const NOTES = path.join(E2E_HOME, "memory", "notes");
let folder = "";

async function seed(page: Page, shell: Shell, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
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

async function open(page: Page, shell: Shell, theme: Theme, at: string) {
  await seed(page, shell, theme);
  await page.setViewportSize({ width: 1440, height: 900 });
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

/** Two notes due (a plano and an opinião reviewed long ago) and one with no nature, under memory/notes/<folder>/. */
async function makeNotes(page: Page, name: string) {
  folder = `e2e-revisoes-${stamp}-${name}`;
  const dir = path.join(NOTES, folder);
  fs.mkdirSync(dir, { recursive: true });
  const write = (file: string, header: string, body: string) =>
    fs.writeFileSync(path.join(dir, file), `---\n${header}\n---\n\n${body}\n`);
  write(
    `plano-${stamp}.md`,
    "natureza: plano\nescopo: equipe\nlast_reviewed: 2025-01-02",
    `Vamos lançar o curso ${stamp} em março.`,
  );
  write(
    `opiniao-${stamp}.md`,
    "natureza: opiniao\nlast_reviewed: 2025-01-01",
    `Acho que o preço ${stamp} está alto.`,
  );
  write(`solta-${stamp}.md`, "title: Solta", `Planejamos e vamos fazer ${stamp}.`);
  const indexed = await api(page, "POST", "/api/v1/memory/index");
  expect(indexed.status, JSON.stringify(indexed.json)).toBe(200);
  const due = await api(page, "GET", "/api/v1/memory/reviews?kind=due");
  expect(due.status).toBe(200);
  expect(due.json.total).toBeGreaterThanOrEqual(2);
  return { dir, total: due.json.total as number };
}

test.afterEach(async ({ page }) => {
  if (!page.url().startsWith("http")) return;
  if (folder) fs.rmSync(path.join(NOTES, folder), { recursive: true, force: true });
  folder = "";
  await api(page, "POST", "/api/v1/memory/index").catch(() => undefined);
});

const screenOf = (page: Page) => page.locator(".rv");
async function palette(page: Page) {
  const launcher = page.locator(".launcher");
  await expect(async () => {
    if (!(await launcher.isVisible())) await page.keyboard.press("Control+k");
    await expect(launcher.getByRole("combobox")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await launcher.getByRole("combobox").fill("Revisões");
  await launcher
    .getByRole("option", { name: /^Revisões/ })
    .first()
    .click();
}

/* ---------------- C70: the entries ---------------- */

test("C70 the moldura: Revisões (N) the fourth .btn.sm of the graph's row after Faxina and before the chips, the palette, and a reviewDue inbox row, each to /brain/reviews", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "moldura", "dark", "/brain");
  const { total } = await makeNotes(page, "c70m");
  await page.reload();
  const row = page.locator(".brain-topbar-actions");
  const buttons = row.locator("button.btn.sm");
  await expect(buttons).toHaveCount(4);
  await expect(buttons.nth(2)).toHaveAccessibleName("Faxina");
  await expect(buttons.nth(3)).toHaveAccessibleName(`Revisões (${total})`);
  const order = await row.evaluate((el) =>
    [...el.querySelectorAll("button")].map((b) =>
      b.classList.contains("os-chip") ? "chip" : (b.getAttribute("aria-label") ?? b.textContent!.trim()),
    ),
  );
  expect(order.slice(0, 4)).toEqual([
    "Atualizar índice",
    "Modo apresentação (p)",
    "Faxina",
    `Revisões (${total})`,
  ]);
  expect(order.slice(4).every((x) => x === "chip")).toBe(true);
  const boxes = await Promise.all([2, 3].map((i) => buttons.nth(i).boundingBox()));
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  await buttons.nth(3).click();
  await expect(screenOf(page).locator("h1")).toHaveText("Revisões");
  await expect(page).toHaveURL(/#\/brain\/reviews/);

  await page.goto("/#/");
  await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  await palette(page);
  await expect(screenOf(page).locator("h1")).toHaveText("Revisões");
  await expect(page).toHaveURL(/#\/brain\/reviews/);

  // A reviewDue row of the inbox, as the sentinel writes it.
  await page.route(/\/api\/v1\/notifications(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "n_review_e2e",
            kind: "system",
            title: "3 items to review",
            body: "Notes whose review date has passed are waiting in Reviews.",
            ts: Date.now(),
            read: false,
            href: "/brain/reviews",
            messageKey: "sentinel.reviewDue",
            messageParams: { count: 3, display: "3" },
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
    .getByRole("button", { name: /3 itens para revisar/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/brain\/reviews/);
  await expect(screenOf(page).locator("h1")).toHaveText("Revisões");
});

test("C70 the Núcleo: Revisões (N) the last row of bs-menu-acts after Faxina, and the palette, each to the brain's panel at /brain/reviews", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, "nucleo", "dark", "/brain");
  const { total } = await makeNotes(page, "c70n");
  await page.reload();
  await expect(page.locator(".bs canvas").first()).toBeVisible();
  await page.locator(".bs-more").click();
  const acts = page.locator(".bs-menu .bs-menu-acts > button");
  await expect(acts.last()).toHaveText(`Revisões (${total})`);
  expect((await acts.allTextContents()).at(-2)).toBe("Faxina");
  await acts.last().click();
  await expect(page.locator(".nu-shell .bs-notes .rv h1")).toHaveText("Revisões");
  await expect(page).toHaveURL(/#\/brain\/reviews/);
  await page.goto("/#/");
  await expect(page.locator(".nu-shell")).toBeVisible();
  await palette(page);
  await expect(page.locator(".nu-shell .bs-notes .rv h1")).toHaveText("Revisões");
  await expect(page).toHaveURL(/#\/brain\/reviews/);
});

/* ---------------- C90: the screen, both themes, both shells ---------------- */

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

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C90 the screen in the ${shell}, ${theme}: a list, an empty list, Sem classificação and the dialog at 12px or more, sentences at 13px, the actions by Tab in order and Enter, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await open(page, shell, theme, "/brain");
      await makeNotes(page, `${shell}-${theme}`);
      await page.evaluate(() => document.fonts.ready);
      await page.goto(`/#/brain/reviews`);
      const rv = screenOf(page);
      await expect(rv.locator("h1")).toHaveText("Revisões");

      // A list: choose the plano note, the detail on its right.
      const plano = rv.locator(".rv-item", { hasText: `plano-${stamp}.md` });
      await plano.locator(".rv-pick").click();
      await expect(rv.locator(".rv-detail h2")).toHaveText(`plano-${stamp}.md`);
      const list = await rv.locator(".rv-list").boundingBox();
      const detail = await rv.locator(".rv-detail").boundingBox();
      expect(list!.x + list!.width).toBeLessThanOrEqual(detail!.x);
      const title = await rv.locator("h1").boundingBox();
      const tabs = await rv.getByRole("tablist").boundingBox();
      expect(title!.y).toBeLessThan(tabs!.y);
      await expect(rv.locator(".rv-excerpt")).toContainText(`Vamos lançar o curso ${stamp}`);
      await sized(page, ".rv", ["Vamos lançar o curso", "itens para revisar"]);
      expect(await serious(page)).toEqual([]);

      // Every action by Tab, in the order of C75, and Enter activates.
      const order = [
        "Ainda vale",
        "Atualizar",
        "Virou realidade",
        "Mudei de ideia",
        "Adiar",
        "Não cobrar mais",
      ];
      await rv.locator(".rv-acts button").first().focus();
      const seen: string[] = [];
      for (let i = 0; i < order.length; i++) {
        seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""));
        await page.keyboard.press("Tab");
      }
      expect(seen).toEqual(order);
      await rv.getByRole("button", { name: "Adiar" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitem")).toHaveText(["7 dias", "14 dias", "30 dias", "90 dias"]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);

      // The dialog.
      await rv.getByRole("button", { name: "Virou realidade" }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Virou realidade" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Registrar como fato" }).click();
      await expect(dialog.getByLabel("O quê")).toBeVisible();
      const box = await dialog.boundingBox();
      expect(Math.round(box!.width)).toBe(480);
      await sized(page, '[role="dialog"]', []);
      expect(await serious(page)).toEqual([]);
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(dialog).toHaveCount(0);

      // An empty list: the filter Hipótese holds nothing here.
      await rv.getByRole("group", { name: "Natureza" }).getByRole("button", { name: "Hipótese" }).click();
      await rv.getByRole("group", { name: "Escopo" }).getByRole("button", { name: "Externo" }).click();
      await expect(rv.locator(".rv-empty")).toContainText("Nada para revisar hoje.");
      await expect(rv.locator(".rv-empty svg.lucide-circle-check")).toBeVisible();
      await sized(page, ".rv", ["Nada para revisar hoje."]);
      expect(await serious(page)).toEqual([]);
      await rv.getByRole("group", { name: "Escopo" }).getByRole("button", { name: "Externo" }).click();
      await rv.getByRole("group", { name: "Natureza" }).getByRole("button", { name: "Hipótese" }).click();

      // Sem classificação.
      await rv.getByRole("tab", { name: /Sem classificação/ }).click();
      const loose = rv.locator(".rv-item", { hasText: `solta-${stamp}.md` });
      await loose.locator(".rv-pick").click();
      await expect(rv.locator(".rv-detail h2")).toHaveText(`solta-${stamp}.md`);
      await expect(rv.locator(".rv-suggest")).toContainText(/Sugestão: Plano|Sem sugestão/);
      await expect(rv.locator(".rv-natures button")).toHaveCount(5);
      await sized(page, ".rv", ["itens para revisar"]);
      expect(await serious(page)).toEqual([]);
    });

/* ---------------- C91: the gallery ---------------- */

for (const theme of THEMES)
  test(`C91 the gallery has a reviews entry (the six badges, the scope badges, a list item, the three action rows, the dialog) with no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-reviews");
    await expect(story.locator(".nb-filters > .nb:not(.nb-scope)")).toHaveCount(6);
    await expect(story.locator(".nb-filters > .nb-scope")).toHaveCount(3);
    await expect(story.locator(".rv-list > .rv-item")).toHaveCount(1);
    const rows = story.locator(".rv-acts");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("button")).toHaveCount(6);
    await expect(rows.nth(1).locator("button")).toHaveCount(5);
    await expect(rows.nth(2).locator("button")).toHaveCount(3);
    expect(await serious(page, "#story-reviews")).toEqual([]);
    await rows.nth(0).getByRole("button", { name: "Became real" }).click();
    const dialog = page.getByRole("dialog", { name: "Became real" });
    await expect(dialog).toBeVisible();
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
  });

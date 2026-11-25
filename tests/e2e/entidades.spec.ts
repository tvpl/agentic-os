/**
 * "Entidades" in a real browser (.specs/features/cerebro-entidades-resumos, C101; design.md "Vista - Entidades" and
 * "Painel da entidade"): the two columns at 1280×800 in both shells (the list 320px on the left, the entity's panel the
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
import { E2E_HOME } from "./home.mjs";

type Shell = "moldura" | "nucleo";
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

async function open(page: Page, shell: Shell, at: string, width = 1280) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(
    /\/api\/(v1\/)?ui-preferences(\?.*)?$/,
    fed((j) => ({ ...j, shell, activeContext: null })),
  );
  await page.route(
    "**/api/v1/meta",
    fed((j) => ({ ...j, theme: "dark", language: "pt-BR" })),
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

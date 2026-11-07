/**
 * Trustworthy memory in a real browser (.specs/features/cerebro-memoria-confiavel, C106-C108): "Revisões" on "Do
 * agente" with a consolidation (one op of each trust and state) and the note panel's "Histórico" with its version dialog
 * open, keyboard-operable in reading order and with no serious axe violation in both themes and both shells; the S2 and
 * S3 independent tests through the interface (a `fact` proposal accepted, a note saved twice and restored); and the
 * gallery's entry.
 *
 * The consolidation of C106 is answered by the page's own routes (a run of `consolidate-memory` needs a model); the
 * proposal and the note of C107 are real, made through the API with the page's own token under a folder of
 * `memory/notes/` made for each test and taken away after it. The interface reads pt-BR.
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

async function serious(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder.include(include);
  const result = await builder.analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

/** A note under memory/notes/<folder>/ made through the API: created, then saved twice. Its versions, oldest first. */
async function makeNote(page: Page, name: string) {
  folder = `e2e-memoria-${stamp}-${name}`;
  const made = await api(page, "POST", "/api/v1/memory/notes", {
    title: `Nota ${stamp}`,
    folder,
    content: "# Primeira\n\nO texto de antes.\n",
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  let version = made.json.version as string;
  // the bytes the create wrote (the route may add its own header): the first version
  const texts = [fs.readFileSync(made.json.path as string, "utf8")];
  for (const text of ["# Segunda\n\nMudou uma vez.\n", "# Terceira\n\nMudou duas vezes.\n"]) {
    const saved = await api(page, "PUT", "/api/v1/memory/notes", {
      path: made.json.path,
      content: text,
      baseVersion: version,
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    version = saved.json.version;
    texts.push(text);
  }
  return { path: made.json.path as string, texts };
}

test.afterEach(async ({ page }) => {
  if (!page.url().startsWith("http")) return;
  if (folder) fs.rmSync(path.join(NOTES, folder), { recursive: true, force: true });
  folder = "";
  // the notes view keeps its tabs in the preferences of the shared e2e home: leave none behind
  await api(page, "PUT", "/api/v1/ui-preferences", {
    brain: { notes: { root: null, home: {}, tabs: [], active: null, sort: "name", expanded: [] } },
  }).catch(() => undefined);
});

/* ---------------- C106: the tab and the fold, keyboard and axe, both themes, both shells ---------------- */

const CONSOLIDATION = {
  id: "mp_00000000000000c6",
  kind: "consolidation",
  status: "pending",
  author: "run:e2ec106",
  runId: "e2ec106",
  createdAt: Date.now() - 2 * 3_600_000,
  summary: "Duas decisões e um fato da semana.",
  opCount: 5,
};
const op = (over: Record<string, unknown>) => ({
  op: "add",
  section: "Decisions",
  text: "Usar SQLite para o histórico",
  source: "journal/2026-09-03.md#Decisions",
  line: 12,
  trust: "usuario",
  state: "valid",
  ...over,
});

/** The page's own routes answer the list and the detail of one consolidation; everything else is the server's. */
async function oneConsolidation(page: Page) {
  await page.route(/\/api\/v1\/memory\/proposals(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [CONSOLIDATION], total: 1 } }),
  );
  await page.route(`**/api/v1/memory/proposals/${CONSOLIDATION.id}`, (route) =>
    route.fulfill({
      json: {
        ...CONSOLIDATION,
        decidedAt: null,
        payload: {},
        result: null,
        ops: [
          op({}),
          op({ text: "O build leva 4 minutos", section: "Facts", trust: "ferramenta" }),
          op({ text: "Manhãs são para escrever", section: "Reflections", trust: "inferido" }),
          op({
            text: "Uma linha de um dia que não existe",
            state: "invalid",
            reason: "journal/2099-01-01.md não existe",
          }),
          op({
            op: "supersede",
            text: "Uma linha mudada",
            state: "conflict",
            reason: "a linha não está no MEMORY.md",
          }),
        ],
        diff: "--- a/MEMORY.md\n+++ b/MEMORY.md\n@@ -1,2 +1,3 @@\n ## Decisions\n-- antiga\n+- nova\n+- outra\n",
        baseVersion: "sha256:e2e",
        effects: [],
      },
    }),
  );
}

/** The focusable controls under `scope`, in the document's order (reading order: no stylesheet reorders them). */
const focusables = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    return [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
      .filter(
        (el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0 && el.getClientRects().length > 0,
      )
      .map(
        (el) => `${el.tagName}.${el.className}|${el.getAttribute("aria-label") ?? el.textContent?.trim()}`,
      );
  }, scope);
const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el
      ? `${el.tagName}.${el.className}|${el.getAttribute("aria-label") ?? el.textContent?.trim()}`
      : "";
  });

/** The notes view with `path` open and room for its panel: the frame's conversation folded, a wide window. */
async function openNote(page: Page, file: string) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const close = page.getByRole("button", { name: "Fechar conversa" });
  if (await close.isVisible()) await close.click();
  await page.goto(`/#/brain/notes?open=${encodeURIComponent(file)}`);
  await expect(page.locator(".notes-panel")).toBeVisible();
}

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C106 the ${shell}, ${theme}: Do agente with a consolidation and the note's Histórico with its version dialog, every action by Tab in reading order and Enter, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await open(page, shell, theme, "/brain");
      await oneConsolidation(page);
      await page.evaluate(() => document.fonts.ready);
      await page.goto("/#/brain/reviews?tab=agent");
      const rv = page.locator(".rv");
      await expect(rv.getByRole("tab", { name: "Do agente (1)" })).toHaveAttribute("aria-selected", "true");
      const detail = rv.locator(".ag-detail");
      await expect(detail.locator(".ag-op")).toHaveCount(5);
      expect(await serious(page)).toEqual([]);

      // Every action of the tab by Tab, from the list item to Recusar, in the document's order.
      const order = await focusables(page, ".rv .rv-body");
      expect(order.length).toBeGreaterThan(8);
      await rv.locator(".rv-pick").first().focus();
      const seen: string[] = [];
      for (let i = 0; i < order.length; i++) {
        seen.push(await active(page));
        await page.keyboard.press("Tab");
      }
      expect(seen).toEqual(order);
      expect(seen.at(-1)).toContain("Recusar");
      // Enter activates: Marcar todas ticks the three valid ops; Recusar asks first
      await detail.getByRole("button", { name: "Marcar todas", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(detail.getByRole("button", { name: "Aceitar selecionadas (3)" })).toBeVisible();
      await detail.getByRole("button", { name: "Recusar" }).focus();
      await page.keyboard.press("Enter");
      const ask = page.getByRole("dialog", { name: "Recusar esta proposta?" });
      await expect(ask).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await ask.getByRole("button", { name: "Cancelar" }).focus();
      await page.keyboard.press("Enter");
      await expect(ask).toHaveCount(0);

      // The note panel's Histórico, and the dialog of a version.
      const note = await makeNote(page, `${shell}-${theme}`);
      await openNote(page, note.path);
      const fold = page.locator(".notes-panel .notes-fold", { hasText: "Histórico" });
      await expect(fold.locator(".hf-pick")).toHaveCount(3);
      expect(await serious(page)).toEqual([]);
      const rows = await focusables(page, ".notes-panel");
      await fold.locator(".hf-pick").first().focus();
      // the rows are reached by Tab one after another
      const at = rows.findIndex((r) => r.includes("hf-pick"));
      const mine: string[] = [];
      for (let i = 0; i < 3; i++) {
        mine.push(await active(page));
        await page.keyboard.press("Tab");
      }
      expect(mine).toEqual(rows.slice(at, at + 3));
      await fold.locator(".hf-pick").last().focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: /^Versão de / });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".mc-diff")).toBeVisible();
      const box = await dialog.boundingBox();
      expect(Math.round(box!.width)).toBe(720);
      expect(await serious(page)).toEqual([]);
      // the dialog's controls by Tab in order: the diff region, Fechar, Restaurar esta versão
      const controls = await focusables(page, '[role="dialog"]');
      expect(controls.at(-2)).toContain("Fechar");
      expect(controls.at(-1)).toContain("Restaurar esta versão");
      const footer = dialog.locator(".modal-actions");
      await footer.getByRole("button", { name: "Fechar" }).focus();
      await page.keyboard.press("Tab");
      expect(await active(page)).toContain("Restaurar esta versão");
      await footer.getByRole("button", { name: "Fechar" }).focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
    });

/* ---------------- C107: the independent tests of S2 and S3, through the interface ---------------- */

test("C107 a fact proposal accepted on Do agente becomes a fact by mcp with its proposalId; a note saved twice shows three rows and restoring the first puts its bytes back and adds Restaurada", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await open(page, "moldura", "dark", "/");
  const subject = `Cliente ${stamp}`;
  const made = await api(page, "POST", "/api/v1/memory/proposals", {
    kind: "fact",
    subject,
    predicate: "status",
    object: "ativo",
  });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const id = made.json.proposal.id as string;
  await page.goto("/#/brain/reviews?tab=agent");
  const rv = page.locator(".rv");
  const item = rv.locator(".rv-item", { hasText: `Fato: ${subject} · status` });
  await expect(item).toHaveCount(1);
  await item.locator(".rv-pick").click();
  const detail = rv.locator(".ag-detail");
  await expect(detail.locator(".ag-op")).toHaveCount(1);
  await detail.getByRole("checkbox").check();
  await detail.getByRole("button", { name: "Aceitar selecionadas (1)" }).click();
  await expect(rv.locator(".rv-notice")).toContainText("Proposta aceita.");
  await expect(item).toHaveCount(0);
  const facts = await api(page, "GET", `/api/v1/memory/facts?subject=${encodeURIComponent(subject)}`);
  expect(facts.status).toBe(200);
  expect(facts.json.facts).toHaveLength(1);
  expect(facts.json.facts[0]).toMatchObject({ subject, author: "mcp", proposalId: id });

  const note = await makeNote(page, "c107");
  await openNote(page, note.path);
  const fold = page.locator(".notes-panel .notes-fold", { hasText: "Histórico" });
  await expect(fold.locator(".hf-origin")).toHaveText(["Editada", "Editada", "Criada"]);
  await fold.locator(".hf-pick").last().click();
  const dialog = page.getByRole("dialog", { name: /^Versão de / });
  await dialog.getByRole("button", { name: "Restaurar esta versão" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(fold.locator('[role="status"]')).toHaveText("Versão restaurada.");
  expect(fs.readFileSync(note.path, "utf8")).toBe(note.texts[0]);
  await expect(fold.locator(".hf-origin")).toHaveText(["Restaurada", "Editada", "Editada", "Criada"]);
});

/* ---------------- C108: the gallery ---------------- */

for (const theme of THEMES)
  test(`C108 the gallery has a memória confiável entry (an item of each kind, an op of each trust and state, the two banners, a history row, the version dialog) with no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-memoria");
    await expect(story.locator(".rv-list > .rv-item")).toHaveCount(5);
    const ops = story.locator(".ag-ops > .ag-op");
    await expect(ops).toHaveCount(5);
    await expect(ops.locator(".mc-trust.tone-ok")).toHaveCount(1);
    await expect(ops.locator(".mc-trust.tone-warn")).toHaveCount(1);
    await expect(ops.locator(".mc-trust.tone-info")).toHaveCount(3);
    await expect(ops.locator(".mc-opstate")).toHaveCount(2);
    await expect(story.locator(".ag-banner")).toHaveCount(2);
    await expect(story.locator(".hf-list .hf-pick")).toHaveCount(1);
    expect(await serious(page, "#story-memoria")).toEqual([]);
    await story.locator(".hf-pick").click();
    const dialog = page.getByRole("dialog", { name: /^Version of / });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".mc-diff")).toBeVisible();
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
  });

/* ---------------- C146: the folder's modals, keyboard and axe, both themes; the S4 independent test ---------------- */

/** Tab from the first control of the open dialog through all of them: the order seen is the document's. */
async function tabsInOrder(page: Page) {
  const controls = await focusables(page, '[role="dialog"]');
  expect(controls.length).toBeGreaterThan(1);
  await page.locator('[role="dialog"]').locator("a[href], button, input, select, textarea").first().focus();
  const seen: string[] = [];
  for (let i = 0; i < controls.length; i++) {
    seen.push(await active(page));
    await page.keyboard.press("Tab");
  }
  expect(seen).toEqual(controls);
  return controls;
}

for (const theme of THEMES)
  test(`C146 the ${theme} theme: the permissions, export and import modals from the tree, every control by Tab in order, no serious axe violation; after Salvar with devices hide the folder shows EyeOff and a device's search no longer finds its note`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await open(page, "moldura", theme, "/");
    folder = `e2e-memoria-${stamp}-c146-${theme}`;
    const word = `palavra${stamp}${theme}`;
    const made = await api(page, "POST", "/api/v1/memory/notes", {
      title: `Nota ${word}`,
      folder,
      content: `# Nota ${word}\n\nO texto com ${word}.\n`,
    });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    const dir = path.dirname(made.json.path as string);
    // a device holding content, paired through the API (a device is answered only while remote access is on: the
    // test turns it on, and the afterEach puts the settings back and revokes the device)
    const remote = (await api(page, "GET", "/api/v1/settings")).json.remote;
    restoreRemote = remote;
    expect(
      (await api(page, "PUT", "/api/v1/settings", { remote: { ...remote, enabled: true } })).status,
    ).toBe(200);
    const start = await api(page, "POST", "/api/v1/pair/start", {
      name: `c146-${theme}`,
      scopes: ["content"],
    });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    const claimed = await page.evaluate(async (code) => {
      const res = await fetch("/api/v1/pair/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name: "c146" }),
      });
      return (await res.json()) as { token: string; device: { id: string } };
    }, start.json.code as string);
    pairedDevice = claimed.device.id;
    const device = claimed.token;
    const deviceSearch = () =>
      page.evaluate(
        async ([token, q]) => {
          const res = await fetch(`/api/v1/memory/search?q=${encodeURIComponent(q!)}`, {
            headers: { "x-mordomo-token": token! },
          });
          return { status: res.status, body: JSON.stringify(await res.json()) };
        },
        [device, word],
      );
    await expect.poll(async () => (await deviceSearch()).body, { timeout: 30_000 }).toContain(word);

    await page.goto("/#/brain/notes");
    const tree = page.getByRole("tree");
    await tree
      .getByRole("treeitem", { name: /^notes/ })
      .first()
      .click();
    const row = tree.locator(`[role="treeitem"][data-path$="/notes/${folder}"]`);
    await expect(row).toHaveCount(1);
    const menu = row.getByRole("button", { name: `Opções de ${folder}` });

    // Permissões…
    await menu.click();
    await page.getByRole("menuitem", { name: "Permissões…" }).click();
    let dialog = page.getByRole("dialog", { name: `Permissões de ${folder}` });
    await expect(dialog).toBeVisible();
    expect(Math.round((await dialog.boundingBox())!.width)).toBe(480);
    expect(await serious(page)).toEqual([]);
    const access = await tabsInOrder(page);
    expect(access.at(-1)).toContain("Salvar");
    await dialog.getByRole("combobox", { name: "Dispositivos" }).selectOption("hide");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.locator(":scope > .notes-row .notes-lock svg.lucide-eye-off")).toHaveCount(1);
    const after = await deviceSearch();
    expect(after.status).toBe(200);
    expect(after.body).not.toContain(word);
    expect(after.body).not.toContain(dir);

    // Exportar pasta…
    await menu.click();
    await page.getByRole("menuitem", { name: "Exportar pasta…" }).click();
    dialog = page.getByRole("dialog", { name: `Exportar ${folder}` });
    await expect(dialog).toBeVisible();
    expect(Math.round((await dialog.boundingBox())!.width)).toBe(480);
    expect(await serious(page)).toEqual([]);
    await tabsInOrder(page);
    await dialog.getByRole("button", { name: "Exportar" }).click();
    await expect(dialog.locator(".ft-done")).toContainText("1 arquivos");
    expect(await serious(page)).toEqual([]);
    const exported = (await dialog.locator(".ft-done .mono").textContent())!;
    fs.rmSync(exported, { recursive: true, force: true });
    await dialog.locator(".modal-actions").getByRole("button", { name: "Fechar" }).click();
    await expect(dialog).toHaveCount(0);

    // Importar pasta… (the NOTAS menu)
    // the hint of the folder menu, which took the focus back from the dialog, is put away first
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Opções das notas" }).click();
    await page.getByRole("menuitem", { name: "Importar pasta…" }).click();
    dialog = page.getByRole("dialog", { name: "Importar pasta" });
    await expect(dialog).toBeVisible();
    expect(Math.round((await dialog.boundingBox())!.width)).toBe(480);
    await dialog.getByLabel("Pasta de origem").fill("/um/caminho");
    expect(await serious(page)).toEqual([]);
    await tabsInOrder(page);
  });

let restoreRemote: unknown = null;
let pairedDevice: string | null = null;
test.afterEach(async ({ page }) => {
  if (!page.url().startsWith("http")) return;
  // C146 leaves no device, no remote access it turned on, and no folder restricted in the shared e2e home
  if (pairedDevice) await api(page, "DELETE", `/api/v1/devices/${pairedDevice}`).catch(() => undefined);
  if (restoreRemote)
    await api(page, "PUT", "/api/v1/settings", { remote: restoreRemote }).catch(() => undefined);
  pairedDevice = null;
  restoreRemote = null;
  const settings = await api(page, "GET", "/api/v1/settings").catch(() => null);
  const list = (settings?.json?.folderAccess ?? []) as Array<{ path: string }>;
  const kept = list.filter((e) => !e.path.includes(`e2e-memoria-${stamp}`));
  if (kept.length !== list.length) await api(page, "PUT", "/api/v1/settings", { folderAccess: kept });
});

/* ---------------- C165 and C167: the computed layout of the tab and the computed tones ---------------- */

for (const shell of SHELLS)
  test(`C165 the ${shell}: on Do agente the list is on the left and the detail on the right, side by side from the same top, the list the narrower`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await open(page, shell, "dark", "/brain");
    await oneConsolidation(page);
    await page.goto("/#/brain/reviews?tab=agent");
    const body = page.locator(".rv .rv-body");
    await expect(body.locator(".ag-detail .ag-op")).toHaveCount(5);
    const list = (await body.locator("> .rv-list").boundingBox())!;
    const detail = (await body.locator("> .ag-detail").boundingBox())!;
    // side by side: the list ends before the detail starts, and they begin at the same height
    expect(list.x + list.width).toBeLessThanOrEqual(detail.x);
    expect(Math.abs(list.y - detail.y)).toBeLessThanOrEqual(1);
    // 2fr against 3fr: the list is the narrower column
    expect(list.width).toBeLessThan(detail.width);
    expect(list.width).toBeGreaterThanOrEqual(240);
    const grid = await body.evaluate((el) => {
      const s = getComputedStyle(el);
      return { display: s.display, columns: s.gridTemplateColumns.split(" ").length };
    });
    expect(grid).toEqual({ display: "grid", columns: 2 });
  });

for (const theme of THEMES)
  test(`C167 the gallery, ${theme}: each trust badge and each diff row draws the token of its tone (the computed colour is the token's), with its icon and its text or sign`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-memoria");
    await story.locator(".hf-pick").click();
    const dialog = page.getByRole("dialog", { name: /^Version of / });
    await expect(dialog.locator(".mc-diff .mc-add")).toHaveCount(1);
    // what a token computes to in this theme: a probe element painted with it
    const resolved = (prop: "color" | "backgroundColor", token: string) =>
      page.evaluate(
        ([p, t]) => {
          const probe = document.createElement("div");
          probe.style.setProperty(p === "color" ? "color" : "background-color", `var(${t})`);
          document.body.appendChild(probe);
          const value = getComputedStyle(probe)[p as "color"];
          probe.remove();
          return value;
        },
        [prop, token],
      );
    const computed = (selector: string, prop: "color" | "backgroundColor", within = story) =>
      within
        .locator(selector)
        .first()
        .evaluate((el, p) => getComputedStyle(el)[p as "color"], prop);
    const tones = [
      ["tone-ok", "--ok", "lucide-user-check"],
      ["tone-warn", "--warn", "lucide-wrench"],
      ["tone-info", "--info", "lucide-sparkles"],
    ] as const;
    const seen = new Set<string>();
    for (const [cls, token, icon] of tones) {
      const badge = story.locator(`.mc-trust.${cls}`).first();
      await expect(badge).toBeVisible();
      expect(await computed(`.mc-trust.${cls}`, "color")).toBe(await resolved("color", token));
      await expect(badge.locator(`svg.${icon}`)).toHaveCount(1);
      expect(((await badge.textContent()) ?? "").trim().length).toBeGreaterThan(0);
      seen.add(await computed(`.mc-trust.${cls}`, "color"));
    }
    expect(seen.size).toBe(3);
    // the diff of the open version dialog: a soft ground, the sign in the tone
    expect(await computed("tr.mc-add", "backgroundColor", dialog)).toBe(
      await resolved("backgroundColor", "--ok-bg"),
    );
    expect(await computed("tr.mc-del", "backgroundColor", dialog)).toBe(
      await resolved("backgroundColor", "--danger-bg"),
    );
    expect(await computed("tr.mc-add .mc-sign", "color", dialog)).toBe(await resolved("color", "--ok"));
    expect(await computed("tr.mc-del .mc-sign", "color", dialog)).toBe(await resolved("color", "--danger"));
    await expect(dialog.locator("tr.mc-add .mc-sign")).toHaveText("+");
    await expect(dialog.locator("tr.mc-del .mc-sign")).toHaveText("-");
    // a context row has no ground of its own
    const ctx = await computed("tr.mc-ctx", "backgroundColor", dialog);
    expect(ctx).toBe("rgba(0, 0, 0, 0)");
  });

/* ---------------- C192: what accepting a fact does, drawn on Do agente ---------------- */

const EFFECT_ID = "mp_00000000000000c7";
const factOp = (text: string, over: Record<string, unknown> = {}) =>
  op({ op: "fact", section: "Fact", text, source: null, line: null, trust: "usuario", ...over });
const EFFECT = {
  op: 0,
  subject: "Cliente X",
  predicate: "status",
  object: "inadimplente",
  validFrom: Date.parse("2026-06-01T15:00:00Z"),
  validTo: null,
  unchanged: 5,
  closes: [
    {
      id: 7,
      object: "ativo",
      validFrom: 1,
      validTo: null,
      action: "close",
      at: Date.parse("2026-06-01T15:00:00Z"),
    },
    { id: 8, object: "prospect", validFrom: 1, validTo: null, action: "retract", at: Date.now() },
  ],
  refuses: { id: 9, object: "suspenso", validFrom: 1, validTo: null, reason: "covers" },
  error: "validTo: must be after validFrom",
};

/** The page's own routes answer one consolidation of two fact ops: the first with every kind of effect, the second with none. */
async function consolidationWithEffects(page: Page) {
  const item = { ...CONSOLIDATION, id: EFFECT_ID, opCount: 2, createdAt: Date.now() - 3_600_000 };
  await page.route(/\/api\/v1\/memory\/proposals(\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [item], total: 1 } }),
  );
  await page.route(`**/api/v1/memory/proposals/${EFFECT_ID}`, (route) =>
    route.fulfill({
      json: {
        ...item,
        decidedAt: null,
        payload: {},
        result: null,
        ops: [factOp("Cliente X · status · inadimplente"), factOp("Cliente Y · status · ativo")],
        diff: "",
        baseVersion: "sha256:e2e",
        effects: [EFFECT],
      },
    }),
  );
}

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C192 the ${shell}, ${theme}: the effects of the fact op are drawn under it in the route's order, an icon and a text each, 13px, with the tones' own colours, no live region and no tab stop of their own, and no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await open(page, shell, theme, "/brain");
      await consolidationWithEffects(page);
      await page.evaluate(() => document.fonts.ready);
      await page.goto("/#/brain/reviews?tab=agent");
      const rows = page.locator(".rv .ag-detail .ag-op");
      await expect(rows).toHaveCount(2);
      const effects = rows.nth(0).locator(".ag-text > .ag-effects > .ag-effect");
      await expect(effects).toHaveCount(5);
      expect(await effects.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.effect))).toEqual(
        ["close", "retract", "refuses", "unchanged", "error"],
      );
      // the second fact op has nothing to say: no list at all
      await expect(rows.nth(1).locator(".ag-effects")).toHaveCount(0);
      // below the op's own text, one line under the other
      const text = (await rows.nth(0).locator(".ag-text > span").first().boundingBox())!;
      const boxes = await Promise.all([0, 1, 2, 3, 4].map((i) => effects.nth(i).boundingBox()));
      expect(boxes[0]!.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
      for (let i = 1; i < 5; i++)
        expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
      // an icon and a text each, the sentence at 13px or more
      const drawn = await effects.evaluateAll((els) =>
        els.map((el) => ({
          icon: el.querySelector("svg") !== null,
          text: (el.querySelector("span")?.textContent ?? "").trim().length,
          px: parseFloat(getComputedStyle(el.querySelector("span")!).fontSize),
        })),
      );
      for (const d of drawn) expect([d.icon, d.text > 10, d.px >= 13]).toEqual([true, true, true]);
      expect(await effects.nth(0).textContent()).toMatch(
        /Encerra o fato Cliente X · status · ativo em \d{2}\/\d{2}\/\d{4}\./,
      );
      // the computed colours are the tokens': danger for the retraction, warn for the refusal and the error
      const resolved = (token: string) =>
        page.evaluate((t) => {
          const probe = document.createElement("div");
          probe.style.color = `var(${t})`;
          document.body.appendChild(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        }, token);
      const colour = (i: number) => effects.nth(i).evaluate((el) => getComputedStyle(el).color);
      expect(await colour(1)).toBe(await resolved("--danger"));
      expect(await colour(2)).toBe(await resolved("--warn"));
      expect(await colour(4)).toBe(await resolved("--warn"));
      expect(await colour(0)).toBe(await resolved("--text-dim"));
      // nothing announced twice, nothing more to tab through
      const ul = rows.nth(0).locator(".ag-effects");
      expect(
        await ul.evaluate(
          (el) =>
            el.matches("[role], [aria-live]") ||
            el.querySelector("[role], [aria-live], a, button, input") !== null,
        ),
      ).toBe(false);
      expect(await serious(page)).toEqual([]);
    });

/* ---------------- C203: the confirmation of an accept that closes or retracts ---------------- */

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C203 the ${shell}, ${theme}: accepting what closes or retracts asks first in a Modal that names the facts, focus on Cancelar, Escape and Cancelar send nothing and give focus back, Aceitar sends one decision, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await open(page, shell, theme, "/brain");
      await consolidationWithEffects(page);
      const decisions: unknown[] = [];
      await page.route(`**/api/v1/memory/proposals/${EFFECT_ID}/decide`, async (route) => {
        decisions.push(route.request().postDataJSON());
        await route.fulfill({ json: { proposal: {}, written: [], facts: [] } });
      });
      await page.evaluate(() => document.fonts.ready);
      await page.goto("/#/brain/reviews?tab=agent");
      const detail = page.locator(".rv .ag-detail");
      const asker = detail.getByRole("button", { name: "Aceitar selecionadas (2)" });
      await expect(asker).toBeVisible();
      const dialog = page.getByRole("dialog", { name: "Aceitar vai mudar fatos que já existem" });
      const ask = async () => {
        await asker.focus();
        await page.keyboard.press("Enter");
        await expect(dialog).toBeVisible();
      };

      await ask();
      expect(decisions).toEqual([]);
      // the facts, and only what closes or retracts, in the route's order; at 13px or more; the tones' own colours
      const items = dialog.locator(".ag-effects > .ag-effect");
      await expect(items).toHaveCount(2);
      expect(await items.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.effect))).toEqual([
        "close",
        "retract",
      ]);
      expect(await items.nth(0).textContent()).toMatch(
        /Encerra o fato Cliente X · status · ativo em \d{2}\/\d{2}\/\d{4}\./,
      );
      await expect(items.nth(1)).toContainText(
        "Retrata o fato Cliente X · status · prospect como nunca verdadeiro. Não tem volta.",
      );
      const px = await items.evaluateAll((els) =>
        els.map((el) => parseFloat(getComputedStyle(el.querySelector("span")!).fontSize)),
      );
      for (const size of px) expect(size).toBeGreaterThanOrEqual(13);
      const danger = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.color = "var(--danger)";
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      });
      expect(await items.nth(1).evaluate((el) => getComputedStyle(el).color)).toBe(danger);
      expect(Math.round((await dialog.boundingBox())!.width)).toBe(480);
      // the buttons by Tab: focus starts on Cancelar, then Aceitar
      await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Aceitar", exact: true })).toBeFocused();
      expect(await serious(page)).toEqual([]);

      // Escape cancels: nothing sent, focus back on the button that asked
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(asker).toBeFocused();
      expect(decisions).toEqual([]);
      // Cancelar cancels the same way, and the ticks are kept
      await ask();
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(dialog).toHaveCount(0);
      expect(decisions).toEqual([]);
      await expect(asker).toBeVisible();
      // Aceitar sends one decision
      await ask();
      await dialog.getByRole("button", { name: "Aceitar", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => decisions.length).toBe(1);
      expect(decisions).toEqual([{ action: "accept", ops: [0, 1], baseVersion: "sha256:e2e" }]);
    });

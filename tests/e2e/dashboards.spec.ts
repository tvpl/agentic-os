/**
 * "Painéis" in a real browser (.specs/features/cerebro-paineis, C81, C90, C94, C95; design.md "Página", "Cena" and
 * "Widgets"): the Núcleo's key 6, the KPI row at three widths, the page over a snapshot with one widget of each of the
 * eight kinds, one in error and one empty, in both themes and both shells (every action by Tab in reading order,
 * Enter activates, no serious or critical axe violation, nothing under 12px, sentences at 13px), and the gallery's
 * entry. The dashboards' routes are answered from a fixture by the page's own network layer, so no test touches the
 * e2e home's memory/dashboards/; the interface reads pt-BR, so the claims' own words are the ones asserted.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Shell = "moldura" | "nucleo";
type Theme = "dark" | "light";
const SHELLS: Shell[] = ["moldura", "nucleo"];
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const NOW = Date.now();
const HOUR = 3_600_000;
const ok = (id: string, kind: string, data: Record<string, unknown>) => ({ id, kind, status: "ok", data });
const kpi = (id: string, title: string) => ({
  id,
  kind: "kpi",
  title,
  source: { kind: "notes" },
  options: { measure: "count" },
});
const series = [3, 4, 4, 6, 5, 7].map((value, i) => ({ at: NOW - (5 - i) * HOUR, value }));
const DEFINITION = {
  v: 1,
  title: "Visão geral",
  kind: "overview",
  refresh: "15m",
  widgets: [
    kpi("k1", "Prioridades de hoje"),
    kpi("k2", "Decisões da semana"),
    kpi("k3", "Projetos no prazo"),
    kpi("k4", "Revisões vencidas"),
    kpi("k5", "Execuções em 24 h"),
    { id: "destaques", kind: "highlights", title: "Destaques", source: { kind: "tasks", window: "today" } },
    {
      id: "tarefas",
      kind: "checklist",
      title: "Prioridades de hoje",
      source: { kind: "tasks", window: "today" },
      options: { size: "m" },
    },
    {
      id: "decisoes",
      kind: "list",
      title: "Decisões da semana",
      source: { kind: "decisions", window: "week" },
      options: { size: "m" },
    },
    { id: "tabela", kind: "table", title: "Clientes", source: { kind: "notes" }, options: { size: "m" } },
    {
      id: "status",
      kind: "bars",
      title: "Notas por status",
      source: { kind: "notes", groupBy: "status" },
      options: { size: "m" },
    },
    {
      id: "agenda",
      kind: "agenda",
      title: "Agenda de hoje",
      source: { kind: "connector", id: "calendar-google", read: "list" },
      options: { size: "l" },
    },
    { id: "nota", kind: "note", title: "Resumo", source: { kind: "notes" }, options: { size: "s" } },
    { id: "falha", kind: "list", title: "Fatos", source: { kind: "facts" }, options: { size: "m" } },
    {
      id: "vazio",
      kind: "list",
      title: "Em andamento",
      source: { kind: "projects" },
      options: { size: "m" },
    },
  ],
};
const SNAPSHOT = {
  v: 1,
  dashboardId: "visao-geral",
  generatedAt: NOW - 5 * 60_000,
  sources: [
    { id: "notes", kind: "notes", status: "ok", syncedAt: NOW },
    { id: "tasks", kind: "tasks", status: "ok", syncedAt: NOW },
    { id: "facts", kind: "facts", status: "error", syncedAt: null, message: "The index could not be read." },
    { id: "connector:calendar-google", kind: "connector", status: "ok", syncedAt: NOW },
  ],
  widgets: [
    ...["k1", "k2", "k3", "k4", "k5"].map((id, i) =>
      ok(id, "kpi", { value: 3 + i, of: 5, delta: 1, deltaPct: 25, direction: "up", good: true, series }),
    ),
    ok("destaques", "highlights", { items: [] }),
    ok("tarefas", "checklist", {
      items: [
        {
          path: "/fora/notes/a.md",
          line: 3,
          fileId: 1,
          text: "Mandar a proposta",
          done: false,
          due: "2026-01-01",
          priority: 2,
          title: "Cliente A",
        },
      ],
      total: 1,
    }),
    ok("decisoes", "list", {
      items: [
        {
          text: "Usar Postgres",
          state: "decided",
          natureza: "fato",
          day: "2026-01-01",
          fileId: 2,
          title: "Arquitetura",
        },
        {
          text: "Lançar em março",
          state: "decided",
          natureza: "plano",
          day: "2026-01-01",
          fileId: 3,
          title: "Plano",
        },
      ],
      total: 2,
    }),
    ok("tabela", "table", {
      columns: ["Cliente", "Dias"],
      rows: [
        { cells: ["A", 12], state: "behind" },
        { cells: ["B", 4], state: "on_track" },
      ],
    }),
    ok("status", "bars", {
      categories: [
        { label: "draft", count: 13 },
        { label: "done", count: 6 },
      ],
    }),
    ok("agenda", "agenda", {
      connector: { id: "calendar-google", name: "Calendar" },
      items: [
        { id: "e1", title: "Café", ts: NOW - 3 * HOUR },
        { id: "e2", title: "Cliente A", ts: NOW - 0.2 * HOUR, subtitle: "Ler o contrato" },
      ],
      total: 2,
    }),
    ok("nota", "note", { text: "O **onboarding** demora mais por causa do contrato.", fileId: 4 }),
    { id: "falha", kind: "list", status: "error", error: "The index could not be read." },
    { id: "vazio", kind: "list", status: "empty", data: { items: [], total: 0 } },
  ],
};
const READ = {
  definition: DEFINITION,
  version: `sha256:${"a".repeat(64)}`,
  snapshot: SNAPSHOT,
  stale: false,
  highlights: [
    { rule: "overdue", title: "Mandar a proposta", tone: "danger", target: "/brain?sel=1" },
    { rule: "due_today", title: "Ligar", tone: "warn", target: "/brain?sel=5" },
  ],
};
const LIST = {
  dashboards: [
    {
      id: "visao-geral",
      title: "Visão geral",
      kind: "overview",
      contextId: null,
      refresh: "15m",
      generatedAt: SNAPSHOT.generatedAt,
      stale: false,
    },
    {
      id: "contexto-x",
      title: "Projeto X",
      kind: "area",
      contextId: "x",
      refresh: "15m",
      generatedAt: null,
      stale: false,
    },
  ],
  problems: [],
};

async function seed(page: Page, shell: Shell, theme: Theme): Promise<{ refreshes: string[] }> {
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
  const refreshes: string[] = [];
  await page.route(/\/api\/(v1\/)?dashboards(\/[^?]*)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1\//, "/api/");
    const method = route.request().method();
    if (method === "GET" && path === "/api/dashboards") return route.fulfill({ json: LIST });
    if (method === "GET" && path === "/api/dashboards/visao-geral") return route.fulfill({ json: READ });
    if (method === "POST" && path === "/api/dashboards/visao-geral/refresh") {
      refreshes.push(path);
      return route.fulfill({ json: { snapshot: SNAPSHOT } });
    }
    return route.fulfill({
      status: 500,
      json: { error: { code: "unexpected", message: `${method} ${path}` } },
    });
  });
  return { refreshes };
}

async function open(page: Page, shell: Shell, theme: Theme, at: string, width = 1440, height = 900) {
  const net = await seed(page, shell, theme);
  await page.setViewportSize({ width, height });
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
  return net;
}

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
        if (el.closest("svg, [aria-hidden='true'], .sr-only, [hidden]")) continue;
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

/* ---------------- C81: the Núcleo's key 6 ---------------- */

test("C81 in the Núcleo, pressing 6 opens the dashboards scene", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, "nucleo", "dark", "/");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("6");
  await expect(page).toHaveURL(/#\/dashboards$/);
  const scene = page.locator(".nu-scene-app .dsn");
  await expect(scene).toBeVisible();
  await expect(scene.locator(".dsn-laminas > .dsh-card")).not.toHaveCount(0);
});

/* ---------------- C90: the KPI row at three widths ---------------- */

for (const [width, perRow] of [
  [1280, [5]],
  [900, [2, 2, 1]],
  [520, [1, 1, 1, 1, 1]],
] as const)
  test(`C90 in the moldura at ${width} px the five KPI tiles sit ${perRow.join(" + ")} to a row`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await open(page, "moldura", "dark", "/dashboards", width, 900);
    const tiles = page.locator(".dsh-kpis > .dsh-kpi");
    await expect(tiles).toHaveCount(5);
    const boxes = await tiles.evaluateAll((els) =>
      els
        .map((e) => e.getBoundingClientRect())
        .map((r) => ({ y: Math.round(r.top), w: Math.round(r.width) })),
    );
    const rows = new Map<number, number[]>();
    for (const b of boxes) rows.set(b.y, [...(rows.get(b.y) ?? []), b.w]);
    expect([...rows.values()].map((r) => r.length)).toEqual([...perRow]);
    // Equal width within a row (a tile alone on the last row of two takes one column, not the row).
    for (const r of rows.values()) expect(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(1);
  });

/* ---------------- C94: the page, both themes, both shells ---------------- */

for (const theme of THEMES)
  for (const shell of SHELLS)
    test(`C94 the page in the ${shell}, ${theme}: one widget of each kind, an error and an empty one; every action by Tab in reading order, Enter activates, no serious axe violation`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const net = await open(page, shell, theme, "/dashboards");
      const root = page.locator(shell === "moldura" ? ".page.dsh" : ".dsn");
      await expect(root.locator(".dsh-card")).toHaveCount(8);
      await expect(root.locator(".dsh-kpi")).toHaveCount(5);
      await expect(root.locator(".dsh-highlights .dsh-pill")).toHaveCount(2);
      for (const kind of ["checklist", "list", "table", "bars", "agenda", "note"])
        await expect(root.locator(`.dsh-card[data-kind="${kind}"]`).first()).toBeVisible();
      await expect(root.locator('.dsh-card[data-widget="falha"] [role="alert"]')).toContainText(
        "The index could not be read.",
      );
      await expect(root.locator('.dsh-card[data-widget="vazio"] .dsh-empty')).toHaveText(
        "Nenhum projeto ativo.",
      );
      await page.evaluate(() => document.fonts.ready);
      await sized(page, shell === "moldura" ? ".page.dsh" : ".dsn", [
        "Nenhum projeto ativo.",
        "Não foi possível carregar.",
      ]);
      expect(await serious(page)).toEqual([]);

      // Every action by Tab, in the order the page reads (the order of the document).
      const order = await root.evaluate((el) => {
        const all = [
          ...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]'),
        ].filter((x) => !(x as HTMLButtonElement).disabled && x.getClientRects().length > 0);
        all.forEach((x, i) => x.setAttribute("data-tab", String(i)));
        return all.length;
      });
      expect(order).toBeGreaterThanOrEqual(15);
      await root.locator('[data-tab="0"]').focus();
      const seen: string[] = [];
      for (let i = 0; i < order; i++) {
        seen.push(await page.evaluate(() => document.activeElement?.getAttribute("data-tab") ?? "outside"));
        await page.keyboard.press("Tab");
      }
      expect(seen).toEqual(Array.from({ length: order }, (_, i) => String(i)));

      // Enter activates: the table switch, and the refresh (the header's button, or the scene menu's row).
      const sw = root
        .locator('.dsh-card[data-widget="status"]')
        .getByRole("switch", { name: "Ver como tabela" });
      await sw.focus();
      await page.keyboard.press("Enter");
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect(root.locator('.dsh-card[data-widget="status"] .dsh-values')).toBeVisible();
      if (shell === "moldura") {
        await root.locator(".dsh-refresh").focus();
        await page.keyboard.press("Enter");
      } else {
        await root.locator(".dsn-menu").focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menu")).toBeVisible();
        await page.getByRole("menuitem", { name: "Atualizar" }).focus();
        await page.keyboard.press("Enter");
      }
      await expect.poll(() => net.refreshes.length).toBe(1);
      expect(await serious(page)).toEqual([]);
    });

/* ---------------- C95: the gallery ---------------- */

for (const theme of THEMES)
  test(`C95 the gallery has a dashboards entry (a KPI with and without history, each widget kind, the header in four states, the highlights) with no serious axe violation (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const story = page.locator("#story-dashboards");
    await expect(story.locator(".dsh-kpi")).toHaveCount(2);
    await expect(story.locator(".dsh-kpi .dsh-spark")).toHaveCount(1);
    await expect(story.locator(".dsh-kpi .dsh-nohist")).toHaveText("No history yet");
    for (const kind of ["checklist", "list", "table", "bars", "agenda", "note"])
      await expect(story.locator(`.dsh-card[data-kind="${kind}"]`).first()).toBeVisible();
    await expect(story.locator(".dsh-highlights .dsh-pill")).toHaveCount(4);
    const states = story.locator(".dsh-head-l[data-state]");
    await expect(states).toHaveCount(4);
    await expect(states.nth(0).locator(".dsh-when")).toHaveText(/^Updated at \d\d:\d\d$/);
    await expect(states.nth(1).locator(".dsh-when")).toHaveText("Updating…");
    await expect(states.nth(2).locator(".dsh-when")).toHaveText(/^Out of date — updated at \d\d:\d\d$/);
    await expect(states.nth(3).locator(".dsh-when")).toHaveText("No data yet");
    expect(await serious(page, "#story-dashboards")).toEqual([]);
  });

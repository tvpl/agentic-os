/**
 * The notes view of the Second Brain in a real browser (.specs/features/cerebro-vista-notas, C29, C42, C46, C54;
 * design.md "Tela - Vista de notas"): "Grafo | Notas" in both shells and the graph's selection and camera on the way
 * back, the three columns and their widths, what a reload reopens, and "Exportar Markdown", "Abrir no editor do
 * sistema" and "Copiar caminho".
 *
 * The notes are real files of the isolated e2e home, written through the API with the page's own token, indexed, and
 * taken away after each test with the view's preferences, so the other specs keep the home they expect. The interface
 * is fed through the response of the preferences the app reads.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { E2E_HOME } from "./home.mjs";

type Shell = "moldura" | "nucleo";
const stamp = Date.now().toString(36);
const FOLDER = `e2e-notas-${stamp}`;
const MEMORY = path.join(E2E_HOME, "memory");

async function seed(page: Page, shell: Shell): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The shell is fed through every answer of the preferences: the view writes them (its tabs), and the home's own
  // shell would come back with the answer of a write.
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    await route.fulfill({ response, json: { ...(await response.json()), shell } });
  });
}

async function open(
  page: Page,
  shell: Shell,
  at: string,
  viewport = { width: 1440, height: 900 },
): Promise<void> {
  await seed(page, shell);
  await page.setViewportSize(viewport);
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
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

/** Three notes under memory/notes/<FOLDER>/, indexed. */
async function makeNotes(page: Page): Promise<Record<"alfa" | "beta" | "gama", string>> {
  const made: Record<string, string> = {};
  const bodies: Record<string, string> = {
    alfa: `# Alfa ${stamp}\n\nAcentuação, emoji 🧠 e uma tabela:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Seção\n\nVeja [[Beta ${stamp}]].\n`,
    beta: `# Beta ${stamp}\n\nA segunda nota.\n`,
    gama: `# Gama ${stamp}\n\nA terceira.\n`,
  };
  for (const key of ["alfa", "beta", "gama"] as const) {
    const res = await api(page, "POST", "/api/v1/memory/notes", {
      title: `${key[0]!.toUpperCase()}${key.slice(1)} ${stamp}`,
      folder: FOLDER,
      content: bodies[key],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    made[key] = res.json.path as string;
  }
  const indexed = await api(page, "POST", "/api/v1/memory/index");
  expect(indexed.status, JSON.stringify(indexed.json)).toBe(200);
  return made as Record<"alfa" | "beta" | "gama", string>;
}

test.afterEach(async ({ page }) => {
  fs.rmSync(path.join(MEMORY, "notes", FOLDER), { recursive: true, force: true });
  await api(page, "PUT", "/api/v1/ui-preferences", {
    brain: { notes: { root: null, home: {}, tabs: [], active: null, sort: "name", expanded: [] } },
  }).catch(() => undefined);
  await api(page, "POST", "/api/v1/memory/index").catch(() => undefined);
});

/** Open the folder of the notes and a note of it from the tree. */
async function openFromTree(page: Page, title: string): Promise<void> {
  const tree = page.getByRole("tree");
  const notes = tree.getByRole("treeitem", { name: /^notes/ });
  if ((await notes.getAttribute("aria-expanded")) !== "true") await notes.click();
  const folder = tree.getByRole("treeitem", { name: new RegExp(FOLDER) });
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  await tree.getByRole("treeitem", { name: new RegExp(title) }).click();
  await expect(page.getByRole("tab", { name: new RegExp(title) })).toHaveAttribute("aria-selected", "true");
}

const snapshot = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("mordomo.brainNavigation.v1") ?? "null"));

test("C29 Grafo | Notas in the frame: Notas at /brain/notes, and Grafo back with the selection and the camera", async ({
  page,
}) => {
  await open(page, "moldura", "/brain");
  const made = await makeNotes(page);
  const graph = await api(page, "GET", "/api/v1/memory/graph?maxNodes=3000");
  const node = (graph.json.nodes as Array<{ id: number; path: string }>).find((n) => n.path === made.alfa)!;
  expect(node).toBeTruthy();
  await page.goto(`/#/brain?sel=${node.id}`);
  const row = page.locator('[data-app="brain"] .brain-viewrow');
  await expect(row.getByRole("button")).toHaveText(["Graph", "Notes"]);
  for (const b of await row.getByRole("button").all())
    await expect(b).toHaveClass(/\bbtn\b.*\bsm\b|\bsm\b.*\bbtn\b/);
  await expect(row.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".brain2-preview")).toBeVisible();
  // Move the camera: zoom in twice.
  await page.keyboard.press("ControlOrMeta+Equal");
  await page.keyboard.press("ControlOrMeta+Equal");

  await row.getByRole("button", { name: "Notes" }).click();
  await expect(page).toHaveURL(/#\/brain\/notes$/);
  await expect(page.locator('[data-app="brain"] .notes-view')).toBeVisible();
  await expect(page.locator(".brain2")).toHaveCount(0);
  const left = await snapshot(page);
  expect(left.params).toBe(`sel=${node.id}`);
  expect(left.camera.k).not.toBe(1);

  await row.getByRole("button", { name: "Graph" }).click();
  await expect(page).toHaveURL(new RegExp(`#/brain\\?sel=${node.id}$`));
  await expect(page.locator(".brain2-preview")).toBeVisible();
  await row.getByRole("button", { name: "Notes" }).click();
  await expect(page.locator('[data-app="brain"] .notes-view')).toBeVisible();
  const again = await snapshot(page);
  expect(again.params).toBe(`sel=${node.id}`);
  expect(again.camera.k).toBeCloseTo(left.camera.k, 3);
  expect(again.camera.x).toBeCloseTo(left.camera.x, 1);
  expect(again.camera.y).toBeCloseTo(left.camera.y, 1);
});

test("C29 Grafo | Notas in the Núcleo: the same two buttons, and its Notas mode", async ({ page }) => {
  await open(page, "nucleo", "/brain");
  const row = page.locator(".bs > .brain-viewrow");
  await expect(row.getByRole("button")).toHaveText(["Graph", "Notes"]);
  await expect(row.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
  await row.getByRole("button", { name: "Notes" }).click();
  await expect(page).toHaveURL(/#\/brain\/notes$/);
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-scene", "brain");
  const notes = page.locator(".bs-notes");
  await expect(notes.locator(".notes-view")).toBeVisible();
  await expect(notes.locator(".brain-viewrow").getByRole("button", { name: "Notes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await notes.locator(".brain-viewrow").getByRole("button", { name: "Graph" }).click();
  await expect(page).toHaveURL(/#\/brain$/);
  await expect(page.locator(".bs > .brain-viewrow")).toBeVisible();
});

test("C42 three columns: the sidebar 260 px (200 to 400 by its edge), the reading area, the panel 280 px; no panel under 1 100 px; the title 24 px and the largest", async ({
  page,
}) => {
  await open(page, "moldura", "/brain/notes");
  await makeNotes(page);
  // The conversation column is the person's to fold; folded, the view has the frame's width.
  const close = page.getByRole("button", { name: "Close chat" });
  if (await close.isVisible()) await close.click();
  await page.reload();
  await expect(page.locator(".notes-view")).toBeVisible();
  await openFromTree(page, `Alfa ${stamp}`);
  const view = page.locator(".notes-view");
  expect((await view.boundingBox())!.width).toBeGreaterThanOrEqual(1100);
  const side = (await page.locator(".notes-sidebar").boundingBox())!;
  const main = (await page.locator(".notes-main").boundingBox())!;
  const panel = (await page.locator(".notes-panel").boundingBox())!;
  expect(Math.round(side.width)).toBe(260);
  expect(Math.round(panel.width)).toBe(280);
  expect(side.x).toBeLessThan(main.x);
  expect(main.x + main.width).toBeLessThanOrEqual(panel.x + 1);
  expect(main.width).toBeGreaterThan(300);

  // The edge stops at 200 and at 400.
  const edge = page.locator(".notes-edge");
  const at = (await edge.boundingBox())!;
  const y = at.y + at.height / 2;
  await page.mouse.move(at.x + at.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(side.x + 20, y, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await page.locator(".notes-sidebar").boundingBox())!.width)).toBe(200);
  const at2 = (await edge.boundingBox())!;
  await page.mouse.move(at2.x + at2.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(side.x + 900, y, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await page.locator(".notes-sidebar").boundingBox())!.width)).toBe(400);

  // The title is 24 px and no other text of the view is larger.
  const sizes = await page.evaluate(() => {
    const root = document.querySelector(".notes-view")!;
    const title = parseFloat(getComputedStyle(root.querySelector(".notes-note-title")!).fontSize);
    let max = 0;
    let at = "";
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const el = walk.currentNode.parentElement!;
      if (!walk.currentNode.textContent!.trim() || el.closest(".notes-note-title")) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size > max) [max, at] = [size, el.className || el.tagName];
    }
    return { title, max, at };
  });
  expect(sizes.title).toBe(24);
  expect(sizes.max, sizes.at).toBeLessThanOrEqual(24);

  // A useful width under 1 100 px: the panel is closed.
  await page.setViewportSize({ width: 1180, height: 900 });
  await expect.poll(async () => (await view.boundingBox())!.width).toBeLessThan(1100);
  await expect(page.locator(".notes-panel")).toHaveCount(0);

  // The sidebar folds (design.md: "recolhível"), and the reading area takes its room.
  const before = (await page.locator(".notes-main").boundingBox())!.width;
  await page.getByRole("button", { name: "Notes sidebar", exact: true }).click();
  await expect(page.locator(".notes-sidebar")).toBeHidden();
  expect((await page.locator(".notes-main").boundingBox())!.width).toBeGreaterThan(before + 200);
  await page.getByRole("button", { name: "Notes sidebar", exact: true }).click();
  await expect(page.locator(".notes-sidebar")).toBeVisible();
});

test("C46 a reload reopens the root, the tabs in their order, the active tab, the sort and the open folders; a deleted note says so with Fechar aba", async ({
  page,
}) => {
  await open(page, "moldura", "/brain/notes");
  const made = await makeNotes(page);
  await page.reload();
  await openFromTree(page, `Alfa ${stamp}`);
  await openFromTree(page, `Beta ${stamp}`);
  await openFromTree(page, `Gama ${stamp}`);
  await page.getByRole("tab", { name: new RegExp(`Beta ${stamp}`) }).click();
  await page.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Updated" }).click();
  // the preferences are written a moment after the last change
  await expect
    .poll(async () => (await api(page, "GET", "/api/v1/ui-preferences")).json.brain?.notes?.sort)
    .toBe("updated");
  const stored = (await api(page, "GET", "/api/v1/ui-preferences")).json.brain.notes;
  expect(stored.tabs).toEqual([made.alfa, made.beta, made.gama]);
  expect(stored.active).toBe(made.beta);

  fs.rmSync(made.gama);
  await page.reload();
  await expect(page.locator(".notes-view")).toBeVisible();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole("tab", { name: new RegExp(`Beta ${stamp}`) })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("article", { name: `Beta ${stamp}` })).toBeVisible();
  const tree = page.getByRole("tree");
  await expect(tree.getByRole("treeitem", { name: /^notes/ })).toHaveAttribute("aria-expanded", "true");
  await expect(tree.getByRole("treeitem", { name: new RegExp(FOLDER) })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.getByRole("button", { name: "Sort" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Updated" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".notes-root .notes-root-path")).toHaveText(MEMORY);

  await tabs.nth(2).click();
  await expect(page.getByText("This note no longer exists.")).toBeVisible();
  await page.getByRole("button", { name: "Close tab" }).click();
  await expect(tabs).toHaveCount(2);
});

test("C54 Exportar Markdown downloads the note's bytes; Abrir no editor do sistema and Copiar caminho", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "moldura", "/brain/notes");
  const made = await makeNotes(page);
  await page.reload();
  await openFromTree(page, `Alfa ${stamp}`);
  const more = page.getByRole("button", { name: "More" });

  await more.click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(path.basename(made.alfa));
  const saved = await file.path();
  expect(Buffer.compare(fs.readFileSync(saved!), fs.readFileSync(made.alfa))).toBe(0);

  let opened: unknown = null;
  await page.route("**/api/v1/memory/open", async (route) => {
    opened = route.request().postDataJSON();
    await route.fulfill({ json: { opened: made.alfa } });
  });
  await more.click();
  await page.getByRole("menuitem", { name: "Open in system editor" }).click();
  await expect.poll(() => opened).toEqual({ p: made.alfa });

  await more.click();
  await page.getByRole("menuitem", { name: "Copy path" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(made.alfa);
});

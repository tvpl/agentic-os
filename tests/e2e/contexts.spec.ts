/**
 * Work contexts in a real browser (.specs/features/cerebro-contextos, C31, C32, C40; design.md): where the selector
 * sits in each shell and what its menu lists, what the screens send once a context is chosen, and axe, the sizes and
 * the state marks over the selector, the dialog and the settings section in both themes and both shells.
 *
 * The contexts and the active one are real state of the isolated e2e home, made through the API with the page's own
 * token and taken away after each test, so the other specs keep the whole brain. The interface and the theme are fed
 * through the responses the app reads.
 */
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { REPO_ROOT } from "./home.mjs";

type Theme = "dark" | "light";
type Shell = "moldura" | "nucleo";
const THEMES: Theme[] = ["dark", "light"];
const SHELLS: Shell[] = ["moldura", "nucleo"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DOCS = path.join(REPO_ROOT, "docs");
const stamp = Date.now().toString(36);

async function seed(page: Page, shell: Shell, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), shell } });
  });
  await page.route("**/api/v1/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), theme } });
  });
}

async function open(page: Page, shell: Shell, theme: Theme, at: string): Promise<void> {
  await seed(page, shell, theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#${at}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
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

/** Two contexts of the e2e home (on its indexed docs/ folder), made for one test and taken away after it. */
async function makeContexts(
  page: Page,
): Promise<{ first: { id: string; name: string }; second: { id: string; name: string } }> {
  const first = await api(page, "POST", "/api/v1/contexts", { name: `Docs ${stamp}`, paths: [DOCS] });
  expect(first.status, JSON.stringify(first.json)).toBe(201);
  const second = await api(page, "POST", "/api/v1/contexts", {
    name: `Internal ${stamp}`,
    paths: [path.join(DOCS, "internal")],
  });
  expect(second.status, JSON.stringify(second.json)).toBe(201);
  return { first: first.json, second: second.json };
}
async function cleanUp(page: Page): Promise<void> {
  await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: null });
  const list = await api(page, "GET", "/api/v1/contexts");
  for (const c of (list.json?.contexts ?? []) as Array<{ id: string }>)
    await api(page, "DELETE", `/api/v1/contexts/${c.id}`);
}

const selector = (page: Page) => page.locator("button.ctx-sel");

async function openSelector(page: Page) {
  await selector(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.afterEach(async ({ page }) => {
  if (page.url().startsWith("http")) await cleanUp(page);
});

for (const shell of SHELLS) {
  test(`C31 the selector of the ${shell}: in its place, the whole brain first, the contexts in order with their counts, the active one checked, and the two actions`, async ({
    page,
  }) => {
    await open(page, shell, "dark", "/");
    await cleanUp(page);
    const { first, second } = await makeContexts(page);
    await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: second.id });
    await page.reload();
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    await expect(selector(page)).toContainText(second.name);

    const box = (await selector(page).boundingBox())!;
    if (shell === "moldura") {
      // Below the brand, above the first place of the main group.
      const brand = (await page.locator(".mold-brand").boundingBox())!;
      const firstPlace = (await page.locator(".mold-nav .mold-link").first().boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(firstPlace.y + 1);
      await expect(selector(page)).toContainText(/\d+ files/);
    } else {
      // Left of the voice line, at its height.
      const line = (await page.locator(".nu-voice .cons-row").boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(line.x + 1);
      expect(box.y + box.height).toBeGreaterThan(line.y);
    }

    await openSelector(page);
    const items = page.locator('[role="menu"] [role^="menuitem"]');
    const texts = await items.allTextContents();
    expect(texts[0]).toBe("Whole brain");
    expect(texts[1]).toContain(first.name);
    expect(texts[1]).toMatch(/\d+ files/);
    expect(texts[2]).toContain(second.name);
    expect(texts.slice(-2)).toEqual(["New context…", "Manage contexts"]);
    await expect(page.getByRole("menuitemcheckbox", { name: new RegExp(second.name) })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("menuitemcheckbox", { name: "Whole brain" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByRole("menu").getByRole("separator")).toHaveCount(2);
  });
}

test("C32 a context chosen is written by PUT /api/ui-preferences, and the brain, the Núcleo scene, the palette's Files and the chat send it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const seen: Array<{ method: string; url: string; body: string | null }> = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/"))
      seen.push({ method: req.method(), url: req.url(), body: req.postData() });
  });
  await open(page, "moldura", "dark", "/brain");
  await cleanUp(page);
  const { first } = await makeContexts(page);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);

  // Choosing writes the preference.
  await openSelector(page);
  await page.getByRole("menuitemcheckbox", { name: new RegExp(first.name) }).click();
  await expect
    .poll(() =>
      seen
        .filter((r) => r.method === "PUT" && r.url.includes("/ui-preferences"))
        .map((r) => r.body ?? "")
        .join("\n"),
    )
    .toContain(`"activeContext":"${first.id}"`);
  const mark = () => seen.length;
  const after = (from: number, test: (r: (typeof seen)[number]) => boolean) => seen.slice(from).some(test);

  // The Second Brain's graph and its search.
  let from = mark();
  await expect
    .poll(() => after(0, (r) => /memory\/graph\?/.test(r.url) && r.url.includes(`context=${first.id}`)))
    .toBe(true);
  from = mark();
  await page.locator(".brain2 input.input").first().fill("security");
  await expect
    .poll(() => after(from, (r) => /memory\/search\?/.test(r.url) && r.url.includes(`context=${first.id}`)))
    .toBe(true);

  // The palette's Files section.
  from = mark();
  await page.keyboard.press("Escape");
  await page
    .locator("main")
    .click({ position: { x: 5, y: 5 } })
    .catch(() => undefined);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox")).toBeVisible();
  await page.getByRole("combobox").fill("security");
  await expect
    .poll(() => after(from, (r) => /memory\/search\?/.test(r.url) && r.url.includes(`context=${first.id}`)))
    .toBe(true);
  await page.keyboard.press("Escape");

  // The chat: a new run carries contextId (the chip says which).
  from = mark();
  const chat = page.locator(".mold-chat");
  if (!(await chat.isVisible()))
    await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(chat.locator(".ctx-chip")).toContainText(`In this context: ${first.name}`);
  const field = chat.getByRole("textbox").first();
  await field.fill(`resuma ${stamp}`);
  await field.press("Enter");
  await expect
    .poll(
      () => seen.slice(from).find((r) => r.method === "POST" && /\/api\/v1\/runs$/.test(r.url))?.body ?? "",
    )
    .toContain(`"contextId":"${first.id}"`);

  // The Núcleo brain scene asks its graph in the context too.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  from = mark();
  await seed(page, "nucleo", "dark");
  await page.goto("/#/brain");
  await page.reload();
  await expect(page.locator(".nu-shell")).toBeVisible();
  await expect
    .poll(
      () =>
        after(
          from,
          (r) => /memory\/graph\?.*maxNodes=3000/.test(r.url) && r.url.includes(`context=${first.id}`),
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
});

/** Every element with text of its own under `scope`: what it says and the size it is drawn at. */
async function sizesUnder(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const out: Array<{ text: string; px: number; cls: string }> = [];
    for (const root of document.querySelectorAll(sel))
      for (const el of [root, ...root.querySelectorAll("*")] as HTMLElement[]) {
        if (el.closest("svg, [aria-hidden='true']")) continue;
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        const rect = el.getBoundingClientRect();
        if (!own || !rect.width || !rect.height) continue;
        out.push({
          text: own.slice(0, 50),
          px: parseFloat(getComputedStyle(el).fontSize),
          cls: String(el.className),
        });
      }
    return out;
  }, scope);
}
async function serious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}
/** Nothing under 12px, and the lines that are sentences (not labels) at 13px. */
async function sized(page: Page, scope: string, prose: string[] = []) {
  const sizes = await sizesUnder(page, scope);
  expect(sizes.length, `${scope} has text`).toBeGreaterThan(0);
  expect(sizes.filter((s) => s.px < 12)).toEqual([]);
  for (const line of prose) {
    const found = sizes.filter((s) => s.text.startsWith(line));
    expect(found.length, `${line} on screen`).toBeGreaterThan(0);
    for (const s of found) expect(s.px, line).toBeGreaterThanOrEqual(13);
  }
}

for (const theme of THEMES) {
  for (const shell of SHELLS) {
    test(`C40 the selector, the dialog and the settings section of the ${shell} pass axe, read at 12px or more (13px for sentences) and mark states with an icon (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await open(page, shell, theme, "/");
      await cleanUp(page);

      // The selector with no context: the line that invites to make one.
      await openSelector(page);
      expect(await serious(page)).toEqual([]);
      await sized(page, ".ui-menu", ["Create a context to focus the brain on a project."]);
      await sized(page, "button.ctx-sel");

      // The dialog, with a folder outside the indexed ones (the state is an icon and a text).
      await page.getByRole("menuitem", { name: "New context…" }).click();
      const dialog = page.getByRole("dialog", { name: "New context" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("textbox", { name: "Name" }).fill("Axe");
      await dialog.getByRole("textbox", { name: "or type a path" }).fill("/nowhere/at/all");
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      const warn = dialog.locator(".ctx-folder-warn");
      await expect(warn).toContainText("This folder is not indexed.");
      await expect(warn.locator("svg")).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: "Index and create" })).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await sized(page, ".ctx-dialog", ["This folder is not indexed."]);
      const width = (await dialog.boundingBox())!.width;
      expect(width).toBeLessThanOrEqual(560);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);

      // The settings section with a context, its path states, and the chip in the composer.
      const { first } = await makeContexts(page);
      await api(page, "PUT", "/api/v1/ui-preferences", { activeContext: first.id });
      await page.goto("/#/settings?tab=memory");
      await page.reload();
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      const section = page.locator(".ctx-settings");
      await expect(section).toContainText(first.name);
      const state = section.locator(".ctx-state").first();
      await expect(state).toHaveText("Ok");
      await expect(state.locator("svg")).toHaveCount(1);
      await section.scrollIntoViewIfNeeded();
      expect(await serious(page)).toEqual([]);
      await sized(page, ".ctx-settings");
      await expect(selector(page)).toContainText(first.name);
      await sized(page, "button.ctx-sel");
    });
  }
}

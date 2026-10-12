/**
 * The note editor in a real browser (.specs/features/cerebro-v2, C23, design.md "Tela - Editor de nota"): the new-note
 * dialog from the `N` key, a save, the conflict banner, axe in both themes, and the sizes the design system fixes
 * (prose 13px, nothing under 12px). The interface and the theme are fed through the responses the app reads, so no
 * test writes shared state other than the notes it makes in the isolated e2e home.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Theme = "dark" | "light";
const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const stamp = Date.now().toString(36);

async function openBrain(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), shell: "moldura" } });
  });
  await page.route("**/api/v1/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), theme } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/brain");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

/** Make a note through the keyboard: `N`, a title, Create. Returns once the editor shows it. */
async function newNote(page: Page, title: string): Promise<void> {
  await page
    .locator("main")
    .click({ position: { x: 5, y: 5 } })
    .catch(() => undefined);
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New note" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Title" }).fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog", { name: "Edit note" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeFocused();
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
        headers: { "content-type": "application/json", "x-mordomo-token": token },
        ...(b ? { body: JSON.stringify(b) } : {}),
      });
      return { status: res.status, json: await res.json() };
    },
    [method, url, body],
  );
}

async function serious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
}

for (const theme of THEMES) {
  test(`C23 the editor passes axe, sets its prose at 13px and keeps everything at 12px or more (${theme})`, async ({
    page,
  }, info) => {
    await openBrain(page, theme);
    await newNote(page, `Axe ${theme} ${stamp}`);
    await page
      .getByRole("textbox", { name: "Note text" })
      .fill(
        "# Axe\n\numa frase de texto corrido que a nota guarda, com mais de sessenta caracteres no total\n",
      );
    const dialog = page.getByRole("dialog", { name: "Edit note" });
    await expect(dialog.getByRole("status")).toContainText("Unsaved changes");
    await page.waitForTimeout(300);
    expect(await serious(page)).toEqual([]);

    const sizes = await dialog.evaluate((root) => {
      const out: Array<{ tag: string; text: string; size: number }> = [];
      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        const own = [...el.childNodes].filter(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
        );
        if (own.length === 0) continue;
        out.push({
          tag: el.tagName,
          text: (el.textContent ?? "").trim().slice(0, 30),
          size: parseFloat(getComputedStyle(el).fontSize),
        });
      }
      const field = root.querySelector("textarea")!;
      out.push({ tag: "TEXTAREA", text: "field", size: parseFloat(getComputedStyle(field).fontSize) });
      return out;
    });
    expect(sizes.filter((s) => s.size < 12)).toEqual([]);
    expect(sizes.find((s) => s.tag === "TEXTAREA")!.size).toBe(13);
    if (process.env.NOTE_EDITOR_SHOTS)
      await page.screenshot({ path: `${process.env.NOTE_EDITOR_SHOTS}/editor-${theme}.png` });
    void info;
  });
}

test("C19 C21 a save, then a note that changed elsewhere: the banner keeps the text and the copy keeps it too", async ({
  page,
}) => {
  await openBrain(page, "dark");
  const title = `Conflito ${stamp}`;
  await newNote(page, title);
  const dialog = page.getByRole("dialog", { name: "Edit note" });
  const field = dialog.getByRole("textbox", { name: "Note text" });
  await expect(dialog.getByRole("status")).toContainText("Saved");
  await field.fill(`# ${title}\n\nprimeira versão\n`);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Saved");

  // somebody else saves the same note, through the API, from the version the page does not know
  const path = await dialog.locator(".note-editor-path").innerText();
  const read = await api(page, "GET", `/api/memory/note?p=${encodeURIComponent(path)}`);
  expect(read.status).toBe(200);
  const other = await api(page, "PUT", "/api/memory/notes", {
    path,
    content: `# ${title}\n\nda outra pessoa\n`,
    baseVersion: read.json.version,
  });
  expect(other.status).toBe(200);

  await field.fill(`# ${title}\n\nminha segunda versão\n`);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const banner = dialog.getByRole("alert");
  await expect(banner).toContainText("This note changed on disk after you opened it.");
  await expect(dialog.getByRole("status")).toContainText("Conflict");
  await expect(field).toHaveValue(`# ${title}\n\nminha segunda versão\n`);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  if (process.env.NOTE_EDITOR_SHOTS)
    await page.screenshot({ path: `${process.env.NOTE_EDITOR_SHOTS}/conflict.png` });

  await banner.getByRole("button", { name: "Save as a copy" }).click();
  await expect(dialog.locator(".note-editor-path")).toContainText("-copy");
  await expect(field).toHaveValue(`# ${title}\n\nminha segunda versão\n`);
  const original = await api(page, "GET", `/api/memory/note?p=${encodeURIComponent(path)}`);
  expect(original.json.content).toBe(`# ${title}\n\nda outra pessoa\n`);
});

test("C20 closing with unsaved changes asks first, with Keep editing focused", async ({ page }) => {
  await openBrain(page, "dark");
  await newNote(page, `Descarte ${stamp}`);
  const dialog = page.getByRole("dialog", { name: "Edit note" });
  await dialog.getByRole("textbox", { name: "Note text" }).fill("mudou");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Note text" })).toHaveValue("mudou");
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "Discard unsaved changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

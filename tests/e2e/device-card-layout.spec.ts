/**
 * Settings › Security › Remote access, the device list and the permission group, measured in a real browser
 * (.specs/features/escopos-dispositivo, C44 and C45): in both shells, both languages and seven widths, the name of a
 * device keeps a readable width, nothing in a row lies over anything else, nothing leaves the card, and a box that
 * another permission requires is drawn and worded as locked. The jsdom checks of the card cannot see any of this.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const headers = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN!, "content-type": "application/json" });
const WIDTHS = [1440, 1100, 900, 800, 700, 500, 390];
const NAMES = ["Pixel 8 Pro do escritório principal", "iPad"];

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, "the element has a box").not.toBeNull();
  return b!;
}

const ids: string[] = [];

// The page is loaded again at every width: the service worker would answer the later loads without the owner's token.
test.use({ serviceWorkers: "block" });

test.beforeAll(async ({ request }) => {
  // A worker that restarts runs this again: start from no devices.
  const listed = (await (await request.get("/api/devices", { headers: headers() })).json()) as {
    devices: Array<{ id: string; revokedAt: number | null }>;
  };
  for (const d of listed.devices)
    if (d.revokedAt === null) await request.delete(`/api/devices/${d.id}`, { headers: headers() });
  const put = await request.put("/api/settings", {
    headers: headers(),
    data: { remote: { enabled: true, allowedHosts: [], deviceTtlDays: 30 } },
  });
  expect(put.ok()).toBe(true);
  for (const name of NAMES) {
    const start = await request.post("/api/pair/start", { headers: headers(), data: { name } });
    const { code } = (await start.json()) as { code: string };
    const claim = await request.post("/api/pair/claim", { data: { code, name } });
    expect(claim.ok()).toBe(true);
    ids.push(((await claim.json()) as { device: { id: string } }).device.id);
  }
});

test.afterAll(async ({ request }) => {
  for (const id of ids) await request.delete(`/api/devices/${id}`, { headers: headers() });
  await request.put("/api/settings", {
    headers: headers(),
    data: { remote: { enabled: false, allowedHosts: [], deviceTtlDays: 30 } },
  });
  await request.put("/api/ui-preferences", { headers: headers(), data: { shell: "nucleo" } });
});

async function setShell(request: APIRequestContext, shell: "moldura" | "nucleo"): Promise<void> {
  const res = await request.put("/api/ui-preferences", { headers: headers(), data: { shell } });
  expect(res.ok()).toBe(true);
}

async function openCard(page: Page, shell: "moldura" | "nucleo", language: "en" | "pt-BR", width: number) {
  // A fresh load every time (the query makes it a new document): a hash-only navigation would keep the editor a
  // previous width opened.
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/v1/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), language } });
  });
  await page.goto(`/?width=${width}#/settings?tab=security`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(shell === "moldura" ? ".mold" : ".nu-shell")).toBeVisible();
  const panel = page.locator("#settings-tabs-panel-security");
  await expect(panel).toBeVisible();
  const list = panel.locator(".device-list");
  await expect(list.locator("li")).toHaveCount(2);
  await list.scrollIntoViewIfNeeded();
  return { panel, list };
}

for (const shell of ["moldura", "nucleo"] as const) {
  for (const language of ["en", "pt-BR"] as const) {
    test(`C44 the device list is readable and overlaps nothing: ${shell} ${language}`, async ({
      page,
      request,
    }) => {
      await setShell(request, shell);
      for (const width of WIDTHS) {
        const label = `${shell} ${language} ${width}`;
        const { list } = await openCard(page, shell, language, width);
        const card = await box(list.locator("xpath=ancestor::div[contains(@class,'card')][1]"));
        for (const [i, li] of (await list.locator("li").all()).entries()) {
          const row = await box(li);
          const main = await box(li.locator(".device-main"));
          const name = await box(li.locator(".device-main strong"));
          const meta = await box(li.locator(".device-main .meta"));
          const actions = await box(li.locator(".row-actions"));
          const scopes = await box(li.locator(".device-scopes"));
          const parts = { name, meta, actions, scopes };
          // A readable name: a third of the row or 96 px, whichever is less, and the text is not cut.
          expect(name.width, `${label} row ${i} name width`).toBeGreaterThanOrEqual(
            Math.min(96, row.width / 3),
          );
          const cut = await li
            .locator(".device-main strong")
            .evaluate((el) => el.scrollWidth - el.clientWidth);
          expect(cut, `${label} row ${i} name is cut`).toBeLessThanOrEqual(1);
          // Nothing lies over anything else in the row.
          const keys = Object.keys(parts) as Array<keyof typeof parts>;
          for (const a of keys) {
            for (const b of keys) {
              if (a >= b) continue;
              expect(overlap(parts[a], parts[b]), `${label} row ${i}: ${a} over ${b}`).toBeLessThanOrEqual(1);
            }
            // ...and nothing leaves the row or the card.
            expect(parts[a].x, `${label} row ${i} ${a} left`).toBeGreaterThanOrEqual(card.x - 1);
            expect(parts[a].x + parts[a].width, `${label} row ${i} ${a} right`).toBeLessThanOrEqual(
              card.x + card.width + 1,
            );
          }
          expect(main.x + main.width, `${label} row ${i} main right`).toBeLessThanOrEqual(
            row.x + row.width + 1,
          );
        }
        const scroll = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(scroll, `${label} page scrolls sideways`).toBeLessThanOrEqual(2);
      }
    });

    test(`C45 the permission group: a locked box reads and feels locked: ${shell} ${language}`, async ({
      page,
      request,
    }) => {
      await setShell(request, shell);
      for (const width of [1440, 800, 390]) {
        const label = `${shell} ${language} ${width}`;
        const { panel, list } = await openCard(page, shell, language, width);
        // The editor of the second device: its group draws the closure.
        await list
          .locator("li")
          .nth(0)
          .getByRole("button", { name: /^(Permissions|Permissões)$/ })
          .click();
        const group = list.locator(".device-editor fieldset");
        await expect(group).toBeVisible();
        await group.scrollIntoViewIfNeeded();
        const rows = await group.locator("label.check").all();
        expect(rows, label).toHaveLength(4);
        const boxes: Box[] = [];
        for (const row of rows) boxes.push(await box(row));
        for (const [i, a] of boxes.entries()) {
          for (const [j, b] of boxes.entries()) {
            if (i < j) expect(overlap(a, b), `${label} label ${i} over ${j}`).toBeLessThanOrEqual(1);
          }
        }
        // The default set: monitor and content are required by run.
        const locked = group.locator("input:disabled");
        await expect(locked).toHaveCount(2);
        for (const input of await locked.all()) {
          await expect(input, label).toBeChecked();
          const style = await input.evaluate((el) => {
            const s = getComputedStyle(el);
            return { cursor: s.cursor, outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
          });
          expect(style.cursor, `${label} cursor`).toBe("not-allowed");
          expect(style.outlineStyle, `${label} dashed ring`).toBe("dashed");
          expect(parseFloat(style.outlineWidth), `${label} ring width`).toBeGreaterThan(0);
        }
        const words = group.locator(".scope-locked");
        await expect(words).toHaveCount(2);
        await expect(words.first()).toHaveText(
          language === "en" ? "required by another permission" : "exigida por outra permissão",
        );
        await expect(words.first()).toBeVisible();
        // The free box answers; the locked one does not.
        const free = group.locator("input:enabled");
        await expect(free).toHaveCount(2);
        void panel;
      }
    });
  }
}

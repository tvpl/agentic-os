/**
 * The app frame in a real browser (.specs/features/moldura-app, C2 C9 C13
 * C20 C50-C52): where the regions sit, how a narrow window folds them and
 * keeps focus in a drawer, how Today reflows, that every preset reads in both
 * themes, and that the interface choice survives a reload. The suite's home
 * is seeded with the Núcleo (home.mjs); each test here switches it to the
 * frame through the API and puts the Núcleo back after.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { E2E_HOME } from "./home.mjs";

type Box = { x: number; y: number; width: number; height: number };
const headers = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN!, "content-type": "application/json" });

async function setShell(request: APIRequestContext, shell: "moldura" | "nucleo"): Promise<void> {
  const res = await request.put("/api/ui-preferences", { headers: headers(), data: { shell } });
  expect(res.ok(), `PUT /api/ui-preferences → ${res.status()}`).toBe(true);
}

async function openFrame(page: Page, path = "/", viewport = { width: 1440, height: 900 }): Promise<Locator> {
  await page.setViewportSize(viewport);
  await page.goto(`/#${path}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator('.os-root[data-shell="moldura"]')).toBeAttached();
  const frame = page.locator(".mold");
  await expect(frame).toBeVisible();
  return frame;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, "the element has a box").not.toBeNull();
  return b!;
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

test.beforeEach(async ({ request }) => {
  await setShell(request, "moldura");
});
test.afterEach(async ({ request }) => {
  await setShell(request, "nucleo");
});

test("C2 the regions sit where the design draws them", async ({ page }) => {
  const frame = await openFrame(page);
  await expect(page.locator(".nu-shell")).toHaveCount(0);
  const nav = await box(frame.locator(":scope > nav"));
  const header = await box(frame.locator("header.mold-top"));
  const main = await box(frame.locator("main.mold-main"));
  const aside = await box(frame.locator(":scope > aside"));

  // Sidebar left of the content, conversation right of it.
  expect(nav.x + nav.width).toBeLessThanOrEqual(main.x + 1);
  expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
  // The top bar above the content, in the same column.
  expect(header.y + header.height).toBeLessThanOrEqual(main.y + 1);
  expect(Math.abs(header.x - main.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(header.width - main.width)).toBeLessThanOrEqual(1);
  // Sidebar and conversation run the full height of the window.
  for (const side of [nav, aside]) {
    expect(Math.abs(side.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(side.height - 900)).toBeLessThanOrEqual(1);
  }
  // The top bar's height is defined on the shell root, where the health banner reads it too.
  const topH = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".os-root")!).getPropertyValue("--mold-top-h").trim(),
  );
  expect(topH).toBe("56px");
});

test("C9 a narrow window collapses the sidebar and drawers the chat", async ({ page }) => {
  const frame = await openFrame(page, "/", { width: 800, height: 900 });
  const nav = frame.locator(":scope > nav");
  await expect(frame).toHaveAttribute("data-collapsed", "");
  // Icons only: no label is drawn, each link keeps its name.
  await expect(nav.locator(".mold-link-t")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Runs" })).toBeVisible();
  expect((await box(nav)).width).toBeLessThan(100);

  const aside = frame.locator(":scope > aside");
  await expect(aside).toBeHidden();
  const toggle = page.getByRole("button", { name: "Chat", exact: true });
  await toggle.focus();
  await toggle.click();
  await expect(aside).toBeVisible();
  await expect(aside).toHaveAttribute("role", "dialog");
  const drawer = await box(aside);
  const main = await box(frame.locator("main.mold-main"));
  expect(overlap(drawer, main)).toBeGreaterThan(0);
  // Over the content, not beside it: the point they share belongs to the drawer.
  const x = Math.max(drawer.x, main.x) + 10;
  const y = Math.max(drawer.y, main.y) + 120;
  const onTop = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px!, py!);
      return Boolean(el?.closest("aside.mold-chat"));
    },
    [x, y],
  );
  expect(onTop).toBe(true);

  // Focus is in the drawer and Tab never leaves it (the rest of the frame is inert).
  await expect(aside.locator("textarea")).toBeFocused();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("aside.mold-chat")))).toBe(true);
  }
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("aside.mold-chat")))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(aside).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("C50 the narrow sidebar unfolds over the content instead of pushing it", async ({ page }) => {
  const frame = await openFrame(page, "/", { width: 800, height: 900 });
  const nav = frame.locator(":scope > nav");
  const main = frame.locator("main.mold-main");
  const folded = { nav: await box(nav), main: await box(main) };
  const toggle = nav.getByRole("button", { name: "Sidebar" });
  await toggle.click();
  await expect(nav.getByRole("link", { name: "Runs" })).toContainText("Runs");
  const open = { nav: await box(nav), main: await box(main) };
  expect(open.nav.width).toBeGreaterThan(200);
  // The content did not move or shrink: the sidebar lies over it.
  expect(open.main.x).toBe(folded.main.x);
  expect(open.main.width).toBe(folded.main.width);
  expect(overlap(open.nav, open.main)).toBeGreaterThan(0);
  const top = await page.evaluate(
    ([px, py]) => Boolean(document.elementFromPoint(px!, py!)?.closest("nav.mold-nav")),
    [open.nav.x + 120, open.nav.y + 300],
  );
  expect(top).toBe(true);

  await page.keyboard.press("Escape");
  await expect(nav.locator(".mold-link-t")).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test("C51 the top bar fits and keeps its controls at phone widths", async ({ page }) => {
  for (const width of [360, 600, 800]) {
    const frame = await openFrame(page, "/generations", { width, height: 800 });
    const bar = frame.locator("header.mold-top");
    const fits = await bar.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, `top bar at ${width}px`).toBe(true);
    for (const name of ["Search or run a command…", "Notifications", "Chat"]) {
      const b = await box(bar.getByRole("button", { name: new RegExp(`^${name}`) }));
      expect(b.width, `${name} at ${width}px`).toBeGreaterThanOrEqual(30);
    }
    const page_ = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(page_, `no horizontal page scroll at ${width}px`).toBe(true);
  }
});

test("C13 today is two columns when its column is wide, one when it is narrow", async ({ page }) => {
  const columns = async (frame: Locator) => {
    const cards = frame.locator("main section.mold-card");
    await expect(cards).toHaveCount(6);
    const first = await box(cards.nth(0));
    const second = await box(cards.nth(1));
    return Math.abs(first.y - second.y) <= 1 && second.x > first.x + first.width - 1 ? 2 : 1;
  };
  // 1440: the column is 808 px.
  let frame = await openFrame(page, "/", { width: 1440, height: 900 });
  expect(await columns(frame)).toBe(2);

  // 1000: 368 px, one column, each card below the last, in the same order.
  frame = await openFrame(page, "/", { width: 1000, height: 900 });
  expect(await columns(frame)).toBe(1);
  const cards = frame.locator("main section.mold-card");
  let previous = await box(cards.nth(0));
  for (let i = 1; i < 6; i++) {
    const next = await box(cards.nth(i));
    expect(next.y, `card ${i + 1} below card ${i}`).toBeGreaterThanOrEqual(previous.y + previous.height - 1);
    expect(Math.abs(next.x - previous.x)).toBeLessThanOrEqual(1);
    previous = next;
  }

  // 1100 with the sidebar and the chat open leaves the column ~450 px: one column. Put the chat
  // away and it is ~870 px: two.
  frame = await openFrame(page, "/", { width: 1100, height: 900 });
  expect(await columns(frame)).toBe(1);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(frame.locator(":scope > aside")).toBeHidden();
  expect(await columns(frame)).toBe(2);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
});

test("C52 every preset in light and dark: the frame draws, text reads, nothing is reported", async ({
  page,
}, info) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  const frame = await openFrame(page, "/", { width: 1440, height: 900 });
  const presets = ["hud-orange", "jarvis", "forest", "ocean", "mono"];
  for (const theme of ["dark", "light"]) {
    for (const preset of presets) {
      await page.evaluate(
        ([t, p]) => {
          document.documentElement.dataset.theme = t;
          document.documentElement.dataset.preset = p;
        },
        [theme, preset],
      );
      const ratios = await frame.evaluate((root) => {
        const rgb = (v: string) => (v.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        const ratio = (fg: string, bg: string) => {
          const [a, b] = [lum(rgb(fg)), lum(rgb(bg))];
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        // The nearest opaque background up the tree.
        const ground = (el: Element | null): string => {
          for (let n = el; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (rgb(c)[3] === undefined || rgb(c)[3] === 1) return c;
          }
          return "rgb(0, 0, 0)";
        };
        const pick = (sel: string) => root.querySelector(sel)!;
        const read = (sel: string) => ratio(getComputedStyle(pick(sel)).color, ground(pick(sel)));
        return {
          link: read(".mold-link:not([aria-current])"),
          current: read('.mold-link[aria-current="page"]'),
          title: read(".mold-title"),
          cardTitle: read(".mold-card-t"),
          chat: read(".mold-chat-t"),
        };
      });
      for (const [what, value] of Object.entries(ratios))
        expect(value, `${what} on ${preset}/${theme}`).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: info.outputPath(`frame-${theme}.png`) });
  }
  expect(problems).toEqual([]);
});

test("C20 the interface choice survives a reload", async ({ page }) => {
  await openFrame(page, "/settings?tab=theme");
  const choose = (name: string) =>
    page.getByRole("radiogroup", { name: "Interface" }).getByRole("radio", { name, exact: true }).click();

  await choose("Immersive Núcleo");
  await expect(page.locator(".nu-shell")).toBeVisible();
  await expect(page.locator('.os-root[data-shell="moldura"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(".nu-shell")).toBeVisible();
  await expect(page.locator('.os-root[data-shell="moldura"]')).toHaveCount(0);

  await choose("App frame");
  await expect(page.locator(".mold")).toBeVisible();
  await expect(page.locator(".nu-shell")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(".mold")).toBeVisible();
  await expect(page.locator(".nu-shell")).toHaveCount(0);
});

test("C53 a home whose preferences predate the frame opens in the Núcleo, and a new one in the frame", async ({
  page,
  request,
}) => {
  const file = path.join(E2E_HOME, "config", "ui-preferences.json");
  const original = fs.readFileSync(file, "utf8");
  try {
    // What the last release wrote: a file with no `shell` key.
    fs.writeFileSync(file, JSON.stringify({ version: 1, themePreset: "jarvis" }, null, 2));
    const res = await request.get("/api/ui-preferences", { headers: headers() });
    expect((await res.json()).shell).toBe("nucleo");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/");
    await expect(page.locator(".nu-shell")).toBeVisible();
    await expect(page.locator(".mold")).toHaveCount(0);

    // No file at all is a new install.
    fs.rmSync(file);
    const fresh = await request.get("/api/ui-preferences", { headers: headers() });
    expect((await fresh.json()).shell).toBe("moldura");
  } finally {
    fs.writeFileSync(file, original);
  }
});

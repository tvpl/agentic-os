/**
 * Accessibility and design-system gates in a real browser
 * (.specs/features/design-system, C4 C7 C8 C9): axe (WCAG 2 A and AA) over the
 * main screens of both interfaces in both themes, plus two computed-style
 * checks that the design rules hold on screen (badge size, light-theme tokens).
 *
 * The interface and the theme are fed to the app through the two responses it
 * reads them from (UI preferences, meta), so no test writes shared server
 * state. Motion is reduced so no screen is measured mid-transition.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type Theme = "dark" | "light";
type Shell = "moldura" | "nucleo";

const THEMES: Theme[] = ["dark", "light"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Serve the app a given interface and theme without touching the server's saved state. */
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

async function open(
  page: Page,
  shell: Shell,
  theme: Theme,
  path: string,
  before: (page: Page) => Promise<void> = async () => undefined,
): Promise<void> {
  await seed(page, shell, theme);
  await before(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#${path}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (shell === "moldura") await expect(page.locator('[data-shell="moldura"]')).toBeVisible();
  else await expect(page.locator(".nu-shell")).toBeVisible();
  await expect(page.locator("section.nu-scene, main.mold-main")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  // Let queries settle and entrances finish before axe reads colours.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function serious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    }));
}

const FRAME_SCREENS: [string, string][] = [
  ["Today", "/"],
  ["Runs", "/runs"],
  ["Skills", "/skills"],
  ["Routines", "/routines"],
  ["Memory", "/brain"],
  ["Settings", "/settings"],
];
const NUCLEO_SCREENS: [string, string][] = [
  ["home", "/"],
  ["Runs", "/runs"],
  ["Skills", "/skills"],
  ["Settings", "/settings"],
];

for (const theme of THEMES) {
  for (const [name, path] of FRAME_SCREENS) {
    test(`C8 the app frame has no serious violation on ${name} (${theme})`, async ({ page }) => {
      await open(page, "moldura", theme, path);
      expect(await serious(page)).toEqual([]);
    });
  }
  test(`C8 the app frame has no serious violation on Memory with an area chosen (${theme})`, async ({
    page,
  }) => {
    // The e2e home indexes one area, so the legend never has a second one to set aside. Give
    // half of the files another area, so choosing one in the legend dims the other (`.dimmed`).
    await open(page, "moldura", theme, "/brain", async (p) => {
      await p.route(/\/api\/(v1\/)?memory\/graph/, async (route) => {
        const response = await route.fetch();
        const graph = await response.json();
        graph.nodes = graph.nodes.map((n: { area: string | null }, i: number) =>
          i % 2 ? { ...n, area: "Notes" } : n,
        );
        await route.fulfill({ response, json: graph });
      });
    });
    const areas = page.locator(".brain2-legend .lg-row button[aria-pressed]:not(.kind-off)");
    await expect(areas).not.toHaveCount(0);
    await expect(areas.nth(1)).toBeVisible();
    await areas.first().click();
    await expect(page.locator(".brain2-legend button.dimmed")).not.toHaveCount(0);
    expect(await serious(page)).toEqual([]);
  });
  for (const [name, path] of NUCLEO_SCREENS) {
    test(`C9 the Núcleo has no serious violation on ${name} (${theme})`, async ({ page }) => {
      await open(page, "nucleo", theme, path);
      expect(await serious(page)).toEqual([]);
    });
  }
}

for (const theme of THEMES) {
  test(`C4 badges read at 12px (${theme})`, async ({ page }) => {
    await page.goto(`/gallery.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    const sizes = await page
      .locator("#story-badges .badge")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize));
    expect(sizes.length).toBeGreaterThan(5);
    expect(new Set(sizes)).toEqual(new Set(["12px"]));
  });
}

/**
 * The colour a probe takes from the --text the element itself sees: with the
 * preset block leaking onto these classes it would be the JARVIS one.
 */
async function textColourSeenBy(page: Page, className: string): Promise<{ colour: string; shadow: string }> {
  return page.evaluate((cls) => {
    const probe = document.createElement("span");
    probe.className = cls;
    probe.style.color = "var(--text)";
    probe.textContent = "0";
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const seen = { colour: cs.color, shadow: cs.textShadow };
    probe.remove();
    return seen;
  }, className);
}

test("C7 the light theme keeps its own tokens", async ({ page }) => {
  const JARVIS_TEXT = "rgb(223, 231, 242)"; // #dfe7f2, the dark JARVIS --text
  const LIGHT_TEXT = "rgb(32, 28, 20)"; // #201c14, the light theme's --text

  await page.goto("/gallery.html?theme=light&preset=hud-orange");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "hud-orange");
  const reference = await textColourSeenBy(page, "");
  expect(reference.colour).toBe(LIGHT_TEXT);
  for (const cls of ["display-digits", "hud-label accent"]) {
    const seen = await textColourSeenBy(page, cls);
    expect(seen.colour, `${cls} in the light theme`).toBe(reference.colour);
    expect(seen.colour, `${cls} must not take the JARVIS text`).not.toBe(JARVIS_TEXT);
    // The light theme draws with lines and ink: no glow on either.
    expect(seen.shadow, `${cls} glow`).toBe("none");
  }

  // The JARVIS preset itself stays applied in the dark theme.
  await page.goto("/gallery.html?theme=dark&preset=jarvis");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "jarvis");
  expect((await textColourSeenBy(page, "")).colour).toBe(JARVIS_TEXT);
  expect((await textColourSeenBy(page, "display-digits")).colour).toBe(JARVIS_TEXT);
});

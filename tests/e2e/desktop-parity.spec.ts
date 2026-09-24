/**
 * The last ties (redesign G6): what the desktop model must keep true across
 * spaces, the palette, the theme and the narrow screen, now that every
 * window is a panel and the console is fixed.
 */
import { test, expect } from "@playwright/test";
import { resetStage } from "./stage";

const HEADERS = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN! });

test("a space keeps panels of every kind: an app at its path, a trace, a document", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await page.route("**/api/memory/preview*", (route) =>
    route.fulfill({ json: { kind: "text", content: "the report" } }),
  );
  await request.put("/api/settings", {
    headers: HEADERS(),
    data: {
      dashboardLayout: {
        "doc:/tmp/report.md": { x: 700, y: 40, w: 420, h: 300, z: 20, visible: true },
      },
    },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/settings?tab=security");
  const settings = page.locator('[data-panel="app:settings"]');
  await expect(settings.locator("#settings-tabs-panel-security")).toBeVisible();
  // A run from the console: its trace is the third kind.
  const consolePlate = page.locator("[data-console]");
  await consolePlate.locator("textarea").fill("hello from work");
  // Run is enabled once the providers are known; the console will not send before.
  await expect(consolePlate.getByRole("button", { name: /^run|executar/i })).toBeEnabled();
  await consolePlate.locator("textarea").press("Enter");
  const trace = page.locator('[data-panel^="run:"]');
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  const traceId = await trace.getAttribute("data-panel");
  await expect(page.locator('[data-panel="doc:/tmp/report.md"]')).toBeVisible();

  // Leave for Research: a fresh, clear stage. Come back: everything is there,
  // the app still on its tab, the trace by its id, the document by its path.
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  await dock.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator("section.panel")).toHaveCount(0);
  await dock.getByRole("button", { name: "Work", exact: true }).click();
  await expect(settings.locator("#settings-tabs-panel-security")).toBeVisible();
  await expect(page.locator(`[data-panel="${traceId}"] .run-panel`)).toHaveAttribute(
    "data-run-status",
    "done",
  );
  await expect(page.locator('[data-panel="doc:/tmp/report.md"]')).toBeVisible();
  // And after a reload, still — the space is persisted, not remembered.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(settings.locator("#settings-tabs-panel-security")).toBeVisible();
  await expect(page.locator(`[data-panel="${traceId}"]`)).toBeVisible();
  await expect(page.locator('[data-panel="doc:/tmp/report.md"]')).toBeVisible();

  await page.goto("about:blank");
  await resetStage(request);
});

test("the palette opens panels and edits the HUD; the light theme paints the chrome", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // An app row opens a panel, not a page.
  await page.keyboard.press("Control+M");
  await page.getByRole("dialog").getByRole("option", { name: "Routines", exact: true }).click();
  await expect(page.locator('[data-panel="app:routines"] .page')).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  // "Edit HUD" is an action.
  await page.keyboard.press("Control+M");
  await page.keyboard.type("hud");
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Edit HUD|Editar HUD/ })
    .click();
  await expect(page.locator(".desktop")).toHaveClass(/\bediting\b/);
  // The palette is still leaving; its Escape would be its own. Wait it out.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".desktop")).not.toHaveClass(/\bediting\b/);
  // The light theme: strip, console and dock take the light ink, and the
  // text on them keeps its contrast (axe reads the real colours).
  await page.keyboard.press("Control+M");
  await page.keyboard.type("theme");
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Toggle light|Alternar claro/ })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await page.evaluate(() => {
    const lum = (el: Element) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(el).backgroundColor);
      return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : -1;
    };
    return {
      strip: getComputedStyle(document.querySelector("header.strip")!).backgroundImage,
      dock: getComputedStyle(document.querySelector(".workspace-dock.hud")!).backgroundImage,
      consoleText: getComputedStyle(document.querySelector(".cons-input")!).color,
      pageBg: lum(document.body),
    };
  });
  expect(light.strip).not.toContain("rgba(9, 8, 6");
  expect(light.dock).not.toContain("rgba(9, 8, 6");
  expect(light.pageBg).toBeGreaterThan(200);
  await page.screenshot({ path: "artifacts/qa-light-theme.png" });
  // Back to dark, so the next spec finds the desktop the way it expects it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+M");
  await page.keyboard.type("theme");
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Toggle light|Alternar claro/ })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the narrow screen stacks the console first, then the panels, with the apps as pages", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await request.put("/api/settings", {
    headers: HEADERS(),
    data: { dashboardLayout: { attention: { x: 40, y: 40, w: 420, h: 300, z: 2, visible: true } } },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const column = page.locator(".desktop-widgets.stacked");
  await expect(column).toBeVisible();
  await expect(column.locator("> :first-child")).toHaveClass(/\bcons\b/);
  await expect(column.locator('[data-panel="attention"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
  // Apps are pages here, reached from the phone's bottom navigation.
  const nav = page.getByRole("navigation", { name: /Main navigation|Navegação principal/ });
  await nav.getByRole("link", { name: "Skills", exact: true }).click();
  await expect(page).toHaveURL(/#\/skills$/);
  await expect(page.locator('[data-onboarding="skills"] .page')).toBeVisible();

  await page.goto("about:blank");
  await resetStage(request);
});

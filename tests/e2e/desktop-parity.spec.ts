/**
 * The last ties, restated for the immersive shell: what must hold across a
 * reload, the palette, the theme and the narrow screen now that every place
 * is a scene and every sub-block a lâmina.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  arrived,
  horizontalOverflow,
  lamina,
  liveLaminas,
  openRunFromTurn,
  openShell,
  overlaps,
  project,
  sendPrompt,
  spineModule,
  travelBySpine,
} from "./shell";

test("lâminas of every kind survive a reload of the tab, in the scene they were projected in", async ({
  page,
}) => {
  await page.route("**/api/memory/preview*", (route) =>
    route.fulfill({ json: { kind: "text", content: "the report" } }),
  );
  await openShell(page, "/settings?tab=security");
  await arrived(page, "settings");
  await expect(page.locator("#settings-tabs-panel-security")).toBeVisible();
  // A run from the voice line, opened from its turn: its trace is one kind, a document another.
  const id = await sendPrompt(page, "hello from work");
  await openRunFromTurn(page);
  const trace = lamina(page, `run:${id}`);
  await expect(trace).toHaveCount(1);
  await expect(trace.locator(".run-panel")).toHaveAttribute("data-run-status", "done", { timeout: 20_000 });
  const traceId = await trace.getAttribute("data-lamina");
  await project(page, "doc:/tmp/report.md");
  await expect(lamina(page, "doc:/tmp/report.md")).toContainText("the report");

  // A reload is the same moment: the scene on its tab, the trace by its id,
  // the document by its path.
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("#settings-tabs-panel-security")).toBeVisible();
  await expect(lamina(page, traceId!).locator(".run-panel")).toHaveAttribute("data-run-status", "done");
  await expect(lamina(page, "doc:/tmp/report.md")).toBeVisible();
  // A new tab is a new moment: nothing projected.
  const other = await page.context().newPage();
  await other.goto("/#/settings?tab=security");
  await expect(other.locator("#settings-tabs-panel-security")).toBeVisible();
  await expect(liveLaminas(other)).toHaveCount(0);
  await other.close();
});

test("the palette travels to scenes and projects instruments; the light theme paints the shell", async ({
  page,
}) => {
  await openShell(page);
  // An app row is a scene.
  await page.keyboard.press("Control+M");
  await page.getByRole("dialog").getByRole("option", { name: "Routines", exact: true }).click();
  await expect(page).toHaveURL(/#\/routines$/);
  await arrived(page, "routines");
  await expect(page.locator('[data-onboarding="routines"]')).toBeVisible();
  // "Open a panel" projects an instrument where you are.
  await page.keyboard.press("Control+M");
  await page.getByRole("dialog").getByRole("combobox").fill("open a panel");
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Open a panel|Abrir um painel/ })
    .click();
  const palette = page.getByRole("dialog", { name: /Command palette|Paleta de comandos/ });
  await palette.getByRole("option", { name: /^(Pulse|Pulso)/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(lamina(page, "pulse")).toBeVisible();
  await expect(page).toHaveURL(/#\/routines$/);
  // The window actions are gone from the palette.
  await page.keyboard.press("Control+M");
  await page.getByRole("dialog").getByRole("combobox").fill("hud");
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("hud");
  await expect(page.getByRole("dialog").getByRole("option", { name: /Edit HUD|Editar HUD/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The palette's Escape was its own: the lâmina is still up.
  await expect(lamina(page, "pulse")).toBeVisible();

  // The light theme: the HUD, the voice line and the lâminas take the light
  // glass, and their text keeps its contrast (axe reads the real colours).
  await page.keyboard.press("Control+M");
  await page.getByRole("dialog").getByRole("combobox").fill("theme");
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("theme");
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Toggle light|Alternar claro/ })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const light = await page.evaluate(() => {
    const lum = (el: Element) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(el).backgroundColor);
      return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : -1;
    };
    return {
      line: getComputedStyle(document.querySelector(".nu-voice .cons-row")!).backgroundImage,
      lamina: getComputedStyle(document.querySelector(".nu-lamina")!).backgroundImage,
      shell: lum(document.querySelector(".nu-shell")!),
    };
  });
  expect(light.line).not.toContain("rgba(22, 20, 15");
  expect(light.lamina).not.toContain("rgba(22, 20, 15");
  expect(light.shell).toBeGreaterThan(200);
  await page.evaluate(() => document.fonts.ready);
  const contrast = await new AxeBuilder({ page })
    .include(".nu-hud")
    .include(".nu-laminas")
    .include(".nu-voice")
    .withRules(["color-contrast"])
    .analyze();
  expect(contrast.violations.map((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
  await page.screenshot({ path: "artifacts/qa-light-theme.png" });
  // Back to dark, so the next spec finds the shell the way it expects it.
  await page.keyboard.press("Control+M");
  await page.getByRole("dialog").getByRole("combobox").fill("theme");
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("theme");
  await page
    .getByRole("dialog")
    .getByRole("option", { name: /Toggle light|Alternar claro/ })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a production view in a scene has one header: the shell's title; its actions stay", async ({ page }) => {
  // The shell names the scene (top centre, and the lit module on the spine);
  // the page no longer says it again, nor its blurb.
  await openShell(page, "/connectors");
  await arrived(page, "connectors");
  await expect(page.locator(".nu-title h1.nu-title-t")).toHaveText(/Connectors|Conectores/);
  await expect(spineModule(page, "connectors")).toHaveAttribute("aria-current", "page");
  const connectors = page.locator('[data-onboarding="connectors"]');
  await expect(connectors.locator(".page")).toBeVisible();
  await expect(connectors.locator(".page-head h1")).toBeHidden();
  await expect(connectors.locator(".page-head .sub")).toBeHidden();
  // A page that is only a title and a blurb keeps no empty head at all.
  await page.goto("/#/artifacts");
  await arrived(page, "artifacts");
  const artifacts = page.locator('[data-onboarding="artifacts"]');
  await expect(artifacts.locator(".page")).toBeVisible();
  await expect(artifacts.locator(".page-head")).toBeHidden();
  // Settings keeps its tabs, clear of the HUD.
  await page.goto("/#/settings");
  await arrived(page, "settings");
  const tabs = page.locator('[data-onboarding="settings"] [role="tablist"]').first();
  await expect(tabs).toBeVisible();
  const hud = (await page.locator(".nu-hud").boundingBox())!;
  const tabsBox = (await tabs.boundingBox())!;
  expect(tabsBox.y).toBeGreaterThanOrEqual(hud.y + hud.height - 1);
});

test("the narrow screen travels by the spine and stacks a lâmina clear of the voice line", async ({
  page,
}) => {
  await openShell(page, "/", { width: 390, height: 844 });
  await arrived(page, "nucleo");
  // The modules are within reach of a thumb: the spine is a row under the HUD.
  await travelBySpine(page, "brain");
  await travelBySpine(page, "runs");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
  await project(page, "attention");
  const sheet = lamina(page, "attention");
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/\bfresh\b/);
  const line = (await page.locator(".nu-voice .cons-row").boundingBox())!;
  expect(overlaps((await sheet.boundingBox())!, line)).toBe(false);
  await expect(page.locator(".cons-input")).toBeInViewport({ ratio: 1 });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
});

/**
 * The primitives in a real browser, in both interfaces (.specs/features/primitivas, C30):
 * Escape closes the command palette and focus goes back to what held it, Tab does not
 * leave a dialog, the sheet's own animation stops for someone who asked for less motion
 * and plays for one who did not, and the hint of an icon button shows with the keyboard focus.
 *
 * The interface is fed to the app through the response it reads it from (UI preferences),
 * so no test writes shared server state.
 */
import { test, expect, type Page } from "@playwright/test";

type Shell = "moldura" | "nucleo";
const SHELLS: Shell[] = ["moldura", "nucleo"];

/** What holds focus before the palette opens, and the icon button that carries a hint, in each interface. */
const HOLDER: Record<Shell, string> = { moldura: ".mold-search", nucleo: ".cons-more" };
const HINTED: Record<Shell, string> = { moldura: ".mold-bell", nucleo: ".cons-more" };

async function openApp(page: Page, shell: Shell, reducedMotion: "reduce" | "no-preference"): Promise<void> {
  await page.emulateMedia({ reducedMotion });
  await page.route(/\/api\/(v1\/)?ui-preferences(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), shell } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(shell === "moldura" ? '[data-shell="moldura"]' : ".nu-shell")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const shell of SHELLS) {
  test.describe(shell === "moldura" ? "the app frame" : "the Núcleo", () => {
    test("C30 Escape closes the palette and focus goes back to what held it", async ({ page }) => {
      await openApp(page, shell, "reduce");
      const holder = page.locator(HOLDER[shell]);
      await holder.focus();
      await expect(holder).toBeFocused();
      await page.keyboard.press("Control+k");
      const palette = page.getByRole("dialog");
      await expect(palette).toBeVisible();
      await expect(page.getByRole("combobox")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(holder).toBeFocused();
    });

    test("C30 Tab goes round inside the dialog and never out to the page behind it", async ({ page }) => {
      await openApp(page, shell, "reduce");
      await page.keyboard.press("Control+k");
      const palette = page.getByRole("dialog");
      await expect(palette).toBeVisible();
      const inside = () =>
        page.evaluate(() => {
          const active = document.activeElement;
          return !!active && !!active.closest('[role="dialog"]');
        });
      for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await inside(), `after ${key}`).toBe(true);
      }
      // The page behind the dialog is out of reach for the keyboard and for assistive technology.
      await expect(page.locator("#root > *").first()).toHaveAttribute("inert", "");
    });

    test("C30 the sheet's animation stops with reduced motion and plays without it", async ({ page }) => {
      const animationOf = async () => {
        await page.keyboard.press("Control+k");
        await expect(page.getByRole("dialog")).toBeVisible();
        return page.locator(".launcher-panel").evaluate((el) => getComputedStyle(el).animationName);
      };
      await openApp(page, shell, "reduce");
      expect(await animationOf()).toBe("none");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.emulateMedia({ reducedMotion: "no-preference" });
      expect(await animationOf()).not.toBe("none");
    });

    test("C30 the hint of an icon button shows with the keyboard focus and goes with Escape", async ({
      page,
    }) => {
      await openApp(page, shell, "reduce");
      const control = page.locator(HINTED[shell]);
      const name = await control.getAttribute("aria-label");
      expect(name).toBeTruthy();
      await control.focus();
      const hint = page.getByRole("tooltip");
      await expect(hint).toBeVisible();
      // The hint says what the control is called; the control keeps its own name and is not also
      // described by the same words (a screen reader would say them twice).
      await expect(hint).toHaveText(name!);
      await expect(control).toHaveAttribute("aria-label", name!);
      await expect(control).not.toHaveAttribute("aria-describedby", /.+/);
      await page.keyboard.press("Escape");
      await expect(hint).toHaveCount(0);
      await expect(control).toBeFocused();
    });
  });
}

/**
 * One Escape closes one thing: the layer on top. These are the places where two things were up at once
 * and an Escape used to reach the one below (or the page behind a menu answered the letters).
 */
test.describe("C34 one Escape closes one thing", () => {
  test("C34 in the frame, a popover of the console over the narrow chat drawer closes first and the drawer next", async ({
    page,
  }) => {
    await openApp(page, "moldura", "reduce");
    await page.setViewportSize({ width: 800, height: 800 });
    await page.locator(".mold-chat-btn").click();
    const drawer = page.locator("aside.mold-chat");
    await expect(drawer).toHaveAttribute("role", "dialog");
    await drawer.locator(".cons-more").click();
    const chip = drawer.locator('.cons-ctl button[aria-haspopup="dialog"]').first();
    await chip.click();
    const popover = page.locator("#modal-root .popover");
    await expect(popover).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("C34 in the Núcleo, the hint on the brain's help button closes before the help card does", async ({
    page,
  }) => {
    await openApp(page, "nucleo", "reduce");
    await page.goto("/#/brain");
    const help = page.locator(".bs-help");
    await expect(page.locator(".bs-help-btn")).toBeVisible();
    if ((await help.count()) === 0) await page.locator(".bs-help-btn").click();
    await expect(help).toBeVisible();
    await page.locator(".bs-help-btn").focus();
    const hint = page.locator(".ui-tip[data-state]");
    await expect(hint).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(hint).toHaveCount(0);
    await expect(help).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });

  test("C35 in the Núcleo, an open menu is a layer: the screen's letters do not reach the screen, and they do again when it closes", async ({
    page,
  }) => {
    await openApp(page, "nucleo", "reduce");
    await page.goto("/#/skills");
    const more = page.getByTestId("skills-more");
    await expect(more).toBeVisible();
    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("p");
    await expect(page.locator("div.nu-focus")).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("p");
    await expect(page.locator("div.nu-focus")).toHaveCount(1);
  });

  test("C36 a dialog opened from an item of the Skills menu gives focus back to the menu's button when it closes", async ({
    page,
  }) => {
    await openApp(page, "nucleo", "reduce");
    await page.goto("/#/skills");
    const more = page.getByTestId("skills-more");
    await more.click();
    await page.getByRole("menuitem").nth(1).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(more).toBeFocused();
  });
});

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
      // The hint says what the control is called, and the control keeps its own name and is tied to the hint.
      await expect(hint).toHaveText(name!);
      await expect(control).toHaveAttribute("aria-describedby", /.+/);
      await page.keyboard.press("Escape");
      await expect(hint).toHaveCount(0);
      await expect(control).toBeFocused();
    });
  });
}

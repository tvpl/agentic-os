/**
 * Shared steps for the immersive shell (`apps/command-centre/src/nucleo`).
 *
 * There are no windows to seed any more: the URL is the scene, lâminas live
 * in the tab's session storage and die with it, and the voice line is the
 * one place to type. A spec opens the scene it is about and drives it the way
 * a user would; nothing here writes to the shared server state.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Open a scene (`/`, `/brain`, `/runs/abc`…) and wait for the shell to stand on it. */
export async function openShell(
  page: Page,
  path = "/",
  viewport: { width: number; height: number } | null = { width: 1440, height: 900 },
): Promise<void> {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`/#${path}`);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(".nu-shell")).toBeVisible();
  await expect(page.locator("[data-console]")).toBeVisible();
}

/** The scene the shell is in (the one that is not on its way out). */
export function currentScene(page: Page): Locator {
  return page.locator("section.nu-scene.on");
}

/** Wait until the scene transition is over: one scene on the stage, the one named. */
export async function arrived(page: Page, scene: string): Promise<void> {
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-scene", scene);
  await expect(page.locator("section.nu-scene")).toHaveCount(1);
  await expect(currentScene(page)).toHaveAttribute("data-scene", scene);
}

/** A lâmina by its id (`attention`, `run:…`, `doc:…`, `form:…`), or by a prefix with `^=`. */
export function lamina(page: Page, id: string, match: "=" | "^=" = "="): Locator {
  // Ones that are dissolving stay drawn for their exit: only the live ones count.
  return page.locator(`article.nu-lamina[data-lamina${match}"${id}"]:not(.bye)`);
}

/** Every lâmina on screen that is not on its way out. */
export function liveLaminas(page: Page): Locator {
  return page.locator("article.nu-lamina:not(.bye)");
}

/** The ids of the live lâminas, oldest first. */
export async function laminaIds(page: Page): Promise<string[]> {
  return liveLaminas(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-lamina") ?? ""));
}

/** Project an instrument the way the old callers still do (palette, inbox). */
export async function project(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent("mordomo:open-panel", { detail })),
    id,
  );
}

/** Open the voice line's context and controls (the tray, the folder, the mode…). */
export async function openVoiceControls(page: Page): Promise<Locator> {
  const side = page.locator("#cons-side");
  if (await side.isHidden()) await page.locator(".cons-more").click();
  await expect(side).toBeVisible();
  // Using the line's tools raises the conversation (once the press is over): wait
  // for it, so a later fold does not race the rise.
  await expect(voiceSheet(page)).toHaveAttribute("data-open", "");
  return side;
}

/* ---- the conversation: a sheet that rises out of the voice line ------------ */

/** The voice (`div.nu-voice`): folded it is only the line; open, the whole conversation. */
export function voiceSheet(page: Page): Locator {
  return page.getByTestId("voice");
}

/** Open the conversation the way a user does: by going to the line. */
export async function openConversation(page: Page): Promise<Locator> {
  const voice = voiceSheet(page);
  if ((await voice.getAttribute("data-open")) === null) await page.locator(".cons-input").focus();
  await expect(voice).toHaveAttribute("data-open", "");
  await expect(page.locator(".nu-voice .cons-thread")).toBeVisible();
  return voice;
}

/** Fold the conversation back into the line (its own ⌄), so the scene behind it is a place again. */
export async function foldConversation(page: Page): Promise<void> {
  const voice = voiceSheet(page);
  if ((await voice.getAttribute("data-open")) !== null)
    await page.getByRole("button", { name: /^(Fold the conversation|Recolher a conversa)$/ }).click();
  await expect(voice).not.toHaveAttribute("data-open", /.*/);
  await expect(page.locator(".nu-dialog-veil")).toHaveCount(0);
}

/** The newest turn of the conversation. */
export function lastTurn(page: Page): Locator {
  return page.locator(".nu-voice .cons-thread .console-turn").last();
}

/**
 * Say something on the voice line and wait for the request to leave: the
 * conversation opens (the line was used) and the run's id comes back.
 */
export async function sendPrompt(page: Page, text: string): Promise<string> {
  const posted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      (/\/api\/runs$/.test(new URL(r.url()).pathname) ||
        /\/api\/sessions\/[^/]+\/continue$/.test(new URL(r.url()).pathname)),
  );
  const input = page.locator(".cons-input");
  await input.fill(text);
  await expect(page.locator(".nu-voice .cons-send")).toBeEnabled();
  await input.press("Enter");
  const res = await posted;
  expect(res.ok(), `the prompt was not accepted: ${res.status()}`).toBe(true);
  const body = (await res.json()) as { runId?: string };
  await expect(voiceSheet(page)).toHaveAttribute("data-open", "");
  return body.runId ?? "";
}

/** Wait for the newest turn to finish, then follow its "Open run →" to the trace. */
export async function openRunFromTurn(page: Page, timeout = 20_000): Promise<void> {
  await openConversation(page);
  const open = lastTurn(page).getByRole("button", { name: /^(Open run|Abrir execução) →$/ });
  await expect(open).toBeVisible({ timeout });
  await open.click();
}

/* ---- the Núcleo's core: the day blooms out of it on a touch ------------------ */

/** Touch the core: the readings fly out of it. */
export async function bloomCore(page: Page): Promise<void> {
  const nucleo = page.locator(".nu-nucleo");
  if ((await nucleo.getAttribute("data-bloom")) === null) await page.getByTestId("core-bloom").click();
  await expect(nucleo).toHaveAttribute("data-bloom", "");
  await expect(page.locator(".nu-readings")).not.toHaveAttribute("aria-hidden", /.*/);
}

/** A reading around the core, bloomed first so it can be touched. */
export async function reading(page: Page, id: string): Promise<Locator> {
  await bloomCore(page);
  const r = page.locator(`.nu-reading[data-reading="${id}"]`);
  await expect(r).toBeVisible();
  // Once it has flown out: mid-flight it is still under the core's hit area.
  await expect.poll(() => r.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.95);
  return r;
}

/** Travel to one of the OS's scenes through the launcher (⌘K / Ctrl+M). */
export async function openAppFromPalette(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+M");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("option", { name, exact: true }).click();
  await expect(page.locator(".launcher")).toHaveCount(0);
}

/** The brain's accessible list view, behind the constellation's "⋯". */
export async function openBrainList(page: Page): Promise<Locator> {
  await page.locator(".bs-more").click();
  await page
    .locator(".bs-menu")
    .getByRole("button", { name: /^(List view|Lista)$/ })
    .click();
  const list = page.locator(".bs-list .brain2-list");
  await expect(list).toBeVisible();
  await expect(list.locator("button[data-file]").first()).toBeVisible();
  return list;
}

/** The brain's classic 2D map (the production Second Brain), behind the same "⋯". */
export async function openClassicBrain(page: Page): Promise<Locator> {
  await page.locator(".bs-more").click();
  await page
    .locator(".bs-menu")
    .getByRole("button", { name: /^(Classic 2D map|Mapa clássico 2D)$/ })
    .click();
  const map = page.locator(".bs-classic .brain2");
  await expect(map).toBeVisible();
  return map;
}

export function overlaps(a: Box, b: Box, slack = 1): boolean {
  return (
    a.x + a.width > b.x + slack &&
    b.x + b.width > a.x + slack &&
    a.y + a.height > b.y + slack &&
    b.y + b.height > a.y + slack
  );
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Travel from the keyboard (1–5, [ ]), from wherever the focus was. */
export async function travel(page: Page, key: string, scene: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(key);
  await arrived(page, scene);
}

/** A module on the spine (the left edge): the way to a scene by pointer. */
export function spineModule(page: Page, scene: string): Locator {
  return page.locator(`nav.nu-spine .nu-mod[data-scene="${scene}"]`);
}

/** Travel to a scene through its module on the spine. */
export async function travelBySpine(page: Page, scene: string): Promise<void> {
  await spineModule(page, scene).click();
  await arrived(page, scene);
  await expect(spineModule(page, scene)).toHaveAttribute("aria-current", "page");
}

/** The pendências focus (the dialog the hub opens). */
export function focusMode(page: Page): Locator {
  return page.locator('div.nu-focus[role="dialog"]');
}

/** Open the pendências focus from the hub (top-left) and wait for it to stand. */
export async function openPendingFocus(page: Page): Promise<Locator> {
  await page.getByTestId("pending-hub").click();
  const focus = focusMode(page);
  await expect(focus).toBeVisible();
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-focus", "");
  return focus;
}

/**
 * How many pixels of an element's picture on screen are lit — brighter than
 * the dark ground. Read from a real screenshot, so a WebGL canvas (whose
 * drawing buffer cannot be read back once composited) counts too.
 */
export async function litPixels(
  page: Page,
  target: Locator,
  threshold = 70,
): Promise<{ lit: number; total: number }> {
  const png = await target.screenshot();
  return page.evaluate(
    async ([b64, min]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i]!, d[i + 1]!, d[i + 2]!) > min) n++;
      return { lit: n, total: c.width * c.height };
    },
    [png.toString("base64"), threshold] as const,
  );
}

/**
 * The agent's body (`Entity`) is drawn: its WebGL core and HUD canvases (at
 * least 2% of its box lit), or without WebGL2 the 2D fallback — a sphere of
 * points, sparser (at least 0.3%).
 */
export async function entityPainted(page: Page, selector: string): Promise<boolean> {
  const el = page.locator(`${selector}.entity`);
  const kind = await el.evaluate((node) => {
    const gl = node.querySelector("canvas.entity-gl") as HTMLCanvasElement | null;
    const fallback = node.querySelector("canvas.entity-fallback") as HTMLCanvasElement | null;
    const drawn = (c: HTMLCanvasElement | null) => !!c && c.width > 0 && c.height > 0;
    return drawn(gl) ? "gl" : drawn(fallback) ? "fallback" : null;
  });
  if (!kind) return false;
  const { lit, total } = await litPixels(page, el, kind === "gl" ? 70 : 40);
  return total > 0 && lit > total * (kind === "gl" ? 0.02 : 0.003);
}

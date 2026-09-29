/**
 * The immersive shell (docs/plans/nucleo-imersivo.md, rounds 1–3): one
 * scene at a time, reached through the module spine on the left; what waits
 * on you in the pendências (top-left) and resolved in focus; at most two
 * lâminas beside the core; one voice line in the same place everywhere, with
 * the agent's iris in it and no approval box — the conversation a sheet that
 * rises out of it when used; the Núcleo at rest only the agent's body, the
 * day blooming out of it on a touch — and nothing on screen covering
 * anything else. These are the guarantees the window model's
 * drag/snap/region specs used to give, restated for a shell without windows.
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  arrived,
  bloomCore,
  currentScene,
  entityPainted,
  focusMode,
  foldConversation,
  horizontalOverflow,
  lamina,
  laminaIds,
  lastTurn,
  liveLaminas,
  openConversation,
  openPendingFocus,
  openShell,
  openVoiceControls,
  overlaps,
  project,
  reading,
  sendPrompt,
  spineModule,
  travelBySpine,
  voiceSheet,
  type Box,
} from "./shell";

const MAIN = ["nucleo", "brain", "runs", "skills", "routines"] as const;
const PATHS: Record<string, string> = {
  nucleo: "/",
  brain: "/brain",
  runs: "/runs",
  skills: "/skills",
  routines: "/routines",
  connectors: "/connectors",
  artifacts: "/artifacts",
  generations: "/generations",
  pixel: "/pixel",
  settings: "/settings",
};
const LEVEL_RANK: Record<string, number> = { decide: 0, fix: 1, look: 2, info: 3 };
const api = (request: APIRequestContext) => ({
  headers: { "x-mordomo-token": process.env.MORDOMO_TOKEN! },
  async post<T>(url: string, data: unknown): Promise<T> {
    const res = await request.post(url, { headers: this.headers, data });
    expect(res.ok(), `${url} → ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  },
  async get<T>(url: string): Promise<T> {
    const res = await request.get(url, { headers: this.headers });
    expect(res.ok(), `${url} → ${res.status()}`).toBe(true);
    return (await res.json()) as T;
  },
});

/** A real pending decision: a write-mode prompt, parked by the review-before-write profile. */
async function requestWrite(request: APIRequestContext, prompt: string) {
  const out = await api(request).post<{
    runId: string;
    status: string;
    pendingApproval: { id: string } | null;
  }>("/api/runs", { prompt, mode: "write" });
  expect(out.status).toBe("waiting_approval");
  return { runId: out.runId, approvalId: out.pendingApproval!.id };
}

/** Leave no decision behind for the next spec. */
async function settle(request: APIRequestContext, approvalId: string) {
  const a = await api(request).get<{ status: string }>(`/api/approvals/${approvalId}`);
  if (a.status === "pending")
    await api(request).post(`/api/approvals/${approvalId}/resolve`, { decision: "denied" });
}

/** Put the focus nowhere in particular, the way a click on the ground leaves it. */
async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test("the spine travels by click, by 1–5 and by [ ], and reaches every scene", async ({ page }) => {
  await openShell(page);
  await arrived(page, "nucleo");
  const spine = page.locator('nav.nu-spine[data-onboarding="modes"]');
  await expect(spine).toBeVisible();
  // Every scene is a module on the spine — the main five, the rest, Settings
  // at the foot — and there is no "more" menu.
  const order = await spine
    .locator(".nu-mod")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.scene));
  expect(order.slice(0, 5)).toEqual([...MAIN]);
  expect(order.at(-1)).toBe("settings");
  expect([...order].sort()).toEqual(Object.keys(PATHS).sort());
  await expect(page.locator(".nu-horizon, .nu-hz, .nu-hz-more")).toHaveCount(0);
  await expect(spineModule(page, "nucleo")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".nu-title h1.nu-title-t")).toHaveText(/^(Core|Núcleo)$/);

  // A module names itself on hover.
  await spineModule(page, "brain").hover();
  await expect(spineModule(page, "brain").locator(".nu-mod-label")).toBeVisible();
  await expect(spineModule(page, "brain").locator(".nu-mod-label")).toContainText(/Brain|Cérebro/);
  await expect(spineModule(page, "brain")).toHaveAccessibleName(/^(Brain|Cérebro)$/);

  await spineModule(page, "brain").click();
  await expect(page).toHaveURL(/#\/brain$/);
  await arrived(page, "brain");
  await expect(spineModule(page, "brain")).toHaveAttribute("aria-current", "page");
  await expect(spineModule(page, "nucleo")).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator(".nu-title h1.nu-title-t")).toHaveText(/^(Brain|Cérebro)$/);
  await expect(spine.locator('.nu-mod[aria-current="page"]')).toHaveCount(1);

  // The number keys are the five main scenes, in the spine's order.
  for (const [key, scene] of [
    ["3", "runs"],
    ["4", "skills"],
    ["5", "routines"],
    ["1", "nucleo"],
  ] as const) {
    await blur(page);
    await page.keyboard.press(key);
    await expect(page).toHaveURL(new RegExp(`#${PATHS[scene]!.replace("/", "\\/")}$`));
    await arrived(page, scene);
    await expect(spineModule(page, scene)).toHaveAttribute("aria-current", "page");
  }

  // ] and [ step through the main five, and wrap around them.
  await blur(page);
  await page.keyboard.press("]");
  await arrived(page, "brain");
  await blur(page);
  await page.keyboard.press("[");
  await arrived(page, "nucleo");
  await blur(page);
  await page.keyboard.press("[");
  await arrived(page, "routines");
  await expect(spineModule(page, "routines")).toHaveAttribute("aria-current", "page");

  // Typing in the voice line is typing, not travelling.
  const input = page.locator(".cons-input");
  await input.click();
  await page.keyboard.type("1]");
  await expect(input).toHaveValue("1]");
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-scene", "routines");
  await input.fill("");
  await foldConversation(page);

  // The scenes past the main five are one click away too, Settings included.
  for (const scene of ["connectors", "pixel", "settings"]) {
    await travelBySpine(page, scene);
    await expect(page).toHaveURL(new RegExp(`#${PATHS[scene]!.replace("/", "\\/")}$`));
  }
  await travelBySpine(page, "connectors");
  await expect(currentScene(page).locator('[data-onboarding="connectors"]')).toBeVisible();
});

test("a transition leaves exactly one interactive scene, even when you turn back mid-way", async ({
  page,
}) => {
  await openShell(page);
  await arrived(page, "nucleo");
  const live = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("section.nu-scene"))
        .filter((s) => !s.hasAttribute("inert") && s.getAttribute("aria-hidden") !== "true")
        .map((s) => `${s.dataset.scene}${s.classList.contains("on") ? ":on" : ""}`),
    );

  // Mid-travel, read in one frame: both scenes are drawn, but only the
  // arriving one is a place.
  const midway = async () =>
    (
      await page.waitForFunction(() => {
        const out = document.querySelector<HTMLElement>('section.nu-scene[class*="out-"]');
        const on = document.querySelector<HTMLElement>("section.nu-scene.on");
        if (!out || !on) return null;
        return {
          leaving: out.dataset.scene,
          leavingClass: out.className,
          hidden: out.getAttribute("aria-hidden"),
          inert: out.hasAttribute("inert"),
          arriving: on.dataset.scene,
          arrivingClass: on.className,
          live: Array.from(document.querySelectorAll<HTMLElement>("section.nu-scene"))
            .filter((s) => !s.hasAttribute("inert") && s.getAttribute("aria-hidden") !== "true")
            .map((s) => `${s.dataset.scene}${s.classList.contains("on") ? ":on" : ""}`),
        };
      })
    ).jsonValue();

  // Going into a scene zooms through its module, the Núcleo rushing past.
  await page.keyboard.press("2");
  const into = (await midway())!;
  expect(into).toMatchObject({ leaving: "nucleo", hidden: "true", inert: true, arriving: "brain" });
  expect(into.leavingClass).toMatch(/\bout-zoom\b/);
  expect(into.arrivingClass).toMatch(/\bin-zoom\b/);
  expect(into.live).toEqual(["brain:on"]);
  await arrived(page, "brain");
  expect(await live()).toEqual(["brain:on"]);
  // Going home folds the scene back into its module.
  await page.keyboard.press("1");
  const home = (await midway())!;
  expect(home).toMatchObject({ leaving: "brain", hidden: "true", inert: true, arriving: "nucleo" });
  expect(home.leavingClass).toMatch(/\bout-home\b/);
  expect(home.arrivingClass).toMatch(/\bin-home\b/);
  expect(home.live).toEqual(["nucleo:on"]);
  await arrived(page, "nucleo");
  await page.keyboard.press("2");
  await arrived(page, "brain");

  // Back and forth inside the exit's 650 ms: the scene being returned to must
  // not keep the `inert` it was leaving with.
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await page.keyboard.press("1");
  for (let i = 0; i < 6; i++) {
    const now = await live();
    expect(now).toEqual(["nucleo:on"]);
    await page.waitForTimeout(120);
  }
  await arrived(page, "nucleo");
  expect(await live()).toEqual(["nucleo:on"]);
  // And it is really usable: the core blooms on a touch, and a reading
  // answers a click (what the agent is doing now projects its lâmina).
  await (await reading(page, "now")).click();
  await expect(lamina(page, "now")).toBeVisible();
});

test("readings project lâminas; two at most, the oldest pushed out; each can be dismissed", async ({
  page,
}) => {
  await openShell(page);
  await arrived(page, "nucleo");
  await expect(liveLaminas(page)).toHaveCount(0);
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-proj", "0");

  // A reading is not a card: a click projects its instrument beside the core.
  await (await reading(page, "pulse")).click();
  const pulse = lamina(page, "pulse");
  await expect(pulse).toBeVisible();
  await expect(pulse.locator(".nu-lamina-title")).not.toBeEmpty();
  await expect(pulse.locator(".nu-lamina-ref")).toHaveText(/^@/);
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-proj", "1");
  // The core steps aside and the readings step out of the way.
  await expect(page.locator(".nu-readings")).toHaveCSS("pointer-events", "none");

  await project(page, "cost");
  await expect(lamina(page, "cost")).toBeVisible();
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-proj", "2");
  expect(await laminaIds(page)).toEqual(["pulse", "cost"]);

  // A third pushes the oldest out.
  await project(page, "now");
  await expect(lamina(page, "pulse")).toHaveCount(0);
  await expect(liveLaminas(page)).toHaveCount(2);
  expect(await laminaIds(page)).toEqual(["cost", "now"]);
  // Projecting one that is up already moves it to the newest place, nothing more.
  await project(page, "cost");
  await expect.poll(() => laminaIds(page)).toEqual(["now", "cost"]);

  // The dismiss button takes exactly its own lâmina away.
  await lamina(page, "now")
    .getByRole("button", { name: /^(Dismiss|Dispensar): / })
    .click();
  await expect(lamina(page, "now")).toHaveCount(0);
  await expect(liveLaminas(page)).toHaveCount(1);
  await expect(page.locator("article.nu-lamina")).toHaveCount(1);
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-proj", "1");
});

test("Escape dismisses the newest lâmina, then the next, then goes home", async ({ page }) => {
  // Wide enough for the quiet cost reading to stay in the telemetry.
  await openShell(page, "/runs", { width: 1600, height: 900 });
  await arrived(page, "runs");
  // Today's cost from the telemetry — it projects too — then what the agent is doing now.
  await page.locator('.nu-tele .nu-t[data-item="cost"]').click();
  await expect(lamina(page, "cost")).toBeVisible();
  await project(page, "now");
  await expect(liveLaminas(page)).toHaveCount(2);
  const [older, newer] = await laminaIds(page);
  expect(older).toBe("cost");
  await blur(page);
  await page.keyboard.press("Escape");
  await expect(lamina(page, newer!)).toHaveCount(0);
  await expect(lamina(page, older!)).toBeVisible();
  await expect(page).toHaveURL(/#\/runs$/);
  await page.keyboard.press("Escape");
  await expect(liveLaminas(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/runs$/);
  // With nothing projected, Escape is the way home.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/$/);
  await arrived(page, "nucleo");
});

test("lâminas dissolve when the scene changes", async ({ page }) => {
  await openShell(page);
  await (await reading(page, "cost")).click();
  await project(page, "now");
  await expect(liveLaminas(page)).toHaveCount(2);
  await page.keyboard.press("3");
  await arrived(page, "runs");
  await expect(liveLaminas(page)).toHaveCount(0);
  await expect(page.locator("article.nu-lamina")).toHaveCount(0);
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-proj", "0");
  // Coming back does not bring them back: they belonged to that moment.
  await page.keyboard.press("1");
  await arrived(page, "nucleo");
  await expect(page.locator("article.nu-lamina")).toHaveCount(0);
});

/** Every box that must stand clear of the others, read in one frame. */
async function chrome(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const shown = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        Number(cs.opacity) > 0.05 &&
        r.width > 0 &&
        r.height > 0
      );
    };
    const hints = document.querySelector(".nu-voice .nu-hints");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      laminas: Array.from(document.querySelectorAll(".nu-lamina:not(.bye)")).map(box),
      voice: box(document.querySelector(".nu-voice .cons-row")!),
      hints: hints && shown(hints) ? box(hints) : null,
      hub: box(document.querySelector(".nu-hub")!),
      title: box(document.querySelector(".nu-title")!),
      tele: box(document.querySelector(".nu-tele")!),
      spine: Array.from(document.querySelectorAll("nav.nu-spine .nu-mod"))
        .filter(shown)
        .map((el) => ({ scene: (el as HTMLElement).dataset.scene ?? "?", ...box(el) })),
    };
  });
}

function clashes(c: Awaited<ReturnType<typeof chrome>>): string[] {
  const out: string[] = [];
  const named: Array<[string, Box]> = [
    ["voice", c.voice],
    ...(c.hints ? [["intents", c.hints] as [string, Box]] : []),
    ["hub", c.hub],
    ["title", c.title],
    ["telemetry", c.tele],
    ...c.laminas.map((b, i): [string, Box] => [`lamina#${i}`, b]),
    ...c.spine.map((b): [string, Box] => [`spine:${b.scene}`, b]),
  ];
  for (let i = 0; i < named.length; i++)
    for (let j = i + 1; j < named.length; j++) {
      const [a, ab] = named[i]!;
      const [b, bb] = named[j]!;
      // The voice line and its intents are one voice, stacked on purpose.
      if ((a === "voice" && b === "intents") || (a === "intents" && b === "voice")) continue;
      if (overlaps(ab, bb)) out.push(`${a} × ${b}`);
    }
  for (const [name, b] of named)
    if (
      b.x < -1 ||
      b.x + b.width > c.viewport.width + 1 ||
      b.y < -1 ||
      b.y + b.height > c.viewport.height + 1
    )
      out.push(`${name} leaves the viewport`);
  return out;
}

for (const [w, h] of [
  [1280, 720],
  [1440, 900],
  [2000, 1108],
] as const) {
  test(`nothing covers anything at ${w}×${h}: hub, title, telemetry, spine, lâminas, voice line`, async ({
    page,
  }) => {
    await openShell(page, "/", { width: w, height: h });
    await arrived(page, "nucleo");
    await expect.poll(async () => clashes(await chrome(page))).toEqual([]);
    // One lâmina, then two — a narrow instrument and a wide trace-sized one.
    await (await reading(page, "now")).click();
    await expect(liveLaminas(page)).toHaveCount(1);
    await expect.poll(async () => clashes(await chrome(page))).toEqual([]);
    await project(page, "doc:/tmp/nucleo-shell.md");
    await expect(liveLaminas(page)).toHaveCount(2);
    // The lâminas stop above the whole voice, intents included.
    await expect
      .poll(async () => {
        const c = await chrome(page);
        return [clashes(c), c.laminas.length];
      })
      .toEqual([[], 2]);
    // In a scene too: the Runs river keeps the same clearances.
    await page.keyboard.press("3");
    await arrived(page, "runs");
    await project(page, "now");
    await project(page, "doc:/tmp/nucleo-shell.md");
    await expect(liveLaminas(page)).toHaveCount(2);
    await expect.poll(async () => clashes(await chrome(page))).toEqual([]);
  });

  test(`the HUD and the spine stand clear in every scene at ${w}×${h}`, async ({ page }) => {
    await openShell(page, "/", { width: w, height: h });
    for (const scene of Object.keys(PATHS)) {
      await page.goto(`/#${PATHS[scene]}`);
      await arrived(page, scene);
      await expect
        .poll(async () => {
          const c = await chrome(page);
          const hits = clashes(c).map((x) => `${scene}: ${x}`);
          // The module you are in is always on screen, lit.
          if (!c.spine.some((b) => b.scene === scene)) hits.push(`${scene}: its module is hidden`);
          return hits;
        })
        .toEqual([]);
      await expect(spineModule(page, scene)).toHaveAttribute("aria-current", "page");
      await expect(spineModule(page, scene)).toBeInViewport({ ratio: 1 });
    }
  });
}

test("the voice line is in every scene, in the same place, and / reaches it", async ({ page }) => {
  await openShell(page);
  let first: Box | null = null;
  for (const scene of Object.keys(PATHS)) {
    await page.goto(`/#${PATHS[scene]}`);
    await arrived(page, scene);
    const input = page.locator(".cons-input");
    await expect(input).toBeVisible();
    await expect(input).toBeInViewport({ ratio: 1 });
    // Nothing is drawn over it: its middle answers to itself.
    const onTop = await input.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || el.contains(hit);
    });
    expect(onTop, `${scene}: the voice line is covered`).toBe(true);
    const row = (await page.locator(".nu-voice .cons-row").boundingBox())!;
    first ??= row;
    expect(Math.abs(row.x - first.x), `${scene}: the line moved sideways`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(row.y + row.height - (first.y + first.height)),
      `${scene}: the line moved`,
    ).toBeLessThanOrEqual(1);
    await blur(page);
    await page.keyboard.press("/");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
  }
});

test("the voice line's context and controls fold behind one button, remembered", async ({ page }) => {
  await openShell(page);
  const toggle = page.locator(".cons-more");
  const side = page.locator("#cons-side");
  await expect(toggle).toHaveAccessibleName(/Context and controls|Contexto e controles/);
  await expect(toggle).toHaveAttribute("aria-controls", "cons-side");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(side).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(side).toBeVisible();
  // The tray and the controls live there: the folder, the mode, a new chat.
  await expect(side.locator(".cons-tray")).toBeVisible();
  await expect(side.locator("select.cons-cwd")).toBeVisible();
  await expect(side.getByRole("radiogroup")).toBeVisible();
  // The line itself stays where it was and stays usable.
  await expect(page.locator(".cons-input")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".cons-send")).toBeInViewport({ ratio: 1 });
  await page.reload();
  await expect(page.locator("#cons-side")).toBeVisible();
  await page.locator(".cons-more").click();
  await expect(page.locator("#cons-side")).toBeHidden();
  await page.reload();
  await expect(page.locator(".cons-more")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#cons-side")).toBeHidden();
});

test.describe("on a phone", () => {
  test.use({ hasTouch: true });

  test("the Núcleo renders without sideways scroll, with a usable voice line and a spine row", async ({
    page,
  }) => {
    // A long pendência, so the hub's ticker has something to run into.
    await page.route("**/api/notifications?*", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "n_long",
              kind: "system",
              title: "A very long notice about something that needs a look before the end of the day",
              ts: Date.now(),
              read: false,
              tone: "warn",
            },
          ],
          unread: 1,
        },
      }),
    );
    await openShell(page, "/", { width: 390, height: 844 });
    await arrived(page, "nucleo");
    await expect(page.locator('.nu-nucleo[data-onboarding="desktop"]')).toBeVisible();
    await expect(page.locator(".nu-core-orb")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
    // The hub's ticker stops short of the telemetry instead of running under it.
    await expect(page.locator(".nu-hub-tick")).toContainText("A very long notice");
    const tick = (await page.locator(".nu-hub-tick").boundingBox())!;
    const teleLeft = await page.locator(".nu-tele").evaluate((el) =>
      Math.min(
        ...Array.from(el.children)
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => r.left),
      ),
    );
    expect(tick.x + tick.width).toBeLessThanOrEqual(teleLeft);
    await expect(page.getByTestId("pending-hub")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("nu-clock")).toBeInViewport({ ratio: 1 });

    const input = page.locator(".cons-input");
    await expect(input).toBeInViewport({ ratio: 1 });
    await input.fill("What changed today?");
    await expect(input).toHaveValue("What changed today?");
    await expect(page.locator(".cons-send")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".cons-send")).toBeEnabled();
    await input.fill("");
    // A lâmina fits the phone too.
    await project(page, "cost");
    await expect(lamina(page, "cost")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
    // Once it has materialised (the entrance grows it out of what asked for it).
    await expect(lamina(page, "cost")).not.toHaveClass(/\bfresh\b/);
    await expect
      .poll(async () => {
        const box = (await lamina(page, "cost").boundingBox())!;
        return box.x >= 0 && box.x + box.width <= 390;
      })
      .toBe(true);

    // The spine is a row under the HUD: it scrolls sideways on its own (the
    // page does not), and its modules are one tap away.
    const spine = page.locator("nav.nu-spine");
    const row = (await spine.boundingBox())!;
    expect(row.width).toBeLessThanOrEqual(390);
    expect(await spine.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await spineModule(page, "brain").tap();
    await arrived(page, "brain");
    await spineModule(page, "runs").tap();
    await arrived(page, "runs");
    // Far down the row, past the edge: scroll the row, then tap.
    const settings = spineModule(page, "settings");
    await spine.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }));
    await expect(settings).toBeInViewport({ ratio: 1 });
    await settings.tap();
    await arrived(page, "settings");
    await expect(settings).toHaveAttribute("aria-current", "page");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(2);
    // Other scenes stay inside the phone as well.
    for (const scene of ["brain", "runs", "skills", "routines", "settings"]) {
      await page.goto(`/#${PATHS[scene]}`);
      await arrived(page, scene);
      expect(await horizontalOverflow(page), scene).toBeLessThanOrEqual(2);
      await expect(page.locator(".cons-input"), scene).toBeInViewport({ ratio: 1 });
      // The row never runs under the HUD or the voice.
      const c = await chrome(page);
      for (const b of c.spine) {
        expect(overlaps(b, c.hub), `${scene}: spine:${b.scene} × hub`).toBe(false);
        expect(overlaps(b, c.voice), `${scene}: spine:${b.scene} × voice`).toBe(false);
      }
    }
  });
});

test("nothing slides the shell sideways: it clips, it does not scroll", async ({ page }) => {
  await openShell(page, "/routines");
  await arrived(page, "routines");
  await project(page, "doc:/tmp/nucleo-shell.md");
  await expect(liveLaminas(page)).toHaveCount(1);
  // Bring something under the lâmina into view the way focus and automation do.
  await page
    .locator(".rts-row")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await page.locator(".nu-voice .cons-send").evaluate((el) => el.scrollIntoView({ inline: "end" }));
  const scrolled = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".nu-shell, .nu-shell *"))
      .filter(
        (el) =>
          el.scrollLeft !== 0 &&
          getComputedStyle(el).overflowX !== "auto" &&
          getComputedStyle(el).overflowX !== "scroll",
      )
      .map((el) => `${el.tagName}.${el.className}`),
  );
  expect(scrolled).toEqual([]);
  const hub = (await page.locator(".nu-hub").boundingBox())!;
  expect(hub.x).toBeGreaterThanOrEqual(0);
});

test("the telemetry reads the day, signs the corner and opens what it names", async ({ page }) => {
  await openShell(page, "/", { width: 1600, height: 900 });
  const tele = page.locator(".nu-tele");
  // Text in the corner, not cards: a label and a value each, no sparkline.
  // What needs you is not here any more: it is the pendências' (top-left).
  const items = tele.locator(".nu-t[data-item]");
  const ids = await items.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.item));
  expect(ids.filter((id) => id !== "mission")).toEqual(["provider", "cost", "runs"]);
  for (const id of ids) {
    await expect(tele.locator(`.nu-t[data-item="${id}"]`)).toHaveAttribute(
      "data-l",
      /^(idle|info|warn|crit)$/,
    );
    await expect(tele.locator(`.nu-t[data-item="${id}"] svg`)).toHaveCount(0);
  }
  await expect(tele.locator('.nu-t[data-item="attention"], .nu-bell')).toHaveCount(0);
  await expect(page.locator(".nu-bell")).toHaveCount(0);
  await expect(page.getByTestId("provider-state")).not.toBeEmpty();
  await expect(page.getByTestId("nu-clock")).toHaveText(/^\d{2}:\d{2}$/);
  // It ends with the system's signature.
  const last = await tele.evaluate((el) => (el.lastElementChild as HTMLElement).className);
  expect(last).toBe("nu-sign");
  await expect(tele.locator(".nu-sign")).toHaveText(/·OS$/);
  // Each reading with somewhere to go goes there.
  await tele.locator('.nu-t[data-item="cost"]').click();
  await expect(lamina(page, "cost")).toBeVisible();
  await tele.locator('.nu-t[data-item="runs"]').click();
  await expect(page).toHaveURL(/#\/runs$/);
  await arrived(page, "runs");
  await tele.locator('.nu-t[data-item="provider"]').click();
  await expect(page).toHaveURL(/#\/settings\?tab=providers$/);
  await arrived(page, "settings");
  await expect(page.locator("#settings-tabs-panel-providers")).toBeVisible();
});

for (const [w, h] of [
  [1280, 720],
  [1024, 768],
] as const) {
  test(`at ${w} px nothing in the telemetry is cut, the clock stays on screen and nothing runs under the title`, async ({
    page,
  }) => {
    await openShell(page, "/", { width: w, height: h });
    for (const scene of ["nucleo", "runs", "settings", "generations"]) {
      await page.goto(`/#${PATHS[scene]}`);
      await arrived(page, scene);
      const fits = await page.locator(".nu-tele").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `${scene}: the telemetry overflows`).toBe(true);
      const cut = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>(".nu-tele .nu-t .v, .nu-tele .nu-t .k")).filter(
            (el) => el.offsetWidth > 0 && el.scrollWidth > el.clientWidth + 1,
          ).length,
      );
      expect(cut, `${scene}: a reading is clipped`).toBe(0);
      await expect(page.getByTestId("nu-clock")).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId("pending-hub")).toBeInViewport({ ratio: 1 });
      // The signature is the first to step back on a narrow desktop.
      if (w > 1260) await expect(page.locator(".nu-sign")).toBeInViewport({ ratio: 1 });
      else await expect(page.locator(".nu-sign")).toBeHidden();
      // The hub, the title and the telemetry's readings share the top line
      // without touching (the telemetry's box is its readings, drawn from the right).
      const hub = (await page.locator(".nu-hub").boundingBox())!;
      const title = (await page.locator(".nu-title").boundingBox())!;
      const tele = await page.locator(".nu-tele").evaluate((el) => {
        const boxes = Array.from(el.children)
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const x = Math.min(...boxes.map((r) => r.left));
        const right = Math.max(...boxes.map((r) => r.right));
        const r = el.getBoundingClientRect();
        return { x, y: r.y, width: right - x, height: r.height };
      });
      expect(overlaps(hub, tele), `${scene}: hub × telemetry`).toBe(false);
      expect(overlaps(hub, title), `${scene}: hub × title`).toBe(false);
      expect(overlaps(title, tele), `${scene}: title × telemetry`).toBe(false);
    }
  });
}

test("deep links land inside a scene: a skill's detail sheet, a routine's line, back and forward", async ({
  page,
  request,
}) => {
  await openShell(page, "/skills/code-review?d=1");
  await arrived(page, "skills");
  const sheet = page.locator(".sks-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("/code-review");
  // Escape folds the sheet and keeps the choice: the scene's own Escape comes first.
  await blur(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/skills\/code-review$/);
  await expect(page.locator(".sks-name")).toBeVisible();

  const routines = (await (
    await request.get("/api/routines", { headers: { "x-mordomo-token": process.env.MORDOMO_TOKEN! } })
  ).json()) as Array<{ id: string; name: string }>;
  const routine = routines[0]!;
  await page.goto(`/#/routines?r=${encodeURIComponent(routine.id)}`);
  await arrived(page, "routines");
  const line = page.locator(`.rts-item.on[data-routine="${routine.id}"]`);
  await expect(line).toBeVisible();
  await expect(line.getByRole("region")).toContainText(/Run now|Executar agora/);
  // Back walks out through the scenes the way they were visited.
  await page.goBack();
  await arrived(page, "skills");
  await expect(page).toHaveURL(/#\/skills\/code-review/);
  await page.goForward();
  await arrived(page, "routines");
  await expect(line).toBeVisible();
});

/* ---- round 2: the pendências, focus, intents and the agent's body ----------- */

/** A pending approval and a fresh failure, as the API would list them. */
async function stubDecisionAndFailure(page: Page) {
  const now = Date.now();
  await page.route("**/api/approvals", (route) =>
    route.fulfill({
      json: [
        {
          id: "appr_fixture",
          createdAt: now - 60_000,
          kind: "write_run",
          description: "Write-mode prompt run with claude: fixture decision",
          payload: { kind: "prompt", input: { prompt: "fixture decision" } },
          status: "pending",
          resolvedAt: null,
        },
      ],
    }),
  );
  await page.route("**/api/runs?*", (route) =>
    route.fulfill({
      json: [
        { id: "f1", status: "failed", createdAt: now, finishedAt: now, promptSummary: "fixture failure" },
      ],
    }),
  );
}

test("the hub counts what waits on you and opens focus by click, by P and by event", async ({ page }) => {
  await stubDecisionAndFailure(page);
  await openShell(page);
  const hub = page.locator(".nu-hub");
  // A decision is the loudest thing pending: the hub says so.
  await expect(hub).toHaveAttribute("data-level", "decide");
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-pending", "decide");
  await expect(hub.locator(".nu-hub-tick")).not.toBeEmpty();
  await expect(page.getByTestId("pending-hub")).toHaveAccessibleName(/pending|pendente/i);

  // Click: the OS turns toward what waits on you, and everything else recedes.
  const focus = await openPendingFocus(page);
  await expect(page.locator(".nu-os")).toHaveCSS("pointer-events", "none");
  // The count is what the queue holds, notices aside.
  const levels = await focus
    .locator("nav.nu-focus-queue button[data-level]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-level")!));
  const counted = levels.filter((l) => l !== "info").length;
  expect(counted).toBeGreaterThanOrEqual(2);
  await expect(hub.locator(".nu-hub-n")).toHaveText(String(counted));
  // Decide before fix before look before notices, and the first is chosen.
  expect(levels[0]).toBe("decide");
  expect(levels).toContain("fix");
  const ranks = levels.map((l) => LEVEL_RANK[l]!);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  await expect(focus.locator("section.nu-focus-item")).toHaveAttribute("data-level", "decide");
  await expect(focus.locator(".nu-act.primary")).toContainText(/Approve|Aprovar/);
  // ↓ / j and ↑ / k choose.
  const queue = focus.locator("nav.nu-focus-queue button");
  await page.keyboard.press("ArrowDown");
  await expect(queue.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(focus.locator("section.nu-focus-item")).toHaveAttribute("data-level", levels[1]!);
  await page.keyboard.press("k");
  await expect(queue.nth(0)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("j");
  await expect(queue.nth(1)).toHaveAttribute("aria-current", "true");

  // Escape hands the OS back, interactive again.
  await page.keyboard.press("Escape");
  await expect(focusMode(page)).toHaveCount(0);
  await expect(page.locator(".nu-shell")).not.toHaveAttribute("data-focus", /.*/);
  await expect(page.locator(".nu-os")).not.toHaveCSS("pointer-events", "none");
  await (await reading(page, "cost")).click();
  await expect(lamina(page, "cost")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);

  // P opens it from anywhere — but a P typed in the voice line is a letter.
  const input = page.locator(".cons-input");
  await input.click();
  await page.keyboard.type("p");
  await expect(input).toHaveValue("p");
  await expect(focusMode(page)).toHaveCount(0);
  await input.fill("");
  await foldConversation(page);
  await page.keyboard.press("p");
  await expect(focusMode(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(focusMode(page)).toHaveCount(0);
  // And the window event the voice line uses.
  await page.evaluate(() => window.dispatchEvent(new Event("mordomo:focus")));
  await expect(focusMode(page)).toBeVisible();
  await focusMode(page)
    .getByRole("button", { name: /Back to the system|Voltar ao sistema/ })
    .click();
  await expect(focusMode(page)).toHaveCount(0);
});

test("a decision from the voice line waits in the pendências, not in the conversation; A approves it", async ({
  page,
  request,
}) => {
  await openShell(page);
  const voice = page.locator("[data-console]");
  const side = await openVoiceControls(page);
  await side.getByRole("radio", { name: /^(Write|Escrita)$/ }).click();
  await expect(side.getByRole("radio", { name: /^(Write|Escrita)$/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  await voice.locator("textarea").fill("write a note for the focus approval test");
  await voice.locator("textarea").press("Enter");
  const res = (await (await posted).json()) as {
    runId: string;
    status: string;
    pendingApproval: { id: string };
  };
  expect(res.status).toBe("waiting_approval");
  const approvalId = res.pendingApproval.id;
  try {
    // The conversation points at the pendências — and holds no approval box.
    const sent = voice.getByRole("button", { name: /Sent to your pending items|Enviado às suas pendências/ });
    await expect(sent).toBeVisible();
    await expect(sent).toHaveText(/^↖ /);
    const inVoice = page.locator(".nu-voice");
    await expect(inVoice.locator('[data-testid="decision-dock"], .decision-dock')).toHaveCount(0);
    await expect(inVoice.locator(".approval-inline, .tool-approval, .approval-card")).toHaveCount(0);
    await expect(inVoice.getByRole("button", { name: /^(Approve|Aprovar|Deny|Negar)\b/ })).toHaveCount(0);
    await expect(page.locator('[data-testid="console-briefing"]')).toHaveCount(0);
    await expect(page.locator(".nu-hub")).toHaveAttribute("data-level", "decide");

    // The line's link opens focus on the decision; A approves it.
    await sent.click();
    const focus = focusMode(page);
    await expect(focus).toBeVisible();
    const item = focus.locator("section.nu-focus-item");
    await expect(item).toHaveAttribute("data-level", "decide");
    await expect(focus.locator('nav.nu-focus-queue button[aria-current="true"]')).toHaveAttribute(
      "data-level",
      "decide",
    );
    await page.keyboard.press("a");
    await expect
      .poll(async () => (await api(request).get<{ status: string }>(`/api/approvals/${approvalId}`)).status)
      .toBe("approved");
    // Approving leaves focus and follows the run it launched.
    await expect(focus).toHaveCount(0);
    await expect(lamina(page, "run:", "^=")).toHaveCount(1);
    await expect(page.locator(".nu-shell")).not.toHaveAttribute("data-focus", /.*/);
    await expect(sent).toHaveCount(0, { timeout: 20_000 });
    // And the OS is a place again.
    await travelBySpine(page, "brain");
  } finally {
    await settle(request, approvalId);
  }
});

test("⌘⇧A and ⌘⇧D resolve the first decision from anywhere", async ({ page, request }) => {
  await openShell(page, "/runs");
  await arrived(page, "runs");
  const first = await requestWrite(request, "first decision for the shortcut test");
  try {
    await expect(page.locator(".nu-hub")).toHaveAttribute("data-level", "decide");
    await blur(page);
    await page.keyboard.press("ControlOrMeta+Shift+D");
    await expect
      .poll(
        async () => (await api(request).get<{ status: string }>(`/api/approvals/${first.approvalId}`)).status,
      )
      .toBe("denied");
    await expect(focusMode(page)).toHaveCount(0);
  } finally {
    await settle(request, first.approvalId);
  }
});

test("a pendência that arrives after load slips in under the hub, counted once", async ({
  page,
  request,
}) => {
  await openShell(page);
  // What loads with the page is the baseline, not news.
  await expect(page.locator(".nu-hub-slips li")).toHaveCount(0);
  await page.waitForTimeout(5_500);
  await expect(page.locator(".nu-hub-slips li")).toHaveCount(0);
  const before = Number(await page.locator(".nu-hub .nu-hub-n").textContent()) || 0;
  const late = await requestWrite(request, "late decision for the slip test");
  try {
    const slip = page.locator(".nu-hub-slips li[data-level='decide']");
    await expect(slip).toHaveCount(1);
    await expect(slip).toContainText("late decision for the slip test");
    // The decision is one pendência, not also its "approval requested" notice.
    await expect(page.locator(".nu-hub .nu-hub-n")).toHaveText(String(before + 1));
    await expect(page.locator(".nu-hub")).toHaveAttribute("data-level", "decide");
    // It stands below the hub and beside the spine, never over them.
    const box = (await slip.boundingBox())!;
    const hub = (await page.getByTestId("pending-hub").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(hub.y + hub.height);
    for (const mod of await page.locator("nav.nu-spine .nu-mod").all())
      expect(overlaps(box, (await mod.boundingBox())!)).toBe(false);
    // And it leaves by itself, even though the list changed meanwhile.
    await expect(slip).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".nu-hub-slips li")).toHaveCount(0, { timeout: 10_000 });
    // A slip is a way in: a new one opens focus.
    const next = await requestWrite(request, "second late decision for the slip test");
    try {
      await page.locator(".nu-hub-slips li[data-level='decide']").getByRole("button").click();
      await expect(focusMode(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(focusMode(page)).toHaveCount(0);
    } finally {
      await settle(request, next.approvalId);
    }
    // Resolved elsewhere, it leaves the hub (and its slip) without a reload.
    await settle(request, late.approvalId);
    await expect(page.locator(".nu-hub .nu-hub-n")).toHaveText(before > 0 ? String(before) : "✓");
    await expect(page.locator(".nu-hub-slips li")).toHaveCount(0);
  } finally {
    await settle(request, late.approvalId);
  }
});

test("intents sit above the line in the open, empty conversation, fill it on a click and step away while you type", async ({
  page,
}) => {
  await openShell(page);
  const hints = page.locator(".nu-voice .nu-hints .nu-hint");
  const input = page.locator(".cons-input");
  await expect(input).toHaveValue("");
  // Folded, the voice is only the line: no intents.
  await expect(page.locator(".nu-voice .nu-hints")).toBeHidden();
  await openConversation(page);
  await expect(lastTurn(page)).toHaveCount(0);
  await expect(hints.first()).toBeVisible();
  expect(await hints.count()).toBeGreaterThanOrEqual(1);
  expect(await hints.count()).toBeLessThanOrEqual(3);
  const text = (await hints.first().textContent())!.trim();
  expect(text.length).toBeGreaterThan(5);
  // Above the line, not over it — and inside the sheet.
  const row = (await page.locator(".nu-voice .cons-row").boundingBox())!;
  const hint = (await hints.first().boundingBox())!;
  const sheet = (await voiceSheet(page).boundingBox())!;
  expect(hint.y + hint.height).toBeLessThanOrEqual(row.y + 1);
  expect(hint.y).toBeGreaterThanOrEqual(sheet.y);

  await hints.first().click();
  await expect(input).toHaveValue(text);
  await expect(input).toBeFocused();
  await expect(page.locator(".nu-voice .nu-hints")).toBeHidden();
  await input.fill("");
  await expect(hints.first()).toBeVisible();
  await input.pressSequentially("hel");
  await expect(page.locator(".nu-voice .nu-hints")).toBeHidden();
  await input.fill("");
  await expect(hints.first()).toBeVisible();
  // Each scene has its own (travelling folds the conversation; opening it there shows them).
  const home = await hints.allTextContents();
  await blur(page);
  await page.keyboard.press("2");
  await arrived(page, "brain");
  await expect(voiceSheet(page)).not.toHaveAttribute("data-open", /.*/);
  await expect(page.locator(".nu-voice .nu-hints")).toBeHidden();
  await openConversation(page);
  await expect(hints.first()).toBeVisible();
  expect(await hints.allTextContents()).not.toEqual(home);
});

test("the agent's body is drawn: the hero in the Núcleo and the iris on the voice line", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mordomo.renderProfile", "immersive"));
  await openShell(page);
  await arrived(page, "nucleo");
  await expect(page.locator("div.entity.nu-core-orb")).toHaveClass(/\bentity--hero\b/);
  await expect(page.locator(".nu-voice .cons-row .nu-iris div.entity.nu-iris-orb")).toHaveClass(
    /\bentity--iris\b/,
  );
  // The iris opens the line.
  const lead = await page.locator(".nu-voice .cons-row").evaluate((row) => {
    const iris = row.querySelector(".nu-iris")!.getBoundingClientRect();
    const input = row.querySelector(".cons-input")!.getBoundingClientRect();
    return iris.right <= input.left + 1;
  });
  expect(lead).toBe(true);
  await expect.poll(() => entityPainted(page, ".nu-core-orb")).toBe(true);
  await expect.poll(() => entityPainted(page, ".nu-iris-orb")).toBe(true);
  // The iris is there in every scene.
  await page.keyboard.press("3");
  await arrived(page, "runs");
  await expect.poll(() => entityPainted(page, ".nu-iris-orb")).toBe(true);
});

test("without WebGL2 the agent's body falls back to its 2D drawing", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mordomo.renderProfile", "immersive");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (kind === "webgl2") return null;
      return (original as (...a: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof original;
  });
  await openShell(page);
  await arrived(page, "nucleo");
  await expect(page.locator(".nu-core-orb canvas.entity-fallback")).toBeVisible();
  await expect(page.locator(".nu-core-orb canvas.entity-gl")).toHaveCount(0);
  await expect(page.locator(".nu-iris-orb canvas.entity-fallback")).toBeVisible();
  await expect.poll(() => entityPainted(page, ".nu-core-orb")).toBe(true);
  await expect.poll(() => entityPainted(page, ".nu-iris-orb")).toBe(true);
});

test("the Núcleo at rest is the entity and a greeting; the briefing is spoken once the core blooms", async ({
  page,
}) => {
  await openShell(page);
  await arrived(page, "nucleo");
  // The briefing is the agent's speech now, never a box in the console.
  await expect(page.locator('[data-testid="console-briefing"]')).toHaveCount(0);
  // At rest: the greeting and one line that says the core can be touched — no speech.
  const speech = page.locator(".nu-nucleo .nu-caption .nu-speech");
  await expect(page.locator(".nu-caption h1")).toHaveText(
    /^(Good (morning|afternoon|evening)|Bom dia|Boa tarde|Boa noite)\.$/,
  );
  await expect(page.locator(".nu-caption p")).toContainText(/· (touch to open|toque para abrir)/);
  await expect(speech).toHaveCount(0);
  await expect(page.locator(".nu-nucleo")).not.toHaveAttribute("data-speaking", /.*/);
  // Due once per part of the day: this browser has not heard it yet — the bloom says it.
  await bloomCore(page);
  await expect(speech.locator("p").first()).toBeVisible();
  await expect(page.locator(".nu-nucleo")).toHaveAttribute("data-speaking", "");
  await expect(page.locator(".nu-caption-hint")).toHaveCount(0);
  await speech.locator(".nu-speech-ok").click();
  await expect(speech).toHaveCount(0);
  await expect(page.locator(".nu-nucleo")).not.toHaveAttribute("data-speaking", /.*/);
  // Said once: a reload in the same part of the day does not say it again, bloomed or not.
  await page.reload();
  await expect(page.locator(".nu-nucleo")).toBeVisible();
  await expect(page.locator(".nu-caption h1")).not.toBeEmpty();
  await bloomCore(page);
  await expect(speech).toHaveCount(0);
});

/* ---- round 3: the conversation as a sheet, the core's bloom, questions ------- */

async function startRun(request: APIRequestContext, prompt: string): Promise<string> {
  const out = await api(request).post<{ runId: string }>("/api/runs", { prompt, mode: "read_only" });
  await waitRunning(request, out.runId);
  return out.runId;
}

async function waitRunning(request: APIRequestContext, runId: string) {
  await expect
    .poll(
      async () => (await api(request).get<{ run: { status: string } }>(`/api/runs/${runId}`)).run.status,
      {
        timeout: 15_000,
      },
    )
    .toBe("running");
}

/** Leave no run in flight for the next spec. */
async function stopRun(request: APIRequestContext, runId: string) {
  const { run } = await api(request).get<{ run: { status: string } }>(`/api/runs/${runId}`);
  if (run.status === "running" || run.status === "queued")
    await request.post(`/api/runs/${runId}/cancel`, { headers: api(request).headers });
}

const QUESTION = "Por onde começamos?";
/** The agent asks a question mid-run, the way the permission tool parks `AskUserQuestion`. */
async function askQuestion(request: APIRequestContext, runId: string) {
  return api(request).post<{ id: string }>("/api/approvals/tool", {
    runId,
    toolName: "AskUserQuestion",
    input: {
      questions: [{ question: QUESTION, header: "Foco", options: [{ label: "Testes" }, { label: "Docs" }] }],
    },
    toolUseId: `tu_question_${Date.now()}`,
  });
}

async function answersOf(request: APIRequestContext, approvalId: string) {
  const a = await api(request).get<{ status: string; payload: { answers?: Record<string, string> } }>(
    `/api/approvals/${approvalId}`,
  );
  return { status: a.status, answers: a.payload.answers ?? null };
}

test("the conversation rises out of the line when used and folds back, and the scene behind it does not move", async ({
  page,
  request,
}) => {
  await openShell(page);
  await arrived(page, "nucleo");
  const voice = voiceSheet(page);
  const input = page.locator(".cons-input");
  const veil = page.locator(".nu-dialog-veil");
  const floor = () =>
    page.locator(".nu-shell").evaluate((el) => (el as HTMLElement).style.getPropertyValue("--nu-voice-h"));
  const core = async () => (await page.locator(".nu-core").boundingBox())!;

  // Folded, the voice is only the line: the iris, the field, the tools.
  await expect(voice).not.toHaveAttribute("data-open", /.*/);
  await expect(voice.locator(".cons-row .nu-iris")).toBeVisible();
  await expect(input).toBeVisible();
  await expect(voice.locator(".cons-scroll")).toBeHidden();
  await expect(voice.locator(".cons-thread")).toBeHidden();
  await expect(voice.locator(".nu-dialog-head")).toHaveCount(0);
  await expect(veil).toHaveCount(0);
  const rest = await floor();
  expect(rest).toMatch(/^\d+px$/);
  const coreAtRest = await core();

  // A click on the line: the conversation rises, the rest dims — and does not move.
  await input.click();
  await expect(voice).toHaveAttribute("data-open", "");
  await expect(input).toBeFocused();
  await expect(veil).toBeVisible();
  await expect(voice.locator(".nu-dialog-head")).toBeVisible();
  await expect(voice.locator(".cons-thread")).toBeVisible();
  expect(await floor()).toBe(rest);
  const coreOpen = await core();
  expect(Math.abs(coreOpen.x - coreAtRest.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(coreOpen.y - coreAtRest.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(coreOpen.height - coreAtRest.height)).toBeLessThanOrEqual(1);
  // The veil is the way out: a click on it folds the conversation and lets go of the line.
  const vp = page.viewportSize()!;
  await veil.click({ position: { x: vp.width / 2, y: 140 } });
  await expect(voice).not.toHaveAttribute("data-open", /.*/);
  await expect(veil).toHaveCount(0);
  await expect(input).not.toBeFocused();
  expect(await floor()).toBe(rest);

  // `/` reaches it from anywhere; Escape folds it before anything else —
  // the lâmina and the bloomed core stay.
  await project(page, "cost");
  await expect(lamina(page, "cost")).toBeVisible();
  await blur(page);
  await page.keyboard.press("/");
  await expect(input).toBeFocused();
  await expect(voice).toHaveAttribute("data-open", "");
  await page.keyboard.press("Escape");
  await expect(voice).not.toHaveAttribute("data-open", /.*/);
  await expect(input).not.toBeFocused();
  await expect(lamina(page, "cost")).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await page.keyboard.press("Escape");
  await expect(liveLaminas(page)).toHaveCount(0);
  await bloomCore(page);
  await blur(page);
  await page.keyboard.press("/");
  await expect(voice).toHaveAttribute("data-open", "");
  await page.keyboard.press("Escape");
  await expect(voice).not.toHaveAttribute("data-open", /.*/);
  await expect(page.locator(".nu-nucleo")).toHaveAttribute("data-bloom", "");

  // Its own ⌄ folds it too.
  await input.focus();
  await expect(voice).toHaveAttribute("data-open", "");
  await page.getByRole("button", { name: /^(Fold the conversation|Recolher a conversa)$/ }).click();
  await expect(voice).not.toHaveAttribute("data-open", /.*/);

  // Travelling folds it: a new scene is a new subject.
  await input.focus();
  await expect(voice).toHaveAttribute("data-open", "");
  await blur(page);
  await page.keyboard.press("2");
  await arrived(page, "brain");
  await expect(voice).not.toHaveAttribute("data-open", /.*/);
  await expect(veil).toHaveCount(0);

  // While the agent works, the folded line says what it is doing, and opens the conversation.
  const runId = await startRun(request, "[[sleep:10]] a run for the status pill");
  try {
    const status = voice.locator(".nu-voice-status");
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status.locator(".tx")).not.toBeEmpty();
    await status.click();
    await expect(voice).toHaveAttribute("data-open", "");
    await expect(status).toHaveCount(0);
    await foldConversation(page);
    await expect(status).toBeVisible();
  } finally {
    await stopRun(request, runId);
  }
});

test("a request said on the line is followed in the conversation, step by step — nothing is projected", async ({
  page,
}) => {
  await openShell(page);
  await arrived(page, "nucleo");
  await sendPrompt(page, "hello from the sheet [[sleep:4]]");
  const turn = lastTurn(page);
  await expect(turn.locator(".console-msg.you")).toContainText("hello from the sheet");
  // The steps, as they happen, each with its kind.
  await expect(turn.locator(".console-narration li[data-kind]").first()).toBeVisible({ timeout: 10_000 });
  // The intents step away once the conversation has a turn, even with the line empty.
  await expect(page.locator(".cons-input")).toHaveValue("");
  await expect(page.locator(".nu-voice .nu-hints")).toBeHidden();
  // The agent's words are markdown; the trace is one click away — nothing was projected.
  await expect(turn.locator(".console-md").first()).toBeVisible();
  await expect(turn.getByRole("button", { name: /^(Open run|Abrir execução) →$/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(liveLaminas(page)).toHaveCount(0);
  await expect(page.locator(".nu-shell")).toHaveAttribute("data-proj", "0");
  // Folded and opened again, the whole thread is still there.
  await foldConversation(page);
  await expect(liveLaminas(page)).toHaveCount(0);
  await openConversation(page);
  await expect(lastTurn(page).locator(".console-msg.you")).toContainText("hello from the sheet");
});

for (const [w, h] of [
  [1280, 720],
  [1440, 900],
  [2000, 1108],
] as const) {
  test(`at ${w}×${h} the day blooms out of the core on a touch: six readings, clear of each other, on screen`, async ({
    page,
  }) => {
    await openShell(page, "/", { width: w, height: h });
    await arrived(page, "nucleo");
    const layer = page.locator(".nu-readings");
    const petals = layer.locator(".nu-reading");
    const bloom = page.getByTestId("core-bloom");
    await expect(petals).toHaveCount(6);
    // At rest they are folded into the core: unseen, untouchable, out of the tab order.
    await expect(layer).toHaveAttribute("aria-hidden", "true");
    await expect(bloom).toHaveAttribute("aria-expanded", "false");
    const state = () =>
      petals.evaluateAll((els) =>
        els.map((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            id: (el as HTMLElement).dataset.reading!,
            opacity: Number(cs.opacity),
            events: cs.pointerEvents,
            tab: (el as HTMLElement).tabIndex,
            onTop: hit === el || el.contains(hit),
            box: { x: r.x, y: r.y, width: r.width, height: r.height },
          };
        }),
      );
    await expect
      .poll(async () => (await state()).filter((p) => p.opacity > 0.02 || p.events !== "none" || p.onTop))
      .toEqual([]);
    expect((await state()).every((p) => p.tab === -1)).toBe(true);

    await bloom.click();
    await expect(page.locator(".nu-nucleo")).toHaveAttribute("data-bloom", "");
    await expect(bloom).toHaveAttribute("aria-expanded", "true");
    await expect(layer).not.toHaveAttribute("aria-hidden", /.*/);
    expect((await state()).map((p) => p.id).sort()).toEqual(
      ["cost", "now", "pending", "pulse", "routine", "skills"].sort(),
    );
    // Once flown out: each one seen, touchable, on screen, and clear of the others.
    await expect
      .poll(async () => {
        const all = await state();
        const out: string[] = [];
        for (const p of all) {
          if (p.opacity < 0.95) out.push(`${p.id}: not shown`);
          if (p.events === "none") out.push(`${p.id}: not touchable`);
          if (!p.onTop) out.push(`${p.id}: covered`);
          if (p.tab !== 0) out.push(`${p.id}: not in the tab order`);
          if (p.box.x < 0 || p.box.y < 0 || p.box.x + p.box.width > w || p.box.y + p.box.height > h)
            out.push(`${p.id}: leaves the viewport`);
        }
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++)
            if (overlaps(all[i]!.box, all[j]!.box)) out.push(`${all[i]!.id} × ${all[j]!.id}`);
        return out;
      })
      .toEqual([]);

    // Escape folds them back into the core; so does another touch.
    await blur(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".nu-nucleo")).not.toHaveAttribute("data-bloom", /.*/);
    await expect(layer).toHaveAttribute("aria-hidden", "true");
    await expect(page).toHaveURL(/#\/$/);
    await expect
      .poll(async () => (await state()).filter((p) => p.opacity > 0.02 || p.events !== "none"))
      .toEqual([]);
    await bloom.click();
    await expect(page.locator(".nu-nucleo")).toHaveAttribute("data-bloom", "");
    await bloom.click();
    await expect(page.locator(".nu-nucleo")).not.toHaveAttribute("data-bloom", /.*/);
  });
}

test("each reading goes where it says: pendências open focus, skills travel, the rest project lâminas", async ({
  page,
}) => {
  await openShell(page);
  await arrived(page, "nucleo");
  await (await reading(page, "pending")).click();
  await expect(focusMode(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(focusMode(page)).toHaveCount(0);
  await (await reading(page, "routine")).click();
  await expect(lamina(page, "routines")).toBeVisible();
  await lamina(page, "routines")
    .getByRole("button", { name: /^(Dismiss|Dispensar): / })
    .click();
  await expect(liveLaminas(page)).toHaveCount(0);
  await (await reading(page, "skills")).click();
  await expect(page).toHaveURL(/#\/skills$/);
  await arrived(page, "skills");
  // Coming home, the core is at rest again.
  await blur(page);
  await page.keyboard.press("1");
  await arrived(page, "nucleo");
  await expect(page.locator(".nu-nucleo")).not.toHaveAttribute("data-bloom", /.*/);
});

test("a question the agent asks waits in the pendências as a question, answered with a choice, never approved blind", async ({
  page,
  request,
}) => {
  const runId = await startRun(request, "[[sleep:25]] a run that asks a question");
  const q = await askQuestion(request, runId);
  try {
    await openShell(page);
    await expect(page.locator(".nu-hub")).toHaveAttribute("data-level", "decide");
    // ⌘⇧A approves the first decision from anywhere — a question is not one.
    await blur(page);
    await page.keyboard.press("ControlOrMeta+Shift+A");
    const focus = await openPendingFocus(page);
    const item = focus.locator("nav.nu-focus-queue button", { hasText: QUESTION });
    await expect(item).toHaveAttribute("data-level", "decide");
    await item.click();
    const card = focus.getByTestId("agent-question");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Foco");
    await expect(card).toContainText(QUESTION);
    // It is a conversation, not a permission: no approve/deny, no tool JSON.
    await expect(focus.getByRole("button", { name: /^(Approve|Aprovar|Deny|Negar)\b/ })).toHaveCount(0);
    await expect(focus.locator("section.nu-focus-item")).not.toContainText("questions");
    // And A, which approves a decision in focus, does nothing to it.
    await page.keyboard.press("a");
    await page.waitForTimeout(1_000);
    expect(await answersOf(request, q.id)).toEqual({ status: "pending", answers: null });

    // One choice (a radio), then "Answer": the answer goes back with it.
    const send = card.getByRole("button", { name: /^(Answer|Responder)$/ });
    await expect(send).toBeDisabled();
    await expect(card.getByRole("radiogroup")).toBeVisible();
    await card.getByRole("radio", { name: "Testes" }).click();
    await expect(card.getByRole("radio", { name: "Testes" })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByRole("radio", { name: "Docs" })).toHaveAttribute("aria-checked", "false");
    await expect(card.getByRole("textbox")).toBeVisible();
    await send.click();
    await expect
      .poll(() => answersOf(request, q.id))
      .toEqual({ status: "approved", answers: { [QUESTION]: "Testes" } });
    // Answered, it is no longer waiting on you.
    await expect(focus.locator("nav.nu-focus-queue button", { hasText: QUESTION })).toHaveCount(0);
  } finally {
    await settle(request, q.id);
    await stopRun(request, runId);
  }
});

test("a question asked in the conversation is answered where it was asked", async ({ page, request }) => {
  test.setTimeout(60_000);
  await openShell(page);
  const runId = await sendPrompt(page, "[[sleep:25]] ask me where to start");
  await waitRunning(request, runId);
  const q = await askQuestion(request, runId);
  try {
    const turn = lastTurn(page);
    const card = turn.getByTestId("agent-question");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(QUESTION);
    // Not sent away to the pendências: a question is conversation.
    await expect(
      turn.getByRole("button", { name: /Sent to your pending items|Enviado às suas pendências/ }),
    ).toHaveCount(0);
    // Its step says so in words, with the question — not the tool's JSON.
    const steps = turn.locator(".console-narration");
    await expect(steps).toContainText(/asked you a question|fiz uma pergunta a você/);
    await expect(steps).toContainText(QUESTION);
    await expect(steps).not.toContainText("{");
    await card.getByRole("radio", { name: "Docs" }).click();
    await card.getByRole("button", { name: /^(Answer|Responder)$/ }).click();
    await expect
      .poll(() => answersOf(request, q.id))
      .toEqual({ status: "approved", answers: { [QUESTION]: "Docs" } });
    await expect(card).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await settle(request, q.id);
    await stopRun(request, runId);
  }
});

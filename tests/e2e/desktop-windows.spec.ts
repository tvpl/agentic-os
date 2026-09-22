import { expect, test } from "@playwright/test";
import { resetStage, settled, stageBoxes, stageWith } from "./stage";

/**
 * The window model (redesign F4a). Its own file because it rearranges the
 * desktop: sharing a spec file meant inheriting — and leaking — a layout,
 * which is exactly the coupling that broke the neighbouring specs twice.
 */
test("windows drag by their title bar, raise, snap to an edge and persist", async ({ page, request }) => {
  const reset = () => resetStage(request);
  // This spec rearranges the desktop, so it owns its fixture at both ends:
  // it starts from the default composition and hands it back.
  // The stage opens clear (F7), so the windows this spec drags have to be put
  // on it first.
  await stageWith(request, "routines", "cost", "pulse", "now");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  // The desktop persists with a 300 ms debounce; give a neighbouring spec's
  // last write time to land before this one measures anything.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const routines = page.locator('[data-panel="routines"]');
  const header = routines.locator(".panel-title");
  const zOf = (id: string) => page.$eval(`[data-panel="${id}"]`, (e) => Number(getComputedStyle(e).zIndex));

  await settled(routines);
  const before = (await routines.boundingBox())!;
  const grip = (await header.boundingBox())!;
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  // No edit mode: the title bar is the handle, always.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 320, from.y + 160, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await routines.boundingBox())!.x).toBeCloseTo(before.x + 320, -1);

  // Grabbing a window brings it to the front, and the drop must not undo that.
  expect(await zOf("routines")).toBeGreaterThan(await zOf("cost"));

  // Dropping against the left edge snaps to half the stage.
  const moved = (await header.boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(6, 300, { steps: 12 });
  await expect(page.locator(".snap-preview")).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await routines.boundingBox())!.x).toBeLessThan(40);
  // The window animates into its snapped size over 200 ms: polled, because an
  // immediate read lands mid-transition.
  const stageW = await page.$eval(".desktop-widgets", (e) => e.clientWidth);
  await expect.poll(async () => (await routines.boundingBox())!.width).toBeGreaterThan(stageW * 0.42);
  const snapped = (await routines.boundingBox())!;
  expect(snapped.width).toBeLessThan(stageW * 0.55);

  // The arrangement survives a reload.
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  // Asserted against the stage again, not against `snapped`: that reading was
  // taken while the width was still easing into place.
  await expect.poll(async () => (await routines.boundingBox())!.width).toBeGreaterThan(stageW * 0.42);
  expect((await routines.boundingBox())!.width).toBeLessThan(stageW * 0.55);

  // Unmount the app first: it flushes a pending debounced save on unmount, so
  // resetting before that would be undone by the write that follows.
  await page.goto("about:blank");
  await reset();
});

test("the camera pulls back over the stage and a pick returns to it", async ({ page, request }) => {
  const reset = () => resetStage(request);
  // A crowded stage: five windows that overlap and run off the bottom. That is
  // what the camera is for, and it is what makes "everything got smaller and
  // nothing overlaps" a real assertion rather than a property of the default.
  await stageBoxes(request, {
    inbox: { x: 60, y: 30, w: 620, h: 460 },
    cost: { x: 200, y: 140, w: 600, h: 440 },
    pulse: { x: 340, y: 250, w: 620, h: 460 },
    now: { x: 480, y: 330, w: 640, h: 460 },
    routines: { x: 620, y: 420, w: 600, h: 440 },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);

  // The icosphere and its orbital ring are gone (redesign F4b); what is left
  // of them is the presence behind the console.
  await expect(page.locator(".orbit-ring, .orbital-core-btn")).toHaveCount(0);
  await expect(page.locator(".agent-presence")).toHaveCount(1);

  const stage = page.locator(".desktop-widgets");
  const pulse = page.locator('[data-panel="pulse"]');
  await settled(pulse);
  const before = (await pulse.boundingBox())!;
  await page.keyboard.press("\\");
  await expect(stage).toHaveClass(/overview/);
  // Settled with a wait, not `expect.poll(...).not` — a negated poll retries
  // until it passes, so a wrong expectation there hangs instead of failing.
  await page.waitForTimeout(700);
  // The camera has to actually move the stage. Asserting "nothing overlaps"
  // would have passed on the untouched default composition, which already
  // does not overlap — and did, while the transform was being wiped.
  const scaled = await page.$$eval(
    "section.panel",
    (els) => els.filter((e) => (e as HTMLElement).style.transform.includes("scale")).length,
  );
  expect(scaled).toBeGreaterThan(3);
  const shrunk = await page.$$eval(
    "section.panel",
    (els) =>
      els.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width < parseFloat((e as HTMLElement).style.width) - 1;
      }).length,
  );
  expect(shrunk, "the camera pulled back but nothing got smaller").toBeGreaterThan(0);

  // Picking one leaves the camera view and puts that window back, in front.
  await pulse.click({ position: { x: 30, y: 30 } });
  await expect(stage).not.toHaveClass(/overview/);
  await expect.poll(async () => (await pulse.boundingBox())!.x).toBeCloseTo(before.x, -1);
  expect((await pulse.boundingBox())!.width).toBeCloseTo(before.width, -1);
  const z = await page.$$eval("section.panel", (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute("data-panel"), Number(getComputedStyle(e).zIndex)])),
  );
  expect(z.pulse).toBe(Math.max(...Object.values(z as Record<string, number>)));

  await page.goto("about:blank");
  await reset();
});

test("artifact search lists its matches now that the ring is gone", async ({ page }) => {
  await page.route("**/api/artifacts/list*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "a1",
            file: "plan.md",
            path: "/runs/1/plan.md",
            runId: "1",
            skillSlug: "sdd-plan",
            createdAt: Date.now(),
            kind: "markdown",
            title: "Redesign plan",
            folder: "1",
            sizeBytes: 120,
            thumbnail: false,
          },
        ],
        total: 1,
        skills: [],
        folders: [],
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await page.keyboard.press("/");
  await page.locator(".art-search-input").fill("plan");
  // One search, grouped (refino item 52): the artifact group holds the match.
  const hit = page.locator(".art-search-group").first().locator(".art-hit");
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText("Redesign plan");
  // Choosing a match lands the file on the stage (redesign F5) rather than in
  // a modal that closes with itself.
  await hit.click();
  await expect(page.locator('[data-panel="doc:/runs/1/plan.md"]')).toBeVisible();
});

test("a window follows the pointer while it is dragged, not only on release", async ({ page, request }) => {
  const reset = () => resetStage(request);
  await stageWith(request, "routines");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const routines = page.locator('[data-panel="routines"]');
  const header = routines.locator(".panel-title");
  await settled(routines);
  const g = (await header.boundingBox())!;
  const before = (await routines.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 240, g.y + g.height / 2 + 120, { steps: 10 });
  // Mid-drag, before the drop: the window must already be under the pointer.
  // It was not, for a while — an entrance animation left with `fill: both`
  // kept `transform: none` pinned over the inline transform, so the window
  // only jumped into place on release and every test still passed.
  const during = (await routines.boundingBox())!;
  expect(during.x - before.x).toBeGreaterThan(200);
  expect(during.y - before.y).toBeGreaterThan(100);
  await page.mouse.up();
  await page.goto("about:blank");
  await reset();
});

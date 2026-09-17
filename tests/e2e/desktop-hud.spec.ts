/**
 * The HUD (redesign G5): the ambient strip at the top, the dock at the
 * bottom, and the pod arcs in between — editable, and persisted.
 */
import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_HUD, resetStage } from "./stage";

const HEADERS = () => ({ "x-mordomo-token": process.env.MORDOMO_TOKEN! });

// The e2e home is shared: whatever this file does to the arcs is undone,
// pass or fail, before the next spec looks for its pods.
test.afterEach(async ({ request }) => {
  await request.put("/api/settings", { headers: HEADERS(), data: { hud: DEFAULT_HUD } });
});

async function openDesktop(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("[data-console]")).toBeVisible();
}

test("the strip reads the day and opens what it names; the dock lists what is open", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await openDesktop(page);
  const strip = page.locator("header.strip");
  await expect(strip).toBeVisible();
  // Brand, provider·state, day, runs, attention, bell, clock — in that order.
  await expect(strip.locator(".bd")).toContainText(/OS$/);
  const segments = strip.locator(".sg");
  await expect(segments).toHaveCount(5);
  for (const i of [0, 1, 2, 3, 4])
    await expect(segments.nth(i)).toHaveAttribute("data-l", /^(idle|info|warn|crit)$/);
  await expect(strip.locator(".bell")).toBeVisible();
  await expect(segments.nth(4).locator(".v")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  // A segment with somewhere to go opens it on the stage.
  await strip.locator(".sg[data-open]").filter({ hasText: /runs/i }).click();
  await expect(page.locator('[data-panel="app:runs"]')).toBeVisible();
  await strip
    .locator(".sg[data-open]")
    .filter({ hasText: /attention|atenção/i })
    .click();
  await expect(page.locator('[data-panel="attention"]')).toBeVisible();
  // The dock: spaces with their counts, then the open panels — no app icons.
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(dock).toHaveClass(/\bhud\b/);
  await expect(dock.locator(".dock-app")).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "Work", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dock.getByRole("button", { name: "Work", exact: true }).locator(".n")).toHaveText("2");
  await expect(dock.getByRole("button", { name: /^Open panels: / })).toHaveCount(2);
  // Overview from the dock, and back.
  await dock.getByRole("button", { name: /Overview|Visão geral/ }).click();
  await expect(page.locator(".desktop-widgets.overview")).toHaveCount(1);
  await dock.getByRole("button", { name: /Overview|Visão geral/ }).click();
  await expect(page.locator(".desktop-widgets.overview")).toHaveCount(0);
});

test("editing the HUD: ✕ removes a pod, + adds one from the gallery, and both survive a reload", async ({
  page,
  request,
}) => {
  await resetStage(request);
  await request.put("/api/settings", { headers: HEADERS(), data: { hud: DEFAULT_HUD } });
  await openDesktop(page);
  const brain = page.locator('.pod-arc.l .pod[data-pod="app:brain"]');
  await expect(brain).toBeVisible();
  await expect(page.locator('.pod-arc.l .pod[data-pod="cost"]')).toHaveCount(0);
  const dock = page.getByRole("navigation", { name: "Workspace navigation" });
  const edit = dock.getByRole("button", { name: /Edit HUD|Editar HUD/ });
  await edit.click();
  await expect(edit).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".desktop")).toHaveClass(/\bediting\b/);
  // ✕ removes the brain pod.
  await page
    .getByRole("button", { name: /Remove from the HUD: Second Brain|Remover do HUD: Segundo Cérebro/ })
    .click();
  await expect(brain).toHaveCount(0);
  // + on the left arc offers what is not on an arc; the budget reading joins the left.
  await page.locator('.pod-arc.l .pod[data-pod="add:l"]').click();
  const gallery = page.getByRole("dialog", { name: /Add to the HUD|Adicionar ao HUD/ });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('[data-add="app:brain"]')).toHaveCount(1);
  await gallery.locator('[data-add="cost"]').click();
  await expect(gallery).toHaveCount(0);
  await expect(page.locator('.pod-arc.l .pod[data-pod="cost"]')).toBeVisible();
  // Escape leaves the edit; the pods stop wobbling and the ✕ go away.
  await page.keyboard.press("Escape");
  await expect(page.locator(".desktop")).not.toHaveClass(/\bediting\b/);
  await expect(page.locator(".pod-rm")).toHaveCount(0);
  // The composition is the user's now: it comes back after a reload.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator('.pod-arc.l .pod[data-pod="cost"]')).toBeVisible();
  await expect(page.locator('.pod-arc.l .pod[data-pod="app:brain"]')).toHaveCount(0);
  // The new pod is a real one: it opens its surface.
  await page.locator('.pod-arc.l .pod[data-pod="cost"]').click();
  await expect(page.locator('[data-panel="cost"]')).toBeVisible();

  await page.goto("about:blank");
});

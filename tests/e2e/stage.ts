/**
 * The desktop opens clear (redesign F7): nothing is on the stage until a pod,
 * the dock or the agent puts it there — the console is fixed over it (G4). A spec that asserts on a panel therefore has to say which panels its
 * composition needs, rather than inheriting nine of them from a default.
 *
 * Seeding through the settings API rather than through clicks keeps the
 * arrangement out of the assertion: the spec sets the stage, then tests the
 * one behaviour it is about.
 */
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { WIDGET_ORDER } from "../../apps/command-centre/src/desktop/defaultLayout";

/** The apps and their routes (`desktop/apps.tsx`); listed here because that module pulls in the views. */
const APP_ROUTES: Array<[string, string]> = [
  ["brain", "/brain"],
  ["skills", "/skills"],
  ["artifacts", "/artifacts"],
  ["generations", "/generations"],
  ["connectors", "/connectors"],
  ["settings", "/settings"],
  ["routines", "/routines"],
  ["runs", "/runs"],
  ["pixel", "/pixel"],
];

/** The prototype's first composition of the pod arcs (`core/src/config/schema.ts`, G5). */
export const DEFAULT_HUD = {
  l: [
    "app:brain",
    "app:skills",
    "app:artifacts",
    "app:generations",
    "app:connectors",
    "app:settings",
    "app:pixel",
  ],
  r: ["pulse", "attention", "runs", "routines", "inbox"],
};

/** Boxes are laid out on a plain grid: specs measure windows against themselves. */
const COL_W = 320;
const ROW_H = 260;
const COLS = 3;

function box(i: number) {
  return {
    x: 90 + (i % COLS) * (COL_W + 16),
    y: 20 + Math.floor(i / COLS) * (ROW_H + 16),
    w: COL_W,
    h: ROW_H,
    z: i + 1,
    visible: true,
    minimized: false,
  };
}

/**
 * Put these widgets on the stage. Resets everything else, so a spec that calls
 * this owns its fixture outright.
 *
 * The boxes are complete on purpose: a partial entry fails the layout schema,
 * and the schema degrades an unreadable layout to `{}` rather than throwing —
 * a half-written fixture would silently seed nothing at all.
 */
export async function stageWith(request: APIRequestContext, ...ids: string[]): Promise<void> {
  return stageBoxes(request, Object.fromEntries(ids.map((id, i) => [id, box(i)])));
}

/**
 * The same, with the boxes spelled out — for a spec whose subject is geometry
 * (overview, snapping, reflow) and that needs a stage of a particular shape.
 */
export async function stageBoxes(
  request: APIRequestContext,
  boxes: Record<string, { x: number; y: number; w: number; h: number }>,
): Promise<void> {
  // The API deep-merges the layout record, so leaving a widget out would leave
  // whatever a neighbouring spec put there. Every known id is named: the ones
  // asked for are placed, the rest are explicitly off the stage.
  const ids = Object.keys(boxes);
  const dashboardLayout: Record<string, ReturnType<typeof box> & { config?: Record<string, string> }> = {};
  WIDGET_ORDER.forEach((id, i) => {
    dashboardLayout[id] = { ...box(i), visible: false };
  });
  // App panels persist their own path and query (the brain's zoom and
  // selection live there — G2). The merge keeps whatever a neighbouring spec
  // left in them, so every app is parked and sent back to its root here.
  APP_ROUTES.forEach(([kind, route], i) => {
    dashboardLayout[`app:${kind}`] = { ...box(i), visible: false, config: { path: route, search: "" } };
  });
  ids.forEach((id, i) => {
    dashboardLayout[id] = { ...boxes[id]!, z: i + 1, visible: true, minimized: false };
  });
  const res = await request.put("/api/settings", {
    headers: { "x-mordomo-token": process.env.MORDOMO_TOKEN! },
    data: { dashboardLayout, spaces: {}, activeSpace: "work", hud: DEFAULT_HUD },
  });
  if (!res.ok()) throw new Error(`could not seed the stage: ${res.status()} ${await res.text()}`);
  // An unreadable layout degrades to `{}` instead of throwing (see the schema),
  // so a half-written fixture would silently seed nothing. Read it back.
  const saved = (
    (await res.json()) as { settings: { dashboardLayout?: Record<string, { visible?: boolean }> } }
  ).settings.dashboardLayout;
  const missing = ids.filter((id) => !saved?.[id]?.visible);
  if (missing.length) throw new Error(`the stage did not keep: ${missing.join(", ")}`);
}

/** Hand the desktop back at its default composition: a clear stage (the console is fixed, not a window — G4). */
export async function resetStage(request: APIRequestContext): Promise<void> {
  // An empty record is how "no user layout" is expressed, but the merge would
  // keep the old one, so the defaults are written out explicitly.
  const dashboardLayout: Record<string, ReturnType<typeof box> & { config?: Record<string, string> }> = {};
  WIDGET_ORDER.forEach((id, i) => {
    dashboardLayout[id] = { ...box(i), visible: false };
  });
  APP_ROUTES.forEach(([kind, route], i) => {
    dashboardLayout[`app:${kind}`] = { ...box(i), visible: false, config: { path: route, search: "" } };
  });
  const res = await request.put("/api/settings", {
    headers: { "x-mordomo-token": process.env.MORDOMO_TOKEN! },
    // The pod arcs come back to the default too: a spec that edited the HUD
    // must not leave the next one without its brain pod.
    data: { dashboardLayout, spaces: {}, activeSpace: "work", hud: DEFAULT_HUD },
  });
  if (!res.ok()) throw new Error(`could not reset the stage: ${res.status()}`);
}

/**
 * Wait until a window has stopped moving.
 *
 * Windows animate into place on load, so a spec that measures or grabs one
 * immediately after `goto`/`reload` can read a box from mid-flight — and a
 * pointer aimed at that box lands on the memory field behind it instead of on
 * the title bar. Two identical reads in a row mean the entrance is over.
 */
export async function settled(window: Locator): Promise<void> {
  let last = "";
  await expect
    .poll(async () => {
      const box = JSON.stringify(await window.boundingBox());
      const stable = box === last;
      last = box;
      return stable;
    })
    .toBe(true);
}

/**
 * Open one of the OS's apps as a panel through the launcher (⌘K / Ctrl+M).
 * The dock lists open panels, not apps (G5), and only the default HUD's
 * apps have a pod, so the launcher is the one door every app shares.
 */
export async function openAppFromPalette(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+M");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("option", { name, exact: true }).click();
  await expect(page.locator(".launcher")).toHaveCount(0);
}

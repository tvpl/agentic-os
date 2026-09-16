/**
 * What the desktop knows about its widgets independently of geometry: which
 * ids exist, in what order they render, how a duplicate id ("today:2") maps
 * back to its base, and when the viewport is too small for windows at all.
 *
 * The geometry itself moved to `windowModel.ts` / `defaultWindows.ts` when
 * the grid became a window manager (redesign F4a).
 */

/**
 * Below this viewport width the desktop stacks widgets in one column. Free
 * windows need room to be arranged; narrower than this, a single scrolling
 * column is the honest layout.
 */
export const STACK_BREAKPOINT = 1024;
/**
 * Shortest usable stage. When the viewport cannot give this much height, the
 * windows would be slivers and the stacked column wins instead.
 */
export const MIN_STAGE_H = 520;

export function shouldStack(width: number, height: number): boolean {
  return width < STACK_BREAKPOINT || height < MIN_STAGE_H;
}

/** Registered widget ids, in render / tab order. */
export const WIDGET_ORDER = [
  "now",
  "routines",
  "pulse",
  "attention",
  "approvals",
  "prompt",
  "inbox",
  "cost",
] as const;
export type WidgetId = (typeof WIDGET_ORDER)[number];

export function isWidgetId(id: string): id is WidgetId {
  return (WIDGET_ORDER as readonly string[]).includes(id);
}

/** Render order: registry order first, then everything else (documents, apps, runs) by id. */
export function orderedIds(ids: readonly string[]): string[] {
  const rank = (id: string) => {
    const i = WIDGET_ORDER.indexOf(id as WidgetId);
    return i === -1 ? WIDGET_ORDER.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

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
  "microapps",
  "today",
  "workspace",
  "deck",
  "routines",
  "pulse",
  "attention",
  "prompt",
  "inbox",
  "agenda",
  "calendar",
  "email",
  "cost",
] as const;
export type WidgetId = (typeof WIDGET_ORDER)[number];

/** "today:2" → "today"; "today" → "today". */
export function baseId(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(0, i);
}
export function isWidgetId(id: string): id is WidgetId {
  return (WIDGET_ORDER as readonly string[]).includes(id);
}

/** Render order: registry order first, duplicates right after their base. */
export function orderedIds(ids: readonly string[]): string[] {
  const rank = (id: string) => {
    const i = WIDGET_ORDER.indexOf(baseId(id) as WidgetId);
    return i === -1 ? WIDGET_ORDER.length : i;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The next free "base:n" id for a duplicable widget. */
export function nextDuplicateId(layout: Record<string, unknown>, base: string): string {
  for (let n = 2; n < 100; n++) {
    const id = `${base}:${n}`;
    if (!layout[id]) return id;
  }
  return `${base}:99`;
}

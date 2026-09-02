/**
 * Desktop grid constants, the default widget layout and the pure functions
 * that validate a persisted layout against the grid that is actually on
 * screen. Kept free of React so it can be unit-tested.
 *
 * Persisted format (settings.dashboardLayout) is unchanged:
 *   Record<widgetId, { x, y, w, h, visible }>
 */

export const COLS = 24;
export const GRID_TOP = 96;
export const GRID_PAD = 16;
/** Below this viewport width the desktop stacks widgets in one column. */
export const STACK_BREAKPOINT = 900;
/** Target row height; rows = max(MIN_ROWS, floor(available / ROW_TARGET_PX)). */
export const ROW_TARGET_PX = 40;
/**
 * The default layout needs 17 rows. Guaranteeing at least 18 rows means the
 * default fits at 1024×768 (656px available → 36px per row) instead of being
 * clipped as it was with the old 44px rows (14 rows).
 */
export const MIN_ROWS = 18;
export const MIN_W = 3;
export const MIN_H = 2;

export interface WidgetBox {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}
export type LayoutMap = Record<string, WidgetBox>;

export const WIDGET_ORDER = ["microapps", "today", "workspace", "deck", "routines", "pulse", "attention"] as const;
export type WidgetId = (typeof WIDGET_ORDER)[number];

export const DEFAULT_LAYOUT: LayoutMap = {
  microapps: { x: 0, y: 0, w: 5, h: 6, visible: true },
  today: { x: 0, y: 6, w: 5, h: 7, visible: true },
  workspace: { x: 0, y: 13, w: 5, h: 4, visible: true },
  deck: { x: 19, y: 0, w: 5, h: 9, visible: true },
  routines: { x: 19, y: 9, w: 5, h: 4, visible: true },
  pulse: { x: 19, y: 13, w: 5, h: 4, visible: true },
  attention: { x: 6, y: 14, w: 12, h: 3, visible: true },
};

export function computeRows(availableHeightPx: number): number {
  return Math.max(MIN_ROWS, Math.floor(availableHeightPx / ROW_TARGET_PX));
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(min, Math.min(max, n));
};

export function overlaps(a: WidgetBox, b: WidgetBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Clamp one box into a rows×cols grid (size first, then position). */
export function clampBox(box: Partial<WidgetBox> | undefined, fallback: WidgetBox, rows: number, cols = COLS): WidgetBox {
  const w = clampInt(box?.w, MIN_W, cols, fallback.w);
  const h = clampInt(box?.h, MIN_H, rows, fallback.h);
  const x = clampInt(box?.x, 0, cols - w, fallback.x);
  const y = clampInt(box?.y, 0, rows - h, fallback.y);
  const visible = typeof box?.visible === "boolean" ? box.visible : fallback.visible;
  return { x, y, w, h, visible };
}

/**
 * Merge a persisted layout over the defaults and make it valid for the
 * current grid: unknown ids dropped, boxes clamped, and — if clamping made
 * two visible widgets overlap — the later one (in WIDGET_ORDER, then by y)
 * is pushed down until it is free. If it cannot fit below, it stays at the
 * bottom (a visible overlap beats a widget lost off-screen).
 */
export function normalizeLayout(persisted: Partial<Record<string, Partial<WidgetBox>>> | undefined, rows: number, cols = COLS): LayoutMap {
  const out: LayoutMap = {};
  for (const id of WIDGET_ORDER) out[id] = clampBox(persisted?.[id], DEFAULT_LAYOUT[id]!, rows, cols);

  const placed: WidgetBox[] = [];
  const ids = [...WIDGET_ORDER].sort((a, b) => out[a]!.y - out[b]!.y || WIDGET_ORDER.indexOf(a) - WIDGET_ORDER.indexOf(b));
  for (const id of ids) {
    const box = out[id]!;
    if (!box.visible) continue;
    let y = box.y;
    let guard = 0;
    while (placed.some((p) => overlaps({ ...box, y }, p)) && y + box.h < rows && guard++ < rows) y += 1;
    if (placed.some((p) => overlaps({ ...box, y }, p))) {
      // No free slot below: try the original spot and accept the overlap.
      y = box.y;
    }
    out[id] = { ...box, y };
    placed.push(out[id]!);
  }
  return out;
}

export function layoutsEqual(a: LayoutMap, b: LayoutMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) return false;
    if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.visible !== y.visible) return false;
  }
  return true;
}

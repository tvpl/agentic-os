/**
 * Desktop grid constants, the default widget layout and the pure functions
 * that validate a persisted layout against the grid that is actually on
 * screen. Kept free of React so it can be unit-tested.
 *
 * Persisted format (settings.dashboardLayout):
 *   Record<widgetId, { x, y, w, h, visible, config? }>
 * `widgetId` is a registry id ("today") or a duplicate ("today:2").
 */

export const COLS = 24;
export const GRID_TOP = 96;
export const GRID_PAD = 16;
/** Below this viewport width the desktop stacks widgets in one column. */
export const STACK_BREAKPOINT = 900;
/** Target row height; rows = max(MIN_ROWS, floor(available / ROW_TARGET_PX)). */
export const ROW_TARGET_PX = 38;
/**
 * The default layout needs 20 rows: the left and right columns are sized to
 * their content (micro apps 7, today 8, workspace 5 / deck 10, routines 5,
 * pulse 5) and the prompt + attention strip sits at the bottom of the centre
 * column. Guaranteeing 20 rows keeps that composition at 1024×768 (656px
 * available → 32.8px per row); widgets scroll internally when shorter.
 */
export const MIN_ROWS = 20;
export const MIN_W = 3;
export const MIN_H = 2;

export type WidgetConfig = Record<string, unknown>;

export interface WidgetBox {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  /** Per-widget settings (registry `configSchema`); absent when untouched. */
  config?: WidgetConfig;
}
export type LayoutMap = Record<string, WidgetBox>;

/** Registered widget ids, in render / tab order. */
export const WIDGET_ORDER = [
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

export const DEFAULT_LAYOUT: LayoutMap = {
  microapps: { x: 0, y: 0, w: 5, h: 7, visible: true },
  today: { x: 0, y: 7, w: 5, h: 8, visible: true },
  workspace: { x: 0, y: 15, w: 5, h: 5, visible: true },
  deck: { x: 19, y: 0, w: 5, h: 10, visible: true },
  routines: { x: 19, y: 10, w: 5, h: 5, visible: true },
  pulse: { x: 19, y: 15, w: 5, h: 5, visible: true },
  prompt: { x: 6, y: 12, w: 12, h: 6, visible: true },
  attention: { x: 6, y: 18, w: 12, h: 2, visible: true },
  inbox: { x: 6, y: 0, w: 6, h: 4, visible: false },
  agenda: { x: 12, y: 0, w: 6, h: 3, visible: false },
  calendar: { x: 6, y: 4, w: 5, h: 5, visible: false },
  email: { x: 13, y: 4, w: 5, h: 5, visible: false },
  cost: { x: 19, y: 15, w: 5, h: 5, visible: false },
};

/** Pixel rectangle of the desktop area left free by the visible widgets. */
export interface FreeRegion {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The region between the left and right widget columns and above the
 * widgets that span the centre: where the core, the Now panel and the
 * artifact ring live. Widgets whose box ends in the left half push the left
 * edge in, boxes that start in the right half push the right edge in, and a
 * box crossing the middle column pushes the top or bottom edge depending on
 * which half of the grid it sits in. Pure so it can be unit-tested.
 */
export function freeRegion(
  layout: LayoutMap,
  m: { width: number; height: number; rows: number; cellW: number; cellH: number },
  cols = COLS,
): FreeRegion {
  let left = GRID_PAD;
  let right = m.width - GRID_PAD;
  let top = GRID_TOP;
  let bottom = m.height - GRID_PAD;
  const mid = cols / 2;
  for (const box of Object.values(layout)) {
    if (!box.visible) continue;
    const px = { left: GRID_PAD + box.x * m.cellW, top: GRID_TOP + box.y * m.cellH };
    const pxRight = px.left + box.w * m.cellW;
    const pxBottom = px.top + box.h * m.cellH;
    if (box.x + box.w <= mid) left = Math.max(left, pxRight);
    else if (box.x >= mid) right = Math.min(right, px.left);
    else if (box.y + box.h / 2 >= m.rows / 2) bottom = Math.min(bottom, px.top);
    else top = Math.max(top, pxBottom);
  }
  if (right - left < 200) {
    left = GRID_PAD;
    right = m.width - GRID_PAD;
  }
  if (bottom - top < 160) {
    top = GRID_TOP;
    bottom = m.height - GRID_PAD;
  }
  return { left, right, top, bottom };
}

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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Clamp one box into a rows×cols grid (size first, then position). `config` is carried through untouched. */
export function clampBox(
  box: Partial<WidgetBox> | undefined,
  fallback: WidgetBox,
  rows: number,
  cols = COLS,
): WidgetBox {
  const w = clampInt(box?.w, MIN_W, cols, fallback.w);
  const h = clampInt(box?.h, MIN_H, rows, fallback.h);
  const x = clampInt(box?.x, 0, cols - w, fallback.x);
  const y = clampInt(box?.y, 0, rows - h, fallback.y);
  const visible = typeof box?.visible === "boolean" ? box.visible : fallback.visible;
  const config = isPlainObject(box?.config)
    ? box.config
    : isPlainObject(fallback.config)
      ? fallback.config
      : undefined;
  return config ? { x, y, w, h, visible, config } : { x, y, w, h, visible };
}

/** Deterministic order: registry order first, then duplicates ("id:n") by id. */
export function orderedIds(ids: Iterable<string>): string[] {
  const all = [...new Set(ids)];
  const rank = (id: string) => {
    const b = baseId(id);
    const i = WIDGET_ORDER.indexOf(b as WidgetId);
    return i === -1 ? WIDGET_ORDER.length : i;
  };
  return all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Merge a persisted layout over the defaults and make it valid for the
 * current grid: unknown ids dropped (duplicates of known widgets kept),
 * boxes clamped, `config` preserved, and — if clamping made two visible
 * widgets overlap — the later one (in WIDGET_ORDER, then by y) is pushed
 * down until it is free. If it cannot fit below, it stays at the bottom
 * (a visible overlap beats a widget lost off-screen).
 */
export function normalizeLayout(
  persisted: Partial<Record<string, Partial<WidgetBox>>> | undefined,
  rows: number,
  cols = COLS,
): LayoutMap {
  const out: LayoutMap = {};
  for (const id of WIDGET_ORDER) out[id] = clampBox(persisted?.[id], DEFAULT_LAYOUT[id]!, rows, cols);
  for (const id of Object.keys(persisted ?? {})) {
    if (out[id]) continue;
    const base = baseId(id);
    if (id === base || !isWidgetId(base)) continue; // unknown widget (or a bare unknown id)
    out[id] = clampBox(persisted?.[id], { ...DEFAULT_LAYOUT[base]!, visible: false }, rows, cols);
  }

  const placed: WidgetBox[] = [];
  const rank = new Map(orderedIds(Object.keys(out)).map((id, i) => [id, i]));
  const ids = [...rank.keys()].sort((a, b) => out[a]!.y - out[b]!.y || rank.get(a)! - rank.get(b)!);
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

const configEqual = (a: WidgetConfig | undefined, b: WidgetConfig | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};

export function layoutsEqual(a: LayoutMap, b: LayoutMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (!x || !y) return false;
    if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h || x.visible !== y.visible) return false;
    if (!configEqual(x.config, y.config)) return false;
  }
  return true;
}

/** Next free duplicate id for a registry widget: "today:2", "today:3", … */
export function nextDuplicateId(layout: LayoutMap, base: WidgetId): string {
  let n = 2;
  while (layout[`${base}:${n}`]) n += 1;
  return `${base}:${n}`;
}

/** First free spot (scanning rows then columns) for a w×h box; falls back to the bottom-left. */
export function findFreeSpot(
  layout: LayoutMap,
  w: number,
  h: number,
  rows: number,
  cols = COLS,
): { x: number; y: number } {
  const taken = Object.values(layout).filter((b) => b.visible);
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const probe = { x, y, w, h, visible: true };
      if (!taken.some((b) => overlaps(probe, b))) return { x, y };
    }
  }
  return { x: 0, y: Math.max(0, rows - h) };
}

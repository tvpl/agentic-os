/**
 * The window model (redesign F4a).
 *
 * The desktop stops being a 24-column grid whose widgets push each other out
 * of the way, and becomes a set of windows: free pixel positions, a stacking
 * order, overlap allowed. That is the difference between a dashboard and an
 * OS — two panels can sit side by side because the user put them there, not
 * because a reducer found a free cell.
 *
 * Everything here is pure, so the geometry is testable without a browser.
 * Positions are stored in **pixels of the stage**, like any window manager,
 * and `clampIntoStage` is what makes that safe when the window is resized:
 * a layout saved at 1440×900 and reopened at 1280×800 is pulled back into
 * view instead of leaving panels off-screen.
 */

export interface Size {
  w: number;
  h: number;
}

export interface WindowBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order; higher is nearer the viewer. */
  z: number;
  visible: boolean;
  /** Collapsed to the dock, still in the layout. */
  minimized?: boolean;
  /** Per-widget settings (registry `configSchema`); absent when untouched. */
  config?: Record<string, unknown>;
}

export type WindowMap = Record<string, WindowBox>;

/** Smallest usable window: below this a title bar has nowhere to live. */
export const MIN_W = 240;
export const MIN_H = 120;
/** Room kept clear at the stage edges so a window never hugs the chrome. */
export const STAGE_PAD = 12;
/**
 * How much of a window must stay on stage when it is dragged to the edge.
 * A window can hang off the side — that is how people park things — but its
 * header has to remain grabbable or it is lost.
 */
export const KEEP_VISIBLE = 96;

/* ------------------------------------------------------------------ z --- */

export function topZ(layout: WindowMap): number {
  let top = 0;
  for (const box of Object.values(layout)) if (box.z > top) top = box.z;
  return top;
}

/** Brings one window to the front, leaving every other order untouched. */
export function raise(layout: WindowMap, id: string): WindowMap {
  const box = layout[id];
  if (!box) return layout;
  if (box.z === topZ(layout) && box.z > 0) return layout;
  return { ...layout, [id]: { ...box, z: topZ(layout) + 1 } };
}

/**
 * Rewrites the stacking order as 1..n in its current sequence. Called after
 * a layout is read back so a session that raised windows a few thousand
 * times does not persist ever-growing integers.
 */
export function normalizeZ(layout: WindowMap): WindowMap {
  const ids = Object.keys(layout).sort((a, b) => layout[a]!.z - layout[b]!.z);
  const out: WindowMap = {};
  ids.forEach((id, i) => {
    out[id] = { ...layout[id]!, z: i + 1 };
  });
  return out;
}

/* ----------------------------------------------------------- geometry --- */

export function clampSize(size: Size, min: Size = { w: MIN_W, h: MIN_H }, stage?: Size): Size {
  const maxW = stage ? Math.max(min.w, stage.w - STAGE_PAD * 2) : Number.POSITIVE_INFINITY;
  const maxH = stage ? Math.max(min.h, stage.h - STAGE_PAD * 2) : Number.POSITIVE_INFINITY;
  return {
    w: Math.round(Math.min(maxW, Math.max(min.w, size.w))),
    h: Math.round(Math.min(maxH, Math.max(min.h, size.h))),
  };
}

/**
 * Pulls a window back into a stage it no longer fits. Size is capped first,
 * then the position: a window may hang off an edge, but never so far that
 * `KEEP_VISIBLE` pixels of it are unreachable.
 */
export function clampIntoStage(box: WindowBox, stage: Size, min: Size = { w: MIN_W, h: MIN_H }): WindowBox {
  const { w, h } = clampSize(box, min, stage);
  const keep = Math.min(KEEP_VISIBLE, w);
  const x = Math.round(Math.min(Math.max(box.x, -(w - keep)), Math.max(0, stage.w - keep)));
  // The top edge never goes negative: a header dragged above the stage could
  // not be grabbed back.
  const y = Math.round(Math.min(Math.max(box.y, 0), Math.max(0, stage.h - 32)));
  return { ...box, x, y, w, h };
}

export function clampLayout(
  layout: WindowMap,
  stage: Size,
  minFor: (id: string) => Size = () => ({ w: MIN_W, h: MIN_H }),
): WindowMap {
  const out: WindowMap = {};
  for (const [id, box] of Object.entries(layout)) out[id] = clampIntoStage(box, stage, minFor(id));
  return out;
}

/* --------------------------------------------------------------- snap --- */

export type SnapEdge = "left" | "right" | "top" | null;
/** How close to an edge a pointer must be for the snap preview to arm. */
export const SNAP_THRESHOLD = 24;

/** Which half-stage a pointer at `(x, y)` would snap to, if any. */
export function snapEdgeAt(x: number, y: number, stage: Size): SnapEdge {
  if (y <= SNAP_THRESHOLD) return "top";
  if (x <= SNAP_THRESHOLD) return "left";
  if (x >= stage.w - SNAP_THRESHOLD) return "right";
  return null;
}

/** The box an edge snap resolves to. */
export function snapBox(edge: Exclude<SnapEdge, null>, stage: Size): Omit<WindowBox, "z" | "visible"> {
  const half = Math.round((stage.w - STAGE_PAD * 3) / 2);
  const h = Math.max(MIN_H, stage.h - STAGE_PAD * 2);
  if (edge === "top") return { x: STAGE_PAD, y: STAGE_PAD, w: stage.w - STAGE_PAD * 2, h };
  return { x: edge === "left" ? STAGE_PAD : STAGE_PAD * 2 + half, y: STAGE_PAD, w: half, h };
}

/* ---------------------------------------------------------- arrangement --- */

/** Spreads every open window over the stage in a grid, largest area first. */
export function tile(layout: WindowMap, stage: Size): WindowMap {
  const ids = Object.keys(layout).filter((id) => layout[id]!.visible && !layout[id]!.minimized);
  if (ids.length === 0) return layout;
  const cols = ids.length <= 2 ? ids.length : Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / cols);
  const cellW = (stage.w - STAGE_PAD * (cols + 1)) / cols;
  const cellH = (stage.h - STAGE_PAD * (rows + 1)) / rows;
  const out = { ...layout };
  ids.forEach((id, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out[id] = {
      ...out[id]!,
      x: Math.round(STAGE_PAD + c * (cellW + STAGE_PAD)),
      y: Math.round(STAGE_PAD + r * (cellH + STAGE_PAD)),
      w: Math.round(Math.max(MIN_W, cellW)),
      h: Math.round(Math.max(MIN_H, cellH)),
    };
  });
  return out;
}

/** Overlapping steps from the top-left, in stacking order. */
export function cascade(layout: WindowMap, stage: Size, step = 34): WindowMap {
  const ids = Object.keys(layout)
    .filter((id) => layout[id]!.visible && !layout[id]!.minimized)
    .sort((a, b) => layout[a]!.z - layout[b]!.z);
  const w = Math.round(Math.min(Math.max(MIN_W, stage.w * 0.5), stage.w - STAGE_PAD * 2));
  const h = Math.round(Math.min(Math.max(MIN_H, stage.h * 0.6), stage.h - STAGE_PAD * 2));
  const out = { ...layout };
  ids.forEach((id, i) => {
    // Wrap back to the top-left before the cascade walks off the stage.
    const span = Math.max(1, Math.floor((stage.h - h - STAGE_PAD) / step) || 1);
    const k = i % span;
    out[id] = { ...out[id]!, x: STAGE_PAD + k * step, y: STAGE_PAD + k * step, w, h };
  });
  return out;
}

/**
 * Where a new window opens: the least-covered spot on a coarse grid, biased
 * to the top-left so an empty stage fills in reading order instead of
 * scattering. Cheap enough to run on every open (≈ 200 probes).
 */
export function placeNew(size: Size, layout: WindowMap, stage: Size): { x: number; y: number } {
  const { w, h } = clampSize(size, { w: MIN_W, h: MIN_H }, stage);
  const live = Object.values(layout).filter((b) => b.visible && !b.minimized);
  let best: { cost: number; x: number; y: number } | null = null;
  for (let y = STAGE_PAD; y + h <= stage.h - STAGE_PAD; y += 40) {
    for (let x = STAGE_PAD; x + w <= stage.w - STAGE_PAD; x += 52) {
      let cost = 0;
      for (const b of live) {
        const ox = Math.max(0, Math.min(x + w, b.x + b.w) - Math.max(x, b.x));
        const oy = Math.max(0, Math.min(y + h, b.y + b.h) - Math.max(y, b.y));
        cost += ox * oy;
      }
      cost += (x * 0.5 + y) * 14;
      if (!best || cost < best.cost) best = { cost, x, y };
    }
  }
  if (best) return { x: best.x, y: best.y };
  // Stage smaller than the window: the clamp will sort it out.
  const n = live.length;
  return { x: STAGE_PAD + n * 24, y: STAGE_PAD + n * 24 };
}

/* ------------------------------------------------------------ overview --- */

export interface OverviewSlot {
  /** Scale to apply, about the window's own top-left corner. */
  scale: number;
  /** Where that scaled window is placed, in stage pixels. */
  x: number;
  y: number;
}

/**
 * Pulls the camera back: every open window laid out on a grid, each scaled to
 * fit its cell without distortion, so a stage with a dozen overlapping
 * windows can be read at a glance and one of them picked.
 *
 * Returns a placement per id rather than mutating the layout — the real boxes
 * must survive the trip, because leaving the overview restores them exactly.
 */
export function overviewSlots(layout: WindowMap, stage: Size): Record<string, OverviewSlot> {
  const ids = Object.keys(layout)
    .filter((id) => layout[id]!.visible && !layout[id]!.minimized)
    .sort((a, b) => layout[a]!.z - layout[b]!.z);
  const out: Record<string, OverviewSlot> = {};
  if (ids.length === 0) return out;
  const cols = ids.length <= 2 ? ids.length : Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / cols);
  const cellW = (stage.w - STAGE_PAD * (cols + 1)) / cols;
  const cellH = (stage.h - STAGE_PAD * (rows + 1)) / rows;
  ids.forEach((id, i) => {
    const box = layout[id]!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    // Never magnify: a small window in a big cell stays its own size, which
    // keeps the overview a map of the desktop rather than a distortion of it.
    const scale = Math.min(cellW / box.w, cellH / box.h, 1);
    out[id] = {
      scale,
      x: STAGE_PAD + c * (cellW + STAGE_PAD) + (cellW - box.w * scale) / 2,
      y: STAGE_PAD + r * (cellH + STAGE_PAD) + (cellH - box.h * scale) / 2,
    };
  });
  return out;
}

/* ------------------------------------------------------------ tethers --- */

export interface Point {
  x: number;
  y: number;
}

/** Where a tether leaves the console: the middle of its top edge. */
export function tetherOrigin(consoleBox: WindowBox): Point {
  return { x: consoleBox.x + consoleBox.w / 2, y: consoleBox.y };
}

/**
 * Where a tether lands on a referenced window: the point on its outline
 * nearest the console, clamped to the edge so the line touches the window
 * rather than stabbing its middle.
 */
export function tetherTarget(box: WindowBox, from: Point): Point {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // Below the console it attaches to the top edge, above it to the bottom.
  const y = from.y > cy ? box.y + box.h : box.y;
  const x = Math.min(Math.max(from.x, box.x + 12), box.x + box.w - 12);
  return { x: Math.abs(from.x - cx) > box.w ? cx : x, y };
}

/**
 * A cubic that leaves the console going up and arrives at the window going
 * down, so the curve reads as a connection rather than a stray diagonal.
 */
export function tetherPath(from: Point, to: Point): string {
  const lift = Math.max(40, Math.min(140, Math.abs(from.y - to.y) * 0.5));
  return `M${from.x} ${from.y} C ${from.x} ${from.y - lift}, ${to.x} ${to.y + lift}, ${to.x} ${to.y}`;
}

/** Structural equality, used to decide whether a layout is worth persisting. */
export function layoutsEqual(a: WindowMap, b: WindowMap): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    const x = a[id];
    const y = b[id];
    if (!x || !y) return false;
    if (
      x.x !== y.x ||
      x.y !== y.y ||
      x.w !== y.w ||
      x.h !== y.h ||
      x.z !== y.z ||
      x.visible !== y.visible ||
      (x.minimized ?? false) !== (y.minimized ?? false) ||
      JSON.stringify(x.config ?? null) !== JSON.stringify(y.config ?? null)
    )
      return false;
  }
  return true;
}

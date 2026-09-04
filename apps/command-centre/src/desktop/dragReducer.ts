/**
 * Pure drag / resize maths for the widget layer (no React, no DOM).
 *
 * The pointer path is: `beginDrag` on pointerdown → `dragTarget` on every
 * pointermove (cheap; the caller only writes a transform in rAF) →
 * `settleDrag` on pointerup, which commits the target cell and pushes any
 * displaced neighbour down so nothing overlaps. Neighbour moves are what the
 * FLIP animation in WidgetLayer plays.
 */
import { MIN_H, MIN_W, overlaps, type LayoutMap, type WidgetBox } from "./defaultLayout";

export interface GridDims {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

export interface DragSession {
  id: string;
  mode: "move" | "resize";
  /** Pointer position at pointerdown (px). */
  px: number;
  py: number;
  /** The box when the drag started. */
  origin: WidgetBox;
  /** Last computed target cell (updated on every move). */
  target: WidgetBox;
}

export function clampMove(
  box: WidgetBox,
  x: number,
  y: number,
  m: Pick<GridDims, "cols" | "rows">,
): WidgetBox {
  return { ...box, x: Math.max(0, Math.min(m.cols - box.w, x)), y: Math.max(0, Math.min(m.rows - box.h, y)) };
}

export function clampResize(
  box: WidgetBox,
  w: number,
  h: number,
  m: Pick<GridDims, "cols" | "rows">,
): WidgetBox {
  return {
    ...box,
    w: Math.max(MIN_W, Math.min(m.cols - box.x, w)),
    h: Math.max(MIN_H, Math.min(m.rows - box.y, h)),
  };
}

export function beginDrag(
  id: string,
  mode: DragSession["mode"],
  px: number,
  py: number,
  box: WidgetBox,
): DragSession {
  return { id, mode, px, py, origin: box, target: box };
}

/** Target cell for the current pointer position (pure; returns the same object when unchanged). */
export function dragTarget(s: DragSession, clientX: number, clientY: number, m: GridDims): WidgetBox {
  const dx = clientX - s.px;
  const dy = clientY - s.py;
  const next =
    s.mode === "move"
      ? clampMove(s.origin, Math.round(s.origin.x + dx / m.cellW), Math.round(s.origin.y + dy / m.cellH), m)
      : clampResize(
          s.origin,
          Math.round(s.origin.w + dx / m.cellW),
          Math.round(s.origin.h + dy / m.cellH),
          m,
        );
  return sameGeometry(next, s.target) ? s.target : next;
}

/** Free-floating pixel offset of the dragged widget relative to its origin cell (for translate3d). */
export function dragOffsetPx(s: DragSession, clientX: number, clientY: number): { dx: number; dy: number } {
  return { dx: clientX - s.px, dy: clientY - s.py };
}

export function sameGeometry(a: WidgetBox, b: WidgetBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Commit the target box and resolve collisions: every other visible widget
 * that now overlaps the moved one is pushed down (in y order) to the first
 * free row, cascading. Widgets that cannot fit stay where they were.
 * Returns the new layout plus the ids that were displaced.
 */
export function settleDrag(
  layout: LayoutMap,
  id: string,
  target: WidgetBox,
  m: Pick<GridDims, "rows">,
): { layout: LayoutMap; displaced: string[] } {
  const out: LayoutMap = { ...layout, [id]: target };
  const displaced: string[] = [];
  const others = Object.keys(out)
    .filter((k) => k !== id && out[k]!.visible)
    .sort((a, b) => out[a]!.y - out[b]!.y || out[a]!.x - out[b]!.x);
  const fixed: WidgetBox[] = [target];
  for (const k of others) {
    const box = out[k]!;
    if (!fixed.some((f) => overlaps(f, box))) {
      fixed.push(box);
      continue;
    }
    let y = box.y;
    let guard = 0;
    while (fixed.some((f) => overlaps({ ...box, y }, f)) && y + box.h < m.rows && guard++ < m.rows) y += 1;
    if (fixed.some((f) => overlaps({ ...box, y }, f))) {
      fixed.push(box); // nowhere to go: accept the overlap rather than lose it
      continue;
    }
    out[k] = { ...box, y };
    fixed.push(out[k]!);
    displaced.push(k);
  }
  return { layout: out, displaced };
}

/** Arrow keys move by one cell; with Shift they resize by one cell. Returns null for other keys / no change. */
export function nudgeBox(
  box: WidgetBox,
  key: string,
  shift: boolean,
  m: Pick<GridDims, "cols" | "rows">,
): WidgetBox | null {
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const d = delta[key];
  if (!d) return null;
  const next = shift
    ? clampResize(box, box.w + d[0], box.h + d[1], m)
    : clampMove(box, box.x + d[0], box.y + d[1], m);
  return sameGeometry(next, box) ? null : next;
}

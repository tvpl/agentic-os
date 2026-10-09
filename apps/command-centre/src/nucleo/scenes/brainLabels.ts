/**
 * The Brain scene's words on the sky (immersive shell): how big a label may
 * be and where it may go. Sizes live in screen space with a clamp — a title
 * never grows past ~15 px however close its star is, and never shrinks below
 * 11 px while it is shown. Placement is greedy by priority (the star under
 * the cursor, then the selection, the hubs, the rest by nearness): each label
 * tries below its star, then above, right, left, and is dropped when every
 * side would overlap a label already placed, the floating interface or the
 * edge of the free area. Pure.
 */
import { clamp } from "./brainSpace";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "below" | "above" | "right" | "left" | "centre";
export const SIDES: readonly Side[] = ["below", "above", "right", "left"];

export interface LabelAsk {
  /** Caller's key (a star index). */
  id: number;
  /** Lower goes first; a negative priority is placed even when every side collides. */
  pri: number;
  /** The star's centre and radius on screen. */
  x: number;
  y: number;
  r: number;
  /** The label's size. */
  w: number;
  h: number;
  sides?: readonly Side[];
}

export interface Placed {
  id: number;
  side: Side;
  box: Box;
}

export const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const inside = (a: Box, b: Box): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** The box of a label on one side of its star, `gap` px away from it. */
export function boxAt(a: Pick<LabelAsk, "x" | "y" | "r" | "w" | "h">, side: Side, gap = 6): Box {
  switch (side) {
    case "below":
      return { x: a.x - a.w / 2, y: a.y + a.r + gap, w: a.w, h: a.h };
    case "above":
      return { x: a.x - a.w / 2, y: a.y - a.r - gap - a.h, w: a.w, h: a.h };
    case "right":
      return { x: a.x + a.r + gap, y: a.y - a.h / 2, w: a.w, h: a.h };
    case "left":
      return { x: a.x - a.r - gap - a.w, y: a.y - a.h / 2, w: a.w, h: a.h };
    case "centre":
      return { x: a.x - a.w / 2, y: a.y - a.h / 2, w: a.w, h: a.h };
  }
}

/** Push a box inside the bounds (as little as possible). */
export function clampBox(b: Box, bounds: Box): Box {
  return {
    ...b,
    x: clamp(b.x, bounds.x, Math.max(bounds.x, bounds.x + bounds.w - b.w)),
    y: clamp(b.y, bounds.y, Math.max(bounds.y, bounds.y + bounds.h - b.h)),
  };
}

/**
 * Place labels greedily in priority order (ties keep the given order). Each
 * placed label becomes an obstacle for the next. `max` caps how many are
 * placed (forced ones count too).
 */
export function placeLabels(
  asks: readonly LabelAsk[],
  opts: { blocked: readonly Box[]; bounds: Box; gap?: number; max?: number },
): Placed[] {
  const gap = opts.gap ?? 6;
  const max = opts.max ?? Infinity;
  const order = asks.map((a, k) => ({ a, k })).sort((p, q) => p.a.pri - q.a.pri || p.k - q.k);
  const taken: Box[] = [...opts.blocked];
  const out: Placed[] = [];
  const free = (b: Box) => {
    if (!inside(b, opts.bounds)) return false;
    for (const t of taken) if (overlaps(b, t)) return false;
    return true;
  };
  for (const { a } of order) {
    if (out.length >= max) break;
    const sides = a.sides ?? SIDES;
    let placed: Placed | null = null;
    for (const side of sides) {
      const b = boxAt(a, side, gap);
      if (free(b)) {
        placed = { id: a.id, side, box: b };
        break;
      }
    }
    if (!placed && a.pri < 0) {
      // Forced (the star under the cursor): its first side, kept inside the free area.
      const side = sides[0] ?? "below";
      placed = { id: a.id, side, box: clampBox(boxAt(a, side, gap), opts.bounds) };
    }
    if (!placed) continue;
    taken.push(placed.box);
    out.push(placed);
  }
  return out;
}

/**
 * Screen size (px) of a star's title: it grows a little as the star comes
 * closer (`s` is its perspective scale) but stays between 12 px (the text floor) and a cap
 * that depends on how important the label is (the note you are in: 15 px).
 */
export function labelPx(pri: number, s: number): number {
  const cap = pri <= 0 ? 15 : pri === 1 ? 13.5 : 12.5;
  return Math.round(clamp(10.5 + Math.max(0, s) * 1.6, 12, cap) * 2) / 2;
}

/** Screen size (px) of an area's name: tracked capitals, 12 … 13 px whatever the distance. */
export function groupPx(spanPx: number): number {
  return Math.round(clamp(11 + spanPx / 260, 12, 13) * 2) / 2;
}

/**
 * How present an area's name is: `spanShare` is the share of the free area
 * its stars span on screen, `eyeShare` how far the eye is from its centre in
 * units of its reach. Fully there while the cloud is smaller than ~¾ of the
 * view and the eye is outside it; gone once the cloud fills the view or the
 * eye is inside (its stars speak for themselves).
 */
export function groupPresence(spanShare: number, eyeShare = Infinity): number {
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const bySpan = 1 - smooth(clamp((spanShare - 0.75) / (1.4 - 0.75), 0, 1));
  const byEye = smooth(clamp((eyeShare - 1) / (1.8 - 1), 0, 1));
  return bySpan * byEye;
}

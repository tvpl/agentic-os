/**
 * Label policy for the Second Brain: when labels appear (a zoom alpha ramp
 * instead of a hard cut), which files get one when the budget is tight
 * (importance ranking) and where they go (greedy collision with a radial
 * push for hub names). Pure — no canvas — so the rules are unit testable.
 */
import type { FileNode, World } from "../engine/world";

/** File labels fade in between these zooms (unless "show names" forces them). */
export const LABEL_RAMP_START = 1.3;
export const LABEL_RAMP_END = 2.0;
/** Planet folder names fade in between these zooms. */
export const PLANET_LABEL_RAMP_START = 1.1;
export const PLANET_LABEL_RAMP_END = 1.6;
/** Labels drawn per frame at most. */
export const LABEL_BUDGET = 240;
/** Placement attempts per frame at most: past this the rest of the ranking is not even measured. */
export const LABEL_ATTEMPT_CAP = LABEL_BUDGET * 4;
/** Font metrics of the 12 px mono label (the text floor): baseline offset and box height (px, pre-zoom). */
export const LABEL_FONT_PX = 12;
export const LABEL_BASELINE_PX = 4;
export const LABEL_ASCENT_PX = 10;
export const LABEL_DESCENT_PX = 3;

export function ramp(k: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (k - start) / (end - start)));
}

/** 0 at k ≤ 1.3 → 1 at k ≥ 2.0 (1 when names are forced on). */
export function labelAlpha(k: number, showNames: boolean): number {
  return showNames ? 1 : ramp(k, LABEL_RAMP_START, LABEL_RAMP_END);
}

/** A planet's file count is a detail: it needs room beside the planet, so it fades out below 0.8 and is gone by 0.5. */
export function planetCountAlpha(k: number): number {
  return ramp(k, 0.5, 0.8);
}

export function planetLabelAlpha(k: number): number {
  return ramp(k, PLANET_LABEL_RAMP_START, PLANET_LABEL_RAMP_END);
}

export type LabelWorld = Pick<World, "selectedId" | "focusSet" | "matched" | "hoverId">;

/**
 * Importance of a file's label: selected > hovered / focus neighbour >
 * matched > pinned > high degree > recent. Higher wins the budget.
 */
export function labelScore(w: LabelWorld, n: FileNode, index: number, now: number): number {
  let s = 0;
  if (w.selectedId === n.id) s += 1e9;
  if (w.hoverId === n.id) s += 1e8;
  if (w.focusSet !== null && w.focusSet.has(index)) s += 1e7;
  if (w.matched !== null && w.matched.has(n.id)) s += 1e6;
  if (n.pinned) s += 1e5;
  s += Math.min(n.degree, 999) * 100;
  // Recency: up to ~99 points for files touched in the last 30 days.
  const ageDays = Math.max(0, (now - n.mtime) / 86_400_000);
  s += Math.max(0, 99 - Math.min(99, ageDays * 3.3));
  return s;
}

/** Recency scores are stable between frames: the clock is quantised to the minute. */
export function quantiseNow(now: number): number {
  return Math.floor(now / 60_000) * 60_000;
}

/**
 * Per-frame label ranking without per-frame allocation: the candidate
 * indices and their scores live in typed arrays that grow only when the
 * file count does, and the candidates are sorted in place.
 */
export class LabelRanker {
  private scores = new Float64Array(0);
  private cand = new Int32Array(0);
  private count = 0;

  /** Start a frame for `n` files (clears the candidate list). */
  begin(n: number): void {
    if (this.scores.length < n) {
      this.scores = new Float64Array(n);
      this.cand = new Int32Array(n);
    }
    this.count = 0;
  }

  add(index: number): void {
    this.cand[this.count++] = index;
  }

  get size(): number {
    return this.count;
  }

  /** The candidates added this frame, sorted in place by descending importance (index order on ties). */
  rank(w: LabelWorld, files: ReadonlyArray<FileNode>, now: number): Int32Array {
    const scores = this.scores;
    const view = this.cand.subarray(0, this.count);
    for (let j = 0; j < view.length; j++) {
      const i = view[j]!;
      scores[i] = labelScore(w, files[i]!, i, now);
    }
    view.sort((a, b) => scores[b]! - scores[a]! || a - b);
    return view;
  }
}

/** Indices of `candidates` sorted by descending importance (stable for ties). */
export function rankLabels(
  w: LabelWorld,
  files: ReadonlyArray<FileNode>,
  candidates: number[],
  now: number,
): number[] {
  const ranker = new LabelRanker();
  ranker.begin(files.length);
  for (const i of candidates) ranker.add(i);
  return Array.from(ranker.rank(w, files, now));
}

/**
 * Walk `ranked` in order, calling `attempt(i)` (true when the label was
 * drawn) until `budget` labels are placed or `cap` candidates were tried, so
 * a crowded frame never measures and collision-tests thousands of losers.
 * Returns the number placed.
 */
export function placeRanked(
  ranked: ArrayLike<number>,
  attempt: (index: number) => boolean,
  budget = LABEL_BUDGET,
  cap = LABEL_ATTEMPT_CAP,
): number {
  let placed = 0;
  const tries = Math.min(ranked.length, cap);
  for (let j = 0; j < tries && placed < budget; j++) {
    if (attempt(ranked[j]!)) placed++;
  }
  return placed;
}

/** Minimal slice of a 2D context the width cache needs (a stub does in tests). */
export interface TextMeasurer {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * Text widths measured once per name at the base label font (screen px) and
 * reused every frame: the world width at zoom `k` is `width / k`. Measuring
 * at the base font (instead of the zoom-scaled one) keeps the cache valid
 * across zoom levels; a font change empties it.
 */
export class LabelWidthCache {
  private widths = new Map<string, number>();
  private font = "";

  /** Screen-pixel width of `text` at the base font; `scaledFont` is restored on the context after a miss. */
  width(ctx: TextMeasurer, text: string, baseFont: string, scaledFont: string): number {
    if (this.font !== baseFont) {
      this.widths.clear();
      this.font = baseFont;
    }
    let w = this.widths.get(text);
    if (w === undefined) {
      ctx.font = baseFont;
      w = ctx.measureText(text).width;
      ctx.font = scaledFont;
      this.widths.set(text, w);
    }
    return w;
  }

  get size(): number {
    return this.widths.size;
  }
}

/** Greedy axis-aligned collision over the boxes placed this frame. */
export class LabelPlacer {
  private readonly boxes: number[] = [];

  overlaps(x1: number, y1: number, x2: number, y2: number): boolean {
    const b = this.boxes;
    for (let i = 0; i < b.length; i += 4) {
      if (x1 < b[i + 2]! && x2 > b[i]! && y1 < b[i + 3]! && y2 > b[i + 1]!) return true;
    }
    return false;
  }

  place(x1: number, y1: number, x2: number, y2: number): void {
    this.boxes.push(x1, y1, x2, y2);
  }

  /** Place unless it collides; returns whether it was placed. */
  tryPlace(x1: number, y1: number, x2: number, y2: number): boolean {
    if (this.overlaps(x1, y1, x2, y2)) return false;
    this.place(x1, y1, x2, y2);
    return true;
  }

  get count(): number {
    return this.boxes.length / 4;
  }
}

/**
 * Collision box of a file label whose baseline sits at (x, y + baseline):
 * matches the drawn glyphs instead of a box hanging above them.
 */
export function fileLabelBox(
  x: number,
  y: number,
  width: number,
  k: number,
): [number, number, number, number] {
  const baseline = y + LABEL_BASELINE_PX / k;
  return [x, baseline - LABEL_ASCENT_PX / k, x + width, baseline + LABEL_DESCENT_PX / k];
}

/**
 * Where a hub label goes: centred above the disc, pushed outward along the
 * hub's angle from the origin by one label height per step (up to `maxSteps`)
 * while it overlaps a label already placed. Returns the centre point and
 * whether a free spot was found (a label that still collides is drawn at the
 * last tried spot, dimmed by the caller).
 */
export function placeHubLabel(
  placer: LabelPlacer,
  hub: { x: number; y: number },
  width: number,
  height: number,
  baseOffset: number,
  maxSteps = 3,
): { x: number; y: number; free: boolean } {
  const len = Math.hypot(hub.x, hub.y) || 1;
  const ux = hub.x / len;
  const uy = hub.y / len;
  let x = hub.x;
  let y = hub.y - baseOffset;
  for (let step = 0; step <= maxSteps; step++) {
    if (step > 0) {
      x += ux * height;
      y += uy * height;
    }
    const x1 = x - width / 2;
    const y1 = y - height;
    if (placer.tryPlace(x1, y1, x1 + width, y)) return { x, y, free: true };
  }
  // Still colliding after the last step: stay at that spot (the caller dims it).
  placer.place(x - width / 2, y - height, x + width / 2, y);
  return { x, y, free: false };
}

/** Angle (radians) each ring label sits at, so the four names never stack on one meridian. */
export const RING_LABEL_ANGLES: readonly number[] = [
  -Math.PI / 2, // skills: top
  -Math.PI / 3, // memory: upper right
  (-2 * Math.PI) / 3, // routines: upper left
  -Math.PI / 4, // apps: right of top
];

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(1, max - 1)) + "…" : text;
}

/** Two letters for an application's badge: the initials of its first two words, or its first two letters. */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

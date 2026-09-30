/**
 * The Brain scene's semantic zoom (immersive shell): how close you are
 * decides what the sky says. Far away only the areas speak (nebula names,
 * counts); closer the hubs light their icons and names; closer still every
 * note shows its icon, its title and a line of its text; inside a note its
 * synapses become the space. The level is continuous (0 … 3) so everything
 * cross-fades instead of popping. Pure.
 */
import { clamp } from "./brainSpace";

export type ZoomLevel = "areas" | "hubs" | "notes" | "synapses";
export const ZOOM_LEVELS: readonly ZoomLevel[] = ["areas", "hubs", "notes", "synapses"];

/** Zoom factor (overview ÷ distance) at which each level is fully reached. */
const HUBS_AT = 2.2;
const NOTES_AT = 4.5;

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Continuous level for a camera distance: 0 at (or beyond) the overview, 1
 * at the hubs, 2 at the notes; 3 is only reached inside a note (`inside`).
 */
export function zoomLevel(dist: number, overview: number, inside = false): number {
  if (inside) return 3;
  const z = overview / Math.max(1, dist);
  if (z <= 1.1) return 0;
  if (z <= HUBS_AT) return Math.log(z / 1.1) / Math.log(HUBS_AT / 1.1);
  return clamp(1 + Math.log(z / HUBS_AT) / Math.log(NOTES_AT / HUBS_AT), 1, 2);
}

/** The level a continuous value mostly is. */
export function levelName(level: number): ZoomLevel {
  return ZOOM_LEVELS[clamp(Math.round(level), 0, 3)]!;
}

/** Camera distance that shows a level (the inverse of `zoomLevel`, 0 … 2). */
export function distanceForLevel(level: number, overview: number): number {
  const l = clamp(level, 0, 2);
  if (l <= 0) return overview;
  if (l <= 1) return overview / (1.1 * Math.pow(HUBS_AT / 1.1, l));
  return overview / (HUBS_AT * Math.pow(NOTES_AT / HUBS_AT, l - 1));
}

export interface LevelWeights {
  /** Area names and counts on the nebulae. */
  areas: number;
  /** Hub names and icons. */
  hubs: number;
  /** Every note's name and icon (subject to room on screen). */
  notes: number;
  /** A line of each close note's text. */
  excerpts: number;
}

export function levelWeights(level: number): LevelWeights {
  return {
    areas: 1 - smoothstep(1.2, 2.1, level) * 0.75,
    hubs: smoothstep(0.35, 1, level),
    notes: smoothstep(1.2, 1.9, level),
    excerpts: smoothstep(1.7, 2, level),
  };
}

/** How many note labels the sky may show at once for a level and a screen. */
export function labelBudget(level: number, area: number): number {
  const room = Math.round(area / 38000);
  const w = levelWeights(level);
  return Math.round(clamp(8 + w.hubs * 14 + w.notes * room, 8, 90));
}

/** Star screen radius (px) from which its glyph is drawn inside the body. */
export const GLYPH_INSIDE_PX = 7;
/** Star screen radius from which it is drawn as a lit body, not a point of light. */
export const BODY_PX = 4.2;

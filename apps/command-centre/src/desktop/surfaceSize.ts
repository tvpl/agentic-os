/**
 * How large an expanded widget is allowed to get (redesign F2).
 *
 * The old `maximized` gave every widget the whole screen, so a panel designed
 * for three rows opened as three rows floating in a 2000 px canvas. A surface
 * is a composition, not a stretch: it grows to a bounded multiple of the
 * minimum the widget declares it can fill honestly (`surfaceMin` in the
 * registry), and never past the viewport.
 *
 * Pure, so the cap is testable without a layout engine.
 */

export interface Box {
  w: number;
  h: number;
}

/** Room around the surface: the veil has to read as a veil, not a hairline. */
const PAD = 24;
/** Chrome the desktop keeps: tool row above, dock below. */
const CHROME = 172;
/**
 * How far past its declared minimum a surface may grow. Above ~1.6 the
 * composition stops gaining rows and starts gaining margins — which is the
 * defect this cap exists to prevent.
 */
export const GROW = 1.6;
/**
 * Used by widgets that declare no `surfaceMin`. Deliberately modest: a widget
 * that never said how much space it can fill does not get the whole screen.
 */
export const DEFAULT_SURFACE_MIN: Box = { w: 420, h: 300 };

/** Space a surface may occupy inside `viewport`, before the cap. */
export function availableBox(viewport: Box): Box {
  return {
    w: Math.max(240, viewport.w - PAD * 2),
    h: Math.max(180, viewport.h - CHROME),
  };
}

/**
 * The box an expanded widget opens at: its minimum grown by `GROW`, clamped
 * to what the viewport can actually give. Never smaller than the viewport
 * allows, never larger than the widget can fill.
 */
export function surfaceBox(min: Box | undefined, viewport: Box): Box {
  const avail = availableBox(viewport);
  const base = min ?? DEFAULT_SURFACE_MIN;
  return {
    w: Math.min(avail.w, Math.round(base.w * GROW)),
    h: Math.min(avail.h, Math.round(base.h * GROW)),
  };
}

/**
 * `true` when the surface had to be capped by the viewport rather than by the
 * widget's own ceiling — the body then gets every pixel there is, so a narrow
 * window is not also a half-empty one.
 */
export function isViewportBound(min: Box | undefined, viewport: Box): boolean {
  const avail = availableBox(viewport);
  const base = min ?? DEFAULT_SURFACE_MIN;
  return Math.round(base.w * GROW) > avail.w || Math.round(base.h * GROW) > avail.h;
}

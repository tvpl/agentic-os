/**
 * Where a journey starts (immersive shell). Every change of scene and every
 * projection grows out of the thing you touched: the shell remembers the
 * last press — its point and the rect of the control under it — and the
 * next transition zooms from there. A keyboard jump has no press, so the
 * shell names an origin itself (the module's icon on the spine).
 */
export interface Origin {
  x: number;
  y: number;
  /** The control that was pressed, when there was one. */
  rect: { left: number; top: number; width: number; height: number } | null;
  at: number;
}

/** A press older than this did not cause what is happening now. */
export const ORIGIN_TTL_MS = 900;

let last: Origin | null = null;

export function setOrigin(x: number, y: number, rect: Origin["rect"] = null, at = Date.now()): void {
  last = { x, y, rect, at };
}

export function originFromElement(el: Element, at = Date.now()): void {
  const r = el.getBoundingClientRect();
  setOrigin(
    r.left + r.width / 2,
    r.top + r.height / 2,
    { left: r.left, top: r.top, width: r.width, height: r.height },
    at,
  );
}

/** The origin, if it is fresh enough to explain a transition starting `now`. */
export function freshOrigin(now = Date.now()): Origin | null {
  return last && now - last.at <= ORIGIN_TTL_MS ? last : null;
}

/** Tests only. */
export function resetOrigin(): void {
  last = null;
}

/** The control a press landed on: the nearest button, link or marked target. */
export function pressTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest("button, a, [role='button'], [data-origin]");
}

/**
 * The FLIP transform that puts an element of `to` size and place over
 * `from`: where a projection starts before it grows into its own box.
 */
export function flipFrom(
  from: { left: number; top: number; width: number; height: number },
  to: { left: number; top: number; width: number; height: number },
): { dx: number; dy: number; sx: number; sy: number } {
  const sx = to.width > 0 ? from.width / to.width : 1;
  const sy = to.height > 0 ? from.height / to.height : 1;
  return { dx: from.left - to.left, dy: from.top - to.top, sx, sy };
}

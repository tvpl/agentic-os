/**
 * Click sequencing for the canvas. A click's own camera flight moves the
 * thing that was clicked, so the second press of a double-click (and the
 * `dblclick` event after it) must act on what the FIRST click hit instead of
 * hit-testing the live, already-moving scene. Pure and generic over the hit
 * type so the rules are unit testable without a DOM.
 */

/** A press this soon after a click, and this close to it, continues that click. */
export const CLICK_CHAIN_MS = 300;
export const CLICK_CHAIN_PX = 6;
/** A `dblclick` this soon after its second click reuses the chain's hit. */
export const DOUBLE_CLICK_MS = 500;

export interface ClickRecord<H> {
  hit: H;
  /** Milliseconds (performance.now() clock). */
  at: number;
  /** Screen position of the click. */
  x: number;
  y: number;
}

/** True when a press at (x, y) at time `now` continues the previous click (same spot, quick succession). */
export function shouldReuseClick(
  prev: ClickRecord<unknown> | null,
  now: number,
  x: number,
  y: number,
  limits: { ms?: number; px?: number } = {},
): boolean {
  if (!prev) return false;
  const dt = now - prev.at;
  if (dt < 0 || dt > (limits.ms ?? CLICK_CHAIN_MS)) return false;
  return Math.hypot(x - prev.x, y - prev.y) <= (limits.px ?? CLICK_CHAIN_PX);
}

/**
 * The click chain of one pointer surface: remembers the last click and
 * decides, for each press and each `dblclick`, whether to reuse its hit.
 * `live` is only called when a fresh hit-test is really needed.
 */
export class ClickChain<H> {
  private last: ClickRecord<H> | null = null;

  /** Hit a press acts on: the previous click's when this press continues it, else `live()`. */
  hitForPress(now: number, x: number, y: number, live: () => H): { hit: H; reused: boolean } {
    if (this.last && shouldReuseClick(this.last, now, x, y)) return { hit: this.last.hit, reused: true };
    return { hit: live(), reused: false };
  }

  /** Record a completed click (press + release without a drag). */
  record(hit: H, now: number, x: number, y: number): void {
    this.last = { hit, at: now, x, y };
  }

  /** Hit a `dblclick` acts on: the chain's when recent, else `live()`. Ends the chain either way. */
  hitForDoubleClick(now: number, live: () => H): H {
    const prev = this.last;
    this.last = null;
    if (prev && now - prev.at >= 0 && now - prev.at < DOUBLE_CLICK_MS) return prev.hit;
    return live();
  }

  /** Forget the chain (a drag, a pinch, a cancelled pointer). */
  reset(): void {
    this.last = null;
  }

  get current(): ClickRecord<H> | null {
    return this.last;
  }
}

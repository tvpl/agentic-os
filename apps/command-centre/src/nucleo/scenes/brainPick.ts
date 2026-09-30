/**
 * The Brain scene's picking (immersive shell): what is under the cursor.
 * A star is hit within its drawn radius plus a slop; the nearest centre wins,
 * and the star already under the cursor is kept a little longer (so a hover
 * never flickers between two neighbours). A link is hit near its curve as
 * drawn on screen; a label within its box. Pure.
 */

export interface StarHits {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  r: ArrayLike<number>;
  /** 1 where the star is drawn and may be picked. */
  on: ArrayLike<number>;
}

/**
 * The star under (x, y): the nearest centre among those within their radius
 * + `slop`. The `current` one is kept while it is within `keep` × its reach
 * and no other star is clearly closer (under 60 % of its distance).
 */
export function pickStar(
  hits: StarHits,
  x: number,
  y: number,
  slop: number,
  current = -1,
  keep = 1.4,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < hits.on.length; i++) {
    if (!hits.on[i]) continue;
    const lim = hits.r[i]! + slop;
    const d = (hits.x[i]! - x) ** 2 + (hits.y[i]! - y) ** 2;
    if (d <= lim * lim && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  if (current >= 0 && current < hits.on.length && hits.on[current] && current !== best) {
    const lim = (hits.r[current]! + slop) * keep;
    const d = (hits.x[current]! - x) ** 2 + (hits.y[current]! - y) ** 2;
    if (d <= lim * lim && (best < 0 || bestD > d * 0.36)) return current;
  }
  return best;
}

/** Distance from (px, py) to the screen quadratic Bézier a → b through c, and where along it (0 … 1). */
export function distToQuad(
  px: number,
  py: number,
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  steps = 14,
): { d: number; t: number } {
  let best = Infinity;
  let bestT = 0;
  let x0 = ax;
  let y0 = ay;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    const x1 = u * u * ax + 2 * u * t * cx + t * t * bx;
    const y1 = u * u * ay + 2 * u * t * cy + t * t * by;
    // distance to the segment (x0, y0) → (x1, y1)
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    const s = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
    const qx = x0 + dx * s;
    const qy = y0 + dy * s;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) {
      best = d;
      bestT = (k - 1 + s) / steps;
    }
    x0 = x1;
    y0 = y1;
  }
  return { d: best, t: bestT };
}

/** The first box containing (x, y), or −1. */
export function pickBox(
  boxes: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
  x: number,
  y: number,
): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

/**
 * A pointer's velocity (px/s) from its recent moves: the moves of the last
 * `window` ms before `now`, or zero when the hand paused before letting go.
 */
export function releaseVelocity(
  samples: ReadonlyArray<{ t: number; dx: number; dy: number }>,
  now: number,
  window = 90,
): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= window);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const span = Math.max(16, now - recent[0]!.t);
  let dx = 0;
  let dy = 0;
  for (const s of recent) {
    dx += s.dx;
    dy += s.dy;
  }
  return { vx: (dx / span) * 1000, vy: (dy / span) * 1000 };
}

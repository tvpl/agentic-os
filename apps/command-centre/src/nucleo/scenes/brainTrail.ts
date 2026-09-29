/**
 * The Brain scene's trail (immersive shell): the path you travelled from
 * note to note through their synapses, as a breadcrumb you can walk back and
 * forward. It behaves like a browser history — going back and choosing a new
 * way cuts the old future — and it recognises a step back or forward taken
 * some other way (the Back button, a link to where you just were). Pure.
 */

export interface Trail {
  /** Note ids, oldest first. */
  items: number[];
  /** Index of the note you are on (−1 when empty). */
  pos: number;
}

export const EMPTY_TRAIL: Trail = { items: [], pos: -1 };
export const TRAIL_MAX = 16;

export function current(t: Trail): number | null {
  return t.pos >= 0 ? (t.items[t.pos] ?? null) : null;
}

/** Arrive at `id` by a new way: the future after the current note is dropped. */
export function visit(t: Trail, id: number, max = TRAIL_MAX): Trail {
  if (current(t) === id) return t;
  const items = [...t.items.slice(0, t.pos + 1), id];
  const drop = Math.max(0, items.length - max);
  return { items: items.slice(drop), pos: items.length - 1 - drop };
}

/** Arrive at `id` however it happened: a step back, a step forward, or a new visit. */
export function follow(t: Trail, id: number, max = TRAIL_MAX): Trail {
  if (current(t) === id) return t;
  if (t.pos > 0 && t.items[t.pos - 1] === id) return { ...t, pos: t.pos - 1 };
  if (t.pos + 1 < t.items.length && t.items[t.pos + 1] === id) return { ...t, pos: t.pos + 1 };
  return visit(t, id, max);
}

export function back(t: Trail): Trail {
  return t.pos > 0 ? { ...t, pos: t.pos - 1 } : t;
}

export function forward(t: Trail): Trail {
  return t.pos + 1 < t.items.length ? { ...t, pos: t.pos + 1 } : t;
}

/** Jump to a crumb (the future is kept, like history). */
export function jump(t: Trail, index: number): Trail {
  return index >= 0 && index < t.items.length ? { ...t, pos: index } : t;
}

/** Drop notes that no longer exist (a re-index), keeping the position on the same note when possible. */
export function prune(t: Trail, exists: (id: number) => boolean): Trail {
  const here = current(t);
  const items = t.items.filter(exists);
  if (items.length === t.items.length) return t;
  const pos = here !== null && exists(here) ? items.lastIndexOf(here) : items.length - 1;
  return { items, pos };
}

/**
 * The Brain scene's synapses firing (immersive shell): pulses of light that
 * travel along the links. A few fire at random all over the sky (the brain
 * is alive), more fire around the note in focus, and arriving at a note sets
 * off a burst from it that cascades outwards, weakening at every hop. Pure:
 * the canvas owns the clock and the random source.
 */

export interface SynapseEdge {
  a: number;
  b: number;
}

export interface Pulse {
  /** Edge index. */
  e: number;
  /** Node the pulse leaves from (one end of the edge). */
  from: number;
  /** Start time (ms); may be in the future (a staggered burst). */
  t0: number;
  dur: number;
  /** 0 … 1: brightness, and whether it may cascade on. */
  s: number;
  /** Hops since the burst that started it. */
  gen: number;
}

export const MAX_PULSES = 240;

/** Edge indices touching each node. */
export function incidence(n: number, edges: readonly SynapseEdge[]): number[][] {
  const out: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    out[e.a]?.push(i);
    if (e.b !== e.a) out[e.b]?.push(i);
  });
  return out;
}

/** The node a pulse arrives at. */
export function pulseEnd(p: Pulse, edges: readonly SynapseEdge[]): number {
  const e = edges[p.e]!;
  return e.a === p.from ? e.b : e.a;
}

/** 0 … 1 along the edge from `from`; negative before it starts, above 1 once it has arrived. */
export function pulseProgress(p: Pulse, now: number): number {
  return (now - p.t0) / p.dur;
}

/** Travel time for a link of a given length (world units): long links take longer, within bounds. */
export function pulseDuration(length: number): number {
  return Math.round(Math.min(1500, Math.max(420, 260 + length * 2.6)));
}

/** A pulse down every link of `node`, outwards, slightly staggered. */
export function burst(
  node: number,
  incident: ReadonlyArray<ReadonlyArray<number>>,
  now: number,
  opts: { strength?: number; gen?: number; delay?: number; dur?: (e: number) => number; max?: number } = {},
): Pulse[] {
  const list = incident[node] ?? [];
  const max = opts.max ?? 40;
  const step = list.length > 1 ? Math.min(60, 360 / list.length) : 0;
  return list.slice(0, max).map((e, k) => ({
    e,
    from: node,
    t0: now + (opts.delay ?? 0) + k * step,
    dur: opts.dur?.(e) ?? 700,
    s: opts.strength ?? 1,
    gen: opts.gen ?? 0,
  }));
}

/**
 * What an arriving pulse sets off: up to `fanout` pulses onwards from the
 * node it reached (never straight back), each weaker by `decay`; nothing once
 * the strength would fall under `min`.
 */
export function cascade(
  p: Pulse,
  edges: readonly SynapseEdge[],
  incident: ReadonlyArray<ReadonlyArray<number>>,
  now: number,
  rand: () => number,
  opts: { decay?: number; min?: number; fanout?: number; dur?: (e: number) => number } = {},
): Pulse[] {
  const s = p.s * (opts.decay ?? 0.55);
  if (s < (opts.min ?? 0.22)) return [];
  const node = pulseEnd(p, edges);
  const options = (incident[node] ?? []).filter((e) => e !== p.e);
  const out: Pulse[] = [];
  const fanout = Math.min(opts.fanout ?? 2, options.length);
  for (let k = 0; k < fanout; k++) {
    const pickAt = Math.floor(rand() * options.length);
    const e = options.splice(pickAt, 1)[0]!;
    out.push({ e, from: node, t0: now + 30 + k * 70, dur: opts.dur?.(e) ?? 700, s, gen: p.gen + 1 });
  }
  return out;
}

/**
 * Advance the pulses to `now`: the ones that arrived are handed to
 * `arrive` (which may return new pulses), the rest stay. Capped.
 */
export function stepPulses(
  pulses: readonly Pulse[],
  now: number,
  arrive: (p: Pulse) => Pulse[] | void,
  max = MAX_PULSES,
): Pulse[] {
  const next: Pulse[] = [];
  const born: Pulse[] = [];
  for (const p of pulses) {
    if (pulseProgress(p, now) < 1) next.push(p);
    else {
      const more = arrive(p);
      if (more) born.push(...more);
    }
  }
  for (const p of born) if (next.length < max) next.push(p);
  return next.length > max ? next.slice(next.length - max) : next;
}

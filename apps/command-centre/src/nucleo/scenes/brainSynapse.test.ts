import { describe, expect, it } from "vitest";
import {
  burst,
  cascade,
  incidence,
  pulseDuration,
  pulseEnd,
  pulseProgress,
  stepPulses,
  type Pulse,
} from "./brainSynapse";

// 0 — 1 — 2 — 3, and 1 — 4
const edges = [
  { a: 0, b: 1 },
  { a: 1, b: 2 },
  { a: 2, b: 3 },
  { a: 4, b: 1 },
];
const inc = incidence(5, edges);

describe("synapses", () => {
  it("indexes the links of every node", () => {
    expect(inc[1]).toEqual([0, 1, 3]);
    expect(inc[3]).toEqual([2]);
  });

  it("bursts outwards along every link of a node, staggered", () => {
    const b = burst(1, inc, 1000);
    expect(b.map((p) => p.e)).toEqual([0, 1, 3]);
    expect(b.every((p) => p.from === 1)).toBe(true);
    expect(b.map((p) => pulseEnd(p, edges))).toEqual([0, 2, 4]);
    expect(b[1]!.t0).toBeGreaterThan(b[0]!.t0);
    expect(burst(1, inc, 0, { max: 1 })).toHaveLength(1);
  });

  it("cascades onwards, never straight back, weaker each hop, until it fades", () => {
    const p: Pulse = { e: 0, from: 0, t0: 0, dur: 500, s: 1, gen: 0 };
    const rand = () => 0;
    const next = cascade(p, edges, inc, 500, rand);
    expect(next.length).toBe(2);
    expect(next.every((q) => q.e !== 0 && q.from === 1)).toBe(true);
    expect(next[0]!.s).toBeCloseTo(0.55);
    expect(next[0]!.gen).toBe(1);
    expect(cascade({ ...p, s: 0.3 }, edges, inc, 500, rand)).toEqual([]);
    // a dead end
    expect(cascade({ e: 2, from: 2, t0: 0, dur: 1, s: 1, gen: 0 }, edges, inc, 0, rand)).toEqual([]);
  });

  it("steps: arrived pulses hand over, the rest keep travelling, the pool is capped", () => {
    const pulses: Pulse[] = [
      { e: 0, from: 0, t0: 0, dur: 100, s: 1, gen: 0 },
      { e: 1, from: 1, t0: 0, dur: 1000, s: 1, gen: 0 },
    ];
    const arrived: number[] = [];
    const next = stepPulses(pulses, 200, (p) => {
      arrived.push(p.e);
      return [{ e: 3, from: 1, t0: 200, dur: 100, s: 0.5, gen: 1 }];
    });
    expect(arrived).toEqual([0]);
    expect(next.map((p) => p.e)).toEqual([1, 3]);
    expect(stepPulses(next, 200, () => undefined, 1)).toHaveLength(1);
    expect(pulseProgress(pulses[1]!, 500)).toBeCloseTo(0.5);
  });

  it("takes longer on longer links, within bounds", () => {
    expect(pulseDuration(10)).toBe(420);
    expect(pulseDuration(300)).toBeGreaterThan(pulseDuration(100));
    expect(pulseDuration(1e6)).toBe(1500);
  });
});

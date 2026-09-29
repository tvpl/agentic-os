import { describe, expect, it } from "vitest";
import { edgeBetween, planTour, shortestPath, type TourFile } from "./brainTour";

function graph(n: number, pairs: Array<[number, number]>): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of pairs) {
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  return adj;
}

const file = (id: number, group: string, degree: number, mtime = id): TourFile => ({
  id,
  group,
  degree,
  mtime,
});

describe("shortestPath", () => {
  it("finds the shortest chain, ends included", () => {
    const adj = graph(6, [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [4, 3],
    ]);
    expect(shortestPath(adj, 0, 3)).toEqual([0, 4, 3]);
    expect(shortestPath(adj, 2, 2)).toEqual([2]);
    expect(shortestPath(adj, 0, 5)).toBeNull();
  });
});

describe("planTour", () => {
  it("flies between two hubs of different areas along the links", () => {
    // hub 0 (area a) — 1 — 2 — hub 3 (area b); leaves hang off both hubs.
    const pairs: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 4],
      [0, 5],
      [3, 6],
      [3, 7],
    ];
    const adj = graph(8, pairs);
    const files = [
      file(1, "a", 3),
      file(2, "a", 2),
      file(3, "b", 2),
      file(4, "b", 3),
      file(5, "a", 1),
      file(6, "a", 1),
      file(7, "b", 1),
      file(8, "b", 1),
    ];
    const plan = planTour(files, adj)!;
    expect(plan.kind).toBe("path");
    expect(plan.stops.length).toBeGreaterThanOrEqual(3);
    // consecutive stops are linked
    for (let i = 1; i < plan.stops.length; i++) expect(adj[plan.stops[i - 1]!]).toContain(plan.stops[i]);
    const groups = new Set(plan.stops.map((i) => files[i]!.group));
    expect(groups.size).toBe(2);
  });

  it("falls back to the most recent notes, newest last", () => {
    const files = [file(1, "a", 0, 10), file(2, "a", 0, 30), file(3, "a", 0, 20)];
    const plan = planTour(files, graph(3, []))!;
    expect(plan).toEqual({ kind: "recent", stops: [0, 2, 1] });
  });

  it("respects the allowed set (timeline, local mode) and needs two stops", () => {
    const files = [file(1, "a", 1), file(2, "a", 1)];
    expect(planTour(files, graph(2, [[0, 1]]), { allowed: (i) => i === 0 })).toBeNull();
    expect(planTour([], [])).toBeNull();
  });

  it("caps the path length", () => {
    const n = 12;
    const pairs = Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]);
    const files = Array.from({ length: n }, (_, i) => file(i + 1, "a", i === 0 || i === n - 1 ? 5 : 2));
    const plan = planTour(files, graph(n, pairs), { maxStops: 4 })!;
    expect(plan.stops.length).toBeLessThanOrEqual(5);
  });
});

describe("edgeBetween", () => {
  it("matches either direction", () => {
    const edges = [
      { a: 1, b: 2, kind: "x" },
      { a: 3, b: 4, kind: "y" },
    ];
    expect(edgeBetween(edges, 2, 1)?.kind).toBe("x");
    expect(edgeBetween(edges, 1, 3)).toBeUndefined();
  });
});

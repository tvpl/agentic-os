import type { Db } from "../db/db.js";
import type { RelatedTable } from "./audienceIndex.js";
import { linkEdges } from "./links.js";

/**
 * The personalized PageRank of the recall (.specs/features/cerebro-entidades-resumos, door 5, Landing 5a): seeds on the
 * first files of the fusion, edges over the files the caller sees (links, related edges, shared entities), damping 0.85,
 * at most 30 iterations or until the summed change is below 1e-6.
 */

export const PPR_DAMPING = 0.85;
export const PPR_MAX_ITERATIONS = 30;
export const PPR_TOLERANCE = 1e-6;
/** The first files of the fusion that seed the walk. */
export const PPR_SEEDS = 20;
/** The RRF constant of the seed weights and of the final fusion. */
export const PPR_RRF_K = 60;
/** At most this many files outside the fusion enter the answer's order. */
export const PPR_EXPANSION = 3;
/** The weight of a link, in each direction. */
export const PPR_LINK_WEIGHT = 1;
/** The weight of each non-hub entity two files share. */
export const PPR_ENTITY_WEIGHT = 0.5;

/** A weighted graph: for each node, its neighbours and the weight of the edge to each. */
export type PprGraph = Map<number, Map<number, number>>;

/** Add `weight` to the edge `a → b` (creating both nodes). */
export function addEdge(graph: PprGraph, a: number, b: number, weight: number): void {
  if (a === b || !(weight > 0)) return;
  if (!graph.has(b)) graph.set(b, new Map());
  let out = graph.get(a);
  if (!out) graph.set(a, (out = new Map()));
  out.set(b, (out.get(b) ?? 0) + weight);
}

/** The seeds (AC 40): the first 20 files of the fusion, each `1/(60 + place)` (place from 1), normalized to sum 1. */
export function pprSeeds(fused: readonly number[]): Map<number, number> {
  const seeds = new Map<number, number>();
  fused.slice(0, PPR_SEEDS).forEach((id, i) => {
    if (!seeds.has(id)) seeds.set(id, 1 / (PPR_RRF_K + i + 1));
  });
  const total = [...seeds.values()].reduce((a, b) => a + b, 0);
  for (const [id, w] of seeds) seeds.set(id, w / total);
  return seeds;
}

/**
 * The personalized PageRank of `graph` from `seeds` (AC 40): `r = (1 - d)·p + d·(Σ r(j)·w(j→i)/W(j) + dangling·p)`, where
 * the mass of a node with no edge goes back to the seeds; from `r = p`, until 30 iterations or until the L1 change of an
 * iteration is below 1e-6. A node the seeds cannot reach stays 0.
 */
export function personalizedPageRank(
  graph: PprGraph,
  seeds: ReadonlyMap<number, number>,
): { scores: Map<number, number>; iterations: number } {
  const nodes = [...new Set([...graph.keys(), ...seeds.keys()])];
  const p = new Map(nodes.map((n) => [n, seeds.get(n) ?? 0]));
  const outWeight = new Map(nodes.map((n) => [n, [...(graph.get(n)?.values() ?? [])].reduce((a, b) => a + b, 0)]));
  let r = new Map(p);
  let iterations = 0;
  while (iterations < PPR_MAX_ITERATIONS) {
    iterations++;
    const next = new Map(nodes.map((n) => [n, 0]));
    let dangling = 0;
    for (const j of nodes) {
      const rj = r.get(j)!;
      if (rj === 0) continue;
      const total = outWeight.get(j)!;
      if (total === 0) {
        dangling += rj;
        continue;
      }
      for (const [i, w] of graph.get(j)!) next.set(i, next.get(i)! + (PPR_DAMPING * rj * w) / total);
    }
    let change = 0;
    for (const n of nodes) {
      const value = next.get(n)! + (1 - PPR_DAMPING + PPR_DAMPING * dangling) * p.get(n)!;
      change += Math.abs(value - r.get(n)!);
      next.set(n, value);
    }
    r = next;
    if (change < PPR_TOLERANCE) break;
  }
  return { scores: r, iterations };
}

/** What the recall's graph is made of (door 5): whose edges and the entities two files share. */
export interface RecallGraphSource {
  /** The files the caller's audience sees, by their row (the links resolve among these). */
  allowRow: (row: { root: string; rel: string }) => boolean;
  /** Whether the recall may read the file today (its scope): a file it may not is no node. */
  readable: (path: string) => boolean;
  relatedTable: RelatedTable;
  /** The co-mention edges of the caller's entities (non-hub, not ignored), 0.5 per entity in common. */
  coMentions: () => ReadonlyArray<{ a: number; b: number; weight: number }>;
}

/**
 * The graph over the files the caller sees (AC 41, AC 42): a resolved link is 1 in each direction, a related edge its
 * score in each direction (the larger of the two rows), a shared entity 0.5 in each direction, summed per pair; only the
 * files reached from the seeds through files the recall may read are nodes.
 */
export function recallGraph(db: Db, source: RecallGraphSource, seeds: Iterable<number>): PprGraph {
  const full: PprGraph = new Map();
  const pathOf = new Map<number, string>();
  const files = db.prepare("SELECT id, root, rel, path FROM files").all() as Array<{
    id: number;
    root: string;
    rel: string;
    path: string;
  }>;
  for (const f of files) if (source.allowRow(f)) pathOf.set(f.id, f.path);
  const visible = (id: number) => pathOf.has(id);

  const links = new Set<string>();
  for (const e of linkEdges(db, source.allowRow)) {
    const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    links.add(`${a}:${b}`);
  }
  const related = new Map<string, number>();
  const rows = db.prepare(`SELECT src_id, dst_id, score FROM ${source.relatedTable}`).all() as Array<{
    src_id: number;
    dst_id: number;
    score: number;
  }>;
  for (const row of rows) {
    if (row.src_id === row.dst_id || !visible(row.src_id) || !visible(row.dst_id)) continue;
    const [a, b] = row.src_id < row.dst_id ? [row.src_id, row.dst_id] : [row.dst_id, row.src_id];
    const id = `${a}:${b}`;
    related.set(id, Math.max(related.get(id) ?? 0, row.score));
  }
  const both = (a: number, b: number, weight: number) => {
    addEdge(full, a, b, weight);
    addEdge(full, b, a, weight);
  };
  for (const id of links) {
    const [a, b] = id.split(":").map(Number) as [number, number];
    both(a, b, PPR_LINK_WEIGHT);
  }
  for (const [id, score] of related) {
    const [a, b] = id.split(":").map(Number) as [number, number];
    both(a, b, score);
  }
  for (const e of source.coMentions()) if (visible(e.a) && visible(e.b)) both(e.a, e.b, e.weight);

  // the nodes the seeds reach through files the recall may read
  const readable = new Map<number, boolean>();
  const ok = (id: number) => {
    let known = readable.get(id);
    if (known === undefined) {
      const p = pathOf.get(id);
      known = p !== undefined && source.readable(p);
      readable.set(id, known);
    }
    return known;
  };
  const graph: PprGraph = new Map();
  const queue = [...seeds].filter(ok);
  const seen = new Set(queue);
  for (const id of queue) graph.set(id, new Map());
  while (queue.length > 0) {
    const a = queue.shift()!;
    for (const [b, w] of full.get(a) ?? []) {
      if (!ok(b)) continue;
      graph.get(a)!.set(b, w);
      if (!seen.has(b)) {
        seen.add(b);
        graph.set(b, new Map());
        queue.push(b);
      }
    }
  }
  return graph;
}

/**
 * The order the graph gives (AC 43, AC 44): the fused files and at most 3 files outside the fusion that `admit` lets in
 * (the highest scores), by score, then by place in the fusion, then by id.
 */
export function pprOrder(
  fused: readonly number[],
  scores: ReadonlyMap<number, number>,
  admit: (id: number) => boolean,
): number[] {
  const place = new Map(fused.map((id, i) => [id, i]));
  const by = (a: number, b: number) =>
    (scores.get(b) ?? 0) - (scores.get(a) ?? 0) ||
    (place.get(a) ?? Infinity) - (place.get(b) ?? Infinity) ||
    a - b;
  const outside: number[] = [];
  for (const id of [...scores.keys()].filter((n) => !place.has(n) && (scores.get(n) ?? 0) > 0).sort(by)) {
    if (outside.length >= PPR_EXPANSION) break;
    if (admit(id)) outside.push(id);
  }
  return [...new Set(fused), ...outside].sort(by);
}

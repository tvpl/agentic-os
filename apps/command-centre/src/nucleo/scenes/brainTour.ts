/**
 * The Brain scene's guided tour (immersive shell): a path worth flying.
 *
 * Preferably the shortest chain of links between two of the most connected
 * notes — ideally in different areas, so the tour crosses the brain — long
 * enough to say something (three stops or more) and short enough to watch.
 * Without such a chain, the most recently changed notes, newest last. Pure.
 */

export interface TourFile {
  id: number;
  group: string;
  degree: number;
  mtime: number;
}

export interface TourPlan {
  kind: "path" | "recent";
  /** Indices into the files, in visiting order. */
  stops: number[];
}

/** Shortest path (BFS) from `from` to `to` over an adjacency list, both ends included; null when unreachable. */
export function shortestPath(
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  from: number,
  to: number,
): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of adjacency[i] ?? []) {
        if (prev.has(j)) continue;
        prev.set(j, i);
        if (j === to) {
          const path = [to];
          let cur = i;
          while (cur !== -1) {
            path.push(cur);
            cur = prev.get(cur)!;
          }
          return path.reverse();
        }
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

/** BFS distances (and parents) from one start — all pairs from a few hubs without repeating work. */
function bfs(adjacency: ReadonlyArray<ReadonlyArray<number>>, start: number): Map<number, number> {
  const prev = new Map<number, number>([[start, -1]]);
  let frontier = [start];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier)
      for (const j of adjacency[i] ?? []) {
        if (prev.has(j)) continue;
        prev.set(j, i);
        next.push(j);
      }
    frontier = next;
  }
  return prev;
}

function walkBack(prev: Map<number, number>, end: number): number[] {
  const path: number[] = [];
  let cur: number | undefined = end;
  while (cur !== undefined && cur !== -1) {
    path.push(cur);
    cur = prev.get(cur);
  }
  return path.reverse();
}

export function planTour(
  files: readonly TourFile[],
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  opts: { maxStops?: number; hubs?: number; allowed?: (i: number) => boolean } = {},
): TourPlan | null {
  const maxStops = opts.maxStops ?? 6;
  const allowed = opts.allowed ?? (() => true);
  const pool = files.map((_, i) => i).filter(allowed);
  if (pool.length < 2) return null;
  const adj = adjacency.map((list, i) => (allowed(i) ? list.filter(allowed) : []));

  const hubs = pool
    .filter((i) => (adj[i]?.length ?? 0) > 0)
    .sort((a, b) => adj[b]!.length - adj[a]!.length || files[a]!.id - files[b]!.id)
    .slice(0, opts.hubs ?? 8);
  let best: { path: number[]; score: number } | null = null;
  for (let x = 0; x < hubs.length; x++) {
    const prev = bfs(adj, hubs[x]!);
    for (let y = x + 1; y < hubs.length; y++) {
      if (!prev.has(hubs[y]!)) continue;
      const path = walkBack(prev, hubs[y]!);
      if (path.length < 3 || path.length > maxStops) continue;
      const a = files[hubs[x]!]!;
      const b = files[hubs[y]!]!;
      const score = path.length + (a.group !== b.group ? 3 : 0) + (a.degree + b.degree) / 100;
      if (!best || score > best.score) best = { path, score };
    }
  }
  if (best) return { kind: "path", stops: best.path };

  const recent = [...pool]
    .sort((a, b) => files[b]!.mtime - files[a]!.mtime || files[a]!.id - files[b]!.id)
    .slice(0, Math.min(maxStops, 5))
    .reverse();
  return { kind: "recent", stops: recent };
}

/** The first edge joining two file indices (either direction), or undefined. */
export function edgeBetween<E extends { a: number; b: number }>(
  edges: readonly E[],
  a: number,
  b: number,
): E | undefined {
  return edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

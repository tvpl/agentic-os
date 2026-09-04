/**
 * Graph queries over the world: neighbourhoods, hover / selection focus,
 * local mode (N hops), timeline and client-side hygiene. Pure.
 */
import type { EdgeKind, FileNode, Hub, World, WorldEdge } from "./world";

/** Breadth-first set of file indices within `hops` of `start` over the enabled-kind adjacency. */
export function neighbourhood(
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  start: number,
  hops: number,
): Set<number> {
  const seen = new Set<number>([start]);
  let frontier = [start];
  for (let h = 0; h < hops && frontier.length > 0; h++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of adjacency[i] ?? []) {
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
      }
    }
    frontier = next;
  }
  return seen;
}

export function indexOfId(files: ReadonlyArray<Pick<FileNode, "id">>, id: number | null): number {
  if (id === null) return -1;
  return files.findIndex((n) => n.id === id);
}

/**
 * Hover or selection focus: the focused node plus its direct neighbours light
 * up, everything else dims. Hover wins over selection while present; with
 * neither, no focus (null) and every node is fully lit.
 */
export function updateFocus(w: World): void {
  const focusId = w.hoverId ?? w.selectedId;
  const idx = indexOfId(w.files, focusId);
  w.focusSet = idx < 0 ? null : neighbourhood(w.adjacency, idx, 1);
}

/**
 * Compute the visibility target of every file: local mode (only nodes within
 * `localHops` of the selection) and the timeline cutoff. Filters and the
 * group filter dim instead of hiding, so they stay out of this.
 */
export function applyVisibility(w: World): void {
  const selIdx = indexOfId(w.files, w.selectedId);
  const localSet = w.local && selIdx >= 0 ? neighbourhood(w.adjacency, selIdx, w.localHops) : null;
  const cutoff = w.timeline;
  w.files.forEach((n, i) => {
    let visible = true;
    if (localSet && !localSet.has(i)) visible = false;
    if (cutoff !== null && n.mtime > cutoff) visible = false;
    n.visible = visible;
  });
}

/** Edges of a node grouped by kind with counts and the neighbour ids (relations card, item 33). */
export function relationsOf(
  w: Pick<World, "files" | "edges">,
  id: number,
): Array<{ kind: EdgeKind; count: number; entries: Array<{ id: number; name: string; why: string }> }> {
  const idx = indexOfId(w.files, id);
  if (idx < 0) return [];
  const byKind = new Map<EdgeKind, Array<{ id: number; name: string; why: string }>>();
  for (const e of w.edges) {
    if (e.a !== idx && e.b !== idx) continue;
    const other = w.files[e.a === idx ? e.b : e.a];
    if (!other) continue;
    const list = byKind.get(e.kind) ?? [];
    list.push({ id: other.id, name: other.name, why: e.why });
    byKind.set(e.kind, list);
  }
  return [...byKind.entries()]
    .map(([kind, entries]) => ({ kind, count: entries.length, entries }))
    .sort((a, b) => b.count - a.count);
}

/** [min, max] mtime of the loaded files (timeline scrubber bounds); null when empty. */
export function timelineRange(files: ReadonlyArray<Pick<FileNode, "mtime">>): [number, number] | null {
  if (files.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const n of files) {
    if (n.mtime < min) min = n.mtime;
    if (n.mtime > max) max = n.mtime;
  }
  return [min, max];
}

export interface HygieneReport {
  /** Files without any edge of any kind. */
  orphans: FileNode[];
  /** Files not modified for `staleDays`. */
  stale: FileNode[];
  /** Collapsed hubs with more than `bigHub` files that were never expanded. */
  unopened: Hub[];
}

const DAY_MS = 86_400_000;

/** Client-side hygiene (item 40). Considers every edge kind, not only the enabled ones. */
export function hygiene(
  w: Pick<World, "files" | "edges" | "hubs">,
  opts: { now?: number; staleDays?: number; bigHub?: number; limit?: number } = {},
): HygieneReport {
  const now = opts.now ?? Date.now();
  const staleMs = (opts.staleDays ?? 90) * DAY_MS;
  const bigHub = opts.bigHub ?? 50;
  const limit = opts.limit ?? 40;
  const touched = new Uint8Array(w.files.length);
  for (const e of w.edges as WorldEdge[]) {
    touched[e.a] = 1;
    touched[e.b] = 1;
  }
  const orphans = w.files.filter((_, i) => touched[i] === 0).slice(0, limit);
  const stale = w.files
    .filter((n) => now - n.mtime > staleMs)
    .sort((a, b) => a.mtime - b.mtime)
    .slice(0, limit);
  const unopened = w.hubs.filter((h) => !h.expanded && !h.everExpanded && h.count > bigHub);
  return { orphans, stale, unopened };
}

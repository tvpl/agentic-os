/** Pointer → entity resolution. Hubs win over orbs, orbs over files; files by nearest within tolerance. */
import type { FileNode, Hub, OrbNode, Transform, World } from "./world";

export type Hit =
  | { kind: "hub"; hub: Hub }
  | { kind: "orb"; orb: OrbNode }
  | { kind: "file"; file: FileNode };

export const HUB_HIT_RADIUS = 17;
export const APP_HIT_RADIUS = 17;
export const ORB_HIT_RADIUS = 13;

export function hitTest(w: Pick<World, "hubs" | "orbs" | "files" | "transform">, wx: number, wy: number): Hit | null {
  for (const hub of w.hubs) {
    if (Math.hypot(wx - hub.x, wy - hub.y) < HUB_HIT_RADIUS) return { kind: "hub", hub };
  }
  for (const orb of w.orbs) {
    if (Math.hypot(wx - orb.x, wy - orb.y) < (orb.kind === "app" ? APP_HIT_RADIUS : ORB_HIT_RADIUS)) return { kind: "orb", orb };
  }
  const tol = fileTolerance(w.transform.k);
  let best: FileNode | undefined;
  let bestD = tol * tol;
  for (const n of w.files) {
    const dx = wx - n.x;
    const dy = wy - n.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best ? { kind: "file", file: best } : null;
}

/** World-unit tolerance for picking a file at zoom `k` (bigger when zoomed out). */
export function fileTolerance(k: number): number {
  return 9 / k + 4;
}

/** Stable identity of a hit — used to detect hover changes without re-rendering. */
export function hitKey(hit: Hit | null): string | null {
  if (!hit) return null;
  if (hit.kind === "hub") return `hub:${hit.hub.key}`;
  if (hit.kind === "orb") return `${hit.orb.kind}:${hit.orb.id}`;
  return `file:${hit.file.id}`;
}

export function screenToWorld(tr: Transform, sx: number, sy: number, cw: number, ch: number): { x: number; y: number } {
  return { x: (sx - cw / 2 - tr.x) / tr.k, y: (sy - ch / 2 - tr.y) / tr.k };
}

export function worldToScreen(tr: Transform, x: number, y: number, cw: number, ch: number): { x: number; y: number } {
  return { x: cw / 2 + tr.x + x * tr.k, y: ch / 2 + tr.y + y * tr.k };
}

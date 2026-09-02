/**
 * File layouts — nebulas around each hub shaped by the chosen layout.
 * Pure functions over the world; deterministic for the same input.
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force";
import { RING, TWO_PI, type FileNode, type Hub, type LayoutKind, type World } from "./world";

export type LayoutWorld = Pick<World, "files" | "hubs" | "layout" | "clusterSize">;

/** Golden-angle based spread, in [0, 1). */
const spread = (i: number, phi: number): number => (i * phi) % 1;

function assignPolar(n: FileNode, x: number, y: number): void {
  n.baseRadius = Math.hypot(x, y);
  n.baseAngle = Math.atan2(y, x);
}

function layoutCollapsed(list: FileNode[], hubX: number, hubY: number): void {
  list.forEach((n, i) => {
    const rr = 20 + (i % 3) * 5;
    const aa = (i / Math.max(1, list.length)) * TWO_PI;
    assignPolar(n, hubX + Math.cos(aa) * rr * 0.8, hubY + Math.sin(aa) * rr * 0.8);
  });
}

export function layoutHex(list: FileNode[], hub: Hub, hubX: number, hubY: number, cs: number): void {
  const HEX = 13 * cs;
  const cols = Math.max(3, Math.ceil(Math.sqrt(list.length) * 1.25));
  list.forEach((n, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const localX = (col - cols / 2) * HEX + (row % 2 ? HEX / 2 : 0);
    const localY = 46 + row * HEX * 0.87;
    const ang = hub.baseAngle + Math.PI / 2;
    assignPolar(
      n,
      hubX + localX * Math.cos(ang) + Math.cos(hub.baseAngle) * localY,
      hubY + localX * Math.sin(ang) + Math.sin(hub.baseAngle) * localY,
    );
  });
}

export function layoutCircle(list: FileNode[], hub: Hub, cs: number): void {
  const clusterR = (16 + Math.sqrt(list.length) * 7.5) * cs;
  const centerR = RING.hubs + clusterR + 26;
  const gx = Math.cos(hub.baseAngle) * centerR;
  const gy = Math.sin(hub.baseAngle) * centerR;
  list.forEach((n, i) => {
    const rr = clusterR * Math.sqrt((i + 0.5) / list.length);
    const aa = i * 2.399963;
    assignPolar(n, gx + Math.cos(aa) * rr, gy + Math.sin(aa) * rr);
  });
}

export function layoutRings(list: FileNode[], hub: Hub, hubCount: number, cs: number): void {
  const sector = TWO_PI / Math.max(1, hubCount);
  const span = sector * 0.9;
  list.forEach((n, i) => {
    const tFrac = (i + 0.5) / list.length;
    const rr =
      (RING.filesInner + (RING.routines - 42 - RING.filesInner) * Math.pow(tFrac, 0.72)) *
      (0.82 + 0.36 * spread(i, 0.618)) *
      (0.7 + 0.3 * cs);
    n.baseRadius = Math.min(rr, RING.routines - 26);
    n.baseAngle = hub.baseAngle - span / 2 + span * spread(i, 0.381966);
  });
}

/**
 * Assigns polar targets to every file. Files of collapsed hubs gather in a
 * halo around the hub; expanded hubs get the layout-specific shape. The
 * "force" layout also gets ring targets (used as fallback while the
 * simulation is not running).
 */
export function layoutFiles(w: LayoutWorld): void {
  const byGroup = new Map<string, FileNode[]>();
  for (const n of w.files) {
    const list = byGroup.get(n.group);
    if (list) list.push(n);
    else byGroup.set(n.group, [n]);
  }
  const cs = w.clusterSize;
  for (const hub of w.hubs) {
    const list = (byGroup.get(hub.key) ?? []).slice().sort((a, b) => b.mtime - a.mtime || a.id - b.id);
    if (list.length === 0) continue;
    const hubX = Math.cos(hub.baseAngle) * RING.hubs;
    const hubY = Math.sin(hub.baseAngle) * RING.hubs;
    if (!hub.expanded) layoutCollapsed(list, hubX, hubY);
    else if (w.layout === "hex") layoutHex(list, hub, hubX, hubY, cs);
    else if (w.layout === "circle") layoutCircle(list, hub, cs);
    else layoutRings(list, hub, w.hubs.length, cs);
  }
}

/** Rotated target of a file for the current ring angle. */
export function targetOf(n: Pick<FileNode, "baseAngle" | "baseRadius">, theta: number): [number, number] {
  const bx = Math.cos(n.baseAngle) * n.baseRadius;
  const by = Math.sin(n.baseAngle) * n.baseRadius;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [bx * cos - by * sin, bx * sin + by * cos];
}

/** Snaps every file onto its target and zeroes velocities (reduced motion, tests). */
export function settle(w: Pick<World, "files" | "theta">): void {
  for (const n of w.files) {
    const [tx, ty] = targetOf(n, w.theta);
    n.tx = tx;
    n.ty = ty;
    n.x = tx;
    n.y = ty;
    n.vx = 0;
    n.vy = 0;
  }
}

export const FORCE_LINK_KEY = "link";

/** d3-force simulation for the "force" layout. Created once per graph; tuned in place. */
export function createForceSimulation(w: Pick<World, "files" | "edges" | "linkSpring">): Simulation<FileNode, undefined> {
  const links = w.edges.map((e) => ({ source: w.files[e.a]!, target: w.files[e.b]! }));
  return forceSimulation(w.files)
    .force("charge", forceManyBody().strength(-24))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide<FileNode>((n) => n.r * 2.6))
    .force(FORCE_LINK_KEY, forceLink(links).distance(44).strength(w.linkSpring * 10))
    .alphaDecay(0.006)
    .stop();
}

/** Updates the spring strength without rebuilding the simulation (audit item 30). */
export function setLinkSpring(sim: Simulation<FileNode, undefined>, linkSpring: number): void {
  const link = sim.force<ReturnType<typeof forceLink<FileNode, { source: FileNode; target: FileNode }>>>(FORCE_LINK_KEY);
  link?.strength(linkSpring * 10);
  sim.alpha(Math.max(sim.alpha(), 0.3)).restart().stop();
}

export const LAYOUTS: readonly LayoutKind[] = ["force", "circle", "hex", "rings"];

/**
 * File layouts around each memory hub. Every layout writes only the polar
 * target (`baseAngle`, `baseRadius`) of each file (and of each sub-folder
 * planet); the physics step rotates and springs the particles toward it.
 * Pure functions, deterministic.
 */
import { RING, TWO_PI, type FileNode, type Hub, type LayoutKind, type Planet } from "./world";

export type LayoutWorld = { files: FileNode[]; hubs: Hub[]; planets: Planet[]; layout: LayoutKind; clusterSize: number };

/** Golden-angle spiral used by the circle layout. */
const GOLDEN_ANGLE = 2.399963;
/** Arcs layout: gap between sectors (radians) and dot spacing along an arc (world units). */
const SECTOR_GAP = 0.05;
const ARC_SPACING = 7;
const ARC_ROW = 8.5;
/** Planets shown per hub at most (largest sub-folders first). */
export const MAX_PLANETS = 8;

/** Files of a group in "arc order": directory, then most recent first. */
export function orderFiles(list: ReadonlyArray<FileNode>): FileNode[] {
  return list.slice().sort((a, b) => a.dir.localeCompare(b.dir) || b.mtime - a.mtime || a.id - b.id);
}

/**
 * Angular sectors proportional to sqrt(count) (item 36): a 10 000-file
 * department reads as large without starving a 50-file one. Sectors are laid
 * clockwise from the top in hub order and separated by a small gap.
 */
export function computeSectors(hubs: ReadonlyArray<Pick<Hub, "key" | "count">>): Array<{ key: string; start: number; span: number; centre: number }> {
  if (hubs.length === 0) return [];
  const weights = hubs.map((h) => Math.sqrt(Math.max(1, h.count)));
  const total = weights.reduce((a, b) => a + b, 0);
  const usable = TWO_PI - SECTOR_GAP * hubs.length;
  let cursor = -Math.PI / 2;
  return hubs.map((h, i) => {
    const span = (weights[i]! / total) * usable;
    const start = cursor + SECTOR_GAP / 2;
    cursor += span + SECTOR_GAP;
    return { key: h.key, start, span, centre: start + span / 2 };
  });
}

export function layoutFiles(w: LayoutWorld): void {
  const byGroup = new Map<string, FileNode[]>();
  for (const n of w.files) {
    const list = byGroup.get(n.group) ?? [];
    list.push(n);
    byGroup.set(n.group, list);
  }
  const cs = w.clusterSize;
  const planets: Planet[] = [];

  // Hub angles: proportional sectors under "arcs", even spacing otherwise.
  if (w.layout === "arcs") {
    for (const s of computeSectors(w.hubs)) {
      const hub = w.hubs.find((h) => h.key === s.key)!;
      hub.baseAngle = s.centre;
      hub.sectorStart = s.start;
      hub.sectorSpan = s.span;
    }
  } else {
    w.hubs.forEach((hub, gi) => {
      hub.baseAngle = (gi / Math.max(1, w.hubs.length)) * TWO_PI - Math.PI / 2;
      hub.sectorSpan = TWO_PI / Math.max(1, w.hubs.length);
      hub.sectorStart = hub.baseAngle - hub.sectorSpan / 2;
    });
  }

  for (const hub of w.hubs) {
    const list = orderFiles(byGroup.get(hub.key) ?? []);
    if (list.length === 0) continue;
    const hubX = Math.cos(hub.baseAngle) * RING.hubs;
    const hubY = Math.sin(hub.baseAngle) * RING.hubs;

    if (!hub.expanded) {
      // Collapsed: a tight halo around the hub disc.
      list.forEach((n, i) => {
        const rr = 20 + (i % 3) * 5;
        const aa = (i / Math.max(1, list.length)) * TWO_PI;
        setPolar(n, hubX + Math.cos(aa) * rr * 0.8, hubY + Math.sin(aa) * rr * 0.8);
      });
      continue;
    }

    if (w.layout === "arcs") {
      layoutArcs(hub, list, cs, planets);
      continue;
    }

    if (w.layout === "hex") {
      const HEX = 13 * cs;
      const cols = Math.max(3, Math.ceil(Math.sqrt(list.length) * 1.25));
      list.forEach((n, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const localX = (col - cols / 2) * HEX + (row % 2 ? HEX / 2 : 0);
        const localY = 46 + row * HEX * 0.87;
        const ang = hub.baseAngle + Math.PI / 2;
        setPolar(n, hubX + localX * Math.cos(ang) + Math.cos(hub.baseAngle) * localY, hubY + localX * Math.sin(ang) + Math.sin(hub.baseAngle) * localY);
      });
    } else if (w.layout === "circle") {
      const clusterR = (16 + Math.sqrt(list.length) * 7.5) * cs;
      const centerR = RING.hubs + clusterR + 26;
      const gx = Math.cos(hub.baseAngle) * centerR;
      const gy = Math.sin(hub.baseAngle) * centerR;
      list.forEach((n, i) => {
        const rr = clusterR * Math.sqrt((i + 0.5) / list.length);
        const aa = i * GOLDEN_ANGLE;
        setPolar(n, gx + Math.cos(aa) * rr, gy + Math.sin(aa) * rr);
      });
    } else {
      // rings (and the resting targets under force): a sector fan between the memory ring and the routines ring.
      const span = hub.sectorSpan * 0.9;
      list.forEach((n, i) => {
        const tFrac = (i + 0.5) / list.length;
        const rr = (RING.filesInner + (RING.routines - 42 - RING.filesInner) * Math.pow(tFrac, 0.72)) * (0.82 + 0.36 * ((i * 0.618) % 1)) * (0.7 + 0.3 * cs);
        n.baseRadius = Math.min(rr, RING.routines - 26);
        n.baseAngle = hub.baseAngle - span / 2 + span * ((i * 0.381966) % 1);
      });
    }
    planets.push(...centroidPlanets(hub, list));
  }
  w.planets = planets;
}

/**
 * The RUBRIC look: inside the hub sector, files sit on concentric dotted arcs
 * with a fixed arc-length pitch; radius grows per row. Sub-folders become
 * planets that take the slot right before their run of files.
 */
function layoutArcs(hub: Hub, list: FileNode[], cs: number, planets: Planet[]): void {
  const span = hub.sectorSpan * 0.88;
  const start = hub.baseAngle - span / 2;
  const spacing = ARC_SPACING * cs;
  const rowStep = ARC_ROW * cs;
  const runs = dirRuns(list);
  const planetDirs = new Set(
    runs
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_PLANETS)
      .map((r) => r.dir),
  );
  const slots: Array<{ kind: "file"; node: FileNode } | { kind: "planet"; run: { dir: string; count: number } }> = [];
  for (const run of runs) {
    if (planetDirs.has(run.dir)) slots.push({ kind: "planet", run });
    for (const n of run.files) slots.push({ kind: "file", node: n });
  }
  let row = 0;
  let i = 0;
  while (i < slots.length) {
    const radius = RING.filesInner + 14 + row * rowStep;
    const perRow = Math.max(1, Math.floor((span * radius) / spacing));
    const count = Math.min(perRow, slots.length - i);
    // Centre a partial last row inside the sector so the arc reads balanced.
    const pitch = spacing / radius;
    const offset = (span - pitch * (count - 1)) / 2;
    for (let j = 0; j < count; j++) {
      const angle = start + offset + pitch * j;
      const slot = slots[i + j]!;
      if (slot.kind === "file") {
        slot.node.baseAngle = angle;
        slot.node.baseRadius = radius;
      } else {
        planets.push({ hubKey: hub.key, dir: slot.run.dir, label: lastSegment(slot.run.dir), count: slot.run.count, baseAngle: angle, baseRadius: radius, x: 0, y: 0 });
      }
    }
    i += count;
    row++;
  }
}

/** Consecutive files of the same directory (list must already be in arc order). */
export function dirRuns(list: ReadonlyArray<FileNode>): Array<{ dir: string; count: number; files: FileNode[] }> {
  const runs: Array<{ dir: string; count: number; files: FileNode[] }> = [];
  for (const n of list) {
    const last = runs[runs.length - 1];
    if (last && last.dir === n.dir) {
      last.files.push(n);
      last.count++;
    } else {
      runs.push({ dir: n.dir, count: 1, files: [n] });
    }
  }
  return runs;
}

/** Planets for non-arc layouts: one per big sub-folder, at the centroid of its files' targets. */
function centroidPlanets(hub: Hub, list: FileNode[]): Planet[] {
  const byDir = new Map<string, FileNode[]>();
  for (const n of list) {
    const l = byDir.get(n.dir) ?? [];
    l.push(n);
    byDir.set(n.dir, l);
  }
  return [...byDir.entries()]
    .filter(([, files]) => files.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_PLANETS)
    .map(([dir, files]) => {
      let sx = 0;
      let sy = 0;
      for (const n of files) {
        sx += Math.cos(n.baseAngle) * n.baseRadius;
        sy += Math.sin(n.baseAngle) * n.baseRadius;
      }
      const cx = sx / files.length;
      const cy = sy / files.length;
      return { hubKey: hub.key, dir, label: lastSegment(dir), count: files.length, baseAngle: Math.atan2(cy, cx), baseRadius: Math.hypot(cx, cy), x: 0, y: 0 };
    });
}

export function lastSegment(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

function setPolar(n: FileNode, x: number, y: number): void {
  n.baseRadius = Math.hypot(x, y);
  n.baseAngle = Math.atan2(y, x);
}

/** Cartesian target of a file for the current ring rotation. */
export function targetOf(n: Pick<FileNode, "baseAngle" | "baseRadius">, theta: number): [number, number] {
  const bx = Math.cos(n.baseAngle) * n.baseRadius;
  const by = Math.sin(n.baseAngle) * n.baseRadius;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [bx * cos - by * sin, bx * sin + by * cos];
}

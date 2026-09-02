/**
 * File layouts around each memory hub. Every layout writes only the polar
 * target (`baseAngle`, `baseRadius`) of each file; the physics step rotates
 * and springs the particles toward it. Pure functions, deterministic.
 */
import { RING, TWO_PI, type FileNode, type Hub, type LayoutKind } from "./world";

export type LayoutWorld = { files: FileNode[]; hubs: Hub[]; layout: LayoutKind; clusterSize: number };

/** Golden-angle spiral used by the circle layout. */
const GOLDEN_ANGLE = 2.399963;

export function layoutFiles(w: LayoutWorld): void {
  const byGroup = new Map<string, FileNode[]>();
  for (const n of w.files) {
    const list = byGroup.get(n.group) ?? [];
    list.push(n);
    byGroup.set(n.group, list);
  }
  const cs = w.clusterSize;

  for (const hub of w.hubs) {
    const list = (byGroup.get(hub.key) ?? []).slice().sort((a, b) => b.mtime - a.mtime);
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
      const sector = TWO_PI / Math.max(1, w.hubs.length);
      const span = sector * 0.9;
      list.forEach((n, i) => {
        const tFrac = (i + 0.5) / list.length;
        const rr = (RING.filesInner + (RING.routines - 42 - RING.filesInner) * Math.pow(tFrac, 0.72)) * (0.82 + 0.36 * ((i * 0.618) % 1)) * (0.7 + 0.3 * cs);
        n.baseRadius = Math.min(rr, RING.routines - 26);
        n.baseAngle = hub.baseAngle - span / 2 + span * ((i * 0.381966) % 1);
      });
    }
  }
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

/**
 * Force layout driver (plan Onda 4): the d3-force simulation runs in a Web
 * Worker so a 4000-node graph never stalls the canvas thread; positions come
 * back as a transferable Float32Array once per worker tick and are applied on
 * the next frame. Where workers are unavailable (tests, file:// previews) the
 * same simulation runs inline, so the engine has one interface either way.
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { FileNode } from "./world";

export interface ForceEngine {
  alpha(): number;
  alphaMin(): number;
  alphaTarget(v: number): ForceEngine;
  restart(): ForceEngine;
  stop(): void;
  /** Advance one frame on the main thread (apply worker positions, or tick inline). */
  tick(): void;
}

export interface ForceLink {
  a: number;
  b: number;
}

export interface ForceParams {
  linkSpring: number;
}

export const FORCE = { charge: -24, collide: 2.6, linkDistance: 44, alphaDecay: 0.006 } as const;

/** Shared with the worker: node data packed as [x, y, r, fx, fy] per node (NaN = unpinned). */
export const STRIDE = 5;

export function packNodes(files: ReadonlyArray<FileNode>): Float32Array {
  const out = new Float32Array(files.length * STRIDE);
  files.forEach((n, i) => {
    out[i * STRIDE] = n.x;
    out[i * STRIDE + 1] = n.y;
    out[i * STRIDE + 2] = n.r;
    out[i * STRIDE + 3] = n.fx ?? NaN;
    out[i * STRIDE + 4] = n.fy ?? NaN;
  });
  return out;
}

export type WorkerIn =
  | { type: "init"; nodes: Float32Array; links: Uint32Array; linkSpring: number }
  | { type: "pins"; data: Float32Array }
  | { type: "alphaTarget"; value: number }
  | { type: "restart" }
  | { type: "stop" };

export type WorkerOut = { type: "tick"; positions: Float32Array; alpha: number };

/** The inline engine: d3 on the main thread (also used by the worker itself). */
export function buildSimulation(nodes: FileNode[], links: ForceLink[], params: ForceParams) {
  return forceSimulation(nodes)
    .force("charge", forceManyBody().strength(FORCE.charge))
    .force("center", forceCenter(0, 0))
    .force(
      "collide",
      forceCollide<FileNode>((n) => n.r * FORCE.collide),
    )
    .force(
      "link",
      forceLink(links.map((l) => ({ source: nodes[l.a]!, target: nodes[l.b]! })))
        .distance(FORCE.linkDistance)
        .strength(params.linkSpring * 10),
    )
    .alphaDecay(FORCE.alphaDecay)
    .stop();
}

class InlineForce implements ForceEngine {
  private sim: ReturnType<typeof buildSimulation>;
  constructor(nodes: FileNode[], links: ForceLink[], params: ForceParams) {
    this.sim = buildSimulation(nodes, links, params);
  }
  alpha() {
    return this.sim.alpha();
  }
  alphaMin() {
    return this.sim.alphaMin();
  }
  alphaTarget(v: number) {
    this.sim.alphaTarget(v);
    return this;
  }
  restart() {
    this.sim.restart();
    return this;
  }
  stop() {
    this.sim.stop();
  }
  tick() {
    this.sim.tick();
  }
}

class WorkerForce implements ForceEngine {
  private worker: Worker;
  private nodes: FileNode[];
  private latest: Float32Array | null = null;
  private lastAlpha = 1;
  private min = 0.001;
  private sentPins: Float32Array;
  private stopped = false;

  constructor(nodes: FileNode[], links: ForceLink[], params: ForceParams) {
    this.nodes = nodes;
    this.sentPins = new Float32Array(nodes.length * 2).fill(NaN);
    nodes.forEach((n, i) => {
      this.sentPins[i * 2] = n.fx ?? NaN;
      this.sentPins[i * 2 + 1] = n.fy ?? NaN;
    });
    this.worker = new Worker(new URL("./force.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.type !== "tick") return;
      this.latest = e.data.positions;
      this.lastAlpha = e.data.alpha;
    };
    const packedLinks = new Uint32Array(links.length * 2);
    links.forEach((l, i) => {
      packedLinks[i * 2] = l.a;
      packedLinks[i * 2 + 1] = l.b;
    });
    const packed = packNodes(nodes);
    this.post({ type: "init", nodes: packed, links: packedLinks, linkSpring: params.linkSpring }, [
      packed.buffer,
      packedLinks.buffer,
    ]);
  }

  private post(msg: WorkerIn, transfer: Transferable[] = []) {
    if (this.stopped) return;
    this.worker.postMessage(msg, transfer);
  }

  alpha() {
    return this.lastAlpha;
  }
  alphaMin() {
    return this.min;
  }
  alphaTarget(v: number) {
    this.post({ type: "alphaTarget", value: v });
    if (v > this.lastAlpha) this.lastAlpha = v; // keep the frame loop awake until the worker reports
    return this;
  }
  restart() {
    this.post({ type: "restart" });
    return this;
  }
  stop() {
    this.stopped = true;
    this.worker.terminate();
  }

  /** Send pin changes (drag, pin toggles) and apply the newest worker positions. */
  tick() {
    const changes: number[] = [];
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      const fx = n.fx ?? NaN;
      const fy = n.fy ?? NaN;
      const sx = this.sentPins[i * 2]!;
      const sy = this.sentPins[i * 2 + 1]!;
      if (Object.is(fx, sx) && Object.is(fy, sy)) continue;
      this.sentPins[i * 2] = fx;
      this.sentPins[i * 2 + 1] = fy;
      changes.push(i, fx, fy);
    }
    if (changes.length > 0) {
      const data = new Float32Array(changes);
      this.post({ type: "pins", data }, [data.buffer]);
    }
    const p = this.latest;
    if (!p) return;
    this.latest = null;
    const count = Math.min(nodes.length, p.length >> 1);
    for (let i = 0; i < count; i++) {
      const n = nodes[i]!;
      if (n.fx != null) continue; // pinned or dragging: the main thread owns it
      const x = p[i * 2]!;
      const y = p[i * 2 + 1]!;
      n.vx = x - n.x;
      n.vy = y - n.y;
      n.x = x;
      n.y = y;
    }
  }
}

/** True when the worker path is usable (module workers exist and we are on http(s)/vite). */
export function workersAvailable(): boolean {
  return typeof Worker !== "undefined" && typeof window !== "undefined" && !!window.document;
}

export function createForceEngine(nodes: FileNode[], links: ForceLink[], params: ForceParams): ForceEngine {
  if (workersAvailable()) {
    try {
      return new WorkerForce(nodes, links, params);
    } catch {
      /* fall through to inline */
    }
  }
  return new InlineForce(nodes, links, params);
}

/**
 * d3-force in a Web Worker: receives packed nodes/links, ticks while the
 * simulation is warm and posts positions back as a transferable array. Pins
 * arrive as (index, fx, fy) triples; NaN unpins.
 */
import { buildSimulation, STRIDE, type WorkerIn, type WorkerOut } from "./force";
import type { FileNode } from "./world";

const port = globalThis as unknown as Worker;

type Node = Pick<FileNode, "x" | "y" | "r" | "fx" | "fy" | "vx" | "vy" | "index">;

let nodes: Node[] = [];
let sim: ReturnType<typeof buildSimulation> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const TICK_MS = 16;

function loop(): void {
  timer = null;
  if (!sim) return;
  sim.tick();
  const out = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    out[i * 2] = nodes[i]!.x;
    out[i * 2 + 1] = nodes[i]!.y;
  }
  const msg: WorkerOut = { type: "tick", positions: out, alpha: sim.alpha() };
  port.postMessage(msg, [out.buffer]);
  if (sim.alpha() > sim.alphaMin()) timer = setTimeout(loop, TICK_MS);
}

function wake(): void {
  if (timer === null && sim) timer = setTimeout(loop, 0);
}

port.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      const count = m.nodes.length / STRIDE;
      nodes = [];
      for (let i = 0; i < count; i++) {
        const fx = m.nodes[i * STRIDE + 3]!;
        const fy = m.nodes[i * STRIDE + 4]!;
        nodes.push({
          index: i,
          x: m.nodes[i * STRIDE]!,
          y: m.nodes[i * STRIDE + 1]!,
          r: m.nodes[i * STRIDE + 2]!,
          fx: Number.isNaN(fx) ? null : fx,
          fy: Number.isNaN(fy) ? null : fy,
          vx: 0,
          vy: 0,
        });
      }
      const links = [];
      for (let i = 0; i < m.links.length; i += 2) links.push({ a: m.links[i]!, b: m.links[i + 1]! });
      sim = buildSimulation(nodes as FileNode[], links, { linkSpring: m.linkSpring });
      wake();
      break;
    }
    case "pins": {
      for (let i = 0; i < m.data.length; i += 3) {
        const n = nodes[m.data[i]!];
        if (!n) continue;
        const fx = m.data[i + 1]!;
        const fy = m.data[i + 2]!;
        n.fx = Number.isNaN(fx) ? null : fx;
        n.fy = Number.isNaN(fy) ? null : fy;
        if (n.fx != null && n.fy != null) {
          n.x = n.fx;
          n.y = n.fy;
        }
      }
      wake();
      break;
    }
    case "alphaTarget":
      sim?.alphaTarget(m.value);
      wake();
      break;
    case "restart":
      if (sim && sim.alpha() < 0.3) sim.alpha(0.3);
      wake();
      break;
    case "stop":
      if (timer !== null) clearTimeout(timer);
      timer = null;
      sim?.stop();
      sim = null;
      break;
  }
};

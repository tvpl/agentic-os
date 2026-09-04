/**
 * Replay model: events → nodes (prompt, one per tool, assistant, result) and
 * particles flying between them at the events' timestamps. Pure so the
 * canvas only draws; `stateAt(t)` gives what to draw for a playback time.
 */
import type { RunEventView } from "./useRunStream";

export type ReplayNodeKind = "prompt" | "tool" | "assistant" | "result" | "usage";

export interface ReplayNode {
  id: string;
  label: string;
  kind: ReplayNodeKind;
  count: number;
  firstAt: number;
  lastAt: number;
}

export interface ReplayParticle {
  id: number;
  from: string;
  to: string;
  /** ms since run start */
  at: number;
  /** ms the particle takes to arrive (run time) */
  flight: number;
  kind: "tool" | "assistant" | "result" | "error" | "usage";
}

export interface ReplayModel {
  start: number;
  end: number;
  duration: number;
  nodes: ReplayNode[];
  particles: ReplayParticle[];
  ok: boolean | null;
}

export const FLIGHT_MS = 700;

export function buildReplayModel(events: readonly RunEventView[]): ReplayModel {
  const start = events[0]?.ts ?? 0;
  const end = events[events.length - 1]?.ts ?? start;
  const duration = Math.max(1, end - start);
  const nodes = new Map<string, ReplayNode>();
  const particles: ReplayParticle[] = [];
  let ok: boolean | null = null;
  const touch = (id: string, label: string, kind: ReplayNodeKind, at: number) => {
    const n = nodes.get(id);
    if (n) {
      n.count++;
      n.lastAt = at;
    } else nodes.set(id, { id, label, kind, count: 1, firstAt: at, lastAt: at });
  };
  touch("prompt", "prompt", "prompt", 0);
  let last = "prompt";
  let seq = 0;
  const flightFor = (i: number, at: number) => {
    const next = events[i + 1];
    const gap = next ? next.ts - start - at : FLIGHT_MS;
    return Math.max(40, Math.min(FLIGHT_MS, gap > 0 ? gap : FLIGHT_MS));
  };
  events.forEach((e, i) => {
    const at = e.ts - start;
    switch (e.type) {
      case "tool_use": {
        const tool = String(e.tool ?? "tool");
        const id = `tool:${tool}`;
        touch(id, tool, "tool", at);
        particles.push({
          id: seq++,
          from: last === id ? "prompt" : last,
          to: id,
          at,
          flight: flightFor(i, at),
          kind: "tool",
        });
        last = id;
        break;
      }
      case "assistant":
        touch("assistant", "assistant", "assistant", at);
        particles.push({
          id: seq++,
          from: last,
          to: "assistant",
          at,
          flight: flightFor(i, at),
          kind: "assistant",
        });
        last = "assistant";
        break;
      case "usage":
        touch("usage", "usage", "usage", at);
        particles.push({ id: seq++, from: last, to: "usage", at, flight: flightFor(i, at), kind: "usage" });
        break;
      case "error":
        touch("result", "result", "result", at);
        particles.push({ id: seq++, from: last, to: "result", at, flight: flightFor(i, at), kind: "error" });
        ok = false;
        last = "result";
        break;
      case "result":
        touch("result", "result", "result", at);
        particles.push({ id: seq++, from: last, to: "result", at, flight: flightFor(i, at), kind: "result" });
        ok = ok ?? (e.exitCode === 0 && !e.timedOut && !e.cancelled);
        last = "result";
        break;
      default:
        break;
    }
  });
  return { start, end, duration, nodes: [...nodes.values()], particles, ok };
}

export interface Flight {
  particle: ReplayParticle;
  /** 0..1 along the edge */
  progress: number;
}

export interface ReplayState {
  flights: Flight[];
  /** node id → ms since the last particle arrived (for glow decay) */
  arrivals: Map<string, number>;
  /** particles already delivered */
  delivered: number;
}

export function stateAt(model: ReplayModel, t: number): ReplayState {
  const flights: Flight[] = [];
  const arrivals = new Map<string, number>();
  let delivered = 0;
  for (const p of model.particles) {
    if (p.at > t) break;
    const arrive = p.at + p.flight;
    if (t < arrive) flights.push({ particle: p, progress: (t - p.at) / p.flight });
    else {
      delivered++;
      const since = t - arrive;
      const prev = arrivals.get(p.to);
      if (prev === undefined || since < prev) arrivals.set(p.to, since);
    }
  }
  if (t >= 0) arrivals.set("prompt", arrivals.get("prompt") ?? t);
  return { flights, arrivals, delivered };
}

/** Static summary for reduced motion: tools with counts, in first-use order. */
export function replaySummary(
  model: ReplayModel,
): Array<{ label: string; count: number; kind: ReplayNodeKind }> {
  return model.nodes
    .filter((n) => n.kind !== "prompt")
    .map((n) => ({ label: n.label, count: n.count, kind: n.kind }));
}

export interface PlacedNode extends ReplayNode {
  x: number;
  y: number;
}

/**
 * Deterministic layout for the canvas: prompt on the left, tools stacked in
 * the middle column, assistant and result on the right. Pure so the drawing
 * code stays a projection of the model (and so it can be tested).
 */
export function layoutNodes(
  model: ReplayModel,
  width: number,
  height: number,
  pad = 48,
): Map<string, PlacedNode> {
  const out = new Map<string, PlacedNode>();
  const columnX = {
    prompt: pad,
    tool: width / 2,
    assistant: width - pad - (width - 2 * pad) * 0.18,
    result: width - pad,
    usage: width / 2,
  } as const;
  const tools = model.nodes.filter((n) => n.kind === "tool");
  const usable = Math.max(1, height - 2 * pad);
  tools.forEach((node, i) => {
    const y = tools.length === 1 ? height / 2 : pad + (usable * i) / (tools.length - 1);
    out.set(node.id, { ...node, x: columnX.tool, y });
  });
  for (const node of model.nodes) {
    if (node.kind === "tool") continue;
    const y = node.kind === "usage" ? height - pad / 2 : height / 2;
    out.set(node.id, { ...node, x: columnX[node.kind], y });
  }
  return out;
}

/** Position of a particle at `t`, given the placed nodes (null when off-screen). */
export function particlePoint(
  flight: Flight,
  nodes: ReadonlyMap<string, PlacedNode>,
): { x: number; y: number } | null {
  const from = nodes.get(flight.particle.from);
  const to = nodes.get(flight.particle.to);
  if (!from || !to) return null;
  const e = easeInOut(Math.max(0, Math.min(1, flight.progress)));
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

import { describe, expect, it } from "vitest";
import { buildReplayModel, layoutNodes, particlePoint, replaySummary, stateAt } from "./replayEngine";

const events = [
  { type: "started", ts: 1000, pid: 1 },
  { type: "tool_use", ts: 1200, tool: "Read", detail: "a" },
  { type: "tool_use", ts: 1500, tool: "Read", detail: "b" },
  { type: "tool_use", ts: 2500, tool: "Edit", detail: "c" },
  { type: "assistant", ts: 3000, text: "done" },
  { type: "result", ts: 4000, exitCode: 0 },
];

describe("replay engine", () => {
  it("groups tools into nodes and schedules one particle per event", () => {
    const m = buildReplayModel(events);
    expect(m.start).toBe(1000);
    expect(m.duration).toBe(3000);
    expect(m.nodes.map((n) => n.id)).toEqual(["prompt", "tool:Read", "tool:Edit", "assistant", "result"]);
    expect(m.nodes.find((n) => n.id === "tool:Read")?.count).toBe(2);
    expect(m.particles).toHaveLength(5);
    expect(m.particles[0]).toMatchObject({ from: "prompt", to: "tool:Read", at: 200 });
    // Flight is clamped to the gap before the next event (300 ms here).
    expect(m.particles[0]?.flight).toBe(300);
    expect(m.particles[1]).toMatchObject({ from: "prompt", to: "tool:Read", at: 500 });
    expect(m.particles[2]).toMatchObject({ from: "tool:Read", to: "tool:Edit" });
    expect(m.particles[4]).toMatchObject({ from: "assistant", to: "result", flight: 700 });
    expect(m.ok).toBe(true);
    expect(replaySummary(m).map((s) => `${s.label}×${s.count}`)).toEqual([
      "Read×2",
      "Edit×1",
      "assistant×1",
      "result×1",
    ]);
  });

  it("reports flights in progress and arrivals", () => {
    const m = buildReplayModel(events);
    expect(stateAt(m, 0).flights).toHaveLength(0);
    const mid = stateAt(m, 350);
    expect(mid.flights).toHaveLength(1);
    expect(mid.flights[0]?.progress).toBeCloseTo(0.5, 5);
    expect(mid.delivered).toBe(0);
    // p0: 200 → 500 (flight 300), p1: 500 → 1200 (flight clamped to 700).
    const later = stateAt(m, 1300);
    expect(later.delivered).toBe(2);
    expect(later.arrivals.get("tool:Read")).toBe(100); // most recent arrival wins
    expect(stateAt(m, 1000).delivered).toBe(1);
    expect(stateAt(m, 10_000).delivered).toBe(5);
  });

  it("marks failures and copes with empty input", () => {
    expect(buildReplayModel([]).nodes).toHaveLength(1);
    expect(buildReplayModel([{ type: "error", ts: 5, message: "x" }]).ok).toBe(false);
  });
});

describe("layout", () => {
  const m = buildReplayModel(events);
  it("places the prompt left, tools in the middle column and the result right", () => {
    const placed = layoutNodes(m, 400, 200, 40);
    expect(placed.get("prompt")).toMatchObject({ x: 40, y: 100 });
    expect(placed.get("result")).toMatchObject({ x: 360, y: 100 });
    expect(placed.get("tool:Read")?.x).toBe(200);
    expect(placed.get("tool:Read")?.y).toBe(40);
    expect(placed.get("tool:Edit")?.y).toBe(160);
    expect(placed.get("assistant")!.x).toBeLessThan(placed.get("result")!.x);
  });

  it("centres a single tool and interpolates particles between nodes", () => {
    const single = buildReplayModel([
      { type: "tool_use", ts: 0, tool: "Read" },
      { type: "result", ts: 1000, exitCode: 0 },
    ]);
    const placed = layoutNodes(single, 400, 200, 40);
    expect(placed.get("tool:Read")?.y).toBe(100);
    const flights = stateAt(single, 0).flights;
    expect(flights).toHaveLength(1);
    const mid = particlePoint({ particle: flights[0]!.particle, progress: 0.5 }, placed);
    expect(mid).toEqual({ x: 120, y: 100 });
    expect(
      particlePoint({ particle: { ...flights[0]!.particle, to: "nope" }, progress: 0.5 }, placed),
    ).toBeNull();
  });
});

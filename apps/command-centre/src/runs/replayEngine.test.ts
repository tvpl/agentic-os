import { describe, expect, it } from "vitest";
import { buildReplayModel, replaySummary, stateAt } from "./replayEngine";

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
    expect(replaySummary(m).map((s) => `${s.label}×${s.count}`)).toEqual(["Read×2", "Edit×1", "assistant×1", "result×1"]);
  });

  it("reports flights in progress and arrivals", () => {
    const m = buildReplayModel(events);
    expect(stateAt(m, 0).flights).toHaveLength(0);
    const mid = stateAt(m, 350);
    expect(mid.flights).toHaveLength(1);
    expect(mid.flights[0]?.progress).toBeCloseTo(0.5, 5);
    expect(mid.delivered).toBe(0);
    const later = stateAt(m, 1000);
    expect(later.delivered).toBe(2);
    expect(later.arrivals.get("tool:Read")).toBe(200);
    expect(stateAt(m, 10_000).delivered).toBe(5);
  });

  it("marks failures and copes with empty input", () => {
    expect(buildReplayModel([]).nodes).toHaveLength(1);
    expect(buildReplayModel([{ type: "error", ts: 5, message: "x" }]).ok).toBe(false);
  });
});

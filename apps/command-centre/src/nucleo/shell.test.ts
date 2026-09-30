/**
 * The shell's rules, as pure functions: which scene a URL is, how a change
 * of scene travels, where the horizon puts each scene, how lâminas are
 * capped, how the core reads the agent's state, how a countdown reads.
 */
import { describe, expect, it } from "vitest";
import { MAIN_SCENES, horizonRing, ringOffset, sceneForPath, travelBetween } from "./scenes";
import { MAX_LAMINAS, withProjected } from "./projections";
import { motionOf } from "./CoreOrb";
import { formatIn } from "./format";

describe("scenes", () => {
  it("reads the scene from the path, deep paths included", () => {
    expect(sceneForPath("/").id).toBe("nucleo");
    expect(sceneForPath("/runs/abc").id).toBe("runs");
    expect(sceneForPath("/skills/code-review").id).toBe("skills");
    expect(sceneForPath("/settings").id).toBe("settings");
    // Anything unknown is home, never a blank screen.
    expect(sceneForPath("/nope").id).toBe("nucleo");
  });

  it("has five main scenes, the Núcleo first", () => {
    expect(MAIN_SCENES.map((s) => s.id)).toEqual(["nucleo", "brain", "runs", "skills", "routines"]);
  });

  it("dives out of the Núcleo, rises back to it, and turns between scenes the short way", () => {
    expect(travelBetween("nucleo", "brain")).toEqual({ mode: "dive", dir: 1 });
    expect(travelBetween("runs", "nucleo")).toEqual({ mode: "rise", dir: -1 });
    expect(travelBetween("brain", "runs")).toEqual({ mode: "side", dir: 1 });
    expect(travelBetween("runs", "brain")).toEqual({ mode: "side", dir: -1 });
    // Routines → Brain wraps around the Núcleo: two steps right, not three left.
    expect(travelBetween("routines", "brain").dir).toBe(1);
  });

  it("puts a secondary scene on the horizon only while you are in it", () => {
    expect(horizonRing("runs").map((s) => s.id)).not.toContain("settings");
    expect(horizonRing("settings").map((s) => s.id)).toContain("settings");
  });

  it("places ring items at signed offsets around the active one", () => {
    expect([0, 1, 2, 3, 4].map((i) => ringOffset(i, 0, 5))).toEqual([0, 1, 2, -2, -1]);
    expect([0, 1, 2, 3, 4].map((i) => ringOffset(i, 3, 5))).toEqual([2, -2, -1, 0, 1]);
  });
});

describe("lâminas", () => {
  it("keeps two at most, the newest last, and moves a re-projection to the front", () => {
    expect(MAX_LAMINAS).toBe(2);
    let list: string[] = [];
    list = withProjected(list, "attention");
    list = withProjected(list, "run:1");
    expect(list).toEqual(["attention", "run:1"]);
    list = withProjected(list, "cost");
    expect(list).toEqual(["run:1", "cost"]);
    list = withProjected(list, "run:1");
    expect(list).toEqual(["cost", "run:1"]);
  });
});

describe("the core", () => {
  it("reads every agent state as one of its motions", () => {
    expect(motionOf("idle")).toBe("idle");
    expect(motionOf("listening")).toBe("listening");
    expect(motionOf("queued")).toBe("thinking");
    expect(motionOf("tool")).toBe("thinking");
    expect(motionOf("responding")).toBe("speaking");
    expect(motionOf("waiting")).toBe("waiting");
    expect(motionOf("interrupted")).toBe("alert");
    expect(motionOf("done")).toBe("done");
    expect(motionOf("cancelled")).toBe("idle");
  });
});

describe("countdowns", () => {
  it("reads minutes, hours and days", () => {
    expect(formatIn(20_000)).toBe("< 1 min");
    expect(formatIn(12 * 60_000)).toBe("12 min");
    expect(formatIn(125 * 60_000)).toBe("2 h 05 min");
    expect(formatIn(3 * 86_400_000)).toBe("3 d");
  });
});

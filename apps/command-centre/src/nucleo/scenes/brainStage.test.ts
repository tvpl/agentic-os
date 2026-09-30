import { describe, expect, it } from "vitest";
import { layoutTime } from "./brainDimensions";
import { egoLayout } from "./brainEgo";
import { buildModel } from "./brainModel";
import { flightAt, project, type Vec3 } from "./brainSpace";
import {
  createStage,
  enterNote,
  flyHome,
  leaveNote,
  posOf,
  setLayout,
  setModel,
  stepMorph,
  syncFrame,
  targetOf,
  visibleTargets,
  type Stage,
} from "./brainStage";

const now = Date.UTC(2026, 8, 26);
// 0 — 1 — 2, and 3 alone
const files = [0, 1, 2, 3].map((i) => ({
  id: i + 1,
  name: `n${i}.md`,
  title: null,
  group: i < 2 ? "a" : "b",
  degree: i === 1 ? 2 : i === 3 ? 0 : 1,
  mtime: now - i * 86_400_000,
  tint: null,
}));
const edges = [
  { a: 0, b: 1, kind: "markdown-link" },
  { a: 1, b: 2, kind: "markdown-link" },
];
const adjacency = [[1], [0, 2], [1], []];

function ready(): Stage {
  const stage = createStage();
  setModel(
    stage,
    buildModel(files, edges, adjacency, { order: [], enabled: new Set(["markdown-link"]), now }),
  );
  return stage;
}

const settle = (stage: Stage, t: number) => {
  stepMorph(stage, t);
};

describe("stage arrangement", () => {
  it("starts with every star at its area position", () => {
    const stage = ready();
    const m = stage.model!;
    expect(posOf(stage, 2)).toEqual({ x: m.pos[2]!.x, y: m.pos[2]!.y, z: m.pos[2]!.z });
  });

  it("morphs to a new dimension over time (and jumps under reduced motion)", () => {
    const stage = ready();
    const time = layoutTime(files.map((f) => ({ id: f.id, mtime: f.mtime })));
    setLayout(stage, time, 0);
    expect(stage.dim).toBe("time");
    expect(stage.morph).not.toBeNull();
    settle(stage, 10_000);
    expect(stage.morph).toBeNull();
    expect(posOf(stage, 1).x).toBeCloseTo(time.pos[1]!.x, 3);

    const reduced = ready();
    reduced.reduced = true;
    setLayout(reduced, time, 0);
    expect(reduced.morph).toBeNull();
    expect(posOf(reduced, 1).x).toBeCloseTo(time.pos[1]!.x, 3);
  });
});

describe("inside a note", () => {
  it("enters: the neighbours move to the shells around it, the camera flies there, the old view is saved", () => {
    const stage = ready();
    const before = { ...stage.cam };
    const ego = egoLayout(1, adjacency);
    expect(enterNote(stage, ego, 0)).toBe("fly");
    expect(stage.saved).toEqual(before);
    const anchor = stage.ego!.anchor;
    expect(stage.flight!.to.tx).toBeCloseTo(anchor.x);
    settle(stage, 10_000);
    const p0 = posOf(stage, 0);
    const d = Math.hypot(p0.x - anchor.x, p0.y - anchor.y, p0.z - anchor.z);
    expect(d).toBeCloseTo(ego.r1, 3);
    // the lonely star stays home
    expect(posOf(stage, 3)).toEqual(targetOf({ ...stage, ego: null }, 3));
  });

  it("travels through the synapse to a neighbour, re-centring on arrival", () => {
    const stage = ready();
    enterNote(stage, egoLayout(1, adjacency), 0);
    stage.flight = null;
    settle(stage, 10_000);
    const neighbour = posOf(stage, 2);
    let arrived = false;
    expect(enterNote(stage, egoLayout(2, adjacency), 20_000, () => (arrived = true))).toBe("travel");
    expect(stage.travel).toMatchObject({ from: 1, to: 2 });
    expect(stage.flight!.path).toBeDefined();
    // the camera dives on the way and ends on the neighbour
    const mid = flightAt(stage.flight!, 20_000 + stage.flight!.dur / 2).cam;
    const end = flightAt(stage.flight!, 20_000 + stage.flight!.dur).cam;
    expect(mid.dist).toBeLessThan(Math.max(stage.flight!.from.dist, stage.flight!.to.dist));
    expect(end.tx).toBeCloseTo(neighbour.x);
    stage.arrival!();
    expect(arrived).toBe(true);
    expect(stage.ego!.centre).toBe(2);
    expect(stage.ego!.anchor).toEqual(neighbour);
    expect(stage.travel).toBeNull();
  });

  it("leaves: the stars go home and the camera returns to where it was", () => {
    const stage = ready();
    const before = { ...stage.cam };
    enterNote(stage, egoLayout(1, adjacency), 0);
    leaveNote(stage, 100);
    expect(stage.ego).toBeNull();
    expect(stage.saved).toBeNull();
    expect(stage.flight!.to.tx).toBeCloseTo(before.tx);
    expect(stage.flight!.to.dist).toBeCloseTo(before.dist);
    settle(stage, 20_000);
    expect(posOf(stage, 0)).toEqual(targetOf(stage, 0));
  });
});

describe("framing", () => {
  const framed = () => {
    const stage = ready();
    stage.viewport = { w: 1200, h: 800 };
    stage.insets = { top: 70, right: 120, bottom: 160, left: 340 };
    syncFrame(stage);
    return stage;
  };
  /** Every point, seen from where the flight ends, inside the free area (screen px). */
  const inside = (stage: Stage, pts: Vec3[]) => {
    const f = stage.frame!;
    const to = stage.flight!.to;
    const view = { cx: 340 + f.freeW / 2, cy: 70 + f.freeH / 2, focal: f.focal };
    return pts.every((p) => {
      const s = project(p, to, view);
      return s !== null && s.x >= 340 && s.x <= 1200 - 120 && s.y >= 70 && s.y <= 800 - 160;
    });
  };

  it("knows the free area before the first frame is drawn", () => {
    const stage = framed();
    expect(stage.frame).toEqual({ focal: 800 * 0.92, freeW: 740, freeH: 570 });
  });

  it("flies home to the whole arrangement, centred in the free area", () => {
    const stage = framed();
    flyHome(stage, 0);
    expect(inside(stage, visibleTargets(stage))).toBe(true);
  });

  it("inside a note, frames its whole space, not just the note", () => {
    const stage = framed();
    const ego = egoLayout(0, adjacency);
    enterNote(stage, ego, 0);
    settle(stage, 10_000);
    const members = [ego.centre, ...ego.hop1, ...ego.hop2].map((i) => posOf(stage, i));
    expect(inside(stage, members)).toBe(true);
  });
});

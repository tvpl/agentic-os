/**
 * The window model is what makes the desktop an OS rather than a dashboard,
 * so the rules that keep a window reachable are pinned here: nothing may be
 * dragged out of grabbing range, a resized viewport pulls everything back,
 * and raising one window never reshuffles the others.
 */
import { describe, expect, it } from "vitest";
import {
  ARC_MARGIN,
  CONSOLE_BAND,
  KEEP_VISIBLE,
  MIN_H,
  MIN_W,
  STAGE_PAD,
  cascade,
  clampIntoStage,
  clampLayout,
  clampSize,
  layoutsEqual,
  normalizeZ,
  overviewSlots,
  placeNew,
  raise,
  snapBox,
  snapEdgeAt,
  tetherPath,
  tetherTarget,
  tile,
  topZ,
  type WindowBox,
  type WindowMap,
  columns,
  arrangeOnOpen,
  stackOrder,
} from "./windowModel";

const STAGE = { w: 1400, h: 700 };
const box = (p: Partial<WindowBox> = {}): WindowBox => ({
  x: 20,
  y: 20,
  w: 400,
  h: 300,
  z: 1,
  visible: true,
  ...p,
});

describe("stacking order", () => {
  it("raises one window without touching the rest", () => {
    const layout: WindowMap = { a: box({ z: 1 }), b: box({ z: 2 }), c: box({ z: 3 }) };
    const next = raise(layout, "a");
    expect(next.a!.z).toBe(4);
    expect(next.b!.z).toBe(2);
    expect(next.c!.z).toBe(3);
    expect(topZ(next)).toBe(4);
  });

  it("does not churn when the window is already on top", () => {
    const layout: WindowMap = { a: box({ z: 1 }), b: box({ z: 2 }) };
    expect(raise(layout, "b")).toBe(layout);
    expect(raise(layout, "missing")).toBe(layout);
  });

  it("compacts the order so a long session does not persist huge integers", () => {
    const layout: WindowMap = { a: box({ z: 900 }), b: box({ z: 12 }), c: box({ z: 4001 }) };
    const next = normalizeZ(layout);
    expect(next.b!.z).toBe(1);
    expect(next.a!.z).toBe(2);
    expect(next.c!.z).toBe(3);
  });
});

describe("clamping keeps a window reachable", () => {
  it("never lets a window shrink below a usable size", () => {
    expect(clampSize({ w: 10, h: 10 })).toEqual({ w: MIN_W, h: MIN_H });
    expect(clampSize({ w: 500, h: 400 }, { w: 520, h: 380 })).toEqual({ w: 520, h: 400 });
  });

  it("caps a window to the stage it is on", () => {
    // Height stops above the console's band (G4), not at the stage's edge.
    expect(clampSize({ w: 5000, h: 5000 }, { w: MIN_W, h: MIN_H }, STAGE)).toEqual({
      w: STAGE.w - STAGE_PAD * 2,
      h: STAGE.h - CONSOLE_BAND - STAGE_PAD * 2,
    });
  });

  it("lets a window hang off the right edge but keeps a grabbable strip", () => {
    const dragged = clampIntoStage(box({ x: 5000 }), STAGE);
    expect(dragged.x).toBe(STAGE.w - KEEP_VISIBLE);
    const left = clampIntoStage(box({ x: -5000, w: 400 }), STAGE);
    expect(left.x).toBe(-(400 - KEEP_VISIBLE));
  });

  it("never lets the header go above the stage, where it could not be grabbed", () => {
    expect(clampIntoStage(box({ y: -400 }), STAGE).y).toBe(0);
    // A window that fits above the console's band is kept above it (G4)…
    const low = box({ y: 5000 });
    expect(clampIntoStage(low, STAGE).y).toBe(STAGE.h - CONSOLE_BAND - low.h);
    // …and one taller than that is sized down first, so it still lands above the band.
    const tall = clampIntoStage(box({ y: 5000, h: STAGE.h - 40 }), STAGE);
    expect(tall.y + tall.h).toBeLessThanOrEqual(STAGE.h - CONSOLE_BAND);
  });

  it("pulls a whole layout back when the window shrinks", () => {
    const saved: WindowMap = {
      a: box({ x: 1200, y: 500, w: 600, h: 400 }),
      b: box({ x: 40, y: 40 }),
    };
    const small = { w: 900, h: 500 };
    const next = clampLayout(saved, small);
    for (const id of ["a", "b"]) {
      expect(next[id]!.x, id).toBeLessThanOrEqual(small.w - KEEP_VISIBLE);
      expect(next[id]!.y, id).toBeLessThanOrEqual(small.h - 32);
      expect(next[id]!.y, id).toBeGreaterThanOrEqual(0);
      expect(next[id]!.w, id).toBeLessThanOrEqual(small.w - STAGE_PAD * 2);
    }
  });

  it("honours a per-window minimum (the console needs more than the default)", () => {
    const next = clampLayout({ prompt: box({ w: 100, h: 100 }) }, STAGE, () => ({ w: 520, h: 380 }));
    expect(next.prompt).toMatchObject({ w: 520, h: 380 });
  });
});

describe("edge snapping", () => {
  it("arms only near an edge", () => {
    expect(snapEdgeAt(700, 300, STAGE)).toBeNull();
    expect(snapEdgeAt(4, 300, STAGE)).toBe("left");
    expect(snapEdgeAt(STAGE.w - 4, 300, STAGE)).toBe("right");
    expect(snapEdgeAt(700, 3, STAGE)).toBe("top");
  });

  it("prefers the top edge in a corner, so maximise beats half-screen", () => {
    expect(snapEdgeAt(2, 2, STAGE)).toBe("top");
  });

  it("splits the stage into two halves that do not overlap", () => {
    const left = snapBox("left", STAGE);
    const right = snapBox("right", STAGE);
    expect(left.x + left.w).toBeLessThanOrEqual(right.x);
    expect(right.x + right.w).toBeLessThanOrEqual(STAGE.w);
    expect(snapBox("top", STAGE).w).toBe(STAGE.w - STAGE_PAD * 2);
  });
});

describe("arrangements", () => {
  const four: WindowMap = { a: box(), b: box(), c: box(), d: box() };

  it("tiles without overlapping and stays on stage", () => {
    const next = tile(four, STAGE);
    const boxes = Object.values(next);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(STAGE_PAD);
      expect(b.x + b.w).toBeLessThanOrEqual(STAGE.w);
      expect(b.y + b.h).toBeLessThanOrEqual(STAGE.h);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox <= 0 || oy <= 0, `${i}/${j} overlap`).toBe(true);
      }
  });

  it("leaves minimized and hidden windows out of an arrangement", () => {
    const layout: WindowMap = { a: box(), b: box({ minimized: true }), c: box({ visible: false }) };
    const next = tile(layout, STAGE);
    expect(next.b).toEqual(layout.b);
    expect(next.c).toEqual(layout.c);
    expect(next.a!.w).toBeGreaterThan(MIN_W);
  });

  it("cascades in stacking order and wraps before walking off the stage", () => {
    const many: WindowMap = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`w${i}`, box({ z: i + 1 })]),
    );
    const next = cascade(many, STAGE);
    for (const b of Object.values(next)) {
      expect(b.y).toBeGreaterThanOrEqual(STAGE_PAD);
      expect(b.y + b.h).toBeLessThanOrEqual(STAGE.h);
    }
  });
});

describe("overview", () => {
  const four: WindowMap = {
    a: box({ z: 1, w: 400, h: 300 }),
    b: box({ z: 2, w: 400, h: 300 }),
    c: box({ z: 3, w: 400, h: 300 }),
    d: box({ z: 4, w: 400, h: 300 }),
  };

  it("places every open window inside the stage without overlapping", () => {
    const slots = overviewSlots(four, STAGE);
    expect(Object.keys(slots).sort()).toEqual(["a", "b", "c", "d"]);
    const rects = Object.entries(slots).map(([id, s]) => ({
      x: s.x,
      y: s.y,
      w: four[id]!.w * s.scale,
      h: four[id]!.h * s.scale,
    }));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(STAGE.w + 1);
      expect(r.y + r.h).toBeLessThanOrEqual(STAGE.h + 1);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox <= 1 || oy <= 1, `${i}/${j} overlap`).toBe(true);
      }
  });

  it("never magnifies: the overview is a map, not a distortion", () => {
    const slots = overviewSlots({ tiny: box({ w: MIN_W, h: MIN_H }) }, STAGE);
    expect(slots.tiny!.scale).toBe(1);
  });

  it("shrinks a window that cannot fit its cell", () => {
    const slots = overviewSlots(four, { w: 600, h: 400 });
    for (const slot of Object.values(slots)) expect(slot.scale).toBeLessThan(1);
  });

  it("leaves out what is minimized or hidden, and copes with an empty stage", () => {
    expect(overviewSlots({}, STAGE)).toEqual({});
    const slots = overviewSlots({ a: box(), b: box({ minimized: true }), c: box({ visible: false }) }, STAGE);
    expect(Object.keys(slots)).toEqual(["a"]);
  });
});

describe("placing a new window", () => {
  it("fills an empty stage from the top-left, clear of the pod arc", () => {
    expect(placeNew({ w: 400, h: 300 }, {}, STAGE)).toEqual({
      x: ARC_MARGIN + STAGE_PAD,
      y: STAGE_PAD,
    });
  });

  it("avoids covering what is already open", () => {
    const layout: WindowMap = { a: box({ x: STAGE_PAD, y: STAGE_PAD, w: 600, h: 400 }) };
    const spot = placeNew({ w: 400, h: 300 }, layout, STAGE);
    const overlapX = Math.min(spot.x + 400, STAGE_PAD + 600) - Math.max(spot.x, STAGE_PAD);
    const overlapY = Math.min(spot.y + 300, STAGE_PAD + 400) - Math.max(spot.y, STAGE_PAD);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });

  it("ignores minimized windows when looking for room", () => {
    const layout: WindowMap = { a: box({ x: STAGE_PAD, y: STAGE_PAD, w: 900, h: 600, minimized: true }) };
    expect(placeNew({ w: 400, h: 300 }, layout, STAGE)).toEqual({
      x: ARC_MARGIN + STAGE_PAD,
      y: STAGE_PAD,
    });
  });
});

describe("tethers", () => {
  // The console is fixed over the stage (G4): the origin is a point read from
  // the document, the middle of its top edge.
  const from = { x: 700, y: 500 };

  it("lands on the edge facing the console, never in its middle", () => {
    const above = tetherTarget(box({ x: 600, y: 100, w: 200, h: 150 }), from);
    expect(above.y).toBe(250); // bottom edge: the window is above the console
    const below = tetherTarget(box({ x: 600, y: 760, w: 200, h: 150 }), from);
    expect(below.y).toBe(760); // top edge: the window is below
  });

  it("stays inside the window it points at", () => {
    const target = box({ x: 40, y: 60, w: 200, h: 150 });
    const point = tetherTarget(target, from);
    expect(point.x).toBeGreaterThanOrEqual(target.x);
    expect(point.x).toBeLessThanOrEqual(target.x + target.w);
  });

  it("draws a curve that starts and ends where it was told", () => {
    const d = tetherPath({ x: 10, y: 200 }, { x: 300, y: 40 });
    expect(d.startsWith("M10 200 C")).toBe(true);
    expect(d.endsWith("300 40")).toBe(true);
  });
});

describe("layoutsEqual", () => {
  it("is structural, including stacking order and minimized state", () => {
    expect(layoutsEqual({ a: box() }, { a: box() })).toBe(true);
    expect(layoutsEqual({ a: box() }, { a: box({ z: 9 }) })).toBe(false);
    expect(layoutsEqual({ a: box() }, { a: box({ minimized: true }) })).toBe(false);
    expect(layoutsEqual({ a: box() }, {})).toBe(false);
    expect(layoutsEqual({ a: box({ config: { rows: 4 } }) }, { a: box({ config: { rows: 5 } }) })).toBe(
      false,
    );
    // An absent config and an explicitly empty one are the same window.
    expect(layoutsEqual({ a: box() }, { a: box({ minimized: false }) })).toBe(true);
  });
});

describe("columns (refino item 11)", () => {
  const stage = { w: 1400, h: 800 };
  const box = (z: number, extra: Partial<WindowBox> = {}): WindowBox => ({
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    z,
    visible: true,
    ...extra,
  });

  it("lays two or three panels side by side above the console, oldest left", () => {
    const out = columns({ a: box(2), b: box(1), c: box(3) }, stage);
    expect(out.b!.x).toBeLessThan(out.a!.x);
    expect(out.a!.x).toBeLessThan(out.c!.x);
    expect(out.a!.w).toBe(out.b!.w);
    expect(out.c!.x + out.c!.w).toBeLessThanOrEqual(stage.w - 78);
    expect(out.a!.y + out.a!.h).toBeLessThanOrEqual(stage.h - 150);
  });

  it("reflows on open only while there are two or three panels", () => {
    const one = { a: box(1) };
    expect(arrangeOnOpen(one, stage)).toBe(one);
    const three = { a: box(1), b: box(2), c: box(3) };
    expect(arrangeOnOpen(three, stage)).not.toBe(three);
    const four = { ...three, d: box(4) };
    expect(arrangeOnOpen(four, stage)).toBe(four);
    const parked = { a: box(1), b: box(2, { minimized: true }) };
    expect(arrangeOnOpen(parked, stage)).toBe(parked);
  });

  it("orders the stack top first", () => {
    expect(stackOrder({ a: box(1), b: box(3), c: box(2, { visible: false }) })).toEqual(["b", "a"]);
  });
});

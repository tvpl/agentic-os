/**
 * @vitest-environment jsdom
 * Reads the registry to cover every real widget; the widgets touch `document`
 * at module scope (same reason as registry.test.ts).
 */
import { describe, expect, it } from "vitest";
import { WIDGET_ORDER } from "./defaultLayout";
import {
  DEFAULT_SPECS,
  defaultWindows,
  docId,
  docPath,
  isDocId,
  minFor,
  normalizeWindows,
} from "./defaultWindows";
import { ARC_MARGIN, KEEP_VISIBLE, MIN_H, MIN_W, STAGE_PAD } from "./windowModel";

const STAGES = [
  { w: 1440, h: 704 },
  { w: 1280, h: 604 },
  { w: 1024, h: 472 },
  { w: 2560, h: 1244 },
];

describe("the first composition", () => {
  it("has a spec for every registered widget and nothing else", () => {
    expect(Object.keys(DEFAULT_SPECS).sort()).toEqual([...WIDGET_ORDER].sort());
  });

  it("opens composed on every stage, never off-screen and never below the minimum", () => {
    for (const stage of STAGES) {
      const layout = defaultWindows(stage);
      for (const id of WIDGET_ORDER) {
        const box = layout[id]!;
        const min = minFor(id);
        expect(box.w, `${id}.w @ ${stage.w}`).toBeGreaterThanOrEqual(Math.min(min.w, stage.w));
        expect(box.h, `${id}.h @ ${stage.w}`).toBeGreaterThanOrEqual(Math.min(min.h, stage.h));
        expect(box.x, `${id}.x @ ${stage.w}`).toBeLessThanOrEqual(stage.w - KEEP_VISIBLE);
        expect(box.y, `${id}.y @ ${stage.w}`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${id}.y @ ${stage.w}`).toBeLessThanOrEqual(stage.h - 32);
      }
    }
  });

  it("never declares a per-widget minimum below the global floor", () => {
    // A per-widget minimum exists to ask for *more* room than the default;
    // one that asks for less is incoherent and silently breaks the clamp.
    for (const id of WIDGET_ORDER) {
      const min = minFor(id);
      expect(min.w, `${id}.w`).toBeGreaterThanOrEqual(MIN_W);
      expect(min.h, `${id}.h`).toBeGreaterThanOrEqual(MIN_H);
    }
  });

  it("opens the stage clear: nothing at all — the console is fixed, not a window", () => {
    // The whole point of F7. A default that placed nine panels is why the
    // running app still read as the dashboard it was meant to replace; since
    // G4 the console is not a window either.
    for (const stage of STAGES) {
      const layout = defaultWindows(stage);
      const open = Object.entries(layout)
        .filter(([, box]) => box.visible)
        .map(([id]) => id);
      expect(open, `@ ${stage.w}×${stage.h}`).toEqual([]);
    }
  });

  it("gives every window its own place in the stacking order", () => {
    const layout = defaultWindows(STAGES[0]!);
    const zs = Object.values(layout).map((b) => b.z);
    expect(new Set(zs).size).toBe(zs.length);
  });

  it("keeps the landing columns apart on a desktop stage", () => {
    const layout = defaultWindows({ w: 1440, h: 704 });
    const left = layout.cost!;
    const centre = layout.now!;
    const right = layout.routines!;
    // The composition is laid inside the arcs, not against the screen edges.
    expect(left.x).toBeGreaterThanOrEqual(ARC_MARGIN);
    expect(left.x + left.w).toBeLessThanOrEqual(centre.x + 1);
    expect(centre.x + centre.w).toBeLessThanOrEqual(right.x + 1);
  });
});

describe("normalizing a stored layout", () => {
  const stage = { w: 1440, h: 704 };

  it("fills in a widget the stored layout never heard of", () => {
    const next = normalizeWindows({ now: { x: 100, y: 100, w: 500, h: 300 } }, stage);
    expect(Object.keys(next).sort()).toEqual([...WIDGET_ORDER].sort());
    expect(next.now).toMatchObject({ x: 100, y: 100, w: 500, h: 300 });
    expect(next.routines).toMatchObject(defaultWindows(stage).routines!);
  });

  it("drops a stale id — a widget this version no longer has, or a ghost", () => {
    const next = normalizeWindows(
      {
        today: { x: 60, y: 60, w: 300, h: 200, visible: true },
        "today:2": { x: 60, y: 60, w: 300, h: 200, visible: true },
        ghost: { x: 0, y: 0, w: 300, h: 200 },
      },
      stage,
    );
    expect(next.today).toBeUndefined();
    expect(next["today:2"]).toBeUndefined();
    expect(next.ghost).toBeUndefined();
  });

  it("pulls a layout saved on a larger screen back into a smaller one", () => {
    const wide = defaultWindows({ w: 2560, h: 1244 });
    const next = normalizeWindows(wide, { w: 1024, h: 472 });
    for (const id of WIDGET_ORDER) {
      expect(next[id]!.x, id).toBeLessThanOrEqual(1024 - KEEP_VISIBLE);
      expect(next[id]!.y, id).toBeLessThanOrEqual(472 - 32);
      expect(next[id]!.w, id).toBeLessThanOrEqual(1024 - STAGE_PAD * 2);
    }
  });

  it("keeps a document window the user had open", () => {
    const next = normalizeWindows(
      { "doc:/runs/1/plan.md": { x: 90, y: 70, w: 500, h: 380, z: 3, visible: true } },
      stage,
    );
    expect(next["doc:/runs/1/plan.md"]).toMatchObject({ x: 90, y: 70, w: 500, visible: true });
    expect(docPath("doc:/runs/1/plan.md")).toBe("/runs/1/plan.md");
    expect(isDocId("today")).toBe(false);
    expect(docId("/a/b.md")).toBe("doc:/a/b.md");
  });

  it("gives a document a floor of its own, not the bare global one", () => {
    expect(minFor("doc:/a.md")).toMatchObject({ w: 320, h: 220 });
  });

  it("keeps a minimized panel minimized: it is in the dock, not gone", () => {
    const next = normalizeWindows(
      { pulse: { x: 10, y: 10, w: 400, h: 300, visible: true, minimized: true } },
      stage,
    );
    expect(next.pulse).toMatchObject({ visible: true, minimized: true });
  });
});

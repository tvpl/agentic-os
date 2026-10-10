// @vitest-environment jsdom
/**
 * Design-system C17, the brain's canvas layers: every text the map draws is at
 * least 12px on screen at the nearest zoom, the default one and the farthest,
 * in every state that adds text (hover on each kind of node, names forced on,
 * an area chosen). The size is measured where it lands (font x transform
 * scale x sprite scale), which the source check (C3) cannot see.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connector, GraphData, RoutineStatus, Skill } from "../../api";
import { clearTextDrawnOn, installRecordingCanvas, textDrawnOn } from "../../testing/canvasText";
import { layoutFiles } from "../engine/layouts";
import {
  DEFAULT_SETTINGS,
  ZOOM_MAX,
  ZOOM_MIN,
  buildWorld,
  createWorld,
  groupOfNode,
  type LayoutKind,
  type World,
} from "../engine/world";
import { drawFrame, makeRingDefs } from "./draw";
import { createSprites } from "./sprites";
import { readCanvasTokens } from "./tokens";

const FLOOR = 12;
/** The files that draw this layer's text (planet counts fade out when zoomed far out, so glyphs.ts only shows from zoom 1). */
const LAYER_FILES = ["brain/render/draw.ts", "brain/render/glyphs.ts"];
const NOW = 1_700_000_000_000 + 10 * 86_400_000;

let restore: () => void;
beforeAll(() => {
  restore = installRecordingCanvas();
});
afterAll(() => restore());

function graph(): GraphData {
  const areas = ["Docs", "Worker", "Skills"];
  const nodes = Array.from({ length: 60 }, (_, i) => {
    const area = areas[i % areas.length]!;
    const sub = i % 3 === 0 ? "guides" : i % 3 === 1 ? "notes" : "archive";
    return {
      id: i + 1,
      name: `file-${i}.md`,
      rel: `${area.toLowerCase()}/${sub}/file-${i}.md`,
      path: `/ws/${area.toLowerCase()}/${sub}/file-${i}.md`,
      ext: ".md",
      area,
      dir: `/ws/${area.toLowerCase()}/${sub}`,
      size: 100 * (i + 1),
      mtime: 1_700_000_000_000 + i,
      title: null,
      tags: [],
    };
  });
  return {
    nodes,
    edges: [
      { source: 1, target: 2, kind: "markdown-link", why: "link" },
      { source: 2, target: 3, kind: "same-dir", why: "" },
    ],
    truncated: false,
    totalFiles: nodes.length,
  };
}

function build(layout: LayoutKind): World {
  const w = createWorld({ ...DEFAULT_SETTINGS, layout });
  buildWorld(w, {
    graph: graph(),
    skills: [
      { slug: "recall", enabled: true },
      { slug: "code-review", enabled: false },
    ] as Skill[],
    routines: [{ id: "digest", name: "Daily digest", enabled: true }] as RoutineStatus[],
    connectors: [
      { id: "pl", name: "Planner", status: "healthy", official: true },
      { id: "ps", name: "Pixel Studio", status: "configured", official: false },
      { id: "em", name: "Email", status: "healthy", official: false },
    ] as Connector[],
    groupOf: (n) => groupOfNode(n, "areas"),
    labels: { skills: "Skills", routines: "Routines", apps: "Apps" },
    now: NOW,
  });
  layoutFiles(w);
  return w;
}

/** Every state that puts text on the map besides the default one. */
function states(w: World): { name: string; apply: (w: World) => void }[] {
  const hub = w.hubs[0]!;
  const planet = w.planets[0]!;
  return [
    { name: "default", apply: () => undefined },
    { name: "names on", apply: (x) => void (x.showNames = true) },
    { name: "hover a skill", apply: (x) => void (x.hoverKey = `skill:${x.orbs[0]!.id}`) },
    {
      name: "hover a routine",
      apply: (x) => void (x.hoverKey = `routine:${x.orbs.find((o) => o.kind === "routine")!.id}`),
    },
    {
      name: "hover an app",
      apply: (x) => void (x.hoverKey = `app:${x.orbs.find((o) => o.kind === "app")!.id}`),
    },
    { name: "hover a hub", apply: (x) => void (x.hoverKey = `hub:${hub.key}`) },
    { name: "hover a planet", apply: (x) => void (x.hoverKey = `planet:${planet.hubKey}:${planet.dir}`) },
    { name: "an area chosen", apply: (x) => void (x.filterGroup = hub.key) },
    {
      name: "a search matching",
      apply: (x) => void ((x.query = "file"), (x.matched = new Set(x.files.slice(0, 8).map((_, i) => i)))),
    },
    {
      name: "a file selected",
      apply: (x) => void ((x.selectedId = x.files[0]!.id), (x.hoverId = x.files[1]!.id)),
    },
  ];
}

function drawn(w: World, k: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  const tokens = readCanvasTokens();
  w.transform = { x: 0, y: 0, k };
  w.target = { x: 0, y: 0, k };
  clearTextDrawnOn(canvas);
  drawFrame(ctx, w, {
    width: 1200,
    height: 800,
    tNow: 1,
    tokens,
    sprites: createSprites(tokens),
    reduceMotion: true,
    ringDefs: makeRingDefs({ skills: "Skills", memory: "Memory", routines: "Routines", apps: "Apps" }),
    background: null,
    coreLabel: "ROUTER.MD",
    now: NOW,
  });
  return textDrawnOn(canvas);
}

describe("brain canvas text, measured on screen (C17)", () => {
  for (const k of [ZOOM_MIN, 1, ZOOM_MAX]) {
    for (const layout of ["arcs", "rings"] as LayoutKind[]) {
      it(`is never under ${FLOOR}px at zoom ${k} (${layout} layout)`, () => {
        const w = build(layout);
        const small: string[] = [];
        const seen = new Set<string>();
        const sites = new Set<string>();
        for (const state of states(w)) {
          const fresh = build(layout);
          state.apply(fresh);
          for (const t of drawn(fresh, k)) {
            seen.add(t.text);
            sites.add(t.site);
            if (t.px < FLOOR - 1e-6) small.push(`${state.name}: "${t.text}" at ${t.px.toFixed(2)}px`);
          }
        }
        expect(small, small.join("\n")).toEqual([]);
        // The text comes from the files this layer is measured for, and from no other: a
        // spelling no source scan recognises (a bound method, Reflect.apply…) still lands here.
        expect([...sites].filter((f) => !LAYER_FILES.includes(f))).toEqual([]);
        if (k >= 1) expect([...sites].sort()).toEqual([...LAYER_FILES]);
        // Not vacuous: the core, a ring name and a hub name are there at every zoom.
        expect(seen.has("ROUTER.MD")).toBe(true);
        expect(seen.has("MEMORY")).toBe(true);
        expect(seen.has("DOCS")).toBe(true);
      });
    }
  }

  it("draws the applications' initials live, at the floor, when the badge can hold them", () => {
    const w = build("arcs");
    const at1 = drawn(w, 1).filter((t) => ["PL", "PS", "EM"].includes(t.text));
    expect(at1.map((t) => t.text).sort()).toEqual(["EM", "PL", "PS"]);
    for (const t of at1) expect(t.px).toBeGreaterThanOrEqual(FLOOR);
    // Zoomed far out the badge is smaller than the letters: left out, never drawn small.
    expect(drawn(w, ZOOM_MIN).filter((t) => ["PL", "PS", "EM"].includes(t.text))).toEqual([]);
  });

  it("keeps the hierarchy by size and weight above the floor: core and hub names over counts", () => {
    const w = build("arcs");
    const texts = drawn(w, 1);
    const px = (text: string) => texts.find((t) => t.text === text)!.px;
    expect(px("MEMORY")).toBeGreaterThan(px("DOCS")); // ring name over hub name
    expect(px("DOCS")).toBeGreaterThan(px(String(w.hubs.find((h) => h.key === "Docs")!.count))); // hub name over its count
    expect(px("ROUTER.MD")).toBeGreaterThanOrEqual(FLOOR);
  });
});

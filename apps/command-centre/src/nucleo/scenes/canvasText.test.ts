// @vitest-environment jsdom
/**
 * Design-system C17, the Núcleo's brain scene: every word its painter puts on
 * the sky is at least 12px on screen, from a hand's breadth away to the whole
 * sky in view, with the area names, a hovered star, a search lighting stars and
 * the labels of every importance level. The painter draws in screen space, so
 * what could shrink a word is its own size choice (`labelPx`, `groupPx`), which
 * is what this measures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearTextDrawnOn, installRecordingCanvas, textDrawnOn } from "../../testing/canvasText";
import { buildModel } from "./brainModel";
import { Painter, type Tokens } from "./brainPaint";
import { SpriteBook } from "./brainSprites";
import { createStage, distLimits, setModel, syncFrame } from "./brainStage";

const FLOOR = 12;
const NOW = Date.UTC(2026, 8, 26);

let restore: () => void;
beforeAll(() => {
  restore = installRecordingCanvas();
});
afterAll(() => restore());

const tokens: Tokens = {
  light: false,
  bg: "#0b0a08",
  text: "#f2eee3",
  dim: "#b3aa96",
  faint: "#8f8672",
  agent: "#22d3ee",
  agentText: "#67e8f9",
  accent: "#f97316",
  display: "Rajdhani, sans-serif",
  body: "Inter, sans-serif",
  mono: "ui-monospace, monospace",
};

function sky() {
  const groups = ["Docs", "Worker", "Skills", "Routines"];
  const files = Array.from({ length: 80 }, (_, i) => ({
    id: i + 1,
    name: `note-${i}.md`,
    title: `A note about topic ${i}`,
    group: groups[i % groups.length]!,
    degree: 1 + (i % 5),
    mtime: NOW - i * 3_600_000,
    tint: null,
  }));
  const edges = files.slice(1).map((_, i) => ({ a: i, b: i + 1, kind: "markdown-link" }));
  const adjacency = files.map((_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < files.length));
  const stage = createStage();
  stage.viewport = { w: 1280, h: 800 };
  syncFrame(stage);
  stage.reduced = true;
  stage.excerpt = (i) => `The opening line of note ${i}, long enough to be drawn as an excerpt.`;
  stage.groupText = groups.map((g) => g.toUpperCase());
  stage.guideText = [];
  setModel(
    stage,
    buildModel(files, edges, adjacency, { order: [], enabled: new Set(["markdown-link"]), now: NOW }),
  );
  return stage;
}

function paint(
  distance: "near" | "mid" | "far",
  extra: (s: ReturnType<typeof sky>) => void = () => undefined,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  const stage = sky();
  const [lo, hi] = distLimits(stage.model);
  stage.cam.dist = distance === "near" ? lo : distance === "far" ? hi : (lo + hi) / 8;
  stage.level = distance === "near" ? 3 : distance === "mid" ? 1.5 : 0;
  extra(stage);
  const painter = new Painter(ctx, new SpriteBook(tokens), tokens);
  painter.w = 1280;
  painter.h = 800;
  clearTextDrawnOn(canvas);
  for (let f = 0; f < 4; f++)
    painter.frame(stage, 1000 + f * 40, 0.04, { enter: "Scroll to enter", exit: "Scroll out to leave" });
  return textDrawnOn(canvas);
}

describe("Núcleo brain scene text, measured on screen (C17)", () => {
  for (const distance of ["near", "mid", "far"] as const) {
    it(`is never under ${FLOOR}px with the camera ${distance}`, () => {
      const extras: Array<(s: ReturnType<typeof sky>) => void> = [
        () => undefined,
        (s) => void ((s.hoverIdx = 3), (s.selIdx = 7), (s.enterIdx = 3)),
        (s) => void ((s.highlight = new Set([1, 2, 3, 4, 5, 6])), (s.labelHighlight = true)),
        (s) => void (s.pointer = { x: 640, y: 400 }),
      ];
      const small: string[] = [];
      let total = 0;
      const sites = new Set<string>();
      for (const extra of extras)
        for (const t of paint(distance, extra)) {
          total++;
          sites.add(t.site);
          if (t.px < FLOOR - 1e-6) small.push(`"${t.text}" at ${t.px.toFixed(2)}px`);
        }
      expect(small, small.join("\n")).toEqual([]);
      expect([...sites], "the painter is the only file that writes on the sky").toEqual([
        "nucleo/scenes/brainPaint.ts",
      ]);
      // Not vacuous: something was written at every distance (area names at least).
      expect(total).toBeGreaterThan(0);
    });
  }

  it("writes titles when close, so the near case really measures labels", () => {
    const near = paint("near", (s) => void (s.highlight = new Set(Array.from({ length: 40 }, (_, i) => i))));
    expect(near.some((t) => t.text.includes("note"))).toBe(true);
  });
});

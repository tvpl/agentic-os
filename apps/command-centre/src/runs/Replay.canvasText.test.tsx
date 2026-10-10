// @vitest-environment jsdom
/**
 * Design-system C17, the run replay: node names are at least 12px on screen at
 * the density the canvas is drawn with, with the long names, counts and the
 * tool nodes of a real run. The text size is `12px` under a `setTransform(dpr)`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { installRecordingCanvas, textDrawnOn } from "../testing/canvasText";
import Replay from "./Replay";

const FLOOR = 12;

let restore: () => void;
beforeAll(() => {
  restore = installRecordingCanvas();
});
afterAll(() => restore());
afterEach(cleanup);

const events = [
  { type: "started", ts: 1000, pid: 1 },
  { type: "tool_use", ts: 1200, tool: "Read", detail: "a" },
  { type: "tool_use", ts: 1500, tool: "Read", detail: "b" },
  { type: "tool_use", ts: 2500, tool: "mcp__server__a_rather_long_tool_name", detail: "c" },
  { type: "assistant", ts: 3000, text: "done" },
  { type: "result", ts: 4000, exitCode: 0 },
] as never;

describe("Replay canvas text, measured on screen (C17)", () => {
  for (const dpr of [1, 2]) {
    it(`draws every node name at ${FLOOR}px or more (density ${dpr})`, () => {
      Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
      const { container } = render(<Replay events={events} />);
      const canvas = container.querySelector("canvas")!;
      // jsdom lays nothing out: the replay falls back to its 320px minimum width.
      const drawn = textDrawnOn(canvas, 320);
      expect(drawn.length).toBeGreaterThan(0);
      const small = drawn
        .filter((t) => t.px < FLOOR - 1e-6)
        .map((t) => `"${t.text}" at ${t.px.toFixed(2)}px`);
      expect(small, small.join("\n")).toEqual([]);
    });
  }
});

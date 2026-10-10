/**
 * A recording canvas for the type-floor proof (design-system C17): what a
 * layer draws as text, measured where a person sees it. A canvas draws text at
 * `font size × the transform's scale`, and a sprite baked on a small canvas is
 * drawn onto another one at `dest width / source width` more: only the product
 * says how big the letters are on screen. Reading the size out of the source
 * (what C3 does) cannot see either factor.
 *
 * The fake context implements the 2D state a renderer touches (transform
 * stack, `font`, `measureText`, `drawImage` of another recorded canvas) and
 * swallows everything else. It is a test double, not a rasteriser.
 */

import { canvasFontPx } from "./fontSize";

export interface DrawnText {
  text: string;
  /** Font size on screen, in CSS px, after every transform and sprite scale. */
  px: number;
  /** The source file (`brain/render/draw.ts`) whose code asked for the text, from the call stack. */
  site: string;
}

interface Recorded {
  /** The canvas's own text, at its own pixel scale (sprites are scaled by their `drawImage`). */
  texts: DrawnText[];
  width: number;
  height: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const records = new WeakMap<object, Recorded>();

/**
 * The text drawn on `canvas` (directly or through sprites blitted onto it),
 * sized as a person sees it. A canvas backed at `dpr` times its CSS size draws
 * the same letters `dpr` times larger in its own pixels: pass the CSS width the
 * canvas is displayed at (default: its pixel width, one pixel per CSS px).
 */
export function textDrawnOn(canvas: { width: number }, cssWidth: number = canvas.width): DrawnText[] {
  const shown = cssWidth / (canvas.width || 1);
  return (records.get(canvas)?.texts ?? []).map((t) => ({ ...t, px: t.px * shown }));
}

export function clearTextDrawnOn(canvas: object): void {
  const r = records.get(canvas);
  if (r) r.texts.length = 0;
}

/**
 * The source file that asked for the text, read from the stack: the first frame
 * in `src` that is neither this recorder nor a test. It lets a test say which
 * files a layer drew text from, so a file that draws text through a spelling no
 * source scan recognises (a bound method, `Reflect.apply`…) still shows up.
 */
function callSite(): string {
  for (const line of (new Error().stack ?? "").split("\n")) {
    const m = /\/src\/((?!testing\/)[^\s:()]+?\.(?:tsx?|jsx?))(?::\d+)/.exec(line);
    if (m && !/\.test\.[tj]sx?$/.test(m[1]!)) return m[1]!;
  }
  return "(unknown)";
}

/** The files the text on `canvas` was drawn from (sprites included), sorted. */
export function textSitesOn(canvas: { width: number }): string[] {
  return [...new Set(textDrawnOn(canvas).map((t) => t.site))].sort();
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
const scaleOf = (m: Matrix) => Math.hypot(m[0], m[1]);

/** A 2D context for `canvas` that records the on-screen size of every text it draws. */
export function recordingContext(
  canvas: { width: number; height: number },
  /** The size `em` and `%` fonts are relative to: the canvas element's own font size (16px unless styled). */
  emBase = 16,
): CanvasRenderingContext2D {
  const rec: Recorded = records.get(canvas) ?? { texts: [], width: canvas.width, height: canvas.height };
  records.set(canvas, rec);
  let matrix: Matrix = [...IDENTITY];
  const stack: { matrix: Matrix; font: string }[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif", globalAlpha: 1 };

  const draw = (text: string) => {
    // Throws when the font cannot be read: text must never go unmeasured.
    const px = canvasFontPx(String(state.font), emBase);
    rec.texts.push({ text, px: px * scaleOf(matrix), site: callSite() });
  };
  const methods: Record<string, (...args: never[]) => unknown> = {
    save: () => void stack.push({ matrix: [...matrix], font: String(state.font) }),
    restore: () => {
      const top = stack.pop();
      if (top) {
        matrix = top.matrix;
        state.font = top.font;
      }
    },
    translate: (x: number, y: number) => void (matrix = multiply(matrix, [1, 0, 0, 1, x, y])),
    scale: (x: number, y: number) => void (matrix = multiply(matrix, [x, 0, 0, y, 0, 0])),
    rotate: (a: number) =>
      void (matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])),
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      void (matrix = multiply(matrix, [a, b, c, d, e, f])),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      void (matrix = [a, b, c, d, e, f]),
    resetTransform: () => void (matrix = [...IDENTITY]),
    getTransform: () => ({
      a: matrix[0],
      b: matrix[1],
      c: matrix[2],
      d: matrix[3],
      e: matrix[4],
      f: matrix[5],
    }),
    fillText: (text: string) => void draw(text),
    strokeText: (text: string) => void draw(text),
    // Monospace-ish advance: close enough for the fit and collision decisions a renderer makes.
    measureText: (text: string) => ({ width: text.length * 0.6 * canvasFontPx(String(state.font), emBase) }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => ({}),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
    drawImage: (source: object, ...a: number[]) => {
      const src = records.get(source);
      if (!src) return;
      // drawImage(img, dx, dy) | (img, dx, dy, dw, dh) | (img, sx, sy, sw, sh, dx, dy, dw, dh)
      const dw = a.length >= 8 ? a[6]! : a.length >= 4 ? a[2]! : src.width;
      const sw = a.length >= 8 ? a[2]! : src.width;
      const ratio = sw ? Math.abs(dw) / sw : 1;
      for (const t of src.texts) rec.texts.push({ ...t, px: t.px * ratio * scaleOf(matrix) });
    },
  };

  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop in methods) return methods[prop];
        if (prop === "canvas") return canvas;
        if (prop in state) return state[prop];
        return () => undefined;
      },
      set(_t, prop: string, value) {
        state[prop] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

/**
 * Make every `<canvas>` created through the DOM hand out a recording context
 * (jsdom has none). Returns the restore function.
 */
export function installRecordingCanvas(): () => void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: (kind: string) => unknown };
  const original = proto.getContext;
  const contexts = new WeakMap<object, CanvasRenderingContext2D>();
  proto.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== "2d") return null;
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = recordingContext(this);
      contexts.set(this, ctx);
    }
    return ctx;
  };
  // jsdom has no Path2D either: a path that records nothing.
  const g = globalThis as { Path2D?: unknown };
  const hadPath2D = "Path2D" in g;
  if (!hadPath2D)
    g.Path2D = class {
      constructor() {
        return new Proxy(this, { get: (t, p) => (p in t ? (t as never)[p] : () => undefined) });
      }
    };
  return () => {
    proto.getContext = original;
    if (!hadPath2D) delete g.Path2D;
  };
}

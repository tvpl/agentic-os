/**
 * The Brain scene's pre-drawn light (immersive shell): star glows at three
 * depths of field, lit star bodies (a sphere, not a dot), nebula puffs and
 * pulse heads, each drawn once per colour and theme into a small offscreen
 * canvas so the sky only ever blits them. Glyph paths are compiled once.
 */
import { GLYPHS, type ContentKind } from "./brainGlyphs";
import { mixHex, rgba } from "./brainModel";

export interface SpriteTheme {
  light: boolean;
  bg: string;
  text: string;
}

export type Blur = 0 | 1 | 2;

export class SpriteBook {
  private cache = new Map<string, HTMLCanvasElement>();
  private glyphs = new Map<ContentKind, Path2D>();
  constructor(private theme: SpriteTheme) {}

  setTheme(theme: SpriteTheme): void {
    this.theme = theme;
    this.cache.clear();
  }

  private make(key: string, size: number, paint: (g: CanvasRenderingContext2D, s: number) => void) {
    let c = this.cache.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    if (g) paint(g, size);
    this.cache.set(key, c);
    return c;
  }

  /** Point of light. Blur 0 is in focus (a hot white core), 2 is far out of focus (a soft haze). */
  glow(color: string, blur: Blur): HTMLCanvasElement {
    const { light, text } = this.theme;
    return this.make(`g${blur}${light ? "l" : "d"}${color}`, 64, (g, s) => {
      const h = s / 2;
      const gr = g.createRadialGradient(h, h, 0, h, h, h);
      if (light) {
        const core = mixHex(color, text, 0.35);
        const peak = [1, 0.75, 0.45][blur]!;
        gr.addColorStop(0, rgba(core, peak));
        gr.addColorStop([0.16, 0.24, 0.34][blur]!, rgba(core, peak * 0.9));
        gr.addColorStop([0.3, 0.42, 0.6][blur]!, rgba(color, peak * 0.3));
        gr.addColorStop(1, rgba(color, 0));
      } else if (blur === 0) {
        gr.addColorStop(0, "rgba(255,255,255,1)");
        gr.addColorStop(0.1, rgba(mixHex(color, "#ffffff", 0.5), 1));
        gr.addColorStop(0.2, rgba(color, 0.85));
        gr.addColorStop(0.42, rgba(color, 0.22));
        gr.addColorStop(1, rgba(color, 0));
      } else if (blur === 1) {
        gr.addColorStop(0, rgba(mixHex(color, "#ffffff", 0.3), 0.85));
        gr.addColorStop(0.22, rgba(color, 0.55));
        gr.addColorStop(0.55, rgba(color, 0.14));
        gr.addColorStop(1, rgba(color, 0));
      } else {
        gr.addColorStop(0, rgba(color, 0.42));
        gr.addColorStop(0.4, rgba(color, 0.2));
        gr.addColorStop(0.75, rgba(color, 0.05));
        gr.addColorStop(1, rgba(color, 0));
      }
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }

  /** A lit sphere: highlight up-left, the colour, a darker limb and a thin bright rim. */
  body(color: string): HTMLCanvasElement {
    const { light, bg, text } = this.theme;
    return this.make(`b${light ? "l" : "d"}${color}`, 96, (g, s) => {
      const h = s / 2;
      const r = h - 3;
      const base = light ? mixHex(color, text, 0.28) : color;
      const gr = g.createRadialGradient(h - r * 0.38, h - r * 0.42, r * 0.05, h, h, r);
      gr.addColorStop(0, mixHex(base, "#ffffff", light ? 0.35 : 0.62));
      gr.addColorStop(0.45, base);
      gr.addColorStop(1, mixHex(base, bg, light ? 0.25 : 0.55));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(h, h, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = rgba(
        light ? mixHex(base, text, 0.4) : mixHex(color, "#ffffff", 0.55),
        light ? 0.55 : 0.7,
      );
      g.stroke();
    });
  }

  /** A soft puff of nebula light. */
  puff(color: string): HTMLCanvasElement {
    const { light } = this.theme;
    return this.make(`p${light ? "l" : "d"}${color}`, 128, (g, s) => {
      const h = s / 2;
      const gr = g.createRadialGradient(h, h, 0, h, h, h);
      gr.addColorStop(0, rgba(color, 1));
      gr.addColorStop(0.3, rgba(color, 0.5));
      gr.addColorStop(0.62, rgba(color, 0.14));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }

  /** A pulse's head: a tight, hot point. */
  spark(color: string): HTMLCanvasElement {
    const { light } = this.theme;
    return this.make(`s${light ? "l" : "d"}${color}`, 32, (g, s) => {
      const h = s / 2;
      const gr = g.createRadialGradient(h, h, 0, h, h, h);
      if (light) {
        gr.addColorStop(0, rgba(color, 1));
        gr.addColorStop(0.35, rgba(color, 0.6));
        gr.addColorStop(1, rgba(color, 0));
      } else {
        gr.addColorStop(0, "rgba(255,255,255,1)");
        gr.addColorStop(0.2, rgba(mixHex(color, "#ffffff", 0.4), 0.95));
        gr.addColorStop(0.5, rgba(color, 0.35));
        gr.addColorStop(1, rgba(color, 0));
      }
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    });
  }

  glyph(kind: ContentKind): Path2D {
    let p = this.glyphs.get(kind);
    if (!p) {
      p = new Path2D(GLYPHS[kind]);
      this.glyphs.set(kind, p);
    }
    return p;
  }
}

/**
 * Stroke a glyph centred on (x, y), `size` px across. The caller sets
 * `strokeStyle`; the line weight follows the size.
 */
export function strokeGlyph(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  x: number,
  y: number,
  size: number,
): void {
  const k = size / 24;
  const screenW = Math.max(1.1, Math.min(2.2, 0.85 + size * 0.035));
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(k, k);
  ctx.lineWidth = screenW / k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.restore();
}

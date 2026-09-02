/**
 * Sprite cache: every glowing shape is rasterised once (with `shadowBlur`)
 * into a small offscreen canvas and then blitted with `drawImage`, which is
 * an order of magnitude cheaper than blurring per frame (audit item 30).
 * No React; the canvas factory is injectable for tests.
 */
export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Half extent in world units — draw at (x - half, y - half, 2·half, 2·half). */
  half: number;
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

/** Rasterisation scale so sprites stay crisp when zoomed in. */
const SCALE = 2;
const TWO_PI = Math.PI * 2;

const defaultFactory: CanvasFactory = (width, height) => {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
};

export class SpriteCache {
  private readonly map = new Map<string, Sprite>();
  constructor(private readonly create: CanvasFactory = defaultFactory) {}

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  private make(key: string, half: number, paint: (ctx: CanvasRenderingContext2D) => void): Sprite {
    const cached = this.map.get(key);
    if (cached) return cached;
    const px = Math.max(2, Math.ceil(half * 2 * SCALE));
    const canvas = this.create(px, px);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(SCALE, 0, 0, SCALE, (px / SCALE / 2) * SCALE, (px / SCALE / 2) * SCALE);
      paint(ctx);
    }
    const sprite = { canvas, half };
    this.map.set(key, sprite);
    return sprite;
  }

  /** Soft particle: bright core fading to transparent. Light theme keeps the hue in the core. */
  glow(color: string, light = false): Sprite {
    return this.make(`glow:${color}:${light ? 1 : 0}`, 20, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 19);
      g.addColorStop(0, light ? color : "#ffffff");
      g.addColorStop(0.18, color);
      g.addColorStop(0.5, color + (light ? "66" : "88"));
      g.addColorStop(1, color + "00");
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, 40, 40);
    });
  }

  /** Filled disc with a pre-blurred halo. */
  disc(color: string, r: number, blur: number): Sprite {
    const half = r + blur * 1.5;
    return this.make(`disc:${color}:${r}:${blur}`, half, (ctx) => {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * SCALE;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.fill();
    });
  }

  /** Stroked circle with a halo (routine clocks, the core pulse ring). */
  ring(color: string, r: number, lineWidth: number, blur: number): Sprite {
    const half = r + lineWidth + blur * 1.5;
    return this.make(`ring:${color}:${r}:${lineWidth}:${blur}`, half, (ctx) => {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * SCALE;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TWO_PI);
      ctx.stroke();
    });
  }

  /** Eight-point spark (skills). */
  spark(color: string, size: number, blur: number, coreColor: string): Sprite {
    const half = size + blur * 1.5;
    return this.make(`spark:${color}:${size}:${blur}:${coreColor}`, half, (ctx) => {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * SCALE;
      ctx.fillStyle = color;
      ctx.beginPath();
      const inner = size * 0.32;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TWO_PI - Math.PI / 2;
        const rr = i % 2 === 0 ? size : inner;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, size * 0.16), 0, TWO_PI);
      ctx.fill();
    });
  }

  /** Hexagonal badge body (connectors): token fill + glowing outline; initials are drawn live. */
  hex(color: string, size: number, fill: string, blur: number, lineWidth: number): Sprite {
    const half = size + lineWidth + blur * 1.5;
    return this.make(`hex:${color}:${size}:${fill}:${blur}:${lineWidth}`, half, (ctx) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = Math.cos(a) * size;
        const py = Math.sin(a) * size;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowColor = color;
      ctx.shadowBlur = blur * SCALE;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    });
  }
}

/** Blit helper: centred at (x, y), optionally scaled. */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, scale = 1): void {
  const h = s.half * scale;
  ctx.drawImage(s.canvas, x - h, y - h, h * 2, h * 2);
}

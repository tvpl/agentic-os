/**
 * The crisp instrument layer over the WebGL core, drawn on a 2D canvas:
 * concentric rings with rotating segments and ticks, a ring of micro-text,
 * the system's amber sweep while the agent works, voice bars while it
 * speaks, and the activity satellites — one small glyph and label per tool
 * call, born with a spark from the core.
 *
 * Static parts (tick ring, micro-text) are pre-rendered to offscreen canvases
 * and only rotated per frame; colours are set as solid strings with
 * `globalAlpha`, so the loop allocates nothing.
 */
import {
  GEOMETRY,
  SATELLITE_DRIFT,
  easeOutCubic,
  inscription,
  satelliteAlpha,
  satelliteScale,
  slotAngle,
  sparkProgress,
  type EntityActivity,
  type EntityVariant,
  type Rgb,
} from "./entityParams";

export interface HudPalette {
  light: boolean;
  agent: string;
  sys: string;
  warn: string;
  danger: string;
  ok: string;
  faint: string;
  dim: string;
  plate: string;
  fs2: number;
  mono: string;
}

export function css(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

/** Per-frame HUD values, mutated in place by the engine. */
export interface HudFrame {
  time: number;
  spinA: number;
  spinB: number;
  spinText: number;
  scan: number;
  scanPhase: number;
  warm: number;
  wait: number;
  waitPulse: number;
  speak: number;
  speakPhase: number;
  typing: number;
  shockProgress: number;
  shockAmp: number;
  shockOk: boolean;
  dim: number;
  energy: number;
  coreScale: number;
}

export interface Satellite {
  id: string;
  kind: EntityActivity["kind"];
  label: string;
  born: number;
  slot: number;
}

export class EntityHud {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly variant: EntityVariant;
  private pal: HudPalette | null = null;
  private word = "IDLE";
  private dpr = 1;
  /** Element size (the square the core is laid out in), CSS px. */
  private size = 0;
  private cw = 0;
  private ch = 0;
  private ticks: HTMLCanvasElement | null = null;
  private text: HTMLCanvasElement | null = null;
  private labelFont = "";

  constructor(canvas: HTMLCanvasElement, variant: EntityVariant) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.variant = variant;
  }

  /** Sizes the canvas (its own CSS box) and the layout square. */
  setMetrics(cssWidth: number, cssHeight: number, size: number, dpr: number): void {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    const changed =
      w !== this.canvas.width || h !== this.canvas.height || size !== this.size || dpr !== this.dpr;
    if (w !== this.canvas.width) this.canvas.width = w;
    if (h !== this.canvas.height) this.canvas.height = h;
    this.cw = cssWidth;
    this.ch = cssHeight;
    this.size = size;
    this.dpr = dpr;
    if (changed) this.rebuild();
  }

  setPalette(pal: HudPalette): void {
    this.pal = pal;
    this.labelFont = `500 ${Math.max(12, pal.fs2)}px ${pal.mono}`;
    this.rebuild();
  }

  setWord(word: string): void {
    if (word === this.word) return;
    this.word = word;
    this.rebuildText();
  }

  private rebuild(): void {
    this.rebuildTicks();
    this.rebuildText();
  }

  private offscreen(radius: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    const side = Math.ceil(radius * 2 * this.dpr) + 4;
    c.width = side;
    c.height = side;
    return c;
  }

  private rebuildTicks(): void {
    const pal = this.pal;
    const g = GEOMETRY[this.variant];
    if (!pal || this.size <= 0 || g.ringB <= 0) {
      this.ticks = null;
      return;
    }
    const r = g.ringB * this.size;
    const major = Math.max(5, this.size * 0.013);
    const c = this.offscreen(r + major + 2);
    const x = c.getContext("2d");
    if (!x) return;
    const mid = c.width / 2;
    x.translate(mid, mid);
    x.scale(this.dpr, this.dpr);
    x.strokeStyle = pal.faint;
    x.lineCap = "butt";
    const n = 180;
    for (let i = 0; i < n; i++) {
      const deg = (i / n) * 360;
      // Four gaps make it read as an instrument, not a gear.
      const inGap = deg % 90 > 76;
      if (inGap) continue;
      const isMajor = i % 5 === 0;
      const a = (i / n) * Math.PI * 2;
      const l = isMajor ? major : major * 0.45;
      x.globalAlpha = isMajor ? 0.55 : 0.28;
      x.lineWidth = isMajor ? 1.1 : 0.8;
      x.beginPath();
      x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      x.lineTo(Math.cos(a) * (r + l), Math.sin(a) * (r + l));
      x.stroke();
    }
    // Hairline under the ticks.
    x.globalAlpha = 0.18;
    x.lineWidth = 0.75;
    x.beginPath();
    x.arc(0, 0, r - 2, 0, Math.PI * 2);
    x.stroke();
    this.ticks = c;
  }

  private rebuildText(): void {
    const pal = this.pal;
    const g = GEOMETRY[this.variant];
    if (!pal || this.size <= 0 || g.ringText <= 0) {
      this.text = null;
      return;
    }
    const r = g.ringText * this.size;
    // It used to shrink with the canvas; at the text floor there is nothing left to shrink.
    const fs = Math.max(12, pal.fs2);
    const c = this.offscreen(r + fs + 2);
    const x = c.getContext("2d");
    if (!x) return;
    const mid = c.width / 2;
    x.translate(mid, mid);
    x.scale(this.dpr, this.dpr);
    x.font = `500 ${fs}px ${pal.mono}`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = pal.faint;
    const adv = x.measureText("M").width + fs * 0.3;
    const step = adv / r;
    // Two short inscriptions facing each other, not a full ring of text.
    const s = inscription(this.word);
    for (let side = 0; side < 2; side++) {
      const start = side * Math.PI - (s.length * step) / 2;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        if (ch === " ") continue;
        x.save();
        x.rotate(start + i * step);
        x.translate(0, -r);
        x.globalAlpha = ch === "·" ? 0.45 : 0.62;
        x.fillText(ch, 0, 0);
        x.restore();
      }
      // Hairline brackets closing each inscription.
      x.strokeStyle = pal.faint;
      x.lineWidth = 0.75;
      x.globalAlpha = 0.35;
      const a0 = start - Math.PI / 2 - step * 1.2;
      const a1 = start - Math.PI / 2 + s.length * step + step * 0.2;
      x.beginPath();
      x.arc(0, 0, r, a0 - 0.18, a0);
      x.stroke();
      x.beginPath();
      x.arc(0, 0, r, a1, a1 + 0.18);
      x.stroke();
    }
    this.text = c;
  }

  private blit(img: HTMLCanvasElement, cx: number, cy: number, angle: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const s = img.width / this.dpr;
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  draw(f: HudFrame, sats: readonly Satellite[], satCount: number): void {
    const pal = this.pal;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!pal || this.size <= 0) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cx = this.cw / 2;
    const cy = this.ch / 2;
    const S = this.size;
    const g = GEOMETRY[this.variant];
    const dim = f.dim;
    const shockK = f.shockAmp * (1 - f.shockProgress);
    const shockCol = f.shockOk ? pal.ok : pal.danger;
    ctx.lineCap = "round";

    if (this.variant === "iris") {
      this.drawIris(f, cx, cy, S, shockK, shockCol);
      return;
    }

    const rA = g.ringA * S;
    // Ring A: hairline + three rotating segments.
    ctx.strokeStyle = pal.agent;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = (0.16 + 0.25 * f.typing) * dim;
    ctx.beginPath();
    ctx.arc(cx, cy, rA, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = (0.5 + 0.35 * f.typing) * dim;
    for (let k = 0; k < 3; k++) {
      const a0 = f.spinA + k * 2.2 + (k === 1 ? 0.4 : 0);
      const len = k === 0 ? 0.62 : k === 1 ? 0.24 : 1.05;
      ctx.beginPath();
      ctx.arc(cx, cy, rA, a0, a0 + len);
      ctx.stroke();
    }
    // Shock flash on ring A.
    if (shockK > 0.01) {
      ctx.strokeStyle = shockCol;
      ctx.globalAlpha = shockK * 0.85;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, rA, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Tick ring and micro-text, pre-rendered.
    if (this.ticks) this.blit(this.ticks, cx, cy, f.spinB, 0.9 * dim);
    if (this.text) this.blit(this.text, cx, cy, f.spinText, 0.85 * dim);

    // The system at work: an amber sweep with a fading tail on ring A.
    if (f.scan > 0.01) {
      ctx.strokeStyle = pal.sys;
      ctx.lineWidth = 2;
      const head = f.scanPhase * 1.35;
      const tail = 1.2;
      const segs = 14;
      for (let k = 0; k < segs; k++) {
        const a1 = head - (k / segs) * tail;
        const a0 = head - ((k + 1) / segs) * tail;
        const fall = 1 - k / segs;
        ctx.globalAlpha = f.scan * fall * fall * 0.95 * dim;
        ctx.beginPath();
        ctx.arc(cx, cy, rA - 4, a0, a1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, rA - 4, a0 + Math.PI, a1 + Math.PI);
        ctx.globalAlpha *= 0.4;
        ctx.stroke();
      }
      ctx.fillStyle = pal.sys;
      ctx.globalAlpha = f.scan * dim;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(head) * (rA - 4), cy + Math.sin(head) * (rA - 4), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Needs the human: four warn brackets on the tick ring, pulsing.
    if (f.wait > 0.01) {
      const rB = g.ringB * S + S * 0.006;
      ctx.strokeStyle = pal.warn;
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = f.wait * (0.3 + 0.7 * f.waitPulse);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2 + f.spinB;
        ctx.beginPath();
        ctx.arc(cx, cy, rB, a - 0.16, a + 0.16);
        ctx.stroke();
      }
    }

    // Voice bars just outside the membrane.
    if (f.speak > 0.02) {
      const r0 = g.core * S * f.coreScale * 1.16;
      const maxL = S * 0.05;
      const n = 96;
      ctx.strokeStyle = pal.agent;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = Math.min(1, f.speak * 1.1) * 0.7 * dim;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const v = Math.abs(Math.sin(i * 1.7 + f.speakPhase * 0.9) * Math.sin(i * 0.63 - f.time * 3.1));
        const l = maxL * f.speak * (0.15 + 0.85 * v);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        ctx.moveTo(cx + ca * r0, cy + sa * r0);
        ctx.lineTo(cx + ca * (r0 + l), cy + sa * (r0 + l));
      }
      ctx.stroke();
    }

    // Activity satellites.
    if (satCount > 0) this.drawSatellites(f, sats, satCount, cx, cy, S);
    ctx.globalAlpha = 1;
  }

  private drawIris(f: HudFrame, cx: number, cy: number, S: number, shockK: number, shockCol: string): void {
    const pal = this.pal!;
    const ctx = this.ctx;
    const r = GEOMETRY.iris.ringA * S;
    const base = f.wait > 0.5 ? pal.warn : pal.agent;
    ctx.lineWidth = 1;
    ctx.strokeStyle = base;
    ctx.globalAlpha = (0.22 + 0.25 * f.typing + f.wait * 0.4 * f.waitPulse) * f.dim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // One travelling arc: cyan at rest, amber while the system works.
    const len = 0.9 + f.scan * 0.9 + f.speak * 1.2;
    const a0 = f.spinA * 2.2;
    ctx.lineWidth = 1.6;
    if (f.warm < 0.99) {
      ctx.strokeStyle = base;
      ctx.globalAlpha = (1 - f.warm) * (0.75 + 0.25 * f.typing) * f.dim;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + len);
      ctx.stroke();
    }
    if (f.warm > 0.01) {
      ctx.strokeStyle = pal.sys;
      ctx.globalAlpha = f.warm * 0.95 * f.dim;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + len);
      ctx.stroke();
      ctx.globalAlpha *= 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0 + Math.PI, a0 + Math.PI + len * 0.5);
      ctx.stroke();
    }
    if (shockK > 0.01) {
      ctx.strokeStyle = shockCol;
      ctx.globalAlpha = shockK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawSatellites(
    f: HudFrame,
    sats: readonly Satellite[],
    count: number,
    cx: number,
    cy: number,
    S: number,
  ): void {
    const pal = this.pal!;
    const ctx = this.ctx;
    const g = GEOMETRY.hero;
    const orbit = g.satellites * S;
    const core = g.core * S;
    const node = Math.max(7, S * 0.017);
    // A faint orbit path while anything is on it.
    let maxA = 0;
    for (let i = 0; i < count; i++) maxA = Math.max(maxA, satelliteAlpha(f.time - sats[i]!.born));
    if (maxA > 0) {
      ctx.strokeStyle = pal.agent;
      ctx.lineWidth = 0.75;
      ctx.globalAlpha = 0.1 * maxA;
      ctx.setLineDash(DASH);
      ctx.beginPath();
      ctx.arc(cx, cy, orbit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    ctx.font = this.labelFont;
    ctx.letterSpacing = "0.08em";
    ctx.textBaseline = "middle";
    for (let i = 0; i < count; i++) {
      const s = sats[i]!;
      const age = f.time - s.born;
      const ang = slotAngle(s.slot) + age * SATELLITE_DRIFT;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const x = cx + ca * orbit;
      const y = cy + sa * orbit;
      // Birth spark: a streak from the membrane to the orbit.
      const sp = sparkProgress(age);
      if (sp >= 0) {
        const head = core + (orbit - core) * easeOutCubic(sp);
        const tailLen = (orbit - core) * 0.35 * (1 - sp * 0.6);
        ctx.strokeStyle = pal.agent;
        ctx.lineWidth = 1.4;
        const segs = 6;
        for (let k = 0; k < segs; k++) {
          const r1 = head - (k / segs) * tailLen;
          const r0 = head - ((k + 1) / segs) * tailLen;
          if (r0 < core) break;
          ctx.globalAlpha = (1 - k / segs) * (1 - sp * 0.4);
          ctx.beginPath();
          ctx.moveTo(cx + ca * r0, cy + sa * r0);
          ctx.lineTo(cx + ca * r1, cy + sa * r1);
          ctx.stroke();
        }
        ctx.fillStyle = pal.light ? pal.agent : "#ffffff";
        ctx.globalAlpha = 1 - sp * 0.3;
        ctx.beginPath();
        ctx.arc(cx + ca * head, cy + sa * head, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      const a = satelliteAlpha(age) * f.dim;
      if (a <= 0.003) continue;
      const sc = satelliteScale(age);
      const nr = node * sc;
      // Anchor tick toward the core.
      ctx.strokeStyle = pal.agent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + ca * (orbit - nr - S * 0.012), cy + sa * (orbit - nr - S * 0.012));
      ctx.lineTo(cx + ca * (orbit - nr - 2), cy + sa * (orbit - nr - 2));
      ctx.stroke();
      // Node.
      ctx.fillStyle = pal.plate;
      ctx.globalAlpha = a * 0.92;
      ctx.beginPath();
      ctx.arc(x, y, nr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Glyph.
      ctx.lineWidth = 1.15;
      ctx.lineJoin = "round";
      glyph(ctx, s.kind, x, y, nr * 0.62, pal.agent);
      // Label, outward from the orbit.
      const right = ca >= -0.05;
      const lx = right ? x + nr + 6 : x - nr - 6;
      ctx.textAlign = right ? "left" : "right";
      ctx.fillStyle = pal.dim;
      ctx.globalAlpha = a * 0.95;
      ctx.fillText(s.label, lx, y + 0.5);
    }
    ctx.letterSpacing = "0px";
  }
}

const DASH: number[] = [2, 5];
const NO_DASH: number[] = [];

/** Minimal line icons (lucide-like), drawn in a box of half-size `h`. */
function glyph(
  ctx: CanvasRenderingContext2D,
  kind: EntityActivity["kind"],
  x: number,
  y: number,
  h: number,
  colour: string,
): void {
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.beginPath();
  switch (kind) {
    case "read": {
      // A page with lines.
      const w = h * 0.78;
      ctx.moveTo(x - w, y - h);
      ctx.lineTo(x + w * 0.35, y - h);
      ctx.lineTo(x + w, y - h * 0.45);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x - w, y + h);
      ctx.closePath();
      ctx.moveTo(x - w * 0.5, y);
      ctx.lineTo(x + w * 0.5, y);
      ctx.moveTo(x - w * 0.5, y + h * 0.45);
      ctx.lineTo(x + w * 0.3, y + h * 0.45);
      ctx.stroke();
      return;
    }
    case "write": {
      // A pencil.
      ctx.moveTo(x - h * 0.85, y + h * 0.85);
      ctx.lineTo(x - h * 0.6, y + h * 0.2);
      ctx.lineTo(x + h * 0.45, y - h * 0.85);
      ctx.lineTo(x + h * 0.85, y - h * 0.45);
      ctx.lineTo(x - h * 0.2, y + h * 0.6);
      ctx.closePath();
      ctx.stroke();
      return;
    }
    case "run": {
      // A prompt: chevron and cursor.
      ctx.moveTo(x - h * 0.85, y - h * 0.6);
      ctx.lineTo(x - h * 0.15, y);
      ctx.lineTo(x - h * 0.85, y + h * 0.6);
      ctx.moveTo(x + h * 0.05, y + h * 0.7);
      ctx.lineTo(x + h * 0.85, y + h * 0.7);
      ctx.stroke();
      return;
    }
    case "search": {
      ctx.arc(x - h * 0.18, y - h * 0.18, h * 0.58, 0, Math.PI * 2);
      ctx.moveTo(x + h * 0.26, y + h * 0.26);
      ctx.lineTo(x + h * 0.85, y + h * 0.85);
      ctx.stroke();
      return;
    }
    case "think": {
      // Four-point sparkle.
      const k = h * 0.22;
      ctx.moveTo(x, y - h);
      ctx.quadraticCurveTo(x + k, y - k, x + h, y);
      ctx.quadraticCurveTo(x + k, y + k, x, y + h);
      ctx.quadraticCurveTo(x - k, y + k, x - h, y);
      ctx.quadraticCurveTo(x - k, y - k, x, y - h);
      ctx.fill();
      return;
    }
    case "web": {
      ctx.arc(x, y, h * 0.9, 0, Math.PI * 2);
      ctx.moveTo(x - h * 0.9, y);
      ctx.lineTo(x + h * 0.9, y);
      ctx.moveTo(x + h * 0.42, y);
      ctx.ellipse(x, y, h * 0.42, h * 0.9, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    default: {
      ctx.moveTo(x, y - h * 0.6);
      ctx.lineTo(x + h * 0.6, y);
      ctx.lineTo(x, y + h * 0.6);
      ctx.lineTo(x - h * 0.6, y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

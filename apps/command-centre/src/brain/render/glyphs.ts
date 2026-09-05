/**
 * Crafted canvas glyphs that are cheap enough to draw per frame without
 * shadows: routine clocks, hub folder glyph, sub-folder planets and the
 * pixel core. Glow comes from the sprite set.
 */
import { TWO_PI } from "../engine/world";
import type { SpriteSet } from "./sprites";

export function drawClock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  active: boolean,
  k: number,
  tNow: number,
  sprites: SpriteSet,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = active ? 1 : 0.45;
  if (active) {
    const hs = size * 2.2;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(sprites.halo(color), -hs, -hs, hs * 2, hs * 2);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 / Math.max(0.7, k);
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, TWO_PI);
  ctx.stroke();
  // Ticking hands: the minute hand sweeps once every ~8 s, the hour hand follows.
  const minuteA = (tNow * 0.8) % TWO_PI;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(minuteA - Math.PI / 2) * size * 0.72, Math.sin(minuteA - Math.PI / 2) * size * 0.72);
  ctx.moveTo(0, 0);
  ctx.lineTo(
    Math.cos(minuteA / 12 - Math.PI / 2) * size * 0.45,
    Math.sin(minuteA / 12 - Math.PI / 2) * size * 0.45,
  );
  ctx.stroke();
  ctx.restore();
}

export function drawFolderGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.fillStyle = color;
  const s = size;
  ctx.fillRect(0, s * 0.25, s, s * 0.55);
  ctx.fillRect(0, s * 0.12, s * 0.45, s * 0.2);
  ctx.restore();
}

/** Sub-folder "planet": a small ringed disc with its file count beside it. */
export function drawPlanet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  count: number,
  k: number,
  font: string,
  ink: string,
  alpha: number,
): void {
  const r = 3.6;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9 / Math.max(0.6, k);
  ctx.globalAlpha = alpha * 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 2.1, r * 0.8, -0.5, 0, TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ink;
  ctx.font = `800 ${8.5 / Math.max(0.8, k)}px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), r * 2.4, 0);
  ctx.restore();
}

const CORE_PIXELS = [
  "01111110",
  "01000010",
  "01011010",
  "01000010",
  "01100110",
  "01000010",
  "01111110",
  "00000000",
];

export function drawPixelCore(
  ctx: CanvasRenderingContext2D,
  color: string,
  k: number,
  tNow: number,
  agentsActive: boolean,
  sprites: SpriteSet,
): void {
  const px = 4.4 / Math.max(0.6, Math.min(k, 2));
  const half = (CORE_PIXELS.length * px) / 2;
  const pulse = tNow === 0 ? 0.5 : 0.4 + 0.25 * Math.sin(tNow * (agentsActive ? 5 : 2));
  ctx.save();
  const hs = (half + 13 / k) * (agentsActive ? 2.4 : 1.9);
  ctx.globalAlpha = pulse * 0.9;
  ctx.drawImage(sprites.halo(color), -hs, -hs, hs * 2, hs * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth = 1.6 / k;
  ctx.beginPath();
  ctx.arc(0, 0, half + 13 / k, 0, TWO_PI);
  ctx.stroke();
  if (agentsActive) {
    ctx.globalAlpha = pulse * 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, half + 22 / k, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  CORE_PIXELS.forEach((rowStr, row) => {
    for (let col = 0; col < rowStr.length; col++) {
      if (rowStr[col] === "1") ctx.fillRect(col * px - half, row * px - half, px * 0.92, px * 0.92);
    }
  });
  ctx.restore();
}

export function quadPoint(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  u: number,
): [number, number] {
  const v = 1 - u;
  return [v * v * ax + 2 * v * u * cx + u * u * bx, v * v * ay + 2 * v * u * cy + u * u * by];
}

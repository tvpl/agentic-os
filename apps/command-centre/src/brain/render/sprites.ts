/**
 * Pre-rendered glow sprites. Everything that used a per-frame `shadowBlur`
 * (sparks, hub discs, hex badges, the core ring) is rasterised once into a
 * small canvas and blitted with drawImage, which is an order of magnitude
 * cheaper (item A.1).
 */
import { TWO_PI } from "../engine/world";
import type { CanvasTokens } from "./tokens";

export interface SpriteSet {
  /** Soft additive dot: hot core → colour → transparent (files, pulses, comets). */
  glow(color: string): HTMLCanvasElement;
  /** Wide, faint halo (hub discs, core ring). */
  halo(color: string): HTMLCanvasElement;
  /** Eight-point star with a baked glow (skills ring). */
  spark(color: string, hovered: boolean): HTMLCanvasElement;
  /** Application hexagon with initials, baked glow, and active / official variants. */
  hex(label: string, color: string, official: boolean, active: boolean, hovered: boolean): HTMLCanvasElement;
  /** Drop every cached sprite (theme change). */
  reset(): void;
  size: number;
}

export const GLOW_SIZE = 40;
export const HALO_SIZE = 96;
export const SPARK_SIZE = 72;
export const HEX_SIZE = 96;

export function createSprites(tokens: CanvasTokens): SpriteSet {
  const cache = new Map<string, HTMLCanvasElement>();
  const make = (
    key: string,
    size: number,
    paint: (c: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement => {
    let s = cache.get(key);
    if (s) return s;
    s = document.createElement("canvas");
    s.width = size;
    s.height = size;
    const c = s.getContext("2d");
    if (c) paint(c);
    cache.set(key, s);
    return s;
  };

  return {
    size: GLOW_SIZE,
    reset: () => cache.clear(),
    glow: (color) =>
      make(`g:${color}`, GLOW_SIZE, (c) => {
        const h = GLOW_SIZE / 2;
        const g = c.createRadialGradient(h, h, 0.5, h, h, h - 1);
        g.addColorStop(0, tokens.spriteCore ?? color);
        g.addColorStop(0.18, color);
        g.addColorStop(0.5, color + "88");
        g.addColorStop(1, color + "00");
        c.fillStyle = g;
        c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
      }),
    halo: (color) =>
      make(`h:${color}`, HALO_SIZE, (c) => {
        const h = HALO_SIZE / 2;
        const g = c.createRadialGradient(h, h, 2, h, h, h);
        g.addColorStop(0, color + (tokens.light ? "66" : "99"));
        g.addColorStop(0.35, color + "40");
        g.addColorStop(1, color + "00");
        c.fillStyle = g;
        c.fillRect(0, 0, HALO_SIZE, HALO_SIZE);
      }),
    spark: (color, hovered) =>
      make(`s:${color}:${hovered ? 1 : 0}`, SPARK_SIZE, (c) => {
        const h = SPARK_SIZE / 2;
        const size = hovered ? 22 : 17;
        // baked glow
        const g = c.createRadialGradient(h, h, 1, h, h, h);
        g.addColorStop(0, color + (tokens.light ? "55" : "88"));
        g.addColorStop(0.5, color + "22");
        g.addColorStop(1, color + "00");
        c.fillStyle = g;
        c.fillRect(0, 0, SPARK_SIZE, SPARK_SIZE);
        c.translate(h, h);
        c.fillStyle = color;
        c.beginPath();
        const inner = size * 0.32;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TWO_PI - Math.PI / 2;
          const r = i % 2 === 0 ? size : inner;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
        c.fillStyle = tokens.sparkCore;
        c.beginPath();
        c.arc(0, 0, Math.max(1.5, size * 0.16), 0, TWO_PI);
        c.fill();
      }),
    hex: (label, color, official, active, hovered) =>
      make(`x:${label}:${color}:${official ? 1 : 0}${active ? 1 : 0}${hovered ? 1 : 0}`, HEX_SIZE, (c) => {
        const h = HEX_SIZE / 2;
        const size = (hovered ? 15 : 12) * 2.4;
        c.translate(h, h);
        c.globalAlpha = active ? 1 : 0.72;
        if (official || hovered) {
          const g = c.createRadialGradient(0, 0, size * 0.6, 0, 0, size * 1.5);
          g.addColorStop(0, color + (tokens.light ? "40" : "66"));
          g.addColorStop(1, color + "00");
          c.fillStyle = g;
          c.fillRect(-h, -h, HEX_SIZE, HEX_SIZE);
        }
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = Math.cos(a) * size;
          const py = Math.sin(a) * size;
          if (i === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.closePath();
        c.fillStyle = tokens.hexFill;
        c.fill();
        c.strokeStyle = color;
        c.lineWidth = 2.4 * 1.6;
        c.stroke();
        c.fillStyle = color;
        c.font = `800 ${Math.max(7, size * 0.62)}px ${tokens.mono}`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(initials(label), 0, 1);
      }),
  };
}

export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

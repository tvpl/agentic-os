/**
 * Small colour helpers (WCAG 2.x relative luminance / contrast ratio).
 * Used at runtime to derive readable tokens from the user-chosen accent.
 */

export type Rgb = { r: number; g: number; b: number };

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Parse `#rgb`, `#rrggbb` or `rgb(a)(...)`; returns null for anything else. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim();
  const hex = s.startsWith("#") ? s.slice(1) : null;
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b] = hex.split("").map((c) => parseInt(c + c, 16));
      if ([r, g, b].some((v) => v === undefined || Number.isNaN(v))) return null;
      return { r: r as number, g: g as number, b: b as number };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r, g, b };
    }
    return null;
  }
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return { r: clamp(Number(m[1])), g: clamp(Number(m[2])), b: clamp(Number(m[3])) };
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(color: Rgb | string): number {
  const rgb = typeof color === "string" ? parseColor(color) : color;
  if (!rgb) return 0;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two colours (≥ 1). */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";
const INK = "#0c0a07";

/** Text colour (white or near-black) that reads best on the given accent. */
export function accentContrast(accent: string): string {
  return contrastRatio(accent, WHITE) >= contrastRatio(accent, INK) ? WHITE : INK;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * Nudge `hex` towards black or white (whichever moves away from `bg`) until it
 * reaches `ratio` against `bg`. Keeps hue; returns the original when already
 * compliant. Falls back to plain black/white when the hue cannot reach the ratio.
 */
export function ensureContrast(hex: string, bg: string, ratio = 4.5): string {
  const fg = parseColor(hex);
  const back = parseColor(bg);
  if (!fg || !back) return hex;
  if (contrastRatio(fg, back) >= ratio) return toHex(fg);
  const towards = luminance(back) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  // Binary search the mix amount; contrast is monotonic along this segment.
  let lo = 0;
  let hi = 1;
  let best = towards;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const candidate = mix(fg, towards, mid);
    if (contrastRatio(candidate, back) >= ratio) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return toHex(best);
}

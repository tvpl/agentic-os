/**
 * Theme tokens for the canvas, read once per theme change (never per frame).
 * Every colour the renderer needs comes from here so the light theme gets
 * light-aware values instead of the old hard-coded dark constants (item 43).
 */
export interface CanvasTokens {
  light: boolean;
  blend: GlobalCompositeOperation;
  accent: string;
  text: string;
  textDim: string;
  faint: string;
  bg: string;
  bgRaise: string;
  /** Background star dots and hex grid stroke. */
  star: string;
  hexGrid: string;
  /** Default particle colour when a group has no colour (`--canvas-particle`). */
  particle: string;
  /** Fill of application hexagons (was #10131a). */
  hexFill: string;
  /** Ink of the folder glyph on hub discs (was #0b0a08). */
  glyphInk: string;
  /** Core of skill sparks (was #fff8ee). */
  sparkCore: string;
  /** Hot core of glow sprites (white on dark; the colour itself on light). */
  spriteCore: string | null;
  /** Minimap backdrop (was rgba(0,0,0,.25)). */
  minimapFill: string;
  font: string;
  mono: string;
}

export function readCanvasTokens(root: HTMLElement = document.documentElement): CanvasTokens {
  const s = getComputedStyle(root);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  const theme = root.dataset.theme;
  const light = theme === "light" || (theme !== "dark" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches && theme === "system");
  return {
    light,
    blend: light ? "source-over" : "lighter",
    accent: v("--accent", "#f97316"),
    text: v("--text", light ? "#201c14" : "#f2eee3"),
    textDim: v("--text-dim", light ? "#5d564a" : "#b3aa96"),
    faint: v("--text-faint", light ? "#6f6757" : "#8f8672"),
    bg: v("--bg", light ? "#f5f3ee" : "#0b0a08"),
    bgRaise: v("--bg-raise", light ? "#fdfcf9" : "#131109"),
    star: v("--canvas-star", light ? "#3b3630" : "#efe9da"),
    hexGrid: light ? "rgba(32,28,20,0.05)" : "rgba(240,230,210,0.03)",
    particle: v("--canvas-particle", "#94a3b8"),
    hexFill: light ? v("--bg-raise", "#fdfcf9") : "#10131a",
    glyphInk: light ? v("--bg", "#f5f3ee") : "#0b0a08",
    sparkCore: light ? "#7c2d12" : "#fff8ee",
    spriteCore: light ? null : "#ffffff",
    minimapFill: light ? "rgba(32,28,20,0.06)" : "rgba(0,0,0,0.25)",
    font: v("--font", v("--font-body", "ui-sans-serif, system-ui, sans-serif")),
    mono: v("--mono", v("--font-mono", "ui-monospace, monospace")),
  };
}

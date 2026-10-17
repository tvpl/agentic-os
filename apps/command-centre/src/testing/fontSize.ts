/**
 * What a font size written in CSS or on a canvas comes to in CSS px. Shared by
 * the source readers (sizeScan: static, conservative) and the recording canvas
 * (canvasText: runtime), so both read a `pt`, `rem`, `em`, `%` or a keyword the
 * same way. No node imports: the recorder runs in jsdom.
 */

/** Sizes the browser knows by name. `smaller` depends on the parent: unbounded below. */
export const SIZE_KEYWORDS: Readonly<Record<string, number>> = {
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
  "xxx-large": 48,
};

/** Absolute units, in px. */
const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  rem: 16,
};

/**
 * `n` of `unit` in px, or null for a unit that cannot be turned into px here.
 * `em`, `%`, `ex` and `ch` are relative to the parent's size, `emBase` (the
 * source readers pass the floor, the smallest any parent may be; the recording
 * canvas passes the size of the canvas element). Viewport units count as 0, the
 * narrowest window. An empty unit is a bare number, which is px.
 */
export function toPx(n: number, unit: string, emBase: number): number | null {
  const u = unit.toLowerCase();
  if (u === "") return n;
  if (u in ABSOLUTE_UNITS) return n * ABSOLUTE_UNITS[u]!;
  if (u === "em") return n * emBase;
  if (u === "%") return (n / 100) * emBase;
  if (u === "ex" || u === "ch") return n * 0.5 * emBase;
  if (/^(s|l|d)?v(w|h|i|b|min|max)$|^cq(w|h|i|b|min|max)$/.test(u)) return 0;
  return null;
}

/** The units a canvas font size can carry, as a regex alternation (longest first). */
export const SIZE_UNITS = "px|pt|pc|rem|em|ex|ch|in|cm|mm|q|%";

const FONT_STYLE_WORDS =
  /^(normal|italic|oblique|small-caps|bold|bolder|lighter|\d{1,4}|(ultra-|extra-|semi-)?(condensed|expanded))$/i;

/**
 * The size of a canvas `font` string in CSS px, or an Error when it cannot be
 * read: a recorder that skipped what it cannot parse would let a text slip
 * through unmeasured, which is exactly what it exists to prevent.
 */
export function canvasFontPx(font: string, emBase = 16): number {
  const tokens = font.trim().split(/\s+/);
  let i = 0;
  while (
    i < tokens.length &&
    FONT_STYLE_WORDS.test(tokens[i]!) &&
    !/^\d+(\.\d+)?(px|pt|pc|rem|em|ex|ch|in|cm|mm|q|%)/i.test(tokens[i]!)
  )
    i++;
  const size = tokens[i]?.split("/")[0] ?? "";
  const family = tokens.slice(i + 1).join(" ");
  const fail = (why: string): never => {
    throw new Error(`cannot read the size of canvas font ${JSON.stringify(font)}: ${why}`);
  };
  if (!family && !tokens[i]?.includes("/")) return fail("no family after the size");
  const keyword = size.toLowerCase();
  if (keyword in SIZE_KEYWORDS) return SIZE_KEYWORDS[keyword]!;
  const m = /^(\d*\.?\d+)([a-z%]*)$/i.exec(size);
  if (!m || m[2] === "") return fail(`"${size}" is not a length with a unit`);
  const px = toPx(parseFloat(m[1]!), m[2]!, emBase);
  return px === null ? fail(`unit "${m[2]}" is not a font size unit`) : px;
}

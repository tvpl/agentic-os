/**
 * Reader of the CSS for "a state is never told by colour alone" (design.md,
 * Cor): every rule that styles a state (`[aria-pressed="true"]`, `.on`,
 * `.read`, `.off`, `.dimmed`, `.selected`, the status words `.ok`/`.bad`/
 * `.warn`…, `:checked`, `[open]`…) is grouped by the element it styles, and a
 * group that changes hue, opacity or a glow and nothing else has no mark a
 * person who cannot tell the hues apart could see.
 *
 * A mark is any other change: weight, an underline or strike-through, a bar
 * or ring (`box-shadow` with no blur), a border or fill the element did not
 * have outside the state (a recoloured one is not), a dash with butt caps, a
 * size, `display`, a `content` glyph. Values of one status whose marks have
 * the same shape in every colour (`.ok` and `.bad` both a filled disc) are
 * colour alone too. Hover, focus, press and `:disabled` are not states of the
 * data and are left out (a disabled control is exempt from contrast and
 * announced by the platform).
 */
import postcss from "postcss";
import { rel, selectorPieces } from "./sizeScan";

/** The status words a class can carry (`.ok`, `.bad`…): siblings that differ by one of them are values of one state. */
const STATUS = String.raw`\.(?:ok|bad|warn|warning|danger|err|error|failed|fail|done|paused|live|running|healthy|stale|pending|busy|alert|success|idle|blocked)(?![\w-])`;

/** A selector part that says "this element is in a state". */
const STATE = new RegExp(
  [
    String.raw`\[aria-(?:pressed|checked|selected|current|expanded|invalid|busy)(?:=["']?[\w-]+["']?)?\]`,
    String.raw`\[data-(?:state|active|status|selected|open|current)(?:=["']?[\w-]+["']?)?\]`,
    String.raw`\[open\]`,
    String.raw`\[class\*=["']?(?:active|selected|open|current|on|off)["']?\]`,
    String.raw`:checked`,
    String.raw`\.(?:on|active|selected|is-selected|is-active|is-on|is-open|current|open|expanded|read|unread|off|kind-off|dimmed)(?![\w-])`,
    STATUS,
    // the other tones of a status dot
    String.raw`\.dot\.(?:info|accent|dim)(?![\w-])`,
  ].join("|"),
);

/**
 * What counts as a mark: a change a person who cannot tell the hues apart can
 * see. Weight, style, underline or strike-through, a border, outline or hard
 * shadow (a bar or ring), a fill, a shape (transform, dash, width), a glyph.
 * Not marks: colour, opacity, a glow (a blurred shadow), a filter,
 * `pointer-events`, `z-index`, `cursor`, `transition`, a gradient image.
 */
const MARK_PROPS =
  /^(font-weight|font-style|text-decoration(-line|-style|-thickness)?|text-transform|border(-(top|right|bottom|left))?(-(width|style))?|outline(-(width|style|offset))?|background|background-color|transform|scale|rotate|stroke-width|clip-path|width|height|display|visibility|content)$/;

/**
 * What a state can change by hue alone. A group is a finding only when it has
 * one of these and no mark: a rule that changes only a transition or an
 * animation timing says nothing a person would miss.
 */
const COLOUR_PROPS =
  /^(color|opacity|fill|stroke|fill-opacity|stroke-opacity|stop-color|filter|text-shadow|box-shadow|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|-webkit-text-fill-color)$/;

/** A `box-shadow` is a mark only when one of its layers is hard: offset or spread, no blur (a bar or a ring, not a glow). */
function hardShadow(value: string): boolean {
  const layers: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of value) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      layers.push(cur);
      cur = "";
    } else cur += c;
  }
  layers.push(cur);
  return layers.some((layer) => {
    const lengths = layer
      .replace(/\([^)]*\)/g, " ") // colours: rgb(), var(), color-mix()
      .split(/\s+/)
      .filter((t) => /^-?(\d*\.?\d+)(px|em|rem)?$/.test(t))
      .map(parseFloat);
    if (lengths.length < 2) return false;
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return blur === 0 && (x !== 0 || y !== 0 || spread !== 0);
  });
}

/** The families whose shorthand can add a shape or only recolour the one the element already has. */
const RECOLOURABLE = /^(border(-(top|right|bottom|left))?|outline|background|background-color)$/;

/** A value that draws nothing. */
const NOTHING = /^\s*(none|0|0px|transparent|initial|unset|inherit)?\s*$/i;

/** The state tokens taken out of a selector: what the element is when it is not in the state. */
function withoutState(selector: string): string {
  return selector
    .replace(/::[\w-]+/g, "")
    .replace(new RegExp(STATE.source, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A selector split into the part before its last compound and the simple selectors of that compound. */
function splitCompound(selector: string): { prefix: string; simples: Set<string> } {
  const m = /^(.*?)([^\s>+~]+)$/.exec(selector);
  const prefix = m?.[1] ?? "";
  return { prefix, simples: new Set((m?.[2] ?? "").match(/[.#]?[\w-]+/g) ?? []) };
}

/**
 * What the element declares outside the state: every plain rule with the same ancestors whose last compound
 * is part of the element's (`.rt-dot` is part of `.rt-dot.past`), merged.
 */
function baseDeclarations(sources: { file: string; css: string }[]) {
  const plain: { prefix: string; simples: Set<string>; props: Map<string, string> }[] = [];
  for (const { file, css } of sources)
    postcss.parse(css, { from: file }).walkRules((rule) => {
      for (const raw of rule.selectors) {
        const selector = raw.replace(/\s+/g, " ").trim();
        if (/[:[]/.test(selector)) continue;
        const props = new Map<string, string>();
        rule.each((d) => {
          if (d.type === "decl") props.set(d.prop.toLowerCase(), d.value);
        });
        plain.push({ ...splitCompound(selector), props });
      }
    });
  return (selector: string): Map<string, string> => {
    const { prefix, simples } = splitCompound(selector);
    const merged = new Map<string, string>();
    for (const rule of plain)
      if (rule.prefix === prefix && [...rule.simples].every((x) => simples.has(x)))
        for (const [k, v] of rule.props) merged.set(k, v);
    return merged;
  };
}

/** Whether the element already draws, outside the state, something in this family (a border, an outline, a fill). */
function drawsAlready(base: Map<string, string> | undefined, prop: string): boolean {
  if (!base) return false;
  const family = prop.startsWith("outline") ? "outline" : prop.startsWith("border") ? "border" : "background";
  return [...base].some(([p, v]) => p.startsWith(family) && !/color$/.test(p) && !NOTHING.test(v));
}

/** A mark as a shape, colours out: `1px solid var(--ok)` and `1px solid var(--danger)` are the same shape. */
function shape(selector: string, prop: string, value: string): string {
  const pseudo = /::[\w-]+/.exec(selector)?.[0] ?? "";
  const plain = value
    .replace(/var\(--[\w-]+\)/g, "C")
    .replace(/color-mix\([^()]*\)/g, "C")
    .replace(/\s+/g, " ")
    .trim();
  return `${pseudo} ${prop}: ${plain}`;
}

export interface StateGroup {
  /** The selector up to the element that carries the state, without pseudo-elements: the group's name. */
  key: string;
  /** Where the first rule of the group is. */
  at: string;
  marked: boolean;
  /** Changes hue, strength or glow: the group is only a finding if it does and is not marked. */
  colourful: boolean;
  props: Set<string>;
  /** The marks the group draws, with the colours taken out: what a sibling state would have to differ by. */
  shapes: Set<string>;
}

export function stateGroups(sources: { file: string; css: string }[]): StateGroup[] {
  const groups = new Map<string, StateGroup>();
  const baseOf = baseDeclarations(sources);
  for (const { file, css } of sources)
    postcss.parse(css, { from: file }).walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as { name: string }).name))
        return;
      for (const raw of rule.selectors) {
        const selector = raw.replace(/\s+/g, " ").trim();
        if (/:(hover|focus|focus-visible|focus-within|active|disabled)\b/.test(selector)) continue;
        const parts = selectorPieces(selector.replace(/::[\w-]+/g, "")).reduce<string[]>((acc, piece) => {
          // a combinator starts the part that follows it (`a > b` is `a`, ` > b`)
          if (/^[>+~]$/.test(piece)) acc.push(` ${piece}`);
          else if (acc.length && /^ [>+~]$/.test(acc[acc.length - 1]!)) acc[acc.length - 1] += ` ${piece}`;
          else acc.push(acc.length ? ` ${piece}` : piece);
          return acc;
        }, []);
        const at = parts.findIndex((p) => STATE.test(p));
        if (at < 0) continue;
        const key = parts
          .slice(0, at + 1)
          .join("")
          .trim();
        const group = groups.get(key) ?? {
          key,
          at: `${rel(file)}:${rule.source?.start?.line}`,
          marked: false,
          colourful: false,
          props: new Set<string>(),
          shapes: new Set<string>(),
        };
        const isDot = /^\.dot\./.test(key);
        let mark = false;
        let content = "";
        // What the element is outside the state: a border or fill it already has is recoloured, not added.
        const plain = baseOf(withoutState(selector));
        let dashed = false;
        let butt = false;
        rule.each((d) => {
          if (d.type !== "decl" || d.prop.startsWith("--")) return;
          const prop = d.prop.toLowerCase();
          group.props.add(prop);
          if (COLOUR_PROPS.test(prop)) group.colourful = true;
          if (prop === "content") content = d.value.trim();
          else if (prop === "box-shadow") mark ||= hardShadow(d.value);
          else if (prop === "stroke-dasharray") dashed ||= !NOTHING.test(d.value);
          else if (prop === "stroke-linecap") butt ||= d.value.trim() === "butt";
          // a dot is a fill and nothing else: its background is its colour, not a mark
          else if (isDot && /^background/.test(prop)) return;
          else if (RECOLOURABLE.test(prop) && drawsAlready(plain, prop)) return;
          else if (MARK_PROPS.test(prop)) {
            const drawn = !RECOLOURABLE.test(prop) || !NOTHING.test(d.value);
            mark ||= drawn;
            if (drawn) group.shapes.add(shape(selector, prop, d.value));
          }
          if (prop === "box-shadow" && hardShadow(d.value)) group.shapes.add(shape(selector, prop, d.value));
        });
        if (content && content !== "none") group.shapes.add(shape(selector, "content", content));
        // A dash is seen only where the caps do not bridge its gaps.
        if (dashed && butt) mark = true;
        // A pseudo-element marks its element when it draws something: a glyph, or a shape with a fill, border or size.
        if (/::(before|after)/.test(selector)) {
          if (content !== "none" && (content.replace(/["']/g, "") !== "" || mark)) group.marked = true;
        } else if (mark) group.marked = true;
        groups.set(key, group);
      }
    });
  // Values of one status (`.ok`, `.bad`) whose marks are the same shape in every colour are told by colour alone.
  const siblings = new Map<string, StateGroup[]>();
  for (const g of groups.values()) {
    const m = new RegExp(`(${STATUS})(?=[^.[]*$)`).exec(g.key);
    if (!m) continue;
    const family = g.key.slice(0, m.index) + "\u00a7" + g.key.slice(m.index + m[0].length);
    siblings.set(family, [...(siblings.get(family) ?? []), g]);
  }
  for (const family of siblings.values()) {
    const signature = (g: StateGroup) => [...g.shapes].sort().join("|");
    if (family.length > 1 && family.every((g) => signature(g) === signature(family[0]!)))
      for (const g of family) g.marked = false;
  }
  return [...groups.values()];
}

/** The groups that tell their state by colour alone, minus the ones `exempt` explains. */
export function colourOnlyStates(
  sources: { file: string; css: string }[],
  exempt: Record<string, string>,
): string[] {
  return stateGroups(sources)
    .filter((g) => g.colourful && !g.marked && !(g.key in exempt))
    .map((g) => `${g.at} ${g.key} { ${[...g.props].join(", ")} }`);
}

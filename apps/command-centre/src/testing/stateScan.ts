/**
 * Reader of the CSS for "a state is never told by colour alone" (design.md,
 * Cor): every rule that styles a state (`[aria-pressed="true"]`, `.on`,
 * `.read`, `.off`, `.dimmed`, `.selected`…) is grouped by the element it
 * styles, and a group whose declarations only change hue, opacity or a glow
 * has no mark a person who cannot tell the hues apart could see.
 *
 * A mark is any other change: weight, an underline or strike-through, a ring
 * or bar (`box-shadow`, `border`, `outline`), a fill (`background`), a size,
 * a `content` glyph. Hover, focus, press and `:disabled` are not states of
 * the data and are left out (a disabled control is exempt from contrast and
 * announced by the platform).
 */
import postcss from "postcss";
import { rel } from "./sizeScan";

/** A selector part that says "this element is in a state". */
const STATE = new RegExp(
  [
    String.raw`\[aria-(?:pressed|checked|selected|current|expanded)(?:=["']?[\w-]+["']?)?\]`,
    String.raw`\[data-(?:state|active|status|selected|open|current)(?:=["']?[\w-]+["']?)?\]`,
    String.raw`\.(?:on|active|selected|is-selected|is-active|current|open|expanded|read|off|kind-off|dimmed)(?![\w-])`,
    // status dots: a dot that is only a colour
    String.raw`\.dot\.(?:ok|warn|danger|info|accent|dim)(?![\w-])`,
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
  /^(font-weight|font-style|text-decoration(-line|-style|-thickness)?|text-transform|border(-(top|right|bottom|left))?(-(width|style))?|outline(-(width|style|offset))?|background|background-color|transform|scale|rotate|stroke-dasharray|stroke-width|clip-path|width|height|display|visibility|content)$/;

/**
 * What a state can change by hue alone. A group is a finding only when it has
 * one of these and no mark: a rule that changes only a transition or an
 * animation timing says nothing a person would miss.
 */
const COLOUR_PROPS =
  /^(color|opacity|fill|stroke|fill-opacity|stroke-opacity|stop-color|filter|text-shadow|box-shadow|background(-color|-image)?|border(-(top|right|bottom|left))?-color|outline-color|-webkit-text-fill-color)$/;

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

export interface StateGroup {
  /** The selector up to the element that carries the state, without pseudo-elements: the group's name. */
  key: string;
  /** Where the first rule of the group is. */
  at: string;
  marked: boolean;
  /** Changes hue, strength or glow: the group is only a finding if it does and is not marked. */
  colourful: boolean;
  props: Set<string>;
}

export function stateGroups(sources: { file: string; css: string }[]): StateGroup[] {
  const groups = new Map<string, StateGroup>();
  for (const { file, css } of sources)
    postcss.parse(css, { from: file }).walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as { name: string }).name))
        return;
      for (const raw of rule.selectors) {
        const selector = raw.replace(/\s+/g, " ").trim();
        if (/:(hover|focus|focus-visible|focus-within|active|disabled)\b/.test(selector)) continue;
        const parts = selector.replace(/::[\w-]+/g, "").split(/(?=[\s>+~])/);
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
        };
        const isDot = /^\.dot\./.test(key);
        let mark = false;
        let content = "";
        rule.each((d) => {
          if (d.type !== "decl" || d.prop.startsWith("--")) return;
          const prop = d.prop.toLowerCase();
          group.props.add(prop);
          if (COLOUR_PROPS.test(prop)) group.colourful = true;
          if (prop === "content") content = d.value.trim();
          else if (prop === "box-shadow") mark ||= hardShadow(d.value);
          // a dot is a fill and nothing else: its background is its colour, not a mark
          else if (MARK_PROPS.test(prop) && !(isDot && /^background/.test(prop))) mark ||= true;
        });
        // A pseudo-element marks its element when it draws something: a glyph, or a shape with a fill, border or size.
        if (/::(before|after)/.test(selector)) {
          if (content !== "none" && (content.replace(/["']/g, "") !== "" || mark)) group.marked = true;
        } else if (mark) group.marked = true;
        groups.set(key, group);
      }
    });
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

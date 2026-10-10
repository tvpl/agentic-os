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
const STATE =
  /\[aria-(pressed|checked|selected|current)(="(true|page|step)")?\]|\.(on|active|selected|read|off|kind-off|dimmed|current|is-active|open)(?![\w-])/;

/** Declarations that change hue, strength or glow only. */
const COLOUR_ONLY = new Set([
  "color",
  "opacity",
  "fill",
  "stroke",
  "accent-color",
  "caret-color",
  "text-shadow",
  "filter",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "background-color",
  "transition",
  "cursor",
]);

export interface StateGroup {
  /** The selector up to the element that carries the state, without pseudo-elements: the group's name. */
  key: string;
  /** Where the first rule of the group is. */
  at: string;
  marked: boolean;
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
          props: new Set<string>(),
        };
        // A pseudo-element's `content` is a mark of its own element.
        if (/::(before|after)/.test(selector)) group.marked = true;
        rule.each((d) => {
          if (d.type !== "decl" || d.prop.startsWith("--")) return;
          group.props.add(d.prop);
          if (!COLOUR_ONLY.has(d.prop.toLowerCase())) group.marked = true;
        });
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
    .filter((g) => !g.marked && !(g.key in exempt))
    .map((g) => `${g.at} ${g.key} { ${[...g.props].join(", ")} }`);
}

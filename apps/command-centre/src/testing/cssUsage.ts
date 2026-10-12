/**
 * Reader of the stylesheets for the legacy guards (`legacy.css.test.ts`,
 * .specs/features/limpeza-legado, C4 to C6): which classes a selector names,
 * which `@keyframes` and custom properties a file defines, and which of those the
 * rules and the production source refer to. postcss reads the CSS as a tree.
 */
import postcss, { type Root } from "postcss";
import { spelledIn, type Spelled, type Tree } from "./sourceGraph";

export interface Defined {
  file: string;
  name: string;
  line: number;
}

/** A selector with the parts that do not name a class that must exist removed: attributes, strings and `:not(…)`. */
function positive(selector: string): string {
  let out = selector.replace(/"[^"]*"|'[^']*'/g, "").replace(/\[[^\]]*\]/g, "");
  // Balanced `:not( … )` groups, innermost first.
  for (let guard = 0; guard < 8 && /:not\(/.test(out); guard++) out = out.replace(/:not\([^()]*\)/g, "");
  return out;
}

/** The class names a stylesheet's rules select (a class in `:not()` or in an attribute selector is not one that must exist). */
export function classesDefined(file: string, css: string): Defined[] {
  const root = postcss.parse(css, { from: file });
  const out: Defined[] = [];
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as postcss.AtRule).name)) return;
    for (const selector of rule.selectors) {
      for (const m of positive(selector).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g))
        out.push({ file, name: m[1]!, line: rule.source?.start?.line ?? 0 });
    }
  });
  return out;
}

export function keyframesDefined(file: string, css: string): Defined[] {
  const out: Defined[] = [];
  postcss.parse(css, { from: file }).walkAtRules(/keyframes$/i, (a) => {
    out.push({ file, name: a.params.trim(), line: a.source?.start?.line ?? 0 });
  });
  return out;
}

export function propertiesDefined(file: string, css: string): Defined[] {
  const out: Defined[] = [];
  postcss.parse(css, { from: file }).walkDecls(/^--/, (d) => {
    out.push({ file, name: d.prop, line: d.source?.start?.line ?? 0 });
  });
  return out;
}

/** Every `var(--x)` any stylesheet reads, and every word any declaration value spells (the names an animation can take). */
export function referencedInCss(roots: Root[]): { vars: Set<string>; animations: Set<string> } {
  const vars = new Set<string>();
  const animations = new Set<string>();
  for (const root of roots)
    root.walkDecls((d) => {
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) vars.add(m[1]!);
      // Any word of any value: a token such as `--ui-sheet-in: modal-in 160ms` hands the name to a later `animation: var(--ui-sheet-in)`.
      for (const w of d.value.match(/[A-Za-z_][\w-]*/g) ?? []) animations.add(w);
    });
  return { vars, animations };
}

/** What the production source spells, split so that `.a.b`, `a:b` and `#a` also yield `a` and `b`. */
export interface Spoken extends Spelled {
  pieces: Set<string>;
}

export function spokenIn(tree: Tree, files: Iterable<string>, extra: readonly string[] = []): Spoken {
  const spelled = spelledIn(tree, files);
  const pieces = new Set<string>();
  const split = (w: string) => {
    for (const p of w.split(/[.:#]/)) if (p) pieces.add(p);
  };
  for (const w of spelled.words) split(w);
  // Words spelled outside TypeScript: the two HTML pages.
  for (const text of extra) for (const m of text.matchAll(/[A-Za-z0-9_$@.:#-]+/g)) split(m[0]);
  return { ...spelled, pieces };
}

/** Is a class, an animation or a property name spelled by the production source, whole or by prefix/suffix? */
export function isSpoken(spoken: Spoken, name: string): boolean {
  return (
    spoken.words.has(name) ||
    spoken.pieces.has(name) ||
    [...spoken.prefixes].some((p) => p.length > 1 && name.startsWith(p)) ||
    [...spoken.suffixes].some((s) => s.length > 2 && name.endsWith(s))
  );
}

/** Map a defined name to the files that define it, to print a finding. */
export function summary(found: Defined[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const d of found)
    (by.get(d.name) ?? by.set(d.name, new Set()).get(d.name)!).add(`${d.file}:${d.line}`);
  return [...by].map(([name, where]) => `${name} (${[...where].join(", ")})`).sort();
}

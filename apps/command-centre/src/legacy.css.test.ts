/**
 * The CSS nobody asks for (.specs/features/limpeza-legado, C4, C5, C6): a class no production source spells,
 * a `@keyframes` no rule calls, a custom property nobody reads. The readers are `testing/cssUsage.ts` (postcss)
 * and `testing/sourceGraph.ts` (the TypeScript syntax tree).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
  classesDefined,
  isSpoken,
  keyframesDefined,
  propertiesDefined,
  referencedInCss,
  spokenIn,
  summary,
  type Defined,
} from "./testing/cssUsage";
import { SRC, loadTree, productionFiles, type Tree } from "./testing/sourceGraph";

const tree = loadTree();
const htmlPages = ["index.html", "gallery.html"].map((f) => readFileSync(join(SRC, "..", f), "utf8"));
const spoken = spokenIn(tree, productionFiles(tree), htmlPages);
const cssFiles = [...tree.keys()].filter((f) => f.endsWith(".css"));

/**
 * Classes no production source spells and that stay, with the reason: an end-to-end spec builds the element
 * itself, so the rule is what the spec exercises.
 */
const BUILT_BY_A_TEST: Record<string, string> = {
  "display-digits":
    "`tests/e2e/a11y.spec.ts` puts the class on an element of the gallery and reads the colour the light and the JARVIS tokens give it (design-system, AC 7); the rule is the proof's subject",
};

/** Custom properties nobody reads and that stay, with the reason. */
const PINNED_PROPERTIES: Record<string, string> = {
  "--fs-hero":
    "the last step of the type scale that `design-system/design.md` names and `typography.test.ts` holds to the floor",
};

const sourceOf = (tree: Tree) => [...tree].filter(([file]) => file.endsWith(".css"));
const all = (read: (file: string, css: string) => Defined[]) =>
  sourceOf(tree).flatMap(([file, css]) => read(file, css));

describe("C4 the classes of the stylesheets", () => {
  it("C4 every class a selector names is spelled by the production source, or is built by a test and listed", () => {
    const orphans = all(classesDefined).filter(
      (d) => !isSpoken(spoken, d.name) && !(d.name in BUILT_BY_A_TEST),
    );
    expect(summary(orphans)).toEqual([]);
  });

  it("C4 the closed list has the one class, and the class is in a stylesheet", () => {
    expect(Object.keys(BUILT_BY_A_TEST)).toEqual(["display-digits"]);
    const defined = new Set(all(classesDefined).map((d) => d.name));
    for (const name of Object.keys(BUILT_BY_A_TEST)) expect(defined.has(name), name).toBe(true);
    expect(cssFiles.length).toBeGreaterThan(15);
  });
});

describe("C5 the animations and the custom properties", () => {
  const roots = sourceOf(tree).map(([file, css]) => postcss.parse(css, { from: file }));
  const { vars, animations } = referencedInCss(roots);

  it("C5 every @keyframes is named by an animation or by the production source", () => {
    const orphans = all(keyframesDefined).filter((d) => !animations.has(d.name) && !isSpoken(spoken, d.name));
    expect(summary(orphans)).toEqual([]);
  });

  it("C5 the pinned custom property is still defined, so the pin is not stale", () => {
    const defined = new Set(all(propertiesDefined).map((d) => d.name));
    for (const name of Object.keys(PINNED_PROPERTIES)) expect(defined.has(name), name).toBe(true);
  });

  it("C5 every custom property a stylesheet defines is read by a var() or spelled by the production source", () => {
    const orphans = all(propertiesDefined).filter(
      (d) => !vars.has(d.name) && !isSpoken(spoken, d.name) && !(d.name in PINNED_PROPERTIES),
    );
    expect(summary(orphans)).toEqual([]);
  });
});

describe("C6 the reader of the stylesheets", () => {
  const css = (text: string) => classesDefined("t.css", text).map((d) => d.name);

  it("C6 finds a class in a simple, a compound, a listed, an @media, an :is() and a :not() selector", () => {
    expect(css(".a { x: 1 }")).toEqual(["a"]);
    expect(css(".a.b > .c:hover { x: 1 }")).toEqual(["a", "b", "c"]);
    expect(css(".a, .b .c { x: 1 }")).toEqual(["a", "b", "c"]);
    expect(css("@media (min-width: 1px) { .a { x: 1 } }")).toEqual(["a"]);
    expect(css(":is(.a, .b) .c { x: 1 }")).toEqual(["a", "b", "c"]);
    // A class that only says "not this" does not have to exist for the rule to apply.
    expect(css(".a:not(.b):not(.c .d) { x: 1 }")).toEqual(["a"]);
    // Nor does one inside an attribute selector or a string.
    expect(css('.a[class*="b"], .c[data-x=".d"] { x: 1 }')).toEqual(["a", "c"]);
    // A keyframe step is not a class.
    expect(css("@keyframes k { from { x: 1 } to { x: 2 } }")).toEqual([]);
  });

  it("C6 treats a dynamic prefix, a suffix and a class a test builds as the list says", () => {
    const t: Tree = new Map([
      [
        "main.tsx",
        'export const a = (n: number) => `bl-${n}`; export const b = (k: string) => `${k}-hops`; export const c = "x." + k;',
      ],
    ]);
    const s = spokenIn(t, ["main.tsx"]);
    expect(isSpoken(s, "bl-3")).toBe(true);
    expect(isSpoken(s, "any-hops")).toBe(true);
    expect(isSpoken(s, "x.y")).toBe(true);
    expect(isSpoken(s, "bl")).toBe(false);
    expect(isSpoken(s, "other")).toBe(false);
    expect(Object.keys(BUILT_BY_A_TEST).every((n) => !isSpoken(spoken, n))).toBe(true);
  });

  it("C6 finds a @keyframes and a custom property that nothing reads", () => {
    const text =
      ":root { --used: 1; --lost: 2 } .a { color: var(--used); animation: spin 1s, fade 2s } @keyframes spin { to { x: 1 } } @keyframes lost { to { x: 1 } }";
    const roots = [postcss.parse(text)];
    const { vars, animations } = referencedInCss(roots);
    expect(
      keyframesDefined("t.css", text)
        .map((d) => d.name)
        .filter((n) => !animations.has(n)),
    ).toEqual(["lost"]);
    expect(
      propertiesDefined("t.css", text)
        .map((d) => d.name)
        .filter((n) => !vars.has(n)),
    ).toEqual(["--lost"]);
  });
});

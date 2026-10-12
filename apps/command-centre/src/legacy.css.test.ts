/**
 * The CSS nobody asks for (.specs/features/limpeza-legado, C4, C5, C6): a class no production element carries,
 * a `@keyframes` no rule calls, a custom property nobody reads. The readers are `testing/cssUsage.ts` (postcss)
 * and `testing/sourceGraph.ts` (the TypeScript syntax tree).
 *
 * A class counts as carried only where the source puts a class on an element (`className`, `class="…"`,
 * `classList`, `clsx`-style helpers, a variable or table of classes the same file declares); a word of a sentence,
 * a translation key or an element id that happens to spell the name does not (round 1, F1). What the scan cannot
 * see is listed in `SET_BY_A_VALUE`; the limits are written in `checks.md` (C4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
  classUsageIn,
  classesDefined,
  isSpoken,
  isUsedClass,
  keyframesDefined,
  propertiesDefined,
  referencedInCss,
  spokenIn,
  summary,
  type Defined,
} from "./testing/cssUsage";
import { SRC, loadTree, productionFiles, spelledIn, type Tree } from "./testing/sourceGraph";

const tree = loadTree();
const htmlPages = ["index.html", "gallery.html"].map((f) => readFileSync(join(SRC, "..", f), "utf8"));
const spoken = spokenIn(tree, productionFiles(tree), htmlPages);
const carried = classUsageIn(tree, productionFiles(tree), htmlPages);
const cssFiles = [...tree.keys()].filter((f) => f.endsWith(".css"));

/**
 * Classes no production source spells and that stay, with the reason: an end-to-end spec builds the element
 * itself, so the rule is what the spec exercises.
 */
const BUILT_BY_A_TEST: Record<string, string> = {
  "display-digits":
    "`tests/e2e/a11y.spec.ts` puts the class on an element of the gallery and reads the colour the light and the JARVIS tokens give it (design-system, AC 7); the rule is the proof's subject",
};

/**
 * Classes an element carries but whose name the scan cannot read where the class is put: it arrives as a value
 * (a status, a kind, a phase, a variant) from a prop, a parameter or another file. Each names the file that spells
 * the value; the guard checks the class is still defined, is still not found by the scan (else the entry is
 * needless) and that the file still spells it (else the value is gone and so is the element).
 */
const SET_BY_A_VALUE: Record<string, { file: string; why: string }> = {
  completed: {
    file: "desktop/widgets/MissionWidget.tsx",
    why: "`mission-card ${o.status}`: the status of an objective",
  },
  connecting: { file: "App.tsx", why: "`boot-screen ${phase}`: the phase `BootScreen` is given" },
  ready: { file: "App.tsx", why: "`boot-screen ${phase}`: the phase `BootScreen` is given" },
  hunk: {
    file: "runs/diff.ts",
    why: "`diff-line ${line.kind}` in `runs/FilesChanged.tsx`: the kind of a diff line",
  },
  "markdown-link": { file: "brain/engine/world.ts", why: "`brain-kind-swatch ${k}`: `EDGE_KINDS`" },
  related: { file: "brain/engine/world.ts", why: "`brain-kind-swatch ${k}`: `EDGE_KINDS`" },
  "same-dir": { file: "brain/engine/world.ts", why: "`brain-kind-swatch ${k}`: `EDGE_KINDS`" },
  "same-area": { file: "brain/engine/world.ts", why: "`brain-kind-swatch ${k}`: `EDGE_KINDS`" },
  other: { file: "brain/engine/world.ts", why: "`brain-kind-swatch ${k}`: `EDGE_KINDS`" },
  outline: {
    file: "components/primitives.tsx",
    why: "`Button`'s `variant` (`ButtonVariant`) is a class of the button",
  },
  over: {
    file: "desktop/budget.ts",
    why: "`cc static budget ${budget.tone}` in `ConsoleControls.tsx`: `BudgetTone`",
  },
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
  const known = (name: string) =>
    isUsedClass(carried, name) || name in BUILT_BY_A_TEST || name in SET_BY_A_VALUE;

  it("C4 every class a selector names is carried by an element the production source builds, or is listed", () => {
    const orphans = all(classesDefined).filter((d) => !known(d.name));
    expect(summary(orphans)).toEqual([]);
  });

  it("C4 a class that only a sentence, an id or a translation key spells is not a class an element carries", () => {
    // B6 and B7 of the round 1 report: `run-${short}` and `app-${n}` are ids, `briefing` and `empty` are words.
    for (const name of [
      "run-zzdead",
      "briefing",
      "empty",
      "bell",
      "decision",
      "app-rail",
      "quick-hint",
      "modal-hint",
    ])
      expect(isUsedClass(carried, name), name).toBe(false);
    // …and the classes the interface does carry are found: whole, by a delimited head, built in a table.
    for (const name of [
      "btn",
      "badge",
      "cons",
      "brain2",
      "tone-ok",
      "rts-lane",
      "k-markdown-link",
      "model-opus",
    ])
      expect(isUsedClass(carried, name), name).toBe(true);
  });

  it("C4 the lists are honest: each class is defined, is not read by the scan, and its value is still spelled", () => {
    const defined = new Set(all(classesDefined).map((d) => d.name));
    for (const name of [...Object.keys(BUILT_BY_A_TEST), ...Object.keys(SET_BY_A_VALUE)]) {
      expect(defined.has(name), `${name} is no longer in a stylesheet`).toBe(true);
      expect(isUsedClass(carried, name), `${name} is read by the scan: drop the entry`).toBe(false);
    }
    for (const [name, { file }] of Object.entries(SET_BY_A_VALUE))
      expect(spelledIn(tree, [file]).words.has(name), `${file} no longer spells ${name}`).toBe(true);
    expect(Object.keys(BUILT_BY_A_TEST)).toEqual(["display-digits"]);
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

  it("C6 reads a class where one is put, and only there (F1)", () => {
    const read = (code: string) => classUsageIn(new Map([["x.tsx", code]]), ["x.tsx"]);
    const has = (u: ReturnType<typeof read>, ...names: string[]) => names.map((n) => isUsedClass(u, n));
    // The class contexts: a literal, a branch, a template with a glued tail, a helper, classList, a table, a function.
    expect(has(read('const a = <i className="p q" />;'), "p", "q", "r")).toEqual([true, true, false]);
    expect(has(read('const a = <i className={on ? "p" : "q"} />;'), "p", "q")).toEqual([true, true]);
    expect(has(read("const a = <i className={`p${on ? ' q' : ''}`} />;"), "p", "q")).toEqual([true, true]);
    expect(has(read('const a = clsx("p", { q: on });'), "p", "q")).toEqual([true, false]);
    expect(has(read('el.classList.add("p"); el.className = "q";'), "p", "q")).toEqual([true, true]);
    expect(has(read('const K = { a: "p", b: "q" }; const a = <i className={K[k]} />;'), "p", "q")).toEqual([
      true,
      true,
    ]);
    expect(
      has(read('const f = (k) => (k === "z" ? "p" : "q"); const a = <i className={f(k)} />;'), "p", "q", "z"),
    ).toEqual([true, true, false]);
    expect(
      has(read('const { t } = g(); function g() { return { t: "p" }; } const a = <i className={t} />;'), "p"),
    ).toEqual([true]);
    expect(has(read('const h = `<i class="p q"></i>`;'), "p", "q")).toEqual([true, true]);
    // A head or a tail needs its delimiter: `pill-${tone}` covers `pill-ok`, `run${n}` covers nothing but `run`.
    const dyn = read("const a = <i className={`pill-${t} ${s}-open run${n}`} />;");
    expect(has(dyn, "pill-ok", "pill-", "x-open", "-open", "run", "run-1", "run7")).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
    // What is not a class: a sentence, a key, an id, a comparison, a query.
    const not = read(
      'const id = `app-${n}`; const k = t("shell.empty"); const s = "bell"; const w = <p title="deck">decision</p>; const c = <i className={kind === "agenda" ? "p" : "q"} id={id} />; document.querySelector(".quick-hint");',
    );
    expect(has(not, "app-1", "empty", "bell", "deck", "decision", "agenda", "quick-hint")).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(not.queried.has("quick-hint")).toBe(true);
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

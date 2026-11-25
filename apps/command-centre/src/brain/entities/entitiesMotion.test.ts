// @vitest-environment jsdom
/**
 * The two views' stylesheets (.specs/features/cerebro-entidades-resumos, C131, C132; design.md "Movimento"): every
 * selector of `entities.css` and `summaries.css` names the view's root class in its first compound, and the root rule
 * waits for a marker child (`:has(> .ent-cols)`, `:has(> .sum-cols)`) that no other screen has, so the stylesheets
 * restyle no other screen (L-076); the entity panel and the open summary enter with `opacity` alone in 200 ms, every
 * animation and transition is inside `@media (prefers-reduced-motion: no-preference)`, so with `reduce` nothing moves,
 * and the views move nothing from script but the 150 ms leaving of an ignored row, which `reduce` skips.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { loadTree } from "../../testing/sourceGraph";

const VIEWS = [
  { name: "entities", root: "ent-view", marker: "ent-cols", css: "entities.css", panel: "ent-panel-in" },
  {
    name: "summaries",
    root: "sum-view",
    marker: "sum-cols",
    css: "../summaries/summaries.css",
    panel: "sum-panel-in",
  },
] as const;
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

/** The first compound selector of `selector` (up to the first combinator outside brackets and parentheses). */
function firstCompound(selector: string): string {
  let depth = 0;
  const s = selector.trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) return s.slice(0, i);
  }
  return s;
}
/** Whether the first compound of `selector` names the class `root` itself (not in a pseudo-class or an attribute). */
function scoped(selector: string, root: string): boolean {
  const own = firstCompound(selector).replace(/\([^)]*\)|\[[^\]]*\]/g, "");
  return [...own.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].some((m) => m[1] === root);
}
/** Every selector of `css`'s style rules (each member of each list) not scoped under `.root`. */
function unscoped(css: string, root: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkRules((r) => {
    if (r.parent?.type === "atrule" && /keyframes$/.test((r.parent as postcss.AtRule).name)) return;
    for (const sel of r.selectors) if (!scoped(sel, root)) out.push(sel);
  });
  return out;
}
/** The `animation`/`transition` declarations not inside `@media (prefers-reduced-motion: no-preference)`. */
function motionOutsideNoPreference(css: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkDecls(/^(animation|transition)(-[a-z-]+)?$/, (d) => {
    for (let p: postcss.Container | postcss.Document | undefined = d.parent; p; p = p.parent)
      if (
        p.type === "atrule" &&
        (p as postcss.AtRule).name === "media" &&
        /prefers-reduced-motion:\s*no-preference/.test((p as postcss.AtRule).params)
      )
        return;
    out.push(`${(d.parent as postcss.Rule).selector} { ${d.prop}: ${d.value} }`);
  });
  return out;
}
/** The declarations of `selector` inside the no-preference block of `css`. */
function inMotion(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkAtRules("media", (m) => {
    if (!/no-preference/.test(m.params)) return;
    m.walkRules((r) => {
      if (r.selector === selector) r.walkDecls((d) => void (out[d.prop] = d.value));
    });
  });
  return out;
}
function keyframes(css: string, name: string): Array<[string, Record<string, string>]> {
  const out: Array<[string, Record<string, string>]> = [];
  postcss.parse(css).walkAtRules("keyframes", (k) => {
    if (k.params !== name) return;
    k.walkRules((r) => {
      const decls: Record<string, string> = {};
      r.walkDecls((d) => void (decls[d.prop] = d.value));
      out.push([r.selector, decls]);
    });
  });
  return out;
}

describe("C131 the stylesheets change no other screen", () => {
  it("C131 the reader finds an unscoped selector and leaves the scoped ones", () => {
    expect(unscoped(".ent-cols { display: grid }", "ent-view")).toEqual([".ent-cols"]);
    expect(
      unscoped(".x .ent-view, .ent-views .y, :has(.ent-view) .z, .z.ent-viewer { color: red }", "ent-view"),
    ).toEqual([".x .ent-view", ".ent-views .y", ":has(.ent-view) .z", ".z.ent-viewer"]);
    expect(
      unscoped(".ent-view:has(> .ent-cols), .ent-view .a, .ent-view[data-open] .b { margin: 0 }", "ent-view"),
    ).toEqual([]);
    expect(
      unscoped(
        "@media (max-width: 1px) { .ent-cols { margin: 0 } } @keyframes k { from { opacity: 0 } }",
        "ent-view",
      ),
    ).toEqual([".ent-cols"]);
  });

  for (const v of VIEWS) {
    const css = read(v.css);

    it(`C131 every selector of ${v.css}, in every rule's selector list, names .${v.root} in its first compound`, () => {
      let selectors = 0;
      postcss.parse(css).walkRules((r) => {
        if (!(r.parent?.type === "atrule" && /keyframes$/.test((r.parent as postcss.AtRule).name)))
          selectors += r.selectors.length;
      });
      expect(selectors).toBeGreaterThan(30);
      expect(unscoped(css, v.root)).toEqual([]);
    });

    it(`C131 the root rule of ${v.css} waits for its marker child: .${v.root}:has(> .${v.marker}) holds the root's own layout`, () => {
      const roots: string[] = [];
      postcss.parse(css).walkRules((r) => {
        for (const sel of r.selectors) if (sel === `.${v.root}`) roots.push(sel);
      });
      expect(roots, "a bare root selector would restyle any element that carries the class").toEqual([]);
      const own = new Set<string>();
      postcss.parse(css).walkRules((r) => {
        for (const sel of r.selectors) if (sel === `.${v.root}:has(> .${v.marker})`) own.add(sel);
      });
      expect([...own]).toEqual([`.${v.root}:has(> .${v.marker})`]);
    });

    it(`C131 no other screen has the marker .${v.marker} nor the root .${v.root}: only the ${v.name} folder and its stylesheet name them`, () => {
      const tree = loadTree();
      const hits = new Set<string>();
      for (const [file, text] of tree) {
        if (/\.test\./.test(file)) continue;
        const folder = file.startsWith(`brain/${v.name}/`);
        for (const cls of [v.marker, v.root])
          if (new RegExp(`(?<![\\w-])${cls}(?![\\w-])`).test(text) && !folder) hits.add(`${file}: ${cls}`);
      }
      expect([...hits]).toEqual([]);
      const own = [...tree.keys()].filter(
        (f) => f.startsWith(`brain/${v.name}/`) && /\.tsx$/.test(f) && !/test/.test(f),
      );
      expect(
        own.some((f) => new RegExp(`className="${v.root}"`).test(tree.get(f)!)),
        "the view's component carries the root class",
      ).toBe(true);
    });
  }
});

describe("C132 the motion of the views", () => {
  it("C132 the reader finds an animation or a transition outside the no-preference block, and leaves the ones inside", () => {
    expect(motionOutsideNoPreference(".a { animation: x 1s }")).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { transition: opacity 1s } }"),
    ).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  for (const v of VIEWS) {
    const css = read(v.css);
    it(`C132 every animation and transition of ${v.css} is inside the no-preference block, and there are some`, () => {
      expect(motionOutsideNoPreference(css)).toEqual([]);
      expect((css.match(/animation:/g) ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it(`C132 the ${v.name} panel enters with opacity alone in 200 ms ease-out`, () => {
      const [name, ...rest] = inMotion(css, `.${v.root} .${v.panel}`).animation!.split(/\s+/);
      expect(rest).toEqual(["200ms", "ease-out"]);
      expect(keyframes(css, name!)).toEqual([
        ["from", { opacity: "0" }],
        ["to", { opacity: "1" }],
      ]);
    });
  }

  it("C132 the panel and the summary carry the entering class, and the views animate nothing from script", () => {
    const tree = loadTree();
    expect(tree.get("brain/entities/EntitiesView.tsx")!).toContain('className="ent-panel ent-panel-in"');
    expect(tree.get("brain/summaries/SummariesView.tsx")!).toContain('className="sum-panel sum-panel-in"');
    for (const file of ["brain/entities/EntitiesView.tsx", "brain/summaries/SummariesView.tsx"])
      expect(tree.get(file)!, file).not.toMatch(
        /requestAnimationFrame|\.animate\(|useTweenNumber|setInterval/,
      );
  });

  it("C132 the ignored row of the entities list leaves in 150 ms inside the no-preference block, and with reduce at once", () => {
    const css = read("entities.css");
    expect(inMotion(css, ".ent-view .ent-row[data-leaving]").animation).toBe(
      "ent-fold 150ms ease-out forwards",
    );
    expect(loadTree().get("brain/entities/EntitiesView.tsx")!).toMatch(
      /if \(prefersReducedMotion\(\)\) setGone/,
    );
  });
});

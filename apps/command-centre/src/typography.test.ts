/**
 * Design-system guards. Type scale (refino item 13): every `font-size` in the
 * app's CSS is a token from theme.css, and no text is drawn below 12px — not
 * through `font-size`, the `font` shorthand, a token, a relative unit, an
 * inline `style`, nor canvas text. Colour: a colour literal exists only in
 * the token blocks of theme.css, and the stylelint config that says so
 * actually refuses one. The readers live in testing/sizeScan.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import stylelint from "stylelint";
import { describe, expect, it, vi } from "vitest";
import {
  cssFiles,
  proseClasses,
  proseRules,
  cssSizeOffences,
  customProperties,
  filesUnder,
  canvasTextSites,
  inlineSizeOffences,
  rel,
  sourceFiles,
  treeRoots,
} from "./testing/sizeScan";

// ------------------------------------------------------------------- tests

// These tests read every CSS and TS file of the app through a parser, and run in parallel with the
// other readers under a loaded machine: the 5 s default timed out (C3 takes ~3 s alone).
vi.setConfig({ testTimeout: 60_000 });

describe("type scale", () => {
  it("has no pixel font-size literal outside the tokens", () => {
    const offenders: string[] = [];
    for (const file of cssFiles()) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // The token definitions themselves (`--fs-2: 12px`) are the scale.
        if (/^\s*--fs-/.test(line)) return;
        if (/font-size:\s*[0-9.]+px/.test(line))
          offenders.push(`${file.replace(__dirname, "src")}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("C1 the type scale starts at 12px", () => {
    const theme = postcss.parse(readFileSync(join(__dirname, "theme.css"), "utf8"));
    const scale = new Map<string, string>();
    theme.walkRules(":root", (r) =>
      r.walkDecls(/^--fs-/, (d) => {
        if (!scale.has(d.prop)) scale.set(d.prop, d.value);
      }),
    );
    expect(scale.get("--fs-2")).toBe("12px");
    for (const token of ["--fs-3", "--fs-4", "--fs-5", "--fs-6", "--fs-7", "--fs-8", "--fs-hero"])
      expect(scale.has(token), token).toBe(true);
    // Neither step below the floor is defined nor used, anywhere in src.
    const gone = /--fs-[01](?![\w-])/;
    const self = join(__dirname, "typography.test.ts"); // its fixtures name them on purpose
    const everyFile = filesUnder(__dirname, (n) => /\.(css|ts|tsx)$/.test(n)).filter((f) => f !== self);
    const offenders = everyFile.filter((f) => gone.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("C2 no CSS sets text below 12px", () => {
    // Self-test: each way of writing a small size is caught…
    const tokens = postcss.parse(":root { --fs-2: 12px; --fs-3: 13px; }");
    const probe = (css: string) => cssSizeOffences([{ file: join(__dirname, "probe.css"), css }], [tokens]);
    expect(probe("a { font: 600 11px/1 x }")).toHaveLength(1);
    expect(probe("a { font-size: .7rem }")).toHaveLength(1);
    expect(probe("a { font-size: var(--fs-1) }")).toHaveLength(1);
    expect(probe("a { font-size: clamp(10px, 1vw, 14px) }")).toHaveLength(1);
    expect(probe("a { font: 500 var(--fs-1) var(--font-mono) }")).toHaveLength(1);
    expect(probe("a { font-size: 0.84em }")).toHaveLength(1);
    expect(probe("a { font-size: x-small }")).toHaveLength(1);
    expect(probe("a { font-size: calc(var(--fs-2) - 2px) }")).toHaveLength(1);
    expect(probe(":root { --fs-tiny: 10px } a { font-size: var(--fs-tiny) }")).toHaveLength(2);
    expect(probe("a { font-size: min(10px, 2vw) }")).toHaveLength(1);
    // min() is its smallest argument: a viewport unit counts as 0, the narrowest window.
    expect(probe("a { font-size: min(14px, 5vw) }")).toHaveLength(1);
    // …and the sizes the scale allows are not.
    expect(probe("a { font: inherit }")).toEqual([]);
    expect(probe("a { font-size: var(--fs-2) !important }")).toEqual([]);
    expect(probe("a { font: 600 var(--fs-3) / 1 var(--font-display) }")).toEqual([]);
    expect(probe("a { font: 500 var(--fs-2) var(--font-mono) }")).toEqual([]);
    expect(probe("a { font-size: clamp(var(--fs-2), 1.3vw + 6px, 26px) }")).toEqual([]);
    expect(probe("a { font-size: max(var(--fs-2), 0.84em) }")).toEqual([]);
    expect(probe("a { font-size: min(20px, 30px) }")).toEqual([]);
    expect(probe("a { font-size: 0 }")).toEqual([]);
    expect(probe("a { font-size: var(--fs-x, 0.75rem) }")).toEqual([]);

    const offenders = cssSizeOffences(cssFiles().map((file) => ({ file, css: readFileSync(file, "utf8") })));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /*
   * What this scan proves and what it does not. It proves what it can read: a size written as a literal, a
   * constant, arithmetic on those, or a call of a function in the tree. Two things it takes on trust, by name,
   * and the runtime measurement (C17) covers instead, in the states the layer tests exercise:
   *   - `size / k` is read as `size` when the divisor is an identifier called `k` (the camera scale). A local
   *     `const k = 10` shadowing it passes here.
   *   - a canvas method reached through a computed key (`ctx["fill" + "Text"]`) is not a text site to the
   *     structural guard below.
   * Neither is a rule to follow: they are the places where reading the source runs out.
   */
  it("C3 no inline or canvas text below 12px", () => {
    const props = customProperties([postcss.parse(":root { --fs-2: 12px; --fs-3: 13px; }")]);
    const probe = (code: string) => inlineSizeOffences(join(__dirname, "probe.tsx"), code, props);
    // Self-test: every shape is caught…
    expect(probe(`const a = <span style={{ fontSize: 11 }} />;`)).toHaveLength(1);
    expect(probe(`const s = { fontSize: "var(--fs-1)" };`)).toHaveLength(1);
    expect(probe(`const s = { fontSize: "10px" };`)).toHaveLength(1);
    expect(probe(`el.style.fontSize = "11px";`)).toHaveLength(1);
    expect(probe(`ctx.font = "11px ui-monospace, monospace";`)).toHaveLength(1);
    expect(probe("ctx.font = `500 11px ${tk.body}`;")).toHaveLength(1);
    expect(probe("ctx.font = `700 ${9 / k}px ${font}`;")).toHaveLength(1);
    // The declared limit: the name `k` is trusted, so a shadowing `k` is not seen here (C17 measures it).
    expect(probe("const k = 10;\nctx.font = `500 ${12 / k}px ${font}`;")).toEqual([]);
    expect(probe("c.font = `800 ${Math.max(7, size * 0.62)}px ${mono}`;")).toHaveLength(1);
    expect(probe("const fs = Math.max(8, w * 0.02);\nx.font = `500 ${fs}px ${mono}`;")).toHaveLength(1);
    expect(probe("x.font = `500 ${pal.fs}px ${mono}`;")).toHaveLength(1);
    // A divisor other than the camera's `k` can leave the screen size under the floor: not bounded.
    expect(probe("ctx.font = `800 ${12 / Math.max(0.8, k)}px ${font}`;")).toHaveLength(1);
    expect(probe("ctx.font = `800 ${15 / zoom}px ${font}`;")).toHaveLength(1);
    expect(probe("ctx.font = `800 ${Math.max(12, 15 * k) / Math.max(0.7, k)}px ${font}`;")).toHaveLength(1);
    // The size a function returns is the lowest of its `return`s, with its arguments' bounds in it.
    expect(
      probe("function small(n: number) { return Math.max(8, n); }\nx.font = `500 ${small(w)}px ${m}`;"),
    ).toHaveLength(1);
    expect(probe("const big = (n: number) => Math.max(12, n);\nx.font = `500 ${big(3)}px ${m}`;")).toEqual(
      [],
    );
    expect(
      probe("function pick(a: number) { if (a) return 10; return 14; }\nx.font = `500 ${pick(1)}px ${m}`;"),
    ).toHaveLength(1);
    // Units other than px, keywords and a line height: a canvas reads all of them
    expect(probe('ctx.font = "8pt monospace";')).toHaveLength(1);
    expect(probe('ctx.font = "0.5rem monospace";')).toHaveLength(1);
    expect(probe('ctx.font = "0.5em ui-monospace, monospace";')).toHaveLength(1);
    expect(probe('ctx.font = "50% monospace";')).toHaveLength(1);
    expect(probe('ctx.font = "1pc monospace";')).toEqual([]);
    expect(probe('ctx.font = "x-small monospace";')).toHaveLength(1);
    expect(probe('ctx.font = "smaller monospace";')).toHaveLength(1);
    expect(probe('ctx.font = "8px/1 mono";')).toHaveLength(1);
    expect(probe('ctx.font = "700 8px/1.2 monospace";')).toHaveLength(1);
    expect(probe("const n = 6;\nx.font = `600 ${n}pt ${family}`;")).toHaveLength(1);
    expect(probe("x.font = `600 ${unknownSize}rem ${family}`;")).toHaveLength(1);
    expect(probe('ctx.font = "9pt monospace";')).toEqual([]);
    expect(probe('ctx.font = "0.75rem monospace";')).toEqual([]);
    expect(probe('ctx.font = "small monospace";')).toEqual([]);
    expect(probe("x.font = `600 ${Math.max(10, n)}pt ${family}`;")).toEqual([]);
    // prose that looks like a font is not one: a unit or a keyword needs a family that is unmistakably one
    expect(probe('const t = "50% faster than before";')).toEqual([]);
    expect(probe('const t = "small screens need a drawer";')).toEqual([]);
    expect(probe('const t = "10 in the list";')).toEqual([]);
    expect(probe('const t = "5in a row";')).toEqual([]);
    // A font string built with `+` or `.join`, and the computed spellings of a size
    expect(probe('ctx.font = "700 " + 8 + "px" + " mono";')).toHaveLength(1);
    expect(probe('ctx.font = ["700", "8px", "mono"].join(" ");')).toHaveLength(1);
    expect(probe('ctx.font = ["700", n + "px", "mono"].join(" ");')).toHaveLength(1);
    expect(probe('ctx.font = ["700", "12px", "mono"].join(" ");')).toEqual([]);
    expect(probe('ctx.font = "700 " + 14 + "px " + family;')).toEqual([]);
    expect(probe("el.setAttribute('font-size', '8');")).toHaveLength(1);
    expect(probe("el.setAttribute('font-size', '13');")).toEqual([]);
    expect(probe("const s = { ['fontSize']: 8 };")).toHaveLength(1);
    expect(probe("el.style['fontSize'] = '8px';")).toHaveLength(1);
    expect(probe("el.style['fontSize'] = '13px';")).toEqual([]);
    // Arithmetic is read soundly: a lower bound of a subtrahend is no bound at all, a negative factor flips one.
    expect(probe("x.font = `500 ${Math.max(14, w) - Math.max(2, h)}px ${m}`;")).toHaveLength(1);
    expect(probe("x.font = `500 ${Math.max(14, w) - 2}px ${m}`;")).toEqual([]);
    expect(probe("x.font = `500 ${-2 * Math.max(8, w)}px ${m}`;")).toHaveLength(1);
    expect(probe("x.font = `500 ${Math.max(6, w) * 2}px ${m}`;")).toEqual([]);
    // Not decidable here, and so not claimed: `size / k` trusts the name `k` as the camera's scale (C17 measures
    // what the canvas really draws), and a font read through a call, a bind, a destructure or a computed key.
    // JSX and SVG attributes, a shorthand property, setProperty, cssText and an HTML string
    expect(probe("const a = <text fontSize={9} />;")).toHaveLength(1);
    expect(probe('const a = <text fontSize="9" />;')).toHaveLength(1);
    expect(probe("const fontSize = 9;\nconst s = { fontSize };")).toHaveLength(1);
    expect(probe('el.style.setProperty("font-size", "9px");')).toHaveLength(1);
    expect(probe('el.style.cssText = "color: red; font-size:9px";')).toHaveLength(1);
    expect(probe('const html = `<span style="font-size:9px">x</span>`;')).toHaveLength(1);
    expect(probe("const html = `<span style='font: 11px mono'>x</span>`;")).toHaveLength(1);
    expect(probe("el.style.cssText = `font-size:${n}px`;")).toHaveLength(1);
    // an imported constant is read from its module (brain/render/labels.ts)
    const fromLabels = (code: string) =>
      inlineSizeOffences(join(__dirname, "brain/render/probe.ts"), code, props);
    expect(
      fromLabels('import { LABEL_FONT_PX } from "./labels";\nconst f = `${LABEL_FONT_PX}px ${mono}`;'),
    ).toEqual([]);
    expect(
      fromLabels('import { LABEL_BUDGET } from "./labels";\nconst f = `${LABEL_BUDGET / 40}px ${mono}`;'),
    ).toHaveLength(1);
    expect(probe("const f = `${big ? 600 : 500} ${px}px ${tk.body}`;")).toHaveLength(1);
    expect(probe(`ctx.font = "500 " + size + "px mono";`)).toHaveLength(1);
    // …and the forms that respect the floor, or are not text at all, are not.
    expect(probe(`const a = <span style={{ fontSize: "var(--fs-3)" }} />;`)).toEqual([]);
    expect(probe(`const a = <span style={{ fontSize: 12 }} />;`)).toEqual([]);
    expect(probe("const a = <text fontSize={12} />;")).toEqual([]);
    expect(probe("const fontSize = 13;\nconst s = { fontSize };")).toEqual([]);
    expect(probe('el.style.setProperty("font-size", "var(--fs-3)");')).toEqual([]);
    expect(probe('el.style.setProperty("--x", "9px");')).toEqual([]);
    expect(probe('el.style.cssText = "color: red; font-size:13px";')).toEqual([]);
    expect(probe('const css = "a { margin: 9px }";')).toEqual([]);
    expect(probe("ctx.font = `700 ${12 / k}px ${font}`;")).toEqual([]);
    expect(probe("const fs = Math.max(12, w * 0.02);\nx.font = `500 ${fs}px ${mono}`;")).toEqual([]);
    expect(probe("const f = `600 ${Math.max(12, groupPx(s))}px ${tk.display}`;")).toEqual([]);
    expect(
      inlineSizeOffences(
        join(__dirname, "nucleo/scenes/probe.ts"),
        'import { groupPx, labelPx } from "./brainLabels";\nconst f = `600 ${groupPx(s)}px ${a} ${labelPx(1, s)}px ${b}`;',
        props,
      ),
    ).toEqual([]);
    expect(probe("el.style.transform = `translate(${x}px, ${y}px)`;")).toEqual([]);
    expect(probe("el.style.backgroundPosition = `${x}px ${y}px`;")).toEqual([]);
    expect(probe(`el.style.boxShadow = "0 2px 8px rgba(0,0,0,.4)";`)).toEqual([]);
    expect(probe(`const s = { border: "1px solid var(--border)" };`)).toEqual([]);

    const tokens = customProperties(treeRoots());
    const offenders = sourceFiles().flatMap((f) => inlineSizeOffences(f, readFileSync(f, "utf8"), tokens));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ------------------------------------------------------------ running text

/**
 * The rules that set text at 12px (`--fs-2`) on something a `<p>`, or a class
 * that names a sentence, carries, and that are labels, counters, key hints,
 * paths or metadata rather than running text: design.md keeps those at 12px
 * and wants running text (paragraphs, descriptions, messages) at 13px (`--fs-3`)
 * or more. Each entry is one selector, as written, with why it is not a
 * sentence: a name like `.sub` or `.meta` is exempt only where that selector
 * says so, never wherever the class appears.
 */
const MICROCOPY: Record<string, string> = {
  ".mono": "monospace utility for data (ids, paths, commands, cron expressions)",
  ".ev-usage .ev-body .mono": "monospace token usage figures",
  ".folder-row .mono": "a folder path",
  ".rs-row-title.mono": "a run title that is a skill name or a command",
  ".rts-facts dd.mono": "a routine fact value (a cron expression, a time zone)",
  ".sks-fchip.mono": "a filter chip in monospace",
  ".sks-opt.mono": "a filter option in monospace",
  ".sks-read .v.mono": "a value in monospace",
  ".sks-read .k": "the key of a key/value pair",
  ".sks-read .v": "the value of a key/value pair",
  ".mt .k": "the key of a key/value pair",
  ".nu-orb-card .k": "the key of a key/value pair",
  ".nu-reading .k": "the key of a key/value pair",
  ".label": "a field label",
  ".stat .label": "a stat label",
  ".cp": "a name chip in the journal widget",
  ".apps-conn-row .meta": "metadata of a list row (kind, age, count)",
  ".device-list .meta": "metadata of a list row (kind, age, count)",
  ".list-row .meta": "metadata of a list row (kind, age, count)",
  ".market-list .meta": "metadata of a list row (kind, age, count)",
  ".squad-list .meta": "metadata of a list row (kind, age, count)",
  ".brain2-tooltip .sub": "the subtitle of a tooltip: a kind and a count",
  ".approval-inline-cwd": "a working-directory path",
  ".brain-preview-path": "a file path",
  ".bs-sheet-path": "a file path",
  ".file-path": "a file path",
  ".microapp-row .ma-desc": "a file path (the row's `rel`)",
  ".run-id": "a run id",
  ".nu-keys": "key hints",
  ".sks-keys": "key hints",
  ".pxs-shortcuts": "key hints",
  ".apps-run-hint": "a key hint (the keys are `kbd` elements)",
  ".nu-caption-hint": "the caption's key hints under the core",
  ".sks-eyebrow": "an uppercase eyebrow",
  ".nu-focus-eyebrow": "an uppercase eyebrow",
  ".bs-eyebrow": "an uppercase eyebrow",
  ".bs-link-kind": "a kind label",
  ".bs-rail-kind": "a kind label",
  ".inbox-section": "an uppercase section label",
  ".settings-group-label": "an uppercase group label",
  ".nu-focus-pos": "the position counter of the focus queue",
  ".sks-tags": "tags: metadata",
  ".sks-state": "a state counter line",
  ".sks-count": "a counter",
  ".rs-sub": "run metadata (provider, age)",
  ".run-sheet-line": "run metadata on one line",
  ".art-sub": "artifact metadata (date, size)",
  ".conv-sub": "conversation metadata (count, age)",
  ".launcher-result .lr-sub": "a palette result's subtitle: a path or a kind",
  ".nu-hint": "a suggestion chip: the label of a button",
  ".replay-summary.compact": "tool counts of a replay",
  ".doc-body": "a preformatted document (`<pre>`)",
  ".skill-body": "a preformatted skill source",
};

describe("running text", () => {
  it("C15 paragraphs, descriptions and messages are at least 13px", () => {
    const props = customProperties([postcss.parse(":root { --fs-2: 12px; --fs-3: 13px; }")]);
    const probe = (css: string, classes = ["note"]) =>
      proseRules([{ file: "probe.css", css }], new Set(classes), props).map((r) => r.selector);
    // Self-test: a rule that sets small text on a paragraph, or on a class a paragraph carries, is found…
    expect(probe(".note { font-size: 12px }")).toEqual([".note"]);
    expect(probe(".note { font-size: var(--fs-2) }")).toEqual([".note"]);
    expect(probe(".card .note { font: 400 var(--fs-2) / 1.4 var(--font) }")).toEqual([".card .note"]);
    expect(probe("p { font-size: 12px }", [])).toEqual(["p"]);
    expect(probe(".panel p { font-size: var(--fs-2) }", [])).toEqual([".panel p"]);
    expect(probe("p.lead { font-size: 12.5px }", [])).toEqual(["p.lead"]);
    expect(probe("@media (max-width: 600px) { .note { font-size: 12px } }")).toEqual([".note"]);
    // …under the selector as written, so a class that is microcopy in one place is prose in another
    expect(probe(".page-head .sub { font-size: var(--fs-2) }", ["sub"])).toEqual([".page-head .sub"]);
    expect(probe(".note.mono { font-size: 12px }")).toEqual([".note.mono"]);
    // …whether the class is written as a class or as an attribute selector
    expect(probe('[class~="sub"] { font-size: var(--fs-2) }', ["sub"])).toEqual(['[class~="sub"]']);
    expect(probe('.row [class="sub"] { font-size: var(--fs-2) }', ["sub"])).toEqual(['.row [class="sub"]']);
    expect(probe('[class*="sub"] { font-size: var(--fs-2) }', ["row-sub"])).toEqual(['[class*="sub"]']);
    expect(probe('[class^="row-"] { font-size: var(--fs-2) }', ["row-sub"])).toEqual(['[class^="row-"]']);
    expect(probe('[class~="other"] { font-size: var(--fs-2) }', ["sub"])).toEqual([]);
    // …and 13px or more, a class no paragraph carries, and a rule about a child, are not.
    expect(probe(".note { font-size: var(--fs-3) }")).toEqual([]);
    expect(probe(".note { font-size: 1rem }")).toEqual([]);
    expect(probe(".other { font-size: 12px }")).toEqual([]);
    expect(probe(".note b { font-size: 12px }")).toEqual([]);
    expect(probe(".note { color: red }")).toEqual([]);

    // Which classes carry sentences: on a <p>, or named like one anywhere (a className, a lookup, a prop).
    const found = (code: string) => [...proseClasses("a.tsx", code)].sort();
    expect(found('const a = <p className="one two">x</p>;')).toEqual(["one", "two"]);
    expect(found("const a = <p className={`one ${b ? 'two' : ''}`}>x</p>;")).toEqual(["one", "two"]);
    expect(found('const a = <div className="one">x</div>;')).toEqual([]);
    expect(found('const a = <span className="cx-purpose">x</span>;')).toEqual(["cx-purpose"]);
    expect(found('const kinds = { a: "row-desc", b: "row-icon" };')).toEqual(["row-desc"]);
    expect(found('const a = <Card note="item-hint" />;')).toEqual(["item-hint"]);
    expect(found('const a = <span className="Not-Kebab">x</span>;')).toEqual([]);
    const classes = new Set<string>();
    for (const f of sourceFiles()) for (const c of proseClasses(f, readFileSync(f, "utf8"))) classes.add(c);
    expect(classes.size).toBeGreaterThan(60);
    expect(classes.has("cx-purpose")).toBe(true);

    const tokens = customProperties(treeRoots());
    const rules = proseRules(
      cssFiles().map((file) => ({ file, css: readFileSync(file, "utf8") })),
      classes,
      tokens,
    );
    const offenders = rules.filter((r) => !(r.selector in MICROCOPY));
    expect(offenders.map((r) => `${r.at} ${r.selector} { ${r.why} }`).join("\n")).toBe("");

    // No exemption has gone stale: each still names a rule that is under 13px.
    const small = new Set(rules.map((r) => r.selector));
    const stale = Object.keys(MICROCOPY).filter((sel) => !small.has(sel));
    expect(stale, `no longer small text on a sentence class (drop the entry): ${stale.join(", ")}`).toEqual(
      [],
    );
  });
});

// ------------------------------------------------- canvas text, at runtime

/**
 * Every source that draws text on a canvas, and the test that measures what it
 * draws where a person sees it (font x transform scale x sprite scale).
 * C3 reads the size out of the source and cannot see a zoom or a sprite; these
 * can. A new canvas text site must be added here with its measurement.
 */
const MEASURED_AT_RUNTIME: Record<string, string> = {
  "brain/render/draw.ts": "brain/render/canvasText.test.ts",
  "brain/render/glyphs.ts": "brain/render/canvasText.test.ts",
  "nucleo/scenes/brainPaint.ts": "nucleo/scenes/canvasText.test.ts",
  "nucleo/entity/entityHud.ts": "nucleo/entity/canvasText.test.ts",
  "runs/Replay.tsx": "runs/Replay.canvasText.test.tsx",
};

describe("canvas text", () => {
  it("C17 every source that draws canvas text is measured on screen by a test", () => {
    // Self-test: a call site is found by its method, not by a name that merely contains it.
    expect(canvasTextSites("a.ts", "ctx.fillText(t, 0, 0);\nx.strokeText(t, 1, 1);")).toEqual([1, 2]);
    expect(canvasTextSites("a.ts", "const fillTextStyle = 1; ctx.fillTextAt(t);")).toEqual([]);
    // The declared limit: a computed key is not a name the scan can read (the recorder's call sites cover it).
    expect(canvasTextSites("a.ts", 'ctx["fill" + "Text"](t, 0, 0);')).toEqual([]);
    // …and so is every other way to reach the method: a bare call, a bind, a destructure, a quoted
    // key, Reflect.apply, a prototype call, an optional call, a cast.
    for (const code of [
      "fillText(t, 0, 0);",
      "const draw = ctx.fillText.bind(ctx);",
      "const { fillText } = ctx;",
      "const { strokeText: st } = ctx;",
      "ctx['fillText'](t, 0, 0);",
      "Reflect.apply(ctx.fillText, ctx, [t, 0, 0]);",
      "CanvasRenderingContext2D.prototype.fillText.call(ctx, t, 0, 0);",
      "ctx?.fillText?.(t, 0, 0);",
      "(ctx as any).strokeText(t, 0, 0);",
    ])
      expect(canvasTextSites("a.ts", code), code).toHaveLength(1);

    const sites = sourceFiles()
      .filter((f) => canvasTextSites(f, readFileSync(f, "utf8")).length > 0)
      .map((f) => rel(f).replace(/^src\//, ""))
      .sort();
    expect(sites).toEqual(Object.keys(MEASURED_AT_RUNTIME).sort());

    for (const [source, test] of Object.entries(MEASURED_AT_RUNTIME)) {
      const path = join(__dirname, test);
      expect(existsSync(path), `${source} is measured by ${test}`).toBe(true);
      const code = readFileSync(path, "utf8");
      // The measurement asserts the floor on what the recording canvas saw.
      expect(code, test).toMatch(/textDrawnOn\(/);
      expect(code, test).toMatch(/FLOOR/);
      // …and says which files the text came from, so an unrecognised spelling still shows up.
      expect(code, test).toMatch(/\.site\b|LAYER_FILES/);
    }
  });
});

// ------------------------------------------------------------------ colour

/** Starting stylelint and reading 19k lines of CSS takes longer than vitest's 5s default. */
const STYLELINT_MS = 60_000;
const repoRoot = join(__dirname, "..", "..", "..");
const stylelintConfig = join(repoRoot, "stylelint.config.mjs");
const stylelintCli = (...args: string[]) =>
  spawnSync("npx", ["stylelint", "--config", stylelintConfig, ...args], { cwd: repoRoot, encoding: "utf8" });

/** The selectors of theme.css that define tokens: `:root`, `[data-theme]` and `[data-preset]`. */
const TOKEN_SELECTOR = /^(:root|\[data-theme="\w+"\](\[data-preset="\w+"\])?|\[data-preset="\w+"\])$/;

async function colourWarnings(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    codeFilename: join(__dirname, "probe.css"),
    configFile: stylelintConfig,
  });
  return results.flatMap((r) => r.warnings.map((w) => w.rule));
}

/**
 * Where a stylelint switch sits outside the one place it may: every
 * `stylelint-disable` / `-enable` in the raw text (a comment inside a value is
 * not a comment node to postcss, but stylelint reads it) must be a top-level
 * comment of theme.css, and what it switches off must be token blocks only.
 */
function exemptionOffences(file: string, css: string): string[] {
  const root = postcss.parse(css, { from: file });
  const out: string[] = [];
  const raw = (css.match(/stylelint-(disable|enable)/g) ?? []).length;
  let accounted = 0;
  let off = false;
  root.each((node) => {
    if (node.type === "comment" && /stylelint-(disable|enable)/.test(node.text)) {
      accounted += (node.text.match(/stylelint-(disable|enable)/g) ?? []).length;
      if (/stylelint-disable-(next-)?line/.test(node.text)) {
        // A one-line switch has no region to check: it is never allowed.
        out.push(`${rel(file)}:${node.source?.start?.line} ${node.toString()}`);
      } else if (/stylelint-disable/.test(node.text)) {
        if (!file.endsWith("theme.css") || !/^stylelint-disable [a-z, -]+( --|$)/.test(node.text))
          out.push(`${rel(file)}:${node.source?.start?.line} ${node.toString()}`);
        off = true;
      } else off = false;
    } else if (off && node.type !== "comment") {
      const selectors = node.type === "rule" ? node.selectors : [];
      if (!selectors.length || !selectors.every((x) => TOKEN_SELECTOR.test(x.trim())))
        out.push(
          `${rel(file)}:${node.source?.start?.line} is not a token block but sits where the lint is off`,
        );
    }
  });
  if (off) out.push(`${rel(file)} leaves the lint off to the end of the file`);
  if (raw !== accounted)
    out.push(
      `${rel(file)}: ${raw - accounted} stylelint switch(es) outside a top-level comment (inside a rule or a value)`,
    );
  return out;
}

/**
 * Every place a stylelint config could hide besides `stylelint.config.mjs`:
 * `.stylelintrc` in any spelling, another `stylelint.config.*`, a
 * `.stylelintignore`, a `stylelint` key in any package.json. `lint:css` names
 * its config, which stops stylelint looking for others, but the tree must not
 * hold one that another tool (an editor, a hook) would read.
 */
function strayStylelintConfigs(files: string[], packages: Record<string, string>): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (/(^|\/)\.stylelintrc(\.[a-z]+)?$/.test(f)) out.push(`${f}: a stylelint rc file`);
    else if (/(^|\/)stylelint\.config\.[cm]?[jt]s$/.test(f) && f !== "stylelint.config.mjs")
      out.push(`${f}: a second stylelint config`);
    else if (/(^|\/)\.stylelintignore$/.test(f)) out.push(`${f}: a stylelint ignore list`);
    else if (/(^|\/)package\.json$/.test(f) && f in packages) {
      try {
        if ("stylelint" in JSON.parse(packages[f]!)) out.push(`${f}: a "stylelint" key`);
      } catch {
        out.push(`${f}: unreadable`);
      }
    }
  }
  return out;
}

/** What is wrong with the config (its keys, its three colour rules), given `patch` laid over it. */
function guardedConfig(base: Record<string, unknown>, patch: Record<string, unknown> = {}): string[] {
  const config = {
    ...base,
    ...patch,
    rules: { ...(base.rules as object), ...((patch.rules as object | undefined) ?? {}) },
  } as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(config))
    if (!["extends", "rules"].includes(key)) out.push(`config key "${key}"`);
  const rules = (config.rules ?? {}) as Record<string, unknown>;
  if (rules["color-no-hex"] !== true) out.push("color-no-hex is not plain `true`");
  if (rules["color-named"] !== "never") out.push('color-named is not "never"');
  const fns = rules["function-disallowed-list"];
  for (const fn of ["rgb", "rgba", "hsl", "hsla", "color", "device-cmyk"])
    if (!Array.isArray(fns) || !fns.includes(fn)) out.push(`function-disallowed-list lacks ${fn}`);
  return out;
}

describe("colour tokens", () => {
  it(
    "C5 the colour lint refuses a literal",
    async () => {
      // `npm run lint` runs stylelint over every CSS file of the Command Centre, and so does the commit hook.
      const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
      expect(pkg.scripts.lint).toMatch(/\bnpm run lint:css\b/);
      // The config is named, never discovered: stylelint searches the tree for a config of its own
      // (a `.stylelintrc.*` in any folder, `stylelint.config.cjs`…), and an explicit --config switches that off.
      // `--ignore-path .gitignore` replaces the `.stylelintignore` that stylelint reads from the working directory.
      expect(pkg.scripts["lint:css"]).toBe(
        'stylelint --config stylelint.config.mjs --ignore-path .gitignore "apps/command-centre/src/**/*.css"',
      );
      expect(pkg["lint-staged"]["*.css"]).toEqual(
        expect.arrayContaining([expect.stringMatching(/^stylelint --config stylelint\.config\.mjs /)]),
      );

      // The command itself exits non-zero on `a { color: #fff }`.
      const dir = mkdtempSync(join(tmpdir(), "colour-lint-"));
      try {
        const file = join(dir, "probe.css");
        writeFileSync(file, "a { color: #fff; }\n");
        const run = stylelintCli(file);
        expect(run.status, run.stdout + run.stderr).not.toBe(0);
        expect(run.stdout + run.stderr).toContain("color-no-hex");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      // `lint:css` on its own, run as written in a folder whose `.stylelintignore` lists the file, still refuses it.
      const ignored = mkdtempSync(join(tmpdir(), "colour-lint-ignore-"));
      try {
        writeFileSync(join(ignored, "probe.css"), "a { color: #fff; }\n");
        writeFileSync(join(ignored, ".stylelintignore"), "probe.css\n");
        writeFileSync(join(ignored, ".gitignore"), "");
        const args = (pkg.scripts["lint:css"] as string)
          .replace(/^stylelint /, "")
          .replace("stylelint.config.mjs", stylelintConfig)
          .replace(/"apps[^"]*"/, "probe.css")
          .split(" ");
        const run = spawnSync("npx", ["stylelint", ...args], { cwd: ignored, encoding: "utf8" });
        expect(run.status, run.stdout + run.stderr).not.toBe(0);
        expect(run.stdout + run.stderr).toContain("color-no-hex");
        // Without the pinned ignore path the list is honoured and the file is skipped: the probe is what bites.
        const bare = spawnSync("npx", ["stylelint", "--config", stylelintConfig, "probe.css"], {
          cwd: ignored,
          encoding: "utf8",
        });
        expect(bare.stdout + bare.stderr).toContain("ignored");
      } finally {
        rmSync(ignored, { recursive: true, force: true });
      }

      // Each form of colour literal is refused…
      expect(await colourWarnings("a { color: #fff; }\n")).toContain("color-no-hex");
      expect(await colourWarnings("a { color: #ffffff80; }\n")).toContain("color-no-hex");
      expect(await colourWarnings("a { color: rgb(0 0 0); }\n")).toContain("function-disallowed-list");
      expect(await colourWarnings("a { color: rgba(0, 0, 0, 0.5); }\n")).toContain(
        "function-disallowed-list",
      );
      expect(await colourWarnings("a { color: hsl(10 20% 30%); }\n")).toContain("function-disallowed-list");
      expect(await colourWarnings("a { color: hsla(10, 20%, 30%, 0.5); }\n")).toContain(
        "function-disallowed-list",
      );
      expect(await colourWarnings("a { color: red; }\n")).toContain("color-named");
      expect(await colourWarnings("a { background: linear-gradient(#000 0 0); }\n")).toContain(
        "color-no-hex",
      );
      expect(
        await colourWarnings("a { border-color: color-mix(in srgb, #fff 30%, var(--accent)); }\n"),
      ).toContain("color-no-hex");
      expect(await colourWarnings("a { color: var(--ok, #4ade80); }\n")).toContain("color-no-hex");
      expect(await colourWarnings("a { color: color(srgb 1 0 0); }\n")).toContain("function-disallowed-list");
      expect(await colourWarnings("a { color: oklch(60% 0.2 30); }\n")).toContain("function-disallowed-list");
      expect(await colourWarnings("a { background: device-cmyk(0 1 1 0); }\n")).toContain(
        "function-disallowed-list",
      );
      expect(await colourWarnings("a { color: light-dark(#fff, #000); }\n")).toContain("color-no-hex");
      // a colour inside an inline image, and the system colours, which have names too
      expect(
        await colourWarnings(`a { background: url("data:image/svg+xml,%3Csvg fill='%23ff0000'/%3E"); }\n`),
      ).toContain("declaration-property-value-disallowed-list");
      expect(await colourWarnings("a { color: Canvas; }\n")).toContain(
        "declaration-property-value-disallowed-list",
      );
      expect(await colourWarnings("a { border: 1px solid ButtonFace; }\n")).toContain(
        "declaration-property-value-disallowed-list",
      );
      // …in shadows, filters, gradients, stops, fills, text strokes and custom properties too
      for (const decl of [
        "box-shadow: 0 0 4px Highlight",
        "text-shadow: 0 0 2px Canvas",
        "filter: drop-shadow(0 0 2px ButtonText)",
        "-webkit-text-fill-color: GrayText",
        "-webkit-text-stroke: 1px Highlight",
        "stop-color: Highlight",
        "flood-color: Canvas",
        "fill: CanvasText",
        "background: linear-gradient(Canvas, transparent)",
        "--c: Canvas",
      ])
        expect(await colourWarnings(`a { ${decl}; }\n`), decl).toContain(
          "declaration-property-value-disallowed-list",
        );
      // …the deprecated system colours and the vendor keywords too
      for (const name of [
        "Window",
        "WindowText",
        "Menu",
        "Background",
        "ActiveCaption",
        "ActiveBorder",
        "InfoBackground",
        "ThreeDFace",
        "AppWorkspace",
        "ThreeDShadow",
        "-webkit-link",
        "-moz-default-color",
        "-webkit-focus-ring-color",
      ])
        expect(await colourWarnings(`a { color: ${name}; background: ${name}; }\n`), name).toContain(
          "declaration-property-value-disallowed-list",
        );
      expect(await colourWarnings("a { --c: #fff; }\n")).toContain("color-no-hex");
      expect(await colourWarnings("a { box-shadow: 0 0 4px rgba(0, 0, 0, 0.4); }\n")).toContain(
        "function-disallowed-list",
      );
      // …and the forms the design allows are not.
      expect(await colourWarnings("a { color: var(--text); }\n")).toEqual([]);
      expect(
        await colourWarnings("a { color: color-mix(in srgb, var(--accent) 40%, transparent); }\n"),
      ).toEqual([]);
      expect(
        await colourWarnings("a {\n  background: transparent;\n  border-color: currentColor;\n}\n"),
      ).toEqual([]);
      expect(await colourWarnings("a { mask-image: linear-gradient(var(--mask-ink) 0 0); }\n")).toEqual([]);
      expect(await colourWarnings("a { grid-area: field; }\n")).toEqual([]);
      expect(await colourWarnings("a { animation-name: highlight; }\n")).toEqual([]);
      expect(await colourWarnings("a { container-name: field; }\n")).toEqual([]);
      expect(await colourWarnings("a { anchor-name: --field; }\n")).toEqual([]);
      // The declared limit: a custom property may hold a colour, so one holding a bare system-colour word is refused.
      expect(await colourWarnings("a { --kind: mark; }\n")).toContain(
        "declaration-property-value-disallowed-list",
      );
      expect(await colourWarnings("a { box-shadow: 0 0 4px var(--accent); }\n")).toEqual([]);
    },
    STYLELINT_MS,
  );

  it(
    "C6 the tree passes the colour lint",
    async () => {
      const run = spawnSync(
        "npx",
        ["stylelint", "--config", "stylelint.config.mjs", "apps/command-centre/src/**/*.css"],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);

      // The rule is switched off only around the token blocks of theme.css…
      const offenders = cssFiles().flatMap((file) => exemptionOffences(file, readFileSync(file, "utf8")));
      expect(offenders, offenders.join("\n")).toEqual([]);

      // …which the probe below proves it can tell, in every form a disable can take…
      const theme = join(__dirname, "theme.css");
      const other = join(__dirname, "desktop/desktop.css");
      const off = "/* stylelint-disable color-no-hex -- token definitions */";
      const on = "/* stylelint-enable color-no-hex */";
      expect(exemptionOffences(theme, `${off}\n:root { --a: #fff; }\n${on}\n`)).toEqual([]);
      expect(exemptionOffences(other, `${off}\n:root { --a: #fff; }\n${on}\n`)).toHaveLength(1);
      expect(exemptionOffences(other, "a { color: #fff; /* stylelint-disable-line */ }")).toHaveLength(1);
      expect(exemptionOffences(other, "/* stylelint-disable-next-line */\na { color: #fff; }")).toHaveLength(
        1,
      );
      // a comment inside the value is not a comment node to postcss, but stylelint honours it
      expect(exemptionOffences(other, "a { color: #fff /* stylelint-disable-line */; }")).toHaveLength(1);
      expect(exemptionOffences(theme, "a { color: #fff /* stylelint-disable-line */; }")).toHaveLength(1);
      expect(exemptionOffences(theme, `${off}\na.card { color: #fff; }\n${on}\n`)).toHaveLength(1);
      expect(exemptionOffences(theme, `${off}\n:root { --a: #fff; }\n`)).toHaveLength(1);
      expect(exemptionOffences(theme, `${off}\n@media print { :root { --a: #fff; } }\n${on}\n`)).toHaveLength(
        1,
      );

      // …and nothing outside the CSS can excuse a file either: no ignore list, no overrides, no other config.
      const base = (await import(/* @vite-ignore */ pathToFileURL(stylelintConfig).href)).default;
      const guarded = (patch?: Record<string, unknown>) => guardedConfig(base, patch);
      expect(guarded(), "stylelint.config.mjs").toEqual([]);
      expect(guarded({ ignoreFiles: ["**/nucleo.css"] }).length).toBeGreaterThan(0);
      expect(
        guarded({ overrides: [{ files: ["**/desktop.css"], rules: { "color-no-hex": null } }] }).length,
      ).toBeGreaterThan(0);
      expect(
        guarded({ rules: { "color-no-hex": [true, { ignore: ["inside-function"] }] } }).length,
      ).toBeGreaterThan(0);
      expect(guarded({ rules: { "color-named": null } }).length).toBeGreaterThan(0);
      expect(guarded({ rules: { "function-disallowed-list": ["rgb", "rgba"] } }).length).toBeGreaterThan(0);
      expect(guarded({ plugins: ["./plugin.js"] }).length).toBeGreaterThan(0);
      // No other stylelint config, ignore list or package.json key exists anywhere in the tree (tracked or not).
      expect(strayStylelintConfigs([], {})).toEqual([]);
      for (const name of [
        ".stylelintrc",
        ".stylelintrc.json",
        ".stylelintrc.yml",
        ".stylelintrc.yaml",
        ".stylelintrc.js",
        ".stylelintrc.cjs",
        ".stylelintrc.mjs",
        ".stylelintrc.ts",
        "stylelint.config.js",
        "stylelint.config.cjs",
        "stylelint.config.ts",
        "apps/command-centre/src/.stylelintrc.json",
        "apps/command-centre/src/views/stylelint.config.mjs",
        ".stylelintignore",
        "apps/command-centre/.stylelintignore",
      ])
        expect(strayStylelintConfigs([name], {}), name).toHaveLength(1);
      expect(strayStylelintConfigs(["stylelint.config.mjs"], {})).toEqual([]);
      expect(
        strayStylelintConfigs(["package.json"], { "package.json": '{"stylelint":{"rules":{}}}' }),
      ).toHaveLength(1);
      expect(
        strayStylelintConfigs(["apps/x/package.json"], {
          "apps/x/package.json": '{"name":"x","stylelint":{}}',
        }),
      ).toHaveLength(1);
      expect(strayStylelintConfigs(["package.json"], { "package.json": '{"name":"x"}' })).toEqual([]);
      const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(listed.status, listed.stderr).toBe(0);
      const files = listed.stdout.split("\n").filter(Boolean);
      const packages = Object.fromEntries(
        files
          .filter((f) => /(^|\/)package\.json$/.test(f) && existsSync(join(repoRoot, f)))
          .map((f) => [f, readFileSync(join(repoRoot, f), "utf8")]),
      );
      const stray = strayStylelintConfigs(files, packages);
      expect(stray, stray.join("\n")).toEqual([]);
    },
    STYLELINT_MS,
  );
});

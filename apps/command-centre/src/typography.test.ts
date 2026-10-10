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
import ts from "typescript";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";
import {
  cssFiles,
  paragraphClasses,
  proseOffences,
  cssSizeOffences,
  customProperties,
  filesUnder,
  inlineSizeOffences,
  rel,
  sourceFiles,
  treeRoots,
} from "./testing/sizeScan";

// ------------------------------------------------------------------- tests

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
 * The classes of `<p>` elements that are labels, counters, key hints or
 * metadata, not sentences: design.md keeps these at 12px (`--fs-2`) and wants
 * running text (paragraphs, descriptions, messages) at 13px (`--fs-3`) or more.
 * Each entry says why it is not running text; a class not listed here that a
 * `<p>` carries is held to 13px.
 */
const MICROCOPY: Record<string, string> = {
  mono: "monospace utility for data (ids, paths, commands, cron expressions), not a sentence",
  meta: "metadata line of a list row (author, count, age)",
  label: "a field or stat label",
  k: "the key of a key/value pair",
  v: "the value of a key/value pair",
  sub: "the subtitle of a tooltip or row: a name and a count",
  cp: "a name chip in the journal widget",
  "brain-preview-path": "a file path",
  "approval-inline-cwd": "a working-directory path",
  "bs-sheet-path": "a file path",
  "file-path": "a file path",
  "run-id": "a run id",
  "nu-keys": "key hints",
  "sks-keys": "key hints",
  "pxs-shortcuts": "key hints",
  "apps-run-hint": "a key hint (the keys are `kbd` elements)",
  "sks-eyebrow": "an uppercase eyebrow",
  "nu-focus-eyebrow": "an uppercase eyebrow",
  "nu-focus-pos": "the position counter of the focus queue",
  "bs-eyebrow": "an uppercase eyebrow",
  "bs-rail-kind": "a kind label",
  "bs-link-kind": "a kind label",
  "inbox-section": "an uppercase section label",
  "settings-group-label": "an uppercase group label",
  "sks-tags": "tags: metadata",
  "sks-state": "a state counter line",
  "sks-count": "a counter",
  "rs-sub": "run metadata (provider, age)",
  "run-sheet-line": "run metadata on one line",
  "nu-focus-err": "a monospace error trace (the focus card's `mono` line)",
};

describe("running text", () => {
  it("C15 paragraphs, descriptions and messages are at least 13px", () => {
    const props = customProperties([postcss.parse(":root { --fs-2: 12px; --fs-3: 13px; }")]);
    const probe = (css: string, classes = ["note"], exempt: string[] = []) =>
      proseOffences([{ file: "probe.css", css }], new Set(classes), new Set(exempt), props);
    // Self-test: a rule that sets small text on a paragraph, or on a class a paragraph carries, is found…
    expect(probe(".note { font-size: 12px }")).toHaveLength(1);
    expect(probe(".note { font-size: var(--fs-2) }")).toHaveLength(1);
    expect(probe(".card .note { font: 400 var(--fs-2) / 1.4 var(--font) }")).toHaveLength(1);
    expect(probe("p { font-size: 12px }", [])).toHaveLength(1);
    expect(probe(".panel p { font-size: var(--fs-2) }", [])).toHaveLength(1);
    expect(probe("p.lead { font-size: 12.5px }", [])).toHaveLength(1);
    expect(probe("@media (max-width: 600px) { .note { font-size: 12px } }")).toHaveLength(1);
    // …and 13px or more, a class no paragraph carries, a rule about a child, and a listed microcopy class are not.
    expect(probe(".note { font-size: var(--fs-3) }")).toEqual([]);
    expect(probe(".note { font-size: 1rem }")).toEqual([]);
    expect(probe(".other { font-size: 12px }")).toEqual([]);
    expect(probe(".note b { font-size: 12px }")).toEqual([]);
    expect(probe(".note.tiny { font-size: 12px }", ["note"], ["tiny"])).toEqual([]);
    expect(probe(".note { color: red }")).toEqual([]);

    const classes = new Set<string>();
    for (const f of sourceFiles())
      for (const c of paragraphClasses(f, readFileSync(f, "utf8"))) classes.add(c);
    expect([...paragraphClasses("a.tsx", 'const a = <p className="one two">x</p>;')].sort()).toEqual([
      "one",
      "two",
    ]);
    expect(
      [...paragraphClasses("a.tsx", "const a = <p className={`one ${b ? 'two' : ''}`}>x</p>;")].sort(),
    ).toEqual(["one", "two"]);
    expect([...paragraphClasses("a.tsx", 'const a = <div className="one">x</div>;')]).toEqual([]);
    expect(classes.size).toBeGreaterThan(40);

    const tokens = customProperties(treeRoots());
    const offenders = proseOffences(
      cssFiles().map((file) => ({ file, css: readFileSync(file, "utf8") })),
      classes,
      new Set(Object.keys(MICROCOPY)),
      tokens,
    );
    expect(offenders, offenders.join("\n")).toEqual([]);

    // No listed class has gone unused.
    const unused = Object.keys(MICROCOPY).filter((c) => !classes.has(c));
    expect(unused, `not carried by any <p> any more (drop the entry): ${unused.join(", ")}`).toEqual([]);
  });
});

// ------------------------------------------------- canvas text, at runtime

/** Where a source draws canvas text: `x.fillText(...)` and `x.strokeText(...)` call sites. */
function canvasTextSites(file: string, code: string): number[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      /^(fill|stroke)Text$/.test(n.expression.name.text)
    )
      lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

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
    expect(canvasTextSites("a.ts", "const fillTextStyle = 1; fillText(t); ctx.fillTextAt(t);")).toEqual([]);

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
      expect(pkg.scripts["lint:css"]).toBe('stylelint "apps/command-centre/src/**/*.css"');
      expect(pkg["lint-staged"]["*.css"]).toEqual(
        expect.arrayContaining([expect.stringMatching(/^stylelint /)]),
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
    },
    STYLELINT_MS,
  );

  it(
    "C6 the tree passes the colour lint",
    async () => {
      const run = spawnSync("npx", ["stylelint", "apps/command-centre/src/**/*.css"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
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
      for (const other of [
        ".stylelintignore",
        ".stylelintrc",
        ".stylelintrc.json",
        "stylelint.config.js",
        ".stylelintrc.js",
      ])
        expect(existsSync(join(repoRoot, other)), other).toBe(false);
      expect(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).stylelint).toBeUndefined();
    },
    STYLELINT_MS,
  );
});

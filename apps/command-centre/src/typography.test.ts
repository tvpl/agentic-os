/**
 * Design-system guards. Type scale (refino item 13): every `font-size` in the
 * app's CSS is a token from theme.css, and no text is drawn below 12px — not
 * through `font-size`, the `font` shorthand, a token, a relative unit, an
 * inline `style`, nor canvas text. Colour: a colour literal exists only in
 * the token blocks of theme.css, and the stylelint config that says so
 * actually refuses one. The sources are read as trees (postcss for CSS, the
 * TypeScript AST for TS/TSX), never as lines.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import postcss, { type Declaration, type Root } from "postcss";
import stylelint from "stylelint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** The floor: no text below this many CSS pixels. */
const FLOOR = 12;

function filesUnder(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, test));
    else if (test(name)) out.push(p);
  }
  return out;
}

const cssFiles = () => filesUnder(__dirname, (n) => n.endsWith(".css"));
const rel = (file: string) => file.replace(__dirname, "src");

// ---------------------------------------------------------------- CSS sizes

/** Every custom property declared anywhere in the given roots: name -> each value it takes. */
function customProperties(roots: Root[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const root of roots)
    root.walkDecls(/^--/, (d) => {
      const list = out.get(d.prop) ?? [];
      list.push(d.value);
      out.set(d.prop, list);
    });
  return out;
}

/** Sizes the browser knows by name. `smaller` depends on the parent: unbounded below. */
const SIZE_KEYWORDS: Record<string, number> = {
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
  "xxx-large": 48,
};
/** Values that take the parent's size (already held to the floor) or the initial 16px. */
const INHERITING = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "larger"]);

/**
 * The smallest size, in px, a CSS length expression can resolve to; `null` when
 * it cannot be bounded (an unknown variable, `smaller`, an unknown unit).
 * Units: px; rem at the 16px root; em and % against a 12px parent (the floor
 * itself, the smallest any parent text may be); viewport and container units
 * at 0 (the narrowest window). clamp() is its minimum, min() its smallest
 * argument, max() its largest known one.
 */
function lowerBound(src: string, props: Map<string, string[]>, seen: string[] = []): number | null {
  let i = 0;
  const s = src.trim();
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const args = (): string[] => {
    // at '(' : split the argument list at top-level commas
    const out: string[] = [];
    let depth = 0;
    let start = ++i;
    for (; i < s.length; i++) {
      const c = s[i]!;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    out.push(s.slice(start, i));
    i++; // ')'
    return out;
  };
  const factor = (): number | null => {
    ws();
    const fn = /^([a-z-]+)\(/i.exec(s.slice(i));
    if (fn) {
      const name = fn[1]!.toLowerCase();
      i += name.length;
      const list = args();
      if (name === "var") {
        const [prop, ...fb] = list.map((a) => a.trim());
        const values = props.get(prop!);
        if (values && !seen.includes(prop!)) {
          const bounds = values.map((v) => lowerBound(v, props, [...seen, prop!]));
          if (bounds.some((b) => b === null)) return null;
          return Math.min(...(bounds as number[]));
        }
        return fb.length ? lowerBound(fb.join(","), props, seen) : null;
      }
      const bounds = list.map((a) => lowerBound(a, props, seen));
      if (name === "calc") return bounds[0] ?? null;
      if (name === "clamp") return bounds[0] ?? null;
      if (name === "min") return bounds.some((b) => b === null) ? null : Math.min(...(bounds as number[]));
      if (name === "max") {
        const known = bounds.filter((b): b is number => b !== null);
        return known.length ? Math.max(...known) : null;
      }
      return null;
    }
    if (s[i] === "(") {
      const inner = args();
      return lowerBound(inner.join(","), props, seen);
    }
    const num = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      const n = parseFloat(num[1]!);
      const unit = num[2]!.toLowerCase();
      if (unit === "" || unit === "px") return n;
      if (unit === "rem") return n * 16;
      if (unit === "em") return n * FLOOR;
      if (unit === "%") return (n / 100) * FLOOR;
      if (unit === "pt") return (n * 4) / 3;
      if (/^(s|l|d)?v(w|h|i|b|min|max)$|^cq(w|h|i|b|min|max)$/.test(unit)) return 0;
      return null;
    }
    const word = /^[a-z-]+/i.exec(s.slice(i));
    if (word) {
      i += word[0].length;
      const k = word[0].toLowerCase();
      return k in SIZE_KEYWORDS ? SIZE_KEYWORDS[k]! : null;
    }
    return null;
  };
  const product = (): number | null => {
    let v = factor();
    for (;;) {
      ws();
      const op = s[i];
      if (op !== "*" && op !== "/") return v;
      i++;
      const r = factor();
      if (v === null || r === null) v = null;
      else v = op === "*" ? v * r : r === 0 ? null : v / r;
    }
  };
  const sum = (): number | null => {
    let v = product();
    for (;;) {
      ws();
      const op = s[i];
      if (op !== "+" && op !== "-") return v;
      i++;
      const r = product();
      v = v === null || r === null ? null : op === "+" ? v + r : v - r;
    }
  };
  const v = sum();
  ws();
  return i < s.length ? null : v;
}

/** Split a value at top-level spaces and slashes, keeping functions whole. */
function topLevelParts(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const c of value) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && /\s/.test(c)) flush();
    else if (depth === 0 && c === "/") {
      flush();
      out.push("/");
    } else cur += c;
  }
  flush();
  return out;
}

const FONT_PREFIX =
  /^(normal|italic|oblique|small-caps|bold|bolder|lighter|(ultra-|extra-|semi-)?(condensed|expanded)|\d{1,4})$/i;
const SYSTEM_FONTS = new Set(["caption", "icon", "menu", "message-box", "small-caption", "status-bar"]);

/** The size part of a `font` shorthand, or null when it sets none (`font: inherit`). */
function shorthandSize(value: string): string | null {
  const parts = topLevelParts(value.replace(/!important/i, ""));
  if (parts.length === 1 && (INHERITING.has(parts[0]!) || SYSTEM_FONTS.has(parts[0]!))) return null;
  const slash = parts.indexOf("/");
  if (slash > 0) return parts[slash - 1]!;
  return parts.find((p) => !FONT_PREFIX.test(p)) ?? null;
}

/** Why a declaration sets text below the floor, or null when it does not. */
function sizeOffence(decl: Pick<Declaration, "prop" | "value">, props: Map<string, string[]>): string | null {
  const prop = decl.prop.toLowerCase();
  let size: string | null;
  if (prop === "font-size") size = decl.value.replace(/!important/i, "").trim();
  else if (prop === "font") size = shorthandSize(decl.value);
  else if (/^--fs-/.test(prop)) size = decl.value.trim();
  else return null;
  if (size === null || INHERITING.has(size)) return null;
  // `font-size: 0` hides a label's text behind its glyph: nothing is drawn.
  if (prop === "font-size" && size === "0") return null;
  const min = lowerBound(size, props);
  if (min === null) return `cannot be bounded: ${size}`;
  if (min < FLOOR) return `resolves to ${+min.toFixed(2)}px`;
  return null;
}

function cssSizeOffences(sources: { file: string; css: string }[], extra: Root[] = []): string[] {
  const roots = sources.map(({ file, css }) => ({ file, root: postcss.parse(css, { from: file }) }));
  const props = customProperties([...extra, ...roots.map((r) => r.root)]);
  const out: string[] = [];
  for (const { file, root } of roots)
    root.walkDecls((d) => {
      const why = sizeOffence(d, props);
      if (why) out.push(`${rel(file)}:${d.source?.start?.line} ${d.prop}: ${d.value} — ${why}`);
    });
  return out;
}

const treeRoots = () => cssFiles().map((f) => postcss.parse(readFileSync(f, "utf8"), { from: f }));

// --------------------------------------------------------- TS / TSX sizes

/**
 * The smallest number an expression can evaluate to, or null when the source
 * alone cannot bound it. Literals, arithmetic on literals, Math.max/min, a
 * ternary, a `const` in the same file and `size / k` (a canvas drawn under a
 * zoom transform: on screen the text is `size`) are understood; a call to any
 * other function is not — write `Math.max(12, f(x))` there.
 */
function numberBound(e: ts.Expression, file: ts.SourceFile, seen = new Set<ts.Node>()): number | null {
  if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e))
    return numberBound(e.expression, file, seen);
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) {
    const v = numberBound(e.operand, file, seen);
    return v === null ? null : -v;
  }
  if (ts.isConditionalExpression(e)) {
    const a = numberBound(e.whenTrue, file, seen);
    const b = numberBound(e.whenFalse, file, seen);
    return a === null || b === null ? null : Math.min(a, b);
  }
  if (ts.isBinaryExpression(e)) {
    const l = numberBound(e.left, file, seen);
    const r = numberBound(e.right, file, seen);
    switch (e.operatorToken.kind) {
      case ts.SyntaxKind.SlashToken:
        if (l !== null && r !== null) return l / r;
        return l; // `size / k`: a world-space size under the canvas zoom
      case ts.SyntaxKind.AsteriskToken:
        return l === null || r === null ? null : l * r;
      case ts.SyntaxKind.PlusToken:
        return l === null || r === null ? null : l + r;
      case ts.SyntaxKind.MinusToken:
        return l === null || r === null ? null : l - r;
      default:
        return null;
    }
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const callee = e.expression.getText(file);
    const bounds = e.arguments.map((a) => numberBound(a, file, seen));
    if (callee === "Math.max") {
      const known = bounds.filter((b): b is number => b !== null);
      return known.length ? Math.max(...known) : null;
    }
    if (callee === "Math.min")
      return bounds.some((b) => b === null) ? null : Math.min(...(bounds as number[]));
    if (callee === "Math.round" || callee === "Math.floor" || callee === "Math.ceil")
      return bounds[0] == null ? null : Math.floor(bounds[0]);
    return null;
  }
  if (ts.isIdentifier(e)) {
    const local = constDeclaration(e, file);
    const [decl, home] = local ? [local, file] : (importedConst(e.text, file) ?? [null, file]);
    if (!decl?.initializer || seen.has(decl)) return null;
    return numberBound(decl.initializer, home, new Set([...seen, decl]));
  }
  return null;
}

/** `import { NAME } from "./module"` -> that module's top-level `export const NAME = …`. */
function importedConst(name: string, file: ts.SourceFile): [ts.VariableDeclaration, ts.SourceFile] | null {
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const named = st.importClause?.namedBindings;
    if (!spec.startsWith(".") || !named || !ts.isNamedImports(named)) continue;
    const el = named.elements.find((x) => x.name.text === name);
    if (!el) continue;
    const exported = (el.propertyName ?? el.name).text;
    const base = join(dirname(file.fileName), spec);
    const path = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p));
    if (!path) return null;
    const other = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const o of other.statements) {
      if (!ts.isVariableStatement(o) || !(o.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of o.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === exported) return [d, other];
    }
    return null;
  }
  return null;
}

/** The nearest `const` declaration of an identifier visible at its use, in the same file. */
function constDeclaration(id: ts.Identifier, file: ts.SourceFile): ts.VariableDeclaration | null {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    const statements: readonly ts.Statement[] | undefined =
      ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) ? scope.statements : undefined;
    if (!statements) continue;
    for (const st of statements) {
      if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === id.text && d.pos < id.pos) return d;
    }
    if (ts.isFunctionLike(scope) && scope.parameters.some((p) => p.name.getText(file) === id.text))
      return null;
  }
  return null;
}

/**
 * A canvas font string: optional style/weight words, then `<size>px`, then a
 * family that is not another length (`${x}px ${y}px` is a position).
 */
const CANVAS_FONT =
  /^\s*(?:(?:normal|italic|oblique|bold|bolder|lighter|small-caps|\d{3}|\$\{\d+\})\s+)*(\$\{(\d+)\}|\d+(?:\.\d+)?)px\s+(?!\$\{\d+\}(?:px|%|r?em|deg)|-?[\d.]+(?:px|%|r?em)?(?:\s|,|$)|(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden|var\(|rgba?\(|hsla?\(|#))\S/;

function inlineSizeOffences(file: string, text: string, props: Map<string, string[]>): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const at = (n: ts.Node) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (node: ts.Node) => {
    // style={{ fontSize: … }}, any style object with a fontSize, and el.style.fontSize = …
    const sizeValue =
      ts.isPropertyAssignment(node) && node.name.getText(sf).replace(/["']/g, "") === "fontSize"
        ? node.initializer
        : ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) &&
            node.left.name.text === "fontSize"
          ? node.right
          : null;
    if (sizeValue) {
      const v = sizeValue;
      let min: number | null;
      if (ts.isStringLiteralLike(v)) min = lowerBound(v.text, props);
      else min = numberBound(v, sf);
      if (min === null) out.push(`${at(node)} fontSize ${v.getText(sf)} — cannot be bounded`);
      else if (min < FLOOR) out.push(`${at(node)} fontSize ${v.getText(sf)} — ${min}px`);
    }
    // canvas font strings: "11px mono", `500 ${size}px ${family}`
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      let shape: string;
      const holes: ts.Expression[] = [];
      if (ts.isTemplateExpression(node)) {
        shape = node.head.text;
        node.templateSpans.forEach((span, k) => {
          holes.push(span.expression);
          shape += `\${${k}}${span.literal.text}`;
        });
      } else shape = node.text;
      const m = CANVAS_FONT.exec(shape);
      if (m) {
        const min = m[2] !== undefined ? numberBound(holes[Number(m[2])]!, sf) : Number(m[1]);
        const src = ts.isTemplateExpression(node) ? node.getText(sf) : JSON.stringify(shape);
        if (min === null) out.push(`${at(node)} canvas font ${src} — size cannot be bounded`);
        else if (min < FLOOR) out.push(`${at(node)} canvas font ${src} — ${+min.toFixed(2)}px`);
      }
    }
    // "500 " + size + "px mono": font strings are templates here
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      ts.isStringLiteralLike(node.right) &&
      /^px\s+\S/.test(node.right.text)
    )
      out.push(`${at(node)} font string built with + — use a template literal`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const sourceFiles = () =>
  // Tests are left out: their font strings feed fake canvases, nothing is drawn on a screen.
  filesUnder(__dirname, (n) => /\.(ts|tsx)$/.test(n) && !/\.d\.ts$|\.test\.tsx?$/.test(n));

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
    // …and the sizes the scale allows are not.
    expect(probe("a { font: inherit }")).toEqual([]);
    expect(probe("a { font-size: var(--fs-2) !important }")).toEqual([]);
    expect(probe("a { font: 600 var(--fs-3) / 1 var(--font-display) }")).toEqual([]);
    expect(probe("a { font: 500 var(--fs-2) var(--font-mono) }")).toEqual([]);
    expect(probe("a { font-size: clamp(var(--fs-2), 1.3vw + 6px, 26px) }")).toEqual([]);
    expect(probe("a { font-size: max(var(--fs-2), 0.84em) }")).toEqual([]);
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
    expect(probe("ctx.font = `700 ${12 / k}px ${font}`;")).toEqual([]);
    expect(probe("const fs = Math.max(12, w * 0.02);\nx.font = `500 ${fs}px ${mono}`;")).toEqual([]);
    expect(probe("const f = `600 ${Math.max(12, groupPx(s))}px ${tk.display}`;")).toEqual([]);
    expect(probe("el.style.transform = `translate(${x}px, ${y}px)`;")).toEqual([]);
    expect(probe("el.style.backgroundPosition = `${x}px ${y}px`;")).toEqual([]);
    expect(probe(`el.style.boxShadow = "0 2px 8px rgba(0,0,0,.4)";`)).toEqual([]);
    expect(probe(`const s = { border: "1px solid var(--border)" };`)).toEqual([]);

    const tokens = customProperties(treeRoots());
    const offenders = sourceFiles().flatMap((f) => inlineSizeOffences(f, readFileSync(f, "utf8"), tokens));
    expect(offenders, offenders.join("\n")).toEqual([]);
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
      // …and the forms the design allows are not.
      expect(await colourWarnings("a { color: var(--text); }\n")).toEqual([]);
      expect(
        await colourWarnings("a { color: color-mix(in srgb, var(--accent) 40%, transparent); }\n"),
      ).toEqual([]);
      expect(
        await colourWarnings("a {\n  background: transparent;\n  border-color: currentColor;\n}\n"),
      ).toEqual([]);
      expect(await colourWarnings("a { mask-image: linear-gradient(var(--mask-ink) 0 0); }\n")).toEqual([]);
    },
    STYLELINT_MS,
  );

  it(
    "C6 the tree passes the colour lint",
    () => {
      const run = spawnSync("npx", ["stylelint", "apps/command-centre/src/**/*.css"], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      expect(run.status, run.stdout + run.stderr).toBe(0);

      // The rule is switched off only around the token blocks of theme.css.
      const offenders: string[] = [];
      for (const file of cssFiles()) {
        const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
        let off = false;
        root.walk((node) => {
          if (node.type === "comment" && /stylelint-disable/.test(node.text)) {
            if (
              !file.endsWith("theme.css") ||
              node.parent !== root ||
              !/^stylelint-disable [a-z, -]+( --|$)/.test(node.text)
            )
              offenders.push(`${rel(file)}:${node.source?.start?.line} ${node.toString()}`);
            else off = true;
          } else if (node.type === "comment" && /stylelint-enable/.test(node.text)) off = false;
          else if (off && node.parent === root && node.type !== "comment") {
            const selectors = node.type === "rule" ? node.selectors : [];
            if (!selectors.length || !selectors.every((x) => TOKEN_SELECTOR.test(x.trim())))
              offenders.push(
                `${rel(file)}:${node.source?.start?.line} is not a token block but sits where the lint is off`,
              );
          }
        });
        if (off) offenders.push(`${rel(file)} leaves the lint off to the end of the file`);
      }
      expect(offenders, offenders.join("\n")).toEqual([]);
    },
    STYLELINT_MS,
  );
});

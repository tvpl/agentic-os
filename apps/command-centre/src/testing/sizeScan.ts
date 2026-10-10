/**
 * Readers of the source tree for the design-system guards (typography.test.ts):
 * the text size every CSS rule and every TS/TSX source can set, bounded from
 * below, so a guard can say whether anything sets text under the 12px floor.
 * CSS is read with postcss and TS with the TypeScript AST, never as lines.
 * `src/testing` itself is not scanned: it holds the readers and the test
 * doubles, and draws nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import postcss, { type Declaration, type Root } from "postcss";
import ts from "typescript";
import { SIZE_KEYWORDS, SIZE_UNITS, toPx } from "./fontSize";

/** `src`, whichever file asks. */
const SRC = join(__dirname, "..");

/** The floor: no text below this many CSS pixels. */
export const FLOOR = 12;

export function filesUnder(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, test));
    else if (test(name)) out.push(p);
  }
  return out;
}

export const cssFiles = () => filesUnder(SRC, (n) => n.endsWith(".css"));
export const rel = (file: string) => file.replace(SRC, "src");

// ---------------------------------------------------------------- CSS sizes

/** Every custom property declared anywhere in the given roots: name -> each value it takes. */
export function customProperties(roots: Root[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const root of roots)
    root.walkDecls(/^--/, (d) => {
      const list = out.get(d.prop) ?? [];
      list.push(d.value);
      out.set(d.prop, list);
    });
  return out;
}

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
export function lowerBound(src: string, props: Map<string, string[]>, seen: string[] = []): number | null {
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
      return toPx(n, unit, FLOOR);
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

/** The size a declaration gives text (`font-size` value, or the size inside a `font` shorthand or an `--fs-*` token), or null when it sets none. */
function declaredSize(decl: Pick<Declaration, "prop" | "value">): string | null {
  const prop = decl.prop.toLowerCase();
  let size: string | null;
  if (prop === "font-size") size = decl.value.replace(/!important/i, "").trim();
  else if (prop === "font") size = shorthandSize(decl.value);
  else if (/^--fs-/.test(prop)) size = decl.value.trim();
  else return null;
  if (size === null || INHERITING.has(size)) return null;
  // `font-size: 0` hides a label's text behind its glyph: nothing is drawn.
  if (prop === "font-size" && size === "0") return null;
  return size;
}

/** Why a declaration sets text below the floor, or null when it does not. */
export function sizeOffence(
  decl: Pick<Declaration, "prop" | "value">,
  props: Map<string, string[]>,
  floor = FLOOR,
): string | null {
  const size = declaredSize(decl);
  if (size === null) return null;
  const min = lowerBound(size, props);
  if (min === null) return `cannot be bounded: ${size}`;
  if (min < floor) return `resolves to ${+min.toFixed(2)}px`;
  return null;
}

export function cssSizeOffences(sources: { file: string; css: string }[], extra: Root[] = []): string[] {
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

/** Running text (paragraphs, descriptions, messages) is at least this many CSS px: `--fs-3`. */
export const PROSE_FLOOR = 13;

/**
 * A class name that says "this is a sentence": `…-desc`, `…-hint`, `…-body`,
 * `…-purpose`, `…-msg`, `…-empty`, `…-sub`… (kebab-case, last word).
 */
const PROSE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROSE_WORD =
  /(?:^|-)(desc|description|purpose|body|summary|blurb|intro|lede|explain|hint|note|msg|message|empty|help|text|caption|detail|reason|why|sub|subtitle)$/;

/**
 * The classes that carry running text in a TS/TSX source: those on a `<p>`, and
 * every class-like string anywhere (a `className`, a lookup object, a prop)
 * whose last word says it is a sentence. Classes put together at runtime are
 * not seen: the browser scan (a11y.spec.ts, C15) reads the screens for those.
 */
export function proseClasses(file: string, code: string): Set<string> {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = new Set<string>();
  const add = (text: string, onlyProse: boolean) => {
    for (const c of text.split(/\s+/))
      if (c && PROSE_NAME.test(c) && (!onlyProse || PROSE_WORD.test(c))) out.add(c);
  };
  const strings = (n: ts.Node, onlyProse: boolean) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      add(n.text, onlyProse);
    ts.forEachChild(n, (c) => strings(c, onlyProse));
  };
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === "p")
      for (const a of n.attributes.properties)
        if (ts.isJsxAttribute(a) && a.name.getText(sf) === "className" && a.initializer)
          strings(a.initializer, false);
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      add(n.text, true);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export interface ProseRule {
  /** The selector as written, whitespace collapsed: the key an exemption names. */
  selector: string;
  at: string;
  why: string;
}

/**
 * Rules that set running text under 13px: those whose subject (the last
 * compound of a selector) is a `<p>`, or carries a class `classes` names.
 * The caller says which of them are labels, counters, key hints or metadata.
 */
export function proseRules(
  sources: { file: string; css: string }[],
  classes: ReadonlySet<string>,
  props: Map<string, string[]>,
): ProseRule[] {
  const out: ProseRule[] = [];
  for (const { file, css } of sources)
    postcss.parse(css, { from: file }).walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as { name: string }).name))
        return;
      for (const raw of rule.selectors) {
        const selector = raw.replace(/\s+/g, " ").trim();
        const subject = selector.split(/\s*[>+~]\s*|\s+/).pop() ?? "";
        const names = [...subject.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
        if (!/^p(?![\w-])/.test(subject) && !names.some((n) => classes.has(n))) continue;
        rule.each((d) => {
          if (d.type !== "decl") return;
          const why = sizeOffence(d, props, PROSE_FLOOR);
          if (why)
            out.push({
              selector,
              at: `${rel(file)}:${d.source?.start?.line}`,
              why: `${d.prop}: ${d.value} — ${why}`,
            });
        });
      }
    });
  return out;
}

export const treeRoots = () => cssFiles().map((f) => postcss.parse(readFileSync(f, "utf8"), { from: f }));

// --------------------------------------------------------- TS / TSX sizes

/** What a bound is computed in: the file, the parameters of the function being read, and what is on the way. */
interface Scope {
  file: ts.SourceFile;
  /** Parameter name -> lower bound of the argument it was called with (null: unknown). */
  env: ReadonlyMap<string, number | null>;
  seen: ReadonlySet<ts.Node>;
}

/**
 * The smallest number an expression can evaluate to, or null when the source
 * alone cannot bound it. Literals, arithmetic, Math.max/min/round, a ternary,
 * a `const` in the same file or imported from a relative module, and calls of
 * functions defined in the tree (their `return` expressions, with the
 * arguments' bounds bound to the parameters) are understood.
 *
 * `size / k` is read as `size` when the divisor is the identifier `k`: the
 * camera's scale in a canvas drawn under a zoom transform, where a font of
 * `size / k` lands on screen as `size`. That is a convention of the name and
 * nothing else; any other divisor (a clamped `Math.max(0.8, k)`, a sprite
 * scale) leaves the screen size unbounded here, and what the canvas draws
 * under zoom is measured at runtime (C17, `src/**` canvasText tests).
 */
export function numberBound(e: ts.Expression, file: ts.SourceFile): number | null {
  return bound(e, { file, env: new Map(), seen: new Set() });
}

function bound(e: ts.Expression, sc: Scope): number | null {
  if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e))
    return bound(e.expression, sc);
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken) {
    const v = bound(e.operand, sc);
    return v === null ? null : -v;
  }
  if (ts.isConditionalExpression(e)) {
    const a = bound(e.whenTrue, sc);
    const b = bound(e.whenFalse, sc);
    return a === null || b === null ? null : Math.min(a, b);
  }
  if (ts.isBinaryExpression(e)) {
    const l = bound(e.left, sc);
    const r = bound(e.right, sc);
    switch (e.operatorToken.kind) {
      case ts.SyntaxKind.SlashToken: {
        // A lower bound of the quotient needs an *upper* bound of the divisor: only a literal gives one.
        let d = e.right;
        while (ts.isParenthesizedExpression(d)) d = d.expression;
        if (l !== null && ts.isNumericLiteral(d)) return Number(d.text) === 0 ? null : l / Number(d.text);
        return l !== null && ts.isIdentifier(d) && d.text === "k" ? l : null;
      }
      case ts.SyntaxKind.AsteriskToken:
        // A product of lower bounds is a lower bound only when neither can be negative.
        return l === null || r === null || l < 0 || r < 0 ? null : l * r;
      case ts.SyntaxKind.PlusToken:
        return l === null || r === null ? null : l + r;
      case ts.SyntaxKind.MinusToken: {
        // `a - b` needs an *upper* bound of `b`: only a literal gives one.
        let d = e.right;
        while (ts.isParenthesizedExpression(d)) d = d.expression;
        return l !== null && ts.isNumericLiteral(d) ? l - Number(d.text) : null;
      }
      default:
        return null;
    }
  }
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sc.file);
    const bounds = e.arguments.map((a) => bound(a, sc));
    if (callee === "Math.max") {
      const known = bounds.filter((b): b is number => b !== null);
      return known.length ? Math.max(...known) : null;
    }
    if (callee === "Math.min")
      return bounds.some((b) => b === null) ? null : Math.min(...(bounds as number[]));
    if (callee === "Math.round" || callee === "Math.floor" || callee === "Math.ceil")
      return bounds[0] == null ? null : Math.floor(bounds[0]);
    if (ts.isIdentifier(e.expression)) return callBound(e.expression.text, bounds, sc);
    return null;
  }
  if (ts.isIdentifier(e)) {
    if (sc.env.has(e.text)) return sc.env.get(e.text) ?? null;
    const found = constDeclaration(e, sc.file) ?? importedDeclaration(e.text, sc.file);
    const [decl, home] = found && "decl" in found ? [found.decl, found.file] : [found, sc.file];
    if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer || sc.seen.has(decl)) return null;
    return bound(decl.initializer, { file: home, env: new Map(), seen: new Set([...sc.seen, decl]) });
  }
  return null;
}

/** The lowest value `name(...)` can return, for a function defined in this file or a relative import. */
function callBound(name: string, args: (number | null)[], sc: Scope): number | null {
  const def = functionNamed(name, sc.file);
  if (!def || sc.seen.has(def.fn)) return null;
  const env = new Map<string, number | null>();
  def.fn.parameters.forEach((p, i) => {
    if (ts.isIdentifier(p.name)) env.set(p.name.text, args[i] ?? null);
  });
  const inner: Scope = { file: def.file, env, seen: new Set([...sc.seen, def.fn]) };
  const returns: ts.Expression[] = [];
  if (def.fn.body && !ts.isBlock(def.fn.body)) returns.push(def.fn.body);
  else if (def.fn.body) collectReturns(def.fn.body, returns);
  if (!returns.length) return null;
  const bounds = returns.map((r) => bound(r, inner));
  return bounds.some((b) => b === null) ? null : Math.min(...(bounds as number[]));
}

function collectReturns(node: ts.Node, out: ts.Expression[]): void {
  if (ts.isReturnStatement(node)) {
    if (node.expression) out.push(node.expression);
    return;
  }
  if (ts.isFunctionLike(node)) return;
  ts.forEachChild(node, (c) => collectReturns(c, out));
}

type Fn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** A top-level function (declaration or `const f = () =>`) of this file or of a relative import. */
function functionNamed(name: string, file: ts.SourceFile): { fn: Fn; file: ts.SourceFile } | null {
  const inFile = (f: ts.SourceFile, wanted: string): Fn | null => {
    for (const st of f.statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === wanted) return st;
      if (ts.isVariableStatement(st))
        for (const d of st.declarationList.declarations)
          if (
            ts.isIdentifier(d.name) &&
            d.name.text === wanted &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          )
            return d.initializer;
    }
    return null;
  };
  const local = inFile(file, name);
  if (local) return { fn: local, file };
  const imported = importedModule(name, file);
  if (!imported) return null;
  const fn = inFile(imported.file, imported.exported);
  return fn ? { fn, file: imported.file } : null;
}

/** `import { name } from "./module"` -> the parsed module and the name it exports. */
function importedModule(name: string, file: ts.SourceFile): { file: ts.SourceFile; exported: string } | null {
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const named = st.importClause?.namedBindings;
    if (!spec.startsWith(".") || !named || !ts.isNamedImports(named)) continue;
    const el = named.elements.find((x) => x.name.text === name);
    if (!el) continue;
    const base = join(dirname(file.fileName), spec);
    const path = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p));
    if (!path) return null;
    return {
      file: ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true),
      exported: (el.propertyName ?? el.name).text,
    };
  }
  return null;
}

/** An imported top-level `const`, with the module it lives in. */
function importedDeclaration(
  name: string,
  file: ts.SourceFile,
): { decl: ts.VariableDeclaration; file: ts.SourceFile } | null {
  const mod = importedModule(name, file);
  if (!mod) return null;
  for (const st of mod.file.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of st.declarationList.declarations)
      if (ts.isIdentifier(d.name) && d.name.text === mod.exported) return { decl: d, file: mod.file };
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
 * A canvas font string: optional style/weight words, then a size (`<n><unit>`,
 * `${hole}<unit>` or a keyword), an optional `/line-height`, then a family that
 * is not another length (`${x}px ${y}px` is a position). Groups: 1 = hole
 * index, 2 = number, 3 = unit; or, for a keyword, 4.
 */
const FONT_WORDS = String.raw`(?:(?:normal|italic|oblique|bold|bolder|lighter|small-caps|\d{3}|\$\{\d+\})\s+)*`;
const LINE_HEIGHT = String.raw`(?:\/[\d.]+(?:${SIZE_UNITS})?)?`;
const NOT_A_FAMILY = String.raw`(?!\$\{\d+\}(?:${SIZE_UNITS}|deg)|-?[\d.]+(?:${SIZE_UNITS})?(?:\s|,|$)|(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden|var\(|rgba?\(|hsla?\(|#))\S`;
const FAMILY_AHEAD = String.raw`(?!\$\{\d+\}(?:${SIZE_UNITS}|deg))(?=["'$]|(?:ui-)?(?:monospace|sans-serif|serif|cursive|fantasy|system-ui)\b)`;
/** `px` is a font size whenever a family follows; every other unit (and a keyword) also needs a family that is unmistakably one, so `50% faster` is prose. */
const CANVAS_FONT = new RegExp(
  `^\\s*${FONT_WORDS}(?:\\$\\{(\\d+)\\}|(\\d*\\.?\\d+))(px)${LINE_HEIGHT}\\s+${NOT_A_FAMILY}`,
  "i",
);
const CANVAS_FONT_UNIT = new RegExp(
  `^\\s*${FONT_WORDS}(?:\\$\\{(\\d+)\\}|(\\d*\\.?\\d+))(${SIZE_UNITS})${LINE_HEIGHT}\\s+${FAMILY_AHEAD}`,
  "i",
);
const CANVAS_FONT_KEYWORD = new RegExp(
  `^\\s*${FONT_WORDS}(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)${LINE_HEIGHT}\\s+${FAMILY_AHEAD}`,
  "i",
);

/** `font-size: <value>` and `font: <shorthand>` declarations written inside a string (cssText, HTML `style="…"`). */
const CSS_IN_STRING = /(?:^|[;\s"'{(])(font-size|font)\s*:\s*([^;"'}]*)/gi;

const isFontSizeName = (n: string) => n.replace(/["']/g, "") === "fontSize";

/** The font-size expression a node sets, if it sets one: a property, a JSX attribute, `style.fontSize =`, `setProperty`. */
function sizeSetBy(node: ts.Node, sf: ts.SourceFile): ts.Expression | null {
  // { fontSize: 11 }, { "fontSize": … }, { ["fontSize"]: … }
  if (ts.isPropertyAssignment(node) && isFontSizeName(node.name.getText(sf).replace(/^\[|\]$/g, "")))
    return node.initializer;
  // { fontSize }
  if (ts.isShorthandPropertyAssignment(node) && node.name.text === "fontSize") return node.name;
  // <text fontSize={9} /> and <text fontSize="9" />
  if (ts.isJsxAttribute(node) && node.name.getText(sf) === "fontSize") {
    const v = node.initializer;
    return v && ts.isJsxExpression(v) ? (v.expression ?? null) : ((v as ts.Expression | undefined) ?? null);
  }
  // el.style.fontSize = …, el.style["fontSize"] = …
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === "fontSize") ||
      (ts.isElementAccessExpression(node.left) &&
        ts.isStringLiteralLike(node.left.argumentExpression) &&
        isFontSizeName(node.left.argumentExpression.text)))
  )
    return node.right;
  // el.style.setProperty("font-size", …)
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    /^(setProperty|setAttribute)$/.test(node.expression.name.text) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    /^(font-size|fontSize)$/.test(node.arguments[0].text)
  )
    return node.arguments[1] ?? null;
  return null;
}

/**
 * The text a node builds, with `${k}` standing for the k-th expression that is
 * not a string: a literal, a template, a chain of `+` (`"700 " + size + "px"`) or
 * an array joined (`["700", size, "mono"].join(" ")`). Null for anything else.
 * Only the outermost node of a chain answers, so a chain is read once.
 */
function shapeOf(node: ts.Node): { shape: string; holes: ts.Expression[] } | null {
  const holes: ts.Expression[] = [];
  const part = (n: ts.Expression): string => {
    while (ts.isParenthesizedExpression(n)) n = n.expression;
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      let t = n.head.text;
      for (const span of n.templateSpans) t += part(span.expression) + span.literal.text;
      return t;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && isStringy(n))
      return part(n.left) + part(n.right);
    holes.push(n);
    return `\${${holes.length - 1}}`;
  };
  if (ts.isStringLiteralLike(node)) return { shape: node.text, holes };
  if (ts.isTemplateExpression(node)) return { shape: part(node), holes };
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    isStringy(node) &&
    !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
  )
    return { shape: part(node), holes };
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(node.expression.expression) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  )
    return {
      shape: node.expression.expression.elements.map((e) => part(e)).join(node.arguments[0].text),
      holes,
    };
  return null;
}

/** A `+` expression with a string literal among its operands is a string. */
function isStringy(n: ts.BinaryExpression): boolean {
  const leaf = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    return (
      ts.isStringLiteralLike(e) ||
      ts.isTemplateExpression(e) ||
      (ts.isBinaryExpression(e) &&
        e.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (leaf(e.left) || leaf(e.right)))
    );
  };
  return leaf(n.left) || leaf(n.right);
}

export function inlineSizeOffences(file: string, text: string, props: Map<string, string[]>): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const at = (n: ts.Node) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (node: ts.Node) => {
    const v = sizeSetBy(node, sf);
    if (v) {
      // A bare number is px (React style, an SVG attribute); a string is a CSS length.
      const min = ts.isStringLiteralLike(v) ? lowerBound(v.text, props) : numberBound(v, sf);
      if (min === null) out.push(`${at(node)} fontSize ${v.getText(sf)} — cannot be bounded`);
      else if (min < FLOOR) out.push(`${at(node)} fontSize ${v.getText(sf)} — ${min}px`);
    }
    const sh = shapeOf(node);
    if (sh) {
      const { shape, holes } = sh;
      // canvas font strings: "11px mono", "8pt mono", "small monospace", `500 ${size}px ${family}`
      const m = CANVAS_FONT.exec(shape) ?? CANVAS_FONT_UNIT.exec(shape);
      const kw = m ? null : CANVAS_FONT_KEYWORD.exec(shape);
      if (m || kw) {
        let min: number | null;
        if (kw) min = kw[1]!.toLowerCase() in SIZE_KEYWORDS ? SIZE_KEYWORDS[kw[1]!.toLowerCase()]! : null;
        else {
          const n = m![1] !== undefined ? numberBound(holes[Number(m![1])]!, sf) : parseFloat(m![2]!);
          min = n === null ? null : toPx(n, m![3]!, FLOOR);
        }
        const src = ts.isStringLiteralLike(node) ? JSON.stringify(shape) : node.getText(sf);
        if (min === null) out.push(`${at(node)} canvas font ${src} — size cannot be bounded`);
        else if (min < FLOOR) out.push(`${at(node)} canvas font ${src} — ${+min.toFixed(2)}px`);
      }
      // CSS written in a string: cssText, an HTML `style="font-size:9px"`
      for (const css of shape.matchAll(CSS_IN_STRING)) {
        const decl = { prop: css[1]!.toLowerCase(), value: css[2]!.trim() };
        const why = /\$\{\d+\}/.test(decl.value) ? "has an interpolated size" : sizeOffence(decl, props);
        if (why) out.push(`${at(node)} ${decl.prop}: ${decl.value} in a string — ${why}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export const sourceFiles = () =>
  // Tests are left out: their font strings feed fake canvases, nothing is drawn on a screen.
  // So is src/testing: the readers and the doubles (this file names every form it looks for).
  filesUnder(SRC, (n) => /\.(ts|tsx)$/.test(n) && !/\.d\.ts$|\.test\.tsx?$/.test(n)).filter(
    (f) => !f.startsWith(join(SRC, "testing")),
  );

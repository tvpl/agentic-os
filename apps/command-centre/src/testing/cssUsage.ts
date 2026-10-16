/**
 * Reader of the stylesheets for the legacy guards (`legacy.css.test.ts`,
 * .specs/features/limpeza-legado, C4 to C6): which classes a selector names,
 * which `@keyframes` and custom properties a file defines, and which of those the
 * rules and the production source refer to. postcss reads the CSS as a tree.
 */
import postcss, { type Root } from "postcss";
import ts from "typescript";
import { spelledIn, syntax, visit, type Spelled, type Tree } from "./sourceGraph";

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

// ------------------------------------------------------------- class usage

/**
 * The classes the production source puts on an element, read only where a class is named
 * (.specs/features/limpeza-legado, C4, round 1 / F1). A word in a sentence, a translation key or an element id
 * is not a class: `empty`, `bell` and `app-${n}` spell names of the interface, not of a rule's target.
 */
export interface ClassUse {
  /** Whole class tokens: `className="a b"`, `classList.add("c")`, `querySelector(".d")`, `class="e"` in a string of HTML. */
  tokens: Set<string>;
  /** Classes only a `querySelector` and the like ask for: they say a class is looked for, not that an element carries it. */
  queried: Set<string>;
  /** `pill-` of `` `pill-${tone}` ``: the head of a class built by data. Always ends in `-` or `_`. */
  prefixes: Set<string>;
  /** `-open` of `` `${side}-open` ``: the tail. Always starts with `-` or `_`. */
  suffixes: Set<string>;
}

/** Calls whose arguments are class lists (`clsx`, `classnames` and the usual short names). */
const CLASS_HELPERS = /^(clsx|cx|cn|cls|classnames|classNames|classes)$/;
/** Properties and variables that hold a class list: `className`, `iconClass`, `rowClasses`, `cls`, `KIND_CLASS`. */
const CLASS_NAMES = /(^cls$|^backdrop$|class(es|name)?$)/i;
const SELECTOR_CALLS = new Set(["querySelector", "querySelectorAll", "closest", "matches"]);

const isLiteral = (e: ts.Node): e is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e);

/**
 * Tokens of one piece of class text; `before`/`after`: an expression sits right before / right after the piece.
 * A piece glued to an expression is a whole class when it does not end (or start) with a delimiter, because the
 * expression is usually `" open"` or `""` (`` `cons${busy ? " busy" : ""}` ``); one that ends in `-` or `_`
 * (`pill-`) is the head of a class the data completes, one that starts with `-` or `_` (`-open`) is its tail.
 */
function takeClasses(use: ClassUse, text: string, before: boolean, after: boolean): void {
  const parts = text.split(/\s+/);
  parts.forEach((part, i) => {
    if (!part) return;
    const glueBefore = before && i === 0 && !/^\s/.test(text);
    const glueAfter = after && i === parts.length - 1 && !/\s$/.test(text);
    if (glueAfter && /[-_]$/.test(part)) {
      if (!glueBefore) use.prefixes.add(part);
      return;
    }
    if (glueBefore && /^[-_]/.test(part)) {
      use.suffixes.add(part);
      return;
    }
    use.tokens.add(part);
  });
}

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
}

/** What a file declares by name: a variable's initializer, a function's body (`const root = …`, `function kindClass(k) { … }`). */
type Declarations = Map<string, ts.Node[]>;

function declarationsOf(sf: ts.SourceFile): Declarations {
  const out: Declarations = new Map();
  const add = (name: string, node: ts.Node) => (out.get(name) ?? out.set(name, []).get(name)!).push(node);
  visit(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      // `const { tone, statusKey } = pastFire(h)`: each name stands for the value the call can give.
      const names: string[] = [];
      bindingNames(n.name, names);
      for (const name of names) add(name, n.initializer);
    }
    if (ts.isFunctionDeclaration(n) && n.name && n.body) add(n.name.text, n);
  });
  return out;
}

const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * The class text an expression can evaluate to, read from its value positions only: the branches of a conditional,
 * both sides of `||`/`??`, the right of `&&`, a template and its spans, a concatenation, the items of an array or
 * the values of an object (a table of classes), the receiver of `.filter(Boolean).join(" ")`. A comparison
 * (`status === "running"`) or the condition of a conditional is not a value. A name that stands for a value the
 * same file declares (`className={root}`, `className={KIND_CLASS[kind]}`, `className={toneClass(t)}`) is followed to
 * that value; one that arrives from a parameter, a prop or another file is not, and its classes are not seen
 * (the ledger of `legacy.css.test.ts` names the ones that stay for that reason).
 */
function classText(
  use: ClassUse,
  node: ts.Node,
  decls: Declarations,
  seen = new Set<ts.Node>(),
  glue: { before: boolean; after: boolean } = { before: false, after: false },
): void {
  if (seen.has(node)) return;
  seen.add(node);
  const go = (n: ts.Node, g = { before: false, after: false }) => classText(use, n, decls, seen, g);
  if (isLiteral(node)) takeClasses(use, node.text, glue.before, glue.after);
  else if (ts.isTemplateExpression(node)) {
    takeClasses(use, node.head.text, glue.before, true);
    node.templateSpans.forEach((span, i) => {
      go(span.expression, { before: false, after: false });
      takeClasses(use, span.literal.text, true, i < node.templateSpans.length - 1 || glue.after);
    });
  } else if (ts.isConditionalExpression(node)) {
    go(node.whenTrue, glue);
    go(node.whenFalse, glue);
  } else if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) {
      go(node.left, { before: glue.before, after: true });
      go(node.right, { before: true, after: glue.after });
    } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) go(node.right, glue);
    else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      go(node.left, glue);
      go(node.right, glue);
    } else if (!COMPARISON.has(op) && op === ts.SyntaxKind.EqualsToken) go(node.right, glue);
  } else if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isSpreadElement(node)
  )
    go(node.expression, glue);
  else if (ts.isJsxExpression(node)) {
    if (node.expression) go(node.expression, glue);
  } else if (ts.isArrayLiteralExpression(node)) for (const el of node.elements) go(el);
  else if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) go(prop.initializer);
      else if (ts.isSpreadAssignment(prop)) go(prop.expression);
    }
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) go(node.expression);
  else if (ts.isIdentifier(node)) for (const d of decls.get(node.text) ?? []) go(d, glue);
  else if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee)
        ? callee.text
        : "";
    if (CLASS_HELPERS.test(name)) for (const a of node.arguments) go(a);
    else if (ts.isPropertyAccessExpression(callee)) {
      // `[…].filter(Boolean).join(" ")`, `a.concat(b)`: the receiver is the value.
      go(callee.expression, glue);
      if (name === "concat") for (const a of node.arguments) go(a);
    } else go(callee, glue);
  } else if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (!node.body) return;
    if (!ts.isBlock(node.body)) go(node.body, glue);
    else visit(node.body, (r) => ts.isReturnStatement(r) && r.expression && go(r.expression, glue));
  }
}

/** `.a` tokens of a selector string handed to `querySelector` and the like. */
function selectorClasses(use: ClassUse, text: string): void {
  for (const m of text.replace(/"[^"]*"|'[^']*'/g, "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g))
    use.queried.add(m[1]!);
}

/** `class="a b"` in a string of markup (an SVG or HTML built as text) and in the two pages. */
function markupClasses(use: ClassUse, text: string): void {
  for (const m of text.matchAll(/\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    takeClasses(use, m[1] ?? m[2] ?? "", false, false);
}

export function classUsageIn(tree: Tree, files: Iterable<string>, pages: readonly string[] = []): ClassUse {
  const use: ClassUse = { tokens: new Set(), queried: new Set(), prefixes: new Set(), suffixes: new Set() };
  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue;
    const sf = syntax(tree, file);
    const decls = declarationsOf(sf);
    const text = (node: ts.Node) => classText(use, node, decls);
    visit(sf, (n) => {
      if (isLiteral(n)) markupClasses(use, n.text);
      else if (ts.isTemplateExpression(n)) markupClasses(use, n.head.text);
      else if (ts.isJsxAttribute(n)) {
        if (n.initializer && CLASS_NAMES.test(n.name.getText())) text(n.initializer);
      } else if (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) {
        // `{ className: "a" }`, `{ iconClass: "b" }`; a table whose name says it holds classes is read below.
        if (ts.isPropertyAssignment(n) && CLASS_NAMES.test(n.name.getText())) text(n.initializer);
      } else if (ts.isVariableDeclaration(n)) {
        if (n.initializer && CLASS_NAMES.test(n.name.getText())) text(n.initializer);
      } else if (ts.isBinaryExpression(n)) {
        const op = n.operatorToken.kind;
        if (
          (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.PlusEqualsToken) &&
          CLASS_NAMES.test(n.left.getText())
        )
          text(n.right);
      } else if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : "";
        if (CLASS_HELPERS.test(name)) for (const a of n.arguments) text(a);
        else if (ts.isPropertyAccessExpression(callee) && callee.expression.getText().endsWith("classList"))
          for (const a of n.arguments) text(a);
        else if (SELECTOR_CALLS.has(name)) {
          for (const a of n.arguments) if (isLiteral(a)) selectorClasses(use, a.text);
        } else if (name === "getElementsByClassName") for (const a of n.arguments) text(a);
        else if (
          name === "setAttribute" &&
          isLiteral(n.arguments[0]!) &&
          (n.arguments[0] as ts.StringLiteral).text === "class"
        )
          text(n.arguments[1]!);
      }
    });
  }
  for (const text of pages) markupClasses(use, text);
  return use;
}

/** Is a class one the production source puts on an element, whole or under a delimited prefix or suffix? */
export function isUsedClass(use: ClassUse, name: string): boolean {
  return (
    use.tokens.has(name) ||
    [...use.prefixes].some((p) => name.length > p.length && name.startsWith(p)) ||
    [...use.suffixes].some((s) => name.length > s.length && name.endsWith(s))
  );
}

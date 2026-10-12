/**
 * Commands and shortcuts, the checks that read the source (.specs/features/
 * comandos-atalhos, C11 and C16). The source is read as a TypeScript tree,
 * never as lines; the readers have self-tests, so a reader that goes blind
 * fails here before it lets a listener through.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";
import { OUTSIDE_THE_REGISTRY, OUTSIDE_THE_REGISTRY_DEPS } from "./listenersAllowlist";

const SRC = join(__dirname, "..");

function parse(text: string, name = "sample.tsx"): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every non-test source file of the app, relative to `src`. */
const sources = () =>
  walk(SRC)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|typetest/.test(f))
    .map((f) => relative(SRC, f));

/* ---- keydown listeners on the page ---------------------------------------------------- */

/** What stands for the page: the globals, and whatever they are copied into. */
const GLOBAL_NAMES = ["window", "document", "globalThis", "self"];
/** What hangs off the page and takes the same listeners: other windows, the document's elements. */
const GLOBAL_PROPS = [
  "window",
  "document",
  "globalThis",
  "self",
  "defaultView",
  "top",
  "parent",
  "frames",
  "body",
  "documentElement",
  "head",
  "scrollingElement",
];
/** Looking up the root of the page by name. */
const ROOT_SELECTORS = ["root", "#root", "body", "html", ":root", "#modal-root", "modal-root"];
const ASSIGN_OPS = [
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
];

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ||
  ts.isAsExpression(e) ||
  ts.isNonNullExpression(e) ||
  ts.isSatisfiesExpression(e) ||
  ts.isTypeAssertionExpression(e)
    ? unwrap(e.expression)
    : e;

const isAccess = (e: ts.Node): e is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);

/** Where an imported name comes from, for constants that live in another file. */
export interface ReadOptions {
  /** The string `name` is a constant for in the module `from` (relative to the file read), if it can be read. */
  importConst?: (from: string, name: string) => string | null;
}
export interface Listeners {
  /** Keydown listeners on the page, one description each. */
  keydown: string[];
  /** Listeners on the page whose event type the reader could not read: refused, not guessed. */
  unresolved: string[];
}

/**
 * The keydown listeners a source puts on the page, read as a tree.
 *
 * What stands for "the page": `window`, `document`, `globalThis`, `self`; what
 * hangs off them (`document.body`, `documentElement`, `window.top`, `parent`,
 * `document.defaultView`, `getElementById("root")`); and whatever they are
 * copied into: variables, destructuring (`const { document: d } = window`),
 * `for…of` and `forEach` over a list that holds one, `a ?? b`, `a ? b : c`.
 * What is a listener: `addEventListener` on any of those (by dot, by bracket,
 * bare, destructured, `bind`, `.call`, `.apply`, `Reflect.apply`, or through a
 * wrapper function of the file that passes its parameter on as the type);
 * `onkeydown` set by `=`, `??=`, `||=`, `&&=`, `Object.assign`, `Reflect.set` or
 * `Object.defineProperty`. The type is read from a string, a template or a
 * `+` of strings, a constant of the file, or a constant imported from a module
 * the caller can read. A listener on an element is not one.
 *
 * The limit is explicit: the reader proves what it can read. A type it cannot
 * read is reported in `unresolved` (and the check refuses it), and a listener
 * put on the page by code the file does not contain (a library) or reached by
 * a name the reader cannot follow (an object passed in from outside) is out of
 * its sight; the runtime probe (C16) counts what reaches the page when the app
 * mounts, to cover the rest.
 */
export function readListeners(text: string, name?: string, opts: ReadOptions = {}): Listeners {
  const sf = parse(text, name);

  /* -- constants first: ids, types and keys may be spelled through them -- */
  const constants = new Map<string, string>();
  const imported = new Map<string, [from: string, name: string]>();
  visit(sf, (n) => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteralLike(n.moduleSpecifier) &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    )
      for (const el of n.importClause.namedBindings.elements)
        imported.set(el.name.text, [n.moduleSpecifier.text, (el.propertyName ?? el.name).text]);
  });
  const resolveStr = (raw: ts.Expression | undefined, depth = 0): string | null => {
    if (!raw || depth > 4) return null;
    const e = unwrap(raw);
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      let out = e.head.text;
      for (const span of e.templateSpans) {
        const v = resolveStr(span.expression, depth + 1);
        if (v === null) return null;
        out += v + span.literal.text;
      }
      return out;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = resolveStr(e.left, depth + 1);
      const r = resolveStr(e.right, depth + 1);
      return l === null || r === null ? null : l + r;
    }
    if (ts.isIdentifier(e)) {
      if (constants.has(e.text)) return constants.get(e.text)!;
      const from = imported.get(e.text);
      return from && opts.importConst ? opts.importConst(from[0], from[1]) : null;
    }
    return null;
  };
  // Constants may refer to each other: two passes are enough for the code that exists, and the
  // fixed point below makes it exact.
  for (let changed = true; changed;) {
    changed = false;
    visit(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        ts.isVariableDeclarationList(n.parent) &&
        n.parent.flags & ts.NodeFlags.Const &&
        !constants.has(n.name.text)
      ) {
        const v = resolveStr(n.initializer);
        if (v !== null) {
          constants.set(n.name.text, v);
          changed = true;
        }
      }
    });
  }

  /** The name a property access spells — by dot, by a literal, or by a constant or sum the file holds. */
  const propName = (n: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null =>
    ts.isPropertyAccessExpression(n) ? n.name.text : resolveStr(n.argumentExpression);

  /* -- names: what is the page -- */
  const names = new Set(GLOBAL_NAMES);
  const isGlobal = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    if (ts.isIdentifier(e)) return names.has(e.text);
    if (isAccess(e)) {
      const prop = propName(e);
      return prop !== null && GLOBAL_PROPS.includes(prop) && isGlobal(e.expression);
    }
    if (ts.isCallExpression(e) && isAccess(unwrap(e.expression))) {
      const callee = unwrap(e.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
      const arg = e.arguments[0];
      if (
        !["getElementById", "querySelector"].includes(propName(callee) ?? "") ||
        !isGlobal(callee.expression) ||
        arg === undefined
      )
        return false;
      // The root by name — or by a name the reader cannot read: refused, as the page.
      const id = resolveStr(arg);
      return id === null || ROOT_SELECTORS.includes(id);
    }
    if (
      ts.isBinaryExpression(e) &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
      ].includes(e.operatorToken.kind)
    )
      return isGlobal(e.left) || isGlobal(e.right);
    if (ts.isConditionalExpression(e)) return isGlobal(e.whenTrue) || isGlobal(e.whenFalse);
    return false;
  };
  const listHoldsGlobal = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    return ts.isArrayLiteralExpression(e) && e.elements.some((x) => isGlobal(x));
  };
  const alias = (id: ts.Node): boolean => {
    if (!ts.isIdentifier(id) || names.has(id.text)) return false;
    names.add(id.text);
    return true;
  };
  // Copies of copies: run to a fixed point.
  for (let changed = true; changed;) {
    changed = false;
    visit(sf, (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        if (isGlobal(n.initializer) && alias(n.name)) changed = true;
        if (ts.isObjectBindingPattern(n.name) && isGlobal(n.initializer))
          for (const el of n.name.elements)
            if (GLOBAL_PROPS.includes((el.propertyName ?? el.name).getText()) && alias(el.name))
              changed = true;
      }
      if (
        ts.isForOfStatement(n) &&
        ts.isVariableDeclarationList(n.initializer) &&
        listHoldsGlobal(n.expression) &&
        n.initializer.declarations.some((d) => alias(d.name))
      )
        changed = true;
      if (ts.isCallExpression(n) && isAccess(unwrap(n.expression))) {
        const callee = unwrap(n.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
        const fn = n.arguments[0];
        if (
          ["forEach", "map", "some", "every", "flatMap"].includes(propName(callee) ?? "") &&
          listHoldsGlobal(callee.expression) &&
          fn &&
          (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
          fn.parameters[0] &&
          alias(fn.parameters[0].name)
        )
          changed = true;
      }
    });
  }

  /* -- listener calls -- */
  const bare = new Set<string>(["addEventListener"]);
  /** `addEventListener` taken off an object (`const f = window.addEventListener`): it listens where `.call` points it. */
  const detached = new Set<string>();
  const isEventTargetProto = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    return (
      ts.isPropertyAccessExpression(e) &&
      e.name.text === "prototype" &&
      ts.isIdentifier(e.expression) &&
      ["EventTarget", "Window", "Document", "Node", "Element", "HTMLElement", "HTMLDocument"].includes(
        e.expression.text,
      )
    );
  };
  const isListenerFn = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    return isAccess(e) && propName(e) === "addEventListener";
  };
  visit(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      // `const { addEventListener } = window` / `{ addEventListener: on } = globalThis`
      if (ts.isObjectBindingPattern(n.name) && (isGlobal(n.initializer) || isEventTargetProto(n.initializer)))
        for (const el of n.name.elements)
          if ((el.propertyName ?? el.name).getText() === "addEventListener" && ts.isIdentifier(el.name))
            (isGlobal(n.initializer) ? bare : detached).add(el.name.text);
      // `const f = window.addEventListener` / `= EventTarget.prototype.addEventListener`
      if (ts.isIdentifier(n.name) && isListenerFn(n.initializer)) detached.add(n.name.text);
      // `const on = window.addEventListener.bind(window)`
      const init = unwrap(n.initializer);
      if (ts.isIdentifier(n.name) && ts.isCallExpression(init) && isAccess(unwrap(init.expression))) {
        const callee = unwrap(init.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
        if (
          propName(callee) === "bind" &&
          isListenerFn(callee.expression) &&
          (isGlobal((unwrap(callee.expression) as ts.PropertyAccessExpression).expression) ||
            (init.arguments[0] !== undefined && isGlobal(init.arguments[0])))
        )
          bare.add(n.name.text);
      }
    }
  });

  interface Match {
    who: string;
    type: ts.Expression | undefined;
  }
  /** `addEventListener` called on the page, in any of the ways: its description and the type argument. */
  const listenerCall = (n: ts.CallExpression): Match | null => {
    const callee = unwrap(n.expression);
    const [a0, a1, a2] = n.arguments;
    if (ts.isIdentifier(callee) && bare.has(callee.text)) return { who: "(bare)", type: a0 };
    if (isAccess(callee)) {
      const prop = propName(callee);
      if (prop === "addEventListener" && isGlobal(callee.expression))
        return { who: callee.expression.getText(), type: a0 };
      // f.call(thisArg, type, …) / f.apply(thisArg, [type, …]) with `f` taken off an object
      if (
        (prop === "call" || prop === "apply") &&
        ts.isIdentifier(unwrap(callee.expression)) &&
        detached.has((unwrap(callee.expression) as ts.Identifier).text) &&
        a0 !== undefined &&
        isGlobal(a0)
      )
        return {
          who: `${a0.getText()}.${(unwrap(callee.expression) as ts.Identifier).text}.${prop}`,
          type:
            prop === "call"
              ? a1
              : a1 && ts.isArrayLiteralExpression(unwrap(a1))
                ? (unwrap(a1) as ts.ArrayLiteralExpression).elements[0]
                : undefined,
        };
      // X.addEventListener.call(thisArg, type, …) / .apply(thisArg, [type, …])
      if ((prop === "call" || prop === "apply") && isListenerFn(callee.expression)) {
        const receiver = unwrap(callee.expression) as
          ts.PropertyAccessExpression | ts.ElementAccessExpression;
        const onPage = isGlobal(receiver.expression) || (a0 !== undefined && isGlobal(a0));
        if (!onPage) return null;
        const type =
          prop === "call"
            ? a1
            : a1 && ts.isArrayLiteralExpression(unwrap(a1))
              ? (unwrap(a1) as ts.ArrayLiteralExpression).elements[0]
              : undefined;
        return { who: `${a0?.getText() ?? receiver.expression.getText()}.addEventListener.${prop}`, type };
      }
      // Reflect.apply(X.addEventListener, thisArg, [type, …])
      if (prop === "apply" && callee.expression.getText() === "Reflect" && a0 && isListenerFn(a0)) {
        const receiver = unwrap(a0) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
        if (isGlobal(receiver.expression) || (a1 !== undefined && isGlobal(a1)))
          return {
            who: "Reflect.apply",
            type:
              a2 && ts.isArrayLiteralExpression(unwrap(a2))
                ? (unwrap(a2) as ts.ArrayLiteralExpression).elements[0]
                : undefined,
          };
      }
    }
    return null;
  };

  // Wrappers: a function of the file that hands one of its parameters to the page as the type.
  const wrappers = new Map<string, number>();
  visit(sf, (n) => {
    const fn = ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ? n : null;
    if (!fn) return;
    const fname = ts.isFunctionDeclaration(fn)
      ? fn.name?.text
      : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
        ? fn.parent.name.text
        : undefined;
    if (!fname) return;
    const params = fn.parameters.map((p) => p.name.getText());
    visit(fn, (m) => {
      if (!ts.isCallExpression(m)) return;
      const hit = listenerCall(m);
      const t = hit?.type && unwrap(hit.type);
      if (t && ts.isIdentifier(t) && params.includes(t.text)) wrappers.set(fname, params.indexOf(t.text));
    });
  });

  const keydown: string[] = [];
  const unresolved: string[] = [];
  const settle = (who: string, type: ts.Expression | undefined, text: string) => {
    if (!type) return;
    const v = resolveStr(type);
    if (v === null) unresolved.push(`${who}(${type.getText()})`);
    else if (v === "keydown") keydown.push(text);
  };
  visit(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const hit = listenerCall(n);
      if (hit) settle(`${hit.who}.addEventListener`, hit.type, `${hit.who}.addEventListener("keydown")`);
      else {
        const callee = unwrap(n.expression);
        if (ts.isIdentifier(callee) && wrappers.has(callee.text))
          settle(
            `${callee.text}`,
            n.arguments[wrappers.get(callee.text)!],
            `${callee.text}("keydown") through its wrapper`,
          );
        // Object.defineProperty(G, "onkeydown", …) / Reflect.set(G, "onkeydown", …) / Object.assign(G, { onkeydown })
        if (isAccess(callee)) {
          const owner = callee.expression.getText();
          const [a0, a1] = n.arguments;
          const prop = propName(callee);
          if (a0 && isGlobal(a0)) {
            if (
              ["Object.defineProperty", "Reflect.set", "Reflect.defineProperty"].includes(
                `${owner}.${prop}`,
              ) &&
              a1
            ) {
              const key = resolveStr(a1);
              if (key === null) unresolved.push(`${owner}.${prop}(${a0.getText()}, ${a1.getText()})`);
              else if (key.toLowerCase() === "onkeydown")
                keydown.push(`${a0.getText()}.onkeydown through ${owner}.${prop}`);
            }
            if (`${owner}.${prop}` === "Object.assign")
              for (const src of n.arguments.slice(1))
                if (ts.isObjectLiteralExpression(unwrap(src)))
                  for (const member of (unwrap(src) as ts.ObjectLiteralExpression).properties)
                    if (
                      member.name &&
                      member.name.getText().replace(/['"]/g, "").toLowerCase() === "onkeydown"
                    )
                      keydown.push(`${a0.getText()}.onkeydown through Object.assign`);
          }
        }
      }
    }
    if (ts.isBinaryExpression(n) && ASSIGN_OPS.includes(n.operatorToken.kind)) {
      const left = unwrap(n.left);
      if (isAccess(left) && isGlobal(left.expression)) {
        const key = propName(left);
        if (key === null)
          unresolved.push(
            `${left.expression.getText()}[${(left as ts.ElementAccessExpression).argumentExpression.getText()}] =`,
          );
        else if (key.toLowerCase() === "onkeydown") keydown.push(`${left.expression.getText()}.onkeydown`);
      }
    }
  });
  return { keydown, unresolved };
}

/** The keydown listeners only (see `readListeners`). */
function keydownListeners(text: string, name?: string, opts?: ReadOptions): string[] {
  return readListeners(text, name, opts).keydown;
}

/** Which of `names` the source declares or refers to, as identifiers or as strings. */
function namesUsed(text: string, names: string[]): string[] {
  const found = new Set<string>();
  visit(parse(text), (n) => {
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && names.includes(n.text)) found.add(n.text);
  });
  return names.filter((x) => found.has(x));
}

/** The six files the design migrates, and the whole frame, own none at all. */
const MIGRATED = [
  "App.tsx",
  "nucleo/index.tsx",
  "moldura/Moldura.tsx",
  "plugins/pixel/PixelStudio.tsx",
  "views/SecondBrain.tsx",
  "runs/RunDetail.tsx",
];

const RETIRED = ["RESET_LAYOUT_EVENT", "SHORTCUTS_EVENT", "OPEN_DECK_EVENT"];
/** The events' own names, as strings: a listener for one would be as dead as the constant. */
const RETIRED_EVENTS = ["mordomo:reset-layout", "mordomo:shortcuts", "mordomo:open-deck"];

/** The string constant `name` exported by the module `from` (relative to `file`), if the reader can read it. */
function importedConst(file: string, from: string, name: string, depth = 0): string | null {
  if (!from.startsWith(".") || depth > 3) return null;
  const base = join(file, "..", from);
  const target = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
  if (!target) return null;
  const sf = parse(readFileSync(target, "utf8"), target);
  let value: string | null = null;
  visit(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      ts.isStringLiteralLike(n.initializer)
    )
      value = n.initializer.text;
    // `export { OPEN_PANEL_EVENT } from "./x"` and `export { A as B }`
    if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier) &&
      n.exportClause &&
      ts.isNamedExports(n.exportClause)
    )
      for (const el of n.exportClause.elements)
        if (el.name.text === name)
          value ??= importedConst(
            target,
            n.moduleSpecifier.text,
            (el.propertyName ?? el.name).text,
            depth + 1,
          );
  });
  return value;
}

describe("C16 the migrated screens own no keydown listener", () => {
  it("C16 the reader sees every way to listen on the page, and only those", () => {
    const found = (code: string, opts?: ReadOptions) => keydownListeners(code, undefined, opts);
    const L = "f = () => undefined; ";
    // Each way, one by one.
    expect(found('window.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found("document.addEventListener('keydown', f, true);")).toHaveLength(1);
    expect(found("globalThis.addEventListener(`keydown`, f);")).toHaveLength(1);
    expect(found('self.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('window["addEventListener"]("keydown", f);')).toHaveLength(1);
    expect(found('(window as Window).addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('addEventListener("keydown", f);')).toHaveLength(1);
    expect(found("window.onkeydown = f; document.onkeydown = g;")).toHaveLength(2);
    expect(found('window["onkeydown"] = f;')).toHaveLength(1);
    // Assignment operators and the other ways to set a property.
    expect(found("window.onkeydown ??= f;")).toHaveLength(1);
    expect(found("window.onkeydown ||= f;")).toHaveLength(1);
    expect(found("document.onkeydown &&= f;")).toHaveLength(1);
    expect(found("Object.assign(window, { onkeydown: f });")).toHaveLength(1);
    expect(found('Object.assign(document, { "onkeydown": f });')).toHaveLength(1);
    expect(found('Reflect.set(window, "onkeydown", f);')).toHaveLength(1);
    expect(found('Object.defineProperty(document, "onkeydown", { value: f });')).toHaveLength(1);
    // Through a copy of the page, however deep, and through its parts.
    expect(found('const w = window; w.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const a = globalThis; const b = a; b.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const d = window.document; d.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const d = document.defaultView!; d.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found("let w = window as unknown as EventTarget; w.onkeydown = f;")).toHaveLength(1);
    expect(found('document.body.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('document.documentElement.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('window.top!.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('window.parent.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('document.getElementById("root")!.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('document.querySelector("body")!.onkeydown = f;')).toHaveLength(1);
    expect(found('const t = window ?? document; t.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const t = ok ? window : document; t.addEventListener("keydown", f);')).toHaveLength(1);
    // Taken off the page by destructuring.
    expect(found('const { addEventListener } = window; addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const { addEventListener: on } = globalThis; on("keydown", f);')).toHaveLength(1);
    expect(found('const { document: d } = window; d.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const { body } = document; body.addEventListener("keydown", f);')).toHaveLength(1);
    // Over a list of targets.
    expect(found('for (const t of [window, document]) t.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('[window, document.body].forEach((t) => t.addEventListener("keydown", f));')).toHaveLength(
      1,
    );
    // bind, call, apply, Reflect.apply.
    expect(found('const on = window.addEventListener.bind(window); on("keydown", f);')).toHaveLength(1);
    expect(found('window.addEventListener.call(window, "keydown", f);')).toHaveLength(1);
    expect(found('EventTarget.prototype.addEventListener.call(document, "keydown", f);')).toHaveLength(1);
    expect(found('window.addEventListener.apply(window, ["keydown", f]);')).toHaveLength(1);
    expect(found('Reflect.apply(window.addEventListener, window, ["keydown", f]);')).toHaveLength(1);
    // A wrapper of the file that hands its parameter to the page.
    expect(
      found(
        'const on = (type: string, fn: () => void) => window.addEventListener(type, fn); on("keydown", f);',
      ),
    ).toHaveLength(1);
    expect(
      found(
        'function listen(fn: () => void, type: string) { document.addEventListener(type, fn); } listen(f, "keydown");',
      ),
    ).toHaveLength(1);
    // The type read from a constant, a template, a sum, or a constant of another module.
    expect(found('const T = "keydown"; window.addEventListener(T, f);')).toHaveLength(1);
    expect(found('const D = "down"; window.addEventListener(`key${D}`, f);')).toHaveLength(1);
    expect(found('window.addEventListener("key" + "down", f);')).toHaveLength(1);
    expect(found('const K = "key"; const T = K + "down"; window.addEventListener(T, f);')).toHaveLength(1);
    const modules: Record<string, string> = { "./events": "keydown" };
    const importConst = (from: string, name: string) => (name === "TYPE" ? (modules[from] ?? null) : null);
    expect(
      found('import { TYPE } from "./events"; window.addEventListener(TYPE, f);', { importConst }),
    ).toHaveLength(1);
    expect(
      found('import { TYPE as T } from "./events"; window.addEventListener(T, f);', { importConst }),
    ).toHaveLength(1);
    // The root by a constant or a sum; a name the reader cannot read is the root as far as it is concerned.
    expect(
      found('const ID = "root"; document.getElementById(ID)!.addEventListener("keydown", f);'),
    ).toHaveLength(1);
    expect(found('document.getElementById("ro" + "ot")!.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found("document.getElementById(someId)!.addEventListener('keydown', f);")).toHaveLength(1);
    expect(found('document.getElementById("panel")!.addEventListener("keydown", f);')).toEqual([]);
    // A property named by a constant or a sum; one the reader cannot read is refused.
    expect(found('const k = "onkeydown"; window[k] = f;')).toHaveLength(1);
    expect(found('Object.defineProperty(window, "on" + "keydown", { value: f });')).toHaveLength(1);
    expect(found('const k = "on" + "keydown"; Reflect.set(document, k, f);')).toHaveLength(1);
    expect(readListeners("window[name] = f;").unresolved).toHaveLength(1);
    expect(readListeners("Object.defineProperty(window, name, { value: f });").unresolved).toHaveLength(1);
    expect(readListeners('window["title"] = f; el[name] = f;').unresolved).toEqual([]);
    // addEventListener taken off the page, or off a prototype, and pointed at the page with call/apply.
    expect(
      found('const { addEventListener: add } = EventTarget.prototype; add.call(window, "keydown", f);'),
    ).toHaveLength(1);
    expect(found('const add = window.addEventListener; add.call(window, "keydown", f);')).toHaveLength(1);
    expect(
      found('const add = EventTarget.prototype.addEventListener; add.apply(document, ["keydown", f]);'),
    ).toHaveLength(1);
    expect(
      found('const { addEventListener: add } = EventTarget.prototype; add.call(el, "keydown", f);'),
    ).toEqual([]);
    // Not listeners on the page.
    expect(found('canvas.addEventListener("keydown", f);')).toEqual([]);
    expect(found('el.onkeydown = f; this.addEventListener("keydown", f);')).toEqual([]);
    expect(found('window.addEventListener("keyup", f); window.addEventListener("resize", f);')).toEqual([]);
    expect(found('const w = el; w.addEventListener("keydown", f);')).toEqual([]);
    expect(found('const { other } = window; other("keydown", f);')).toEqual([]);
    expect(found("window.addEventListener(LAUNCHER_EVENT, f);")).toEqual([]);
    expect(found('[a, b].forEach((t) => t.addEventListener("keydown", f));')).toEqual([]);
    expect(found('const on = (type: string) => el.addEventListener(type, f); on("keydown");')).toEqual([]);
    expect(found(`${L}Object.assign(el, { onkeydown: f });`)).toEqual([]);
    // A type the reader cannot read is refused, not guessed.
    const read = (code: string) => readListeners(code).unresolved;
    expect(read("window.addEventListener(kind, f);")).toHaveLength(1);
    expect(read("document.body.addEventListener(events[0], f);")).toHaveLength(1);
    expect(read('import { TYPE } from "./elsewhere"; window.addEventListener(TYPE, f);')).toHaveLength(1);
    expect(read("el.addEventListener(kind, f);")).toEqual([]);
    expect(read('window.addEventListener("resize", f);')).toEqual([]);
    // Retired names, as identifiers and as strings.
    expect(namesUsed("export const RESET_LAYOUT_EVENT = 1; f(SHORTCUTS_EVENT); g(OTHER);", RETIRED)).toEqual([
      "RESET_LAYOUT_EVENT",
      "SHORTCUTS_EVENT",
    ]);
    expect(namesUsed('const x = "mordomo:open-deck";', RETIRED_EVENTS)).toEqual(["mordomo:open-deck"]);
  });

  it(
    "C16 the migrated screens and the whole frame own none; the rest are the ones listed, and counted",
    { timeout: 60_000 },
    () => {
      const all = sources();
      expect(all.length).toBeGreaterThan(100);
      const frame = all.filter((f) => f.startsWith("moldura/"));
      expect(frame).toEqual(expect.arrayContaining(["moldura/useFrameLayout.ts", "moldura/BellPopover.tsx"]));
      const perFile = new Map<string, string[]>();
      const unresolved: string[] = [];
      for (const file of all) {
        const path = join(SRC, file);
        const here = readListeners(readFileSync(path, "utf8"), file, {
          importConst: (from, name) => importedConst(path, from, name),
        });
        if (here.keydown.length > 0) perFile.set(file, here.keydown);
        unresolved.push(...here.unresolved.map((u) => `${file}: ${u}`));
      }
      // Every listener on the page has a type the reader can read: the ones it cannot are refused.
      expect(unresolved).toEqual([]);
      for (const file of [...MIGRATED, ...frame]) expect(perFile.get(file) ?? [], file).toEqual([]);
      // Exactly the allowlist: a new listener is a new line there, with its reason, or it is a command.
      expect(Object.fromEntries([...perFile].map(([f, l]) => [f, l.length]))).toEqual(
        Object.fromEntries(Object.entries(OUTSIDE_THE_REGISTRY).map(([f, [n]]) => [f, n])),
      );
      for (const [file, [, why]] of Object.entries(OUTSIDE_THE_REGISTRY))
        expect(why.length, file).toBeGreaterThan(20);
    },
  );

  it("C16 no retired event is defined, used or listened for", { timeout: 60_000 }, () => {
    for (const file of sources())
      expect(namesUsed(readFileSync(join(SRC, file), "utf8"), [...RETIRED, ...RETIRED_EVENTS]), file).toEqual(
        [],
      );
  });
});

describe("C18 the keyboard listeners of the dependencies are listed like the app's", () => {
  /** The Radix packages the app installed (the six it asks for and what they pull in), by name. */
  const radix = () => {
    const dir = join(SRC, "..", "..", "..", "node_modules", "@radix-ui");
    return readdirSync(dir).map((name) => ({
      name: `@radix-ui/${name}`,
      dist: join(dir, name, "dist", "index.mjs"),
    }));
  };
  /** How many places of a package's code add a `keydown` listener to the document or window. */
  const keydownSites = (code: string) =>
    (code.match(/(?:document|window|ownerDocument)\s*\.addEventListener\(\s*["']keydown["']/g) ?? []).length;

  it("C18 the reader finds a listener in a package's code, in either spelling", () => {
    expect(keydownSites('document.addEventListener("keydown", f, { capture: true });')).toBe(1);
    expect(keydownSites("ownerDocument.addEventListener('keydown', f);")).toBe(1);
    expect(
      keydownSites('window.addEventListener("keydown", f); document.addEventListener("keydown", g);'),
    ).toBe(2);
    expect(keydownSites('el.addEventListener("keydown", f); document.addEventListener("keyup", f);')).toBe(0);
  });

  it("C18 the packages that listen are exactly the listed ones, with the counts, and no entry is for a file that is gone", () => {
    const found = radix()
      .filter((p) => existsSync(p.dist))
      .map((p) => [p.name, keydownSites(readFileSync(p.dist, "utf8"))] as const)
      .filter(([, n]) => n > 0);
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries(Object.entries(OUTSIDE_THE_REGISTRY_DEPS).map(([name, [n]]) => [name, n])),
    );
    for (const [name, [, why]] of Object.entries(OUTSIDE_THE_REGISTRY_DEPS)) {
      expect(why.length, name).toBeGreaterThan(20);
      expect(name.startsWith("@radix-ui/"), name).toBe(true);
    }
    for (const file of Object.keys(OUTSIDE_THE_REGISTRY))
      expect(existsSync(join(SRC, file)), file).toBe(true);
    // The two files the dialog machinery used to be in no longer listen.
    expect(Object.keys(OUTSIDE_THE_REGISTRY)).not.toContain("components/dialog.tsx");
    expect(Object.keys(OUTSIDE_THE_REGISTRY)).not.toContain("components/primitives.tsx");
  });
});

describe("C11 no sheet string is left without a screen that shows it", () => {
  it(
    "C11 the hand-written sheet's strings are gone, and each one left is shown by a screen",
    { timeout: 60_000 },
    () => {
      // The hand-written sheet had a "Scenes" heading whose two values were swapped; the sheet is
      // generated now, so the key is gone — and no `shell.shortcuts.*` string may outlive its screen.
      for (const lang of ["en", "pt-BR"] as const)
        expect(Object.keys(dictionaries[lang]), lang).not.toContain("shell.shortcuts.desktop");
      const used = new Set<string>();
      for (const file of sources().filter((f) => !f.startsWith("locales/")))
        visit(parse(readFileSync(join(SRC, file), "utf8"), file), (n) => {
          if (ts.isStringLiteralLike(n) && n.text.startsWith("shell.shortcuts.")) used.add(n.text);
        });
      expect(used.size).toBeGreaterThan(3);
      for (const lang of ["en", "pt-BR"] as const)
        for (const key of Object.keys(dictionaries[lang]).filter((k) => k.startsWith("shell.shortcuts.")))
          expect(used.has(key), `${lang} ${key} is shown by no screen`).toBe(true);
    },
  );
});

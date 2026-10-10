/**
 * Commands and shortcuts, the checks that read the source (.specs/features/
 * comandos-atalhos, C11 and C16). The source is read as a TypeScript tree,
 * never as lines; the readers have self-tests, so a reader that goes blind
 * fails here before it lets a listener through.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";

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
const GLOBAL_PROPS = ["window", "document", "globalThis", "self", "defaultView"];

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) ||
  ts.isAsExpression(e) ||
  ts.isNonNullExpression(e) ||
  ts.isSatisfiesExpression(e)
    ? unwrap(e.expression)
    : e;

const propName = (n: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null =>
  ts.isPropertyAccessExpression(n)
    ? n.name.text
    : ts.isStringLiteralLike(n.argumentExpression)
      ? n.argumentExpression.text
      : null;

/**
 * `window`/`document`/`globalThis`/`self`, however reached: through a variable
 * they were copied into (`const w = window`), through each other
 * (`window.document`, `document.defaultView`) and through a cast.
 */
function globalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set(GLOBAL_NAMES);
  const isGlobal = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    if (ts.isIdentifier(e)) return names.has(e.text);
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const prop = propName(e);
      return prop !== null && GLOBAL_PROPS.includes(prop) && isGlobal(e.expression);
    }
    return false;
  };
  // Copies of copies: run to a fixed point.
  for (let changed = true; changed;) {
    changed = false;
    visit(sf, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && !names.has(n.name.text))
        if (isGlobal(n.initializer)) {
          names.add(n.name.text);
          changed = true;
        }
    });
  }
  return names;
}

/** Strings a name is a constant for in this file (`const TYPE = "keydown"`). */
function stringConstants(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  visit(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isStringLiteralLike(unwrap(n.initializer)) &&
      ts.isVariableDeclarationList(n.parent) &&
      n.parent.flags & ts.NodeFlags.Const
    )
      out.set(n.name.text, (unwrap(n.initializer) as ts.StringLiteralLike).text);
  });
  return out;
}

/**
 * The keydown listeners a source puts on the page: `addEventListener("keydown")`
 * on the window or the document (by any name they go by, or bare), with the
 * type spelled as a string, a template without holes or a constant of the
 * file; `addEventListener` taken off the page by destructuring; and
 * `onkeydown =`. A listener on an element (a canvas) is not one. A type that
 * cannot be read in the file (imported, computed) is not reported: the reader
 * says what it can prove.
 */
function keydownListeners(text: string, name?: string): string[] {
  const sf = parse(text, name);
  const names = globalNames(sf);
  const constants = stringConstants(sf);
  const isGlobal = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    if (ts.isIdentifier(e)) return names.has(e.text);
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const prop = propName(e);
      return prop !== null && GLOBAL_PROPS.includes(prop) && isGlobal(e.expression);
    }
    return false;
  };
  const typeOf = (arg: ts.Expression | undefined): string | null => {
    if (!arg) return null;
    const e = unwrap(arg);
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isIdentifier(e)) return constants.get(e.text) ?? null;
    return null;
  };
  // `const { addEventListener } = window` / `const { addEventListener: on } = globalThis`.
  const bare = new Set<string>(["addEventListener"]);
  visit(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isObjectBindingPattern(n.name) &&
      n.initializer &&
      isGlobal(n.initializer)
    )
      for (const el of n.name.elements)
        if ((el.propertyName ?? el.name).getText() === "addEventListener" && ts.isIdentifier(el.name))
          bare.add(el.name.text);
  });

  const found: string[] = [];
  visit(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      let who: string | null = null;
      if (ts.isIdentifier(callee) && bare.has(callee.text)) who = "(bare)";
      else if (
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        propName(callee) === "addEventListener" &&
        isGlobal(callee.expression)
      )
        who = callee.expression.getText();
      if (who && typeOf(n.arguments[0]) === "keydown") found.push(`${who}.addEventListener("keydown")`);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(n.left);
      if (
        (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) &&
        propName(left)?.toLowerCase() === "onkeydown" &&
        isGlobal(left.expression)
      )
        found.push(`${left.expression.getText()}.onkeydown`);
    }
  });
  return found;
}

/** Which of `names` the source declares or refers to, as identifiers or as strings. */
function namesUsed(text: string, names: string[]): string[] {
  const found = new Set<string>();
  visit(parse(text), (n) => {
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && names.includes(n.text)) found.add(n.text);
  });
  return names.filter((x) => found.has(x));
}

/**
 * The listeners that stay on the page outside the registry, file by file: how
 * many, and why they are not commands. Anything else is a command (door 1) —
 * the registry's one listener is the only place a key reaches the page.
 */
const OUTSIDE_THE_REGISTRY: Record<string, [count: number, why: string]> = {
  "commands/registry.ts": [1, "the one listener of the key manager"],
  "components/dialog.tsx": [
    1,
    "the dialog stack: Escape and Tab of the dialog on top, stopped before they leave it",
  ],
  "components/primitives.tsx": [1, "a popover's own Escape, captured while it is open"],
  "nucleo/pending/FocusMode.tsx": [
    1,
    "the focus mode is a layer of its own: while it is up it is the only surface (design: stays)",
  ],
  "onboarding/useTourSurface.ts": [1, "the guided tour owns the keyboard while it is up (design: stays)"],
  "runs/Replay.tsx": [1, "the replay's own transport keys (design: stays)"],
  "nucleo/scenes/SkillsScene.tsx": [
    2,
    "the Skills ring's type-to-find (design: stays) and its sheet's Escape, captured before the shell's",
  ],
  "nucleo/scenes/BrainScene.tsx": [
    2,
    "the constellation's Escape chain, captured before the shell's, and Shift+1-4 for its four arrangements",
  ],
  "nucleo/scenes/RunsScene.tsx": [
    1,
    "Escape steps back one thing at a time (the run, then the zoom), captured before the shell's",
  ],
  "nucleo/scenes/RoutinesScene.tsx": [1, "Escape closes the classic sheet, captured before the shell's"],
  "nucleo/NucleoScene.tsx": [1, "Escape folds the bloomed core, before the shell's"],
};

/** The six files the design migrates, and the whole frame, own none at all. */
const MIGRATED = [
  "App.tsx",
  "nucleo/index.tsx",
  "moldura/Moldura.tsx",
  "views/PixelStudio.tsx",
  "views/SecondBrain.tsx",
  "runs/RunDetail.tsx",
];

const RETIRED = ["RESET_LAYOUT_EVENT", "SHORTCUTS_EVENT", "OPEN_DECK_EVENT"];
/** The events' own names, as strings: a listener for one would be as dead as the constant. */
const RETIRED_EVENTS = ["mordomo:reset-layout", "mordomo:shortcuts", "mordomo:open-deck"];

describe("C16 the migrated screens own no keydown listener", () => {
  it("C16 the reader sees every way to listen on the page, and only those", () => {
    const found = (code: string) => keydownListeners(code);
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
    // Through a copy of the page, however deep, and through its parts.
    expect(found('const w = window; w.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const a = globalThis; const b = a; b.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const d = window.document; d.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const d = document.defaultView!; d.addEventListener("keydown", f);')).toHaveLength(1);
    expect(found("let w = window as unknown as EventTarget; w.onkeydown = f;")).toHaveLength(1);
    // Taken off the page by destructuring.
    expect(found('const { addEventListener } = window; addEventListener("keydown", f);')).toHaveLength(1);
    expect(found('const { addEventListener: on } = globalThis; on("keydown", f);')).toHaveLength(1);
    // The type held in a constant of the file.
    expect(found('const T = "keydown"; window.addEventListener(T, f);')).toHaveLength(1);
    // Not listeners on the page.
    expect(found('canvas.addEventListener("keydown", f);')).toEqual([]);
    expect(found('el.onkeydown = f; this.addEventListener("keydown", f);')).toEqual([]);
    expect(found('window.addEventListener("keyup", f); window.addEventListener("resize", f);')).toEqual([]);
    expect(found('const w = el; w.addEventListener("keydown", f);')).toEqual([]);
    expect(found('const { other } = window; other("keydown", f);')).toEqual([]);
    expect(found("window.addEventListener(LAUNCHER_EVENT, f);")).toEqual([]);
    // Retired names, as identifiers and as strings.
    expect(namesUsed("export const RESET_LAYOUT_EVENT = 1; f(SHORTCUTS_EVENT); g(OTHER);", RETIRED)).toEqual([
      "RESET_LAYOUT_EVENT",
      "SHORTCUTS_EVENT",
    ]);
    expect(namesUsed('const x = "mordomo:open-deck";', RETIRED_EVENTS)).toEqual(["mordomo:open-deck"]);
  });

  it("C16 the migrated screens and the whole frame own none; the rest are the ones listed, and counted", () => {
    const all = sources();
    expect(all.length).toBeGreaterThan(100);
    const frame = all.filter((f) => f.startsWith("moldura/"));
    expect(frame).toEqual(expect.arrayContaining(["moldura/useFrameLayout.ts", "moldura/BellPopover.tsx"]));
    const perFile = new Map<string, string[]>();
    for (const file of all) {
      const here = keydownListeners(readFileSync(join(SRC, file), "utf8"), file);
      if (here.length > 0) perFile.set(file, here);
    }
    for (const file of [...MIGRATED, ...frame]) expect(perFile.get(file) ?? [], file).toEqual([]);
    // Exactly the allowlist: a new listener is a new line here, with its reason, or it is a command.
    expect(Object.fromEntries([...perFile].map(([f, l]) => [f, l.length]))).toEqual(
      Object.fromEntries(Object.entries(OUTSIDE_THE_REGISTRY).map(([f, [n]]) => [f, n])),
    );
    for (const [file, [, why]] of Object.entries(OUTSIDE_THE_REGISTRY))
      expect(why.length, file).toBeGreaterThan(20);
  });

  it("C16 no retired event is defined, used or listened for", () => {
    for (const file of sources())
      expect(namesUsed(readFileSync(join(SRC, file), "utf8"), [...RETIRED, ...RETIRED_EVENTS]), file).toEqual(
        [],
      );
  });
});

describe("C11 no sheet string is left without a screen that shows it", () => {
  it("C11 the hand-written sheet's strings are gone, and each one left is shown by a screen", () => {
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
  });
});

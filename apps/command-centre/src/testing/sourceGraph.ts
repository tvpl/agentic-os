/**
 * Reader of the source tree for the legacy guards (`legacy.graph.test.ts`,
 * `legacy.css.test.ts`, `i18n.orphans.test.ts`; .specs/features/limpeza-legado):
 * which files an entry can reach, which exported symbols nobody uses, and which
 * words the production code spells. TypeScript is read with the compiler's
 * syntax tree, never as lines, and every reader works on a plain map of
 * path -> text so a test can hand it a tree it made up.
 *
 * It is a reader, not a bundler: a string that happens to spell a name counts as
 * a use of that name (the guards want "nothing in the product mentions it", and
 * a false "used" costs a missed removal, never a wrong one).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

/** `src`, whichever file asks. */
export const SRC = join(__dirname, "..");

/** The two pages the build serves (`index.html` and `gallery.html` load these). */
export const ENTRIES = ["main.tsx", "gallery/main.tsx"];

/** path relative to `src` (forward slashes) -> text. */
export type Tree = ReadonlyMap<string, string>;

const SOURCE = /\.(tsx?|css)$/;

/** Every `.ts`, `.tsx` and `.css` under a folder, keyed by the path relative to it. */
export function loadTree(root: string = SRC): Tree {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (SOURCE.test(name))
        out.set(relative(root, abs).split("\\").join("/"), readFileSync(abs, "utf8"));
    }
  };
  walk(root);
  return out;
}

/** A spec file: it proves things and ships nothing. */
export const isSpec = (file: string) => /\.(test|typetest)\.tsx?$/.test(file);

const parsed = new WeakMap<Tree, Map<string, ts.SourceFile>>();
/** The syntax tree of a `.ts`/`.tsx` file of the tree, parsed once. */
export function syntax(tree: Tree, file: string): ts.SourceFile {
  let cache = parsed.get(tree);
  if (!cache) parsed.set(tree, (cache = new Map()));
  let sf = cache.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, tree.get(file) ?? "", ts.ScriptTarget.Latest, true, scriptKind(file));
    cache.set(file, sf);
  }
  return sf;
}
const scriptKind = (file: string) => (file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const isScript = (file: string) => /\.tsx?$/.test(file);

export function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

// ------------------------------------------------------------------- edges

/** The file a relative specifier names, as the bundler resolves it, or null (a package, or nothing). */
export function resolveSpecifier(tree: Tree, from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(from), spec).split("\\").join("/");
  const clean = base.startsWith("./") ? base.slice(2) : base;
  const stem = clean.replace(/\.(js|jsx)$/, "");
  for (const candidate of [
    clean,
    `${clean}.ts`,
    `${clean}.tsx`,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${clean}.css`,
    `${clean}/index.ts`,
    `${clean}/index.tsx`,
  ])
    if (tree.has(candidate)) return candidate;
  return null;
}

export interface Edge {
  to: string;
  /** `import "./x"`, `export … from`, `import()`, `new URL()` or CSS `@import`. */
  how: "static" | "dynamic" | "url" | "css";
}

const stringOf = (e: ts.Expression | undefined): string | null =>
  e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null;

/** Every file `file` pulls in. */
export function edgesOf(tree: Tree, file: string): Edge[] {
  const out: Edge[] = [];
  const add = (spec: string | null, how: Edge["how"]) => {
    const to = spec === null ? null : resolveSpecifier(tree, file, spec);
    if (to) out.push({ to, how });
  };
  if (file.endsWith(".css")) {
    for (const m of (tree.get(file) ?? "").matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g))
      add(m[1]!, "css");
    return out;
  }
  if (!isScript(file)) return out;
  visit(syntax(tree, file), (n) => {
    if (ts.isImportDeclaration(n)) add(stringOf(n.moduleSpecifier), "static");
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) add(stringOf(n.moduleSpecifier), "static");
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
      add(stringOf(n.arguments[0]), "dynamic");
    else if (
      ts.isNewExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "URL" &&
      n.arguments?.length === 2 &&
      n.arguments[1]!.getText() === "import.meta.url"
    )
      add(stringOf(n.arguments[0]), "url");
  });
  return out;
}

/** Every file an entry reaches, the entries themselves included. */
export function reachable(tree: Tree, entries: readonly string[] = ENTRIES): Set<string> {
  const seen = new Set<string>();
  const stack = entries.filter((e) => tree.has(e));
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const edge of edgesOf(tree, file)) stack.push(edge.to);
  }
  return seen;
}

/** Files that are neither specs nor reached by an entry nor a declaration file. */
export function unreached(tree: Tree, entries: readonly string[] = ENTRIES): string[] {
  const hit = reachable(tree, entries);
  return [...tree.keys()]
    .filter((f) => isScript(f) && !isSpec(f) && !hit.has(f) && !f.endsWith(".d.ts"))
    .sort();
}

/** The edges that cross into the files `target` picks, from files it does not pick (a spec included). */
export function importersOf(tree: Tree, target: (file: string) => boolean): Array<{ from: string } & Edge> {
  const out: Array<{ from: string } & Edge> = [];
  for (const from of tree.keys())
    for (const edge of edgesOf(tree, from)) if (target(edge.to) && !target(from)) out.push({ from, ...edge });
  return out;
}

// ----------------------------------------------------------------- exports

export interface ExportedName {
  file: string;
  name: string;
  line: number;
}

interface Declared {
  name: string;
  /** The local name the export stands for, when `export { local as name }`. */
  local: string | null;
  /** `export { x as name } from "./m"`: the module and the name in it. */
  from: { module: string; name: string } | null;
  /** The declaration, to leave its own body out of its uses. */
  node: ts.Node;
}

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);

function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
}

/** What a file exports. `export *` is returned as its module. */
export function declaredExports(tree: Tree, file: string): { names: Declared[]; stars: string[] } {
  const names: Declared[] = [];
  const stars: string[] = [];
  if (!isScript(file) || file.endsWith(".d.ts")) return { names, stars };
  for (const st of syntax(tree, file).statements) {
    if (ts.isExportAssignment(st)) names.push({ name: "default", local: null, from: null, node: st });
    else if (ts.isExportDeclaration(st)) {
      const spec = stringOf(st.moduleSpecifier);
      const module = spec === null ? null : resolveSpecifier(tree, file, spec);
      if (!st.exportClause) {
        if (module) stars.push(module);
      } else if (ts.isNamespaceExport(st.exportClause)) {
        names.push({
          name: st.exportClause.name.text,
          local: null,
          from: module ? { module, name: "*" } : null,
          node: st,
        });
      } else {
        for (const el of st.exportClause.elements)
          names.push({
            name: el.name.text,
            local: module ? null : (el.propertyName ?? el.name).text,
            from: module ? { module, name: (el.propertyName ?? el.name).text } : null,
            node: st,
          });
      }
    } else if (hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(st, ts.SyntaxKind.DefaultKeyword))
        names.push({ name: "default", local: null, from: null, node: st });
      else if (ts.isVariableStatement(st)) {
        const list: string[] = [];
        for (const d of st.declarationList.declarations) bindingNames(d.name, list);
        for (const name of list) names.push({ name, local: name, from: null, node: st });
      } else if (
        ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) ||
        ts.isEnumDeclaration(st) ||
        ts.isModuleDeclaration(st)
      ) {
        if (st.name && ts.isIdentifier(st.name))
          names.push({ name: st.name.text, local: st.name.text, from: null, node: st });
      }
    }
  }
  return { names, stars };
}

/** A place where an identifier is a name being declared or a key, not a reference to a binding. */
function isNameSlot(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isQualifiedName(p) && p.right === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    ((ts.isPropertySignature(p) ||
      ts.isMethodSignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isEnumMember(p)) &&
      p.name === id) ||
    (ts.isBindingElement(p) && p.propertyName === id) ||
    ((ts.isVariableDeclaration(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isTypeParameterDeclaration(p) ||
      ts.isBindingElement(p)) &&
      p.name === id) ||
    ts.isJsxAttribute(p) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isNamespaceImport(p) ||
    ts.isImportClause(p)
  );
}

/** Does `file` mention `local` anywhere but in the declaration that defines it? */
function mentionedOutside(tree: Tree, file: string, local: string, declaration: ts.Node): boolean {
  let found = false;
  visit(syntax(tree, file), (n) => {
    if (found || !ts.isIdentifier(n) || n.text !== local || isNameSlot(n)) return;
    if (n.pos >= declaration.pos && n.end <= declaration.end) return;
    found = true;
  });
  return found;
}

/** `lazyRoute(() => import("./x"))` and `lazy(() => import("./x"))` take the default export and nothing else. */
function takesOnlyDefault(call: ts.CallExpression): boolean {
  const arrow = call.parent;
  if (!arrow || !ts.isArrowFunction(arrow) || arrow.body !== call) return false;
  const outer = arrow.parent;
  return (
    ts.isCallExpression(outer) &&
    outer.arguments[0] === arrow &&
    ((ts.isIdentifier(outer.expression) && /^(lazyRoute|lazy)$/.test(outer.expression.text)) ||
      (ts.isPropertyAccessExpression(outer.expression) && outer.expression.name.text === "lazy"))
  );
}

/** The names each file's importers take: file -> names ("*" for all of them). A spec is an importer unless `specsUse` is false. */
function usedNames(tree: Tree, specsUse = true): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const mark = (file: string, name: string) => {
    let set = used.get(file);
    if (!set) used.set(file, (set = new Set()));
    set.add(name);
  };
  for (const file of tree.keys()) {
    if (!isScript(file) || (!specsUse && isSpec(file))) continue;
    const sf = syntax(tree, file);
    visit(sf, (n) => {
      if (ts.isImportDeclaration(n)) {
        const to = resolveSpecifier(tree, file, stringOf(n.moduleSpecifier) ?? "");
        const clause = n.importClause;
        if (!to || !clause) return;
        if (clause.name) mark(to, "default");
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) mark(to, "*");
        else if (bindings) for (const el of bindings.elements) mark(to, (el.propertyName ?? el.name).text);
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const to = resolveSpecifier(tree, file, stringOf(n.arguments[0]) ?? "");
        if (to) mark(to, takesOnlyDefault(n) ? "default" : "*");
      } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && !n.exportClause) {
        // `export * from "./m"`: the importers of this file take whatever they want of m; handled below.
      }
    });
  }
  return used;
}

/**
 * Exported names nobody uses: no importer takes the name (directly or through a
 * barrel that itself has a taker), no `import * as` or `import()` reaches the
 * module, and the file does not mention it outside its own declaration. A spec is an importer, and so a use,
 * unless `specsUse` is false: then the answer is what only a test keeps alive.
 */
export function deadExports(tree: Tree, options: { specsUse?: boolean } = {}): ExportedName[] {
  const used = usedNames(tree, options.specsUse ?? true);
  const declared = new Map<string, ReturnType<typeof declaredExports>>();
  for (const file of tree.keys()) if (isScript(file)) declared.set(file, declaredExports(tree, file));

  // A name taken from a barrel is taken from the module the barrel re-exports it from.
  const markThrough = (file: string, name: string, seen = new Set<string>()): void => {
    const key = `${file}\0${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const d = declared.get(file);
    if (!d) return;
    const own = d.names.find((x) => x.name === name);
    if (own?.from) {
      const set = used.get(own.from.module) ?? new Set<string>();
      set.add(own.from.name);
      used.set(own.from.module, set);
      markThrough(own.from.module, own.from.name, seen);
    } else if (!own) {
      for (const star of d.stars) {
        const set = used.get(star) ?? new Set<string>();
        set.add(name);
        used.set(star, set);
        markThrough(star, name, seen);
      }
    }
  };
  for (const [file, names] of [...used])
    for (const name of [...names]) if (name !== "*") markThrough(file, name);
  // A namespace import or an `import()` of a barrel takes everything it re-exports.
  for (const [file, names] of [...used])
    if (names.has("*"))
      for (const x of declared.get(file)?.names ?? []) if (x.from) markThrough(file, x.name);

  const dead: ExportedName[] = [];
  for (const [file, d] of declared) {
    if (isSpec(file)) continue;
    const taken = used.get(file) ?? new Set<string>();
    for (const x of d.names) {
      if (taken.has("*") || taken.has(x.name)) continue;
      if (x.local && mentionedOutside(tree, file, x.local, x.node)) continue;
      const sf = syntax(tree, file);
      dead.push({ file, name: x.name, line: sf.getLineAndCharacterOfPosition(x.node.getStart(sf)).line + 1 });
    }
  }
  return dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
}

/**
 * The modules some production `import()` takes whole, not just their default (`lazy(() => import("./x"))` takes
 * only the default): every export of such a module counts as used, whatever the code does with the result.
 */
export function wholeModuleImports(tree: Tree): string[] {
  const out = new Set<string>();
  for (const file of tree.keys()) {
    if (!isScript(file) || isSpec(file)) continue;
    visit(syntax(tree, file), (n) => {
      if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword &&
        !takesOnlyDefault(n)
      ) {
        const to = resolveSpecifier(tree, file, stringOf(n.arguments[0]) ?? "");
        if (to) out.add(to);
      }
    });
  }
  return [...out].sort();
}

// ------------------------------------------------------------- spelled words

/**
 * Every word the given files spell inside a string, a template or a JSX text:
 * `words` for what is spelled whole, `prefixes` for what ends in `-`, `_` or `.`
 * right before a `${…}` (or at the end of a concatenated string), `suffixes` for
 * what starts with `-` or `_` right after one.
 */
export interface Spelled {
  words: Set<string>;
  prefixes: Set<string>;
  suffixes: Set<string>;
}

export function spelledIn(
  tree: Tree,
  files: Iterable<string>,
  /** Files whose object keys are names being defined, not spelled (a dictionary): their key strings are left out. */
  definesKeys: (file: string) => boolean = () => false,
): Spelled {
  const out: Spelled = { words: new Set(), prefixes: new Set(), suffixes: new Set() };
  /** `before`/`after`: an expression sits right before / right after this piece of text. */
  const take = (text: string, before: boolean, after: boolean) => {
    for (const m of text.matchAll(/[A-Za-z0-9_$@.:#-]+/g)) {
      const word = m[0];
      out.words.add(word);
      if (after && m.index! + word.length === text.length) out.prefixes.add(word);
      if (before && m.index === 0 && /^[-_]/.test(word)) out.suffixes.add(word);
    }
  };
  for (const file of files) {
    if (!isScript(file)) continue;
    visit(syntax(tree, file), (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        const isKey = ts.isPropertyAssignment(n.parent) && n.parent.name === n;
        if (!(isKey && definesKeys(file))) take(n.text, false, false);
      } else if (ts.isTemplateExpression(n)) {
        take(n.head.text, false, true);
        n.templateSpans.forEach((span, i) => take(span.literal.text, true, i < n.templateSpans.length - 1));
      } else if (ts.isJsxText(n)) take(n.text, false, false);
      else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        // "x." + y and y + "-z": a literal next to something that is not one.
        const left = n.left;
        const right = n.right;
        const literal = (e: ts.Expression) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e);
        if (literal(left) && !literal(right)) take((left as ts.StringLiteral).text, false, true);
        if (literal(right) && !literal(left)) take((right as ts.StringLiteral).text, true, false);
      }
    });
  }
  return out;
}

/** The production source: the files an entry reaches that are not specs. */
export function productionFiles(tree: Tree): string[] {
  const hit = reachable(tree);
  return [...hit].filter((f) => isScript(f) && !isSpec(f));
}

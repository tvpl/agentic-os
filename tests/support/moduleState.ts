import ts from "typescript";

/**
 * Reads TypeScript source for module-level mutable state: what two engines of one process would share
 * (.specs/features/sdk-core, door 3 and AC 30). It reads the syntax tree, not the text: a regular expression over
 * source misses `export let`, computed members and aliases, and flags words in strings and comments.
 *
 * What it calls state, among the top-level statements of a file:
 *   - a `let` or `var`;
 *   - a `const` built by `new` (an `EventBus`, a `BlockList`, an empty `Map`, `Set` or `WeakMap`...), whatever is
 *     done with it later: a class instance has methods the reader cannot see through, so it is state until someone
 *     says why it is not;
 *   - a `Map` or `Set` given its entries (`new Set(["a", "b"])`, a lookup table) only when this file adds to it;
 *   - a `const` array or object literal that this file mutates (`.push(`, `.set(`, `x[k] =`, `x.k =`, `delete x.k`,
 *     `Object.assign(x, ...)`), and a class with a `static` property that has an initializer;
 *   - any use of `globalThis` (once per file): what lives there is shared by every copy of a package loaded in the
 *     process, so it is state whatever the code around it looks like.
 *
 * What it does not see, said once: state behind a function call (`const cache = makeCache()`), and a table that
 * another file mutates. The list in the test that uses it is the closed answer for the first; code review is the
 * answer for the second.
 */

export interface StateFinding {
  file: string;
  name: string;
  line: number;
  why: string;
}

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

/** Collections given their entries are a table, unless this file changes them (an empty one is filled by someone). */
const COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

/** A `new` of these builds a value, not a holder of state. */
const VALUE_CONSTRUCTORS = new Set(["RegExp", "Error", "URL", "URLSearchParams", "Date"]);

function unwrap(expression: ts.Expression): ts.Expression {
  let node = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression;
    } else if (ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
      node = node.expression;
    } else return node;
  }
}

/** Names this file mutates: the receiver of a mutating method, the target of an assignment or `delete`. */
function mutatedNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const rootName = (expression: ts.Expression): string | null => {
    let node = unwrap(expression);
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      node = unwrap(node.expression);
    return ts.isIdentifier(node) ? node.text : null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = rootName(node.expression.expression);
      if (receiver && MUTATING_METHODS.has(method)) names.add(receiver);
      if (
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Object" &&
        method === "assign" &&
        node.arguments[0]
      ) {
        const target = rootName(node.arguments[0]);
        if (target) names.add(target);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = rootName(node.left);
      if (
        target &&
        (ts.isPropertyAccessExpression(unwrap(node.left)) || ts.isElementAccessExpression(unwrap(node.left)))
      )
        names.add(target);
    }
    if (ts.isDeleteExpression(node)) {
      const target = rootName(node.expression);
      if (target) names.add(target);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

export function moduleState(source: string, file = "file.ts"): StateFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const mutated = mutatedNames(sf);
  const findings: StateFinding[] = [];
  const add = (node: ts.Node, name: string, why: string) =>
    findings.push({ file, name, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, why });
  const usesGlobalThis = (node: ts.Node): ts.Node | null => {
    if (ts.isIdentifier(node) && node.text === "globalThis") return node;
    let found: ts.Node | null = null;
    ts.forEachChild(node, (child) => {
      found ??= usesGlobalThis(child);
    });
    return found;
  };
  const global = usesGlobalThis(sf);
  if (global) add(global, "globalThis", "process-wide through globalThis");
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(sf);
        if (!isConst) {
          add(declaration, name, "let or var");
          continue;
        }
        if (!declaration.initializer) continue;
        const init = unwrap(declaration.initializer);
        if (ts.isNewExpression(init)) {
          const callee = init.expression.getText(sf);
          const isTable = COLLECTIONS.has(callee) && (init.arguments?.length ?? 0) > 0 && !mutated.has(name);
          if (!VALUE_CONSTRUCTORS.has(callee) && !isTable) add(declaration, name, `new ${callee}`);
        } else if (
          (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init)) &&
          mutated.has(name)
        ) {
          add(declaration, name, "literal mutated in this file");
        }
      }
    } else if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        const isStatic = ts.getCombinedModifierFlags(member as ts.Declaration) & ts.ModifierFlags.Static;
        if (isStatic && ts.isPropertyDeclaration(member) && member.initializer) {
          add(
            member,
            `${statement.name?.text ?? "(class)"}.${member.name.getText(sf)}`,
            "static property with a value",
          );
        }
      }
    }
  }
  return findings;
}

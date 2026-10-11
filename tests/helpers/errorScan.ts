import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Which `(status, code)` pairs can the code raise? Read on the syntax tree (L-029), in three shapes:
 *
 *  - `httpError(<status>, <message>, <code>?)`;
 *  - `new MordomoError(<status>, <message>, <code>?)`, the engine's own refusals (`core/src/errors.ts`);
 *  - an object literal with a literal `statusCode` (`Object.assign(new Error(…), { statusCode: 409, code: "x" })`),
 *    whose `code` may be a conditional between two literals (one pair for each branch);
 *  - a class with a literal `statusCode` field, whose `code` is a literal field or a constructor parameter typed as
 *    a union of string literals (one pair for each member).
 *
 * A status below 400 is not an error, a `statusCode` that is not a literal is not a pair, and text in a comment or
 * a string is not code. A pair with no `code` carries the code of its status (`defaultCode`).
 */
/** The code of a raise whose code is computed in a way the scan cannot read. */
export const UNRESOLVED = "<unresolved>";

export interface RaisedError {
  status: number;
  code: string | null;
  file: string;
  line: number;
}

export function scanSource(source: string, file = "source.ts"): RaisedError[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: RaisedError[] = [];
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const num = (node: ts.Node | undefined): number | undefined =>
    node && ts.isNumericLiteral(node) ? Number(node.text) : undefined;
  const str = (node: ts.Node | undefined): string | undefined =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  /** A `const NAME = "literal"` of this file, by name: the codes a handler names through a constant. */
  const constants = new Map<string, string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = str(node.initializer);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  /**
   * The codes an expression can be: a literal, a constant of the file holding one, either branch of a conditional, or
   * (through parentheses, `as` and `satisfies`) any of those. What it cannot read is `UNRESOLVED`, which no entry
   * documents, so a code that is computed fails the proof loudly instead of passing as "no code".
   */
  const codesOf = (node: ts.Expression): string[] => {
    const literal = str(node);
    if (literal !== undefined) return [literal];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
      return codesOf(node.expression);
    if (ts.isIdentifier(node) && constants.has(node.text)) return [constants.get(node.text)!];
    if (ts.isConditionalExpression(node))
      return [...new Set([...codesOf(node.whenTrue), ...codesOf(node.whenFalse)])];
    return [UNRESOLVED];
  };
  const add = (status: number | undefined, codes: Array<string | null>, node: ts.Node) => {
    if (status === undefined || status < 400) return;
    for (const code of codes) out.push({ status, code, file, line: line(node) });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "httpError"
    ) {
      add(num(node.arguments[0]), node.arguments[2] ? codesOf(node.arguments[2]) : [null], node);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "MordomoError"
    ) {
      add(num(node.arguments?.[0]), node.arguments?.[2] ? codesOf(node.arguments[2]) : [null], node);
    }
    if (ts.isObjectLiteralExpression(node)) {
      let status: number | undefined;
      let codes: Array<string | null> = [null];
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text === "statusCode") status = num(prop.initializer);
        if (prop.name.text === "code") codes = codesOf(prop.initializer);
      }
      add(status, codes, node);
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      let status: number | undefined;
      let codes: Array<string | null> = [null];
      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
          if (member.name.text === "statusCode") status = num(member.initializer);
          if (member.name.text === "code") codes = member.initializer ? codesOf(member.initializer) : [null];
        }
        if (ts.isConstructorDeclaration(member)) {
          for (const param of member.parameters) {
            if (!ts.isIdentifier(param.name) || param.name.text !== "code" || !param.type) continue;
            if (ts.isUnionTypeNode(param.type)) {
              const members = param.type.types.map((t) =>
                ts.isLiteralTypeNode(t) ? str(t.literal) : undefined,
              );
              if (members.every((m): m is string => m !== undefined)) codes = members;
            } else if (ts.isLiteralTypeNode(param.type)) codes = [str(param.type.literal) ?? null];
          }
        }
      }
      add(status, codes, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every `.ts` file under `dir`, without tests. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts"))
      out.push(full);
  }
  return out;
}

/** The ids a route file binds: `bind(app, "runs.get", …)`. */
export function boundIds(source: string): string[] {
  const sf = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
  const ids: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "bind" &&
      node.arguments[1] &&
      ts.isStringLiteral(node.arguments[1])
    ) {
      ids.push(node.arguments[1].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return ids;
}

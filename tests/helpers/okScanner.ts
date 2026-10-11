import ts from "typescript";

/**
 * AC 7 of `.specs/features/api-v1` on the TypeScript syntax tree (L-029): the API never answers a `2xx`
 * whose body has `ok` set to anything but the literal `true`. Two scans, because a handler can build its
 * body in a place the first one does not follow:
 *
 * - `okNotTrueSites`: the object literals a route handler answers with. Returned (also as an arrow's
 *   body), passed to `.send(…)`, through parentheses, casts, `await`, both arms of `?:`/`??`/`||`, a local
 *   variable (its initialiser, its assignments, `Object.assign(local, …)` and `local.ok = …`), a spread
 *   (`{ ...{ ok } }`, `{ ...local }`), `Object.assign({}, …)`, or the return of a same-file function it
 *   calls. Handlers are the function arguments of `<x>.get|post|put|patch|delete|head|options|all("/…", …)`,
 *   the third argument of `bind(app, "<id>", …)` and the `handler` of `<x>.route({ … })`, inline or by name.
 * - `okLiteralSites`: every object literal of a file with an `ok` key (and every `x.ok = …`) whose value is
 *   not `true`, wherever it sits. Run over the whole of `apps/api/src`, it covers a body built by a function
 *   of another file that a route calls, which the first scan cannot follow. What it flags and is not an
 *   answer needs an entry in a justified exemption table (see the test).
 *
 * Nested objects (`{ health: { ok } }`) are data, not the answer's flag, and are not flagged by the first
 * scan; nor are strings, comments, or objects a handler builds but does not answer with.
 */

type Fn = ts.FunctionLikeDeclaration;

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);

const parse = (source: string, fileName: string) =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const isFn = (n: ts.Node | undefined): n is Fn =>
  !!n &&
  (ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n));

/** The static name of a property, or null when it is computed from something that is not a string. */
const keyOf = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name)) {
    let e: ts.Expression = name.expression;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
    return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null;
  }
  return null;
};

/** The literal `true`, also as `true as const` (what a handler writes so that the contract's `z.literal(true)` accepts it). */
const isTrue = (e: ts.Expression): boolean => {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    (ts.isAsExpression(e) && ts.isTypeReferenceNode(e.type) && e.type.typeName.getText() === "const")
  )
    e = e.expression;
  return e.kind === ts.SyntaxKind.TrueKeyword;
};

/** `x.ok` / `x["ok"]` as the target of an assignment. */
const isOkTarget = (n: ts.Expression): boolean => {
  if (ts.isPropertyAccessExpression(n)) return n.name.text === "ok";
  if (ts.isElementAccessExpression(n))
    return ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "ok";
  return false;
};

const isObjectAssign = (e: ts.CallExpression) =>
  ts.isPropertyAccessExpression(e.expression) &&
  ts.isIdentifier(e.expression.expression) &&
  e.expression.expression.text === "Object" &&
  e.expression.name.text === "assign";

/** Every `ok` that is not the literal `true`, as a property of an object literal or as `x.ok = …`. */
export function okLiteralSites(source: string, fileName = "source.ts"): string[] {
  const file = parse(source, fileName);
  const sites: string[] = [];
  const line = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;
  const note = (n: ts.Node) => sites.push(`${fileName}:${line(n)} ${n.getText(file).replace(/\s+/g, " ")}`);
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (!p.name || keyOf(p.name) !== "ok") continue;
        if (ts.isPropertyAssignment(p) && isTrue(p.initializer)) continue;
        note(p);
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isOkTarget(n.left) &&
      !isTrue(n.right)
    )
      note(n);
    ts.forEachChild(n, visit);
  };
  visit(file);
  return sites;
}

/** The object literals a route handler answers with whose own `ok` is anything but `true`. */
export function okNotTrueSites(
  source: string,
  fileName = "source.ts",
): { handlers: number; sites: string[] } {
  const file = parse(source, fileName);
  const named = new Map<string, Fn>();
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) named.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFn(n.initializer))
      named.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(file);
  const asFn = (e: ts.Node | undefined): Fn | undefined =>
    isFn(e) ? e : e && ts.isIdentifier(e) ? named.get(e.text) : undefined;
  const ownFn = (n: ts.Node): ts.Node | undefined => {
    let p = n.parent;
    while (p && !ts.isFunctionLike(p)) p = p.parent;
    return p;
  };

  const handlers = new Set<Fn>();
  const findHandlers = (n: ts.Node) => {
    // `bind(app, "runs.get", handler)`: the way every route is registered since contratos-rest.
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "bind" &&
      n.arguments[1] &&
      ts.isStringLiteral(n.arguments[1])
    ) {
      const fn = asFn(n.arguments[2]);
      if (fn) handlers.add(fn);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const [first] = n.arguments;
      if (method === "route" && first && ts.isObjectLiteralExpression(first)) {
        for (const p of first.properties) {
          if (!p.name || keyOf(p.name) !== "handler") continue;
          const fn = ts.isPropertyAssignment(p)
            ? asFn(p.initializer)
            : ts.isShorthandPropertyAssignment(p)
              ? named.get(p.name.text)
              : asFn(p);
          if (fn) handlers.add(fn);
        }
      } else if (
        METHODS.has(method) &&
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
        first.text.startsWith("/")
      ) {
        const fn = asFn(n.arguments[n.arguments.length - 1]);
        if (fn) handlers.add(fn);
      }
    }
    ts.forEachChild(n, findHandlers);
  };
  findHandlers(file);

  const sites = new Set<string>();
  const line = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;
  const note = (n: ts.Node) => sites.add(`${fileName}:${line(n)} ${n.getText(file).replace(/\s+/g, " ")}`);

  const checkObject = (obj: ts.ObjectLiteralExpression, scope: Fn, depth: number) => {
    for (const p of obj.properties) {
      // `{ ...{ ok: x } }`, `{ ...local }`: what is spread is part of the answer.
      if (ts.isSpreadAssignment(p)) {
        answers(p.expression, scope, depth + 1);
        continue;
      }
      if (!p.name || keyOf(p.name) !== "ok") continue;
      if (ts.isPropertyAssignment(p) && isTrue(p.initializer)) continue;
      note(p);
    }
  };
  const seen = new Set<Fn>();
  const answers = (e: ts.Expression | undefined, scope: Fn, depth = 0): void => {
    if (!e || depth > 20) return;
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isAwaitExpression(e)
    )
      return answers(e.expression, scope, depth + 1);
    if (ts.isConditionalExpression(e)) {
      answers(e.whenTrue, scope, depth + 1);
      return answers(e.whenFalse, scope, depth + 1);
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
        answers(e.left, scope, depth + 1);
      if (
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.CommaToken
      )
        answers(e.right, scope, depth + 1);
      return;
    }
    if (ts.isObjectLiteralExpression(e)) return checkObject(e, scope, depth);
    if (ts.isIdentifier(e)) {
      // A local the handler answers with: its initialiser, every assignment to it, what is
      // `Object.assign`ed into it and every `local.ok = …`.
      const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text)
          answers(n.initializer, scope, depth + 1);
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          if (ts.isIdentifier(n.left) && n.left.text === e.text) answers(n.right, scope, depth + 1);
          if (
            isOkTarget(n.left) &&
            (n.left as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression.getText(file) ===
              e.text &&
            !isTrue(n.right)
          )
            note(n);
        }
        if (
          ts.isCallExpression(n) &&
          isObjectAssign(n) &&
          n.arguments[0] &&
          ts.isIdentifier(n.arguments[0]) &&
          n.arguments[0].text === e.text
        )
          for (const source of n.arguments.slice(1)) answers(source, scope, depth + 1);
        ts.forEachChild(n, visit);
      };
      if (scope.body) visit(scope.body);
      // ... and a constant of the module the handler closes over.
      for (const statement of file.statements)
        if (ts.isVariableStatement(statement))
          for (const d of statement.declarationList.declarations)
            if (ts.isIdentifier(d.name) && d.name.text === e.text && !isFn(d.initializer))
              answers(d.initializer, scope, depth + 1);
      return;
    }
    if (ts.isCallExpression(e)) {
      // `Object.assign({}, a, b)`: every source is part of the answer, the target included.
      if (isObjectAssign(e)) for (const arg of e.arguments) answers(arg, scope, depth + 1);
      else if (ts.isIdentifier(e.expression)) {
        const callee = named.get(e.expression.text);
        if (callee) answersOf(callee);
      }
    }
  };
  // What a function answers with: its returns (not those of the callbacks inside it) and its arrow body.
  const answersOf = (fn: Fn) => {
    if (seen.has(fn)) return;
    seen.add(fn);
    if (fn.body && !ts.isBlock(fn.body)) answers(fn.body, fn);
    const visit = (n: ts.Node) => {
      if (ts.isReturnStatement(n) && ownFn(n) === fn) answers(n.expression, fn);
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  };
  for (const fn of handlers) {
    answersOf(fn);
    // `reply.send(…)` anywhere in the handler, its callbacks included.
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "send"
      )
        answers(n.arguments[0], fn);
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  }
  return { handlers: handlers.size, sites: [...sites] };
}

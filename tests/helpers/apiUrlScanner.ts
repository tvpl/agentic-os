import ts from "typescript";

/**
 * AC 4 of `.specs/features/api-v1` on the TypeScript/TSX syntax tree (L-029): a URL of the API reaches the
 * network only through `apiUrl(…)` (which prefixes `/api/v1`) or a builder that returns one.
 *
 * `unversionedApiUrls` returns every place where a string holding `/api/` flows, without an enclosing
 * `apiUrl(…)` call, into:
 *
 * - a JSX attribute `src`, `href`, `poster` or `action`, an object property of those names
 *   (`{ src: "/api/…" }`) and an assignment to them (`img.src = "/api/…"`, `location.href = "/api/…"`);
 * - an argument of `fetch(…)`, `new EventSource(…)`, `new URL(…)`, `new Request(…)`, `window.open(…)`,
 *   `new XMLHttpRequest().open(…)` (any `xhr.open`) and `navigator.sendBeacon(…)`.
 *
 * "Contains" means anywhere in the expression: a template (`` `/api/x/${id}` ``), a concatenation, either
 * arm of `?:`, an argument of another call; a constant of the same file (`const url = "/api/x"`) is
 * followed to its initialiser. A call to `apiUrl(…)` makes everything inside it clean. A URL passed to a
 * builder that is defined elsewhere carries no `/api/` string at the call site, so it is judged where the
 * builder is defined, and there it must reach `apiUrl(…)`.
 *
 * Besides, `fetch(…)` and `new EventSource(…)` must receive a call to one of `BUILDERS` as their first
 * argument, whatever it contains: a variable or a parameter hides where the URL came from.
 */

export const BUILDERS = ["apiUrl", "resourceUrl", "artifactRawUrl"] as const;

const ATTRIBUTES = new Set(["src", "href", "poster", "action"]);
/** Calls whose every argument is a URL (or holds one). */
const CALLS = new Set(["fetch", "window.open", "open", "navigator.sendBeacon"]);
const CONSTRUCTORS = new Set(["EventSource", "URL", "Request", "XMLHttpRequest"]);

const calleeName = (e: ts.Expression): string => {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return `${calleeName(e.expression)}.${e.name.text}`;
  return "";
};

export type UrlFinding = { where: string; kind: string; text: string };

export function unversionedApiUrls(
  source: string,
  fileName = "source.tsx",
): { sinks: number; findings: UrlFinding[] } {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: UrlFinding[] = [];
  let sinks = 0;
  const where = (n: ts.Node) =>
    `${fileName}:${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`;
  const textOf = (n: ts.Node) => n.getText(file).replace(/\s+/g, " ").slice(0, 120);

  const consts = new Map<string, ts.Expression>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer)
      consts.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(file);

  const isApiUrlCall = (n: ts.Node): boolean =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "apiUrl";
  const isStringPart = (
    n: ts.Node,
  ): n is ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateHead(n) ||
    ts.isTemplateMiddle(n) ||
    ts.isTemplateTail(n);

  /** A constant worth following: a string, a template, a concatenation, a choice between strings or another constant. */
  const composes = (e: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return composes(e.expression);
    if (ts.isConditionalExpression(e)) return composes(e.whenTrue) || composes(e.whenFalse);
    if (ts.isBinaryExpression(e)) return e.operatorToken.kind === ts.SyntaxKind.PlusToken;
    return isStringPart(e) || ts.isTemplateExpression(e) || ts.isIdentifier(e);
  };

  /** An `/api/` string somewhere in `e` that no `apiUrl(…)` call encloses. */
  const bare = (e: ts.Node, followed = new Set<string>()): boolean => {
    if (isApiUrlCall(e)) return false;
    if (isStringPart(e)) return e.text.includes("/api/");
    if (ts.isIdentifier(e)) {
      // `status.url` is a field of something, not the constant `status` (nor `url`) itself.
      const p = e.parent;
      if (ts.isPropertyAccessExpression(p) || (ts.isCallExpression(p) && p.expression === e)) return false;
      const init = consts.get(e.text);
      if (!init || followed.has(e.text) || !composes(init)) return false;
      followed.add(e.text);
      return bare(init, followed);
    }
    return !!ts.forEachChild(e, (child) => (bare(child, followed) ? true : undefined));
  };

  const judge = (kind: string, node: ts.Node, expr: ts.Node | undefined) => {
    sinks++;
    if (expr && bare(expr)) findings.push({ where: where(node), kind, text: textOf(expr) });
  };

  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && ATTRIBUTES.has(n.name.text)) {
      const init = n.initializer;
      const value = init && ts.isJsxExpression(init) ? init.expression : init;
      // `action` loads a URL on a `<form>` only (a component's `action={<Button/>}` is a slot), and a
      // JSX element is never a URL.
      const tag = ts.isJsxOpeningLikeElement(n.parent.parent) ? n.parent.parent.tagName.getText(file) : "";
      const slot =
        value && (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value));
      if (!slot && (n.name.text !== "action" || tag === "form")) judge(`<${tag} ${n.name.text}>`, n, value);
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && ATTRIBUTES.has(n.name.text))
      judge(`{ ${n.name.text}: … }`, n, n.initializer);
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      ATTRIBUTES.has(n.left.name.text)
    )
      judge(`.${n.left.name.text} =`, n, n.right);
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      // `xhr.open("GET", url)`, `window.open(url)`, `fetch(url)`, `navigator.sendBeacon(url)`.
      if (CALLS.has(name) || name.endsWith(".open") || name.endsWith(".sendBeacon")) {
        sinks++;
        for (const arg of n.arguments)
          if (bare(arg)) findings.push({ where: where(n), kind: `${name}()`, text: textOf(arg) });
        if (name === "fetch") requireBuilder(name, n, n.arguments[0]);
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && CONSTRUCTORS.has(n.expression.text)) {
      sinks++;
      for (const arg of n.arguments ?? [])
        if (bare(arg))
          findings.push({ where: where(n), kind: `new ${n.expression.text}()`, text: textOf(arg) });
      if (n.expression.text === "EventSource") requireBuilder("new EventSource", n, n.arguments?.[0]);
    }
    ts.forEachChild(n, visit);
  };
  const requireBuilder = (kind: string, node: ts.Node, arg: ts.Expression | undefined) => {
    const ok =
      !!arg &&
      ts.isCallExpression(arg) &&
      ts.isIdentifier(arg.expression) &&
      (BUILDERS as readonly string[]).includes(arg.expression.text);
    if (!ok)
      findings.push({ where: where(node), kind: `${kind}() argument`, text: arg ? textOf(arg) : "(none)" });
  };
  visit(file);
  return { sinks, findings };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { API, routeKey } from "@mordomo/contracts";

/**
 * Contratos REST (.specs/features/contratos-rest, C33): every call the interface makes to the API is either
 * `apiCall("<METHOD> <path>", …)`, typed by the route table, or on the list below with the route it reaches and the
 * reason it is not migrated yet. A call that is neither fails here. The calls are read on the syntax tree, so a
 * comment or a string that spells `api.get(` is not a call, and a call split over lines is.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHOD_OF: Record<string, Method> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  del: "DELETE",
};

/** How the first argument names the URL. */
type UrlShape = "literal" | "template" | "variable";

export interface RawCall {
  file: string;
  line: number;
  method: Method;
  shape: UrlShape;
  /** The path with each `${…}` as `:p` and the query dropped; `null` for a variable. */
  path: string | null;
}
export interface MigratedCall {
  file: string;
  line: number;
  /** The key, when the first argument is a string literal; `null` when it is not. */
  key: string | null;
}

/** The calls of one source file: `api.get/post/put/patch/del(url, …)` and `apiCall(key, …)`. */
export function scanCalls(source: string, file: string): { raw: RawCall[]; migrated: MigratedCall[] } {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const raw: RawCall[] = [];
  const migrated: MigratedCall[] = [];
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "api" &&
        METHOD_OF[callee.name.text]
      ) {
        const arg = node.arguments[0];
        let shape: UrlShape = "variable";
        let urlPath: string | null = null;
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          shape = "literal";
          urlPath = arg.text.split("?")[0]!;
        } else if (arg && ts.isTemplateExpression(arg)) {
          shape = "template";
          // `${encodeURIComponent(x)}` and `${x}` both stand for a segment; the query starts at the first `?` of the text.
          const text = [arg.head.text, ...arg.templateSpans.map((s) => `\0${s.literal.text}`)].join("");
          const withoutQuery = text.split("?")[0]!;
          urlPath = withoutQuery.replace(/\0/g, ":p");
          // A hole before the first `/` after `/api/` is not a path this scan can name.
          if (!urlPath.startsWith("/api/")) urlPath = null;
        }
        raw.push({ file, line: line(node), method: METHOD_OF[callee.name.text]!, shape, path: urlPath });
      }
      if (ts.isIdentifier(callee) && callee.text === "apiCall") {
        const arg = node.arguments[0];
        migrated.push({
          file,
          line: line(node),
          key: arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { raw, migrated };
}

const ROUTE_KEYS = Object.values(API).map((entry) => routeKey(entry));

/** The route a raw call reaches: the key whose path matches (`:name` stands for one segment), or `null`. */
export function routeOf(call: Pick<RawCall, "method" | "path">): string | null {
  if (call.path === null) return null;
  const hit = ROUTE_KEYS.find((key) => {
    const [method, pattern] = key.split(" ") as [string, string];
    if (method !== call.method) return false;
    const rx = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+")}$`);
    return rx.test(call.path!);
  });
  return hit ?? null;
}

/**
 * The calls still made with `api.get/post/put/patch/del`, with the route each reaches and why it was not moved to
 * `apiCall`. `api.ts` itself is not a caller: `apiCall` dispatches through these methods.
 */
const NOT_MIGRATED: Array<{
  file: string;
  method: Method;
  shape: UrlShape;
  route: string | null;
  reason: string;
}> = [
  {
    file: "queries.ts",
    method: "GET",
    shape: "variable",
    route: null,
    reason:
      "`useApiQuery` takes the path as a parameter, so its callers (about thirty) name the route in a string the compiler cannot read; `useRouteQuery` is the typed twin, used by the `useOs*` hooks, and the callers move to it a hook at a time",
  },
];

/**
 * The `apiCall`s whose key is not a literal: a function that takes the route as a parameter, typed by the same
 * table (`useRouteQuery`'s `K extends GetRouteKey`), so the compiler still checks the key and its input where the
 * function is called.
 */
const GENERIC_CALLERS: Array<{ file: string; reason: string }> = [
  {
    file: "queries.ts",
    reason:
      "`useRouteQuery` forwards the route its caller named; the caller's key is a literal checked against the table",
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|typetest)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    )
      out.push(full);
  }
  return out;
}

describe("calls to the API", () => {
  it("C33 every call is migrated or listed with a reason", () => {
    const raw: RawCall[] = [];
    const migrated: MigratedCall[] = [];
    for (const full of sourceFiles(here)) {
      const file = path.relative(here, full).split(path.sep).join("/");
      if (file === "api.ts") continue;
      const found = scanCalls(fs.readFileSync(full, "utf8"), file);
      raw.push(...found.raw);
      migrated.push(...found.migrated);
    }

    // The migrated ones name a route that exists, as a literal the compiler can check.
    const generic = migrated.filter((m) => m.key === null);
    expect(generic.map((m) => m.file).sort()).toEqual(GENERIC_CALLERS.map((g) => g.file).sort());
    const unknownKeys = migrated
      .filter((m) => m.key !== null && !ROUTE_KEYS.includes(m.key))
      .map((m) => `${m.file}:${m.line} ${m.key}`);
    expect(unknownKeys).toEqual([]);

    // The ones left are exactly the list: nothing new, nothing stale, and each names its route and its reason.
    const seen = raw.map((c) => `${c.file} ${c.method} ${c.shape} ${routeOf(c) ?? "-"}`).sort();
    const listed = NOT_MIGRATED.map((n) => `${n.file} ${n.method} ${n.shape} ${n.route ?? "-"}`).sort();
    expect(seen).toEqual(listed);
    for (const entry of NOT_MIGRATED) expect(entry.reason.length, entry.file).toBeGreaterThan(40);

    // The 113 calls the plan counted are all accounted for: migrated, or listed.
    expect(migrated.length + raw.length).toBeGreaterThanOrEqual(113);
  }, 60_000);

  it("C33 the scan reads every form of URL", () => {
    const at = (source: string) => scanCalls(source, "x.ts").raw;
    // A literal, with and without a query.
    expect(at(`api.get("/api/runs");`)).toMatchObject([
      { method: "GET", shape: "literal", path: "/api/runs" },
    ]);
    expect(at("api.get(`/api/providers?force=1`);")).toMatchObject([
      { shape: "literal", path: "/api/providers" },
    ]);
    // A template with `encodeURIComponent`, with a bare hole, and with a query hole.
    expect(at("api.post(`/api/runs/${encodeURIComponent(id)}/cancel`);")).toMatchObject([
      { method: "POST", shape: "template", path: "/api/runs/:p/cancel" },
    ]);
    expect(at("api.post(`/api/providers/${id}/detect`);")).toMatchObject([
      { shape: "template", path: "/api/providers/:p/detect" },
    ]);
    expect(at("api.get(`/api/artifacts/file?p=${encodeURIComponent(p)}`);")).toMatchObject([
      { shape: "template", path: "/api/artifacts/file" },
    ]);
    // A variable, a hole that starts the URL, and a call split over two lines.
    expect(at("api.put(base, body);")).toMatchObject([{ method: "PUT", shape: "variable", path: null }]);
    expect(at("api.get(`${base}/setup`);")).toMatchObject([{ shape: "template", path: null }]);
    expect(at("void api\n  .del<T>(`/api/sessions/${id}`)\n  .catch(() => undefined);")).toMatchObject([
      { method: "DELETE", shape: "template", path: "/api/sessions/:p" },
    ]);
    // Not calls: text in a comment or a string, another object's `get`, a method that is not one of the five.
    expect(
      at(
        `// api.get("/api/runs")\nconst s = 'api.post("/api/runs")'; cache.get("/api/runs"); api.uiPreferences();`,
      ),
    ).toEqual([]);
    // And the migrated form is read, with its key.
    expect(
      scanCalls(`apiCall("GET /api/runs/:id", { params: { id } }); apiCall(key);`, "x.ts").migrated,
    ).toMatchObject([{ key: "GET /api/runs/:id" }, { key: null }]);
  });

  it("C33 a route of a raw call resolves to its key", () => {
    expect(routeOf({ method: "POST", path: "/api/runs/:p/cancel" })).toBe("POST /api/runs/:id/cancel");
    expect(routeOf({ method: "GET", path: "/api/runs" })).toBe("GET /api/runs");
    expect(routeOf({ method: "GET", path: "/api/nao-existe" })).toBeNull();
    expect(routeOf({ method: "GET", path: null })).toBeNull();
  });
});

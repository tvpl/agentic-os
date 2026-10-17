import type * as Contracts from "@mordomo/contracts";
import { api, type RequestOptions } from "./api";

/**
 * Call a route of the contract by its key. It lives next to `api.ts`, not in it, on purpose: it goes through the
 * `api` object of the module `./api`, so a test that replaces that object (the transport) sees every call the
 * screens make, whether they spell it `api.get(...)` or `apiCall("GET ...")`.
 */

/** What `apiCall` takes after the route: the parts its entry declares (`params`, `query`, `body`), then the request options. */
export type CallArgs<K extends Contracts.RouteKey> =
  Record<never, never> extends Contracts.ApiCallInput<K>
    ? [input?: Contracts.ApiCallInput<K>, opts?: RequestOptions]
    : [input: Contracts.ApiCallInput<K>, opts?: RequestOptions];

interface CallParts {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/**
 * The query as the route reads it, each key and value encoded as `encodeURIComponent` does (a space is `%20`, as in
 * the URLs the screens spelled by hand): a key with no value is left out; a flag (`QueryFlag`) that is on is `1` and a
 * flag that is off is `0`, never left out, because a route may default to on (`memory/recall?record=0`).
 */
export function queryString(query: Record<string, unknown> | undefined): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    pairs.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(value === true ? "1" : value === false ? "0" : String(value))}`,
    );
  }
  return pairs.join("&");
}

const METHOD_FN = { GET: "get", POST: "post", PUT: "put", PATCH: "patch", DELETE: "del" } as const;

/**
 * Call a route of the contract by its key: `apiCall("GET /api/runs/:id", { params: { id } })`. The parameters, the
 * query, the body and the result are typed by the route's entry in `API` (`@mordomo/contracts`), so a route that does
 * not exist, a parameter of the wrong type, a body the route does not take or a field the answer does not have does
 * not compile. At run time this is the request `api.get/post/put/patch/del` makes, to the same `/api/v1/…` URL, with
 * the parameters encoded and the query serialised; the answer is not validated here (the server validated it).
 * `API` is imported as a type only: no schema library reaches the bundle.
 */
export function apiCall<K extends Contracts.RouteKey>(
  key: K,
  ...args: CallArgs<K>
): Promise<Contracts.ApiCallResult<K>> {
  const [input, opts] = args as [CallParts | undefined, RequestOptions | undefined];
  const space = key.indexOf(" ");
  const method = key.slice(0, space) as keyof typeof METHOD_FN;
  const path = key
    .slice(space + 1)
    .replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(String(input?.params?.[name])));
  const qs = queryString(input?.query);
  const url = qs ? `${path}?${qs}` : path;
  // A method that takes a body gets `(url, body, opts)` and one that does not `(url, opts)`, each without the
  // trailing arguments that are absent: the calls the screens made by hand had exactly these shapes.
  const rest: unknown[] = method === "GET" || method === "DELETE" ? [opts] : [input?.body, opts];
  while (rest.length > 0 && rest[rest.length - 1] === undefined) rest.pop();
  const call = api[METHOD_FN[method]] as (...a: unknown[]) => Promise<unknown>;
  return call(url, ...rest) as Promise<Contracts.ApiCallResult<K>>;
}

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import {
  API,
  checkResponse,
  type HandlerCall,
  type HandlerResult,
  type RawBody,
  type RouteDefinition,
  type RouteId,
} from "@mordomo/contracts";

/**
 * The only way to register a route under `/api` (door 2 of `.specs/features/contratos-rest`): the method, the path
 * and the access come from the route's entry in the contract table (`API`), and `params`, `query` and `body` are
 * parsed by the schemas of that entry before the handler runs - a part that fails is the `ZodError` the error handler
 * answers as `400 validation`. The handler gets them already parsed and returns the body of one of the entry's success
 * statuses (the compiler holds it to that); a route that answers a stream or a file answers through `reply`.
 */

/** What a handler returns: a success body of its entry, or the `reply` for a stream and a file. */
export type Returned<K extends RouteId> =
  Exclude<HandlerResult<K>, RawBody> | (RawBody extends HandlerResult<K> ? FastifyReply : never);

export type Handler<K extends RouteId> = (
  call: HandlerCall<K>,
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<Returned<K>> | Returned<K>;

/**
 * What a route may check between its path and its body: `params` and `query` are parsed, the body is not yet. A route
 * whose base behaviour answered `404` for a resource that is not there before it read the body keeps that order here:
 * a body that is wrong for a resource that does not exist is a `404`, as it always was.
 */
export type Precheck<K extends RouteId = RouteId> = (
  call: Pick<HandlerCall<K>, "params" | "query">,
  req: FastifyRequest,
) => void | Promise<void>;

/** Route options a route may add on top of what the entry decides (a route-level `onSend`; a `preHandler`; a `precheck`). */
export type BindOptions<K extends RouteId = RouteId> = Pick<
  RouteShorthandOptions,
  "onSend" | "preHandler"
> & {
  precheck?: Precheck<K>;
};

type AnyHandler = (call: unknown, req: FastifyRequest, reply: FastifyReply) => unknown;

/**
 * Register `entry` under the id it is known by. `bind` is this over the table `API`; the test suite calls it with an
 * entry of its own to prove what `bind` does without touching the real routes.
 */
export function bindEntry(
  app: FastifyInstance,
  id: string,
  entry: RouteDefinition,
  handler: AnyHandler,
  options: BindOptions<never> = {},
): void {
  const { precheck, ...routeOptions } = options as BindOptions & { precheck?: Precheck };
  app.route({
    method: entry.method,
    url: entry.path,
    config: {
      route: id,
      ...(entry.public === true ? { public: true } : { scope: entry.scope }),
      ...(entry.queryToken ? { queryToken: true } : {}),
      ...(entry.ticket ? { ticket: true } : {}),
    },
    ...routeOptions,
    handler: async (req, reply) => {
      const parts = {
        params: entry.params ? entry.params.parse(req.params) : undefined,
        query: entry.query ? entry.query.parse(req.query ?? {}) : undefined,
      };
      if (precheck) await precheck(parts as never, req);
      const call = {
        ...parts,
        body: entry.body ? entry.body.parse(entry.bodyOptional ? (req.body ?? {}) : req.body) : undefined,
      };
      return handler(call, req, reply);
    },
  });
}

export function bind<K extends RouteId>(
  app: FastifyInstance,
  id: K,
  handler: Handler<K>,
  options?: BindOptions<K>,
): void {
  const entry = (Object.hasOwn(API, id) ? API[id] : undefined) as RouteDefinition | undefined;
  if (!entry) throw new Error(`bind: "${String(id)}" is not an entry of the route table (contracts/src/api)`);
  bindEntry(app, id, entry, handler as AnyHandler, options as BindOptions<never>);
}

// ---- response validation ------------------------------------------------------------------------------------------

/**
 * Is each JSON response checked against its entry before it is sent? On in development and in tests, where a
 * response that drifted from the contract has to fail loudly, and off in the installed service, which pays nothing
 * for it: the variable `MORDOMO_VALIDATE_RESPONSES` (`1` / `0`) decides either way.
 */
export function responsesValidated(env: Record<string, string | undefined> = process.env): boolean {
  if (env.MORDOMO_VALIDATE_RESPONSES === "1") return true;
  if (env.MORDOMO_VALIDATE_RESPONSES === "0") return false;
  return env.NODE_ENV === "test" || env.NODE_ENV === "development";
}

/**
 * Install the `preSerialization` hook that checks each JSON response against the entry of the route that answered it
 * (the status, the body, the error `code`). An answer from no route (a `404` for a path that does not exist, a static
 * file) has no entry and is not checked.
 */
export function installResponseCheck(
  app: FastifyInstance,
  table: Readonly<Record<string, RouteDefinition>> = API,
): void {
  app.addHook("preSerialization", async (req, reply, payload) => {
    const id = req.routeOptions?.config?.route;
    const entry = id
      ? ((Object.hasOwn(table, id) ? table[id] : undefined) ?? app.syntheticEntries.get(id))
      : undefined;
    if (!id || !entry) return payload;
    const problems = checkResponse(entry, reply.statusCode, payload);
    if (problems.length === 0) return payload;
    req.log.error({
      reqId: req.id,
      route: id,
      method: req.method,
      status: reply.statusCode,
      problems: problems.slice(0, 20),
      msg: "response departs from its contract",
    });
    // Not a throw: an error being sent never reaches the server's error handler again, and the answer has to be the
    // envelope whatever was being sent. The status and the body are the handler's no longer.
    const message = `The response of ${entry.method} ${entry.path} departs from its contract: ${problems.slice(0, 8).join("; ")}`;
    reply.code(500);
    return { error: { code: "response_contract_violation", message }, message };
  });
}

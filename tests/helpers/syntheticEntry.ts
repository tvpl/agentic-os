import type { FastifyInstance } from "fastify";
import { API, type RouteDefinition } from "@mordomo/contracts";
import { bindEntry } from "../../apps/api/src/contract.js";

/**
 * Give one server an entry of its own, and bind a handler to it, to prove what the server does with an entry (that it
 * checks the answer, that it parses the parts in order) without touching the real routes. The route table `API` is
 * frozen, so this is the only way to have a route that is not in it, and it lives in the test suite: the service has no
 * function that adds an entry. The entry belongs to `app` and goes away with it; an id of the table cannot be shadowed.
 */
export function registerSyntheticEntry(
  app: FastifyInstance,
  id: string,
  entry: RouteDefinition,
  handler: Parameters<typeof bindEntry>[3],
  options?: Parameters<typeof bindEntry>[4],
): void {
  if (Object.hasOwn(API, id))
    throw new Error(`registerSyntheticEntry: "${id}" is an entry of the route table`);
  if (app.syntheticEntries.has(id)) throw new Error(`registerSyntheticEntry: "${id}" is already registered`);
  app.syntheticEntries.set(id, entry);
  bindEntry(app, id, entry, handler, options);
}

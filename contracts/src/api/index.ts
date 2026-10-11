/**
 * The route table: one entry for every route under `/api`, from which the server registers and validates, the route
 * document is generated and the interface types its calls. Adding a route is adding an entry here; the server will
 * not start with a route that has none, nor with an entry no route was bound to.
 */
import { deepFreeze } from "../freeze.js";
import { deviceRoutes } from "./devices.js";
import { memoryRoutes } from "./memory.js";
import { routineRoutes } from "./routines.js";
import { runRoutes } from "./runs.js";
import { skillRoutes } from "./skills.js";
import { streamRoutes } from "./streams.js";
import { systemRoutes } from "./system.js";
import type { RouteCall, RouteDefinition, RouteInput, RouteResult, SuccessBodies } from "./route.js";

/** A constant: the table itself is frozen like its entries, so no entry can be added, replaced or removed at run time. */
export const API = deepFreeze({
  ...systemRoutes,
  ...runRoutes,
  ...skillRoutes,
  ...routineRoutes,
  ...memoryRoutes,
  ...deviceRoutes,
  ...streamRoutes,
} as const);

export type ApiTable = typeof API;
export type RouteId = keyof ApiTable;

/** The entries by the key a request is known by: `"GET /api/runs/:id"`. */
export type RoutesByKey = {
  [K in RouteId as `${ApiTable[K]["method"]} ${ApiTable[K]["path"]}`]: ApiTable[K];
};
export type RouteKey = keyof RoutesByKey;

/** What a client passes to call the route `Key`. */
export type ApiCallInput<Key extends RouteKey> = RouteInput<RoutesByKey[Key]>;
/** What the route `Key` answers with on success. */
export type ApiCallResult<Key extends RouteKey> = RouteResult<RoutesByKey[Key]>;

/** What `bind` hands the handler of the route `K`, and what it must return. */
export type HandlerCall<K extends RouteId> = RouteCall<ApiTable[K]>;
export type HandlerResult<K extends RouteId> = SuccessBodies<ApiTable[K]>;

/** `"METHOD path"` of an entry. */
export function routeKey(entry: Pick<RouteDefinition, "method" | "path">): string {
  return `${entry.method} ${entry.path}`;
}

export * from "./route.js";
export { COMMON_ERRORS, ErrorEnvelope, commonErrorsFor, declaredErrors } from "./errors.js";
export { checkBody, checkResponse, toWire } from "./check.js";
export { wireSchema } from "./wireSchema.js";
export { SettingsPatchSchema, UiPreferencesPatchSchema, type SettingsPatch } from "./system.js";
export { isJournalDate } from "./memory.js";
export { QUERY_FLAG_TEXTS, QueryFlag, RUN_LIMITS } from "./common.js";
export { NAMED_SCHEMAS } from "./schemas.js";

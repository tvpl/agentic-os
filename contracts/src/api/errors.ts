/**
 * The single error envelope (api-v1, door 2) and the errors every route can answer. A route lists the others in the
 * `errors` of its entry; a response whose `(status, error.code)` is in neither list departs from the contract.
 */
import { z } from "zod";
import { deepFreeze } from "../freeze.js";
import type { ErrorDoc, RouteDefinition } from "./route.js";

/** Every status `>= 400` is `{ error: { code, message, issues? }, message }`; the top-level `message` repeats the inner one. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** The zod issues of a `400 validation`. */
    issues: z.array(z.unknown()).optional(),
  }),
  message: z.string(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

interface CommonError extends ErrorDoc {
  readonly applies: (route: RouteDefinition) => boolean;
}

const reads = (route: RouteDefinition): boolean => Boolean(route.params ?? route.query ?? route.body);
const writes = (route: RouteDefinition): boolean => route.method !== "GET";
const guarded = (route: RouteDefinition): boolean => route.public !== true;
const always = (): boolean => true;

/**
 * The routes that can answer the refusals of the path filter (`403 forbidden_path`) and of the safe reader (`404
 * not_a_file`, `413 file_too_large`). They are not common errors: `GET /api/settings` never touches a path. The lists
 * are not an opinion about which routes "look like" they read files: `tests/api.refusals.test.ts` calls each of the
 * 155 routes, once for each kind of read the route makes (one kind refuses at a time: a hostile file is one file, and
 * a refusal that only exists after an earlier read succeeded is not seen when that read refuses too), and compares
 * the routes that answered the refusal with these lists in both directions. `404` and `413` have a list each: a route
 * can answer one and not the other. A route that gains a read, or loses one, fails there
 * with the route named; the lists are changed to what the probe printed.
 */
const FORBIDDEN_PATH_ROUTES: ReadonlySet<string> = new Set([
  "DELETE /api/skills/:slug",
  "GET /api/artifacts/file",
  "GET /api/artifacts/raw",
  "GET /api/connectors",
  "GET /api/connectors/:id/data",
  "GET /api/connectors/:id/setup",
  "GET /api/connectors/audit",
  // cerebro-paineis, door 1: the list reads memory/dashboards/ through the safe reader, and a new dashboard is written
  // there through the guarded writer.
  "GET /api/dashboards",
  "GET /api/diagnostics/export",
  "GET /api/doctor",
  "GET /api/memory/hygiene",
  "GET /api/memory/journal",
  "GET /api/memory/preview",
  "GET /api/routines",
  "GET /api/routines/silent",
  "GET /api/routines/summary",
  "GET /api/runs/:id/diff",
  "GET /api/skills",
  "GET /api/skills/:slug",
  "GET /api/skills/:slug/notes",
  "GET /api/skills/:slug/resource",
  "GET /api/skills/registry",
  "GET /api/sync/plan",
  // cerebro-contextos, door 9: "Edit brief" writes memory/notes/<id>/_resumo.md through the guarded writer.
  "PATCH /api/contexts/:id",
  "POST /api/connectors",
  "POST /api/dashboards",
  // cerebro-paineis, batch B: an export is written under artifacts/dashboards/ through the guarded writer.
  "POST /api/dashboards/:id/export",
  // cerebro-faxina-guiada, door 4: the undo reads the manifest it is given through the safe reader (strict).
  "POST /api/memory/cleanup/undo",
  "POST /api/memory/journal/append",
  "POST /api/memory/open",
  "POST /api/memory/routers",
  "POST /api/microapps/pixel/save",
  "POST /api/objectives/:id/dispatch",
  "POST /api/providers/:id/smoke",
  "POST /api/routines",
  "POST /api/routines/:id/duplicate",
  "POST /api/routines/:id/run",
  "POST /api/routines/:id/toggle",
  "POST /api/runs",
  "POST /api/runs/:id/children",
  "POST /api/runs/:id/retry",
  "POST /api/sessions/:id/continue",
  "POST /api/skills",
  "POST /api/skills/:slug/notes",
  "POST /api/skills/:slug/notes/promote",
  "POST /api/skills/:slug/run",
  "POST /api/skills/:slug/toggle",
  "POST /api/skills/import",
  "POST /api/skills/install",
  "POST /api/sync/apply",
  "PUT /api/connectors/:id",
  "PUT /api/routines/:id",
  "PUT /api/skills/:slug",
]);

const NOT_A_FILE_ROUTES: ReadonlySet<string> = new Set([
  "DELETE /api/skills/:slug",
  "GET /api/connectors/:id/data",
  "GET /api/connectors/:id/setup",
  "GET /api/memory/journal",
  "GET /api/skills/:slug",
  "GET /api/skills/:slug/notes",
  "GET /api/skills/:slug/resource",
  "GET /api/sync/plan",
  "POST /api/connectors",
  // cerebro-faxina-guiada, door 4: the undo reads the manifest it is given through the safe reader (strict).
  "POST /api/memory/cleanup/undo",
  "POST /api/memory/journal/append",
  "POST /api/memory/routers",
  "POST /api/routines",
  "POST /api/routines/:id/duplicate",
  "POST /api/routines/:id/run",
  "POST /api/routines/:id/toggle",
  "POST /api/skills",
  "POST /api/skills/:slug/notes",
  "POST /api/skills/:slug/notes/promote",
  "POST /api/skills/:slug/run",
  "POST /api/skills/:slug/toggle",
  "POST /api/skills/import",
  "POST /api/skills/install",
  "POST /api/sync/apply",
  "PUT /api/connectors/:id",
  "PUT /api/routines/:id",
  "PUT /api/skills/:slug",
]);

const TOO_LARGE_ROUTES: ReadonlySet<string> = new Set([
  "DELETE /api/skills/:slug",
  "GET /api/connectors/:id/data",
  "GET /api/connectors/:id/setup",
  "GET /api/memory/journal",
  "GET /api/skills/:slug",
  "GET /api/skills/:slug/notes",
  "GET /api/skills/:slug/resource",
  "GET /api/sync/plan",
  "POST /api/connectors",
  // cerebro-faxina-guiada, door 4: the undo reads the manifest it is given through the safe reader (strict).
  "POST /api/memory/cleanup/undo",
  "POST /api/memory/journal/append",
  "POST /api/memory/routers",
  "POST /api/routines",
  "POST /api/routines/:id/duplicate",
  "POST /api/routines/:id/run",
  "POST /api/routines/:id/toggle",
  "POST /api/skills",
  "POST /api/skills/:slug/notes",
  "POST /api/skills/:slug/notes/promote",
  "POST /api/skills/:slug/run",
  "POST /api/skills/:slug/toggle",
  "POST /api/skills/import",
  "POST /api/skills/install",
  "POST /api/sync/apply",
  "PUT /api/connectors/:id",
  "PUT /api/routines/:id",
  "PUT /api/skills/:slug",
]);
const keyOf = (route: RouteDefinition): string => `${route.method} ${route.path}`;
const namesPaths = (route: RouteDefinition): boolean => FORBIDDEN_PATH_ROUTES.has(keyOf(route));
const isNotAFile = (route: RouteDefinition): boolean => NOT_A_FILE_ROUTES.has(keyOf(route));
const isTooLarge = (route: RouteDefinition): boolean => TOO_LARGE_ROUTES.has(keyOf(route));

/** What any route can answer, whatever its entry says: the gate before the route, the parser and the server. */
export const COMMON_ERRORS: readonly CommonError[] = deepFreeze([
  {
    status: 400,
    code: "validation",
    description:
      "A part of the request does not satisfy the schema of the route; error.issues lists each one",
    applies: reads,
  },
  {
    status: 400,
    code: "bad_request",
    description: "The request body is not valid JSON",
    applies: writes,
  },
  {
    status: 401,
    code: "unauthorized",
    description:
      "No valid credential: the local token or a device token in x-mordomo-token, a stream ticket or the token in the URL where the route takes one, or a token in the URL of a route that does not",
    applies: always,
  },
  {
    status: 403,
    code: "tls_required",
    description:
      "A client on another machine must speak TLS (remote.tls) or reach the service through a tunnel on this machine",
    applies: always,
  },
  {
    status: 403,
    code: "forbidden_host",
    description: "The Host header is not a loopback name nor one of remote.allowedHosts",
    applies: always,
  },
  {
    status: 403,
    code: "owner_only",
    description: "A paired device called a route that only the owner, with the local token, can call",
    applies: guarded,
  },
  {
    status: 403,
    code: "scope_required",
    description: "A paired device called a route whose scope it does not hold (x-mordomo-scope)",
    applies: guarded,
  },
  {
    status: 403,
    code: "forbidden",
    description: "The credential of a run (the permission broker, or a memory skill) cannot call this route",
    applies: guarded,
  },
  {
    status: 403,
    code: "forbidden_path",
    description:
      "A path the request names, or a link inside a folder it reads, is outside the folders the owner granted, inside the home's config/ or logs/, or a secret file name",
    applies: namesPaths,
  },
  {
    status: 404,
    code: "not_a_file",
    description:
      "A path the route reads names something that is not a regular file (a folder, a device, a link out of the folders)",
    applies: isNotAFile,
  },
  {
    status: 413,
    code: "file_too_large",
    description: "A file the route reads is larger than the route reads",
    applies: isTooLarge,
  },
  {
    status: 413,
    code: "payload_too_large",
    description: "The request body is larger than 5 MiB",
    applies: writes,
  },
  {
    status: 415,
    code: "unsupported_media_type",
    description: "The request body is not application/json",
    applies: writes,
  },
  {
    status: 429,
    code: "too_many_requests",
    description:
      "Twenty 401 responses within five minutes from this address lock it out until the window passes; Retry-After says how many seconds",
    applies: always,
  },
  {
    status: 500,
    code: "response_contract_violation",
    description:
      "Only on a development or test server (validateResponses): the handler answered something its route's entry does not describe; error.message lists the paths that differ",
    applies: always,
  },
  {
    status: 500,
    code: "internal",
    description: "An unhandled error; the detail is in logs/api.jsonl, never in the response",
    applies: always,
  },
]);

/** The common errors that apply to a route. */
export function commonErrorsFor(route: RouteDefinition): ErrorDoc[] {
  return COMMON_ERRORS.filter((e) => e.applies(route)).map(({ status, code, description }) => ({
    status,
    code,
    description,
  }));
}

/** Every error a route may answer: its own, then the common ones that apply. */
export function declaredErrors(route: RouteDefinition): ErrorDoc[] {
  return [...(route.errors ?? []), ...commonErrorsFor(route)];
}

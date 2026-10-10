import type { FastifyInstance } from "fastify";
import { API_VERSION } from "./apiVersion.js";
import type { ApiRoute } from "./server.js";

/**
 * `GET /api/v1/openapi.json`: an OpenAPI 3.1 document generated from the
 * route table Fastify built at startup (`app.apiRoutes`), so a route added
 * without documentation still appears. Each operation carries its method,
 * path parameters, who may call it (`security`, `x-mordomo-scope`: `owner` or
 * the scope a device must hold) and the error envelope; request and response
 * bodies are not described yet.
 */
export function registerOpenApiRoute(app: FastifyInstance): void {
  let document: Record<string, unknown> | null = null;
  app.get(
    "/api/openapi.json",
    { config: { scope: "monitor" } },
    async () => (document ??= openApiDocument(app.apiRoutes)),
  );
}

const ERROR_RESPONSE = { $ref: "#/components/responses/Error" };
const ERROR_CONTENT = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };

/**
 * The statuses a route answers beyond the generic 4XX/5XX, with the `error.code` each carries - the ones a client
 * is expected to act on. Keyed by method and route path as Fastify registered it.
 */
const KNOWN_ERRORS: Record<string, Record<string, string>> = {
  "POST /api/backups": {
    "409":
      "error.code restore_in_progress (a restore, a backup or a starting process holds the home: try again), " +
      "restore_leftover (a restore left something to clear by hand), restore_recovery_failed (a dead restore " +
      "could not be undone) or restore_lock_unusable (config/run/restore.lock cannot be a lock)",
  },
  "POST /api/backups/:name/restore": {
    "404": "no such backup",
    "409": "runs are active",
    "422": "error.code backup_invalid or backup_unsealed",
  },
};

export function openApiDocument(routes: readonly ApiRoute[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const params = [...route.url.matchAll(/:(\w+)/g)].map((m) => m[1]!);
    const path = `/api/v1${route.url.slice("/api".length)}`.replace(/:(\w+)/g, "{$1}");
    const security = route.config.public
      ? []
      : [
          { localToken: [] },
          ...(route.config.queryToken ? [{ queryToken: [] }] : []),
          ...(route.config.ticket ? [{ streamTicket: [] }] : []),
        ];
    (paths[path] ??= {})[route.method.toLowerCase()] = {
      tags: [route.url.split("/")[2]],
      parameters: params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      security,
      ...(route.config.scope ? { "x-mordomo-scope": route.config.scope } : {}),
      responses: {
        "200": { description: "Success" },
        ...Object.fromEntries(
          Object.entries(KNOWN_ERRORS[`${route.method.toUpperCase()} ${route.url}`] ?? {}).map(
            ([status, description]) => [status, { description, content: ERROR_CONTENT }],
          ),
        ),
        "4XX": ERROR_RESPONSE,
        "5XX": ERROR_RESPONSE,
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "MordomoOS API",
      version: String(API_VERSION),
      description:
        "Local API of MordomoOS. /api/v1 is the documented path; the unversioned /api is a deprecated alias. " +
        "Every route that is not public declares the scope that may call it (x-mordomo-scope): the owner (the local " +
        "token) calls all of them; a paired device calls those whose scope it holds - monitor, content, run or " +
        'approve - and never those marked "owner". The two event streams also take a one-use ticket from ' +
        "POST /api/v1/stream-tickets.",
    },
    paths,
    components: {
      securitySchemes: {
        localToken: { type: "apiKey", in: "header", name: "x-mordomo-token" },
        queryToken: { type: "apiKey", in: "query", name: "token" },
        streamTicket: { type: "apiKey", in: "query", name: "ticket" },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                issues: { type: "array", items: { type: "object" } },
              },
            },
            message: { type: "string", description: "The same as error.message, for older clients." },
          },
        },
      },
      responses: {
        Error: {
          description: "Error envelope",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  };
}

import type { FastifyInstance } from "fastify";
import { ignoreOverride, zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import {
  API,
  NAMED_SCHEMAS,
  QUERY_FLAG_TEXTS,
  QueryFlag,
  declaredErrors,
  isRawResponse,
  wireSchema,
  type ErrorDoc,
  type RouteDefinition,
} from "@mordomo/contracts";
import { bind } from "./contract.js";
import { API_VERSION } from "./apiVersion.js";

/**
 * `GET /api/v1/openapi.json`: the OpenAPI 3.1 description of the API, generated from the route table (`API`,
 * `@mordomo/contracts`). Each operation carries its parameters, its request body, one response per success status
 * with the schema of the entry, one response per error it can answer (the entry's `errors` and the `COMMON_ERRORS`
 * that apply) with the single error envelope, and who may call it: `security` for the credential, and
 * `x-mordomo-scope` - the only extension - for the scope a paired device must hold, which `security` cannot say.
 */
export function registerOpenApiRoute(app: FastifyInstance): void {
  let document: OpenApiDocument | null = null;
  bind(app, "openapi.get", async () => (document ??= openApiDocument(API)));
}

export type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
    license: { name: string; url: string };
  };
  /** The API is served from the root of the origin that served the document. */
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, JsonSchema>;
  };
}

/**
 * The named schemas by the zod definition that stands for them (the wire form of each: what a response carries), so
 * that where a response uses one, the document points at it.
 */
const NAME_OF = new Map<unknown, string>(
  Object.entries(NAMED_SCHEMAS).map(([name, schema]) => [wireSchema(schema)._def, name]),
);

/**
 * Converter options. `except` is the named schema being described itself: its own body is not a pointer to itself.
 * `named` is false for a request part: a request is described by its INPUT type (a key with a default is optional),
 * so it is not pointed at the components, which are the output types.
 */
function schemaOptions(except?: string, named = true) {
  return {
    // The wire is closed by `checkResponse`, not by the schema: a reader accepts a key it does not know (docs/events.md).
    removeAdditionalStrategy: "strict" as const,
    // No pointers into the middle of another schema (the converter's own sharing): only to a named one, below.
    $refStrategy: "none" as const,
    target: "jsonSchema7" as const,
    override: (def: unknown) => {
      // A flag in a query is the four texts it reads, not the boolean it becomes.
      if (def === QueryFlag._def) return { type: "string", enum: [...QUERY_FLAG_TEXTS] };
      const name = named ? NAME_OF.get(def) : undefined;
      return name !== undefined && name !== except
        ? { $ref: `#/components/schemas/${name}` }
        : ignoreOverride;
    },
  };
}

/** zod types the JSON Schema converter cannot express: a route that uses one cannot be described. */
const UNEXPRESSIBLE = new Set([
  "ZodFunction",
  "ZodPromise",
  "ZodSymbol",
  "ZodVoid",
  "ZodNever",
  "ZodNaN",
  "ZodMap",
  "ZodSet",
]);

/** The name of the first zod type under `schema` that has no JSON Schema, or null. */
export function findUnexpressible(schema: z.ZodTypeAny, seen = new Set<unknown>()): string | null {
  if (seen.has(schema)) return null;
  seen.add(schema);
  const def = schema._def as Record<string, unknown> & { typeName?: string };
  if (def.typeName && UNEXPRESSIBLE.has(def.typeName)) return def.typeName;
  const children: unknown[] = [];
  for (const key of ["innerType", "schema", "type", "valueType", "keyType", "left", "right"])
    children.push(def[key]);
  if (typeof def.shape === "function")
    children.push(...Object.values((def.shape as () => Record<string, unknown>)()));
  if (Array.isArray(def.options)) children.push(...def.options);
  else if (def.options instanceof Map) children.push(...def.options.values());
  if (Array.isArray(def.items)) children.push(...def.items);
  if (def.rest) children.push(def.rest);
  for (const child of children) {
    if (child && typeof child === "object" && "_def" in child) {
      const found = findUnexpressible(child as z.ZodTypeAny, seen);
      if (found) return found;
    }
  }
  return null;
}

/** The schema of a request part (`wire` false: its input type) or of what a response carries (`wire` true). */
function toJsonSchema(schema: z.ZodTypeAny, where: string, wire = false): JsonSchema {
  const bad = findUnexpressible(schema);
  if (bad) throw new Error(`${where}: ${bad} has no JSON Schema, so the route cannot be described`);
  const out = zodToJsonSchema(
    wire ? wireSchema(schema) : schema,
    schemaOptions(undefined, wire),
  ) as JsonSchema & {
    $schema?: string;
  };
  // The schema is a node of the document, not a document: its dialect is the document's.
  delete out.$schema;
  return out;
}

const pathParameters = (path: string): string[] => [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!);

/** The error envelope responses of an operation, one per status, listing each `error.code` the status can carry. */
function errorResponses(route: RouteDefinition): Record<string, unknown> {
  const byStatus = new Map<number, ErrorDoc[]>();
  for (const error of declaredErrors(route)) {
    const list = byStatus.get(error.status) ?? [];
    // The same (status, code) can be named by the entry and by the common list: one line.
    if (!list.some((e) => e.code === error.code)) list.push(error);
    byStatus.set(error.status, list);
  }
  const content = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
  const out: Record<string, unknown> = {};
  for (const [status, errors] of [...byStatus].sort(([a], [b]) => a - b)) {
    out[String(status)] = {
      description:
        errors.length === 1
          ? `error.code ${errors[0]!.code}: ${errors[0]!.description}`
          : `error.code ${errors.map((e) => `${e.code} (${e.description})`).join("; ")}`,
      content,
      ...(status === 429
        ? {
            headers: {
              "Retry-After": {
                description: "Seconds until the next attempt counts",
                schema: { type: "integer" },
              },
            },
          }
        : {}),
    };
  }
  return out;
}

function operation(id: string, route: RouteDefinition): Record<string, unknown> {
  const where = `${route.method} ${route.path} (${id})`;
  const successes = Object.entries(route.responses);
  if (successes.length === 0)
    throw new Error(`${where}: no success response, so the route cannot be described`);
  for (const [status, spec] of successes) {
    const code = Number(status);
    if (!(code >= 200 && code < 300)) {
      throw new Error(
        `${where}: responses lists ${status}, which is no success status (an error goes in errors)`,
      );
    }
    if (!isRawResponse(spec) && !(typeof spec === "object" && spec !== null && "_def" in spec)) {
      throw new Error(`${where}: the ${status} response is neither a schema nor a raw kind`);
    }
  }

  const parameters: unknown[] = [];
  const paramsSchema = route.params ? toJsonSchema(route.params, `${where} params`) : null;
  const paramProps = (paramsSchema?.properties ?? {}) as Record<string, JsonSchema>;
  for (const name of pathParameters(route.path)) {
    parameters.push({ name, in: "path", required: true, schema: paramProps[name] ?? { type: "string" } });
  }
  if (route.query) {
    const query = toJsonSchema(route.query, `${where} query`);
    const required = new Set((query.required ?? []) as string[]);
    for (const [name, schema] of Object.entries((query.properties ?? {}) as Record<string, JsonSchema>)) {
      // The credential in the URL is `security` (queryToken, streamTicket), not a parameter of the route.
      if ((name === "token" && route.queryToken) || (name === "ticket" && route.ticket)) continue;
      parameters.push({ name, in: "query", required: required.has(name), schema });
    }
  }

  const responses: Record<string, unknown> = {};
  successes.forEach(([status, spec], index) => {
    const headers =
      index === 0 && route.headers
        ? Object.fromEntries(
            Object.entries(route.headers).map(([name, description]) => [
              name,
              { description, schema: { type: "string" } },
            ]),
          )
        : undefined;
    if (isRawResponse(spec)) {
      const frame = spec.frame ? toJsonSchema(spec.frame, `${where} ${status} frame`, true) : null;
      responses[status] = {
        description: spec.description,
        content: Object.fromEntries(
          spec.contentTypes.map((type) => [
            type,
            spec.raw === "stream" && frame
              ? { schema: frame }
              : { schema: { type: "string", format: "binary" } },
          ]),
        ),
        ...(headers ? { headers } : {}),
      };
    } else {
      responses[status] = {
        description: "Success",
        content: { "application/json": { schema: toJsonSchema(spec, `${where} ${status}`, true) } },
        ...(headers ? { headers } : {}),
      };
    }
  });
  Object.assign(responses, errorResponses(route));

  const security = route.public
    ? []
    : [
        { localToken: [] },
        ...(route.queryToken ? [{ queryToken: [] }] : []),
        ...(route.ticket ? [{ streamTicket: [] }] : []),
      ];
  return {
    operationId: id,
    tags: [route.tag],
    summary: route.summary,
    parameters,
    ...(route.body
      ? {
          requestBody: {
            required: route.bodyOptional !== true,
            content: { "application/json": { schema: toJsonSchema(route.body, `${where} body`) } },
          },
        }
      : {}),
    security,
    ...(route.scope ? { "x-mordomo-scope": route.scope } : {}),
    responses,
  };
}

export function openApiDocument(table: Readonly<Record<string, RouteDefinition>>): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};
  for (const [id, route] of Object.entries(table)) {
    const path = `/api/v1${route.path.slice("/api".length)}`.replace(/:(\w+)/g, "{$1}");
    (paths[path] ??= {})[route.method.toLowerCase()] = operation(id, route);
  }
  const schemas: Record<string, JsonSchema> = {};
  for (const [name, schema] of Object.entries(NAMED_SCHEMAS)) {
    // A named schema may name another one: it is described next to them, not inside them.
    const json = zodToJsonSchema(wireSchema(schema), schemaOptions(name)) as JsonSchema;
    delete json.$schema;
    schemas[name] = json;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "MordomoOS API",
      version: String(API_VERSION),
      license: {
        name: "FSL-1.1-ALv2",
        url: "https://github.com/tvpl/agentic-os/blob/main/LICENSE",
      },
      description:
        "Local API of MordomoOS. /api/v1 is the documented path; the unversioned /api is a deprecated alias. " +
        "Every route that is not public declares the scope that may call it (x-mordomo-scope): the owner (the local " +
        "token) calls all of them; a paired device calls those whose scope it holds - monitor, content, run or " +
        'approve - and never those marked "owner". The two event streams also take a one-use ticket from ' +
        "POST /api/v1/stream-tickets. Every status >= 400 is the single error envelope (components.schemas.Error). " +
        "The schemas describe what the server sends; a client must ignore a key it does not know (docs/events.md).",
    },
    servers: [{ url: "/", description: "The origin that served this document (the local service)" }],
    paths,
    components: {
      securitySchemes: {
        localToken: { type: "apiKey", in: "header", name: "x-mordomo-token" },
        queryToken: { type: "apiKey", in: "query", name: "token" },
        streamTicket: { type: "apiKey", in: "query", name: "ticket" },
      },
      schemas,
    },
  };
}

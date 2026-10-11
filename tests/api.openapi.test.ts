import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ChildProcess from "node:child_process";
import type * as Instances from "../apps/api/src/instances.js";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { z } from "zod";
import {
  API,
  NAMED_SCHEMAS,
  declaredErrors,
  isRawResponse,
  route,
  routeKey,
  type RouteDefinition,
} from "@mordomo/contracts";
import { openApiDocument, type OpenApiDocument } from "../apps/api/src/openapi.js";
import { buildWorld, runScenarios, type Result, type World } from "./helpers/contractWorld.js";

// ajv and ajv-formats are CommonJS: the default export may be the module or its `default`.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ??
  Ajv2020Module) as typeof Ajv2020Module;
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as typeof addFormatsModule;

/** The route document (.specs/features/contratos-rest, S3): complete, valid, and true to what the server sends. */

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (command: string, args: readonly string[] = [], ...rest: unknown[]) => {
      if (args.includes("restart")) {
        const fake = new EventEmitter() as EventEmitter & { unref: () => void };
        fake.unref = () => undefined;
        return fake;
      }
      return (actual.spawn as (...a: unknown[]) => unknown)(command, args, ...rest);
    },
  };
});
vi.mock("../apps/api/src/instances.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Instances>()),
  terminate: async () => [],
}));

const entries = Object.entries(API) as Array<[string, RouteDefinition]>;
type Operation = {
  operationId: string;
  parameters: Array<{ name: string; in: string; required: boolean; schema: unknown }>;
  requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: unknown }>; headers?: Record<string, unknown> }
  >;
  security: unknown[];
  "x-mordomo-scope"?: string;
};

let world: World;
let doc: OpenApiDocument;
let results: Result[];

const operationOf = (entry: RouteDefinition): Operation => {
  const p = `/api/v1${entry.path.slice(4)}`.replace(/:(\w+)/g, "{$1}");
  return doc.paths[p]![entry.method.toLowerCase()] as unknown as Operation;
};

beforeAll(async () => {
  world = await buildWorld();
  const res = await world.call("GET", "/api/openapi.json");
  expect(res.status).toBe(200);
  doc = res.body as OpenApiDocument;
  results = await runScenarios(world);
}, 180_000);

afterAll(async () => {
  await world.close();
});

describe("S3 the document", () => {
  it("C15 every route has parameters, request body and a response schema", () => {
    expect(doc.openapi).toBe("3.1.0");
    const operations = Object.values(doc.paths).reduce((n, methods) => n + Object.keys(methods).length, 0);
    expect(operations).toBe(127);
    for (const [id, entry] of entries) {
      const op = operationOf(entry);
      expect(op, id).toBeDefined();
      expect(op.operationId, id).toBe(id);
      // Path parameters are the `:name` of the path, each required and typed.
      const pathParams = op.parameters.filter((p) => p.in === "path");
      expect(
        pathParams.map((p) => p.name),
        id,
      ).toEqual([...entry.path.matchAll(/:(\w+)/g)].map((m) => m[1]));
      for (const p of pathParams) {
        expect(p.required, `${id} ${p.name}`).toBe(true);
        expect(["string", "integer"], `${id} ${p.name}`).toContain((p.schema as { type: string }).type);
      }
      // Query parameters are the keys of the entry's query (the credential in the URL is `security`, not a parameter).
      const queryShape = entry.query
        ? ((entry.query as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>)
        : {};
      const expected = Object.keys(queryShape).filter(
        (name) => !((name === "token" && entry.queryToken) || (name === "ticket" && entry.ticket)),
      );
      const queryParams = op.parameters.filter((p) => p.in === "query");
      expect(queryParams.map((p) => p.name).sort(), id).toEqual(expected.sort());
      for (const p of queryParams)
        expect(p.required, `${id} ?${p.name}`).toBe(!queryShape[p.name]!.isOptional());
      // A request body exactly where the entry has one.
      expect(op.requestBody !== undefined, id).toBe(entry.body !== undefined);
      if (entry.body) {
        expect(op.requestBody!.required, id).toBe(entry.bodyOptional !== true);
        expect(op.requestBody!.content["application/json"]!.schema, id).toBeDefined();
      }
      // A response for each success status: a schema, or the content types of the raw kind.
      for (const [status, spec] of Object.entries(entry.responses)) {
        const response = op.responses[status]!;
        expect(response, `${id} ${status}`).toBeDefined();
        if (isRawResponse(spec)) {
          expect(Object.keys(response.content!).sort(), `${id} ${status}`).toEqual(
            [...spec.contentTypes].sort(),
          );
        } else {
          expect(Object.keys(response.content!), `${id} ${status}`).toEqual(["application/json"]);
          expect(response.content!["application/json"]!.schema, `${id} ${status}`).toBeDefined();
        }
      }
      // The headers an entry names are on its first success response.
      for (const header of Object.keys(entry.headers ?? {})) {
        expect(Object.keys(Object.values(op.responses)[0]!.headers ?? {}), id).toContain(header);
      }
    }
  });

  it("C16 the document validates as OpenAPI 3.1", async () => {
    const copy = JSON.parse(JSON.stringify(doc)) as OpenApiDocument;
    const validated = (await SwaggerParser.validate(copy as never)) as { openapi: string };
    expect(validated.openapi).toBe("3.1.0");
    // What a linter asks of a document the API publishes: where it is served from, and under which license.
    expect(doc.servers).toEqual([expect.objectContaining({ url: "/" })]);
    expect(doc.info.license).toEqual({
      name: "FSL-1.1-ALv2",
      url: expect.stringMatching(/^https:\/\/.+\/LICENSE$/),
    });
    // The validator is not asleep: it refuses a response with no description (OpenAPI 3.1 requires one)…
    const broken = JSON.parse(JSON.stringify(doc)) as OpenApiDocument;
    const responses = (
      broken.paths["/api/v1/runs/{id}"]!.get as unknown as {
        responses: Record<string, Record<string, unknown>>;
      }
    ).responses;
    delete responses[Object.keys(responses)[0]!]!.description;
    await expect(SwaggerParser.validate(broken as never)).rejects.toThrow();
    // …and a pointer to a schema that does not exist.
    const dangling = JSON.parse(JSON.stringify(doc)) as OpenApiDocument;
    (dangling.paths["/api/v1/runs/{id}"]!.get as unknown as { responses: Record<string, unknown> }).responses[
      "200"
    ] = {
      description: "x",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Nope" } } },
    };
    await expect(SwaggerParser.validate(dangling as never)).rejects.toThrow();
  });

  it("C39 the component names of the document are the ones fixed", () => {
    // The names of `components.schemas` are the type names of every client generated from the document: they are
    // fixed here, so renaming one is a decision and not a side effect.
    const names = Object.keys(
      (doc as unknown as { components: { schemas: Record<string, unknown> } }).components.schemas,
    ).sort();
    expect(names).toEqual(
      [
        "Approval",
        "BackupInfo",
        "Connector",
        "ConnectorData",
        "DoctorReport",
        "Device",
        "Error",
        "Fact",
        "MetricsSample",
        "Notification",
        "ProviderCapabilities",
        "Routine",
        "RoutineStatus",
        "Run",
        "RunEvent",
        "RunSummary",
        "RunUsage",
        "Session",
        "Settings",
        "Skill",
        "UiPreferences",
      ].sort(),
    );
    // Each one is pointed at by something, and every pointer lands on one of them.
    const text = JSON.stringify(doc);
    for (const name of names) expect(text, name).toContain(`"#/components/schemas/${name}"`);
    const pointers = new Set([...text.matchAll(/"#\/components\/schemas\/([A-Za-z]+)"/g)].map((m) => m[1]!));
    expect([...pointers].filter((n) => !names.includes(n))).toEqual([]);
  });

  it("C15 a key the server always sends is required in the document, a default or not", () => {
    // The document describes what a response carries (the output type): a key with `.default()` or `.catch()` is
    // always there, so a client generated from the document must not read it as optional. Only `.optional()` is optional.
    const inner = (schema: z.ZodTypeAny): z.ZodTypeAny => {
      const def = schema._def as { typeName: string; schema?: z.ZodTypeAny };
      return def.typeName === "ZodEffects" ? inner(def.schema!) : schema;
    };
    const optional = (schema: z.ZodTypeAny): boolean => {
      const def = schema._def as { typeName: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny };
      if (def.typeName === "ZodOptional") return true;
      if (def.typeName === "ZodDefault" || def.typeName === "ZodCatch") return optional(def.innerType!);
      if (def.typeName === "ZodEffects") return optional(def.schema!);
      return false;
    };
    const named = doc.components.schemas as Record<string, { required?: string[] }>;
    let objects = 0;
    let defaulted = 0;
    for (const [name, schema] of Object.entries(NAMED_SCHEMAS)) {
      const object = inner(schema);
      if ((object._def as { typeName: string }).typeName !== "ZodObject") continue;
      const shape = (object as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      const expected = Object.entries(shape)
        .filter(([, child]) => !optional(child))
        .map(([key]) => key)
        .sort();
      expect([...(named[name]!.required ?? [])].sort(), name).toEqual(expected);
      objects += 1;
      defaulted += Object.values(shape).filter(
        (child) => (child._def as { typeName: string }).typeName === "ZodDefault",
      ).length;
    }
    expect(objects).toBeGreaterThanOrEqual(15);
    // The ones the converter used to leave out are in this proof: Settings, UiPreferences, Connector, Skill, Routine.
    expect(defaulted).toBeGreaterThan(40);
    for (const name of ["Settings", "UiPreferences", "Connector", "Skill", "Routine"])
      expect(named[name]!.required?.length, name).toBeGreaterThan(5);
    // And in the operations: the inline schema of a response with a default is as strict (`GET /api/meta`).
    const meta = (
      doc.paths["/api/v1/meta"]!.get as {
        responses: Record<string, { content: Record<string, { schema: { required?: string[] } }> }>;
      }
    ).responses["200"]!.content["application/json"]!.schema;
    expect([...(meta.required ?? [])].sort()).toEqual(
      Object.keys(((API["meta.get"].responses[200] as z.AnyZodObject).shape ?? {}) as object)
        .filter((key) => !optional((API["meta.get"].responses[200] as z.AnyZodObject).shape[key]))
        .sort(),
    );
  });

  it("C15 the flags of a query are documented as the texts they read", () => {
    const flags: Array<[string, string]> = [
      ["/api/v1/notifications", "unread"],
      ["/api/v1/skills/registry", "refresh"],
      ["/api/v1/memory/graph", "related"],
      ["/api/v1/memory/recall", "record"],
      ["/api/v1/memory/facts", "includeExpired"],
    ];
    for (const [path, name] of flags) {
      const parameters = (doc.paths[path]!.get as { parameters: Array<{ name: string; schema: unknown }> })
        .parameters;
      expect(parameters.find((p) => p.name === name)!.schema, `${path} ${name}`).toEqual({
        type: "string",
        enum: ["1", "true", "0", "false"],
      });
    }
  });

  it("C17 each operation lists the error envelope for its errors", () => {
    let checked = 0;
    for (const [id, entry] of entries) {
      const op = operationOf(entry);
      const errors = declaredErrors(entry);
      for (const status of new Set(errors.map((e) => e.status))) {
        const response = op.responses[String(status)];
        expect(response, `${id} ${status}`).toBeDefined();
        expect(response!.content!["application/json"]!.schema, `${id} ${status}`).toEqual({
          $ref: "#/components/schemas/Error",
        });
        for (const e of errors.filter((x) => x.status === status)) {
          expect(response!.description, `${id} ${status} ${e.code}`).toContain(e.code);
          checked += 1;
        }
      }
      // The ones that apply by the shape of the route.
      const has = (status: number) => op.responses[String(status)] !== undefined;
      expect(has(401) && has(403) && has(429) && has(500), id).toBe(true);
      expect(has(400), `${id} 400`).toBe(
        entry.params !== undefined ||
          entry.query !== undefined ||
          entry.body !== undefined ||
          entry.method !== "GET",
      );
      expect(has(413), `${id} 413`).toBe(
        entry.method !== "GET" || declaredErrors(entry).some((e) => e.status === 413),
      );
      expect(has(415), `${id} 415`).toBe(
        entry.method !== "GET" || entry.errors?.some((e) => e.status === 415) === true,
      );
      expect(op.responses["429"]!.headers, id).toHaveProperty("Retry-After");
    }
    expect(checked).toBeGreaterThan(900);
    // The codes of the backup routes keep the order the earlier feature's test reads.
    expect(operationOf(API["backups.create"]).responses["409"]!.description).toMatch(
      /restore_in_progress.*restore_leftover.*restore_recovery_failed.*restore_lock_unusable/,
    );
  });

  it("C17 the refusals of the file readers are listed only by the routes that read files", () => {
    // `403 forbidden_path`, `404 not_a_file` and `413 file_too_large` were on all 127 operations; `GET /api/settings`
    // cannot answer them. Each is listed by the routes that name a path or read a file, and by no other.
    const where = (status: number, code: string) =>
      entries
        .filter(([, e]) => declaredErrors(e).some((x) => x.status === status && x.code === code))
        .map(([, e]) => routeKey(e))
        .sort();
    const files = where(404, "not_a_file");
    expect(where(413, "file_too_large")).toEqual(files);
    // The areas that read and write files, and the one route outside them that reads a changed file.
    const areas = ["/api/memory/", "/api/skills", "/api/artifacts/", "/api/sync/", "/api/microapps/"];
    expect(files).toEqual(
      entries
        .map(([, e]) => e)
        .filter((e) => areas.some((a) => e.path.startsWith(a)) || routeKey(e) === "GET /api/runs/:id/diff")
        .map(routeKey)
        .sort(),
    );
    expect(files).toContain("GET /api/memory/preview");
    expect(files).toContain("GET /api/runs/:id/diff");
    const paths = where(403, "forbidden_path");
    for (const file of files) expect(paths).toContain(file);
    expect(paths).toContain("POST /api/runs");
    for (const quiet of [
      "GET /api/settings",
      "GET /api/health",
      "GET /api/metrics",
      "DELETE /api/sessions/:id",
    ])
      expect(paths, quiet).not.toContain(quiet);
    expect(paths.length).toBeLessThan(70);
    expect(paths.length).toBeGreaterThan(40);
  });

  it("C18 the 403, 409, 413, 422 and 429 of the earlier features are documented", () => {
    const named: Array<[number, string]> = [
      [403, "owner_only"],
      [403, "scope_required"],
      [403, "tls_required"],
      [403, "self_approval"],
      [409, "restore_in_progress"],
      [409, "restore_leftover"],
      [409, "restore_recovery_failed"],
      [409, "restore_lock_unusable"],
      [422, "backup_invalid"],
      [422, "backup_unsealed"],
    ];
    // The 429 of the lock-out says how long to wait: every operation carries `Retry-After` on it.
    for (const [id, entry] of entries)
      expect(operationOf(entry).responses["429"]!.headers, `${id} 429`).toHaveProperty("Retry-After");
    for (const [status, code] of named) {
      const ops = entries.filter(([, e]) =>
        declaredErrors(e).some((x) => x.status === status && x.code === code),
      );
      expect(ops.length, `${status} ${code} is declared by a route`).toBeGreaterThan(0);
      for (const [id, entry] of ops) {
        expect(operationOf(entry).responses[String(status)]!.description, `${id} ${status}`).toContain(code);
      }
    }
    // Where they belong: the owner's routes answer owner_only, the approval resolve answers self_approval, the
    // backups answer the restore codes, the restore answers the sealing ones.
    expect(operationOf(API["settings.update"]).responses["403"]!.description).toContain("owner_only");
    expect(operationOf(API["approvals.resolve"]).responses["403"]!.description).toContain("self_approval");
    expect(operationOf(API["backups.create"]).responses["409"]!.description).toContain(
      "restore_lock_unusable",
    );
    const restore = operationOf(API["backups.restore"]).responses["422"]!.description;
    expect(restore).toContain("backup_invalid");
    expect(restore).toContain("backup_unsealed");
    // The 413 of a body that is too big, and of a file that is too big; the 429 of every route, with Retry-After.
    expect(operationOf(API["runs.create"]).responses["413"]!.description).toContain("payload_too_large");
    expect(operationOf(API["artifacts.raw"]).responses["413"]!.description).toContain("payload_too_large");
    expect(operationOf(API["skills.import"]).responses["413"]!.description).toContain("folder_too_large");
    for (const [id, entry] of entries) {
      expect(operationOf(entry).responses["429"]!.description, id).toContain("too_many_requests");
    }
  });

  it("C19 x-mordomo-scope is the only extension", () => {
    const found = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          if (k.startsWith("x-")) found.add(k);
          // The names of the headers a response carries (`x-total-count`) are names, not extensions.
          if (k !== "headers") walk(v);
        }
      }
    };
    walk(doc);
    expect([...found]).toEqual(["x-mordomo-scope"]);
    for (const [id, entry] of entries) {
      const op = operationOf(entry);
      if (entry.public) {
        expect(op["x-mordomo-scope"], id).toBeUndefined();
        expect(op.security, id).toEqual([]);
      } else {
        expect(op["x-mordomo-scope"], id).toBe(entry.scope);
        expect(op.security[0], id).toEqual({ localToken: [] });
      }
    }
  });

  it("C20 a route without a success schema is refused", () => {
    const base = {
      method: "GET",
      path: "/api/zz",
      scope: "monitor",
      summary: "A route that cannot be described",
      tag: "test",
    } as const;
    const refused: Array<[string, RouteDefinition, RegExp]> = [
      ["no response", { ...base, responses: {} }, /GET \/api\/zz \(zz\.none\).*no success response/],
      ["only an error status", { ...base, responses: { 400: z.object({}) } }, /400.*no success status/],
      [
        "a success that is no schema",
        { ...base, responses: { 200: "x" as never } },
        /200 response is neither a schema nor a raw kind/,
      ],
      [
        "a schema without JSON Schema",
        { ...base, responses: { 200: z.object({ f: z.function() }) } },
        /ZodFunction has no JSON Schema/,
      ],
      [
        "a body without JSON Schema",
        { ...base, body: z.promise(z.string()), responses: { 200: z.object({}) } },
        /ZodPromise has no JSON Schema/,
      ],
    ];
    for (const [name, entry, message] of refused) {
      expect(() => openApiDocument({ "zz.none": route(entry as never) }), name).toThrow(message);
    }
    // One that can be described is described: the generator is not refusing everything.
    const fine = openApiDocument({
      "zz.fine": route({ ...base, responses: { 200: z.object({ n: z.number() }) } }),
    });
    expect(Object.keys(fine.paths)).toEqual(["/api/v1/zz"]);
  });

  it("C21 a real response satisfies the schema of the document", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const check = (schema: unknown, value: unknown, where: string) => {
      const validate = ajv.compile({ ...(schema as object), components: doc.components });
      const ok = validate(value);
      expect(
        ok ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`).slice(0, 4),
        where,
      ).toEqual([]);
    };
    let checked = 0;
    for (const { key, entry, answer } of results) {
      const op = operationOf(entry);
      const spec = entry.responses[answer.status]!;
      const content = op.responses[String(answer.status)]!.content!;
      if (isRawResponse(spec)) {
        if (spec.raw === "stream") {
          for (const frame of answer.raw!.frames!)
            check(content["text/event-stream"]!.schema, frame, `${key} frame`);
          checked += 1;
        }
        continue;
      }
      check(content["application/json"]!.schema, answer.body, key);
      checked += 1;
    }
    expect(checked).toBe(125);
    // The check is not asleep either: a body that departs from the schema of the document is refused.
    const run = results.find((r) => r.key === "GET /api/runs/:id")!;
    const schema = operationOf(run.entry).responses["200"]!.content!["application/json"]!.schema;
    const validate = ajv.compile({ ...(schema as object), components: doc.components });
    expect(validate({ run: {}, events: [] })).toBe(false);
    expect(validate({ ...(run.answer.body as object), events: "none" })).toBe(false);
    expect(routeKey(run.entry)).toBe("GET /api/runs/:id");
  });

  it("C21 the document keeps every object open: a key it does not name is accepted", () => {
    // Decision 4 of the owner questions, AC 26 and the text of `info.description`: a client ignores a key it does not
    // know, so the document must not close an object (`additionalProperties: false` would break a generated client
    // at the first additive field). No schema of the document is closed, in a component or in an operation...
    const closed: string[] = [];
    const visit = (node: unknown, at: string): void => {
      if (Array.isArray(node)) return node.forEach((item, i) => visit(item, `${at}[${i}]`));
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "additionalProperties" && value === false) closed.push(at);
        visit(value, `${at}.${key}`);
      }
    };
    visit(doc.paths, "paths");
    visit(doc.components.schemas, "components.schemas");
    expect(closed).toEqual([]);
    // ...and a real response with an extra key, at the top and in every object below, still validates.
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    // Add the key to every object the schema describes by `properties` (not to a map, whose values are of one type).
    type Node = {
      $ref?: string;
      properties?: Record<string, Node>;
      items?: Node;
      additionalProperties?: Node | boolean;
    };
    const resolve = (node: Node): Node =>
      node.$ref ? (doc.components.schemas[node.$ref.split("/").pop()!] as Node) : node;
    const widen = (schema: Node, value: unknown): unknown => {
      const node = resolve(schema);
      if (Array.isArray(value)) return node.items ? value.map((item) => widen(node.items!, item)) : value;
      if (typeof value !== "object" || value === null) return value;
      const entries = Object.entries(value).map(([key, child]) => {
        const next =
          node.properties?.[key] ??
          (typeof node.additionalProperties === "object" ? node.additionalProperties : null);
        return [key, next ? widen(next, child) : child];
      });
      return node.properties
        ? { ...Object.fromEntries(entries), "x-added-later": 1 }
        : Object.fromEntries(entries);
    };
    let checked = 0;
    for (const { entry, answer } of results) {
      const spec = entry.responses[answer.status]!;
      if (isRawResponse(spec)) continue;
      const schema =
        operationOf(entry).responses[String(answer.status)]!.content!["application/json"]!.schema;
      const validate = ajv.compile({ ...(schema as object), components: doc.components });
      expect(
        validate(widen(schema as Node, answer.body)),
        `${routeKey(entry)}: ${JSON.stringify(validate.errors?.slice(0, 2))}`,
      ).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

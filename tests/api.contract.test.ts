import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as ChildProcess from "node:child_process";
import type * as Instances from "../apps/api/src/instances.js";
import Fastify from "fastify";
import ts from "typescript";
import { z } from "zod";
import {
  API,
  COMMON_ERRORS,
  RunFrameSchema,
  wireSchema,
  checkBody,
  checkResponse,
  isRawResponse,
  route,
  routeKey,
  type RouteDefinition,
} from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { bindEntry, bind, responsesValidated } from "../apps/api/src/contract.js";
import { buildServer, defaultErrorCode } from "../apps/api/src/server.js";
import { httpError } from "../apps/api/src/routes/common.js";
import { makeTempHome } from "./helpers.js";
import { EXPECTED_ROUTE_SCOPES, PUBLIC_ROUTES } from "./helpers/routeScopes.js";
import {
  SCENARIOS,
  buildWorld,
  entryOf,
  runScenarios,
  type Result,
  type World,
} from "./helpers/contractWorld.js";
import { boundIds, scanSource, sourceFiles } from "./helpers/errorScan.js";

/**
 * The route table is the contract of the API (.specs/features/contratos-rest): the router has an entry for each route,
 * the server parses what an entry says, and the real answer of every route is checked against the entry.
 */

// A restart child is faked so the test never restarts anything; reaping never signals a process of this machine.
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = Object.entries(API) as Array<[string, RouteDefinition]>;

let ctx: AppContext;
let cleanup: () => void;
let world: World;
/** The routes whose response schemas have `.default()`, `.catch()`, `preprocess` or `transform` somewhere in them. */
const EFFECT_ROUTES = [
  "GET /api/meta",
  "GET /api/settings",
  "PUT /api/settings",
  "GET /api/ui-preferences",
  "PUT /api/ui-preferences",
  "PUT /api/providers/default",
  "GET /api/diagnostics/export",
  "GET /api/skills",
  "GET /api/skills/:slug",
  "POST /api/skills",
  "PUT /api/skills/:slug",
  "POST /api/skills/:slug/toggle",
  "POST /api/skills/import",
  "POST /api/skills/install",
  "GET /api/routines",
  "POST /api/routines",
  "PUT /api/routines/:id",
  "POST /api/routines/:id/toggle",
  "POST /api/routines/:id/duplicate",
  "GET /api/connectors",
  "GET /api/connectors/audit",
  "PUT /api/connectors/:id",
  "POST /api/connectors",
];

let results: Result[];

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-contract-light-");
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  world = await buildWorld();
  results = await runScenarios(world);
}, 180_000);

afterAll(async () => {
  await world.close();
  ctx.close();
  cleanup();
});

const owner = () => ({ "x-mordomo-token": ctx.token() });
const ownerOfWorld = () => ({ "x-mordomo-token": world.token });

/** Resources that exist now (the scenarios deleted or consumed the seeded ones), for the routes that look one up before reading the body. */
async function freshResources() {
  const objective = (
    await world.call("POST", "/api/objectives", {
      title: "Order",
      steps: [{ title: "Passo", request: { version: 1, kind: "prompt", prompt: "x", mode: "read_only" } }],
    })
  ).body as { id: string };
  const run = (await world.call("POST", "/api/runs", { prompt: "order" })).body as { runId: string };
  await world.call("POST", "/api/connectors", {
    id: "order-connector",
    name: "Order",
    kind: "api",
    origin: "test",
    maintainer: "test",
  });
  await world.call("POST", "/api/routines", {
    id: "order-routine",
    name: "Order",
    prompt: "say hi",
    kind: "every",
    every: { value: 1, unit: "hours" },
  });
  return { objective, run };
}

describe("S1 the route table and the registration", () => {
  it("C1 every route of the router has an entry", async () => {
    const app = await buildServer(ctx);
    try {
      const router = app.apiRoutes.map((r) => `${r.method} ${r.url}`).sort();
      const table = entries.map(([, e]) => routeKey(e)).sort();
      expect(router).toHaveLength(127);
      expect(table).toEqual(router);
      expect(new Set(table).size).toBe(127);
      expect(new Set(entries.map(([id]) => id)).size).toBe(127);
      for (const [id, entry] of entries) {
        expect(id, id).toMatch(/^[a-zA-Z]+(\.[a-zA-Z]+)+$/);
        expect(entry.summary.length, `${id} summary`).toBeGreaterThan(8);
        expect(entry.tag.length, `${id} tag`).toBeGreaterThan(0);
        expect(entry.path.startsWith("/api/"), id).toBe(true);
        // The router knows each route by the id of its entry.
        const registered = app.apiRoutes.find((r) => r.method === entry.method && r.url === entry.path);
        expect(registered?.config.route, id).toBe(id);
      }
    } finally {
      await app.close();
    }
  });

  it("C3 the access in the table equals the hand-written scope table", async () => {
    const app = await buildServer(ctx);
    try {
      const expected: Record<string, string | undefined> = { ...EXPECTED_ROUTE_SCOPES };
      for (const publicRoute of PUBLIC_ROUTES) expected[publicRoute] = undefined;
      const tabled: Record<string, string | undefined> = {};
      for (const [, entry] of entries) tabled[routeKey(entry)] = entry.public ? undefined : entry.scope;
      expect(tabled).toEqual(expected);

      const counts: Record<string, number> = {};
      for (const [, e] of entries) {
        const k = e.public ? "public" : e.scope!;
        counts[k] = (counts[k] ?? 0) + 1;
      }
      expect(counts).toEqual({ owner: 63, monitor: 33, content: 22, run: 6, approve: 1, public: 2 });
      expect(entries.filter(([, e]) => e.public && e.scope !== undefined)).toEqual([]);

      expect(
        entries
          .filter(([, e]) => e.queryToken)
          .map(([, e]) => routeKey(e))
          .sort(),
      ).toEqual(
        [
          "GET /api/events",
          "GET /api/runs/:id/stream",
          "GET /api/artifacts/raw",
          "GET /api/skills/:slug/resource",
        ].sort(),
      );
      expect(
        entries
          .filter(([, e]) => e.ticket)
          .map(([, e]) => routeKey(e))
          .sort(),
      ).toEqual(["GET /api/events", "GET /api/runs/:id/stream"].sort());

      // The config Fastify keeps for each route is the entry's.
      for (const [id, entry] of entries) {
        const registered = app.apiRoutes.find((r) => r.method === entry.method && r.url === entry.path)!;
        expect(registered.config.public === true, id).toBe(entry.public === true);
        expect(registered.config.scope, id).toBe(entry.scope);
        expect(registered.config.queryToken === true, id).toBe(entry.queryToken === true);
        expect(registered.config.ticket === true, id).toBe(entry.ticket === true);
      }
    } finally {
      await app.close();
    }
  });

  it("C4 bind hands the handler parsed params, query and body", async () => {
    const entry = route({
      method: "POST",
      path: "/api/zz/:n",
      scope: "monitor",
      summary: "A route that only the test calls",
      tag: "test",
      params: z.object({ n: z.coerce.number().int() }),
      query: z.object({ limit: z.coerce.number().int().default(5), tag: z.string().optional() }),
      body: z.object({ name: z.string(), flag: z.boolean().default(true) }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
    });
    const optional = route({
      method: "POST",
      path: "/api/zz-optional",
      scope: "monitor",
      summary: "A route whose body may be left out",
      tag: "test",
      body: z.object({ again: z.boolean().default(false), name: z.string().default("x") }),
      bodyOptional: true,
      responses: { 200: z.object({ ok: z.literal(true) }) },
    });
    const seen: unknown[] = [];
    const bare = Fastify();
    bindEntry(bare, "zz.one", entry, async (call) => {
      seen.push(call);
      return { ok: true };
    });
    bindEntry(bare, "zz.optional", optional, async (call) => {
      seen.push(call);
      return { ok: true };
    });
    bare.setErrorHandler((error, _req, reply) =>
      reply.code(error instanceof z.ZodError ? 400 : 500).send({}),
    );

    const good = await bare.inject({
      method: "POST",
      url: "/api/zz/42?tag=a",
      payload: { name: "n", extra: "dropped" },
    });
    expect(good.statusCode).toBe(200);
    // A number that arrives as text is a number, a field with a default arrives filled, an unknown key is gone.
    expect(seen[0]).toEqual({
      params: { n: 42 },
      query: { limit: 5, tag: "a" },
      body: { name: "n", flag: true },
    });

    expect((await bare.inject({ method: "POST", url: "/api/zz-optional" })).statusCode).toBe(200);
    expect(seen[1]).toEqual({ params: undefined, query: undefined, body: { again: false, name: "x" } });

    // A part that fails is refused before the handler: the handler was called twice above and is not called again.
    const before = seen.length;
    for (const bad of [
      { url: "/api/zz/abc", payload: { name: "n" } },
      { url: "/api/zz/1?limit=many", payload: { name: "n" } },
      { url: "/api/zz/1", payload: { flag: false } },
      { url: "/api/zz/1", payload: { name: 3 } },
    ]) {
      const res = await bare.inject({ method: "POST", ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(seen).toHaveLength(before);
    await bare.close();
  });

  /**
   * Candidates for a value a schema rejects, and for one it accepts, found by asking the schema itself: the test
   * does not know what a route validates, the route's own entry does.
   */
  const rejects = (schema: z.ZodTypeAny, names: string[]): unknown | undefined => {
    const candidates: unknown[] = [
      ...names.map((n) => ({ [n]: "not a valid value \u0000 !" })),
      Object.fromEntries(names.map((n) => [n, "not a valid value \u0000 !"])),
      {},
    ];
    // Only objects: a query always reaches the schema as one, and a schema that refuses `null` but takes any key is not strict about its keys.
    return candidates.find((c) => !schema.safeParse(c).success);
  };
  const accepts = (schema: z.ZodTypeAny, names: string[]): unknown => {
    const samples = [
      "550e8400-e29b-41d4-a716-446655440000",
      "abc",
      "full-x",
      "1",
      "claude",
      "n_abcdef12",
      "ps_abcdef12",
    ];
    const candidates: unknown[] = [
      {},
      ...samples.map((s) => Object.fromEntries(names.map((n) => [n, s]))),
      Object.fromEntries(names.map((n) => [n, "x"])),
    ];
    return candidates.find((c) => schema.safeParse(c).success) ?? {};
  };

  /** The query parts that take any text for each key they name (a flag is no longer one: it refuses other text) (a flag or a free string): their schema has no value to refuse. */
  const ACCEPTS_ANYTHING: Record<string, string[]> = {
    "GET /api/connectors/:id/data": ["query"],
    "GET /api/events": ["query"],
    "GET /api/providers": ["query"],
    "GET /api/runs/:id/stream": ["query"],
    "GET /api/sync/plan": ["query"],
    "GET /api/updates": ["query"],
  };

  it("C5 every part an entry declares is validated before the handler runs", async () => {
    const asked: string[] = [];
    const accepting: Record<string, string[]> = {};
    // These four look their resource up before they read the body (`precheck`), so a bad body reaches the schema
    // only for a resource that exists.
    const fresh = await freshResources();
    const existing: Record<string, string> = {
      "POST /api/objectives/:id/dispatch": `/api/objectives/${fresh.objective.id}/dispatch`,
      "POST /api/runs/:id/children": `/api/runs/${fresh.run.runId}/children`,
      "PUT /api/connectors/:id": "/api/connectors/order-connector",
      "PUT /api/routines/:id": "/api/routines/order-routine",
    };
    for (const [, entry] of entries) {
      const k = routeKey(entry);
      const parts = ["params", "query", "body"] as const;
      for (const part of parts) {
        const schema = entry[part];
        if (!schema) continue;
        const names =
          part === "params"
            ? [...entry.path.matchAll(/:(\w+)/g)].map((m) => m[1]!)
            : Object.keys((schema as z.AnyZodObject).shape ?? {});
        const bad = rejects(schema, names);
        if (bad === undefined) {
          (accepting[k] ??= []).push(part);
          continue;
        }
        // The other parts are valid, so the refusal can only come from this one.
        const sample = (p: (typeof parts)[number]) => {
          const s = entry[p];
          if (!s) return undefined;
          const n =
            p === "params"
              ? [...entry.path.matchAll(/:(\w+)/g)].map((m) => m[1]!)
              : Object.keys((s as z.AnyZodObject).shape ?? {});
          return accepts(s, n);
        };
        const value = (p: (typeof parts)[number]) => (p === part ? bad : sample(p));
        let url = entry.path;
        const paramsValue = value("params") as Record<string, unknown> | undefined;
        for (const [name, v] of Object.entries(paramsValue ?? {}))
          url = url.replace(`:${name}`, encodeURIComponent(String(v)));
        if (part === "body" && existing[k]) url = existing[k]!;
        const query = value("query") as Record<string, unknown> | undefined;
        const qs =
          query && typeof query === "object"
            ? new URLSearchParams(Object.entries(query).map(([a, b]) => [a, String(b)])).toString()
            : "";
        if (part === "query" && (query === null || typeof query !== "object")) continue;
        const res = await world.app.inject({
          method: entry.method,
          url: `/api/v1${url.slice(4)}${qs ? `?${qs}` : ""}`,
          headers: { ...ownerOfWorld(), ...(entry.body ? { "content-type": "application/json" } : {}) },
          ...(entry.body ? { payload: JSON.stringify(value("body")) } : {}),
        });
        const body = res.json() as { error?: { code?: string; issues?: unknown[] } };
        expect(res.statusCode, `${k} ${part}`).toBe(400);
        expect(body.error?.code, `${k} ${part}`).toBe("validation");
        expect(body.error?.issues?.length, `${k} ${part} issues`).toBeGreaterThan(0);
        asked.push(`${k} ${part}`);
      }
    }
    // The parts the test could not make a schema refuse are the ones written down above, no more and no fewer.
    const accepted = Object.fromEntries(Object.entries(accepting).sort());
    const written = Object.fromEntries(
      Object.entries(ACCEPTS_ANYTHING)
        .filter(([, v]) => v.length > 0)
        .sort(),
    );
    expect(accepted).toEqual(written);
    expect(asked.length).toBeGreaterThan(80);
  });

  it("C6 a route outside bind and an unbound entry stop the server", async () => {
    const fresh = await buildServer(ctx);
    try {
      // The scope is asked first, then the contract: a route with neither says so in that order.
      expect(() => fresh.get("/api/zz-open", async () => ({}))).toThrow(
        /GET \/api\/zz-open declares no scope/,
      );
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        expect(
          () => fresh[method]("/api/zz-scoped", { config: { scope: "monitor" } }, async () => ({})),
          method,
        ).toThrow(new RegExp(`${method.toUpperCase()} /api/zz-scoped declares no contract`));
      }
      expect(() => fresh.get("/api/zz-public", { config: { public: true } }, async () => ({}))).toThrow(
        /declares no contract/,
      );
      // A route that names an entry the table does not have is no better than one that names none.
      expect(() =>
        fresh.route({
          method: "GET",
          url: "/api/zz-forged",
          config: { scope: "monitor", route: "does.not.exist" },
          handler: async () => ({}),
        }),
      ).toThrow(/declares no contract/);
      expect(() => bind(fresh, "does.not.exist" as never, async () => ({}) as never)).toThrow(/not an entry/);
      // The names every object has are not entries either (`"constructor" in API` is true).
      for (const inherited of ["constructor", "toString", "__proto__"]) {
        expect(() => bind(fresh, inherited as never, async () => ({}) as never), inherited).toThrow(
          /not an entry/,
        );
        expect(
          () =>
            fresh.route({
              method: "GET",
              url: `/api/zz-${inherited}`,
              config: { scope: "monitor", route: inherited },
              handler: async () => ({}),
            }),
          inherited,
        ).toThrow(/declares no contract/);
      }
    } finally {
      await fresh.close();
    }

    // An entry nobody bound is a route that was forgotten: the server does not start.
    const table = API as unknown as Record<string, RouteDefinition>;
    table["zz.forgotten"] = route({
      method: "GET",
      path: "/api/zz-forgotten",
      scope: "monitor",
      summary: "An entry no route was bound to",
      tag: "test",
      responses: { 200: z.object({}) },
    });
    try {
      await expect(buildServer(ctx)).rejects.toThrow(/zz\.forgotten.*no route was bound/);
    } finally {
      delete table["zz.forgotten"];
    }
  });
});

describe("S2 the real answer is checked", () => {
  const violationEntry = route({
    method: "GET",
    path: "/api/zz-answer",
    scope: "monitor",
    summary: "A route whose answer the test breaks on purpose",
    tag: "test",
    responses: { 200: z.object({ name: z.string(), count: z.number() }) },
    errors: [{ status: 409, code: "declared", description: "an error the entry declares" }],
  });

  /**
   * The six ways a response departs from its entry. The handler of the route does what `mode` says, the server
   * checks, and the answer must be `500 response_contract_violation` that names the path.
   */
  const MODES: Array<{ mode: string; reply: (reply: any) => unknown; names: string }> = [
    { mode: "extra", reply: () => ({ name: "n", count: 1, extra: 1 }), names: "$.extra" },
    { mode: "missing", reply: () => ({ name: "n" }), names: "$.count" },
    { mode: "wrong type", reply: () => ({ name: "n", count: "1" }), names: "$.count" },
    {
      mode: "undeclared status",
      reply: (reply: any) => reply.code(201).send({ name: "n", count: 1 }),
      names: "status 201",
    },
    {
      mode: "undeclared error",
      reply: () => {
        throw httpError(409, "no", "not_declared");
      },
      names: "409 not_declared",
    },
    {
      mode: "not the envelope",
      reply: (reply: any) => reply.code(409).send({ nope: true }),
      names: "envelope",
    },
  ];

  it("C9 a response that departs from its entry is replaced by response_contract_violation", async () => {
    const table = API as unknown as Record<string, RouteDefinition>;
    const app = await buildServer(ctx, { validateResponses: true });
    // The entry joins the table after the server was built (a server refuses an entry nobody bound) and leaves it at the end.
    table["zz.answer"] = violationEntry;
    let mode = "ok";
    bindEntry(app, "zz.answer", violationEntry, async (_call, _req, reply) => {
      if (mode === "ok") return { name: "n", count: 1 };
      if (mode === "declared") throw httpError(409, "fine", "declared");
      return MODES.find((m) => m.mode === mode)!.reply(reply);
    });
    try {
      const get = () => app.inject({ method: "GET", url: "/api/v1/zz-answer", headers: owner() });
      mode = "ok";
      expect((await get()).statusCode).toBe(200);
      mode = "declared";
      const declared = await get();
      expect(declared.statusCode).toBe(409);
      expect(declared.json().error.code).toBe("declared");
      for (const m of MODES) {
        mode = m.mode;
        const res = await get();
        expect(res.statusCode, m.mode).toBe(500);
        const body = res.json() as { error: { code: string; message: string } };
        expect(body.error.code, m.mode).toBe("response_contract_violation");
        expect(body.error.message, m.mode).toContain("GET /api/zz-answer");
        expect(body.error.message, m.mode).toContain(m.names);
      }
    } finally {
      delete table["zz.answer"];
      await app.close();
    }

    // The same six, one level down, on the function the server calls.
    expect(checkResponse(violationEntry, 200, { name: "n", count: 1 })).toEqual([]);
    expect(checkResponse(violationEntry, 200, { name: "n", count: 1, extra: 1 })).toEqual([
      "$.extra: the contract does not name this key",
    ]);
    expect(checkResponse(violationEntry, 200, { name: "n" })).toEqual([
      "$.count: expected number, received undefined",
    ]);
    expect(checkResponse(violationEntry, 200, { name: "n", count: "1" })).toEqual([
      "$.count: expected number, received string",
    ]);
    expect(checkResponse(violationEntry, 201, { name: "n", count: 1 })[0]).toMatch(
      /status 201 is not a success status/,
    );
    const envelope = (code: string) => ({ error: { code, message: "m" }, message: "m" });
    expect(checkResponse(violationEntry, 409, envelope("declared"))).toEqual([]);
    expect(checkResponse(violationEntry, 409, envelope("other"))).toEqual([
      "error 409 other is not declared by GET /api/zz-answer",
    ]);
    expect(checkResponse(violationEntry, 401, envelope("unauthorized"))).toEqual([]);
    expect(checkResponse(violationEntry, 409, { nope: true })[0]).toMatch(/error body is not the envelope/);
    // The common errors are the ones the code names, for the routes they apply to.
    expect(COMMON_ERRORS.map((e) => `${e.status} ${e.code}`)).toContain("500 response_contract_violation");
  });

  it("C10 with validateResponses off the response is sent as the handler made it", async () => {
    const spy = z.object({ name: z.string() });
    // The check parses with the wire form of the schema (`wireSchema`), so that is the one watched.
    const watched = wireSchema(spy);
    const original = watched.safeParse.bind(watched);
    const calls = vi.fn(original);
    (watched as unknown as { safeParse: typeof calls }).safeParse = calls;
    const entry = route({
      method: "GET",
      path: "/api/zz-unchecked",
      scope: "monitor",
      summary: "A route whose answer departs from its entry",
      tag: "test",
      responses: { 200: spy },
    });
    const table = API as unknown as Record<string, RouteDefinition>;
    try {
      for (const validate of [false, true]) {
        calls.mockClear();
        const app = await buildServer(ctx, { validateResponses: validate });
        table["zz.unchecked"] = entry;
        bindEntry(app, "zz.unchecked", entry, async () => ({ name: 1, extra: true }));
        const res = await app.inject({ method: "GET", url: "/api/v1/zz-unchecked", headers: owner() });
        if (validate) {
          expect(res.statusCode).toBe(500);
          expect(calls).toHaveBeenCalled();
        } else {
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ name: 1, extra: true });
          expect(calls).not.toHaveBeenCalled();
        }
        delete table["zz.unchecked"];
        await app.close();
      }
    } finally {
      delete table["zz.unchecked"];
    }
  });

  it("C11 validateResponses defaults", () => {
    const cases: Array<[Record<string, string | undefined>, boolean]> = [
      [{ NODE_ENV: "test" }, true],
      [{ NODE_ENV: "development" }, true],
      [{ MORDOMO_VALIDATE_RESPONSES: "1" }, true],
      [{ MORDOMO_VALIDATE_RESPONSES: "1", NODE_ENV: "production" }, true],
      [{ NODE_ENV: "production" }, false],
      [{}, false],
      [{ MORDOMO_VALIDATE_RESPONSES: "0", NODE_ENV: "test" }, false],
    ];
    for (const [env, expected] of cases) expect(responsesValidated(env), JSON.stringify(env)).toBe(expected);

    // The installed service is `startServer`, which builds the server with the defaults and no option of its own.
    const source = fs.readFileSync(path.join(repoRoot, "apps/api/src/server.ts"), "utf8");
    const sf = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node, inStart: boolean): void => {
      const here = inStart || (ts.isFunctionDeclaration(node) && node.name?.text === "startServer");
      if (
        here &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "buildServer"
      ) {
        calls.push(node);
      }
      ts.forEachChild(node, (child) => visit(child, here));
    };
    visit(sf, false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.arguments).toHaveLength(1);
    // Nobody in the service code turns it on for itself.
    for (const file of sourceFiles(path.join(repoRoot, "apps/api/src"))) {
      if (file.endsWith("contract.ts")) continue;
      expect(fs.readFileSync(file, "utf8"), file).not.toMatch(/validateResponses\s*:\s*true/);
    }
  });

  it("C12 every route answers what its entry declares", () => {
    const router = world.app.apiRoutes.map((r) => `${r.method} ${r.url}`).sort();
    const tabled = entries.map(([, e]) => routeKey(e)).sort();
    // A route with no scenario, or a scenario for no route: both are a hole in this proof.
    expect(Object.keys(SCENARIOS).sort()).toEqual(router);
    expect(Object.keys(SCENARIOS).sort()).toEqual(tabled);
    expect(results).toHaveLength(127);
    const problems: string[] = [];
    for (const { key, entry, answer, id } of results) {
      const scenario = SCENARIOS[key]!;
      const declared = Object.keys(entry.responses).map(Number);
      const allowed = scenario.statuses ?? declared;
      if (!allowed.includes(answer.status)) {
        problems.push(
          `${key}: answered ${answer.status}, the scenario allows ${allowed.join("/")} - ${JSON.stringify(answer.body).slice(0, 200)}`,
        );
        continue;
      }
      const spec = entry.responses[answer.status]!;
      if (isRawResponse(spec)) {
        if (spec.raw === "binary") {
          const type = String(answer.headers["content-type"] ?? "").split(";")[0]!;
          const ok = spec.contentTypes.some(
            (t) => t === type || (t.endsWith("/*") && type.startsWith(t.slice(0, -1))),
          );
          if (!ok)
            problems.push(`${key}: content-type ${type} is not one of ${spec.contentTypes.join(", ")}`);
          if (!(answer.raw?.bytes ?? 0)) problems.push(`${key}: no bytes`);
        } else {
          expect(answer.raw?.frames?.length, `${id} frames`).toBeGreaterThan(0);
          expect(String(answer.headers["content-type"]), id).toContain("text/event-stream");
        }
        continue;
      }
      for (const p of checkResponse(entry, answer.status, answer.body)) problems.push(`${key}: ${p}`);
    }
    expect(problems).toEqual([]);
  });

  /** What the client reads for an error raised with this status and code: a 5xx the server hides is `internal`. */
  const pairOf = (status: number, code: string | null): string =>
    status >= 500 && status !== 502 && status !== 503
      ? "500 internal"
      : `${status} ${code ?? defaultErrorCode(status)}`;

  it("C12 a write parked for a human answers 202 and satisfies its entry", async () => {
    // The `202` of the routes that start a run: the gate parks a write for a human (the engine's `waiting_approval`),
    // and the answer is the launch with its pending approval. The world's server checks every answer, so a body that
    // departs from the entry would come back as a 500.
    const settings = world.ctx.settings();
    const before = settings.securityProfile;
    settings.securityProfile = "review_before_write";
    world.ctx.settingsStore.save(settings);
    try {
      // The seeded run and session were used (and the session deleted) by the scenarios: make a fresh pair.
      const seed = (await world.call("POST", "/api/runs", { prompt: "write first", mode: "write" })).body as {
        runId: string;
        sessionId: string;
      };
      const parked: Array<[string, string, unknown]> = [
        ["POST", "/api/runs", { prompt: "write something", mode: "write" }],
        ["POST", `/api/skills/consolidate-memory/run`, { inputs: {} }],
        ["POST", `/api/runs/${seed.runId}/children`, { prompts: ["write a thing"], mode: "write" }],
        ["POST", `/api/sessions/${seed.sessionId}/continue`, { prompt: "write on", mode: "write" }],
      ];
      const seen: string[] = [];
      for (const [method, url, body] of parked) {
        const answer = await world.call(method, url, body);
        seen.push(
          `${method} ${url.replace(seed.runId, ":id").replace(seed.sessionId, ":id")} ${answer.status}`,
        );
        expect(answer.status, `${method} ${url} ${JSON.stringify(answer.body)}`).toBe(202);
        const launch = answer.body as { status?: string; runs?: Array<{ status: string }> };
        expect(launch.status ?? launch.runs?.[0]?.status).toBe("waiting_approval");
      }
      // A repeat of a parked run parks again, with a new submissionId.
      const first = (await world.call("POST", "/api/runs", { prompt: "write again", mode: "write" }))
        .body as {
        runId: string;
      };
      const retry = await world.call("POST", `/api/runs/${first.runId}/retry`, {
        submissionId: crypto.randomUUID(),
      });
      expect(retry.status, JSON.stringify(retry.body)).toBe(202);
      expect(seen).toHaveLength(4);
    } finally {
      const restored = world.ctx.settings();
      restored.securityProfile = before;
      world.ctx.settingsStore.save(restored);
    }
  });

  it("C12 a key the schema would fill in is mandatory on the wire", () => {
    // `parse` fills a `.default()` or a `.catch()` in, so a body that lacks the key still parses. A response is the
    // output type: the key is always there, and its absence is a departure. For every real answer of a route whose
    // schema has such keys, remove each of them in turn (at any depth the answer reaches) and the check must object.
    const kind = (schema: z.ZodTypeAny) => (schema._def as { typeName: string }).typeName;
    const filled = (schema: z.ZodTypeAny): boolean => {
      const def = schema._def as { typeName: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny };
      if (def.typeName === "ZodDefault" || def.typeName === "ZodCatch") return true;
      if (def.typeName === "ZodEffects") return filled(def.schema!);
      if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") return filled(def.innerType!);
      return false;
    };
    const paths: Array<Array<string | number>> = [];
    const walk = (schema: z.ZodTypeAny, value: unknown, at: Array<string | number>): void => {
      const def = schema._def as Record<string, unknown>;
      switch (kind(schema)) {
        case "ZodDefault":
        case "ZodCatch":
        case "ZodOptional":
        case "ZodNullable":
          return value == null ? undefined : walk(def.innerType as z.ZodTypeAny, value, at);
        case "ZodEffects":
          return walk(def.schema as z.ZodTypeAny, value, at);
        case "ZodArray":
          return Array.isArray(value)
            ? value.slice(0, 2).forEach((item, i) => walk(def.type as z.ZodTypeAny, item, [...at, i]))
            : undefined;
        case "ZodRecord":
          return typeof value === "object" && value
            ? Object.entries(value)
                .slice(0, 2)
                .forEach(([k, v]) => walk(def.valueType as z.ZodTypeAny, v, [...at, k]))
            : undefined;
        case "ZodObject": {
          if (typeof value !== "object" || value === null || Array.isArray(value)) return;
          const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
          for (const [key, child] of Object.entries(shape)) {
            if (!(key in value)) continue;
            if (filled(child)) paths.push([...at, key]);
            walk(child, (value as Record<string, unknown>)[key], [...at, key]);
          }
          return;
        }
        case "ZodUnion":
        case "ZodDiscriminatedUnion": {
          const member = (def.options as z.ZodTypeAny[]).find((o) => wireSchema(o).safeParse(value).success);
          if (member) walk(member, value, at);
          return;
        }
        default:
      }
    };
    const withoutKey = (value: unknown, at: Array<string | number>): unknown => {
      const copy = JSON.parse(JSON.stringify(value)) as unknown;
      let node = copy as Record<string | number, unknown>;
      for (const step of at.slice(0, -1)) node = node[step] as Record<string | number, unknown>;
      delete node[at[at.length - 1]!];
      return copy;
    };
    const covered = new Map<string, number>();
    for (const { key, entry, answer } of results) {
      const spec = entry.responses[answer.status];
      if (!spec || isRawResponse(spec)) continue;
      paths.length = 0;
      walk(spec, JSON.parse(JSON.stringify(answer.body ?? null)), []);
      for (const at of [...paths]) {
        expect(
          checkResponse(entry, answer.status, withoutKey(answer.body, at)),
          `${key}: ${at.join(".")} removed`,
        ).not.toEqual([]);
        covered.set(key, (covered.get(key) ?? 0) + 1);
      }
    }
    // The routes whose responses have a default, a catch, a preprocess or a transform: each is in the table above.
    expect([...covered.keys()].sort()).toEqual([...EFFECT_ROUTES].sort());
    expect(EFFECT_ROUTES).toHaveLength(23);
  });

  it("C35 a wrong body for a resource that is not there is a 404, as before the table", async () => {
    // The base looked the resource up before it read the body; `bind` parses the body first unless a route asks for a
    // `precheck`. These four routes do, so the order of their answers did not change.
    const ghost = crypto.randomUUID();
    const fresh = await freshResources();
    const { objective, run } = fresh;
    const routes: Array<[string, string, string, unknown]> = [
      [
        "POST",
        `/api/objectives/${ghost}/dispatch`,
        `/api/objectives/${objective.id}/dispatch`,
        { limit: "many" },
      ],
      ["POST", `/api/runs/${ghost}/children`, `/api/runs/${run.runId}/children`, { prompts: [] }],
      ["PUT", "/api/connectors/no-such-connector", "/api/connectors/order-connector", { kind: "nope" }],
      ["PUT", "/api/routines/no-such-routine", "/api/routines/order-routine", { name: 7 }],
    ];
    for (const [method, missing, present, wrongBody] of routes) {
      const absent = await world.call(method, missing, wrongBody);
      expect(absent.status, `${method} ${missing}`).toBe(404);
      expect((absent.body as { error: { code: string } }).error.code).toBe("not_found");
      const there = await world.call(method, present, wrongBody);
      expect(there.status, `${method} ${present}`).toBe(400);
      expect((there.body as { error: { code: string } }).error.code).toBe("validation");
    }
  });

  it("C30 a flag in a query switches off, and other text is a 400 validation", async () => {
    // `record=false` used to read as true (`z.coerce.boolean`): a recall could not be made without recording it.
    const recalls = async () =>
      ((await world.call("GET", "/api/memory/recall/stats")).body as { totalRecalls: number }).totalRecalls;
    const before = await recalls();
    expect((await world.call("GET", "/api/memory/recall?q=alfa&record=false")).status).toBe(200);
    expect((await world.call("GET", "/api/memory/recall?q=alfa&record=0")).status).toBe(200);
    expect(await recalls()).toBe(before);
    expect((await world.call("GET", "/api/memory/recall?q=alfa&record=1")).status).toBe(200);
    expect((await world.call("GET", "/api/memory/recall?q=alfa")).status).toBe(200);
    expect(await recalls()).toBe(before + 2);
    for (const url of [
      "/api/memory/recall?q=alfa&record=maybe",
      "/api/notifications?unread=yes",
      "/api/skills/registry?refresh=2",
    ]) {
      const answer = await world.call("GET", url);
      expect(answer.status, url).toBe(400);
      expect((answer.body as { error: { code: string } }).error.code, url).toBe("validation");
    }
  });

  it("C13 every error a handler raises is documented", () => {
    // The scanner first: each shape it covers, and each text it must not take for a raise.
    expect(scanSource(`httpError(404, "x"); httpError(409, "y", "taken");`)).toMatchObject([
      { status: 404, code: null },
      { status: 409, code: "taken" },
    ]);
    expect(
      scanSource(
        `throw new MordomoError(409, "m", "submission_conflict"); throw new MordomoError(404, "m");`,
      ),
    ).toMatchObject([
      { status: 409, code: "submission_conflict" },
      { status: 404, code: null },
    ]);
    expect(
      scanSource(`throw Object.assign(new Error("m"), { statusCode: 409, code: ok ? "gone" : "taken" });`),
    ).toMatchObject([
      { status: 409, code: "gone" },
      { status: 409, code: "taken" },
    ]);
    expect(
      scanSource(`throw Object.assign(new Error("m"), { statusCode: 403, code: "owner_only" });`),
    ).toMatchObject([{ status: 403, code: "owner_only" }]);
    expect(
      scanSource(`class A extends Error { readonly statusCode = 409; readonly code = "restore_leftover"; }`),
    ).toMatchObject([{ status: 409, code: "restore_leftover" }]);
    expect(
      scanSource(
        `class B extends Error { readonly statusCode = 422; constructor(readonly code: "backup_invalid" | "backup_unsealed") { super("m"); } }`,
      ),
    ).toMatchObject([
      { status: 422, code: "backup_invalid" },
      { status: 422, code: "backup_unsealed" },
    ]);
    expect(
      scanSource(`reply.code(202); const r = { statusCode: 200 }; const s = { statusCode: res.statusCode };`),
    ).toEqual([]);
    expect(
      scanSource(`// httpError(500, "in a comment")\nconst t = "httpError(418, 'in a string')";`),
    ).toEqual([]);
    expect(scanSource(`const code = 404; function httpError2() {} httpError2(404, "x");`)).toEqual([]);

    const documented = new Set<string>();
    const add = (status: number, code: string) => documented.add(`${status} ${code}`);
    for (const [, entry] of entries) for (const e of entry.errors ?? []) add(e.status, e.code);
    for (const e of COMMON_ERRORS) add(e.status, e.code);

    const raised = new Map<string, string>();
    for (const root of ["apps/api/src", "core/src"]) {
      for (const file of sourceFiles(path.join(repoRoot, root))) {
        for (const r of scanSource(fs.readFileSync(file, "utf8"), file)) {
          raised.set(pairOf(r.status, r.code), `${path.relative(repoRoot, file)}:${r.line}`);
        }
      }
    }
    const undocumented = [...raised]
      .filter(([pair]) => !documented.has(pair))
      .map(([pair, where]) => `${pair} (${where})`);
    expect(undocumented).toEqual([]);
    // The set the scan reads today, pinned: a raise that appears or disappears is a change to the contract of some route.
    expect(raised.size).toBe(48);
    expect([...raised.keys()].filter((pair) => pair.includes("<unresolved>"))).toEqual([]);
    expect(raised.has("409 approval_resolved")).toBe(true);

    // And the stricter reading for the route files: what a file raises is documented by the entries it registers.
    const routeDir = path.join(repoRoot, "apps/api/src/routes");
    const problems: string[] = [];
    for (const file of fs.readdirSync(routeDir).filter((f) => f.endsWith(".ts") && f !== "common.ts")) {
      const source = fs.readFileSync(path.join(routeDir, file), "utf8");
      const ids = boundIds(source);
      if (ids.length === 0) continue;
      const own = new Set<string>(COMMON_ERRORS.map((e) => `${e.status} ${e.code}`));
      for (const id of ids)
        for (const e of API[id as keyof typeof API].errors ?? []) own.add(`${e.status} ${e.code}`);
      for (const r of scanSource(source, file).filter((x) => x.line > 0)) {
        const pair = pairOf(r.status, r.code);
        if (!own.has(pair))
          problems.push(`${file}:${r.line} raises ${pair}, which none of its entries documents`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("C14 a violation is logged without the body", async () => {
    const table = API as unknown as Record<string, RouteDefinition>;
    const entry = route({
      method: "GET",
      path: "/api/zz-log",
      scope: "monitor",
      summary: "A route whose answer departs from its entry",
      tag: "test",
      responses: { 200: z.object({ name: z.string() }) },
    });
    const app = await buildServer(ctx, { validateResponses: true });
    table["zz.log"] = entry;
    bindEntry(app, "zz.log", entry, async () => ({
      name: "n",
      leaked: "TOP-SECRET-PROMPT",
      count: "TOP-SECRET-COUNT",
    }));
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/zz-log", headers: owner() });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("TOP-SECRET");
      expect(res.body).not.toContain(ctx.paths.home);
      await new Promise((r) => setTimeout(r, 200));
      const logs = fs
        .readdirSync(ctx.paths.logs)
        .filter((f) => f.startsWith("api") && f.endsWith(".jsonl"))
        .map((f) => fs.readFileSync(path.join(ctx.paths.logs, f), "utf8"))
        .join("\n");
      const line = logs
        .split("\n")
        .map((l) => (l.trim() ? (JSON.parse(l) as Record<string, unknown>) : null))
        .find((l) => l?.msg === "response departs from its contract" && l.route === "zz.log");
      expect(line).toMatchObject({ route: "zz.log", method: "GET", status: 200 });
      expect(JSON.stringify(line)).toContain("$.leaked");
      expect(JSON.stringify(line)).not.toContain("TOP-SECRET");
    } finally {
      delete table["zz.log"];
      await app.close();
    }
  });
});

describe("S4 the streams", () => {
  it("C24 the run stream sends v on every frame", async () => {
    const stream = results.find((r) => r.key === "GET /api/runs/:id/stream")!;
    const frames = stream.answer.raw!.frames as Array<Record<string, unknown>>;
    expect(frames.length).toBeGreaterThan(3);
    for (const frame of frames) {
      expect(frame.v, JSON.stringify(frame)).toBe(1);
      expect(checkBody(RunFrameSchema, frame), JSON.stringify(frame)).toEqual([]);
    }
    // The last frame is the end of the run, and what is stored carries no version.
    expect(frames.at(-1)).toMatchObject({ type: "run_state", status: "done", v: 1 });
    const stored = world.ctx.runs.eventsFor(world.ids.runId);
    expect(stored.length).toBeGreaterThan(2);
    for (const row of stored) expect(row.event, JSON.stringify(row.event)).not.toHaveProperty("v");
    // A server that predates the version sends frames without it, and the frame types are the contract's.
    expect(new Set(frames.map((f) => f.type))).toContain("result");
  });
});

describe("S6 compatibility", () => {
  it("C34 the unversioned alias answers as v1", async () => {
    // Without a credential every route answers the same in both spellings; only the alias announces its successor.
    const anonymous = (method: string, url: string, payload?: unknown) =>
      world.app.inject({
        method: method as "GET",
        url,
        headers: payload === undefined ? {} : { "content-type": "application/json" },
        ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      });
    for (const [id, entry] of entries) {
      const rest = entry.path.slice("/api/".length).replace(/:\w+/g, "x");
      const body = entry.public && entry.body ? {} : undefined;
      const legacy = await anonymous(entry.method, `/api/${rest}`, body);
      const v1 = await anonymous(entry.method, `/api/v1/${rest}`, body);
      expect(legacy.statusCode, id).toBe(v1.statusCode);
      expect(legacy.statusCode, id).toBe(entry.public ? (entry.method === "GET" ? 200 : 400) : 401);
      expect(legacy.json(), id).toEqual(v1.json());
      expect(legacy.headers.deprecation, id).toBe("true");
      expect(legacy.headers.link, id).toBe(`</api/v1/${rest}>; rel="successor-version"`);
      expect(v1.headers.deprecation, id).toBeUndefined();
      expect(v1.headers.link, id).toBeUndefined();
    }

    // With one, every route answers the same status in both spellings: the whole set of scenarios again, in a world of
    // its own, with the unversioned paths; the alias announces its successor on every answer.
    const second = await buildWorld();
    try {
      second.spelling = "legacy";
      const again = await runScenarios(second);
      expect(again.map((r) => r.key)).toEqual(results.map((r) => r.key));
      for (const [i, legacy] of again.entries()) {
        const v1 = results[i]!;
        expect(legacy.answer.status, v1.key).toBe(v1.answer.status);
        expect(legacy.answer.headers.deprecation, v1.key).toBe("true");
        expect(v1.answer.headers.deprecation, v1.key).toBeUndefined();
        expect(String(legacy.answer.headers.link), v1.key).toContain('rel="successor-version"');
      }
    } finally {
      await second.close();
    }
    expect(entryOf("GET /api/runs").id).toBe("runs.list");
  });
});

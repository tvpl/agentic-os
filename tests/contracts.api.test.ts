import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import {
  API,
  COMMON_ERRORS,
  EVENT_VERSIONS,
  RUN_FRAME_VERSIONS,
  SettingsSchema,
  checkBody,
  checkResponse,
  isRawResponse,
  route,
  wireSchema,
  type RouteDefinition,
} from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { bindEntry } from "../apps/api/src/contract.js";
import { registerSyntheticEntry } from "./helpers/syntheticEntry.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/** The route table without a server (.specs/features/contratos-rest): its shape, its dependencies, its tolerance. */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = Object.entries(API) as Array<[string, RouteDefinition]>;
const isZod = (value: unknown): value is z.ZodTypeAny => value instanceof z.ZodType;

describe("S1 the table", () => {
  it("C2 every entry has a schema or a raw kind for each success status", () => {
    expect(entries).toHaveLength(145);
    const raw: string[] = [];
    for (const [id, entry] of entries) {
      const statuses = Object.keys(entry.responses).map(Number);
      expect(statuses.length, `${id} has a success status`).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(status >= 200 && status < 300, `${id} ${status} is a success status`).toBe(true);
        const spec = entry.responses[status]!;
        if (isRawResponse(spec)) {
          raw.push(`${entry.method} ${entry.path} ${spec.raw}`);
          expect(spec.contentTypes.length, `${id} content types`).toBeGreaterThan(0);
          expect(spec.description.length, `${id} description`).toBeGreaterThan(5);
          if (spec.raw === "stream") expect(isZod(spec.frame), `${id} frame`).toBe(true);
        } else {
          expect(isZod(spec), `${id} ${status} is a zod schema`).toBe(true);
        }
      }
      for (const part of ["params", "query", "body"] as const) {
        if (entry[part] !== undefined) expect(isZod(entry[part]), `${id} ${part}`).toBe(true);
      }
      // A route with a `:name` in its path declares those params, and one without declares none.
      const names = [...entry.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      expect(entry.params !== undefined, `${id} params`).toBe(names.length > 0);
      for (const error of entry.errors ?? []) {
        expect(error.status >= 400 && error.status <= 599, `${id} error ${error.status}`).toBe(true);
        expect(error.code, `${id} error code`).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(error.description.length, `${id} ${error.code} description`).toBeGreaterThan(5);
      }
    }
    expect(raw.sort()).toEqual([
      "GET /api/artifacts/raw binary",
      "GET /api/events stream",
      "GET /api/runs/:id/stream stream",
      "GET /api/skills/:slug/resource binary",
    ]);
  });
});

describe("S6 dependencies and tolerance", () => {
  const read = (rel: string) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8")) as Record<string, Record<string, string>>;

  it("C37 the new dependencies are pinned exactly", () => {
    const exact = /^\d+\.\d+\.\d+$/;
    const api = read("apps/api/package.json").dependencies!;
    expect(api["zod-to-json-schema"]).toMatch(exact);
    const root = read("package.json").devDependencies!;
    for (const name of ["@apidevtools/swagger-parser", "ajv", "ajv-formats"])
      expect(root[name], name).toMatch(exact);
    // The package a browser imports still depends on zod and on nothing else.
    expect(Object.keys(read("contracts/package.json").dependencies!)).toEqual(["zod"]);
    // None of them reaches the interface.
    const ui = read("apps/command-centre/package.json");
    for (const name of ["zod-to-json-schema", "@apidevtools/swagger-parser", "ajv", "ajv-formats"]) {
      expect({ ...ui.dependencies, ...ui.devDependencies }[name], name).toBeUndefined();
    }
  });

  /** The open fields of the contract, with why each is not described further. */
  const OPEN_FIELDS: Record<string, string> = {
    "errors.ts issues": "the zod issues of a 400 validation: their shape is zod's",
    "routines.ts config": "the configuration of a sentinel: its keys differ by sentinel",
    "streams.ts paths": "the operations of the route document: their shape is the OpenAPI specification's",
    "streams.ts components":
      "the components of the route document: their shape is the OpenAPI specification's",
    "system.ts settings":
      "the settings of a diagnostics bundle, after the secret redactor: the shape is Settings",
    "system.ts input": "what a tool was asked to do: the agent's, whatever the tool takes",
    "wire.ts payload": "what an approval is about: its keys depend on its kind",
    "connectors.ts args":
      "the arguments of a connector's tool call, and of its summary read: the connector's own",
  };

  it("C38 schemas are tolerant and the checker is not", async () => {
    const run = {
      id: "r",
      createdAt: 1,
      startedAt: null,
      finishedAt: null,
      origin: "manual",
      provider: "claude",
      model: null,
      effort: "default",
      status: "queued",
      exitCode: null,
      durationMs: null,
      cwd: null,
      promptSummary: "p",
      request: null,
      skillSlug: null,
      routineId: null,
      maxCostUsd: null,
      parentRunId: null,
      sessionId: null,
      pid: null,
      error: null,
      failure: null,
      artifacts: [],
      filesChanged: [],
      attempts: 0,
      timeoutMs: null,
      permissionProfile: null,
      startedBy: null,
      usage: null,
      contextId: null,
    };
    const approval = {
      id: "a",
      createdAt: 1,
      kind: "tool_use",
      description: "d",
      payload: {},
      status: "pending",
      resolvedAt: null,
      resolvedBy: null,
      requestedBy: null,
      expiresAt: 2,
    };
    const bodies: Array<[string, number, unknown]> = [
      ["runs.get", 200, { run, events: [] }],
      ["approvals.get", 200, approval],
      ["settings.get", 200, SettingsSchema.parse({})],
    ];
    for (const [id, status, body] of bodies) {
      const entry = API[id as keyof typeof API] as RouteDefinition;
      const schema = entry.responses[status] as z.ZodTypeAny;
      const extra = { ...(body as object), added: true };
      // A client reading the schema is not broken by a field the server adds…
      expect(schema.safeParse(JSON.parse(JSON.stringify(extra))).success, id).toBe(true);
      // …and the check that guards the server says what the contract does not name.
      expect(checkResponse(entry, status, body), id).toEqual([]);
      expect(checkResponse(entry, status, extra), id).toEqual([
        "$.added: the contract does not name this key",
      ]);
    }
    // A key nested in the answer is found at its path.
    const nested = checkResponse(API["runs.get"] as RouteDefinition, 200, {
      run: { ...run, more: 1 },
      events: [],
    });
    expect(nested).toEqual(["$.run.more: the contract does not name this key"]);

    // The same on the way in: a key a request carries that its body does not name is dropped, as it always was.
    const body = (API["runs.create"].body as z.ZodTypeAny).parse({ prompt: "p", zzz: 1 });
    expect(body).toEqual({ prompt: "p", mode: "read_only" });
    const restore = withFakeBinPath();
    const tmp = makeTempHome("mordomo-tolerance-");
    const ctx = new AppContext(tmp.paths.home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.providers.claude.enabled = true;
    settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    ctx.settingsStore.save(settings);
    ctx.reloadAdapters();
    const app = await buildServer(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/runs",
        headers: { "x-mordomo-token": ctx.token() },
        payload: { prompt: "hi", zzz: 1 },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
      await new Promise((r) => setTimeout(r, 300));
      ctx.close();
      restore();
      tmp.cleanup();
    }

    // The fields the contract leaves open are the written ones: no more, no fewer.
    const files = [
      ...fs.readdirSync(path.join(repoRoot, "contracts/src/api")).map((f) => `contracts/src/api/${f}`),
      "contracts/src/routines.ts",
      "contracts/src/skills.ts",
      "contracts/src/connectors.ts",
      "contracts/src/eventSchemas.ts",
    ].filter((f) => f.endsWith(".ts"));
    const found = new Set<string>();
    for (const file of files) {
      const sf = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(repoRoot, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (n: ts.Node): void => {
        const open =
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === "z" &&
          ["unknown", "any"].includes(n.expression.name.text);
        if (open) {
          let p: ts.Node | undefined = n.parent;
          while (p && !ts.isPropertyAssignment(p)) p = p.parent;
          found.add(
            `${path.basename(file)} ${p && ts.isPropertyAssignment(p) ? p.name.getText(sf) : "(root)"}`,
          );
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect([...found].sort()).toEqual(Object.keys(OPEN_FIELDS).sort());
  });
});

describe("S2 the schema of the wire", () => {
  it("C9 wireSchema is the output type: a default or a catch is a mandatory key, a refinement stays", () => {
    const schema = z.object({
      a: z.string().default("x"),
      b: z.number().catch(0),
      c: z.preprocess((v) => v ?? "p", z.string()),
      d: z.string().transform((v) => v.length),
      e: z.string().optional(),
      f: z.array(z.object({ g: z.boolean().default(false) })),
      h: z.discriminatedUnion("k", [z.object({ k: z.literal("one"), v: z.string().default("") })]),
      i: z.string().min(3),
    });
    const full = { a: "x", b: 1, c: "c", d: "d", f: [{ g: true }], h: { k: "one", v: "" }, i: "abc" };
    expect(checkBody(schema, full)).toEqual([]);
    // Each of these keys parses without it (the schema fills it in), and none may be absent on the wire.
    expect(schema.safeParse({ ...full, a: undefined }).success).toBe(true);
    for (const [path, body] of [
      ["$.a", { ...full, a: undefined }],
      ["$.b", { ...full, b: undefined }],
      ["$.f[0].g", { ...full, f: [{}] }],
      ["$.h.v", { ...full, h: { k: "one" } }],
    ] as const)
      expect(checkBody(schema, body).join(), path).toContain(path);
    // An optional key stays optional, and a refinement still refuses.
    expect(checkBody(schema, { ...full, e: undefined })).toEqual([]);
    expect(checkBody(schema, { ...full, i: "ab" })).not.toEqual([]);
    // Memoised: the same schema, the same result (the document points at one object).
    expect(wireSchema(schema)).toBe(wireSchema(schema));
    // The case the verifier found: a settings document that lacks what the schema would fill in.
    expect(checkResponse(API["settings.get"], 200, {})).not.toEqual([]);
    expect(
      checkResponse(API["connectors.list"], 200, [
        { id: "c", name: "n", kind: "mcp", origin: "o", maintainer: "m" },
      ]),
    ).not.toEqual([]);
  });
});

describe("S2 each branch of wireSchema", () => {
  /** `a` has a default: the schema fills it in, the wire must carry it. */
  const withA = () => z.object({ a: z.string().default("") });
  const withB = () => z.object({ b: z.number().default(0) });
  const wireOk = (schema: z.ZodTypeAny, value: unknown) => wireSchema(schema).safeParse(value).success;

  it("C51 a default under a union, an intersection, a refinement, a tuple or a lazy is a mandatory key", () => {
    // Each case: the schema parses `{}` (it fills the default in), the wire form refuses it and accepts the full value.
    const union = z.union([withA(), withB().extend({ c: z.string() })]);
    expect(union.safeParse({}).success).toBe(true);
    expect(wireOk(union, {})).toBe(false);
    expect(wireOk(union, { a: "" })).toBe(true);
    expect(wireOk(union, { b: 1, c: "c" })).toBe(true);

    const intersection = z.intersection(withA(), withB());
    expect(intersection.safeParse({}).success).toBe(true);
    expect(wireOk(intersection, { a: "" })).toBe(false);
    expect(wireOk(intersection, { b: 0 })).toBe(false);
    expect(wireOk(intersection, { a: "", b: 0 })).toBe(true);

    // A real refinement (a `ZodEffects` of type `refinement`, not a `.min`): it keeps refusing, and its inner default is mandatory.
    const refined = withA().refine((v) => v.a !== "bad", "bad value");
    expect((refined._def as { effect: { type: string } }).effect.type).toBe("refinement");
    expect(refined.safeParse({}).success).toBe(true);
    expect(wireOk(refined, {})).toBe(false);
    expect(wireOk(refined, { a: "bad" })).toBe(false);
    expect(wireOk(refined, { a: "fine" })).toBe(true);
    const refinedTwice = z
      .string()
      .default("x")
      .refine((v) => v.length > 1, "short");
    expect(wireOk(refinedTwice, undefined)).toBe(false);
    expect(wireOk(refinedTwice, "x")).toBe(false);
    expect(wireOk(refinedTwice, "xy")).toBe(true);

    const tuple = z.tuple([withA()]).rest(withB());
    expect(tuple.safeParse([{}, {}]).success).toBe(true);
    expect(wireOk(tuple, [{}])).toBe(false);
    expect(wireOk(tuple, [{ a: "" }, {}])).toBe(false);
    expect(wireOk(tuple, [{ a: "" }, { b: 0 }])).toBe(true);

    const lazy = z.lazy(() => withA());
    expect(lazy.safeParse({}).success).toBe(true);
    expect(wireOk(lazy, {})).toBe(false);
    expect(wireOk(lazy, { a: "" })).toBe(true);
    // And one that reaches itself: the child is the wire form too.
    type Node = { v: string; next?: Node };
    const node: z.ZodType<Node, z.ZodTypeDef, unknown> = z.object({
      v: z.string().default(""),
      next: z.lazy(() => node).optional(),
    });
    expect(node.safeParse({ next: {} }).success).toBe(true);
    expect(wireOk(node, { v: "a", next: {} })).toBe(false);
    expect(wireOk(node, { v: "a", next: { v: "b" } })).toBe(true);
  });

  it("C52 a set, a map and a pipe are rebuilt too, and a node it cannot rebuild stops the build", () => {
    const set = z.set(withA());
    expect(set.safeParse(new Set([{}])).success).toBe(true);
    expect(wireOk(set, new Set([{}]))).toBe(false);
    expect(wireOk(set, new Set([{ a: "" }]))).toBe(true);
    const map = z.map(z.string(), withA());
    expect(map.safeParse(new Map([["k", {}]])).success).toBe(true);
    expect(wireOk(map, new Map([["k", {}]]))).toBe(false);
    expect(wireOk(map, new Map([["k", { a: "" }]]))).toBe(true);
    const pipe = z.preprocess((v) => v, withA()).pipe(withA().extend({ b: z.number().default(1) }));
    expect(pipe.safeParse({}).success).toBe(true);
    expect(wireOk(pipe, { a: "" })).toBe(false);
    expect(wireOk(pipe, { a: "", b: 1 })).toBe(true);

    // The loud failure: a type with no rebuild is an error, not a schema left as it was.
    const odd = z.string();
    (odd._def as { typeName: string }).typeName = "ZodSomethingNew";
    expect(() => wireSchema(odd)).toThrow(/ZodSomethingNew has no output-type rebuild/);
    expect(() => wireSchema(z.object({ inside: z.array(odd) }))).toThrow(/ZodSomethingNew/);
    expect(() => wireSchema(z.promise(z.string()))).toThrow(/ZodPromise/);
    expect(() => wireSchema(z.function())).toThrow(/ZodFunction/);
    // The nodes that no schema of the contract uses stop the build too, at any depth: a rebuild for one is a decision.
    expect(() => wireSchema(z.string().readonly())).toThrow(/ZodReadonly/);
    expect(() => wireSchema(z.string().brand<"id">())).toThrow(/ZodBranded/);
    expect(() => wireSchema(z.nativeEnum({ A: "a" } as const))).toThrow(/ZodNativeEnum/);
    expect(() => wireSchema(z.object({ inside: z.array(z.string().readonly()) }))).toThrow(/ZodReadonly/);
    expect(() => wireSchema(z.object({ a: z.string() }).catchall(z.string().default("x")))).toThrow(
      /catchall/,
    );
    // The catch-all every object has (`never`, or `unknown` for a passthrough) is not one.
    expect(() => wireSchema(z.object({ a: z.string() }).strict())).not.toThrow();
    expect(() => wireSchema(z.object({ a: z.string() }).passthrough())).not.toThrow();
    // Every type that holds nothing is its own output.
    for (const leaf of [
      z.string(),
      z.number(),
      z.nan(),
      z.bigint(),
      z.boolean(),
      z.date(),
      z.symbol(),
      z.undefined(),
      z.null(),
      z.any(),
      z.unknown(),
      z.never(),
      z.void(),
      z.literal("x"),
      z.enum(["a", "b"]),
    ])
      expect(wireSchema(leaf), leaf._def.typeName).toBe(leaf);
  });

  it("C53 the description a default, a catch, a transform or a pipe carries is kept; the inner one wins", () => {
    expect(wireSchema(z.string().default("x").describe("the name")).description).toBe("the name");
    expect(wireSchema(z.string().catch("x").describe("the catch")).description).toBe("the catch");
    expect(
      wireSchema(
        z
          .string()
          .transform((v) => v.length)
          .describe("the length"),
      ).description,
    ).toBe("the length");
    expect(wireSchema(z.string().pipe(z.string()).describe("the pipe")).description).toBe("the pipe");
    // The inner description is the one already written: it is not replaced by the outer.
    expect(wireSchema(z.string().describe("inner").default("x").describe("outer")).description).toBe("inner");
    // And inside an object the key carries it.
    const shape = wireSchema(z.object({ a: z.string().default("x").describe("a key") })) as z.AnyZodObject;
    expect(shape.shape.a!.description).toBe("a key");
  });
});

describe("S2 the flags of a query", () => {
  const FLAGS: Array<[string, string]> = [
    ["notifications.list", "unread"],
    ["skills.registry", "refresh"],
    ["memory.graph", "related"],
    ["memory.recall", "record"],
    ["memory.facts.list", "includeExpired"],
  ];
  const base: Record<string, Record<string, string>> = { "memory.recall": { q: "x" }, "memory.graph": {} };

  it("C30 a flag reads 1 and true as set, 0 and false as cleared, and refuses other text", () => {
    for (const [id, flag] of FLAGS) {
      const query = API[id as keyof typeof API].query!;
      const read = (value?: string) =>
        query.safeParse({ ...base[id], ...(value === undefined ? {} : { [flag]: value }) });
      for (const [text, expected] of [
        ["1", true],
        ["true", true],
        ["0", false],
        ["false", false],
      ] as const) {
        const result = read(text);
        expect(result.success, `${id} ${flag}=${text}`).toBe(true);
        expect((result as { data: Record<string, unknown> }).data[flag], `${id} ${flag}=${text}`).toBe(
          expected,
        );
      }
      // Absent stays absent: the route's own default decides (`record` records unless it is cleared).
      expect(
        (read() as { data: Record<string, unknown> }).data[flag],
        `${id} ${flag} absent`,
      ).toBeUndefined();
      for (const text of ["maybe", "yes", "no", "TRUE", "2", ""])
        expect(read(text).success, `${id} ${flag}=${JSON.stringify(text)}`).toBe(false);
    }
    expect(new Set(FLAGS.map(([, flag]) => flag)).size).toBe(5);
  });
});

describe("S1 the table is a constant", () => {
  it("C2 an entry, the lists of errors and the version lists cannot be written to", () => {
    const writable: string[] = [];
    const visit = (value: unknown, at: string): void => {
      if (typeof value !== "object" || value === null || isZod(value)) return;
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== Array.prototype) return;
      if (!Object.isFrozen(value)) writable.push(at);
      for (const [key, child] of Object.entries(value)) visit(child, `${at}.${key}`);
    };
    for (const [id, entry] of entries) visit(entry, id);
    visit(COMMON_ERRORS, "COMMON_ERRORS");
    visit(EVENT_VERSIONS, "EVENT_VERSIONS");
    visit(RUN_FRAME_VERSIONS, "RUN_FRAME_VERSIONS");
    expect(writable).toEqual([]);
    // Writing is an error, not a silent no-op (modules are strict).
    const runsGet = API["runs.get"] as unknown as { summary: string; errors: unknown[] };
    expect(() => {
      runsGet.summary = "changed";
    }).toThrow(TypeError);
    expect(() => runsGet.errors.push({})).toThrow(TypeError);
    expect(() => (EVENT_VERSIONS["run.created"] as unknown as number[]).push(2)).toThrow(TypeError);
    expect(Object.isFrozen(COMMON_ERRORS)).toBe(true);
  });

  it("C58 the table itself is frozen: an entry cannot be added, replaced or removed; a test's entry belongs to one server", async () => {
    const table = API as unknown as Record<string, RouteDefinition>;
    expect(Object.isFrozen(API)).toBe(true);
    expect(() => {
      table["zz.added"] = API["runs.get"];
    }).toThrow(TypeError);
    expect(() => {
      table["runs.get"] = API["runs.list"];
    }).toThrow(TypeError);
    expect(() => {
      delete table["runs.get"];
    }).toThrow(TypeError);
    expect(Object.keys(API)).toHaveLength(145);

    // The only route outside the table is a test's, bound to one server, and it cannot shadow an entry of the table.
    const tmp = makeTempHome("mordomo-synthetic-");
    const ctx = new AppContext(tmp.paths.home);
    const first = await buildServer(ctx, { validateResponses: true });
    const second = await buildServer(ctx, { validateResponses: true });
    try {
      const entry = route({
        method: "GET",
        path: "/api/zz-own",
        scope: "monitor",
        summary: "An entry that belongs to one server",
        tag: "test",
        responses: { 200: z.object({ ok: z.literal(true) }) },
      });
      registerSyntheticEntry(first, "zz.own", entry, async () => ({ ok: true }));
      expect(first.syntheticEntries.has("zz.own")).toBe(true);
      expect(second.syntheticEntries.size).toBe(0);
      expect(() => registerSyntheticEntry(first, "zz.own", entry, async () => ({ ok: true }))).toThrow(
        /already registered/,
      );
      expect(() => registerSyntheticEntry(first, "runs.get", entry, async () => ({ ok: true }))).toThrow(
        /is an entry of the route table/,
      );
      // The second server refuses a route that names the first one's entry: it has no contract there.
      expect(() => bindEntry(second, "zz.own", entry, async () => ({ ok: true }))).toThrow(
        /declares no contract/,
      );
      expect(Object.hasOwn(API, "zz.own")).toBe(false);
    } finally {
      await first.close();
      await second.close();
      ctx.close();
      tmp.cleanup();
    }
  });
});

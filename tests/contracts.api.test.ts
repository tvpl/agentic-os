import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import { API, SettingsSchema, checkResponse, isRawResponse, type RouteDefinition } from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/** The route table without a server (.specs/features/contratos-rest): its shape, its dependencies, its tolerance. */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = Object.entries(API) as Array<[string, RouteDefinition]>;
const isZod = (value: unknown): value is z.ZodTypeAny => value instanceof z.ZodType;

describe("S1 the table", () => {
  it("C2 every entry has a schema or a raw kind for each success status", () => {
    expect(entries).toHaveLength(127);
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

import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as ChildProcess from "node:child_process";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { resolveApprovalForChat } from "../apps/api/src/approvalActions.js";
import { probeServer } from "../apps/api/src/instances.js";
import Database from "better-sqlite3";
import ts from "typescript";
import { MIGRATIONS, TelegramPoller, type TelegramUpdate } from "@mordomo/core";
import { FAKE_BIN, makeTempHome } from "./helpers.js";

const TELEGRAM_ENV = "MORDOMO_V1_TEST_TELEGRAM_TOKEN";

/**
 * API v1 (.specs/features/api-v1): a versioned path, one error envelope,
 * owner/device scopes, query tokens only on streams, attempt limits, an
 * OpenAPI document of the route table, and who decided each approval.
 */

/** Every child process the API starts; a `restart` child is faked so the test never restarts anything. */
const spawned = vi.hoisted(() => [] as string[][]);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (command: string, args: readonly string[] = [], ...rest: unknown[]) => {
      spawned.push([command, ...args]);
      if (args.includes("restart")) {
        const fake = new EventEmitter() as EventEmitter & { unref: () => void };
        fake.unref = () => undefined;
        return fake;
      }
      return (actual.spawn as (...a: unknown[]) => unknown)(command, args, ...rest);
    },
  };
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.channels.telegram.botTokenEnv = TELEGRAM_ENV;
  settings.channels.telegram.chatId = "12345";
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  token = ctx.token();
  app = await buildServer(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[TELEGRAM_ENV];
});

afterAll(async () => {
  await ctx.runs.shutdown(2000);
  await app.close();
  ctx.close();
  cleanup();
});

const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });

/** A paired device and its bearer token. */
function pairDevice(name = "phone"): { id: string; token: string } {
  const { code } = ctx.devices.startPairing(name);
  const claimed = ctx.devices.claim(code, name);
  expect(claimed).not.toBeNull();
  return { id: claimed!.device.id, token: claimed!.token };
}

/** The 18 owner routes of door 3. */
const OWNER_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["PUT", "/api/settings"],
  ["PUT", "/api/providers/default"],
  ["POST", "/api/providers/:id/detect"],
  ["POST", "/api/system/restart"],
  ["POST", "/api/system/reap"],
  ["POST", "/api/backups"],
  ["POST", "/api/backups/:name/restore"],
  ["DELETE", "/api/backups/restore-pending"],
  ["POST", "/api/sync/apply"],
  ["POST", "/api/skills/install"],
  ["POST", "/api/skills/import"],
  ["POST", "/api/connectors"],
  ["PUT", "/api/connectors/:id"],
  ["DELETE", "/api/connectors/:id"],
  ["POST", "/api/pair/start"],
  ["DELETE", "/api/devices/:id"],
  ["POST", "/api/memory/open"],
  ["GET", "/api/diagnostics/export"],
];

/** The four GETs of door 4 that may carry `?token=`. */
const QUERY_TOKEN_ROUTES = [
  "GET /api/events",
  "GET /api/runs/:id/stream",
  "GET /api/artifacts/raw",
  "GET /api/skills/:slug/resource",
];

/** What an owner route could change: the files of the home (but logs and the database), devices, the pairing. */
function fingerprint(): string {
  const hash = crypto.createHash("sha256");
  const db = path.basename(ctx.paths.dbFile);
  const walk = (dir: string) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (full === ctx.paths.logs || entry.name.startsWith(db)) continue;
      if (entry.isDirectory()) walk(full);
      else
        hash.update(`${path.relative(ctx.paths.home, full)}:${fs.readFileSync(full).toString("base64")}\n`);
    }
  };
  walk(ctx.paths.home);
  // A device's last use is recorded on every call; that is not a change the route made.
  hash.update(JSON.stringify(ctx.devices.list().map(({ lastSeenAt: _seen, ...d }) => d)));
  hash.update(String(ctx.devices.pairingOpen() !== null));
  return hash.digest("hex");
}

/** Every (method, path) Fastify registered under /api, read from its own route tree (HEAD is implicit). */
function registeredApiRoutes(): Array<{ method: string; url: string }> {
  const routes: Array<{ method: string; url: string }> = [];
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const at = line.indexOf("── ");
    if (at < 0) continue;
    const depth = (at - 1) / 4;
    const m = /^(.*?)(?: \(([^)]*)\))?$/.exec(line.slice(at + 3))!;
    const url = (depth > 0 ? stack[depth - 1]! : "") + m[1]!;
    stack.length = depth;
    stack.push(url);
    if (!m[2] || !url.startsWith("/api/")) continue;
    for (const method of m[2].split(", ")) if (method !== "HEAD") routes.push({ method, url });
  }
  return routes;
}

/** Open an SSE URL on a real socket, keep the status and headers, and hang up. */
async function openStream(url: string, method = "GET"): Promise<{ status: number; headers: Headers }> {
  const ac = new AbortController();
  const res = await fetch(url, { method, signal: ac.signal });
  ac.abort();
  return { status: res.status, headers: res.headers };
}

async function listening(): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

describe("S1 a version in the path", () => {
  it("C1 every GET route answers the same under v1", async () => {
    const SSE = new Set(["/api/events"]);
    const gets = registeredApiRoutes().filter(
      (r) => r.method === "GET" && !r.url.includes(":") && !r.url.includes("*") && !SSE.has(r.url),
    );
    expect(gets.length).toBeGreaterThan(40);
    // Freeze the clock so uptime- and timestamp-bearing bodies are comparable.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    try {
      for (const { url } of gets) {
        // A first read may create what it reads (today's journal): compare from the second one on.
        await app.inject({ method: "GET", url, headers: owner() });
        const plain = await app.inject({ method: "GET", url, headers: owner() });
        const v1 = await app.inject({ method: "GET", url: `/api/v1/${url.slice(5)}`, headers: owner() });
        expect(v1.statusCode, url).toBe(plain.statusCode);
        expect(v1.body, url).toBe(plain.body);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("C2 writes and streams work under v1", async () => {
    const before = ctx.runs.list({ limit: 500 }).length;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: owner(),
      payload: { prompt: "hello from v1", mode: "read_only" },
    });
    expect(res.statusCode).toBe(200);
    const { runId } = res.json() as { runId: string };
    expect(ctx.runs.get(runId)?.promptSummary).toContain("hello from v1");
    expect(ctx.runs.list({ limit: 500 }).length).toBe(before + 1);

    const base = await listening();
    const stream = await openStream(`${base}/api/v1/events?token=${token}`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("deprecation")).toBeNull();
  });

  it("C3 unversioned routes announce their successor", async () => {
    const plain = await app.inject({ method: "GET", url: "/api/runs", headers: owner() });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers.deprecation).toBe("true");
    expect(plain.headers.link).toBe('</api/v1/runs>; rel="successor-version"');
    const v1 = await app.inject({ method: "GET", url: "/api/v1/runs", headers: owner() });
    expect(v1.statusCode).toBe(200);
    expect(v1.headers.deprecation).toBeUndefined();
    expect(v1.headers.link).toBeUndefined();
  });

  it("C4 meta names the API version", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(res.statusCode).toBe(200);
    expect(res.json().apiVersion).toBe(1);
  });

  it("C5 the clients call v1", () => {
    const uiSrc = path.join(repoRoot, "apps/command-centre/src");
    const files = (fs.readdirSync(uiSrc, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("gallery"))
      .map((f) => path.join(uiSrc, f));
    // A URL reaches the network only through `apiUrl(…)` or a builder that returns one.
    const BUILDERS = ["apiUrl(", "resourceUrl(", "artifactRawUrl("];
    const calls: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:fetch|new EventSource)\(\s*([^,)]*)/g)) {
        const arg = m[1]!.trim();
        calls.push(`${path.relative(uiSrc, file)}: ${arg}`);
        expect(
          BUILDERS.some((b) => arg.startsWith(b)),
          `${path.relative(uiSrc, file)} sends ${arg}`,
        ).toBe(true);
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const apiTs = fs.readFileSync(path.join(uiSrc, "api.ts"), "utf8");
    expect(apiTs).toMatch(/fetch\(apiUrl\(url\)/);
    expect(apiTs).toMatch(/export function artifactRawUrl[^]*?return apiUrl\(\s*`\/api\/artifacts\/raw/);
    const resources = fs.readFileSync(path.join(uiSrc, "views/Skills/resources.ts"), "utf8");
    expect(resources).toMatch(/export function resourceUrl[^]*?apiUrl\(\s*`\/api\/skills\//);

    for (const name of ["mordomo.ts", "permission.ts"]) {
      const code = fs
        .readFileSync(path.join(repoRoot, "apps/api/src/mcp", name), "utf8")
        .replace(/\/\*[^]*?\*\/|\/\/.*$/gm, "");
      const literals = [...code.matchAll(/["'`](\/api\/[^"'`]*)/g)].map((m) => m[1]!);
      expect(literals.length, name).toBeGreaterThan(0);
      for (const url of literals) expect(url, `${name}: ${url}`).toMatch(/^\/api\/v1\//);
    }
  });
});

/** The door-2 envelope: a code, a message, and the same message at the top for older clients. */
function expectEnvelope(
  res: { statusCode: number; json: () => unknown },
  status: number,
  code?: string,
  label?: string,
) {
  expect(res.statusCode, label).toBe(status);
  const body = res.json() as { error: { code: string; message: string }; message: string };
  expect(typeof body.error?.code, label).toBe("string");
  expect(body.error.code.length, label).toBeGreaterThan(0);
  if (code) expect(body.error.code, label).toBe(code);
  expect(typeof body.error.message, label).toBe("string");
  expect(body.error.message.length, label).toBeGreaterThan(0);
  expect(body.message, label).toBe(body.error.message);
  return body;
}

/**
 * AC 7 on the syntax tree (L-029): every object literal a route handler answers
 * with — returned (also as an arrow's body), passed to `.send(…)`, through
 * parentheses, casts, `await`, both arms of `?:`/`??`/`||`, a local variable,
 * or the return of a same-file function it calls — whose own `ok` is anything
 * but the literal `true`. Handlers are the function arguments of
 * `<x>.get|post|put|patch|delete|head|options|all("/…", …)` and the `handler`
 * of `<x>.route({ … })`, inline or by name. Nested objects (`{ health: { ok } }`)
 * are data, not the answer's flag, and are not flagged; nor are strings,
 * comments, or objects the handler builds but does not answer with.
 */
function okNotTrueSites(source: string, fileName = "source.ts"): { handlers: number; sites: string[] } {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);
  type Fn = ts.FunctionLikeDeclaration;
  const isFn = (n: ts.Node | undefined): n is Fn =>
    !!n &&
    (ts.isArrowFunction(n) ||
      ts.isFunctionExpression(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n));
  const named = new Map<string, Fn>();
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) named.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFn(n.initializer))
      named.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(file);
  const asFn = (e: ts.Node | undefined): Fn | undefined =>
    isFn(e) ? e : e && ts.isIdentifier(e) ? named.get(e.text) : undefined;
  const keyOf = (name: ts.PropertyName): string | null => {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
      return name.text;
    if (ts.isComputedPropertyName(name)) {
      let e: ts.Expression = name.expression;
      while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
      return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null;
    }
    return null;
  };
  const ownFn = (n: ts.Node): ts.Node | undefined => {
    let p = n.parent;
    while (p && !ts.isFunctionLike(p)) p = p.parent;
    return p;
  };

  const handlers = new Set<Fn>();
  const findHandlers = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const [first] = n.arguments;
      if (method === "route" && first && ts.isObjectLiteralExpression(first)) {
        for (const p of first.properties) {
          if (!p.name || keyOf(p.name) !== "handler") continue;
          const fn = ts.isPropertyAssignment(p)
            ? asFn(p.initializer)
            : ts.isShorthandPropertyAssignment(p)
              ? named.get(p.name.text)
              : asFn(p);
          if (fn) handlers.add(fn);
        }
      } else if (
        METHODS.has(method) &&
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
        first.text.startsWith("/")
      ) {
        const fn = asFn(n.arguments[n.arguments.length - 1]);
        if (fn) handlers.add(fn);
      }
    }
    ts.forEachChild(n, findHandlers);
  };
  findHandlers(file);

  const sites = new Set<string>();
  const line = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;
  const checkObject = (obj: ts.ObjectLiteralExpression) => {
    for (const p of obj.properties) {
      if (!p.name || keyOf(p.name) !== "ok") continue;
      if (ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.TrueKeyword) continue;
      sites.add(`${fileName}:${line(p)} ${p.getText(file).replace(/\s+/g, " ")}`);
    }
  };
  const seen = new Set<Fn>();
  const answers = (e: ts.Expression | undefined, scope: Fn, depth = 0): void => {
    if (!e || depth > 20) return;
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isAwaitExpression(e)
    )
      return answers(e.expression, scope, depth + 1);
    if (ts.isConditionalExpression(e)) {
      answers(e.whenTrue, scope, depth + 1);
      return answers(e.whenFalse, scope, depth + 1);
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken)
        answers(e.left, scope, depth + 1);
      if (
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.CommaToken
      )
        answers(e.right, scope, depth + 1);
      return;
    }
    if (ts.isObjectLiteralExpression(e)) return checkObject(e);
    if (ts.isIdentifier(e)) {
      // A local the handler answers with: its initialiser and every assignment to it.
      const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text)
          answers(n.initializer, scope, depth + 1);
        if (
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(n.left) &&
          n.left.text === e.text
        )
          answers(n.right, scope, depth + 1);
        ts.forEachChild(n, visit);
      };
      if (scope.body) visit(scope.body);
      return;
    }
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
      const callee = named.get(e.expression.text);
      if (callee) answersOf(callee);
    }
  };
  // What a function answers with: its returns (not those of the callbacks inside it) and its arrow body.
  const answersOf = (fn: Fn) => {
    if (seen.has(fn)) return;
    seen.add(fn);
    if (fn.body && !ts.isBlock(fn.body)) answers(fn.body, fn);
    const visit = (n: ts.Node) => {
      if (ts.isReturnStatement(n) && ownFn(n) === fn) answers(n.expression, fn);
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  };
  for (const fn of handlers) {
    answersOf(fn);
    // `reply.send(…)` anywhere in the handler, its callbacks included.
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "send"
      )
        answers(n.arguments[0], fn);
      ts.forEachChild(n, visit);
    };
    if (fn.body) visit(fn.body);
  }
  return { handlers: handlers.size, sites: [...sites] };
}

describe("S2 one error shape", () => {
  it("C7 every failure uses the envelope", async () => {
    const claim = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      headers: { "content-type": "application/json" },
      payload: { code: "000000", name: "x" },
    });
    expectEnvelope(claim, 401, "pair_failed");

    expectEnvelope(await app.inject({ method: "GET", url: "/api/v1/nao-existe", headers: owner() }), 404);

    const big = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: owner(),
      payload: JSON.stringify({ prompt: "x".repeat(6 * 1024 * 1024), mode: "read_only" }),
    });
    expectEnvelope(big, 413);
    expect(big.json().error.code).toBe("payload_too_large");

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: owner(),
      payload: { mode: "sideways" },
    });
    const body = expectEnvelope(invalid, 400, "validation") as { error: { issues?: unknown[] } };
    expect(body.error.issues?.length).toBeGreaterThan(0);
  });

  it("C8 telegram failures are errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["/api/v1/channels/telegram/test", "/api/v1/channels/telegram/send"]) {
      const res = await app.inject({ method: "POST", url, headers: owner(), payload: { text: "hi" } });
      expectEnvelope(res, 409, "channel_not_configured");
    }
    expect(fetchMock).not.toHaveBeenCalled();

    process.env[TELEGRAM_ENV] = "bot-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }))),
    );
    for (const url of ["/api/v1/channels/telegram/test", "/api/v1/channels/telegram/send"]) {
      const res = await app.inject({ method: "POST", url, headers: owner(), payload: { text: "hi" } });
      expect(expectEnvelope(res, 502, "channel_failed").message).toBe("chat not found");
    }
  });

  it("C9 push failures are errors", async () => {
    const test = () =>
      app.inject({ method: "POST", url: "/api/v1/push/test", headers: owner(), payload: {} });
    ctx.settingsStore.update({
      channels: { ...ctx.settings().channels, push: { ...ctx.settings().channels.push, enabled: false } },
    });
    expectEnvelope(await test(), 409, "channel_not_configured");

    ctx.settingsStore.update({
      channels: { ...ctx.settings().channels, push: { ...ctx.settings().channels.push, enabled: true } },
    });
    expect(ctx.push.list()).toHaveLength(0);
    expectEnvelope(await test(), 409, "channel_not_configured");

    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const subscribed = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscribe",
      headers: owner(),
      payload: {
        subscription: {
          endpoint: "https://push.example.net/sub/v1",
          keys: {
            p256dh: ua.getPublicKey().toString("base64url"),
            auth: crypto.randomBytes(16).toString("base64url"),
          },
        },
      },
    });
    expect(subscribed.statusCode).toBe(200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    expectEnvelope(await test(), 502, "channel_failed");
  });

  it("C10 no route answers ok false with a 2xx", () => {
    // A route's failure is thrown (httpError) into the envelope, never answered as `ok: <anything but true>`.
    const src = path.join(repoRoot, "apps/api/src");
    const files = (fs.readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
    let handlers = 0;
    const sites: string[] = [];
    for (const file of files) {
      const scan = okNotTrueSites(fs.readFileSync(path.join(src, file), "utf8"), file);
      handlers += scan.handlers;
      sites.push(...scan.sites);
    }
    expect(sites).toEqual([]);
    // Every registered /api route has a handler the scan read (125 today), so the scan is not vacuous.
    expect(handlers).toBeGreaterThanOrEqual(app.apiRoutes.length);
  });
});

describe("S3 scopes and the token in the URL", () => {
  it("C11 a device cannot call an owner route", async () => {
    const device = pairDevice("lost phone");
    const other = pairDevice("tablet");
    const params: Record<string, string> = { ":id": "claude", ":name": "mordomo-backup-x.zip" };
    const bodies: Record<string, unknown> = {
      "PUT /api/settings": { securityProfile: "approved_automation", remote: { enabled: false } },
      "PUT /api/providers/default": { provider: "claude" },
      "POST /api/memory/open": { path: ctx.paths.home },
      "POST /api/pair/start": { name: "attacker" },
    };
    const settingsFile = path.join(ctx.paths.config, "settings.json");
    const spawnedBefore = spawned.length;
    for (const [method, route] of OWNER_ROUTES) {
      const url = route
        .replace(":id", route.startsWith("/api/devices/") ? other.id : (params[":id"] ?? ""))
        .replace(":name", params[":name"] ?? "");
      const settingsBefore = fs.readFileSync(settingsFile);
      const before = fingerprint();
      const res = await app.inject({
        method: method as "GET",
        url: `/api/v1/${url.slice(5)}`,
        headers: as(device.token),
        ...(method === "GET" || method === "DELETE" ? {} : { payload: bodies[`${method} ${route}`] ?? {} }),
      });
      expect(res.statusCode, `${method} ${route}`).toBe(403);
      expect(res.json().error.code, `${method} ${route}`).toBe("owner_only");
      expect(fs.readFileSync(settingsFile).equals(settingsBefore), `${method} ${route}`).toBe(true);
      expect(fingerprint(), `${method} ${route}`).toBe(before);
    }
    expect(spawned.slice(spawnedBefore)).toEqual([]);
    expect(ctx.devices.get(other.id)?.revokedAt).toBeNull();
    expect(ctx.devices.pairingOpen()).toBeNull();
  });

  it("C12 the owner routes are exactly the door's list", () => {
    const marked = app.apiRoutes.filter((r) => r.config.scope === "owner").map((r) => `${r.method} ${r.url}`);
    expect(marked.sort()).toEqual(OWNER_ROUTES.map(([m, u]) => `${m} ${u}`).sort());
    // The table is the router's: every route Fastify knows is in it, and nothing else.
    expect(app.apiRoutes.map((r) => `${r.method} ${r.url}`).sort()).toEqual(
      registeredApiRoutes()
        .map((r) => `${r.method} ${r.url}`)
        .sort(),
    );
  });

  it("C13 a device keeps the everyday routes", async () => {
    const device = pairDevice("phone");
    const list = await app.inject({ method: "GET", url: "/api/v1/runs", headers: as(device.token) });
    expect(list.statusCode).toBe(200);
    const run = await app.inject({
      method: "POST",
      url: "/api/v1/runs",
      headers: as(device.token),
      payload: { prompt: "from the phone", mode: "read_only" },
    });
    expect([200, 202]).toContain(run.statusCode);
    const approval = ctx.approvals.request("tool_use", "Write: /tmp/x", { runId: crypto.randomUUID() });
    const resolved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approval.id}/resolve`,
      headers: as(device.token),
      payload: { decision: "approved" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(ctx.approvals.get(approval.id)?.status).toBe("approved");
  });

  it("C14 the owner keeps every route", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/settings",
      headers: owner(),
      payload: { securityProfile: "review_before_write" },
    });
    expect(put.statusCode).toBe(200);
    expect(ctx.settings().securityProfile).toBe("review_before_write");
    const pair = await app.inject({
      method: "POST",
      url: "/api/v1/pair/start",
      headers: owner(),
      payload: {},
    });
    expect(pair.statusCode).toBe(200);
    expect(ctx.devices.pairingOpen()).not.toBeNull();
  });

  it("C15 a query token is refused outside streams", async () => {
    const before = ctx.runs.list({ limit: 500 }).length;
    const get = await app.inject({ method: "GET", url: `/api/v1/runs?token=${token}` });
    expect(get.statusCode).toBe(401);
    expect(get.json().error.code).toBe("unauthorized");
    const post = await app.inject({
      method: "POST",
      url: `/api/v1/runs?token=${token}`,
      headers: { "content-type": "application/json" },
      payload: { prompt: "smuggled", mode: "read_only" },
    });
    expect(post.statusCode).toBe(401);
    expect(post.json().error.code).toBe("unauthorized");
    expect(ctx.runs.list({ limit: 500 }).length).toBe(before);
  });

  it("C16 streams accept a query token", async () => {
    const marked = app.apiRoutes
      .filter((r) => r.config.queryToken === true)
      .map((r) => `${r.method} ${r.url}`);
    expect(marked.sort()).toEqual([...QUERY_TOKEN_ROUTES].sort());
    const record = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "streamed",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
    });
    const base = await listening();
    for (const url of [`/api/v1/events?token=${token}`, `/api/v1/runs/${record.id}/stream?token=${token}`]) {
      const res = await openStream(`${base}${url}`);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("content-type"), url).toContain("text/event-stream");
    }
  });
});

describe("S4 attempt limits", () => {
  const claim = (remoteAddress: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/pair/claim",
      remoteAddress,
      headers: { "content-type": "application/json" },
      payload: { code: "000000", name: "guess" },
    });

  it("C17 pairing attempts are limited per address", async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await claim("203.0.113.5");
      expect(res.statusCode, `attempt ${i}`).toBe(401);
      expect(res.json().error.code, `attempt ${i}`).toBe("pair_failed");
    }
    const eleventh = await claim("203.0.113.5");
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().error.code).toBe("too_many_requests");
    const retryAfter = eleventh.headers["retry-after"];
    expect(String(retryAfter)).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const other = await claim("203.0.113.7");
    expect(other.statusCode).toBe(401);
    expect(other.json().error.code).toBe("pair_failed");
  });

  it("C18 failed logins are limited per address", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    try {
      const remoteAddress = "203.0.113.6";
      for (let i = 1; i <= 20; i++) {
        const res = await app.inject({ method: "GET", url: "/api/v1/runs", remoteAddress });
        expect(res.statusCode, `attempt ${i}`).toBe(401);
      }
      const locked = await app.inject({
        method: "GET",
        url: "/api/v1/runs",
        remoteAddress,
        headers: owner(),
      });
      expect(locked.statusCode).toBe(429);
      expect(locked.json().error.code).toBe("too_many_requests");
      expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
      vi.setSystemTime(Date.now() + 5 * 60_000);
      const back = await app.inject({ method: "GET", url: "/api/v1/runs", remoteAddress, headers: owner() });
      expect(back.statusCode).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("C19 loopback is never locked out", async () => {
    for (let i = 1; i <= 30; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/runs", remoteAddress: "127.0.0.1" });
      expect(res.statusCode, `attempt ${i}`).toBe(401);
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/runs",
      remoteAddress: "127.0.0.1",
      headers: owner(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("S5 the route document", () => {
  type Operation = {
    security?: unknown[];
    parameters?: Array<{ name: string; in: string }>;
    "x-mordomo-scope"?: string;
  };
  async function document() {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: owner() });
    expect(res.statusCode).toBe(200);
    return res.json() as { openapi: string; paths: Record<string, Record<string, Operation>> };
  }
  const operations = (doc: { paths: Record<string, Record<string, Operation>> }) =>
    Object.entries(doc.paths).flatMap(([p, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ key: `${method.toUpperCase()} ${p}`, path: p, op })),
    );

  it("C20 the document lists every route", async () => {
    const doc = await document();
    expect(doc.openapi).toBe("3.1.0");
    const expected = registeredApiRoutes().map(
      (r) => `${r.method} /api/v1/${r.url.slice(5).replace(/:(\w+)/g, "{$1}")}`,
    );
    expect(expected.length).toBeGreaterThan(120);
    expect(
      operations(doc)
        .map((o) => o.key)
        .sort(),
    ).toEqual(expected.sort());
  });

  it("C21 each operation carries its scope", async () => {
    const doc = await document();
    for (const { key, path: p, op } of operations(doc)) {
      expect(Array.isArray(op.security), key).toBe(true);
      const names = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(
        (op.parameters ?? []).filter((x) => x.in === "path").map((x) => x.name),
        key,
      ).toEqual(names);
    }
    const owners = operations(doc)
      .filter((o) => o.op["x-mordomo-scope"] === "owner")
      .map((o) => o.key);
    expect(owners.sort()).toEqual(
      OWNER_ROUTES.map(([m, u]) => `${m} /api/v1/${u.slice(5).replace(/:(\w+)/g, "{$1}")}`).sort(),
    );
    expect(doc.paths["/api/v1/meta"]!.get!.security).toEqual([]);
    expect(doc.paths["/api/v1/pair/claim"]!.post!.security).toEqual([]);
    expect(doc.paths["/api/v1/runs"]!.get!.security).not.toEqual([]);
  });
});

describe("S6 who decided, and Telegram per person", () => {
  const approvalVia = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/v1/approvals/${id}`, headers: owner() });
    expect(res.statusCode).toBe(200);
    return res.json() as { status: string; resolvedBy: string | null };
  };
  const resolve = (id: string, credential: string, decision: "approved" | "denied") =>
    app.inject({
      method: "POST",
      url: `/api/v1/approvals/${id}/resolve`,
      headers: as(credential),
      payload: { decision },
    });

  it("C22 an approval records who decided it", async () => {
    const byOwner = ctx.approvals.request("tool_use", "Write: a", { runId: crypto.randomUUID() });
    expect((await approvalVia(byOwner.id)).resolvedBy).toBeNull();
    expect((await resolve(byOwner.id, token, "approved")).statusCode).toBe(200);
    expect(await approvalVia(byOwner.id)).toMatchObject({ status: "approved", resolvedBy: "owner" });

    const device = pairDevice("phone 2");
    const byDevice = ctx.approvals.request("tool_use", "Write: b", { runId: crypto.randomUUID() });
    expect((await resolve(byDevice.id, device.token, "denied")).statusCode).toBe(200);
    expect(await approvalVia(byDevice.id)).toMatchObject({
      status: "denied",
      resolvedBy: `device:${device.id}`,
    });

    ctx.settingsStore.update({ securityProfile: "review_before_write" });
    const run = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "change something",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 60_000,
      profile: "review_before_write",
    });
    const broker = ctx.permissionBrokerFor({ id: run.id, permissionProfile: "review_before_write" });
    expect(broker).not.toBeNull();
    const byBroker = ctx.approvals.request("tool_use", "Write: c", { runId: run.id });
    expect((await resolve(byBroker.id, broker!.env.MORDOMO_TOKEN!, "denied")).statusCode).toBe(200);
    expect(await approvalVia(byBroker.id)).toMatchObject({
      status: "denied",
      resolvedBy: `broker:${run.id}`,
    });

    const stale = ctx.approvals.request("tool_use", "Write: d", { runId: crypto.randomUUID() });
    ctx.approvals.expireStale(Date.now() + 365 * 86_400_000);
    expect(await approvalVia(stale.id)).toMatchObject({ status: "expired", resolvedBy: "system" });
  });

  /** A poller wired like the service's, fed `updates` once; every other Bot API call is recorded. */
  async function pollWith(updates: TelegramUpdate[]): Promise<string[]> {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const method = String(url).split("/").pop()!;
      if (method === "getUpdates") return new Response(JSON.stringify({ ok: true, result: updates }));
      calls.push(method);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }) as typeof fetch;
    const poller = new TelegramPoller({
      getSettings: () => ctx.settings(),
      resolve: (id, decision, by) => resolveApprovalForChat(ctx, id, decision, by),
      pending: () => [],
      fetchImpl,
      env: { [TELEGRAM_ENV]: "bot-token" },
      pollSeconds: 0,
    });
    await poller.pollOnce();
    return calls;
  }
  let updateId = 1000;
  const button = (data: string, fromId: number, chatId = 12345): TelegramUpdate => ({
    update_id: updateId++,
    callback_query: {
      id: `q${updateId}`,
      data,
      from: { id: fromId },
      message: { message_id: 1, chat: { id: chatId } },
    },
  });
  const command = (text: string, fromId: number, chatId = 12345): TelegramUpdate => ({
    update_id: updateId++,
    message: { message_id: 2, chat: { id: chatId }, text, from: { id: fromId } },
  });
  const allow = (ids: number[]) =>
    ctx.settingsStore.update({
      channels: {
        ...ctx.settings().channels,
        telegram: { ...ctx.settings().channels.telegram, allowedUserIds: ids },
      },
    });
  const pendingApproval = () => ctx.approvals.request("tool_use", "Write: t", { runId: crypto.randomUUID() });

  it("C23 telegram records the person", async () => {
    allow([]);
    const a = pendingApproval();
    await pollWith([button(`ap:${a.id}`, 42)]);
    expect(ctx.approvals.get(a.id)).toMatchObject({ status: "approved", resolvedBy: "telegram:42" });
  });

  it("C24 only listed people decide from telegram", async () => {
    allow([42]);
    const a = pendingApproval();
    const b = pendingApproval();
    const ignored = await pollWith([button(`ap:${a.id}`, 7), command(`/approve ${b.id}`, 7)]);
    expect(ignored).toEqual([]);
    expect(ctx.approvals.get(a.id)?.status).toBe("pending");
    expect(ctx.approvals.get(b.id)?.status).toBe("pending");

    const heard = await pollWith([button(`ap:${a.id}`, 42), command(`/deny ${b.id}`, 42)]);
    expect(heard).toContain("sendMessage");
    expect(ctx.approvals.get(a.id)).toMatchObject({ status: "approved", resolvedBy: "telegram:42" });
    expect(ctx.approvals.get(b.id)).toMatchObject({ status: "denied", resolvedBy: "telegram:42" });
  });

  it("C25 an empty list keeps the chat rule", async () => {
    allow([]);
    const a = pendingApproval();
    const b = pendingApproval();
    const otherChat = await pollWith([button(`ap:${b.id}`, 99, 777)]);
    expect(otherChat).toEqual([]);
    expect(ctx.approvals.get(b.id)?.status).toBe("pending");
    await pollWith([button(`ap:${a.id}`, 99)]);
    expect(ctx.approvals.get(a.id)).toMatchObject({ status: "approved", resolvedBy: "telegram:99" });
  });

  it("C30 an unlisted person gets nothing from any command or button", async () => {
    allow([42]);
    // Every update kind `parseCommand` knows, table-driven (L-030): decisions, listings, help, buttons.
    const KINDS: Array<{ name: string; update: (id: string, from: number) => TelegramUpdate }> = [
      { name: "/approve", update: (id, from) => command(`/approve ${id}`, from) },
      { name: "/deny", update: (id, from) => command(`/deny ${id}`, from) },
      { name: "/ok", update: (id, from) => command(`/ok ${id}`, from) },
      { name: "/no", update: (id, from) => command(`/no ${id}`, from) },
      { name: "/pending", update: (_id, from) => command("/pending", from) },
      { name: "/status", update: (_id, from) => command("/status", from) },
      { name: "/start", update: (_id, from) => command("/start", from) },
      { name: "/help", update: (_id, from) => command("/help", from) },
      { name: "ap: button", update: (id, from) => button(`ap:${id}`, from) },
      { name: "dn: button", update: (id, from) => button(`dn:${id}`, from) },
    ];
    for (const kind of KINDS) {
      const a = pendingApproval();
      const ignored = await pollWith([kind.update(a.id, 7)]);
      expect(ignored, `${kind.name} from 7`).toEqual([]);
      expect(ctx.approvals.get(a.id)?.status, `${kind.name} from 7`).toBe("pending");
      // The same update from the listed person is answered, so the silence above is the guard's.
      const heard = await pollWith([kind.update(a.id, 42)]);
      expect(heard.length, `${kind.name} from 42`).toBeGreaterThan(0);
    }
  });

  it("C26 old approvals read back without a decider", () => {
    const tmp = makeTempHome();
    try {
      const previous = Math.max(...MIGRATIONS.map((m) => m.version)) - 1;
      const raw = new Database(tmp.paths.dbFile);
      for (const m of MIGRATIONS.filter((x) => x.version <= previous)) {
        if (m.sql) raw.exec(m.sql);
        m.up?.(raw);
      }
      raw.pragma(`user_version = ${previous}`);
      expect(raw.pragma("table_info(approvals)") as Array<{ name: string }>).not.toContainEqual(
        expect.objectContaining({ name: "resolved_by" }),
      );
      raw
        .prepare(
          "INSERT INTO approvals (id, created_at, kind, description, payload, status, resolved_at) VALUES (?, ?, 'tool_use', 'old', '{}', 'approved', ?)",
        )
        .run("old-approval", Date.now() - 1000, Date.now());
      raw.close();

      const migrated = new AppContext(tmp.paths.home);
      try {
        expect(migrated.approvals.get("old-approval")).toMatchObject({
          status: "approved",
          resolvedBy: null,
        });
      } finally {
        migrated.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
});

describe("Round 2 - the first verification's gaps", () => {
  type Inject = Parameters<FastifyInstance["inject"]>[0] & object;
  const json = { "content-type": "application/json" };

  it("C27 a query token is refused on public routes too", async () => {
    const publics = app.apiRoutes.filter((r) => r.config.public === true).map((r) => `${r.method} ${r.url}`);
    expect(publics.sort()).toEqual(["GET /api/meta", "POST /api/pair/claim"]);
    const { code } = ctx.devices.startPairing("query");
    const devicesBefore = ctx.devices.list().length;
    for (const prefix of ["/api/", "/api/v1/"]) {
      const meta = await app.inject({ method: "GET", url: `${prefix}meta?token=${token}` });
      expectEnvelope(meta, 401, "unauthorized", `GET ${prefix}meta`);
      const claim = await app.inject({
        method: "POST",
        url: `${prefix}pair/claim?token=${token}`,
        headers: json,
        payload: { code, name: "smuggled" },
      });
      expectEnvelope(claim, 401, "unauthorized", `POST ${prefix}pair/claim`);
    }
    expect(ctx.devices.list().length).toBe(devicesBefore);
    expect(ctx.devices.pairingOpen()?.code).toBe(code);
    // Without the query token both answer, and the code refused above was a good one.
    expect((await app.inject({ method: "GET", url: "/api/v1/meta" })).statusCode).toBe(200);
    const fine = await app.inject({
      method: "POST",
      url: "/api/v1/pair/claim",
      remoteAddress: "203.0.113.50",
      headers: json,
      payload: { code, name: "fine" },
    });
    expect(fine.statusCode).toBe(200);
    expect(ctx.devices.list().length).toBe(devicesBefore + 1);
  });

  it("C28 only 401 answers count toward the lockout", async () => {
    const device = pairDevice("noisy phone");
    const NOT_401: Array<{ status: number; code: string; request: Inject }> = [
      {
        status: 404,
        code: "not_found",
        request: { method: "GET", url: "/api/v1/nao-existe", headers: owner() },
      },
      {
        status: 403,
        code: "owner_only",
        request: { method: "PUT", url: "/api/v1/settings", headers: as(device.token), payload: {} },
      },
      {
        status: 400,
        code: "validation",
        request: { method: "POST", url: "/api/v1/runs", headers: owner(), payload: { mode: "sideways" } },
      },
    ];
    let host = 60;
    for (const { status, code, request } of NOT_401) {
      const remoteAddress = `203.0.113.${host++}`;
      for (let i = 1; i <= 25; i++) {
        const res = await app.inject({ ...request, remoteAddress });
        expect(res.statusCode, `${status} #${i}`).toBe(status);
        expect(res.json().error.code, `${status} #${i}`).toBe(code);
      }
      const after = await app.inject({ method: "GET", url: "/api/v1/runs", headers: owner(), remoteAddress });
      expect(after.statusCode, `after 25 × ${status}`).toBe(200);
    }
    const remoteAddress = `203.0.113.${host}`;
    for (let i = 1; i <= 20; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/runs", remoteAddress });
      expect(res.statusCode, `401 #${i}`).toBe(401);
    }
    const locked = await app.inject({ method: "GET", url: "/api/v1/runs", headers: owner(), remoteAddress });
    expect(locked.statusCode).toBe(429);
  });

  it("C29 the pairing limit holds before the code is read", async () => {
    const claimWith = (code: string, remoteAddress: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/pair/claim",
        remoteAddress,
        headers: json,
        payload: { code, name: "limit" },
      });
    for (let i = 1; i <= 10; i++) {
      // A fresh code per guess, so the wrong guesses never burn the code tried last.
      const { code } = ctx.devices.startPairing("limit");
      const wrong = code === "000000" ? "000001" : "000000";
      expectEnvelope(await claimWith(wrong, "203.0.113.70"), 401, "pair_failed", `attempt ${i}`);
    }
    const { code } = ctx.devices.startPairing("limit");
    const before = ctx.devices.list().length;
    const eleventh = await claimWith(code, "203.0.113.70");
    expectEnvelope(eleventh, 429, "too_many_requests");
    expect(Number(eleventh.headers["retry-after"])).toBeGreaterThan(0);
    expect(ctx.devices.list().length).toBe(before);
    expect(ctx.devices.pairingOpen()?.code).toBe(code);
    // The code was right: another address pairs with it.
    const other = await claimWith(code, "203.0.113.71");
    expect(other.statusCode).toBe(200);
    expect(ctx.devices.list().length).toBe(before + 1);
  });

  it("C31 a query token rides only on GET", async () => {
    const record = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "streamed twice",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
    });
    const CONCRETE: Record<string, string> = {
      "/api/events": "events",
      "/api/runs/:id/stream": `runs/${record.id}/stream`,
      "/api/artifacts/raw": "artifacts/raw?p=notes.md",
      "/api/skills/:slug/resource": "skills/demo/resource?p=README.md",
    };
    const marked = app.apiRoutes.filter((r) => r.config.queryToken === true).map((r) => r.url);
    expect(marked.sort()).toEqual(Object.keys(CONCRETE).sort());
    // Every method but GET: HEAD (Fastify's twin of each GET) and each one the route table uses.
    const methods = [...new Set(["HEAD", ...app.apiRoutes.map((r) => r.method)])].filter((m) => m !== "GET");
    expect(methods.sort()).toEqual(["DELETE", "HEAD", "PATCH", "POST", "PUT"]);
    const base = await listening();
    for (const route of marked) {
      const rest = CONCRETE[route]!;
      const query = `${rest.includes("?") ? "&" : "?"}token=${token}`;
      for (const prefix of ["/api/", "/api/v1/"]) {
        for (const method of methods) {
          const res = await openStream(`${base}${prefix}${rest}${query}`, method);
          expect(res.status, `${method} ${prefix}${rest}`).toBe(401);
        }
      }
    }
  });

  it("C32 every failure of the hook and the parser uses the envelope", async () => {
    const device = pairDevice("envelope phone");
    const locked = "203.0.113.80";
    for (let i = 1; i <= 20; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/runs", remoteAddress: locked });
      expect(res.statusCode).toBe(401);
    }
    const CASES: Array<{ name: string; status: number; code: string; request: Inject; retryAfter?: true }> = [
      {
        name: "owner_only",
        status: 403,
        code: "owner_only",
        request: { method: "PUT", url: "/api/v1/settings", headers: as(device.token), payload: {} },
      },
      {
        name: "lockout",
        status: 429,
        code: "too_many_requests",
        retryAfter: true,
        request: { method: "GET", url: "/api/v1/runs", headers: owner(), remoteAddress: locked },
      },
      {
        name: "missing token",
        status: 401,
        code: "unauthorized",
        request: { method: "GET", url: "/api/v1/runs" },
      },
      {
        name: "bad token",
        status: 401,
        code: "unauthorized",
        request: { method: "GET", url: "/api/v1/runs", headers: as("not-a-token") },
      },
      {
        name: "query token refused",
        status: 401,
        code: "unauthorized",
        request: { method: "GET", url: `/api/v1/runs?token=${token}` },
      },
      {
        name: "malformed JSON",
        status: 400,
        code: "bad_request",
        request: { method: "POST", url: "/api/v1/runs", headers: owner(), payload: '{"prompt": ' },
      },
      {
        name: "unsupported content type",
        status: 415,
        code: "unsupported_media_type",
        request: {
          method: "POST",
          url: "/api/v1/runs",
          headers: { ...owner(), "content-type": "application/xml" },
          payload: "<run/>",
        },
      },
      {
        name: "unknown route",
        status: 404,
        code: "not_found",
        request: { method: "GET", url: "/api/v1/nao-existe", headers: owner() },
      },
      {
        name: "body too large",
        status: 413,
        code: "payload_too_large",
        request: {
          method: "POST",
          url: "/api/v1/runs",
          headers: owner(),
          payload: JSON.stringify({ prompt: "x".repeat(6 * 1024 * 1024), mode: "read_only" }),
        },
      },
      {
        name: "forbidden host",
        status: 403,
        code: "forbidden_host",
        request: { method: "GET", url: "/api/v1/runs", headers: { ...owner(), host: "evil.example.com" } },
      },
      {
        name: "forbidden path",
        status: 403,
        code: "forbidden_path",
        request: { method: "GET", url: "/api/v1/artifacts/raw?p=/etc/passwd", headers: owner() },
      },
      {
        name: "internal",
        status: 500,
        code: "internal",
        request: { method: "GET", url: "/api/v1/runs?limit=7", headers: owner() },
      },
    ];
    for (const c of CASES) {
      // The internal case: the route's own store fails, once.
      const failing =
        c.name === "internal"
          ? vi.spyOn(ctx.runs, "list").mockImplementationOnce(() => {
              throw new Error("disk on fire");
            })
          : null;
      const res = await app.inject(c.request);
      failing?.mockRestore();
      expectEnvelope(res, c.status, c.code, c.name);
      expect(res.headers["content-type"], c.name).toContain("application/json");
      if (c.retryAfter) expect(String(res.headers["retry-after"]), c.name).toMatch(/^[1-9]\d*$/);
    }
  });

  it("C33 every method of the route table answers the same under v1", async () => {
    const methods = [...new Set(app.apiRoutes.map((r) => r.method))].sort();
    const session = ctx.runs.sessions.create({
      provider: "claude",
      cwd: null,
      profile: null,
      title: "alias",
    });
    const note = (title: string) => ctx.notifications.add({ kind: "system", title }).id;
    // One route per method; each call gets its own fresh state, so both spellings meet the same world.
    const CASES: Record<string, { route: string; request: () => { rest: string; payload?: unknown } }> = {
      GET: { route: "/api/runs", request: () => ({ rest: "runs?limit=5" }) },
      POST: {
        route: "/api/notifications/read",
        request: () => ({ rest: "notifications/read", payload: { ids: [note("read me")] } }),
      },
      PUT: {
        route: "/api/ui-preferences",
        request: () => ({ rest: "ui-preferences", payload: { themePreset: "forest" } }),
      },
      PATCH: {
        route: "/api/sessions/:id",
        request: () => ({ rest: `sessions/${session.id}`, payload: { title: "renamed under both paths" } }),
      },
      DELETE: {
        route: "/api/notifications/:id",
        request: () => ({ rest: `notifications/${note("delete me")}` }),
      },
    };
    expect(Object.keys(CASES).sort()).toEqual(methods);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    try {
      for (const method of methods) {
        const { route, request } = CASES[method]!;
        expect(
          app.apiRoutes.some((r) => r.method === method && r.url === route),
          method,
        ).toBe(true);
        const call = async (prefix: string) => {
          const { rest, payload } = request();
          return app.inject({
            method: method as "GET",
            url: `${prefix}${rest}`,
            headers: payload === undefined ? { "x-mordomo-token": token } : owner(),
            ...(payload === undefined ? {} : { payload: payload as object }),
          });
        };
        const plain = await call("/api/");
        const v1 = await call("/api/v1/");
        expect(plain.statusCode, `${method} ${route}`).toBe(200);
        expect(v1.statusCode, `${method} ${route}`).toBe(plain.statusCode);
        expect(v1.body, `${method} ${route}`).toBe(plain.body);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("C34 the successor link never carries the query", async () => {
    const base = await listening();
    const stream = await openStream(`${base}/api/events?token=${token}`);
    expect(stream.status).toBe(200);
    const refused = await app.inject({ method: "GET", url: `/api/runs?token=${token}` });
    expect(refused.statusCode).toBe(401);
    const listed = await app.inject({ method: "GET", url: "/api/runs?limit=3", headers: owner() });
    expect(listed.statusCode).toBe(200);
    expect(stream.headers.get("link")).toBe('</api/v1/events>; rel="successor-version"');
    expect(refused.headers.link).toBe('</api/v1/runs>; rel="successor-version"');
    expect(listed.headers.link).toBe('</api/v1/runs>; rel="successor-version"');
  });

  it("C35 the ok scanner sees every answer shape and nothing else", () => {
    const flagged = (code: string) => okNotTrueSites(code).sites.length;
    // Shapes it must flag, one site each.
    const FLAG = [
      'app.get("/api/a", async () => { return { ok: false }; });',
      'app.post("/api/b", async () => ({ ok: result.ok, error }));',
      'app.post("/api/c", async (req, reply) => { reply.code(200).send({ ok: !sent }); });',
      'app.get("/api/d", async () => { const ok = check(); return { ok }; });',
      'app.get("/api/e", async () => ({ "ok": false }));',
      'app.get("/api/f", async () => ({ ["ok"]: false }));',
      'app.get("/api/g", async () => { return { ok: false } as Body; });',
      'app.get("/api/h", async () => ({ ok: false }) satisfies Body);',
      'app.get("/api/i", async () => (cond ? { ok: true } : { ok: false }));',
      'async function h() { return { ok: false }; }\napp.get("/api/j", h);',
      'const h = async () => ({ ok: maybe });\napp.get("/api/k", { config: {} }, h);',
      'app.route({ method: "GET", url: "/api/l", handler: async () => ({ ok: false }) });',
      'app.get("/api/m", async () => { const body = { ok: false }; return body; });',
      'app.get("/api/n", async (req, reply) => { stream.on("end", () => reply.send({ ok: false })); });',
      'fastify.put("/api/o", async () => ({ ok: 0 }));',
      'app.get("/api/p", async () => delivered(r));\nfunction delivered(r) { return { ok: r.ok }; }',
      'app.get("/api/q", async () => await Promise.resolve(x) ?? { ok: false });',
      "app.get(`/api/r`, async () => ({ ok: null }));",
    ];
    for (const code of FLAG) expect(flagged(code), code).toBe(1);
    // Shapes it must not flag.
    const PASS = [
      'app.get("/api/a", async () => ({ ok: true }));',
      'app.get("/api/b", async () => ({ providers: [{ ok: false }], health: { ok: x } }));',
      'app.get("/api/c", async () => { const probe = { ok: false }; log(probe); return { done: true }; });',
      'app.get("/api/d", async () => { const rows = list.map((r) => { return { ok: r.ok }; }); return { rows }; });',
      "helper(() => ({ ok: false }));",
      'cache.get("/api/x");',
      'app.get("/api/e", async () => ({ message: "ok: false is gone" }));',
      'app.get("/api/f", async () => {\n  // return { ok: false };\n  return { okay: false, notOk: false };\n});',
      'function unrelated() { return { ok: false }; }\napp.get("/api/g", async () => ({ ok: true }));',
    ];
    for (const code of PASS) expect(flagged(code), code).toBe(0);
    expect(
      okNotTrueSites('app.get("/x", async () => 1); app.route({ handler: h }); function h() {}').handlers,
    ).toBe(2);
  });

  it("C36 the CLI probe asks v1 first and falls back for an older service", async () => {
    const serve = async (paths: Record<string, unknown>) => {
      const server = http.createServer((req, res) => {
        const body = paths[req.url ?? ""];
        res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
        res.end(JSON.stringify(body ?? { error: { code: "not_found" } }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server;
    };
    const portOf = (server: http.Server) => (server.address() as { port: number }).port;
    const onlyV1 = await serve({ "/api/v1/meta": { name: "v1 only", version: "9.9.9" } });
    const older = await serve({ "/api/meta": { name: "older", version: "0.7.0" } });
    const neither = await serve({});
    try {
      expect(await probeServer(portOf(onlyV1))).toMatchObject({ name: "v1 only", version: "9.9.9" });
      expect(await probeServer(portOf(older))).toMatchObject({ name: "older", version: "0.7.0" });
      expect(await probeServer(portOf(neither))).toBeNull();
      const base = await listening();
      expect((await probeServer(Number(new URL(base).port)))?.version).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      for (const s of [onlyV1, older, neither]) await new Promise((r) => s.close(r));
    }
  });
});

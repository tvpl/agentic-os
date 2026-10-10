import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type * as ChildProcess from "node:child_process";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import {
  DEFAULT_DEVICE_SCOPES,
  DEVICE_SCOPES,
  EventBus,
  MIGRATIONS,
  closeDeviceScopes,
  triageSentinel,
  type ApprovalKind,
  type DeviceScope,
  type ProviderManifest,
} from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, deviceVerdict, type RouteScope } from "../apps/api/src/server.js";
import { resolveApprovalForChat } from "../apps/api/src/approvalActions.js";
import { FAKE_BIN, makeTempHome } from "./helpers.js";
import { EXPECTED_ROUTE_SCOPES, PUBLIC_ROUTES, routesOf } from "./helpers/routeScopes.js";

/**
 * Device scopes (.specs/features/escopos-dispositivo): what a paired device may call, what it may start, and that it
 * does not approve what it asked for. The expected route table is `tests/helpers/routeScopes.ts`, written by hand.
 */

/** Every child process the API starts, so "no provider process was launched" is a fact that can be read. */
const spawned = vi.hoisted(() => [] as string[][]);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[] = [], ...rest: unknown[]) => {
      spawned.push([command, ...args]);
      return (actual.spawn as (...a: unknown[]) => unknown)(command, args, ...rest);
    },
  };
});

/**
 * The runs a provider CLI was started for: the supervisor (`core/src/spawn/guardian.ts`) is started with the provider's
 * executable as its first argument, and the CLI's probes (version, help, auth) are not runs.
 */
function launches(): string[][] {
  return spawned.filter((argv) => {
    const at = argv.findIndex((a) => a.startsWith(FAKE_BIN) || path.basename(a) === "acme-cli");
    if (at === -1) return false;
    const args = argv.slice(at + 1);
    return (
      !args.includes("--version") && !args.includes("--help") && args[0] !== "auth" && args[0] !== "login"
    );
  });
}

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
const temps: string[] = [];

/** A third-party provider that says nothing about where its reads stop (a manifest from before `readConfinement`). */
const acmeManifest: ProviderManifest = {
  ...claudeManifest,
  id: "acme",
  displayName: "Acme Agent",
  binary: "acme-cli",
  capabilities: (() => {
    const { readConfinement: _dropped, ...rest } = claudeManifest.capabilities;
    return rest as ProviderManifest["capabilities"];
  })(),
  layout: { instructionsFile: "ACME.md", skillsDir: ".acme/skills", rulesFile: null, commandsDir: null },
  homeConfigFiles: [],
};

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-scopes-");
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const acmeBin = path.join(tmp.paths.home, "bin", "acme-cli");
  fs.mkdirSync(path.dirname(acmeBin), { recursive: true });
  fs.copyFileSync(path.join(FAKE_BIN, "claude"), acmeBin);
  fs.chmodSync(acmeBin, 0o755);
  ctx.providers.register(
    acmeManifest,
    (opts) =>
      Object.assign(Object.create(createClaudeAdapter(opts)) as object, {
        id: "acme",
        manifest: acmeManifest,
      }) as never,
  );
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.securityProfile = "review_before_write";
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.providers.codex = {
    ...settings.providers.codex,
    enabled: true,
    binaryPath: path.join(FAKE_BIN, "codex"),
  };
  settings.providers.cursor = {
    ...settings.providers.cursor,
    enabled: true,
    binaryPath: path.join(FAKE_BIN, "cursor-agent"),
  };
  settings.providers.acme = { ...settings.providers.claude, enabled: true, binaryPath: acmeBin };
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await ctx.runs.shutdown(2000);
  await app.close();
  ctx.close();
  cleanup();
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });

/** A paired device holding exactly the closure of `scopes`. */
function pair(scopes: readonly DeviceScope[], name = "phone"): { id: string; token: string } {
  const { code } = ctx.devices.startPairing(name, scopes);
  const claimed = ctx.devices.claim(code, name);
  expect(claimed).not.toBeNull();
  return { id: claimed!.device.id, token: claimed!.token };
}

/** Rows whose count a refused call must not change. */
function fingerprint(): string {
  const count = (table: string) =>
    (ctx.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
  return JSON.stringify(
    ["runs", "approvals", "notifications", "devices", "sessions", "run_events"].map(count),
  );
}

const settingsFile = () => path.join(ctx.paths.config, "settings.json");

const apiRoutes = () => app.apiRoutes.filter((r) => r.config.public !== true);
const key = (r: { method: string; url: string }) => `${r.method} ${r.url}`;
/** A URL for a route with placeholders filled; the gate answers before any handler reads them. */
const urlOf = (route: string) => `/api/v1/${route.slice("/api/".length).replace(/:\w+/g, "x")}`;
const STREAMS = ["GET /api/events", "GET /api/runs/:id/stream"];

describe("S1 each route says who may call it", () => {
  it("C1 an empty device is refused on every route and nothing changes", async () => {
    const device = pair([]);
    expect(ctx.devices.get(device.id)?.scopes).toEqual([]);
    const routes = apiRoutes();
    expect(routes).toHaveLength(125);
    const before = {
      fp: fingerprint(),
      settings: fs.readFileSync(settingsFile()),
      launches: launches().length,
    };
    let owners = 0;
    let scoped = 0;
    for (const route of routes) {
      const res = await app.inject({
        method: route.method as "GET",
        url: urlOf(route.url),
        headers: as(device.token),
        ...(route.method === "GET" || route.method === "DELETE" ? {} : { payload: {} }),
      });
      const expected = EXPECTED_ROUTE_SCOPES[key(route)];
      const code = expected === "owner" ? "owner_only" : "scope_required";
      expect(res.statusCode, key(route)).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code, key(route)).toBe(code);
      if (expected === "owner") owners += 1;
      else scoped += 1;
    }
    expect([owners, scoped]).toEqual([61, 64]);
    expect(fingerprint()).toBe(before.fp);
    expect(fs.readFileSync(settingsFile()).equals(before.settings)).toBe(true);
    expect(launches()).toHaveLength(before.launches);
  });

  it("C2 each closed set reaches exactly its routes", async () => {
    const sets: Array<{ name: string; scopes: DeviceScope[] }> = [
      { name: "monitor", scopes: ["monitor"] },
      { name: "content", scopes: ["content"] },
      { name: "run", scopes: ["run"] },
      { name: "approve", scopes: ["approve"] },
    ];
    for (const set of sets) {
      const device = pair(set.scopes, set.name);
      const held = new Set<RouteScope>(closeDeviceScopes(set.scopes));
      for (const route of apiRoutes()) {
        const expected = EXPECTED_ROUTE_SCOPES[key(route)]!;
        const reaches = held.has(expected);
        // The two streams would stay open; their allowed half is proved with a ticket (C29).
        if (reaches && STREAMS.includes(key(route))) continue;
        const res = await app.inject({
          method: route.method as "GET",
          url: urlOf(route.url),
          headers: as(device.token),
          ...(route.method === "GET" || route.method === "DELETE" ? {} : { payload: {} }),
        });
        const code = (res.json() as { error?: { code?: string } }).error?.code;
        const refusedByTheGate =
          res.statusCode === 403 && (code === "scope_required" || code === "owner_only");
        expect(refusedByTheGate, `${set.name} ${key(route)} -> ${res.statusCode} ${code}`).toBe(!reaches);
      }
    }
  });

  it("C3 the route table is the expected one", async () => {
    const registered = Object.fromEntries(
      apiRoutes().map((r) => [key(r), r.config.scope as RouteScope | undefined]),
    );
    expect(registered).toEqual(EXPECTED_ROUTE_SCOPES);
    expect(Object.keys(registered)).toHaveLength(125);
    const publics = app.apiRoutes.filter((r) => r.config.public === true).map(key);
    expect(publics.sort()).toEqual([...PUBLIC_ROUTES].sort());
    expect(app.apiRoutes.filter((r) => r.config.public === true && r.config.scope !== undefined)).toEqual([]);
    expect(
      Object.fromEntries(
        (["owner", "monitor", "content", "run", "approve"] as const).map((s) => [s, routesOf(s).length]),
      ),
    ).toEqual({ owner: 61, monitor: 36, content: 21, run: 6, approve: 1 });
    // The route document carries the same scope on every operation that is not public.
    const doc = (
      await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: owner() })
    ).json() as {
      paths: Record<string, Record<string, { "x-mordomo-scope"?: string }>>;
    };
    const documented: Record<string, string | undefined> = {};
    for (const [p, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const route = `${method.toUpperCase()} /api/${p.slice("/api/v1/".length).replace(/\{(\w+)\}/g, ":$1")}`;
        if (!PUBLIC_ROUTES.includes(route)) documented[route] = op["x-mordomo-scope"];
      }
    }
    expect(documented).toEqual(EXPECTED_ROUTE_SCOPES);
  });

  it("C4 a route without a scope does not register", async () => {
    const fresh = await buildServer(ctx);
    try {
      expect(() => fresh.get("/api/zz-open", async () => ({}))).toThrow(
        /GET \/api\/zz-open declares no scope/,
      );
      expect(() => fresh.post("/api/zz-open-too", { config: {} }, async () => ({}))).toThrow(
        /POST \/api\/zz-open-too declares no scope/,
      );
      expect(() => fresh.get("/api/zz-public", { config: { public: true } }, async () => ({}))).not.toThrow();
      expect(() =>
        fresh.get("/api/zz-monitor", { config: { scope: "monitor" } }, async () => ({})),
      ).not.toThrow();
      // Outside /api nothing is asked for (the page and its files).
      expect(() => fresh.get("/zz-page", async () => "page")).not.toThrow();
      // A scope that is missing is the narrowest answer for a device, never "open".
      const all: DeviceScope[] = ["monitor", "content", "run", "approve"];
      expect(deviceVerdict(all, undefined)).toBe("owner_only");
      expect(deviceVerdict(all, "owner")).toBe("owner_only");
      expect(deviceVerdict(["monitor"], "run")).toBe("scope_required");
      expect(deviceVerdict(all, "run")).toBe("ok");
    } finally {
      await fresh.close();
    }
  });

  it("C5 scopes close and a missing column reads as the default", () => {
    const cases: Array<[string[], DeviceScope[]]> = [
      [[], []],
      [["monitor"], ["monitor"]],
      [["content"], ["monitor", "content"]],
      [["run"], ["monitor", "content", "run"]],
      [["approve"], ["monitor", "approve"]],
      [
        ["content", "approve"],
        ["monitor", "content", "approve"],
      ],
      [
        ["approve", "run", "approve", "monitor", "run"],
        ["monitor", "content", "run", "approve"],
      ],
      [["root", "monitor"], ["monitor"]],
    ];
    for (const [input, expected] of cases) expect(closeDeviceScopes(input), input.join()).toEqual(expected);
    expect([...DEVICE_SCOPES]).toEqual(["monitor", "content", "run", "approve"]);
    expect([...DEFAULT_DEVICE_SCOPES]).toEqual(["monitor", "content", "run"]);
    const insert = (id: string, scopes: string | null) =>
      ctx.db
        .prepare(
          "INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, expires_at, revoked_at, scopes) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)",
        )
        .run(id, id, crypto.randomUUID(), Date.now(), scopes);
    insert("old-device", null);
    insert("odd-text", "not json");
    insert("odd-shape", '{"run":true}');
    insert("stale-set", '["run","manage"]');
    expect(ctx.devices.get("old-device")?.scopes).toEqual(["monitor", "content", "run"]);
    expect(ctx.devices.get("odd-text")?.scopes).toEqual([]);
    expect(ctx.devices.get("odd-shape")?.scopes).toEqual([]);
    expect(ctx.devices.get("stale-set")?.scopes).toEqual(["monitor", "content", "run"]);
  });

  it("C6 pairing hands the chosen scopes to the device", async () => {
    const claim = async (payload: unknown) => {
      const start = await app.inject({
        method: "POST",
        url: "/api/v1/pair/start",
        headers: owner(),
        payload,
      });
      expect(start.statusCode).toBe(200);
      const body = start.json() as { code: string; scopes: DeviceScope[] };
      const claimed = await app.inject({
        method: "POST",
        url: "/api/v1/pair/claim",
        payload: { code: body.code, name: "tablet" },
      });
      expect(claimed.statusCode).toBe(200);
      return {
        start: body,
        claimed: claimed.json() as { token: string; device: { id: string; scopes: DeviceScope[] } },
      };
    };
    const chosen = await claim({ scopes: ["approve"] });
    expect(chosen.start.scopes).toEqual(["monitor", "approve"]);
    expect(chosen.claimed.device.scopes).toEqual(["monitor", "approve"]);
    const stored = ctx.db
      .prepare("SELECT scopes FROM devices WHERE id = ?")
      .get(chosen.claimed.device.id) as {
      scopes: string;
    };
    expect(JSON.parse(stored.scopes)).toEqual(["monitor", "approve"]);
    const listed = (await app.inject({ method: "GET", url: "/api/v1/devices", headers: owner() })).json() as {
      devices: Array<{ id: string; scopes: DeviceScope[] }>;
    };
    expect(listed.devices.find((d) => d.id === chosen.claimed.device.id)?.scopes).toEqual([
      "monitor",
      "approve",
    ]);

    const none = await claim({});
    expect(none.claimed.device.scopes).toEqual(["monitor", "content", "run"]);
    const empty = await claim({ scopes: [] });
    expect(empty.claimed.device.scopes).toEqual([]);

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/pair/start",
      headers: owner(),
      payload: { scopes: ["root"] },
    });
    expect(bad.statusCode).toBe(400);
    const device = pair(["run"]);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/pair/start",
      headers: as(device.token),
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as { error: { code: string } }).error.code).toBe("owner_only");
  });

  it("C7 the owner changes the scopes of a paired device", async () => {
    const device = pair(["run"], "laptop");
    const patch = (id: string, payload: unknown, headers = owner()) =>
      app.inject({ method: "PATCH", url: `/api/v1/devices/${id}`, headers, payload });
    const run = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/runs",
        headers: as(device.token),
        payload: { prompt: "hello", mode: "read_only" },
      });
    expect((await run()).statusCode).toBe(200);
    const narrowed = await patch(device.id, { scopes: ["monitor"] });
    expect(narrowed.statusCode).toBe(200);
    expect((narrowed.json() as { id: string; scopes: DeviceScope[] }).scopes).toEqual(["monitor"]);
    const refused = await run();
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as { error: { code: string } }).error.code).toBe("scope_required");
    const widened = await patch(device.id, { scopes: ["run"] });
    expect((widened.json() as { scopes: DeviceScope[] }).scopes).toEqual(["monitor", "content", "run"]);
    expect(ctx.devices.get(device.id)?.scopes).toEqual(["monitor", "content", "run"]);

    expect((await patch(crypto.randomUUID(), { scopes: [] })).statusCode).toBe(404);
    const revoked = pair(["monitor"], "gone");
    ctx.devices.revoke(revoked.id);
    expect((await patch(revoked.id, { scopes: ["run"] })).statusCode).toBe(404);
    expect((await patch(device.id, { scopes: ["x"] })).statusCode).toBe(400);
    expect((await patch(device.id, {})).statusCode).toBe(400);
    expect((await patch(device.id, { scopes: "run" })).statusCode).toBe(400);
    const byDevice = await patch(device.id, { scopes: ["approve"] }, as(device.token));
    expect(byDevice.statusCode).toBe(403);
    expect((byDevice.json() as { error: { code: string } }).error.code).toBe("owner_only");
    expect(ctx.devices.get(device.id)?.scopes).toEqual(["monitor", "content", "run"]);
  });

  it("C8 a revoked or expired device is refused whatever its scopes", async () => {
    const all: DeviceScope[] = ["monitor", "content", "run", "approve"];
    const revoked = pair(all, "revoked");
    const expired = pair(all, "expired");
    ctx.devices.revoke(revoked.id);
    ctx.db.prepare("UPDATE devices SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, expired.id);
    const approval = ctx.approvals.request("tool_use", "Write: x", { runId: crypto.randomUUID() });
    for (const device of [revoked, expired]) {
      const list = await app.inject({ method: "GET", url: "/api/v1/runs", headers: as(device.token) });
      expect(list.statusCode).toBe(401);
      const resolve = await app.inject({
        method: "POST",
        url: `/api/v1/approvals/${approval.id}/resolve`,
        headers: as(device.token),
        payload: { decision: "approved" },
      });
      expect(resolve.statusCode).toBe(401);
    }
    expect(ctx.approvals.get(approval.id)?.status).toBe("pending");
  });

  it("C9 broker and run credentials keep their own route lists", async () => {
    const run = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "held open",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 60_000,
      profile: "review_before_write",
    });
    const broker = ctx.permissionBrokerFor({ id: run.id, permissionProfile: "review_before_write" })!;
    const brokerToken = broker.env.MORDOMO_TOKEN!;
    expect(brokerToken.startsWith("brk_")).toBe(true);
    const reader = ctx.runApiAccessFor(run, "read_only")!.token;
    const writer = ctx.runApiAccessFor(run, "write")!.token;
    const BROKER = ["POST /api/approvals/tool", "GET /api/approvals/:id", "POST /api/approvals/:id/resolve"];
    const READS = [
      "GET /api/memory/recall",
      "GET /api/memory/recall/stats",
      "GET /api/memory/journal",
      "GET /api/memory/facts",
    ];
    const WRITES = ["POST /api/memory/journal/append", "POST /api/memory/facts"];
    const probe = async (credential: string, route: { method: string; url: string }) => {
      const res = await app.inject({
        method: route.method as "GET",
        url: urlOf(route.url),
        headers: as(credential),
        ...(route.method === "GET" || route.method === "DELETE" ? {} : { payload: {} }),
      });
      const code = (res.json() as { error?: { code?: string } }).error?.code;
      return { status: res.statusCode, code };
    };
    const passes = async (credential: string): Promise<string[]> => {
      const out: string[] = [];
      for (const route of apiRoutes()) {
        const r = await probe(credential, route);
        if (!(r.status === 403 && r.code === "forbidden") && r.status !== 401) out.push(key(route));
      }
      return out.sort();
    };
    expect(await passes(brokerToken)).toEqual([...BROKER].sort());
    expect(await passes(reader)).toEqual([...READS].sort());
    expect(await passes(writer)).toEqual([...READS, ...WRITES].sort());
    expect(apiRoutes()).toHaveLength(125);
  });
});

// ---- S2 what a device starts --------------------------------------------------------------------------------

const TERMINAL = new Set(["done", "failed", "cancelled", "timed_out", "interrupted"]);

/** Wait for a run to reach a terminal status (the fake CLIs answer in well under a second). */
async function settle(runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = ctx.runs.get(runId);
    if (run && TERMINAL.has(run.status)) return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not settle`);
}

const post = (url: string, headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: "POST", url, headers, payload: payload as object });
const errorCode = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;

describe("S2 what a device starts is limited", () => {
  it("C10 a device starts a read-only run where reads stay in the workdir", async () => {
    const device = pair(["run"], "starter");
    const before = launches().length;
    const res = await post("/api/v1/runs", as(device.token), {
      prompt: "hello from the phone",
      mode: "read_only",
    });
    expect(res.statusCode).toBe(200);
    const { runId } = res.json() as { runId: string };
    const run = await settle(runId);
    expect(run.startedBy).toBe(`device:${device.id}`);
    expect(launches().length).toBeGreaterThan(before);
    const detail = (
      await app.inject({ method: "GET", url: `/api/v1/runs/${runId}`, headers: as(device.token) })
    ).json() as {
      run: { startedBy: string };
    };
    expect(detail.run.startedBy).toBe(`device:${device.id}`);

    const byOwner = await post("/api/v1/runs", owner(), { prompt: "hello from the desk", mode: "read_only" });
    expect(byOwner.statusCode).toBe(200);
    expect((await settle((byOwner.json() as { runId: string }).runId)).startedBy).toBe("owner");
  });

  it("C11 a device cannot start a run on a provider that reads the whole disk", async () => {
    // The skill every provider here supports, and one finished run (with its conversation) per provider to repeat.
    const made = await post("/api/v1/skills", owner(), {
      frontmatter: {
        name: "Probe",
        slug: "device-probe",
        description: "probe",
        providers: ["claude", "cursor", "codex", "acme"],
      },
      body: "Say hello.",
    });
    expect(made.statusCode).toBe(200);
    const device = pair(["run"], "refused");
    const sources: Record<string, { runId: string; sessionId: string }> = {};
    for (const provider of ["codex", "cursor", "acme"]) {
      const res = await post("/api/v1/runs", owner(), {
        prompt: `seed ${provider}`,
        provider,
        mode: "read_only",
      });
      expect(res.statusCode, provider).toBe(200);
      sources[provider] = res.json() as { runId: string; sessionId: string };
      await settle(sources[provider]!.runId);
    }
    const before = { fp: fingerprint(), launches: launches().length };
    for (const provider of ["codex", "cursor", "acme"]) {
      const source = sources[provider]!;
      const attempts: Array<[string, unknown]> = [
        ["/api/v1/runs", { prompt: "go", provider, mode: "read_only" }],
        [`/api/v1/runs/${source.runId}/children`, { prompts: ["go"], provider, mode: "read_only" }],
        [`/api/v1/runs/${source.runId}/retry`, { submissionId: crypto.randomUUID() }],
        [`/api/v1/sessions/${source.sessionId}/continue`, { prompt: "go on" }],
        ["/api/v1/skills/device-probe/run", { provider }],
      ];
      for (const [url, payload] of attempts) {
        const res = await post(url, as(device.token), payload);
        expect(res.statusCode, `${provider} ${url}`).toBe(403);
        expect(errorCode(res), `${provider} ${url}`).toBe("device_provider_refused");
      }
    }
    expect(fingerprint()).toBe(before.fp);
    expect(launches()).toHaveLength(before.launches);
    // The same calls by the owner are accepted: the refusal is about who asks.
    const owned = await post("/api/v1/skills/device-probe/run", owner(), { provider: "codex" });
    expect(owned.statusCode).toBe(200);
    await settle((owned.json() as { runId: string }).runId);
  });

  it("C12 the engine enforces the device limits itself", async () => {
    const make = (provider: string, startedBy?: string | null) =>
      ctx.runs.create({
        origin: "manual",
        provider,
        prompt: "direct",
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 60_000,
        profile: "read_only",
        ...(startedBy !== undefined ? { startedBy } : {}),
      });
    for (const provider of ["codex", "cursor", "acme", "ghost"]) {
      let thrown: unknown;
      try {
        make(provider, "device:x");
      } catch (err) {
        thrown = err;
      }
      expect(thrown, provider).toMatchObject({ statusCode: 403, code: "device_provider_refused" });
      for (const by of ["owner", null, undefined]) {
        if (provider === "ghost") continue;
        expect(make(provider, by).startedBy, `${provider} ${String(by)}`).toBe(by ?? null);
      }
    }
    expect(make("claude", "device:x").startedBy).toBe("device:x");

    // A write asked by a device waits for a human even where the profile would let the owner write at once.
    ctx.settingsStore.update({ securityProfile: "controlled_write" });
    const input = (startedBy: string | null) => ({
      kind: "prompt" as const,
      input: {
        prompt: "change it",
        provider: "claude",
        model: null,
        effort: "default" as const,
        mode: "write" as const,
        cwd: ctx.paths.home,
        timeoutMs: 60_000,
        startedBy,
      },
    });
    const parked = ctx.gateWrite("write", "manual", "device write", input("device:x"));
    expect(parked.pendingApproval).toMatchObject({
      kind: "write_run",
      status: "pending",
      requestedBy: "device:x",
    });
    expect(ctx.runs.get(parked.runId!)).toMatchObject({ status: "waiting_approval", startedBy: "device:x" });
    for (const by of ["owner", null]) {
      expect(ctx.gateWrite("write", "manual", "owner write", input(by))).toEqual({
        pendingApproval: null,
        runId: null,
      });
    }
    ctx.settingsStore.update({ securityProfile: "review_before_write" });
  });

  it("C13 a write asked by a device waits for a human in every profile", async () => {
    const device = pair(["run"], "writer");
    for (const profile of ["review_before_write", "controlled_write", "approved_automation"] as const) {
      ctx.settingsStore.update({ securityProfile: profile });
      const before = launches().length;
      const res = await post("/api/v1/runs", as(device.token), {
        prompt: `change a file under ${profile}`,
        mode: "write",
      });
      expect(res.statusCode, profile).toBe(202);
      const body = res.json() as {
        status: string;
        runId: string;
        pendingApproval: { kind: string; requestedBy: string; status: string };
      };
      expect(body.status, profile).toBe("waiting_approval");
      expect(body.pendingApproval, profile).toMatchObject({
        kind: "write_run",
        status: "pending",
        requestedBy: `device:${device.id}`,
      });
      const run = ctx.runs.get(body.runId)!;
      expect(run.status, profile).toBe("waiting_approval");
      expect(run.startedAt, profile).toBeNull();
      expect(run.startedBy, profile).toBe(`device:${device.id}`);
      expect(launches(), profile).toHaveLength(before);
    }
    // The same wait for the other ways to ask for a write: a skill that writes, and the repeat of a run of the owner's.
    ctx.settingsStore.update({ securityProfile: "controlled_write" });
    const writer = await post("/api/v1/skills", owner(), {
      frontmatter: {
        name: "Writer",
        slug: "device-writer",
        description: "writes",
        mode: "write",
        providers: ["claude"],
      },
      body: "Write a note.",
    });
    expect(writer.statusCode).toBe(200);
    const beforeSkills = launches().length;
    const bySkill = await post("/api/v1/skills/device-writer/run", as(device.token), { provider: "claude" });
    expect(bySkill.statusCode).toBe(202);
    expect(
      (bySkill.json() as { pendingApproval: { kind: string; requestedBy: string } }).pendingApproval,
    ).toMatchObject({
      kind: "write_run",
      requestedBy: `device:${device.id}`,
    });
    const ownersWrite = await post("/api/v1/runs", owner(), { prompt: "owner writes", mode: "write" });
    expect(ownersWrite.statusCode).toBe(200);
    const ownersRunId = (ownersWrite.json() as { runId: string }).runId;
    await settle(ownersRunId);
    const repeated = await post(`/api/v1/runs/${ownersRunId}/retry`, as(device.token), {
      submissionId: crypto.randomUUID(),
    });
    expect(repeated.statusCode).toBe(202);
    expect(
      (repeated.json() as { pendingApproval: { requestedBy: string } }).pendingApproval.requestedBy,
    ).toBe(`device:${device.id}`);
    // Nothing started for the device: the only launch since is the owner's own run.
    expect(launches()).toHaveLength(beforeSkills + 1);

    ctx.settingsStore.update({ securityProfile: "read_only" });
    const before = { fp: fingerprint(), launches: launches().length };
    const refused = await post("/api/v1/runs", as(device.token), { prompt: "change a file", mode: "write" });
    expect(refused.statusCode).toBe(403);
    expect(errorCode(refused)).toBe("profile_refused");
    expect(fingerprint()).toBe(before.fp);
    expect(launches()).toHaveLength(before.launches);
    ctx.settingsStore.update({ securityProfile: "review_before_write" });
  });

  it("C14 the owner approval launches the parked run", async () => {
    const device = pair(["run"], "asker");
    const asked = await post("/api/v1/runs", as(device.token), { prompt: "write a note", mode: "write" });
    expect(asked.statusCode).toBe(202);
    const { runId, pendingApproval } = asked.json() as { runId: string; pendingApproval: { id: string } };
    const before = launches().length;
    const approved = await post(`/api/v1/approvals/${pendingApproval.id}/resolve`, owner(), {
      decision: "approved",
    });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { resolvedBy: string }).resolvedBy).toBe("owner");
    const run = await settle(runId);
    expect(run.startedBy).toBe(`device:${device.id}`);
    expect(launches()).toHaveLength(before + 1);
    const again = await post(`/api/v1/approvals/${pendingApproval.id}/resolve`, owner(), {
      decision: "approved",
    });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe("approval_resolved");
    expect(launches()).toHaveLength(before + 1);
  });

  it("C15 who started a run is recorded only for requests", async () => {
    // A routine fired by hand, a sentinel's triage run and an engine call without the field: nobody asked.
    const routine = await post("/api/v1/routines", owner(), {
      id: "started-by-probe",
      name: "Probe",
      prompt: "say hello",
      kind: "every",
      every: { value: 30, unit: "minutes" },
      provider: "claude",
    });
    expect(routine.statusCode).toBe(200);
    const fired = await post("/api/v1/routines/started-by-probe/run", owner(), {});
    expect(fired.statusCode).toBe(200);
    const routineRun = ctx.runs.list({ limit: 200 }).find((r) => r.routineId === "started-by-probe")!;
    expect((await settle(routineRun.id)).startedBy).toBeNull();

    const settings = ctx.settings();
    settings.sentinels.triage.enabled = true;
    settings.sentinels.triage.dailyBudgetUsd = 5;
    ctx.settingsStore.save(settings);
    const triage = await triageSentinel(
      {
        db: ctx.db,
        bus: new EventBus(),
        runs: ctx.runs,
        notifications: ctx.notifications,
        getSettings: () => ctx.settings(),
        cwd: ctx.paths.home,
      },
      { sentinel: "repeatedFailure", severity: "warn", title: "t", body: "b", triage: true },
    );
    expect(triage.runId).toBeTruthy();
    expect(ctx.runs.get(triage.runId!)).toMatchObject({ origin: "sentinel", startedBy: null });

    const direct = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "direct",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
    });
    expect(direct.startedBy).toBeNull();

    // The routes that start a run record the owner token as `owner` (the device case is C10).
    const skillByOwner = await post("/api/v1/skills/device-probe/run", owner(), { provider: "claude" });
    expect((await settle((skillByOwner.json() as { runId: string }).runId)).startedBy).toBe("owner");
    const promptByOwner = await post("/api/v1/runs", owner(), { prompt: "owner prompt" });
    const owned = await settle((promptByOwner.json() as { runId: string }).runId);
    expect(owned.startedBy).toBe("owner");
    const repeated = await post(`/api/v1/runs/${owned.id}/retry`, owner(), {
      submissionId: crypto.randomUUID(),
    });
    expect((await settle((repeated.json() as { runId: string }).runId)).startedBy).toBe("owner");
    const sessionRun = await post(`/api/v1/sessions/${owned.sessionId}/continue`, owner(), {
      prompt: "more",
    });
    expect((await settle((sessionRun.json() as { runId: string }).runId)).startedBy).toBe("owner");
    const children = await post(`/api/v1/runs/${owned.id}/children`, owner(), { prompts: ["child"] });
    const childId = ((children.json() as { runs?: Array<{ runId: string }> }).runs ?? [])[0]?.runId;
    expect(childId).toBeTruthy();
    expect((await settle(childId!)).startedBy).toBe("owner");
  });
});

// ---- S3 who asked does not approve ---------------------------------------------------------------------------

/** A write asked by `device`: the run parked and its approval. */
async function askForWrite(device: { token: string }, prompt = "write something") {
  const res = await post("/api/v1/runs", as(device.token), { prompt, mode: "write" });
  expect(res.statusCode).toBe(202);
  const body = res.json() as { runId: string; pendingApproval: { id: string } };
  return { runId: body.runId, approvalId: body.pendingApproval.id };
}
const resolve = (approvalId: string, headers: Record<string, string>, decision: "approved" | "denied") =>
  post(`/api/v1/approvals/${approvalId}/resolve`, headers, { decision });

describe("S3 who asked does not approve", () => {
  it("C17 a device cannot approve what it asked for", async () => {
    const device = pair(["run", "approve"], "self");
    const { runId, approvalId } = await askForWrite(device);
    const before = launches().length;
    const res = await resolve(approvalId, as(device.token), "approved");
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe("self_approval");
    expect(ctx.approvals.get(approvalId)).toMatchObject({ status: "pending", resolvedBy: null });
    expect(ctx.runs.get(runId)?.status).toBe("waiting_approval");
    expect(launches()).toHaveLength(before);
  });

  it("C18 a device may deny what it asked for", async () => {
    const device = pair(["run", "approve"], "changed mind");
    const { runId, approvalId } = await askForWrite(device);
    const res = await resolve(approvalId, as(device.token), "denied");
    expect(res.statusCode).toBe(200);
    expect(ctx.approvals.get(approvalId)).toMatchObject({
      status: "denied",
      resolvedBy: `device:${device.id}`,
    });
    expect(ctx.runs.get(runId)?.status).toBe("cancelled");
  });

  it("C19 another principal approves what a device asked for", async () => {
    const asker = pair(["run"], "asker");
    const approver = pair(["approve"], "second device");
    const bystander = pair(["run"], "bystander");
    const approvedBy = async (decide: (id: string) => Promise<{ statusCode: number }>) => {
      const { approvalId } = await askForWrite(asker);
      const res = await decide(approvalId);
      expect(res.statusCode).toBe(200);
      expect(ctx.approvals.get(approvalId)).toMatchObject({
        status: "approved",
        requestedBy: `device:${asker.id}`,
      });
      return ctx.approvals.get(approvalId)!.resolvedBy;
    };
    expect(await approvedBy((id) => resolve(id, owner(), "approved"))).toBe("owner");
    expect(await approvedBy((id) => resolve(id, as(approver.token), "approved"))).toBe(
      `device:${approver.id}`,
    );
    expect(
      await approvedBy(async (id) => {
        // The Telegram poller resolves through this function with the sender's id.
        const done = await resolveApprovalForChat(ctx, id, "approved", "telegram:42");
        return { statusCode: done.ok ? 200 : 500 };
      }),
    ).toBe("telegram:42");

    const { approvalId } = await askForWrite(asker);
    const nope = await resolve(approvalId, as(bystander.token), "approved");
    expect(nope.statusCode).toBe(403);
    expect(errorCode(nope)).toBe("scope_required");
    expect(ctx.approvals.get(approvalId)?.status).toBe("pending");
    expect((await resolve(crypto.randomUUID(), as(approver.token), "approved")).statusCode).toBe(404);
    // What the other principals decided is visible on the approval.
    const shown = (
      await app.inject({ method: "GET", url: `/api/v1/approvals/${approvalId}`, headers: owner() })
    ).json() as {
      requestedBy: string;
    };
    expect(shown.requestedBy).toBe(`device:${asker.id}`);
  });

  it("C20 a device approves only the kinds it may", async () => {
    const device = pair(["approve"], "approver");
    const kinds: ApprovalKind[] = [
      "write_run",
      "tool_use",
      "install_software",
      "change_global_config",
      "destructive_command",
      "access_new_folder",
      "connector_write",
      "create_startup_service",
      "expose_port",
      "send_external_data",
      "overwrite_existing_config",
    ];
    const allowed = new Set<ApprovalKind>(["write_run", "tool_use"]);
    const settingsBefore = fs.readFileSync(settingsFile());
    for (const kind of kinds) {
      const approval = ctx.approvals.request(kind, `a ${kind} request`, { bindAddress: "0.0.0.0" }, null);
      const res = await resolve(approval.id, as(device.token), "approved");
      if (allowed.has(kind)) {
        expect(res.statusCode, kind).toBe(200);
        expect(ctx.approvals.get(approval.id)?.status, kind).toBe("approved");
      } else {
        expect(res.statusCode, kind).toBe(403);
        expect(errorCode(res), kind).toBe("owner_only");
        expect(ctx.approvals.get(approval.id)?.status, kind).toBe("pending");
      }
      const other = ctx.approvals.request(kind, `another ${kind} request`, {}, null);
      expect((await resolve(other.id, as(device.token), "denied")).statusCode, `deny ${kind}`).toBe(200);
      expect(ctx.approvals.get(other.id)?.status, `deny ${kind}`).toBe("denied");
    }
    // `expose_port` approved by the owner would have moved the bind address; the device did not.
    expect(fs.readFileSync(settingsFile()).equals(settingsBefore)).toBe(true);
  });

  it("C21 the broker approval of a device run is the device's own request", async () => {
    const device = pair(["run", "approve"], "runner");
    const startRun = (startedBy: string) =>
      ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "approved write run",
        cwd: ctx.paths.home,
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 60_000,
        profile: "review_before_write",
        startedBy,
      });
    const toolApproval = async (runId: string, brokerToken: string) => {
      const res = await post("/api/v1/approvals/tool", as(brokerToken), {
        runId,
        toolName: "Bash",
        input: { command: "ls" },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { id: string }).id;
    };
    const run = startRun(`device:${device.id}`);
    const brokerToken = ctx.permissionBrokerFor({ id: run.id, permissionProfile: "review_before_write" })!.env
      .MORDOMO_TOKEN!;
    const approvalId = await toolApproval(run.id, brokerToken);
    expect(ctx.approvals.get(approvalId)).toMatchObject({
      kind: "tool_use",
      requestedBy: `device:${device.id}`,
    });
    const self = await resolve(approvalId, as(device.token), "approved");
    expect(self.statusCode).toBe(403);
    expect(errorCode(self)).toBe("self_approval");
    // AD-002 still holds: the broker cannot approve, only give up on its own prompt.
    const brokerApproves = await resolve(approvalId, as(brokerToken), "approved");
    expect(brokerApproves.statusCode).toBe(403);
    expect(errorCode(brokerApproves)).toBe("forbidden");
    expect(ctx.approvals.get(approvalId)?.status).toBe("pending");
    const brokerDenies = await resolve(approvalId, as(brokerToken), "denied");
    expect(brokerDenies.statusCode).toBe(200);
    expect(ctx.approvals.get(approvalId)).toMatchObject({ status: "denied", resolvedBy: `broker:${run.id}` });

    const ownersRun = startRun("owner");
    const ownersBroker = ctx.permissionBrokerFor({
      id: ownersRun.id,
      permissionProfile: "review_before_write",
    })!.env.MORDOMO_TOKEN!;
    const ownersApproval = await toolApproval(ownersRun.id, ownersBroker);
    expect(ctx.approvals.get(ownersApproval)?.requestedBy).toBe("owner");
    expect((await resolve(ownersApproval, as(device.token), "approved")).statusCode).toBe(200);
  });

  it("C22 old rows read back without the new facts", () => {
    const tmp = makeTempHome("mordomo-scopes-old-");
    try {
      const target = MIGRATIONS.find((m) => m.name === "device-scopes-and-who-asked")!.version;
      expect(target).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
      const raw = new Database(tmp.paths.dbFile);
      for (const m of MIGRATIONS.filter((x) => x.version < target)) {
        if (m.sql) raw.exec(m.sql);
        m.up?.(raw);
      }
      raw.pragma(`user_version = ${target - 1}`);
      const columns = (table: string) =>
        (raw.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);
      expect(columns("devices")).not.toContain("scopes");
      expect(columns("approvals")).not.toContain("requested_by");
      expect(columns("runs")).not.toContain("started_by");
      raw
        .prepare(
          "INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, expires_at, revoked_at) VALUES ('old-phone', 'old phone', 'h', 1, 2, NULL, NULL)",
        )
        .run();
      raw
        .prepare(
          "INSERT INTO approvals (id, created_at, kind, description, payload, status, resolved_at, resolved_by) VALUES ('old-approval', 10, 'write_run', 'old', '{}', 'approved', 11, 'device:old-phone')",
        )
        .run();
      raw
        .prepare(
          "INSERT INTO runs (id, created_at, origin, provider, effort, status, prompt_summary) VALUES ('old-run', 20, 'manual', 'claude', 'default', 'done', 'old')",
        )
        .run();
      raw.close();

      const migrated = new AppContext(tmp.paths.home);
      try {
        const info = (table: string) =>
          (migrated.db.pragma(`table_info(${table})`) as Array<{ name: string; notnull: number }>).find((c) =>
            ["scopes", "requested_by", "started_by"].includes(c.name),
          );
        expect(info("devices")).toMatchObject({ name: "scopes", notnull: 0 });
        expect(info("approvals")).toMatchObject({ name: "requested_by", notnull: 0 });
        expect(info("runs")).toMatchObject({ name: "started_by", notnull: 0 });
        expect(migrated.devices.get("old-phone")).toMatchObject({
          name: "old phone",
          lastSeenAt: 2,
          scopes: ["monitor", "content", "run"],
        });
        expect(migrated.approvals.get("old-approval")).toMatchObject({
          status: "approved",
          resolvedBy: "device:old-phone",
          requestedBy: null,
        });
        expect(migrated.runs.get("old-run")).toMatchObject({
          status: "done",
          promptSummary: "old",
          startedBy: null,
        });
      } finally {
        migrated.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
});

// ---- the page and the document --------------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

describe("S6 the documents say the same as the router", () => {
  it("C39 docs list every route with its scope and say what stays open", () => {
    const page = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    // The table: one row per scope, the routes of the scope in backticks.
    const documented: Record<string, string> = {};
    const counts: Record<string, number> = {};
    for (const row of page
      .split("\n")
      .filter((l) => /^\| `(owner|monitor|content|run|approve)` \(\d+\) \|/.test(l))) {
      const scope = /^\| `(\w+)` \((\d+)\) \| .*? \| (.*) \|$/.exec(row)!;
      counts[scope[1]!] = Number(scope[2]);
      // Only the third cell lists routes; the second may mention a few in passing.
      for (const m of scope[3]!.matchAll(/`((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^`]+)`/g)) {
        expect(documented[m[1]!], `${m[1]} appears twice`).toBeUndefined();
        documented[m[1]!] = scope[1]!;
      }
    }
    expect(documented).toEqual(EXPECTED_ROUTE_SCOPES);
    expect(counts).toEqual({ owner: 61, monitor: 36, content: 21, run: 6, approve: 1 });
    // What this feature leaves open is written down, one phrase each.
    const open: Array<[string, string]> = [
      [
        "the page carries the token to a look-alike browser",
        "The page only carries the token to a browser on this machine",
      ],
      ["the design that was not built", "The design is known and was not built"],
      ["the device token in the URL of the two file routes", "the device token is in those URLs"],
      ["rc_ and brk_ in the process environment", "in the environment of the process they were handed to"],
      ["the address shared behind a tunnel", "every remote client shares the address `127.0.0.1`"],
      ["the approval from before requestedBy", "an approval raised before `requestedBy` existed"],
      ["monitor shows run transcripts", "`monitor` shows what the owner's runs printed"],
      ["Claude's workdir is documentation", "no CLI binary was run to verify it here"],
    ];
    for (const [what, phrase] of open) expect(page.replace(/\s+/g, " "), what).toContain(phrase);
  });

  it("C43 the route document knows the new routes and the ticket", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: owner() });
    const doc = res.json() as {
      info: { description: string };
      paths: Record<
        string,
        Record<string, { security: Array<Record<string, unknown>>; "x-mordomo-scope"?: string }>
      >;
      components: { securitySchemes: Record<string, unknown> };
    };
    const operations = Object.values(doc.paths).reduce((n, methods) => n + Object.keys(methods).length, 0);
    expect(operations).toBe(app.apiRoutes.length);
    expect(operations).toBe(127);
    expect(doc.paths["/api/v1/stream-tickets"]!.post!["x-mordomo-scope"]).toBe("monitor");
    expect(doc.paths["/api/v1/devices/{id}"]!.patch!["x-mordomo-scope"]).toBe("owner");
    expect(doc.paths["/api/v1/devices/{id}"]!.patch!.security).toEqual([{ localToken: [] }]);
    const withTicket = (p: string) => doc.paths[p]!.get!.security.map((s) => Object.keys(s)[0]);
    expect(withTicket("/api/v1/events")).toEqual(["localToken", "queryToken", "streamTicket"]);
    expect(withTicket("/api/v1/runs/{id}/stream")).toEqual(["localToken", "queryToken", "streamTicket"]);
    expect(withTicket("/api/v1/artifacts/raw")).toEqual(["localToken", "queryToken"]);
    expect(withTicket("/api/v1/runs")).toEqual(["localToken"]);
    expect(doc.components.securitySchemes.streamTicket).toEqual({
      type: "apiKey",
      in: "query",
      name: "ticket",
    });
    for (const word of ["monitor", "content", "run", "approve", "owner", "stream-tickets"]) {
      expect(doc.info.description, word).toContain(word);
    }
  });
});

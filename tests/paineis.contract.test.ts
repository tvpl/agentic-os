// The reviewDue sentinel's "once a day" and the reminders' local day (C64) are local days (AD-043 b, L-053): pinned
// away from UTC before any date is built.
process.env.TZ = "America/Sao_Paulo";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  API,
  EVENT_ENVELOPES,
  EVENT_SCHEMAS,
  EVENT_VERSIONS,
  checkBody,
  routeKey,
  type RouteDefinition,
} from "@mordomo/contracts";
import type * as client from "../core/src/connectors/client.js";
import { ConnectorDataCache } from "../core/src/connectors/client.js";
import type { OsEvent } from "../core/src/events.js";
import { SCENARIOS, buildWorld } from "./helpers/contractWorld.js";
import { movingClock } from "./helpers/movingClock.js";
import { sha } from "./helpers/notesViewWorld.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";

/**
 * .specs/features/cerebro-paineis, the contract: what the event registry and its document say (C18, batch A), and the
 * API's cross-cutting checks of batch C: the eight routes in the table and the document (C58), who may call them
 * (C59), docs/security.md (C60), the privacy text and the network policy (C62), what a snapshot keeps of a connector
 * (C63) and what the earlier features answer as before (C64). The walker and module-state halves of C61 are in
 * tests/security-reads.test.ts and tests/sdk.instances.test.ts; the refusal probe's half of C59 in
 * tests/api.refusals.test.ts.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const repoRoot = path.resolve(import.meta.dirname, "..");
/** The feature's base: the commit before batch A. */
const FEATURE_BASE = "16e6976";
const atBase = (file: string) =>
  execFileSync("git", ["show", `${FEATURE_BASE}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
/** Friday 2026-10-30, 12:00 in São Paulo. */
const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const code = (r: { status: number; body: Json }) => [r.status, r.body?.error?.code];

describe("C64 the zone of this file", () => {
  it("C64 runs in São Paulo, where the local day and the UTC day differ at 23:30", () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(2026, 9, 30, 23, 30).getUTCDate()).toBe(31);
  });
});

/** The 28 event types before this feature, each at version 1 (the registry at `4537fb2`). */
const BEFORE = [
  "run.created",
  "run.started",
  "run.event",
  "run.finished",
  "routine.fired",
  "routine.alert",
  "routine.changed",
  "index.started",
  "index.progress",
  "index.finished",
  "index.failed",
  "index.cancelled",
  "cleanup.progress",
  "cleanup.finished",
  "cleanup.failed",
  "approval.requested",
  "approval.resolved",
  "approval.expired",
  "session.created",
  "session.updated",
  "objective.changed",
  "settings.changed",
  "backup.created",
  "notification.created",
  "notification.read",
  "budget.crossed",
  "sentinel.fired",
  "stream.reset",
];

describe("C18 dashboard.refreshed in the event contract", () => {
  it("C18 is version 1 only, its v1 schema takes ok, partial and error and refuses done and a missing id, its fixture parses, the document lists it, and the 28 of before keep [1]", () => {
    expect(EVENT_VERSIONS["dashboard.refreshed"]).toEqual([1]);
    const schema = EVENT_SCHEMAS["dashboard.refreshed"][1]!;
    const payload = { id: "visao-geral", generatedAt: 1_793_400_000_000, status: "ok" };
    for (const status of ["ok", "partial", "error"])
      expect(schema.safeParse({ ...payload, status }).success, status).toBe(true);
    expect(schema.safeParse({ ...payload, status: "done" }).success).toBe(false);
    const { id: _id, ...noId } = payload;
    expect(schema.safeParse(noId).success).toBe(false);

    const fixture = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tests/fixtures/events/v1/dashboard.refreshed.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(fixture).toMatchObject({ type: "dashboard.refreshed", v: 1 });
    const envelope = EVENT_ENVELOPES.find((e) => e.type === "dashboard.refreshed" && e.v === 1)!;
    expect(checkBody(envelope.schema, fixture)).toEqual([]);

    const doc = fs.readFileSync(path.join(repoRoot, "docs/events.md"), "utf8");
    expect(doc).toContain("### `dashboard.refreshed`");

    expect({ ...EVENT_VERSIONS }).toEqual({
      ...Object.fromEntries(BEFORE.map((type) => [type, [1]])),
      "dashboard.refreshed": [1],
    });
  });
});

// ---- C58-C60: the eight routes in the table, the document and docs/security.md -------------------------------

/** The eight routes of the Surface, with the scope of door 6 and the named errors C58 lists. */
const ROUTES = [
  {
    id: "dashboards.list",
    method: "GET",
    path: "/api/dashboards",
    scope: "content",
    statuses: [200],
    errors: [] as string[],
  },
  {
    id: "dashboards.create",
    method: "POST",
    path: "/api/dashboards",
    scope: "owner",
    statuses: [201],
    errors: ["404 context_not_found", "409 dashboard_exists"],
  },
  {
    id: "dashboards.get",
    method: "GET",
    path: "/api/dashboards/:id",
    scope: "content",
    statuses: [200],
    errors: ["404 dashboard_not_found"],
  },
  {
    id: "dashboards.update",
    method: "PUT",
    path: "/api/dashboards/:id",
    scope: "owner",
    statuses: [200],
    errors: ["404 dashboard_not_found", "409 edit_conflict"],
  },
  {
    id: "dashboards.delete",
    method: "DELETE",
    path: "/api/dashboards/:id",
    scope: "owner",
    statuses: [200],
    errors: ["404 dashboard_not_found"],
  },
  {
    id: "dashboards.refresh",
    method: "POST",
    path: "/api/dashboards/:id/refresh",
    scope: "owner",
    statuses: [200, 202],
    errors: [
      "404 dashboard_not_found",
      "409 refresh_in_progress",
      "409 skill_unavailable",
      "409 budget_exhausted",
    ],
  },
  {
    id: "dashboards.export",
    method: "POST",
    path: "/api/dashboards/:id/export",
    scope: "owner",
    statuses: [200],
    errors: ["404 dashboard_not_found", "409 no_snapshot"],
  },
  {
    id: "memory.tasks.save",
    method: "PUT",
    path: "/api/memory/tasks",
    scope: "owner",
    statuses: [200],
    errors: [
      "403 forbidden_path",
      "403 note_not_editable",
      "404 note_missing",
      "404 not_a_file",
      "409 edit_conflict",
      "413 note_too_large",
    ],
  },
] as const;
const KEYS = ROUTES.map((r) => `${r.method} ${r.path}`);
const READS = ROUTES.filter((r) => r.method === "GET");
const WRITES = ROUTES.filter((r) => r.method !== "GET");
const entryOf = (id: string) => API[id as keyof typeof API] as RouteDefinition;
const ownCodes = (entry: RouteDefinition) => (entry.errors ?? []).map((e) => `${e.status} ${e.code}`).sort();

/** One world for the routes' calls, with the calendar read faked (no connector process starts). */
let w: PaineisWorld;
let clock: ReturnType<typeof movingClock>;
beforeAll(async () => {
  clock = movingClock(NOW);
  w = await paineisWorld("mordomo-paineis-contract-");
  fakeConnectorFetch(calendarItems(NOW));
}, 60_000);
afterAll(async () => {
  await w?.close();
  clock.restore();
});
afterEach(() => {
  clock.set(NOW);
  fakeConnectorFetch(calendarItems(NOW));
});

let seq = 0;
const noteFile = (name: string) => path.join(w.memory, "notes", "contrato", `${name}-${++seq}.md`);

describe("C58 the eight routes in the API table and the document", () => {
  it("C58 the API table has the eight routes with method, path, scope and named errors, the document has the eight paths with x-mordomo-scope and the codes, and each answers under /api/v1/ the same as under /api/", async () => {
    // The table: these eight and, under /api/dashboards, no other.
    const dashboardEntries = (Object.entries(API) as Array<[string, RouteDefinition]>)
      .filter(([, e]) => e.path === "/api/dashboards" || e.path.startsWith("/api/dashboards/"))
      .map(([id]) => id)
      .sort();
    expect(dashboardEntries).toEqual(
      ROUTES.filter((r) => r.id.startsWith("dashboards."))
        .map((r) => r.id)
        .sort(),
    );
    for (const want of ROUTES) {
      const entry = entryOf(want.id);
      expect(entry, want.id).toBeDefined();
      expect([entry.method, entry.path, entry.scope], want.id).toEqual([want.method, want.path, want.scope]);
      expect(routeKey(entry)).toBe(`${want.method} ${want.path}`);
      expect(ownCodes(entry), want.id).toEqual([...want.errors].sort());
      expect(Object.keys(entry.responses).map(Number).sort(), want.id).toEqual([...want.statuses]);
      for (const status of want.statuses)
        expect(entry.responses[status], `${want.id} ${status}`).toBeDefined();
    }

    // The document the service serves: the eight operations under /api/v1/, each with its scope and its codes.
    const doc = (await w.call("GET", "/api/openapi.json")).body as Json;
    for (const want of ROUTES) {
      const p = `/api/v1/${want.path.slice("/api/".length).replace(/:(\w+)/g, "{$1}")}`;
      const op = doc.paths[p]?.[want.method.toLowerCase()];
      expect(op, `${want.method} ${p}`).toBeDefined();
      expect([op.operationId, op["x-mordomo-scope"]], want.id).toEqual([want.id, want.scope]);
      for (const status of want.statuses)
        expect(op.responses[String(status)], `${want.id} ${status}`).toBeDefined();
      for (const error of want.errors) {
        const [status, c] = error.split(" ");
        expect(JSON.stringify(op.responses[status!] ?? null), `${want.id} ${error}`).toContain(c!);
      }
    }

    // The two spellings: the same request answers the same in both, and only the alias announces its successor.
    const both = async (method: string, rest: string, payload?: unknown) => {
      const call = async (url: string) => {
        const res = await w.app.inject({
          method: method as "GET",
          url,
          headers: payload === undefined ? { "x-mordomo-token": w.ctx.token() } : w.owner(),
          ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
        });
        return { status: res.statusCode, body: res.json() as Json, headers: res.headers };
      };
      const legacy = await call(`/api/${rest}`);
      const v1 = await call(`/api/v1/${rest}`);
      expect(legacy.headers.deprecation, rest).toBe("true");
      expect(legacy.headers.link, rest).toBe(`</api/v1/${rest.split("?")[0]}>; rel="successor-version"`);
      expect(v1.headers.deprecation, rest).toBeUndefined();
      return [legacy, v1] as const;
    };
    const same = async (method: string, rest: string, payload?: unknown) => {
      const [legacy, v1] = await both(method, rest, payload);
      expect(v1.status, `${method} ${rest}`).toBe(legacy.status);
      expect(v1.body, `${method} ${rest}`).toEqual(legacy.body);
      return legacy;
    };
    const keysOf = (body: Json) => Object.keys(body).sort();

    // GET /api/dashboards and GET /api/dashboards/:id, over a question dashboard (manual: never stale, no refresh).
    const created = await both("POST", "dashboards", { template: "question", question: "Quanto falta?" });
    expect(created.map((r) => r.status)).toEqual([201, 201]);
    expect(created.map((r) => r.body.id)).toEqual(["pergunta", "pergunta-2"]);
    expect(keysOf(created[1].body)).toEqual(keysOf(created[0].body));
    const listed = await same("GET", "dashboards");
    expect(listed.status).toBe(200);
    expect(listed.body.dashboards.map((d: Json) => d.id)).toEqual(
      expect.arrayContaining(["pergunta", "pergunta-2"]),
    );
    const read = await same("GET", "dashboards/pergunta");
    expect([read.status, read.body.snapshot]).toEqual([200, null]);
    expect(code(await same("GET", "dashboards/nao-existe"))).toEqual([404, "dashboard_not_found"]);
    // POST: the refusals the same.
    expect(code(await same("POST", "dashboards", { template: "area", contextId: "nao-existe" }))).toEqual([
      404,
      "context_not_found",
    ]);
    // PUT: the same bytes again keep the version, so the same request answers the same twice.
    const put = await same("PUT", "dashboards/pergunta", {
      definition: read.body.definition,
      baseVersion: read.body.version,
    });
    expect([put.status, put.body.version]).toEqual([200, read.body.version]);
    expect(
      code(
        await same("PUT", "dashboards/pergunta", {
          definition: read.body.definition,
          baseVersion: `sha256:${"0".repeat(64)}`,
        }),
      ),
    ).toEqual([409, "edit_conflict"]);
    // refresh: a home without the skill refuses the question in both; an overview answers its snapshot in both.
    expect(code(await same("POST", "dashboards/pergunta/refresh", {}))).toEqual([409, "skill_unavailable"]);
    expect(code(await same("POST", "dashboards/nao-existe/refresh", {}))).toEqual([
      404,
      "dashboard_not_found",
    ]);
    const overview = (await w.create({ template: "overview" })).body.id as string;
    // export before any snapshot: 409 in both.
    expect(code(await same("POST", `dashboards/${overview}/export`, {}))).toEqual([409, "no_snapshot"]);
    const refreshed = await both("POST", `dashboards/${overview}/refresh`, {});
    expect(refreshed.map((r) => r.status)).toEqual([200, 200]);
    const widgets = (r: (typeof refreshed)[number]) =>
      r.body.snapshot.widgets.map((x: Json) => [x.id, x.kind, x.status]);
    expect(widgets(refreshed[1])).toEqual(widgets(refreshed[0]));
    expect(widgets(refreshed[0]).length).toBe(10);
    const exported = await both("POST", `dashboards/${overview}/export`, {});
    expect(exported.map((r) => r.status)).toEqual([200, 200]);
    for (const r of exported)
      expect(r.body.path).toMatch(/artifacts[\\/]dashboards[\\/]visao-geral-.*\.html$/);
    // DELETE: each spelling archives one of the two question dashboards; a missing one is 404 in both.
    const deleted = await Promise.all([
      w.app.inject({
        method: "DELETE",
        url: "/api/dashboards/pergunta",
        headers: { "x-mordomo-token": w.ctx.token() },
      }),
      w.app.inject({
        method: "DELETE",
        url: "/api/v1/dashboards/pergunta-2",
        headers: { "x-mordomo-token": w.ctx.token() },
      }),
    ]);
    expect(deleted.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(deleted.map((r) => keysOf(r.json()))).toEqual([["archived"], ["archived"]]);
    expect(code(await same("DELETE", "dashboards/pergunta"))).toEqual([404, "dashboard_not_found"]);
    // PUT /api/memory/tasks: a box already as asked answers the same; a file outside memory/ is refused the same.
    const file = noteFile("tarefa");
    w.put(file, "# Tarefa\n\n- [ ] Mandar a proposta\n");
    const checked = await w.call("PUT", "/api/memory/tasks", {
      path: file,
      line: 3,
      done: true,
      baseVersion: sha(fs.readFileSync(file)),
    });
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    const again = await same("PUT", "memory/tasks", {
      path: file,
      line: 3,
      done: true,
      baseVersion: checked.body.version,
    });
    expect(again.body).toEqual(checked.body);
    const outside = w.put(path.join(w.indexedRoot("tarefa"), "fora.md"), "- [ ] Fora\n");
    expect(
      code(
        await same("PUT", "memory/tasks", {
          path: outside,
          line: 1,
          done: true,
          baseVersion: sha(fs.readFileSync(outside)),
        }),
      ),
    ).toEqual([403, "note_not_editable"]);
  }, 120_000);
});

/** Every file under memory/, byte for byte, and the dashboard rows: what a refused write must leave as it was. */
const state = () => {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files[full] = fs.readFileSync(full, "utf8");
    }
  };
  walk(w.memory);
  walk(path.join(w.ctx.paths.artifacts, "dashboards"));
  return {
    files,
    snapshots: w.ctx.db.prepare("SELECT * FROM dashboard_snapshots ORDER BY dashboard_id").all(),
    series: w.ctx.db.prepare("SELECT * FROM dashboard_series ORDER BY dashboard_id, widget_id, at").all(),
  };
};

describe("C59 who may call the eight routes", () => {
  /** The six writes, each as the owner would make it succeed. */
  const writes = (
    id: string,
    version: string,
    definition: Json,
    task: { path: string; version: string },
  ) => ({
    "POST /api/dashboards": ["POST", "/api/dashboards", { template: "question", question: "Quem pode?" }],
    "PUT /api/dashboards/:id": ["PUT", `/api/dashboards/${id}`, { definition, baseVersion: version }],
    "DELETE /api/dashboards/:id": ["DELETE", `/api/dashboards/${id}`, undefined],
    "POST /api/dashboards/:id/refresh": ["POST", `/api/dashboards/${id}/refresh`, {}],
    "POST /api/dashboards/:id/export": ["POST", `/api/dashboards/${id}/export`, {}],
    "PUT /api/memory/tasks": [
      "PUT",
      "/api/memory/tasks",
      { path: task.path, line: 3, done: true, baseVersion: task.version },
    ],
  });

  it("C59 EXPECTED_ROUTE_SCOPES lists the eight; a content device gets 200 from both GETs and a monitor-only one 403 scope_required; every device gets 403 owner_only from the six writes and nothing changes; a run's own credential gets 403 forbidden from all eight; the run's route lists are those of the feature's base", async () => {
    for (const want of ROUTES)
      expect(EXPECTED_ROUTE_SCOPES[`${want.method} ${want.path}`], want.id).toBe(want.scope);

    const made = (await w.create({ template: "overview" })).body;
    const id = made.id as string;
    expect((await w.refresh(id)).status).toBe(200);
    const file = noteFile("quem");
    w.put(file, "# Quem\n\n- [ ] Tarefa de quem pode\n");
    const task = { path: file, version: sha(fs.readFileSync(file)) };
    const reads: Record<string, string> = {
      "GET /api/dashboards": "/api/dashboards",
      "GET /api/dashboards/:id": `/api/dashboards/${id}`,
    };
    expect(Object.keys(reads).sort()).toEqual(READS.map((r) => `${r.method} ${r.path}`).sort());
    const calls = writes(id, made.version, made.definition, task);
    expect(Object.keys(calls).sort()).toEqual(WRITES.map((r) => `${r.method} ${r.path}`).sort());

    const content = w.device(["content"]);
    const monitor = w.device(["monitor"]);
    for (const [key, url] of Object.entries(reads)) {
      const ok = await w.call("GET", url, undefined, content);
      expect(ok.status, `${key} ${JSON.stringify(ok.body).slice(0, 200)}`).toBe(200);
      expect(code(await w.call("GET", url, undefined, monitor)), key).toEqual([403, "scope_required"]);
    }
    expect((await w.call("GET", `/api/dashboards/${id}`, undefined, content)).body.definition).toEqual(
      made.definition,
    );

    const before = state();
    expect(before.snapshots.length).toBeGreaterThan(0);
    const devices = {
      content,
      monitor,
      run: w.device(["run"]),
      approve: w.device(["approve"]),
      all: w.device(["content", "monitor", "run", "approve"]),
    };
    for (const [name, headers] of Object.entries(devices))
      for (const [key, [method, url, body]] of Object.entries(calls)) {
        const res = await w.call(method as string, url as string, body, headers);
        expect(code(res), `${name} ${key}`).toEqual([403, "owner_only"]);
      }
    expect(state()).toEqual(before);

    // A run's own credential, live (it reaches a route of its read list), of a memory skill and of the question's skill.
    for (const skillSlug of ["organize-brain", "dashboard-answer"]) {
      expect(w.ctx.settings().memorySkills, skillSlug).toContain(skillSlug);
      const record = w.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "held open",
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 60_000,
        profile: "controlled_write",
        skillSlug,
        startedBy: null,
      } as never);
      const token = w.ctx.runApiAccessFor(record, "write")!.token;
      expect(token).toMatch(/^rc_/);
      const run = { "x-mordomo-token": token, "content-type": "application/json" };
      expect((await w.call("GET", "/api/memory/recall?q=quem&record=false", undefined, run)).status).toBe(
        200,
      );
      for (const [key, url] of Object.entries(reads))
        expect(code(await w.call("GET", url, undefined, run)), `${skillSlug} ${key}`).toEqual([
          403,
          "forbidden",
        ]);
      for (const [key, [method, url, body]] of Object.entries(calls))
        expect(code(await w.call(method as string, url as string, body, run)), `${skillSlug} ${key}`).toEqual(
          [403, "forbidden"],
        );
    }
    expect(state()).toEqual(before);

    // The owner still succeeds with the same calls: the refusals above were the caller's, not the request's.
    expect((await w.call("PUT", "/api/memory/tasks", calls["PUT /api/memory/tasks"][2])).status).toBe(200);

    const lists = (source: string) =>
      ["RUN_API_READ_ROUTES", "RUN_API_WRITE_ROUTES"].map((name) => {
        const set = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source)?.[1] ?? "";
        return [...set.matchAll(/"([A-Z]+ [^"]+)"/g)].map((m) => m[1]!).sort();
      });
    const now = lists(fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "server.ts"), "utf8"));
    expect(now[0]!.length).toBeGreaterThan(3);
    expect(now[1]!.length).toBeGreaterThan(0);
    expect(now).toEqual(lists(atBase("apps/api/src/server.ts")));
    for (const list of now)
      expect(list.filter((r) => KEYS.includes(r) || r.includes("/dashboards"))).toEqual([]);
  }, 120_000);
});

describe("C60 the eight routes in docs/security.md", () => {
  it("C60 docs/security.md lists each of the eight routes in its scope's row and in no other, and each row's count is the number of its routes and of EXPECTED_ROUTE_SCOPES", () => {
    const security = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const scopes = ["monitor", "content", "run", "approve", "owner"];
    const rowOf = (scope: string) => security.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    for (const want of ROUTES) {
      const route = `\`${want.method} ${want.path}\``;
      expect(rowOf(want.scope), route).toContain(route);
      for (const other of scopes.filter((s) => s !== want.scope))
        expect(rowOf(other).includes(route), `${route} in ${other}`).toBe(false);
    }
    for (const scope of ["content", "owner"]) {
      const row = rowOf(scope);
      const declared = Number(/^\| `\w+` \((\d+)\)/.exec(row)?.[1]);
      const listed = [...row.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`]+)`/g)].length;
      const expected = Object.values(EXPECTED_ROUTE_SCOPES).filter((s) => s === scope).length;
      expect([declared, listed], scope).toEqual([expected, expected]);
    }
    // the counts of after this feature: two reads and six writes on top of those of before
    expect(Number(/^\| `content` \((\d+)\)/.exec(rowOf("content"))?.[1])).toBe(32);
    expect(Number(/^\| `owner` \((\d+)\)/.exec(rowOf("owner"))?.[1])).toBe(81);
    const base = atBase("docs/security.md");
    const baseRow = (scope: string) => base.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    expect(Number(/\((\d+)\)/.exec(baseRow("content"))?.[1])).toBe(30);
    expect(Number(/\((\d+)\)/.exec(baseRow("owner"))?.[1])).toBe(75);
  });
});

// ---- C62: the privacy text and the network policy ------------------------------------------------------------

describe("C62 legal/PRIVACY.md and legal/network-policy.json", () => {
  const section = (text: string, start: string, end: string) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return text.slice(from, to);
  };

  it("C62 section 3 says a dashboard snapshot keeps, in the local database and its backups, the titles and subtitles of the connector items it shows, replaced at each refresh and deleted with the dashboard; the network policy and the table of 4.1 are equal to before", () => {
    const privacy = fs.readFileSync(path.join(repoRoot, "legal", "PRIVACY.md"), "utf8");
    const three = section(privacy, "## 3. O que fica no seu computador", "## 4. O que sai do seu computador");
    // One sentence of section 3 says all of it.
    const sentences = three
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ`])/)
      .filter((s) => s.includes("painel"));
    const said = sentences.filter((s) =>
      [
        "banco",
        "cópias de segurança",
        "títulos e subtítulos",
        "conector",
        "substituídos a cada atualização",
        "apagados com o painel",
      ].every((part) => s.includes(part)),
    );
    expect(said, sentences.join("\n")).toHaveLength(1);
    // Not in the list of what leaves the machine: it stays.
    expect(section(privacy, "## 4. O que sai do seu computador", "## 5.")).not.toContain("painel");

    const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "legal", "network-policy.json"), "utf8"));
    expect(policy).toEqual(JSON.parse(atBase("legal/network-policy.json")));
    const table = (text: string) =>
      section(text, "### 4.1. Destinos a que o MordomoOS se conecta", "### 4.2.");
    expect(table(privacy)).toEqual(table(atBase("legal/PRIVACY.md")));
    expect(
      table(privacy)
        .split("\n")
        .filter((l) => l.startsWith("| ")).length,
    ).toBeGreaterThan(10);
  });
});

// ---- C63: what a snapshot keeps of a connector --------------------------------------------------------------

describe("C63 a connector's items in the stored snapshot", () => {
  it("C63 the row of dashboard_snapshots holds the items' title and subtitle and no field outside the item's, the raw answer's body absent; a refresh replaces them, and after DELETE no row holds a title", async () => {
    const raw = (title: string, subtitle: string) => ({
      status: "ok" as const,
      syncedAt: NOW,
      items: [
        {
          id: "m1",
          title,
          subtitle,
          ts: NOW + HOUR,
          href: "https://cal/m1",
          body: "CORPO-SECRETO do convite, que a tela não mostra",
        },
      ],
      summary: { items: 1 },
    });
    fakeConnectorFetch(raw("Reunião com a Ana", "Sala 7") as never);
    const id = (await w.create({ template: "overview" })).body.id as string;
    expect((await w.refresh(id)).status).toBe(200);
    const stored = () =>
      w.ctx.db.prepare("SELECT json FROM dashboard_snapshots WHERE dashboard_id = ?").get(id) as
        { json: string } | undefined;
    const json = stored()!.json;
    const agenda = (JSON.parse(json) as Json).widgets.find((x: Json) => x.id === "agenda");
    expect(agenda.status).toBe("ok");
    expect(agenda.data.items).toEqual([
      { id: "m1", title: "Reunião com a Ana", subtitle: "Sala 7", ts: NOW + HOUR, href: "https://cal/m1" },
    ]);
    for (const item of agenda.data.items as Json[])
      for (const key of Object.keys(item))
        expect(["id", "title", "subtitle", "ts", "flagged", "href"], key).toContain(key);
    expect(json).not.toContain("CORPO-SECRETO");
    expect(json).not.toContain('"body"');

    // Replaced at each refresh: the title of before is gone from the row.
    fakeConnectorFetch(raw("Revisão do contrato", "Online") as never);
    expect((await w.refresh(id)).status).toBe(200);
    expect(stored()!.json).toContain("Revisão do contrato");
    expect(stored()!.json).not.toContain("Reunião com a Ana");

    // Deleted with the dashboard: no row of the table holds it.
    expect((await w.call("DELETE", `/api/dashboards/${id}`)).status).toBe(200);
    expect(stored()).toBeUndefined();
    const holding = w.ctx.db
      .prepare("SELECT dashboard_id FROM dashboard_snapshots WHERE json LIKE ?")
      .all("%Revisão do contrato%");
    expect(holding).toEqual([]);
  }, 60_000);
});

// ---- C64: what the earlier features answer as before ------------------------------------------------------------

describe("C64 the earlier features answer as before", () => {
  /** The calendar's read as the route answered it before the shared cache, for `calendarItems(NOW)`. */
  const RECORDED = {
    status: "ok",
    syncedAt: NOW,
    items: [
      {
        id: "e1",
        title: "Reunião de pauta",
        subtitle: "Sala 2",
        ts: NOW + 3_600_000,
        href: "https://cal/e1",
      },
      { id: "e2", title: "Almoço com cliente", subtitle: "Centro", ts: NOW + 7_200_000, flagged: true },
    ],
    summary: { items: 2 },
  };

  it("C64 GET /api/connectors/calendar-google/data answers the recorded body for the same fake read, cached as before", async () => {
    const fake = fakeConnectorFetch(calendarItems(NOW));
    w.ctx.connectorCache.invalidate("calendar-google");
    const first = await w.call("GET", "/api/connectors/calendar-google/data");
    expect(first.status).toBe(200);
    expect(first.body).toEqual(RECORDED);
    expect(fake).toHaveBeenCalledTimes(1);
    // within the TTL the route answers from the cache; ?refresh=1 reads again
    expect((await w.call("GET", "/api/connectors/calendar-google/data")).body).toEqual(RECORDED);
    expect(fake).toHaveBeenCalledTimes(1);
    expect((await w.call("GET", "/api/connectors/calendar-google/data?refresh=1")).body).toEqual(RECORDED);
    expect(fake).toHaveBeenCalledTimes(2);
  });

  it("C64 the connectorDelta sentinel fetches on its own: one fetch per hourly pass, with its own maxItems, none through the cache", async () => {
    const fake = fakeConnectorFetch(calendarItems(NOW));
    const cached = vi.spyOn(ConnectorDataCache.prototype, "read");
    expect(w.ctx.settings().sentinels.connectorDelta).toEqual({ enabled: true, maxItems: 50 });
    // a fresh cache entry the sentinel could have used, made by the route
    expect((await w.call("GET", "/api/connectors/calendar-google/data?refresh=1")).status).toBe(200);
    fake.mockClear();
    cached.mockClear();
    await w.ctx.sentinels.hourly();
    await w.ctx.sentinels.hourly();
    const calendar = fake.mock.calls.filter(([c]) => c.id === "calendar-google");
    expect(calendar).toHaveLength(2);
    for (const [, options] of calendar) expect(options).toMatchObject({ maxItems: 50 });
    expect(cached).not.toHaveBeenCalled();
    cached.mockRestore();
  });

  it("C64 MetricsHistory.sample writes the same row for the same source, and a dashboard refresh writes no sample", async () => {
    const source = {
      runs: { total: 12, last24h: 3, failed24h: 1, costTodayUsd: 0.42, tokensToday: 5100, spendWeekUsd: 2.5 },
      inboxUnread: 4,
      approvalsPending: 2,
      approvalWaitAvgMs: 90_000,
    };
    const at = NOW + 17 * DAY;
    const ts = Math.floor(at / HOUR) * HOUR;
    w.ctx.metricsHistory.sample(source, at);
    const row = () => w.ctx.db.prepare("SELECT * FROM metrics_samples WHERE ts = ?").all(ts);
    const ROW = {
      ts,
      runs_total: 12,
      runs_24h: 3,
      failed_24h: 1,
      cost_today_usd: 0.42,
      tokens_today: 5100,
      spend_week_usd: 2.5,
      inbox_unread: 4,
      approvals_pending: 2,
      approval_wait_avg_ms: 90_000,
    };
    expect(row()).toEqual([ROW]);
    const all = () => w.ctx.db.prepare("SELECT * FROM metrics_samples ORDER BY ts").all();
    const before = all();
    const id = (await w.create({ template: "overview" })).body.id as string;
    expect((await w.refresh(id)).status).toBe(200);
    expect(all()).toEqual(before);
    w.ctx.metricsHistory.sample(source, at + 60_000);
    expect(row()).toEqual([ROW]);
  });

  it("C64 GET /api/memory/reviews?kind=due answers the same items for the same home, before and after a dashboard reads the queue", async () => {
    const file = w.note(
      path.join(w.memory, "notes", "revisao", "opiniao.md"),
      { natureza: "opiniao", last_reviewed: dayOf(NOW, -120) },
      "# Opinião antiga\n\nTexto.\n",
    );
    await w.index();
    const queue = async () => {
      const res = await w.call("GET", "/api/memory/reviews?kind=due");
      expect(res.status).toBe(200);
      return res.body;
    };
    const before = await queue();
    const mine = (before.items as Json[]).filter((i) => i.path === file);
    expect(mine.map(({ mtime: _m, ...i }) => i)).toEqual([
      {
        path: file,
        name: "opiniao.md",
        natureza: "opiniao",
        type: null,
        escopo: null,
        lastReviewed: dayOf(NOW, -120),
        dueSince: dayOf(NOW, -30),
        editable: true,
      },
    ]);
    const id = (await w.create({ template: "overview" })).body.id as string;
    const refreshed = await w.refresh(id);
    expect(refreshed.status).toBe(200);
    const kpi = (refreshed.body.snapshot.widgets as Json[]).find((x) => x.id === "revisoes-kpi")!;
    expect(kpi.data.value).toBe(before.total);
    expect(await queue()).toEqual(before);
  });
});

describe("C64 the reviewDue sentinel and the reminders share no cap", () => {
  let seqWorld = 0;
  /** A fresh world with two notes due for review, and, when asked, a note with two overdue tasks. */
  async function home(withTasks: boolean): Promise<PaineisWorld> {
    const world = await paineisWorld(`mordomo-paineis-c64-${++seqWorld}-`);
    for (const n of [1, 2])
      world.note(
        path.join(world.memory, "notes", "rev", `n${n}.md`),
        { natureza: "opiniao", last_reviewed: dayOf(NOW, -120) },
        `# N${n}\n`,
      );
    if (withTasks)
      world.note(
        path.join(world.memory, "notes", "tarefas.md"),
        { natureza: "fato" },
        `# Tarefas\n\n- [ ] Mandar a proposta 📅 ${dayOf(NOW, -2)}\n- [ ] Ligar para o banco 📅 ${dayOf(NOW, -1)}\n`,
      );
    await world.index();
    return world;
  }
  const fired = async (world: PaineisWorld, run: () => Promise<unknown>) => {
    const seen: Json[] = [];
    const off = world.ctx.events.subscribe((e: OsEvent) => {
      const payload = e.payload as Json;
      if (e.type === "sentinel.fired" && payload.sentinel === "reviewDue") seen.push(payload);
    });
    try {
      await run();
    } finally {
      off();
    }
    return seen;
  };
  const rows = (world: PaineisWorld, kind: string) =>
    world.ctx.notifications.list({ limit: 300 }).filter((n) => n.kind === kind);
  const reviewRows = (world: PaineisWorld) =>
    world.ctx.notifications.list({ limit: 300 }).filter((n) => n.messageKey === "sentinel.reviewDue");

  it("C64 the reviewDue sentinel fires once a day with the count of before, with or without reminders on the same day", async () => {
    fakeConnectorFetch(calendarItems(NOW));
    const plain = await home(false);
    const busy = await home(true);
    try {
      expect(busy.ctx.settings().dashboards.reminders).toEqual({ maxPerDay: 3, at: "08:30" });
      const ALERT = {
        sentinel: "reviewDue",
        title: "2 items to review",
        messageParams: { count: 2, display: "2" },
        href: "/brain/reviews",
      };
      // Day one. Without reminders: one alert of two.
      const alone = await fired(plain, () => plain.ctx.sentinels.hourly());
      expect(alone).toHaveLength(1);
      expect(alone[0]).toMatchObject(ALERT);
      expect(await fired(plain, () => plain.ctx.sentinels.hourly())).toEqual([]);

      // With reminders first: the overview's refresh writes the two reminders, and the alert still comes, the same.
      const id = (await busy.create({ template: "overview" })).body.id as string;
      expect((await busy.refresh(id)).status).toBe(200);
      expect(rows(busy, "reminder")).toHaveLength(2);
      const after = await fired(busy, () => busy.ctx.sentinels.hourly());
      expect(after).toEqual(alone);
      expect(await fired(busy, () => busy.ctx.sentinels.hourly())).toEqual([]);
      // And the alert takes nothing from the reminders' cap: a refresh of the same day writes none again (deduped),
      // and the cap counts reminders alone.
      expect((await busy.refresh(id)).status).toBe(200);
      expect(rows(busy, "reminder")).toHaveLength(2);
      expect(reviewRows(busy)).toHaveLength(1);
      expect(reviewRows(plain)).toHaveLength(1);

      // Day two, at noon: the alert first, then the reminders, each as on day one.
      clock.set(NOW + DAY);
      const second = await fired(busy, () => busy.ctx.sentinels.hourly());
      expect(second).toHaveLength(1);
      expect(second[0]).toMatchObject(ALERT);
      expect((await busy.refresh(id)).status).toBe(200);
      expect(rows(busy, "reminder")).toHaveLength(4);
      expect(reviewRows(busy)).toHaveLength(2);
      const plainSecond = await fired(plain, () => plain.ctx.sentinels.hourly());
      expect(plainSecond).toEqual(second);
    } finally {
      await plain.close();
      await busy.close();
    }
  }, 120_000);
});

// The contract world serves every scenario: each of the eight answers its success status there too (C59's probe
// half is in tests/api.refusals.test.ts; this is the scenario itself, outside the probe).
describe("C59 the scenarios of the eight routes", () => {
  it("C59 each of the eight routes has a scenario of the contract world, and each answers a success status of its entry", async () => {
    const world = await buildWorld();
    try {
      for (const want of ROUTES) {
        const key = `${want.method} ${want.path}`;
        const scenario = SCENARIOS[key];
        expect(scenario, key).toBeDefined();
        const answer = await scenario!.run(world);
        expect(
          want.statuses as readonly number[],
          `${key}: ${JSON.stringify(answer.body).slice(0, 300)}`,
        ).toContain(answer.status);
      }
    } finally {
      await world.close();
    }
  }, 120_000);
});

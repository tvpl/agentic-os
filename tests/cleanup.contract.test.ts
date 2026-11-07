import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  API,
  EVENT_ENVELOPES,
  EVENT_SCHEMAS,
  EVENT_VERSIONS,
  checkBody,
  declaredErrors,
  routeKey,
  type RouteDefinition,
} from "@mordomo/contracts";
import { EventBus } from "@mordomo/core/internal";
import { SCENARIOS, buildWorld } from "./helpers/contractWorld.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";
import { ENTRIES, edgesOf, loadTree, reachable } from "../apps/command-centre/src/testing/sourceGraph.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch B, the API's cross-cutting checks (C74-C77, C79): the six routes in the
 * table, the scopes and who may call them, the three events, and the hygiene left as it was.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86_400_000;
/** The feature's base: the commit before batch A. */
const FEATURE_BASE = "b8aa09d";
const SIX: Array<{ id: string; method: string; path: string; scope: string; errors: string[] }> = [
  {
    id: "memory.cleanup.inventory",
    method: "GET",
    path: "/api/memory/cleanup/inventory",
    scope: "content",
    errors: ["400 scope_required", "404 context_not_found"],
  },
  {
    id: "memory.cleanup.scans.start",
    method: "POST",
    path: "/api/memory/cleanup/scans",
    scope: "owner",
    errors: ["400 scope_required", "404 context_not_found", "409 scan_running", "409 restore_in_progress"],
  },
  {
    id: "memory.cleanup.scans.get",
    method: "GET",
    path: "/api/memory/cleanup/scans/:id",
    scope: "content",
    errors: ["404 not_found"],
  },
  {
    id: "memory.cleanup.decisions",
    method: "PUT",
    path: "/api/memory/cleanup/decisions",
    scope: "owner",
    errors: ["400 validation", "404 not_found", "409 scan_stale"],
  },
  {
    id: "memory.cleanup.apply",
    method: "POST",
    path: "/api/memory/cleanup/apply",
    scope: "owner",
    errors: ["404 not_found", "409 scan_running", "409 scan_stale", "409 restore_in_progress"],
  },
  {
    id: "memory.cleanup.undo",
    method: "POST",
    path: "/api/memory/cleanup/undo",
    scope: "owner",
    errors: ["400 validation", "404 not_found", "409 undo_conflict", "409 restore_in_progress"],
  },
];
const code = (r: { body: Json }) => r.body?.error?.code;

describe("C74 the six routes in the contract", () => {
  it("C74 the six routes are in the API table as door 5 says, declare the named errors, are in EXPECTED_ROUTE_SCOPES and their row of docs/security.md, and each has a scenario of the refusal probe that answers", async () => {
    const cleanupEntries = (Object.entries(API) as Array<[string, RouteDefinition]>).filter(([, e]) =>
      e.path.startsWith("/api/memory/cleanup/"),
    );
    expect(
      cleanupEntries
        .map(([id, e]) => ({ id, method: e.method, path: e.path, scope: e.scope }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    ).toEqual(
      SIX.map(({ id, method, path: p, scope }) => ({ id, method, path: p, scope })).sort((a, b) =>
        a.id < b.id ? -1 : 1,
      ),
    );
    for (const want of SIX) {
      const entry = API[want.id as keyof typeof API] as RouteDefinition;
      const declared = declaredErrors(entry).map((e) => `${e.status} ${e.code}`);
      expect(declared, want.id).toEqual(expect.arrayContaining(want.errors));
      const key = `${want.method} ${want.path}`;
      expect(routeKey(entry)).toBe(key);
      expect(EXPECTED_ROUTE_SCOPES[key], key).toBe(want.scope);
    }

    // docs/security.md: in its scope's row and in no other.
    const security = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const scopeRow = (scope: string) =>
      security.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    for (const want of SIX) {
      const route = `\`${want.method} ${want.path}\``;
      expect(scopeRow(want.scope), route).toContain(route);
      for (const other of ["monitor", "content", "run", "approve", "owner"].filter((s) => s !== want.scope))
        expect(scopeRow(other).includes(route), `${route} in ${other}`).toBe(false);
    }

    // The refusal probe has a scenario for each, and each answers its success status in a world of its own.
    const world = await buildWorld();
    try {
      for (const want of SIX) {
        const key = `${want.method} ${want.path}`;
        const scenario = SCENARIOS[key];
        expect(scenario, key).toBeDefined();
        const answer = await scenario!.run(world);
        const success = Object.keys((API[want.id as keyof typeof API] as RouteDefinition).responses).map(
          Number,
        );
        expect(success, `${key}: ${JSON.stringify(answer.body).slice(0, 300)}`).toContain(answer.status);
      }
    } finally {
      await world.close();
    }
  }, 120_000);
});

describe("who may call the six routes", () => {
  let w: NotesViewWorld;
  let root: string;
  let scanId: string;
  let key: string;
  let manifest: string;
  beforeAll(async () => {
    w = await notesViewWorld("mordomo-cleanup-contract-");
    root = path.join(w.memory, "notes", "quem");
    w.put(path.join(root, "a.md"), "sem titulo a\n");
    w.put(path.join(root, "b.md"), "sem titulo b\n");
    await w.index();
    const started = await w.call("POST", "/api/memory/cleanup/scans", { dir: root });
    scanId = started.body.scanId;
    for (let i = 0; i < 2000 && w.ctx.cleanup.get(scanId)?.status === "running"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const scan = w.ctx.cleanup.get(scanId)!;
    key = scan.findings.find((f) => f.kind === "untitled" && f.files[0]!.path.endsWith("a.md"))!.key;
    const other = scan.findings.find((f) => f.kind === "untitled" && f.files[0]!.path.endsWith("b.md"))!.key;
    // an earlier apply of b.md leaves a manifest the devices then try to undo
    await w.call("PUT", "/api/memory/cleanup/decisions", {
      scanId,
      decisions: [{ key: other, decision: "archive" }],
    });
    manifest = (await w.call("POST", "/api/memory/cleanup/apply", { scanId })).body.manifest;
    expect(manifest).toMatch(/manifest\.json$/);
  }, 60_000);
  afterAll(async () => {
    await w.close();
  });

  /** The decisions table, the files under memory/ and the manifest, to show a refused call changed nothing. */
  const state = () => {
    const files: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files[full] = fs.readFileSync(full, "utf8");
      }
    };
    walk(w.memory);
    return { rows: w.ctx.db.prepare("SELECT * FROM cleanup_decisions ORDER BY scope, key").all(), files };
  };
  const writes = () =>
    [
      ["POST", "/api/memory/cleanup/scans", { dir: root }],
      ["PUT", "/api/memory/cleanup/decisions", { scanId, decisions: [{ key, decision: "archive" }] }],
      ["POST", "/api/memory/cleanup/apply", { scanId }],
      ["POST", "/api/memory/cleanup/undo", { manifest }],
    ] as const;

  it("C75 a content device reads the inventory and a scan, a monitor-only one gets 403 scope_required from both; a device with every scope gets 403 owner_only from the four writes, and nothing changes", async () => {
    const content = w.device(["content"]);
    const monitor = w.device(["monitor"]);
    const all = w.device(["content", "monitor", "run", "approve"]);
    const reads = [
      `/api/memory/cleanup/inventory?dir=${encodeURIComponent(root)}`,
      `/api/memory/cleanup/scans/${scanId}`,
    ];
    for (const url of reads) {
      const ok = await w.call("GET", url, undefined, content);
      expect(ok.status, `${url} ${JSON.stringify(ok.body)}`).toBe(200);
      const refused = await w.call("GET", url, undefined, monitor);
      expect([refused.status, code(refused)], url).toEqual([403, "scope_required"]);
    }
    const before = state();
    for (const [method, url, body] of writes()) {
      const res = await w.call(method, url, body, all);
      expect([res.status, code(res)], `${method} ${url}`).toEqual([403, "owner_only"]);
    }
    expect(state()).toEqual(before);
  });

  it("C76 a memory skill's run credential gets 403 forbidden from each of the six routes, and the run's route lists are those of the feature's base", async () => {
    const record = w.ctx.runs.create({
      origin: "skill",
      provider: "claude",
      prompt: "held open",
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 60_000,
      profile: "controlled_write",
      skillSlug: "organize-brain",
      startedBy: null,
    } as never);
    const run = {
      "x-mordomo-token": w.ctx.runApiAccessFor(record, "write")!.token,
      "content-type": "application/json",
    };
    const before = state();
    const calls: Array<[string, string, unknown]> = [
      ["GET", `/api/memory/cleanup/inventory?dir=${encodeURIComponent(root)}`, undefined],
      ["GET", `/api/memory/cleanup/scans/${scanId}`, undefined],
      ...writes(),
    ];
    expect(calls).toHaveLength(6);
    for (const [method, url, body] of calls) {
      const res = await w.call(method, url, body, run);
      expect([res.status, code(res)], `${method} ${url}`).toEqual([403, "forbidden"]);
    }
    expect(state()).toEqual(before);

    const lists = (source: string) =>
      ["RUN_API_READ_ROUTES", "RUN_API_WRITE_ROUTES"].map((name) => {
        const body = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source)?.[1] ?? "";
        return [...body.matchAll(/"([A-Z]+ [^"]+)"/g)].map((m) => m[1]).sort();
      });
    const now = lists(fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "server.ts"), "utf8"));
    const base = lists(
      execFileSync("git", ["show", `${FEATURE_BASE}:apps/api/src/server.ts`], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
    expect(now[0]!.length).toBeGreaterThan(3);
    expect(now).toEqual(base);
    for (const list of now) expect(list.filter((r) => r.includes("/cleanup/"))).toEqual([]);
  });

  it("C79 GET /api/memory/hygiene answers as before: the six count keys, staleDays 90 with no memory.cleanup and with memory.cleanup.staleDays 180, and a file aged 100 days is a stale item", async () => {
    const old = w.put(path.join(w.memory, "notes", "higiene", "velha.md"), "# Velha\ncem dias\n");
    const at = (Date.now() - 100 * DAY - 6 * 3_600_000) / 1000;
    fs.utimesSync(old, at, at);
    await w.index();
    const settingsFile = path.join(w.home, "config", "settings.json");
    const raw = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    delete raw.memory?.cleanup;
    fs.writeFileSync(settingsFile, JSON.stringify(raw, null, 2));
    expect(JSON.parse(fs.readFileSync(settingsFile, "utf8")).memory?.cleanup).toBeUndefined();
    const hygiene = async () => {
      const res = await w.call("GET", "/api/memory/hygiene");
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      return res.body;
    };
    const first = await hygiene();
    expect(Object.keys(first.counts).sort()).toEqual(
      ["dangling-link", "orphan", "silent-routine", "skill-never-run", "stale", "unused-connector"].sort(),
    );
    expect(first.thresholds.staleDays).toBe(90);
    expect((first.items as Json[]).some((i) => i.kind === "stale" && i.id === old)).toBe(true);
    w.update((s) => {
      s.memory.cleanup = { staleDays: 180, largeBytes: 5_242_880 };
    });
    const second = await hygiene();
    expect(second.thresholds.staleDays).toBe(90);
    expect((second.items as Json[]).some((i) => i.kind === "stale" && i.id === old)).toBe(true);
  });
});

describe("C77 the three events", () => {
  it("C77 EVENT_VERSIONS holds the three cleanup events at [1], each v1 fixture parses, and an emission off the schema fails the bus's check", () => {
    const types = ["cleanup.progress", "cleanup.finished", "cleanup.failed"] as const;
    for (const type of types) {
      expect([...EVENT_VERSIONS[type]], type).toEqual([1]);
      expect(EVENT_SCHEMAS[type][1], type).toBeDefined();
      const fixture = JSON.parse(
        fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "events", "v1", `${type}.json`), "utf8"),
      );
      expect(fixture.type).toBe(type);
      expect(fixture.v).toBe(1);
      const entry = EVENT_ENVELOPES.find((e) => e.type === type && e.v === 1)!;
      expect(checkBody(entry.schema, fixture), type).toEqual([]);
    }
    // The bus's check is the guard every test file runs under (tests/helpers/eventGuard.ts): each emitted event against
    // the schema of its type and version. A real emission on the schema passes it; the same envelope with phase
    // "other" is refused by that very check (emitting it for real would fail this file in the guard's afterEach).
    const guard = (event: { type: string; v: number }) => {
      const entry = EVENT_ENVELOPES.find((e) => e.type === event.type && e.v === event.v);
      return entry ? checkBody(entry.schema, event) : [`no schema for ${event.type} version ${event.v}`];
    };
    const good = new EventBus().emit("cleanup.progress", { scanId: "s", phase: "links", done: 1, total: 2 });
    expect(guard(good)).toEqual([]);
    const bad = { ...good, payload: { ...good.payload, phase: "other" } };
    expect(guard(bad).join(" ")).toContain("phase");
  });
});

describe("cross-cutting: the weight of the wizard (batch C)", () => {
  type Entry = {
    feature: string;
    reason: string;
    jsRaw: number;
    jsGzip: number;
    cssRaw: number;
    cssGzip: number;
  };

  it("C82 the wizard is reached from both entries only by a dynamic import(); the baseline's cerebro-faxina-guiada entry follows cerebro-vista-notas with a reason of more than 40 characters and the four numbers, at most 12 KB of JS gzip and 2 KB of CSS gzip above it (534 932 B and 74 679 B)", () => {
    const tree = loadTree(path.join(repoRoot, "apps", "command-centre", "src"));
    // What each page loads without anyone asking: its entry and what that imports statically.
    for (const entry of ENTRIES) {
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length > 0)
        for (const edge of edgesOf(tree, queue.pop()!)) {
          if (edge.how === "dynamic" || edge.how === "url" || seen.has(edge.to)) continue;
          seen.add(edge.to);
          queue.push(edge.to);
        }
      expect(
        [...seen].filter((f) => f.startsWith("brain/cleanup/")),
        entry,
      ).toEqual([]);
    }
    expect(reachable(tree).has("brain/cleanup/CleanupWizard.tsx")).toBe(true);
    // The two ways in are dynamic: the host the shell mounts, and the gallery's cleanup story, itself an import().
    const importers = (to: string) =>
      [...tree.keys()].filter(
        (f) =>
          !/\.test\./.test(f) &&
          f !== "brain/cleanup/testkit.tsx" &&
          edgesOf(tree, f).some((e) => e.to === to),
      );
    const how = (from: string, to: string) => edgesOf(tree, from).find((e) => e.to === to)?.how;
    expect(importers("brain/cleanup/CleanupWizard.tsx").sort()).toEqual([
      "brain/CleanupHost.tsx",
      "gallery/cleanupStory.tsx",
    ]);
    expect(how("brain/CleanupHost.tsx", "brain/cleanup/CleanupWizard.tsx")).toBe("dynamic");
    expect(importers("gallery/cleanupStory.tsx")).toEqual(["gallery/main.tsx"]);
    expect(how("gallery/main.tsx", "gallery/cleanupStory.tsx")).toBe("dynamic");

    const baseline = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "scripts", "bundle-baseline.json"), "utf8"),
    ) as {
      after: Entry[];
    };
    const i = baseline.after.findIndex((e) => e.feature === "cerebro-faxina-guiada");
    expect(i, "the entry exists").toBeGreaterThan(0);
    const entry = baseline.after[i]!;
    const before = baseline.after[i - 1]!;
    expect(before.feature).toBe("cerebro-vista-notas");
    expect([before.jsGzip, before.cssGzip]).toEqual([534_932, 74_679]);
    expect(entry.reason.length).toBeGreaterThan(40);
    for (const k of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
      expect(Number.isInteger(entry[k]) && entry[k] > 0, k).toBe(true);
    expect(entry.jsGzip - before.jsGzip).toBeLessThanOrEqual(12 * 1024);
    expect(entry.cssGzip - before.cssGzip).toBeLessThanOrEqual(2 * 1024);
  });
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  API,
  EVENT_ENVELOPES,
  EVENT_SCHEMAS,
  EVENT_VERSIONS,
  SENTINEL_IDS,
  checkBody,
  declaredErrors,
  routeKey,
  type RouteDefinition,
} from "@mordomo/contracts";
import type * as CoreInternal from "@mordomo/core/internal";
import { SCENARIOS, buildWorld } from "./helpers/contractWorld.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import { ENTRIES, edgesOf, loadTree, reachable } from "../apps/command-centre/src/testing/sourceGraph.js";
import { notesViewWorld, sha, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, the contract (checks.md "Cross-cutting, API", and C44 of S3): what the route table,
 * the event registry and their documents say, who may call the two review routes, and what the earlier features
 * answer as before. Batch B holds C44; batch C holds C64-C69.
 */

/**
 * C65 has to see the server refuse a recall answer that leaves `natureza` or `escopo` out. The recall route calls
 * `recall` from the core's barrel, so this file wraps it: as itself unless a test names a key to drop from each
 * `answerContext[]` item.
 */
const drop = vi.hoisted(() => ({ recallKey: null as null | "natureza" | "escopo" }));
vi.mock("@mordomo/core/internal", async (importOriginal) => {
  const actual = await importOriginal<typeof CoreInternal>();
  const recall: typeof actual.recall = (...args) => {
    const result = actual.recall(...args);
    const key = drop.recallKey;
    if (key) for (const item of result.answerContext) delete (item as Partial<typeof item>)[key];
    return result;
  };
  return { ...actual, recall };
});

const repoRoot = path.resolve(import.meta.dirname, "..");
const DAY = 86_400_000;
/** The feature's base: the commit before batch A. */
const FEATURE_BASE = "aa687ed";
const code = (r: { status: number; body: Json }) => [r.status, r.body?.error?.code];

describe("S3 the reviewDue sentinel in the event contract", () => {
  it("C44 SENTINEL_IDS holds reviewDue, the v1 schema takes it and refuses other, its v1 fixture parses, and sentinel.fired is still version 1 only", () => {
    expect(SENTINEL_IDS).toContain("reviewDue");
    const schema = EVENT_SCHEMAS["sentinel.fired"][1];
    const payload = {
      sentinel: "reviewDue",
      title: "3 items to review",
      body: "Notes are due.",
      severity: "info",
      href: "/brain/reviews",
      dedupeKey: "sentinel:reviewDue:2026-10-30:all",
      messageParams: { count: 3, display: "3" },
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, sentinel: "other" }).success).toBe(false);
    const fixture = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tests/fixtures/events/v1/sentinel.fired.reviewDue.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(fixture).toMatchObject({ type: "sentinel.fired", v: 1, payload: { sentinel: "reviewDue" } });
    const envelope = EVENT_ENVELOPES.find((e) => e.type === "sentinel.fired" && e.v === 1)!;
    expect(checkBody(envelope.schema, fixture)).toEqual([]);
    expect(EVENT_VERSIONS["sentinel.fired"]).toEqual([1]);
  });
});

// ---- C64: the two routes in the contract ------------------------------------------------------------------------

const REVIEWS: Array<{ id: string; method: string; path: string; scope: string; errors: string[] }> = [
  {
    id: "memory.reviews.list",
    method: "GET",
    path: "/api/memory/reviews",
    scope: "content",
    // C34 (400), C32 (404 context_not_found).
    errors: ["400 validation", "404 context_not_found"],
  },
  {
    id: "memory.reviews.decide",
    method: "POST",
    path: "/api/memory/reviews",
    scope: "owner",
    // C48, C55, C57 (400), C53 (403 note_not_editable), C55 (403 forbidden_path, 404 not_found, 409
    // front_matter_unreadable, 413), C54 and C63 (409 edit_conflict).
    errors: [
      "400 validation",
      "403 note_not_editable",
      "403 forbidden_path",
      "404 not_found",
      "409 edit_conflict",
      "409 front_matter_unreadable",
      "413 note_too_large",
    ],
  },
];
const ACTIONS = ["keep", "snooze", "never", "abandon", "became_fact", "classify", "restore"];

describe("C64 the two review routes in the contract", () => {
  it("C64 the two routes are in the API table as door 4 says, declare the named errors, take the seven actions, are in EXPECTED_ROUTE_SCOPES and their row of docs/security.md, and each has a scenario of the refusal probe that answers", async () => {
    const entries = (Object.entries(API) as Array<[string, RouteDefinition]>).filter(
      ([, e]) => e.path === "/api/memory/reviews",
    );
    expect(
      entries
        .map(([id, e]) => ({ id, method: e.method, path: e.path, scope: e.scope }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    ).toEqual(
      REVIEWS.map(({ id, method, path: p, scope }) => ({ id, method, path: p, scope })).sort((a, b) =>
        a.id < b.id ? -1 : 1,
      ),
    );
    for (const want of REVIEWS) {
      const entry = API[want.id as keyof typeof API] as RouteDefinition;
      const declared = declaredErrors(entry).map((e) => `${e.status} ${e.code}`);
      expect(declared, want.id).toEqual(expect.arrayContaining(want.errors));
      const key = `${want.method} ${want.path}`;
      expect(routeKey(entry)).toBe(key);
      expect(EXPECTED_ROUTE_SCOPES[key], key).toBe(want.scope);
    }
    // The list reads no path a caller names, and has no write to refuse: none of the decision's own codes.
    const listed = declaredErrors(API["memory.reviews.list"] as RouteDefinition).map(
      (e) => `${e.status} ${e.code}`,
    );
    for (const c of ["403 note_not_editable", "409 edit_conflict", "413 note_too_large"])
      expect(listed, c).not.toContain(c);

    // The decision takes exactly the seven actions of door 4 and amendment 7.
    const body = (API["memory.reviews.decide"] as RouteDefinition).body as z.AnyZodObject;
    const action = body.shape.action as z.ZodEnum<[string, ...string[]]>;
    expect([...action.options].sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) expect(body.safeParse({ path: "/x.md", action: a }).success, a).toBe(true);
    expect(body.safeParse({ path: "/x.md", action: "delete" }).success).toBe(false);

    // docs/security.md: in its scope's row and in no other.
    const security = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const scopeRow = (scope: string) =>
      security.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    for (const want of REVIEWS) {
      const route = `\`${want.method} ${want.path}\``;
      expect(scopeRow(want.scope), route).toContain(route);
      for (const other of ["monitor", "content", "run", "approve", "owner"].filter((s) => s !== want.scope))
        expect(scopeRow(other).includes(route), `${route} in ${other}`).toBe(false);
    }

    // The refusal probe has a scenario for each, and each answers its success status in a world of its own; the
    // document the world serves names both operations with their scope.
    const world = await buildWorld();
    try {
      for (const want of REVIEWS) {
        const key = `${want.method} ${want.path}`;
        const scenario = SCENARIOS[key];
        expect(scenario, key).toBeDefined();
        const answer = await scenario!.run(world);
        const success = Object.keys((API[want.id as keyof typeof API] as RouteDefinition).responses).map(
          Number,
        );
        expect(success, `${key}: ${JSON.stringify(answer.body).slice(0, 300)}`).toContain(answer.status);
      }
      const doc = (await world.call("GET", "/api/openapi.json")).body as {
        paths: Record<
          string,
          Record<string, { operationId: string; "x-mordomo-scope"?: string; responses: Json }>
        >;
      };
      const ops = doc.paths["/api/v1/memory/reviews"]!;
      expect([ops.get!.operationId, ops.get!["x-mordomo-scope"]]).toEqual(["memory.reviews.list", "content"]);
      expect([ops.post!.operationId, ops.post!["x-mordomo-scope"]]).toEqual([
        "memory.reviews.decide",
        "owner",
      ]);
      for (const want of REVIEWS) {
        const op = ops[want.method.toLowerCase()]!;
        for (const error of want.errors) {
          const [status, c] = error.split(" ");
          expect(JSON.stringify(op.responses[status!] ?? null), `${want.id} ${error}`).toContain(c!);
        }
      }
    } finally {
      await world.close();
    }
  }, 120_000);
});

// ---- C65: the search's and the recall's new keys --------------------------------------------------------------

describe("C65 the natureza and escopo keys of the search and the recall", () => {
  let w: NotesViewWorld;
  beforeAll(async () => {
    w = await notesViewWorld("mordomo-natureza-c65-");
    w.put(
      path.join(w.memory, "notes", "c65", "preco.md"),
      "---\nnatureza: fato\nescopo: equipe\n---\n# Preço\n\n## Preço anual\n\nO plano anual custa noventa reais.\n",
    );
    await w.index();
  }, 60_000);
  afterEach(() => {
    drop.recallKey = null;
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await w.close();
  });

  it("C65 memory.search and memory.recall take the query keys natureza and escopo, their answers carry both (string or null) on each hit and each answerContext[] item, required, and an answer that leaves either out is a 500 response_contract_violation", async () => {
    const search = API["memory.search"] as RouteDefinition;
    const recallEntry = API["memory.recall"] as RouteDefinition;
    for (const entry of [search, recallEntry]) {
      const query = entry.query as z.AnyZodObject;
      for (const key of ["natureza", "escopo"]) {
        expect(query.shape[key], `${entry.path} ${key}`).toBeDefined();
        // Optional in the query: a call without them is the call of before.
        expect(query.shape[key].safeParse(undefined).success, `${entry.path} ${key}`).toBe(true);
      }
      expect(query.safeParse({ q: "x", natureza: "fato,relato", escopo: "pessoal" }).success).toBe(true);
    }
    const hit = ((search.responses as Record<number, z.ZodTypeAny>)[200] as z.ZodArray<z.AnyZodObject>)
      .element;
    const item = (
      ((recallEntry.responses as Record<number, z.ZodTypeAny>)[200] as z.AnyZodObject).shape
        .answerContext as z.ZodArray<z.AnyZodObject>
    ).element;
    for (const [where, schema] of [
      ["search hit", hit],
      ["answerContext item", item],
    ] as const) {
      for (const key of ["natureza", "escopo"]) {
        const field = schema.shape[key] as z.ZodTypeAny;
        expect(field, `${where} ${key}`).toBeDefined();
        expect(field.safeParse(null).success, `${where} ${key} null`).toBe(true);
        // Required: absent is not null.
        expect(field.safeParse(undefined).success, `${where} ${key} absent`).toBe(false);
        expect(field.safeParse(42).success, `${where} ${key} a number`).toBe(false);
      }
      expect((schema.shape.natureza as z.ZodTypeAny).safeParse("fato").success).toBe(true);
      expect((schema.shape.escopo as z.ZodTypeAny).safeParse("equipe").success).toBe(true);
    }

    // The document says the same: both keys are query parameters, and both are required on a hit and an item.
    const doc = (await w.call("GET", "/api/openapi.json")).body as Json;
    const resolve = (schema: Json): Json =>
      schema?.$ref ? resolve(doc.components.schemas[(schema.$ref as string).split("/").pop()!]) : schema;
    for (const p of ["/api/v1/memory/search", "/api/v1/memory/recall"]) {
      const names = (doc.paths[p].get.parameters as Json[])
        .filter((x) => x.in === "query")
        .map((x) => x.name);
      expect(names, p).toEqual(expect.arrayContaining(["natureza", "escopo"]));
    }
    const searchHit = resolve(
      resolve(doc.paths["/api/v1/memory/search"].get.responses["200"].content["application/json"].schema)
        .items,
    );
    expect(searchHit.required).toEqual(expect.arrayContaining(["natureza", "escopo"]));
    const recallBody = resolve(
      doc.paths["/api/v1/memory/recall"].get.responses["200"].content["application/json"].schema,
    );
    const recallItem = resolve(resolve(recallBody.properties.answerContext).items);
    expect(recallItem.required).toEqual(expect.arrayContaining(["natureza", "escopo"]));

    // The server the tests run is the one that checks responses (validateResponses): as built, both answer 200 with the
    // keys set.
    const searchUrl = "/api/memory/search?q=anual&mode=text";
    const recallUrl = `/api/memory/recall?q=${encodeURIComponent("preço anual")}&record=false`;
    const found = await w.call("GET", searchUrl);
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.length).toBeGreaterThan(0);
    for (const h of found.body as unknown as Json[]) {
      expect(h).toHaveProperty("natureza");
      expect(h).toHaveProperty("escopo");
    }
    expect((found.body as unknown as Json[]).find((h) => h.path.endsWith("preco.md"))).toMatchObject({
      natureza: "fato",
      escopo: "equipe",
    });
    const recalled = await w.call("GET", recallUrl);
    expect(recalled.status, JSON.stringify(recalled.body)).toBe(200);
    expect(recalled.body.answerContext.length).toBeGreaterThan(0);
    expect(recalled.body.answerContext[0]).toMatchObject({ natureza: "fato", escopo: "equipe" });

    // A search hit that leaves either key out: the server replaces the answer.
    for (const key of ["natureza", "escopo"] as const) {
      const real = w.ctx.semantic.search.bind(w.ctx.semantic);
      const spy = vi.spyOn(w.ctx.semantic, "search").mockImplementation(async (...args) => {
        const hits = await real(...args);
        return hits.map((h) => {
          const copy: Partial<typeof h> = { ...h };
          delete copy[key];
          return copy as typeof h;
        });
      });
      const res = await w.call("GET", searchUrl);
      expect(spy).toHaveBeenCalled();
      expect(code(res), `search without ${key}`).toEqual([500, "response_contract_violation"]);
      expect(res.body.error.message, key).toContain(key);
      spy.mockRestore();
    }
    // A recall item that leaves either key out: the same.
    for (const key of ["natureza", "escopo"] as const) {
      drop.recallKey = key;
      const res = await w.call("GET", recallUrl);
      expect(code(res), `recall without ${key}`).toEqual([500, "response_contract_violation"]);
      expect(res.body.error.message, key).toContain(key);
    }
    drop.recallKey = null;
    expect((await w.call("GET", recallUrl)).status).toBe(200);
  });
});

// ---- C66: who may call the two routes ---------------------------------------------------------------------------

describe("C66 who may call the review routes", () => {
  let w: NotesViewWorld;
  let note: string;
  let outside: string;
  beforeAll(async () => {
    w = await notesViewWorld("mordomo-natureza-c66-");
    note = w.put(
      path.join(w.memory, "notes", "c66", "a.md"),
      "---\nnatureza: opiniao\n---\n# Nota\n\nTexto.\n",
    );
    const root = w.indexedRoot("c66");
    outside = w.put(path.join(root, "fora.md"), "---\nnatureza: opiniao\n---\n# Fora\n\nTexto.\n");
    const old = (Date.now() - 200 * DAY) / 1000;
    fs.utimesSync(note, old, old);
    fs.utimesSync(outside, old, old);
    await w.index();
    const due = await w.call("GET", "/api/memory/reviews?kind=due");
    expect(due.status, JSON.stringify(due.body)).toBe(200);
    expect((due.body.items as Json[]).map((i) => i.path)).toEqual(expect.arrayContaining([note, outside]));
  }, 60_000);
  afterAll(async () => {
    await w.close();
  });

  /** Every file under memory/ and the indexed note outside it, byte for byte, and the review_state rows. */
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
    files[outside] = fs.readFileSync(outside, "utf8");
    return {
      files,
      mtimes: [fs.statSync(note).mtimeMs, fs.statSync(outside).mtimeMs],
      rows: w.ctx.db.prepare("SELECT * FROM review_state ORDER BY path").all(),
    };
  };
  /** Decisions the owner's token would have saved. */
  const decisions = () => [
    { path: note, action: "keep", baseVersion: sha(fs.readFileSync(note)) },
    { path: outside, action: "snooze", days: 14 },
    { path: outside, action: "never" },
  ];

  it("C66 a content device reads the queue and a monitor-only one gets 403 scope_required; a device with every scope gets 403 owner_only from the decision and nothing changes; a memory skill's run credential gets 403 forbidden from both; the run's route lists are those of the feature's base", async () => {
    const content = w.device(["content"]);
    const monitor = w.device(["monitor"]);
    const all = w.device(["content", "monitor", "run", "approve"]);
    for (const url of [
      "/api/memory/reviews",
      "/api/memory/reviews?kind=due",
      "/api/memory/reviews?kind=unclassified",
    ]) {
      const ok = await w.call("GET", url, undefined, content);
      expect(ok.status, `${url} ${JSON.stringify(ok.body)}`).toBe(200);
      const refused = await w.call("GET", url, undefined, monitor);
      expect(code(refused), url).toEqual([403, "scope_required"]);
    }
    const listed = await w.call("GET", "/api/memory/reviews?kind=due", undefined, content);
    expect((listed.body.items as Json[]).map((i) => i.path)).toEqual(expect.arrayContaining([note, outside]));

    const before = state();
    for (const body of decisions()) {
      const res = await w.call("POST", "/api/memory/reviews", body, all);
      expect(code(res), body.action).toEqual([403, "owner_only"]);
    }
    expect(state()).toEqual(before);

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
    expect(w.ctx.settings().memorySkills).toContain("organize-brain");
    const run = {
      "x-mordomo-token": w.ctx.runApiAccessFor(record, "write")!.token,
      "content-type": "application/json",
    };
    // The credential is live: it reaches a route of its read list.
    expect((await w.call("GET", "/api/memory/recall?q=nota&record=false", undefined, run)).status).toBe(200);
    for (const url of ["/api/memory/reviews?kind=due", "/api/memory/reviews?kind=unclassified"]) {
      const res = await w.call("GET", url, undefined, run);
      expect(code(res), url).toEqual([403, "forbidden"]);
    }
    for (const body of decisions()) {
      const res = await w.call("POST", "/api/memory/reviews", body, run);
      expect(code(res), body.action).toEqual([403, "forbidden"]);
    }
    expect(state()).toEqual(before);

    const lists = (source: string) =>
      ["RUN_API_READ_ROUTES", "RUN_API_WRITE_ROUTES"].map((name) => {
        const set = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source)?.[1] ?? "";
        return [...set.matchAll(/"([A-Z]+ [^"]+)"/g)].map((m) => m[1]).sort();
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
    expect(now[1]!.length).toBeGreaterThan(0);
    expect(now).toEqual(base);
    for (const list of now) expect(list.filter((r) => r!.includes("/reviews"))).toEqual([]);
  });
});

// ---- C68 and C69: what the earlier features answer as before ----------------------------------------------------

describe("the earlier features answer as before", () => {
  let w: NotesViewWorld;
  beforeAll(async () => {
    w = await notesViewWorld("mordomo-natureza-before-");
  }, 60_000);
  afterAll(async () => {
    await w.close();
  });

  it("C68 a cleanup scan over an old plano note, an unclassified note and a review_every: 7d note reports only the eight kinds of C5, the 400-day note as stale and the 7d one not; the inventory has exactly its eight keys", async () => {
    const dir = path.join(w.memory, "notes", "c68");
    const plano = w.put(
      path.join(dir, "plano.md"),
      "---\nnatureza: plano\n---\n# Plano velho\n\nVamos lançar.\n",
    );
    const sem = w.put(path.join(dir, "sem.md"), "# Sem natureza\n\nUma nota qualquer.\n");
    const seven = w.put(
      path.join(dir, "sete.md"),
      "---\nnatureza: opiniao\nreview_every: 7d\n---\n# Sete dias\n\nAcho que sim.\n",
    );
    const at = (file: string, days: number) => {
      const t = (Date.now() - days * DAY - 6 * 3_600_000) / 1000;
      fs.utimesSync(file, t, t);
    };
    at(plano, 400);
    at(seven, 30);
    await w.index();
    for (const f of [plano, sem, seven])
      expect(w.ctx.db.prepare("SELECT 1 FROM files WHERE path = ?").get(f), f).toBeDefined();

    const started = await w.call("POST", "/api/memory/cleanup/scans", { dir });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    const scanId = started.body.scanId as string;
    for (let i = 0; i < 2000 && w.ctx.cleanup.get(scanId)?.status === "running"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const scan = await w.call("GET", `/api/memory/cleanup/scans/${scanId}`);
    expect(scan.status, JSON.stringify(scan.body).slice(0, 300)).toBe(200);
    expect(scan.body.status).toBe("finished");
    const findings = scan.body.findings as Json[];
    const KINDS = [
      "duplicate",
      "near-duplicate",
      "stale",
      "orphan",
      "broken-link",
      "empty-folder",
      "large-file",
      "untitled",
    ];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(KINDS, JSON.stringify(f).slice(0, 200)).toContain(f.kind);
    const staleOf = (file: string) =>
      findings.filter((f) => f.kind === "stale" && (f.files as Json[]).some((x) => x.path === file));
    expect(staleOf(plano)).toHaveLength(1);
    expect(staleOf(seven)).toEqual([]);
    expect(staleOf(sem)).toEqual([]);

    const inventory = await w.call("GET", `/api/memory/cleanup/inventory?dir=${encodeURIComponent(dir)}`);
    expect(inventory.status, JSON.stringify(inventory.body).slice(0, 300)).toBe(200);
    expect(Object.keys(inventory.body).sort()).toEqual(
      ["scope", "total", "byKind", "bySize", "byAge", "topFolders", "clusters", "newest"].sort(),
    );
  });

  it("C69 query where=natureza:talvez still returns the file with fields.natureza talvez; the properties route still refuses review_every 1000d, now refuses became_fact and abandoned that are not a date, and writes became_fact: 2026-10-30 bare, read back as a date", async () => {
    const dir = path.join(w.memory, "notes", "c69");
    const talvez = w.put(path.join(dir, "talvez.md"), "---\nnatureza: talvez\n---\n# Talvez\n\nTexto.\n");
    await w.index();
    const query = await w.call("GET", "/api/memory/query?where=natureza:talvez");
    expect(query.status, JSON.stringify(query.body)).toBe(200);
    const row = (query.body.files as Json[]).find((f) => f.path === talvez);
    expect(row, JSON.stringify(query.body).slice(0, 300)).toBeDefined();
    expect(row!.fields.natureza).toBe("talvez");

    const text = "---\ntype: context\nstatus: active\n---\n# Nota\n\ncorpo\n";
    const p = w.put(path.join(dir, "props.md"), text);
    const write = (body: Json) => w.call("PUT", "/api/memory/notes/properties", body);
    const before = fs.readFileSync(p);
    for (const [what, set] of [
      ["review_every 1000d", { review_every: "1000d" }],
      ["became_fact ontem", { became_fact: "ontem" }],
      ["abandoned ontem", { abandoned: "ontem" }],
    ] as const) {
      const res = await write({ path: p, baseVersion: sha(before), set });
      expect(code(res), what).toEqual([400, "validation"]);
      expect(fs.readFileSync(p).equals(before), what).toBe(true);
    }

    const res = await write({ path: p, baseVersion: sha(before), set: { became_fact: "2026-10-30" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = fs.readFileSync(p, "utf8");
    expect(after).toBe(
      text.replace("status: active\n---\n", "status: active\nbecame_fact: 2026-10-30\n---\n"),
    );
    expect(after.split("\n")).toContain("became_fact: 2026-10-30");
    expect(res.body.version).toBe(sha(after));
    const read = await w.call("GET", `/api/memory/note?p=${encodeURIComponent(p)}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect((read.body.properties as Json[]).find((x) => x.key === "became_fact")).toEqual({
      key: "became_fact",
      kind: "date",
      value: "2026-10-30",
    });
  });
});

describe("C92 the screen's chunk and its weight (amendment 21, question 8)", () => {
  it("C92 the screen and the dialog are reached from both entries only by a dynamic import(); the baseline's cerebro-natureza entry follows cerebro-faxina-guiada with a reason of more than 40 characters and the four numbers, at most 12 KB of JS gzip and 2 KB of CSS gzip above it (546 409 B and 76 471 B)", () => {
    const tree = loadTree(path.join(repoRoot, "apps", "command-centre", "src"));
    const screen = ["brain/reviews/ReviewsScreen.tsx", "brain/reviews/BecameFactDialog.tsx"];
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
        [...seen].filter((f) => f.startsWith("brain/reviews/")),
        entry,
      ).toEqual([]);
    }
    for (const file of screen) expect(reachable(tree).has(file), file).toBe(true);
    // The ways in: the brain's view switch (both shells) and the gallery's reviews story, itself an import().
    const importers = (to: string) =>
      [...tree.keys()]
        .filter(
          (f) =>
            !/\.test\./.test(f) &&
            f !== "brain/reviews/testkit.tsx" &&
            edgesOf(tree, f).some((e) => e.to === to),
        )
        .sort();
    const how = (from: string, to: string) => edgesOf(tree, from).find((e) => e.to === to)?.how;
    expect(importers("brain/reviews/ReviewsScreen.tsx")).toEqual([
      "brain/BrainViewSwitch.tsx",
      "gallery/reviewsStory.tsx",
    ]);
    expect(how("brain/BrainViewSwitch.tsx", "brain/reviews/ReviewsScreen.tsx")).toBe("dynamic");
    expect(importers("brain/reviews/BecameFactDialog.tsx")).toEqual([
      "brain/reviews/ReviewsScreen.tsx",
      "gallery/reviewsStory.tsx",
    ]);
    expect(importers("gallery/reviewsStory.tsx")).toEqual(["gallery/main.tsx"]);
    expect(how("gallery/main.tsx", "gallery/reviewsStory.tsx")).toBe("dynamic");

    type Entry = {
      feature: string;
      reason: string;
      jsRaw: number;
      jsGzip: number;
      cssRaw: number;
      cssGzip: number;
    };
    const baseline = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "scripts", "bundle-baseline.json"), "utf8"),
    ) as {
      after: Entry[];
    };
    const i = baseline.after.findIndex((e) => e.feature === "cerebro-natureza");
    expect(i, "the entry exists").toBeGreaterThan(0);
    const entry = baseline.after[i]!;
    const before = baseline.after[i - 1]!;
    expect(before.feature).toBe("cerebro-faxina-guiada");
    expect([before.jsGzip, before.cssGzip]).toEqual([546_409, 76_471]);
    expect(entry.reason.length).toBeGreaterThan(40);
    for (const k of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
      expect(Number.isInteger(entry[k]) && entry[k] > 0, k).toBe(true);
    expect(entry.jsGzip - before.jsGzip).toBeLessThanOrEqual(12 * 1024);
    expect(entry.cssGzip - before.cssGzip).toBeLessThanOrEqual(2 * 1024);
  });
});

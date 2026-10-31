import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { API, routeKey, type RouteDefinition } from "@mordomo/contracts";
import type * as CoreInternal from "@mordomo/core/internal";
import { responsesValidated } from "../apps/api/src/contract.js";
import { storeProposal } from "../core/src/memory/proposals.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import { code, memoriaWorld, sha, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-memoria-confiavel, the API's cross-cutting checks of part A (batch A3): the seven routes and
 * the changed entries in the table, the document and under /api/v1/ (C80), who may call them (C81), docs/security.md
 * (C82), the response check (C83), the history's setting (C85) and what the earlier features answer as before (C86).
 * The refusal probe's half of C81 is in tests/api.refusals.test.ts, the walker's half of C84 in
 * tests/security-reads.test.ts.
 */

/**
 * C83 has to see the server refuse an answer that leaves a key out. The three routes call `queryFacts`, `listVersions`
 * and `readProposal` from the core's barrel, so this file wraps them: as themselves unless a test names a key to drop.
 */
const drop = vi.hoisted(() => ({
  factKey: null as null | string,
  versionKey: null as null | string,
  opKey: null as null | string,
}));
vi.mock("@mordomo/core/internal", async (importOriginal) => {
  const actual = await importOriginal<typeof CoreInternal>();
  const strip = <T extends object>(item: T, key: string | null): T => {
    if (key) delete (item as Record<string, unknown>)[key];
    return item;
  };
  const queryFacts: typeof actual.queryFacts = (...args) =>
    actual.queryFacts(...args).map((f) => strip(f, drop.factKey));
  const listVersions: typeof actual.listVersions = (...args) =>
    actual.listVersions(...args).map((v) => strip(v, drop.versionKey));
  const readProposal: typeof actual.readProposal = (...args) => {
    const read = actual.readProposal(...args);
    for (const op of read.ops) strip(op, drop.opKey);
    return read;
  };
  return { ...actual, queryFacts, listVersions, readProposal };
});

const repoRoot = path.resolve(import.meta.dirname, "..");
/** The feature's base: the commit before batch A1. */
const FEATURE_BASE = "a5b332e";
const atBase = (file: string) =>
  execFileSync("git", ["show", `${FEATURE_BASE}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * The seven routes of door 10 with the codes each declares of its own (the common errors aside). Door 10's codes, and
 * what amendment 2 adds to them: the refusals of the safe reader and the guarded writer the routes read and write
 * through (`403 forbidden_path`, `404 not_a_file`, `413 file_too_large`, which the refusal probe finds, C81), and on
 * the decision the codes that accepting a note or a fact answers, as the owner's own routes do.
 */
const ROUTES = [
  {
    id: "memory.history.list",
    method: "GET",
    path: "/api/memory/history",
    scope: "content",
    statuses: [200],
    errors: [],
  },
  {
    id: "memory.history.get",
    method: "GET",
    path: "/api/memory/history/:id",
    scope: "content",
    statuses: [200],
    // door 10: 404 not_found; amendment 2: 403 forbidden_path, 404 not_a_file
    errors: ["403 forbidden_path", "404 not_a_file", "404 not_found"],
  },
  {
    id: "memory.history.restore",
    method: "POST",
    path: "/api/memory/history/restore",
    scope: "owner",
    statuses: [200],
    // door 10: 403 note_not_editable, 404 not_found, 409 edit_conflict; amendment 2: 403 forbidden_path, 404 not_a_file
    errors: [
      "403 forbidden_path",
      "403 note_not_editable",
      "404 not_a_file",
      "404 not_found",
      "409 edit_conflict",
    ],
  },
  {
    id: "memory.proposals.list",
    method: "GET",
    path: "/api/memory/proposals",
    scope: "content",
    statuses: [200],
    errors: [],
  },
  {
    id: "memory.proposals.get",
    method: "GET",
    path: "/api/memory/proposals/:id",
    scope: "content",
    statuses: [200],
    // door 10: 404 not_found; amendment 2: 403 forbidden_path, 404 not_a_file, 413 file_too_large
    errors: ["403 forbidden_path", "404 not_a_file", "404 not_found", "413 file_too_large"],
  },
  {
    id: "memory.proposals.create",
    method: "POST",
    path: "/api/memory/proposals",
    scope: "owner",
    statuses: [201],
    errors: ["429 too_many_proposals"],
  },
  {
    id: "memory.proposals.decide",
    method: "POST",
    path: "/api/memory/proposals/:id/decide",
    scope: "owner",
    statuses: [200],
    errors: [
      // door 10
      "404 not_found",
      "409 edit_conflict",
      "409 proposal_decided",
      "409 memory_over_budget",
      "413 note_too_large",
      // amendment 2: the safe reader and the guarded writer
      "403 forbidden_path",
      "404 not_a_file",
      "413 file_too_large",
      // amendment 2: accepting a note or a fact
      "400 unknown_area",
      "403 note_not_editable",
      "404 note_missing",
      "409 note_exists",
      "409 structure_fixed",
      "409 fact_overlap",
    ],
  },
] as const;
const KEYS: string[] = ROUTES.map((r) => `${r.method} ${r.path}`);
const READS = ROUTES.filter((r) => r.method === "GET");
const WRITES = ROUTES.filter((r) => r.method !== "GET");
const entryOf = (id: string) => API[id as keyof typeof API] as RouteDefinition;
const ownCodes = (entry: RouteDefinition) => (entry.errors ?? []).map((e) => `${e.status} ${e.code}`).sort();

let w: MemoriaWorld;
beforeAll(async () => {
  w = await memoriaWorld("mordomo-memoria-contract-");
}, 60_000);
afterAll(async () => {
  await w.close();
});

const memoryFile = () => path.join(w.memory, "MEMORY.md");
const BASE = ["# Long-term memory", "", "## Facts", "", "## Decisions", "", "- Turmas de 15", ""].join("\n");
const JOURNAL_REL = "journal/2026-10-30.md";
let runs = 0;
/** A consolidation proposal of a run, as the hook stores it: one `add` op citing the owner's decision of a journal day. */
const consolidation = (text: string) => {
  const runId = `r-contract-${++runs}`;
  return storeProposal(
    w.ctx.db,
    {
      kind: "consolidation",
      author: `run:${runId}`,
      runId,
      summary: text,
      payload: {
        v: 1,
        summary: text,
        ops: [{ op: "add", section: "Decisions", text, source: JOURNAL_REL, line: 4 }],
      },
    },
    { capped: false },
  ).id;
};
/** A note made through the owner's route, with its path relative to memory/ and its version. */
async function note(title: string, content = "Texto.\n") {
  const res = await w.call("POST", "/api/memory/notes", { title, content });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    file: res.body.path as string,
    rel: path.relative(w.memory, res.body.path).split(path.sep).join("/"),
    version: res.body.version as string,
  };
}
const versionsOf = async (rel: string) =>
  (await w.call("GET", `/api/memory/history?path=${encodeURIComponent(rel)}`)).body.versions as Json[];
const statusOf = async (id: string) =>
  (await w.call("GET", `/api/memory/proposals/${id}`)).body.status as string;
/** Every file under memory/ byte for byte, and the rows the seven routes write: what a refused call must leave. */
const state = () => {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files[full] = sha(fs.readFileSync(full));
    }
  };
  walk(w.memory);
  return {
    files,
    proposals: w.ctx.db.prepare("SELECT * FROM memory_proposals ORDER BY id").all(),
    versions: w.ctx.db.prepare("SELECT * FROM memory_versions ORDER BY id").all(),
    facts: w.ctx.db.prepare("SELECT * FROM facts ORDER BY id").all(),
  };
};

beforeEach(() => {
  w.put(
    path.join(w.memory, ...JOURNAL_REL.split("/")),
    "# 2026-10-30\n## Decisions\n\n- Turmas de 20 alunos\n",
  );
});

// ---- C80: the table, the document and the two spellings ----------------------------------------------------------

describe("C80 the seven routes and the changed entries in the API table, the document and under /api/v1/", () => {
  it("C80 the API table has the seven routes with method, path, scope and the codes as built (amendment 2), the changed entries declare what door 9 and door 2 add, the served document has them under /api/v1/, and each answers under /api/v1/ the same as under /api/", async () => {
    // The table: these seven and, under /api/memory/history and /api/memory/proposals, no other.
    const own = (Object.entries(API) as Array<[string, RouteDefinition]>)
      .filter(([, e]) => /^\/api\/memory\/(history|proposals)(\/|$)/.test(e.path))
      .map(([id]) => id)
      .sort();
    expect(own).toEqual(ROUTES.map((r) => r.id).sort());
    for (const want of ROUTES) {
      const entry = entryOf(want.id);
      expect([entry.method, entry.path, entry.scope], want.id).toEqual([want.method, want.path, want.scope]);
      expect(routeKey(entry)).toBe(`${want.method} ${want.path}`);
      expect(ownCodes(entry), want.id).toEqual([...want.errors].sort());
      expect(Object.keys(entry.responses).map(Number).sort(), want.id).toEqual([...want.statuses]);
    }

    // The changed entries.
    const assert = entryOf("memory.facts.assert");
    expect(Object.keys(assert.responses).map(Number).sort()).toEqual([200, 201, 202]);
    const accepted = assert.responses[202] as z.AnyZodObject;
    expect(Object.keys(accepted.shape)).toEqual(["proposal"]);
    expect(ownCodes(assert)).toEqual(expect.arrayContaining(["409 fact_overlap", "429 too_many_proposals"]));
    const retract = entryOf("memory.facts.retract").body as z.AnyZodObject;
    const reason = retract.shape.reason as z.ZodOptional<z.ZodEnum<[string, ...string[]]>>;
    expect([...reason.unwrap().options].sort()).toEqual(["ended", "wrong"]);
    expect(retract.safeParse({ reason: "never" }).success).toBe(false);
    const append = entryOf("memory.journal.append").body as z.AnyZodObject;
    const author = append.shape.author as z.ZodOptional<z.ZodEnum<[string, ...string[]]>>;
    expect([...author.unwrap().options]).toEqual(["agent"]);
    const list = entryOf("memory.facts.list").query as z.AnyZodObject;
    expect(Object.keys(list.shape)).toEqual(expect.arrayContaining(["knownAt", "includeRetracted"]));
    expect(list.safeParse({ knownAt: "12", includeRetracted: "true" }).success).toBe(true);
    expect(list.safeParse({ knownAt: "ontem" }).success).toBe(false);

    // The document the service serves: each operation under /api/v1/ with its scope, its statuses and its codes.
    const doc = (await w.call("GET", "/api/openapi.json")).body as Json;
    const opOf = (method: string, p: string) =>
      doc.paths[`/api/v1/${p.slice("/api/".length).replace(/:(\w+)/g, "{$1}")}`]?.[method.toLowerCase()];
    for (const want of ROUTES) {
      const op = opOf(want.method, want.path);
      expect(op, `${want.method} ${want.path}`).toBeDefined();
      expect([op.operationId, op["x-mordomo-scope"]], want.id).toEqual([want.id, want.scope]);
      for (const status of want.statuses)
        expect(op.responses[String(status)], `${want.id} ${status}`).toBeDefined();
      for (const error of want.errors) {
        const [status, c] = error.split(" ");
        expect(JSON.stringify(op.responses[status!] ?? null), `${want.id} ${error}`).toContain(c!);
      }
    }
    const assertOp = opOf("POST", "/api/memory/facts");
    expect(
      Object.keys(assertOp.responses["202"].content["application/json"].schema.properties ?? {}),
    ).toEqual(["proposal"]);
    for (const c of ["fact_overlap", "too_many_proposals"])
      expect(
        JSON.stringify(assertOp.responses["409"] ?? null) + JSON.stringify(assertOp.responses["429"] ?? null),
        c,
      ).toContain(c);
    const listParams = (opOf("GET", "/api/memory/facts").parameters as Json[]).map((p) => p.name);
    expect(listParams).toEqual(expect.arrayContaining(["knownAt", "includeRetracted"]));

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

    // The history: the list, a version, the refusals of a restore, and a restore in each spelling.
    const n = await note("Contrato C80", "um\n");
    const firstText = fs.readFileSync(n.file, "utf8");
    const saved = await w.call("PUT", "/api/memory/notes", {
      path: n.file,
      content: "dois\n",
      baseVersion: n.version,
    });
    expect(saved.status).toBe(200);
    const [newest, first] = await versionsOf(n.rel);
    const listed = await same("GET", `memory/history?path=${encodeURIComponent(n.rel)}`);
    expect((listed.body.versions as Json[]).map((v) => v.id)).toEqual([newest!.id, first!.id]);
    expect((await same("GET", "memory/history")).status).toBe(200);
    const one = await same("GET", `memory/history/${first!.id}`);
    expect([one.status, one.body.content]).toEqual([200, firstText]);
    expect(code(await same("GET", "memory/history/999999"))).toEqual([404, "not_found"]);
    expect(code(await same("POST", "memory/history/restore", { id: 999999 }))).toEqual([404, "not_found"]);
    expect(
      code(
        await same("POST", "memory/history/restore", {
          id: first!.id,
          baseVersion: `sha256:${"0".repeat(64)}`,
        }),
      ),
    ).toEqual([409, "edit_conflict"]);
    const restored = await both("POST", "memory/history/restore", {
      id: first!.id,
      baseVersion: sha("dois\n"),
    });
    expect(restored[0].status, JSON.stringify(restored[0].body)).toBe(200);
    expect(restored[0].body).toEqual({ path: n.rel, version: sha(firstText) });
    // the second spelling names the bytes the first replaced: the file is the version now, so it is the same conflict
    expect(code(restored[1])).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(n.file, "utf8")).toBe(firstText);
    const again = await w.app.inject({
      method: "POST",
      url: "/api/v1/memory/history/restore",
      headers: w.owner(),
      payload: JSON.stringify({ id: newest!.id, baseVersion: sha(firstText) }),
    });
    expect([again.statusCode, again.json()]).toEqual([200, { path: n.rel, version: sha("dois\n") }]);

    // The inbox: the list, a proposal, a new one in each spelling, and the decision.
    w.put(memoryFile(), BASE);
    const shownId = consolidation("C80 mostrada");
    const pendingList = await same("GET", "memory/proposals?status=pending");
    expect((pendingList.body.items as Json[]).map((i) => i.id)).toContain(shownId);
    const shown = await same("GET", `memory/proposals/${shownId}`);
    expect([shown.status, shown.body.baseVersion]).toEqual([200, sha(BASE)]);
    expect(code(await same("GET", "memory/proposals/mp_ffffffffffffffff"))).toEqual([404, "not_found"]);
    const made = await both("POST", "memory/proposals", {
      kind: "fact",
      subject: "C80",
      predicate: "p",
      object: "o",
    });
    expect(made.map((r) => r.status)).toEqual([201, 201]);
    expect(keysOf(made[1].body.proposal)).toEqual(keysOf(made[0].body.proposal));
    expect(made.map((r) => [r.body.proposal.kind, r.body.proposal.status, r.body.proposal.author])).toEqual([
      ["fact", "pending", "mcp"],
      ["fact", "pending", "mcp"],
    ]);
    const rejected = await both("POST", `memory/proposals/${made[0].body.proposal.id}/decide`, {
      action: "reject",
    });
    expect(rejected.map((r) => [r.status, r.body.proposal?.status])).toEqual([
      [200, "rejected"],
      [409, undefined],
    ]);
    expect(code(rejected[1])).toEqual([409, "proposal_decided"]);
    const v1Reject = await w.app.inject({
      method: "POST",
      url: `/api/v1/memory/proposals/${made[1].body.proposal.id}/decide`,
      headers: w.owner(),
      payload: JSON.stringify({ action: "reject" }),
    });
    expect([v1Reject.statusCode, v1Reject.json().proposal.status]).toEqual([200, "rejected"]);
    expect(
      code(await same("POST", "memory/proposals/mp_ffffffffffffffff/decide", { action: "reject" })),
    ).toEqual([404, "not_found"]);
    expect(
      code(
        await same("POST", `memory/proposals/${shownId}/decide`, {
          action: "accept",
          baseVersion: sha("outro"),
        }),
      ),
    ).toEqual([409, "edit_conflict"]);
  }, 120_000);

  it("C80 each code amendment 2 gives the decision for accepting a note or a fact is one it answers, and the proposal stays pending", async () => {
    const propose = async (body: Json) => {
      const res = await w.call("POST", "/api/memory/proposals", body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.proposal.id as string;
    };
    const accept = (id: string) => w.call("POST", `/api/memory/proposals/${id}/decide`, { action: "accept" });

    // 400 unknown_area: the area the note was proposed in is no longer one of the settings' areas.
    w.update((s) => {
      s.areas = [...s.areas, "Área C80"];
    });
    const inArea = await propose({ kind: "note_create", title: "Nota de área C80", area: "Área C80" });
    w.update((s) => {
      s.areas = s.areas.filter((a) => a !== "Área C80");
    });
    expect(code(await accept(inArea))).toEqual([400, "unknown_area"]);
    expect(await statusOf(inArea)).toBe("pending");

    // 403 note_not_editable: a note's new text for a file outside memory/.
    const outside = w.put(path.join(w.indexedRoot("c80"), "fora.md"), "fora\n");
    const notEditable = await propose({
      kind: "note_save",
      path: outside,
      content: "x\n",
      baseVersion: sha("fora\n"),
    });
    expect(code(await accept(notEditable))).toEqual([403, "note_not_editable"]);
    expect(fs.readFileSync(outside, "utf8")).toBe("fora\n");

    // 404 note_missing: a note's new text for a note that is not there; it is not created.
    const gone = path.join(w.memory, "notes", "sumiu-c80.md");
    const missing = await propose({
      kind: "note_save",
      path: gone,
      content: "x\n",
      baseVersion: sha("antes\n"),
    });
    expect(code(await accept(missing))).toEqual([404, "note_missing"]);
    expect(fs.existsSync(gone)).toBe(false);

    // 409 note_exists: the ninety-nine names the note would take are taken.
    const twin = await propose({ kind: "note_create", title: "repetida" });
    for (let i = 1; i <= 99; i++)
      w.put(path.join(w.memory, "notes", `${i === 1 ? "repetida" : `repetida-${i}`}.md`), "já existe\n");
    expect(code(await accept(twin))).toEqual([409, "note_exists"]);
    expect(fs.existsSync(path.join(w.memory, "notes", "repetida-100.md"))).toBe(false);

    // 409 structure_fixed: the structure was fixed after a note in a new folder was proposed.
    const folder = await propose({ kind: "note_create", title: "Nota fixa C80", folder: "pasta-nova-c80" });
    w.update((s) => {
      s.memory.notes = { ...s.memory.notes, fixedStructure: true };
    });
    try {
      expect(code(await accept(folder))).toEqual([409, "structure_fixed"]);
      expect(fs.existsSync(path.join(w.memory, "notes", "pasta-nova-c80"))).toBe(false);
    } finally {
      w.update((s) => {
        s.memory.notes = { ...s.memory.notes, fixedStructure: false };
      });
    }

    // 409 fact_overlap: a closed fact inside an open one of the same keys and another object.
    const T = Date.UTC(2026, 0, 1);
    const DAY = 86_400_000;
    const open = await w.call("POST", "/api/memory/facts", {
      subject: "Sobreposto C80",
      predicate: "status",
      object: "ativo",
      validFrom: T,
    });
    expect(open.status).toBe(201);
    const inside = await propose({
      kind: "fact",
      subject: "Sobreposto C80",
      predicate: "status",
      object: "prospect",
      validFrom: T + DAY,
      validTo: T + 2 * DAY,
    });
    const factsBefore = state().facts;
    expect(code(await accept(inside))).toEqual([409, "fact_overlap"]);
    expect(state().facts).toEqual(factsBefore);

    for (const id of [inArea, notEditable, missing, twin, folder, inside])
      expect(await statusOf(id), id).toBe("pending");
  }, 60_000);
});

// ---- C81: who may call the seven routes ---------------------------------------------------------------------------

describe("C81 who may call the seven routes", () => {
  it("C81 EXPECTED_ROUTE_SCOPES lists the seven with door 10's scopes; a content device gets 200 from the four reads and a monitor-only one 403 scope_required; every device gets 403 owner_only from the three writes; a run's own credential, write or read-only, gets 403 forbidden from all seven; nothing changes; the run's route lists are those of the feature's base", async () => {
    for (const want of ROUTES)
      expect(EXPECTED_ROUTE_SCOPES[`${want.method} ${want.path}`], want.id).toBe(want.scope);

    w.put(memoryFile(), BASE);
    const n = await note("Quem pode C81", "um\n");
    const [version] = await versionsOf(n.rel);
    const proposal = consolidation("C81 decisão");
    const reads: Record<string, string> = {
      "GET /api/memory/history": `/api/memory/history?path=${encodeURIComponent(n.rel)}`,
      "GET /api/memory/history/:id": `/api/memory/history/${version!.id}`,
      "GET /api/memory/proposals": "/api/memory/proposals?status=pending",
      "GET /api/memory/proposals/:id": `/api/memory/proposals/${proposal}`,
    };
    expect(Object.keys(reads).sort()).toEqual(READS.map((r) => `${r.method} ${r.path}`).sort());
    /** The three writes, each as the owner would make it succeed. */
    const writes: Record<string, [string, Json]> = {
      "POST /api/memory/history/restore": [
        "/api/memory/history/restore",
        { id: version!.id, baseVersion: n.version },
      ],
      "POST /api/memory/proposals": [
        "/api/memory/proposals",
        { kind: "fact", subject: "C81", predicate: "p", object: "o" },
      ],
      "POST /api/memory/proposals/:id/decide": [
        `/api/memory/proposals/${proposal}/decide`,
        { action: "accept", baseVersion: sha(BASE) },
      ],
    };
    expect(Object.keys(writes).sort()).toEqual(WRITES.map((r) => `${r.method} ${r.path}`).sort());

    const content = w.device(["content"]);
    const monitor = w.device(["monitor"]);
    for (const [key, url] of Object.entries(reads)) {
      const ok = await w.call("GET", url, undefined, content);
      expect(ok.status, `${key} ${JSON.stringify(ok.body).slice(0, 200)}`).toBe(200);
      expect(code(await w.call("GET", url, undefined, monitor)), key).toEqual([403, "scope_required"]);
    }
    expect(
      (await w.call("GET", reads["GET /api/memory/history/:id"]!, undefined, content)).body.content,
    ).toBe(fs.readFileSync(n.file, "utf8"));
    expect((await w.call("GET", reads["GET /api/memory/proposals/:id"]!, undefined, content)).body.id).toBe(
      proposal,
    );

    const before = state();
    expect(before.proposals.length).toBeGreaterThan(0);
    expect(before.versions.length).toBeGreaterThan(0);
    const devices = {
      content,
      monitor,
      run: w.device(["run"]),
      approve: w.device(["approve"]),
      all: w.device(["content", "monitor", "run", "approve"]),
    };
    for (const [name, headers] of Object.entries(devices))
      for (const [key, [url, body]] of Object.entries(writes))
        expect(code(await w.call("POST", url, body, headers)), `${name} ${key}`).toEqual([403, "owner_only"]);
    expect(state()).toEqual(before);

    // A run's own credential, live (it reaches a route of its read list), of a write run and of a read-only one.
    for (const mode of ["write", "read_only"] as const) {
      const run = w.run(mode).headers;
      expect((await w.call("GET", "/api/memory/facts", undefined, run)).status, mode).toBe(200);
      for (const [key, url] of Object.entries(reads))
        expect(code(await w.call("GET", url, undefined, run)), `${mode} ${key}`).toEqual([403, "forbidden"]);
      for (const [key, [url, body]] of Object.entries(writes))
        expect(code(await w.call("POST", url, body, run)), `${mode} ${key}`).toEqual([403, "forbidden"]);
    }
    expect(state()).toEqual(before);

    // The owner succeeds with the same calls: the refusals above were the caller's, not the request's.
    const owned = await Promise.all(
      Object.values(writes).map(async ([url, body]) => (await w.call("POST", url, body)).status),
    );
    expect(owned).toEqual([200, 201, 200]);

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
      expect(list.filter((r) => KEYS.includes(r) || /\/api\/memory\/(history|proposals)/.test(r))).toEqual(
        [],
      );
  }, 120_000);
});

// ---- C82: docs/security.md ----------------------------------------------------------------------------------------

describe("C82 the seven routes and the agent's writes in docs/security.md", () => {
  it("C82 docs/security.md lists each of the seven in its scope's row and in no other, each row's count is the number of its routes, and it says that a run's POST /api/memory/facts becomes a proposal and that the MCP authorship mark is provenance, not containment", () => {
    const security = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const scopes = ["monitor", "content", "run", "approve", "owner"];
    const rowOf = (scope: string, page = security) =>
      page.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
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
    // four reads and three writes on top of the feature's base
    const base = atBase("docs/security.md");
    const count = (scope: string, page: string) => Number(/\((\d+)\)/.exec(rowOf(scope, page))?.[1]);
    expect([count("content", security), count("owner", security)]).toEqual([
      count("content", base) + 4,
      count("owner", base) + 3,
    ]);

    // Door 9 and the assumption on the MCP's mark, each said once in the prose.
    const prose = security.replace(/\s+/g, " ");
    for (const phrase of [
      "A run's credential that calls `POST /api/memory/facts` writes no fact: it gets `202` and a proposal",
      "the MCP tools `facts_assert`, `note_create` and `note_save` call `POST /api/memory/proposals`",
      "The authorship mark is provenance, not containment",
    ])
      expect(prose, phrase).toContain(phrase);
  });
});

// ---- C83: the response check ---------------------------------------------------------------------------------------

describe("C83 the response check over the new keys", () => {
  it("C83 with validateResponses on, a GET /api/memory/facts fact without author, a GET /api/memory/history version without origin and a GET /api/memory/proposals/:id op without trust each answer 500 response_contract_violation; with every key the same calls answer 200", async () => {
    expect(responsesValidated()).toBe(true);
    const fact = await w.call("POST", "/api/memory/facts", { subject: "C83", predicate: "p", object: "o" });
    expect(fact.status).toBe(201);
    const n = await note("Resposta C83");
    w.put(memoryFile(), BASE);
    const proposal = consolidation("C83 decisão");
    const cases: Array<[keyof typeof drop, string, string]> = [
      ["factKey", "author", "/api/memory/facts?subject=C83"],
      ["versionKey", "origin", `/api/memory/history?path=${encodeURIComponent(n.rel)}`],
      ["opKey", "trust", `/api/memory/proposals/${proposal}`],
    ];
    for (const [which, key, url] of cases) {
      const ok = await w.call("GET", url);
      expect(ok.status, url).toBe(200);
      drop[which] = key;
      try {
        const res = await w.call("GET", url);
        expect(code(res), `${url} without ${key}`).toEqual([500, "response_contract_violation"]);
        expect(res.body.error.message, key).toContain(key);
      } finally {
        drop[which] = null;
      }
      expect((await w.call("GET", url)).status, url).toBe(200);
    }
  });
});

// ---- C85: the history's setting -------------------------------------------------------------------------------------

describe("C85 memory.history.maxBytes through PUT /api/settings", () => {
  it("C85 the default is 268435456; PUT /api/settings with memory.history.maxBytes answers it, GET and the file read it back, and memory.agentStance is kept", async () => {
    const read = async () => (await w.call("GET", "/api/settings")).body;
    const file = () =>
      JSON.parse(fs.readFileSync(path.join(w.ctx.paths.config, "settings.json"), "utf8")) as Json;
    expect((await read()).memory.history).toEqual({ maxBytes: 268435456 });
    const stance = await w.call("PUT", "/api/settings", { memory: { agentStance: "contest-conflicts" } });
    expect(stance.status, JSON.stringify(stance.body)).toBe(200);
    const res = await w.call("PUT", "/api/settings", { memory: { history: { maxBytes: 1_048_576 } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const settings of [res.body.settings, await read(), file()]) {
      expect(settings.memory.history).toEqual({ maxBytes: 1_048_576 });
      expect(settings.memory.agentStance).toBe("contest-conflicts");
    }
  });
});

// ---- C86: what the earlier features answer as before ---------------------------------------------------------------

describe("C86 the earlier behaviour this feature must not change", () => {
  it('C86 "Virou realidade" asserts a fact that reads back with author owner, trust usuario and sourcePath the note', async () => {
    const n = await note("Virou realidade C86", "O curso custa 700.\n");
    await w.index();
    const res = await w.call("POST", "/api/memory/reviews", {
      path: n.file,
      action: "became_fact",
      baseVersion: n.version,
      fact: { subject: "Curso C86", predicate: "preço", object: "700" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const listed = (await w.call("GET", `/api/memory/facts?subject=${encodeURIComponent("curso c86")}`)).body
      .facts as Json[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      subject: "Curso C86",
      predicate: "preço",
      object: "700",
      author: "owner",
      trust: "usuario",
      sourcePath: n.file,
      proposalId: null,
    });
    expect(res.body.fact).toEqual(listed[0]);
  });

  it("C86 the dashboards' facts source shows an open fact and leaves out a fact retracted as wrong and one closed as ended, as the source did at the feature's base (Correções de construção)", async () => {
    const assert = async (subject: string) => {
      const res = await w.call("POST", "/api/memory/facts", { subject, predicate: "estado", object: "x" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.fact.id as number;
    };
    await assert("Aberto C86");
    const wrong = await assert("Errado C86");
    const ended = await assert("Encerrado C86");
    expect((await w.call("POST", `/api/memory/facts/${wrong}/retract`, { reason: "wrong" })).status).toBe(
      200,
    );
    expect((await w.call("POST", `/api/memory/facts/${ended}/retract`)).status).toBe(200);
    const made = await w.call("POST", "/api/dashboards", { template: "overview" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const definition = {
      ...made.body.definition,
      refresh: "manual",
      widgets: [{ id: "f", kind: "list", title: "F", source: { kind: "facts" }, options: { limit: 50 } }],
    };
    const put = await w.call("PUT", `/api/dashboards/${made.body.id}`, {
      definition,
      baseVersion: made.body.version,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const refreshed = await w.call("POST", `/api/dashboards/${made.body.id}/refresh`, {});
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    const widget = (refreshed.body.snapshot.widgets as Json[]).find((x) => x.id === "f")!;
    const subjects = (widget.data.items as Json[])
      .map((i) => i.subject as string)
      .filter((s) => ["Aberto C86", "Errado C86", "Encerrado C86"].includes(s));
    expect(subjects).toEqual(["Aberto C86"]);
  });

  it("C86 the approvals keep limits.approvalTtlDays (7 days by default) and POST /api/approvals/:id/resolve stores no proposal", async () => {
    expect(w.ctx.settings().limits.approvalTtlDays).toBe(7);
    const approval = w.ctx.approvals.request("tool_use", "Write: c86", { runId: "r-c86" });
    expect(approval.expiresAt - approval.createdAt).toBe(7 * 86_400_000);
    const proposals = state().proposals;
    const res = await w.call("POST", `/api/approvals/${approval.id}/resolve`, { decision: "denied" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(state().proposals).toEqual(proposals);
    const stale = w.ctx.approvals.request("tool_use", "Write: c86 stale", { runId: "r-c86-stale" });
    expect(w.ctx.approvals.expireStale(stale.createdAt + 7 * 86_400_000 - 1).map((a) => a.id)).not.toContain(
      stale.id,
    );
    expect(w.ctx.approvals.expireStale(stale.createdAt + 7 * 86_400_000 + 1).map((a) => a.id)).toContain(
      stale.id,
    );
    expect(state().proposals).toEqual(proposals);
  });

  it("C86 a finished run's line under ## Runs has the text of before, with no authorship mark", async () => {
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
    w.ctx.events.emit("run.finished", { runId: record.id, status: "done", durationMs: 3_000 });
    const pad = (x: number) => String(x).padStart(2, "0");
    const d = new Date();
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const lines = fs.readFileSync(path.join(w.memory, "journal", `${day}.md`), "utf8").split("\n");
    const line = lines.find((l) => l.includes(`run ${record.id} `));
    expect(line).toMatch(new RegExp(`^- \\d{2}:\\d{2} run ${record.id} → done in 3s · /organize-brain$`));
    const runs = lines.indexOf("## Runs");
    expect(runs).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf(line!)).toBeGreaterThan(runs);
  });

  it("C86 MEMORY_WRITES_PER_RUN is 100: a write run's 100 journal lines are written and the 101st is 429 too_many_requests", async () => {
    const context = fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "context.ts"), "utf8");
    expect(context).toContain("const MEMORY_WRITES_PER_RUN = 100;");
    const run = w.run("write").headers;
    for (let i = 1; i <= 100; i++) {
      const res = await w.call("POST", "/api/memory/journal/append", { text: `C86 linha ${i}` }, run);
      expect(res.status, `${i} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
    }
    expect(code(await w.call("POST", "/api/memory/journal/append", { text: "C86 linha 101" }, run))).toEqual([
      429,
      "too_many_requests",
    ]);
  }, 60_000);
});

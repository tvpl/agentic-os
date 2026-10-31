import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { openDb } from "../core/src/db/db.js";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { factKey } from "../core/src/memory/facts.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import { createBackup, restoreBackup } from "../core/src/backup.js";
import { storeProposal, writeDecision } from "../core/src/memory/proposals.js";
import { memoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * cerebro-memoria-confiavel, the migrations at their own layer: 28 (`fact-keys-and-provenance`, doors 1 to 3) over a
 * database at 27 that holds facts, and 29 (`memory-history`, door 4). A home is made at 27 with the migrations of
 * before, then opened with all of them, as an install that updates.
 */

type Json = Record<string, any>;

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

const columns = (db: Database.Database, table: string) =>
  (db.pragma(`table_info(${table})`) as Json[]).map(({ name, type, notnull }) => ({ name, type, notnull }));

/** A home whose database stops at migration 27, holding these facts (written as the code of before wrote them). */
function homeAt27(
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    from: number;
    to: number | null;
    run?: string;
  }>,
) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-memoria-m28-"));
  homes.push(home);
  const paths = resolvePaths(home);
  ensureDirs(paths);
  const { db, migration } = openDb(
    paths,
    MIGRATIONS.filter((m) => m.version <= 27),
  );
  expect(migration.toVersion).toBe(27);
  const insert = db.prepare(
    "INSERT INTO facts (subject, predicate, object, valid_from, valid_to, source_run_id, source_path, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
  );
  for (const f of facts) insert.run(f.subject, f.predicate, f.object, f.from, f.to, f.run ?? null, 1_000);
  const before = db.prepare("SELECT id, valid_from, valid_to, object FROM facts ORDER BY id").all();
  const factColumns = columns(db, "facts");
  db.close();
  return { home, paths, before, factColumns };
}

const NEW_COLUMNS = [
  { name: "subject_key", type: "TEXT", notnull: 1 },
  { name: "predicate_key", type: "TEXT", notnull: 1 },
  { name: "retracted_at", type: "INTEGER", notnull: 0 },
  { name: "source_line", type: "INTEGER", notnull: 0 },
  { name: "author", type: "TEXT", notnull: 1 },
  { name: "trust", type: "TEXT", notnull: 1 },
  { name: "proposal_id", type: "TEXT", notnull: 0 },
];

describe("C5 migration 28 gives every fact its keys", () => {
  it("C5 the new columns and idx_facts_key; every row's keys by factKey; valid_from, valid_to and object as before; the two open facts sharing keys stay open; then the route closes both", async () => {
    const world = homeAt27([
      { subject: "Cliente  São Paulo", predicate: "status", object: "a", from: 1_000, to: null },
      { subject: "cliente sao paulo", predicate: "Status", object: "b", from: 2_000, to: null },
      { subject: "Outro", predicate: "é", object: "c", from: 1_000, to: 5_000 },
    ]);
    const { db, migration } = openDb(world.paths);
    try {
      expect(migration.fromVersion).toBe(27);
      expect(MIGRATIONS.find((m) => m.version === 28)!.name).toBe("fact-keys-and-provenance");
      expect(MIGRATIONS.find((m) => m.version === 26)!.name).toBe("dashboards");
      expect(MIGRATIONS.find((m) => m.version === 27)!.name).toBe("notification-reminder");
      expect(columns(db, "facts")).toEqual([...world.factColumns, ...NEW_COLUMNS]);
      expect((db.pragma("index_info(idx_facts_key)") as Json[]).map((c) => c.name)).toEqual([
        "subject_key",
        "predicate_key",
      ]);
      const rows = db.prepare("SELECT * FROM facts ORDER BY id").all() as Json[];
      expect(rows.map((r) => [r.subject_key, r.predicate_key])).toEqual(
        rows.map((r) => [factKey(r.subject), factKey(r.predicate)]),
      );
      expect(rows.map((r) => [r.subject_key, r.predicate_key])).toEqual([
        ["cliente sao paulo", "status"],
        ["cliente sao paulo", "status"],
        ["outro", "e"],
      ]);
      expect(db.prepare("SELECT id, valid_from, valid_to, object FROM facts ORDER BY id").all()).toEqual(
        world.before,
      );
      expect(rows.slice(0, 2).map((r) => r.valid_to)).toEqual([null, null]);
      // the migration again leaves the same schema and rows
      const again = db.prepare("SELECT * FROM facts ORDER BY id").all();
      MIGRATIONS.find((m) => m.version === 28)!.up!(db);
      expect(db.prepare("SELECT * FROM facts ORDER BY id").all()).toEqual(again);
      expect(columns(db, "facts")).toEqual([...world.factColumns, ...NEW_COLUMNS]);
    } finally {
      db.close();
    }

    // second pass (L-059): the route's key over the migrated rows is the backfilled one
    const ctx = new AppContext(world.home);
    const app = await buildServer(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/facts",
        headers: { "x-mordomo-token": ctx.token(), "content-type": "application/json" },
        payload: { subject: "CLIENTE SÃO PAULO", predicate: "STATUS", object: "c", validFrom: 3_000 },
      });
      expect(res.statusCode, res.body).toBe(201);
      const invalidated = (res.json().invalidated as Json[]).map((f) => [f.object, f.validTo]);
      expect(invalidated.sort()).toEqual([
        ["a", 3_000],
        ["b", 3_000],
      ]);
    } finally {
      await app.close();
      ctx.close();
    }
  });
});

describe("C6 migration 28 gives every fact an author and a trust", () => {
  it("C6 run:r-1 for the row of source_run_id r-1, unknown for one with none, inferido for both, read back through GET /api/memory/facts", async () => {
    const world = homeAt27([
      { subject: "Com execução", predicate: "p", object: "x", from: 1_000, to: null, run: "r-1" },
      { subject: "Sem execução", predicate: "p", object: "y", from: 1_000, to: null },
    ]);
    const ctx = new AppContext(world.home);
    const app = await buildServer(ctx);
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/memory/facts?includeExpired=true",
        headers: { "x-mordomo-token": ctx.token() },
      });
      expect(res.statusCode, res.body).toBe(200);
      const facts = (res.json().facts as Json[]).map((f) => [f.subject, f.author, f.trust]).sort();
      expect(facts).toEqual([
        ["Com execução", "run:r-1", "inferido"],
        ["Sem execução", "unknown", "inferido"],
      ]);
    } finally {
      await app.close();
      ctx.close();
    }
  });
});

describe("C37 migration 29 makes the two tables of the history", () => {
  const full = (db: Database.Database, table: string) =>
    (db.pragma(`table_info(${table})`) as Json[]).map(({ name, type, notnull, pk }) => ({
      name,
      type,
      notnull,
      pk,
    }));

  it("C37 memory_blobs and memory_versions with door 4's columns, AUTOINCREMENT on id, the index on (path, id), created empty; again leaves them so", () => {
    const world = homeAt27([]);
    const { db, migration } = openDb(world.paths);
    try {
      expect(migration.fromVersion).toBe(27);
      expect(MIGRATIONS.find((m) => m.version === 29)!.name).toBe("memory-history");
      const want = {
        blobs: [
          { name: "sha256", type: "TEXT", notnull: 0, pk: 1 },
          { name: "codec", type: "TEXT", notnull: 1, pk: 0 },
          { name: "size", type: "INTEGER", notnull: 1, pk: 0 },
          { name: "bytes", type: "BLOB", notnull: 1, pk: 0 },
        ],
        versions: [
          { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
          { name: "path", type: "TEXT", notnull: 1, pk: 0 },
          { name: "sha256", type: "TEXT", notnull: 0, pk: 0 },
          { name: "at", type: "INTEGER", notnull: 1, pk: 0 },
          { name: "author", type: "TEXT", notnull: 1, pk: 0 },
          { name: "origin", type: "TEXT", notnull: 1, pk: 0 },
          { name: "proposal_id", type: "TEXT", notnull: 0, pk: 0 },
        ],
        index: ["path", "id"],
        autoincrement: true,
        rows: [0, 0],
      };
      const schema = () => ({
        blobs: full(db, "memory_blobs"),
        versions: full(db, "memory_versions"),
        index: (db.pragma("index_info(idx_memory_versions_path)") as Json[]).map((c) => c.name),
        autoincrement: /AUTOINCREMENT/i.test(
          (
            db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_versions'").get() as {
              sql: string;
            }
          ).sql,
        ),
        rows: ["memory_blobs", "memory_versions"].map(
          (t) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c,
        ),
      });
      expect(schema()).toEqual(want);
      db.exec(MIGRATIONS.find((m) => m.version === 29)!.sql!);
      expect(schema()).toEqual(want);
    } finally {
      db.close();
    }
  });
});

describe("C79 migration 30 makes the review inbox", () => {
  const full = (db: Database.Database, table: string) =>
    (db.pragma(`table_info(${table})`) as Json[]).map(({ name, type, notnull, pk }) => ({
      name,
      type,
      notnull,
      pk,
    }));

  it("C79 memory_proposals with door 5's columns, created empty; again leaves it so", () => {
    const world = homeAt27([]);
    const { db, migration } = openDb(world.paths);
    try {
      expect(migration).toMatchObject({ fromVersion: 27, toVersion: 30 });
      expect(MIGRATIONS.find((m) => m.version === 30)!.name).toBe("memory-proposals");
      const want = [
        { name: "id", type: "TEXT", notnull: 0, pk: 1 },
        { name: "kind", type: "TEXT", notnull: 1, pk: 0 },
        { name: "status", type: "TEXT", notnull: 1, pk: 0 },
        { name: "author", type: "TEXT", notnull: 1, pk: 0 },
        { name: "run_id", type: "TEXT", notnull: 0, pk: 0 },
        { name: "created_at", type: "INTEGER", notnull: 1, pk: 0 },
        { name: "decided_at", type: "INTEGER", notnull: 0, pk: 0 },
        { name: "summary", type: "TEXT", notnull: 1, pk: 0 },
        { name: "payload", type: "TEXT", notnull: 1, pk: 0 },
        { name: "result", type: "TEXT", notnull: 0, pk: 0 },
      ];
      expect(full(db, "memory_proposals")).toEqual(want);
      expect((db.prepare("SELECT COUNT(*) c FROM memory_proposals").get() as Json).c).toBe(0);
      // no foreign key: a run that goes takes nothing with it
      expect(db.pragma("foreign_key_list(memory_proposals)")).toEqual([]);
      db.exec(MIGRATIONS.find((m) => m.version === 30)!.sql!);
      expect(full(db, "memory_proposals")).toEqual(want);
    } finally {
      db.close();
    }
  });

  it("C79 the writer refuses a kind, a status and an author outside the closed sets", () => {
    const world = homeAt27([]);
    const { db } = openDb(world.paths);
    try {
      const ok = { kind: "fact" as const, author: "mcp", summary: "s", payload: {} };
      expect(() => storeProposal(db, { ...ok, kind: "rename" as never })).toThrow(/kind/);
      expect(() => storeProposal(db, { ...ok, author: "owner" })).toThrow(/author/);
      expect(() => storeProposal(db, { ...ok, author: "run:" })).toThrow(/author/);
      const stored = storeProposal(db, ok);
      expect(() => writeDecision(db, stored.id, "expired" as never, 1, {})).toThrow(/status|decision/i);
      expect(() => writeDecision(db, stored.id, "pending", 1, {})).toThrow(/decision/i);
      expect(db.prepare("SELECT kind, status, author FROM memory_proposals").all() as Json[]).toEqual([
        { kind: "fact", status: "pending", author: "mcp" },
      ]);
    } finally {
      db.close();
    }
  });

  it("C79 a proposal whose run was pruned by limits.runRetentionDays reads back with its runId, and the fact accepted from it keeps proposalId", async () => {
    const w = await memoriaWorld("mordomo-memoria-m30-");
    try {
      const run = w.run("write");
      const res = await w.call(
        "POST",
        "/api/memory/facts",
        { subject: "Podada", predicate: "p", object: "o" },
        run.headers,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const id = res.body.proposal.id as string;
      const old = Date.now() - 400 * 86_400_000;
      w.ctx.db
        .prepare("UPDATE runs SET status = 'done', finished_at = ?, created_at = ? WHERE id = ?")
        .run(old, old, run.runId);
      w.ctx.runs.prune({ keepRunDays: w.ctx.settings().limits.runRetentionDays, vacuum: false });
      expect(w.ctx.runs.get(run.runId)).toBeNull();
      const shown = await w.call("GET", `/api/memory/proposals/${id}`);
      expect(shown.status).toBe(200);
      expect(shown.body).toMatchObject({ id, runId: run.runId, author: `run:${run.runId}` });
      const done = await w.call("POST", `/api/memory/proposals/${id}/decide`, { action: "accept" });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const facts = (await w.call("GET", "/api/memory/facts?subject=podada")).body.facts as Json[];
      expect(facts.map((f) => [f.proposalId, f.author, f.sourceRunId])).toEqual([
        [id, `run:${run.runId}`, run.runId],
      ]);
    } finally {
      await w.close();
    }
  });
});

describe("C39 a backup carries the history and the migrations run on restore", () => {
  /** A fresh home, at the latest schema, with the backup `name` of `from` copied into its backups. */
  const freshWith = (from: ReturnType<typeof resolvePaths>, name: string) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-memoria-c39-fresh-"));
    homes.push(home);
    const paths = resolvePaths(home);
    ensureDirs(paths);
    openDb(paths).db.close();
    fs.cpSync(path.join(from.backups, name), path.join(paths.backups, name), { recursive: true });
    return paths;
  };

  it("C39 a backup made after versions exist, restored over a fresh home, answers the history with the same versions and a version with the same content", async () => {
    const w = await memoriaWorld("mordomo-memoria-c39-");
    let paths: ReturnType<typeof resolvePaths>;
    let versions: Json[];
    let one: Json;
    try {
      const note = await w.call("POST", "/api/memory/notes", { title: "Nota C39", content: "primeira" });
      expect(note.status).toBe(201);
      const saved = await w.call("PUT", "/api/memory/notes", {
        path: note.body.path,
        content: "# Nota C39\n\nsegunda\n",
        baseVersion: note.body.version,
      });
      expect(saved.status).toBe(200);
      versions = (await w.call("GET", "/api/memory/history")).body.versions as Json[];
      expect(versions.length).toBeGreaterThanOrEqual(2);
      one = (await w.call("GET", `/api/memory/history/${versions.at(-1)!.id}`)).body as Json;
      const backup = await createBackup(w.ctx.paths, w.ctx.db);
      paths = freshWith(w.ctx.paths, backup.name);
      restoreBackup(paths, backup.name);
    } finally {
      await w.close();
    }
    const ctx = new AppContext(paths!.home);
    const app = await buildServer(ctx);
    try {
      const headers = { "x-mordomo-token": ctx.token() };
      const listed = await app.inject({ method: "GET", url: "/api/memory/history", headers });
      expect(listed.statusCode, listed.body).toBe(200);
      const strip = (v: Json) => ({
        id: v.id,
        path: v.path,
        at: v.at,
        author: v.author,
        origin: v.origin,
        sha256: v.sha256,
        size: v.size,
      });
      expect((listed.json().versions as Json[]).map(strip)).toEqual(versions!.map(strip));
      const got = await app.inject({ method: "GET", url: `/api/memory/history/${one!.id}`, headers });
      expect(got.statusCode).toBe(200);
      expect(got.json().content).toBe(one!.content);
    } finally {
      await app.close();
      ctx.close();
    }
  });

  it("C39 a backup made at schema 27 with facts, restored, opens at 30 with the facts' keys filled and author unknown", async () => {
    const world = homeAt27([
      { subject: "Cliente  São Paulo", predicate: "Status", object: "ativo", from: 1_000, to: null },
    ]);
    const { db } = openDb(
      world.paths,
      MIGRATIONS.filter((m) => m.version <= 27),
    );
    let name: string;
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(27);
      name = (await createBackup(world.paths, db)).name;
    } finally {
      db.close();
    }
    const paths = freshWith(world.paths, name!);
    restoreBackup(paths, name!);
    const opened = openDb(paths);
    try {
      expect(opened.migration).toMatchObject({ fromVersion: 27, toVersion: 30 });
      expect(opened.db.pragma("user_version", { simple: true })).toBe(30);
      expect(opened.db.prepare("SELECT subject_key, predicate_key, author, trust FROM facts").all()).toEqual([
        { subject_key: "cliente sao paulo", predicate_key: "status", author: "unknown", trust: "inferido" },
      ]);
      expect((opened.db.prepare("SELECT COUNT(*) c FROM memory_proposals").get() as Json).c).toBe(0);
    } finally {
      opened.db.close();
    }
  });
});

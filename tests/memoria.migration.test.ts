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

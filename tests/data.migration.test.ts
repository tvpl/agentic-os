import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { DbNewerVersionError, MigrationError } from "@mordomo/core";
import { MIGRATIONS, openDb, tightenHomeFiles, tightenMode } from "@mordomo/core/internal";
import { makeTempHome } from "./helpers.js";
import { bundleChild, repoRoot, runChild, src } from "./helpers/childBundle.js";
import { slowMigrations } from "./helpers/slowMigrations.js";

/**
 * dados-v2, slice S1 (.specs/features/dados-v2): the database is migrated once, however many processes open it
 * together, and a migration that cannot finish leaves the file as it was.
 */

const POSIX = process.platform !== "win32";
const homes: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of homes.splice(0)) cleanup();
});
function tempHome() {
  const home = makeTempHome("mordomo-dados-mig-");
  homes.push(home.cleanup);
  return home;
}

/** A home whose database holds `ran` = [1] at `user_version` 1 (what an older release left behind). */
function homeAtVersion1() {
  const home = tempHome();
  const first = openDb(home.paths, slowMigrations().slice(0, 1));
  first.db.close();
  return home;
}

interface ChildOutcome {
  fromVersion: number;
  toVersion: number;
  backupPath: string | null;
  version: number;
}

let cleanupRace: (() => void) | undefined;
let racing: Promise<{ paths: ReturnType<typeof tempHome>["paths"]; outcomes: ChildOutcome[] }> | undefined;
/** Three processes open the same version-1 home at the same instant, once for the whole file. */
function race() {
  racing ??= (async () => {
    const script = await bundleChild(
      "open-db",
      [
        `import { openDb } from ${src("core/src/db/db.ts")};`,
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { slowMigrations } from ${src("tests/helpers/slowMigrations.ts")};`,
        `import { barrier } from ${src("tests/helpers/barrier.ts")};`,
        'barrier(process.env.BARRIER_DIR, "open", 3);',
        "const { db, migration } = openDb(resolvePaths(process.env.HOME_DIR), slowMigrations());",
        'process.stdout.write(JSON.stringify({ ...migration, version: db.pragma("user_version", { simple: true }) }));',
        "db.close();",
      ].join("\n"),
    );
    const home = makeTempHome("mordomo-dados-race-");
    cleanupRace = home.cleanup;
    openDb(home.paths, slowMigrations().slice(0, 1)).db.close();
    const barrierDir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-barrier-"));
    const results = await Promise.all(
      [0, 1, 2].map(() => runChild(script, { HOME_DIR: home.paths.home, BARRIER_DIR: barrierDir })),
    );
    fs.rmSync(barrierDir, { recursive: true, force: true });
    for (const r of results) expect(r.code, r.stderr).toBe(0);
    return { paths: home.paths, outcomes: results.map((r) => JSON.parse(r.stdout) as ChildOutcome) };
  })();
  return racing;
}

describe("S1 the database is migrated once", () => {
  // The race is built once and shared by C1 and C3, so its home outlives each test.
  afterAll(() => cleanupRace?.());

  it("C1 three processes opening together apply each migration once", async () => {
    const { paths, outcomes } = await race();
    for (const outcome of outcomes) expect(outcome.version).toBe(3);
    const db = new Database(paths.dbFile, { readonly: true });
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(3);
      expect(db.prepare("SELECT v FROM ran ORDER BY v").all()).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    } finally {
      db.close();
    }
  }, 60_000);

  it("C2 the pre-migration snapshot is consistent and private", () => {
    const { paths } = homeAtVersion1();
    const seed = new Database(paths.dbFile);
    seed.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('keep me')");
    seed.close();

    const { db, migration } = openDb(paths, slowMigrations().slice(0, 2));
    try {
      expect(migration.fromVersion).toBe(1);
      expect(migration.toVersion).toBe(2);
      expect(migration.backupPath).toMatch(/mordomo\.db\.v1\.[^/\\]+\.bak$/);
      expect(path.dirname(migration.backupPath!)).toBe(paths.backups);
      const snapshot = new Database(migration.backupPath!, { readonly: true });
      try {
        expect(snapshot.pragma("user_version", { simple: true })).toBe(1);
        expect(snapshot.prepare("SELECT body FROM notes").all()).toEqual([{ body: "keep me" }]);
        expect(snapshot.prepare("SELECT name FROM sqlite_master WHERE name = 'second'").all()).toEqual([]);
      } finally {
        snapshot.close();
      }
      if (POSIX) expect(fs.statSync(migration.backupPath!).mode & 0o777).toBe(0o600);
    } finally {
      db.close();
    }
  });

  it("C3 the processes that lost the race apply nothing and leave no backup", async () => {
    const { paths, outcomes } = await race();
    const migrated = outcomes.filter((o) => o.fromVersion === 1);
    const waited = outcomes.filter((o) => o.fromVersion !== 1);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ fromVersion: 1, toVersion: 3 });
    expect(waited).toHaveLength(2);
    for (const outcome of waited) {
      expect(outcome).toMatchObject({ fromVersion: 3, toVersion: 3, backupPath: null });
    }
    expect(fs.readdirSync(paths.backups).filter((name) => name.endsWith(".bak"))).toHaveLength(1);
  }, 60_000);

  it("C4 a failing migration rolls everything back and names itself", () => {
    const { paths } = homeAtVersion1();
    let thrown: unknown;
    try {
      openDb(paths, slowMigrations({ failAt3: true }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MigrationError);
    const error = thrown as MigrationError;
    expect(error.code).toBe("db_migration_failed");
    expect(error.message).toContain("3");
    expect(error.message).toContain("boom-migration");
    expect(error.backupPath).not.toBeNull();
    expect(error.message).toContain(error.backupPath!);

    const raw = new Database(paths.dbFile, { readonly: true });
    try {
      expect(raw.pragma("user_version", { simple: true })).toBe(1);
      const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>;
      expect(tables.map((t) => t.name)).not.toContain("second");
      expect(tables.map((t) => t.name)).not.toContain("third");
      expect(raw.prepare("SELECT v FROM ran").all()).toEqual([{ v: 1 }]);
    } finally {
      raw.close();
    }
    // The handle was closed and the file is usable: the corrected list goes through to 3.
    const again = openDb(paths, slowMigrations());
    try {
      expect(again.migration).toMatchObject({ fromVersion: 1, toVersion: 3 });
    } finally {
      again.db.close();
    }
  });

  it("C5 a database from a newer version is refused untouched", () => {
    const { paths } = tempHome();
    openDb(paths).db.close();
    const raw = new Database(paths.dbFile);
    raw.pragma("user_version = 99");
    raw.close();
    const digest = () => crypto.createHash("sha256").update(fs.readFileSync(paths.dbFile)).digest("hex");
    const before = digest();

    let thrown: unknown;
    try {
      openDb(paths);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DbNewerVersionError);
    const error = thrown as DbNewerVersionError;
    expect(error.code).toBe("db_newer");
    expect(error.message).toContain("99");
    expect(error.message).toContain(String(Math.max(...MIGRATIONS.map((m) => m.version))));
    expect(error.message).toContain("Use that version or restore a compatible backup");
    expect(fs.existsSync(paths.backups) ? fs.readdirSync(paths.backups) : []).toEqual([]);
    expect(digest()).toBe(before);
  });

  it("C6 openDb waits for a busy lock, also before WAL", async () => {
    const { paths } = tempHome();
    fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });
    // What an older release left: rollback-journal mode, version 1.
    const legacy = new Database(paths.dbFile);
    legacy.exec("CREATE TABLE ran (v INTEGER NOT NULL); INSERT INTO ran VALUES (1)");
    legacy.pragma("user_version = 1");
    expect(legacy.pragma("journal_mode", { simple: true })).toBe("delete");
    legacy.close();

    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const D = require("better-sqlite3"); const db = new D(${JSON.stringify(paths.dbFile)}); ` +
          'db.exec("BEGIN EXCLUSIVE"); process.stdout.write("locked\\n"); ' +
          'setTimeout(() => { db.exec("COMMIT"); db.close(); }, 600);',
      ],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.once("data", () => resolve());
        holder.once("error", reject);
        holder.once("exit", (code) => reject(new Error(`holder exited ${code} before locking`)));
      });
      const started = Date.now();
      const opened = openDb(paths, slowMigrations().slice(0, 2));
      const waited = Date.now() - started;
      try {
        expect(waited).toBeGreaterThanOrEqual(400);
        expect(waited).toBeLessThan(5000);
        expect(opened.db.pragma("user_version", { simple: true })).toBe(2);
        expect(opened.db.pragma("journal_mode", { simple: true })).toBe("wal");
      } finally {
        opened.db.close();
      }
    } finally {
      holder.kill("SIGKILL");
    }
  }, 30_000);

  it("C7 MIGRATIONS is contiguous", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, index) => index + 1));
  });

  it("C8 fresh and up-to-date databases open without a backup", () => {
    const { paths } = tempHome();
    const latest = MIGRATIONS.length;
    const fresh = openDb(paths);
    fresh.db.close();
    expect(fresh.migration).toEqual({ fromVersion: 0, toVersion: latest, backupPath: null });
    const again = openDb(paths);
    again.db.close();
    expect(again.migration).toEqual({ fromVersion: latest, toVersion: latest, backupPath: null });
    expect(fs.existsSync(paths.backups) ? fs.readdirSync(paths.backups) : []).toEqual([]);
  });

  it.skipIf(!POSIX)("C43 tightening never opens a file that already has its mode", () => {
    const { paths } = tempHome();
    const dir = path.dirname(paths.dbFile);
    const right = path.join(dir, "right");
    const wrong = path.join(dir, "wrong");
    const link = path.join(dir, "link");
    fs.writeFileSync(right, "x", { mode: 0o600 });
    fs.writeFileSync(wrong, "x", { mode: 0o644 });
    fs.chmodSync(wrong, 0o644);
    fs.symlinkSync(wrong, link);

    const opened: string[] = [];
    const open = fs.openSync.bind(fs);
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      opened.push(String(p));
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    try {
      expect(tightenMode(right, 0o600)).toBe(false);
      expect(tightenMode(link, 0o600)).toBe(false);
      expect(opened).toEqual([]);
      expect(tightenMode(wrong, 0o600)).toBe(true);
      expect(opened).toEqual([wrong]);
      expect(fs.statSync(wrong).mode & 0o777).toBe(0o600);
    } finally {
      spy.mockRestore();
    }

    // An older release left the database and its sidecars at 0644: they are tightened before the connection
    // opens, and once it is open the engine's own tightening pass leaves all three alone.
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.writeFileSync(paths.dbFile + suffix, "", { mode: 0o644 });
      fs.chmodSync(paths.dbFile + suffix, 0o644);
    }
    const { db } = openDb(paths);
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        expect(fs.statSync(paths.dbFile + suffix).mode & 0o777, suffix || "main").toBe(0o600);
      }
      const touched: string[] = [];
      const spy2 = vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
        touched.push(String(p));
        return (open as (...a: unknown[]) => number)(p, ...rest);
      }) as typeof fs.openSync);
      try {
        tightenHomeFiles(paths);
      } finally {
        spy2.mockRestore();
      }
      expect(touched.filter((p) => p.startsWith(paths.dbFile))).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("C51 a newer database with a WAL still pending is refused with its bytes and mode untouched", () => {
    const { paths } = tempHome();
    // What a service killed mid-flight leaves: the version only a WAL knows, copied while its writer was open.
    const other = tempHome();
    fs.mkdirSync(path.dirname(other.paths.dbFile), { recursive: true });
    const live = new Database(other.paths.dbFile);
    live.pragma("journal_mode = WAL");
    live.pragma("wal_autocheckpoint = 0");
    live.exec("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1)");
    live.pragma("user_version = 99");
    fs.mkdirSync(path.dirname(paths.dbFile), { recursive: true });
    fs.copyFileSync(other.paths.dbFile, paths.dbFile);
    fs.copyFileSync(`${other.paths.dbFile}-wal`, `${paths.dbFile}-wal`);
    live.close();
    for (const file of [paths.dbFile, `${paths.dbFile}-wal`]) fs.chmodSync(file, 0o644);
    const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const before = { main: digest(paths.dbFile), wal: digest(`${paths.dbFile}-wal`) };

    expect(() => openDb(paths)).toThrow(DbNewerVersionError);
    expect({ main: digest(paths.dbFile), wal: digest(`${paths.dbFile}-wal`) }).toEqual(before);
    if (POSIX) {
      for (const file of [paths.dbFile, `${paths.dbFile}-wal`]) {
        expect(fs.statSync(file).mode & 0o777, file).toBe(0o644);
      }
    }
  });

  it("C52 the pre-migration snapshot holds what only the WAL holds, even with a reader open", () => {
    const { paths } = homeAtVersion1();
    // Rows that live only in the WAL (its writer never checkpoints), and a reader whose open snapshot keeps a
    // checkpoint from finishing: a checkpoint-then-copy of the file would miss the rows and tear the copy.
    const reader = new Database(paths.dbFile);
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) FROM ran").get(); // its snapshot is older than the rows written next
    const writer = new Database(paths.dbFile);
    writer.pragma("wal_autocheckpoint = 0");
    writer.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('only in the wal')");
    try {
      const { db, migration } = openDb(paths, slowMigrations().slice(0, 2));
      try {
        const snapshot = new Database(migration.backupPath!, { readonly: true });
        try {
          expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
          expect(snapshot.pragma("user_version", { simple: true })).toBe(1);
          expect(snapshot.prepare("SELECT body FROM notes").all()).toEqual([{ body: "only in the wal" }]);
        } finally {
          snapshot.close();
        }
      } finally {
        db.close();
      }
    } finally {
      reader.exec("ROLLBACK");
      reader.close();
      writer.close();
    }
  });

  it("C71 the version is read without SQLite when no WAL waits (no -shm appears), and only a missing or empty file is version 0", () => {
    // A newer database closed cleanly: no WAL. Refused with the folder exactly as it was.
    const clean = tempHome();
    openDb(clean.paths).db.close();
    const raw = new Database(clean.paths.dbFile);
    raw.pragma("user_version = 99");
    raw.close();
    const listing = () => fs.readdirSync(path.dirname(clean.paths.dbFile)).sort();
    const before = listing();
    expect(before).not.toContain("mordomo.db-shm");
    // The version is the 4 bytes big-endian at offset 60 of the header: that is where the file says 99.
    const header = Buffer.alloc(4);
    const fd = fs.openSync(clean.paths.dbFile, "r");
    fs.readSync(fd, header, 0, 4, 60);
    fs.closeSync(fd);
    expect(header.readUInt32BE(0)).toBe(99);
    // A refused database is not touched in any way - its mode included: a file an older release left at 0644
    // stays at 0644 (tightening it is part of opening it, and it is not opened).
    if (process.platform !== "win32") fs.chmodSync(clean.paths.dbFile, 0o644);
    const bytes = fs.readFileSync(clean.paths.dbFile);
    expect(() => openDb(clean.paths)).toThrow(DbNewerVersionError);
    expect(listing()).toEqual(before);
    expect(fs.readFileSync(clean.paths.dbFile).equals(bytes)).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(clean.paths.dbFile).mode & 0o777).toBe(0o644);

    // Missing, and empty: no database yet, so they open fresh.
    const missing = tempHome();
    expect(openDb(missing.paths).migration.fromVersion).toBe(0);
    const empty = tempHome();
    fs.mkdirSync(path.dirname(empty.paths.dbFile), { recursive: true });
    fs.writeFileSync(empty.paths.dbFile, "");
    expect(openDb(empty.paths).migration.fromVersion).toBe(0);

    // Not a database at all: not "version 0". The normal open reports it, and nothing is made of it.
    const junk = tempHome();
    fs.mkdirSync(path.dirname(junk.paths.dbFile), { recursive: true });
    fs.writeFileSync(
      junk.paths.dbFile,
      "this is not a sqlite database, only text that is long enough to be read",
    );
    expect(() => openDb(junk.paths)).toThrow(/not a database/i);
    expect(fs.readFileSync(junk.paths.dbFile, "utf8")).toContain("this is not a sqlite database");
    expect(fs.existsSync(`${junk.paths.dbFile}-wal`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// cerebro-v2: migration 20 (`note_links`, door 1)

describe("C30 migration 20 on a database that already holds an index", () => {
  it("C30 creates note_links empty, changes no row, and the first pass fills it from the stored text without opening a file", async () => {
    const { AppContext } = await import("../apps/api/src/context.js");
    const home = tempHome();
    const memory = home.paths.memory;
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(memory, rel)), { recursive: true });
      fs.writeFileSync(path.join(memory, rel), text);
    };
    write("a.md", "# A\n\n[[b]] e [x](./c.md)\n");
    write("b.md", "# B\n\n```\n[[nao]]\n```\n[[a|volta]]\n");
    write("c.md", "sem links\n");
    write("pasta/d.txt", "[[b]] num arquivo que não é Markdown\n");

    const first = new AppContext(home.paths.home);
    first.indexer.indexAll();
    const links = (db: Database.Database) =>
      db
        .prepare("SELECT src_id, kind, target, label, line FROM note_links ORDER BY src_id, line, rowid")
        .all();
    const expected = links(first.db);
    expect(expected.length).toBe(3); // two in a.md, one in b.md (the fenced one and the .txt file give none)
    const dump = (db: Database.Database) => ({
      files: db.prepare("SELECT * FROM files ORDER BY id").all(),
      fts: db.prepare("SELECT rowid, name, rel, content FROM files_fts ORDER BY rowid").all(),
    });
    first.close();

    // the state a release before migration 20 left: no table, no marker, version 19
    const old = new Database(home.paths.dbFile);
    old.exec("DROP TABLE note_links");
    old.prepare("DELETE FROM meta WHERE key = 'index.note_links'").run();
    old.pragma("user_version = 19");
    const before = dump(old);
    old.close();

    const second = new AppContext(home.paths.home);
    try {
      expect(second.db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(20);
      expect(links(second.db)).toEqual([]);
      expect(dump(second.db)).toEqual(before);

      const opened: string[] = [];
      const realOpen = fs.openSync;
      vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
        if (String(file).startsWith(memory)) opened.push(String(file));
        return (realOpen as (...a: unknown[]) => number)(file, ...rest);
      }) as typeof fs.openSync);
      second.indexer.indexAll();
      vi.restoreAllMocks();
      expect(opened).toEqual([]);
      expect(links(second.db)).toEqual(expected);

      // twice: the migration SQL again, and a second pass, leave the same rows
      const sql = MIGRATIONS.find((m) => m.version === 20)!.sql!;
      second.db.exec(sql);
      second.db.exec(sql);
      expect(links(second.db)).toEqual(expected);
      second.indexer.indexAll();
      expect(links(second.db)).toEqual(expected);
      second.db.prepare("DELETE FROM meta WHERE key = 'index.note_links'").run();
      second.indexer.indexAll();
      expect(links(second.db)).toEqual(expected);
    } finally {
      second.close();
    }
  });

  it("C56 note_links has exactly the shape of door 1: columns, key and index", () => {
    const home = tempHome();
    const { db } = openDb(home.paths);
    try {
      const columns = (
        db.pragma("table_info(note_links)") as Array<{
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }>
      ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
      expect(columns).toEqual([
        { name: "src_id", type: "INTEGER", notnull: 1, pk: 1 },
        { name: "kind", type: "TEXT", notnull: 1, pk: 2 },
        { name: "target", type: "TEXT", notnull: 1, pk: 3 },
        { name: "label", type: "TEXT", notnull: 0, pk: 0 },
        { name: "line", type: "INTEGER", notnull: 1, pk: 4 },
      ]);
      const indexes = (
        db.pragma("index_list(note_links)") as Array<{ name: string; unique: number; origin: string }>
      )
        .map(({ name, unique, origin }) => ({ name, unique, origin }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(indexes.map((i) => [i.origin, i.unique])).toEqual([
        ["c", 0],
        ["pk", 1],
      ]);
      expect(indexes.find((i) => i.origin === "c")!.name).toBe("idx_note_links_target");
      expect(
        (db.pragma("index_info(idx_note_links_target)") as Array<{ name: string }>).map((c) => c.name),
      ).toEqual(["kind", "target"]);
    } finally {
      db.close();
    }
  });

  it("C56 file_vectors has exactly the shape of door 2, and the database ends at the last migration (23 since cerebro-contextos)", () => {
    const home = tempHome();
    const { db } = openDb(home.paths);
    try {
      const columns = (
        db.pragma("table_info(file_vectors)") as Array<{
          name: string;
          type: string;
          notnull: number;
          pk: number;
        }>
      ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));
      expect(columns).toEqual([
        { name: "file_id", type: "INTEGER", notnull: 0, pk: 1 },
        { name: "provider", type: "TEXT", notnull: 1, pk: 0 },
        { name: "dim", type: "INTEGER", notnull: 1, pk: 0 },
        { name: "vec", type: "BLOB", notnull: 1, pk: 0 },
        { name: "mtime", type: "INTEGER", notnull: 1, pk: 0 },
        { name: "size", type: "INTEGER", notnull: 1, pk: 0 },
      ]);
      // not a vec0 virtual table: it needs no extension to exist
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'file_vectors'").get() as {
        sql: string;
      };
      expect(table.sql).not.toMatch(/virtual|vec0/i);
      // cerebro-correcoes added migration 22 (the end of file_links) after these two, cerebro-contextos 23 (the
      // work context of a run and of a conversation), cerebro-faxina-guiada 24 (the signatures and the decisions of
      // the cleanup), cerebro-natureza 25 (the passages of a note and the review state of a file), and cerebro-paineis
      // 26 (the tasks of a note, the snapshots and the series of the dashboards)
      expect(db.pragma("user_version", { simple: true })).toBe(26);
      expect(MIGRATIONS.at(-1)!.version).toBe(26);
      expect(MIGRATIONS.slice(-7).map((m) => m.name)).toEqual([
        "note-links",
        "file-vectors",
        "drop-file-links",
        "run-context",
        "cleanup",
        "natureza",
        "dashboards",
      ]);
      // the migration SQL twice leaves the table as it was
      const sql = MIGRATIONS.find((m) => m.version === 21)!.sql!;
      db.exec(sql);
      db.exec(sql);
      expect((db.pragma("table_info(file_vectors)") as unknown[]).length).toBe(6);
    } finally {
      db.close();
    }
  });
});

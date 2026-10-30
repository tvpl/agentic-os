import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import type { Settings } from "../core/src/config/schema.js";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { cleanupInventory, resolveCleanupScope, type CleanupInventory } from "../core/src/memory/cleanup.js";
import {
  scanCleanupScope,
  type CleanupFinding,
  type CleanupScanRecord,
} from "../core/src/memory/cleanupScan.js";
import {
  CleanupNotFoundError,
  CleanupScanStaleError,
  CleanupUndoConflictError,
  CleanupValidationError,
  applyCleanup,
  cleanupDecisionRefusal,
  cleanupScanFor,
  saveCleanupDecisions,
  undoCleanup,
  type CleanupMoveDeps,
} from "../core/src/memory/cleanupApply.js";
import { CleanupScanRunningError, type CleanupFindingFile } from "../core/src/memory/cleanupScan.js";
import { RestoreInProgressError } from "../core/src/errors.js";
import { RestoreLock } from "../core/src/restoreLock.js";
import ts from "typescript";
import { MINHASH_ALGO, minhashShingles, minhashSignature } from "../core/src/memory/minhash.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch A (S1 and S2), the deciding code at its own layer (checks.md, Test
 * policy rows 1 and 2), with no HTTP: the scope and the inventory (`resolveCleanupScope`, `cleanupInventory`), the
 * scanner's finding rules (`scanCleanupScope`), the MinHash (`minhash.ts`) and migration 24. "Now" is the fixed clock
 * `NOW`; a file's age is `NOW - mtime` in whole days. The HTTP side of each claim is in `cleanup.inventory.test.ts` and
 * `cleanup.scan.test.ts`. Batch B: the decision rules (`cleanupDecisionRefusal`, `saveCleanupDecisions`), door 7's
 * literal key and the no-removal walker; `moveWorkspaceFile` is proven in `cleanup.move.test.ts`. Round 1: the apply
 * planner (`applyCleanup`, `cleanupScanFor`) and the undo (`undoCleanup`) here too, one case per row of their decision
 * tables (C41-C49, C85, C86), as their boundary proofs in `cleanup.apply.test.ts` go through the routes.
 */

vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return { ...actual, listWorkspaceDir: vi.fn(actual.listWorkspaceDir) };
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
type Json = Record<string, any>;

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let work: string;
let memory: string;
let seq = 0;

beforeAll(() => {
  temp = makeTempHome("mordomo-cleanup-layer-");
  ctx = new AppContext(temp.paths.home);
  memory = temp.paths.memory;
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-cleanup-layer-work-")));
  const s = ctx.settings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  ctx.settingsStore.save(s);
  ctx.indexer.addImplicitRoot({ path: memory, area: null, enabled: true });
});
afterAll(() => {
  ctx.close();
  temp.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

/** A new folder of the indexed folder, for one test. */
const folder = (name: string): string => {
  const dir = path.join(work, `${name}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
/** A file whose age at `NOW` is `ageDays` whole days. */
const put = (file: string, content: string | Buffer, ageDays = 1): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const at = (NOW - ageDays * DAY - 3_600_000) / 1000;
  fs.utimesSync(file, at, at);
  return file;
};
const settingsWith = (change: (s: Settings) => void = () => undefined): Settings => {
  const s = structuredClone(ctx.settings());
  change(s);
  return s;
};
const envWith = (change?: (s: Settings) => void) => ({ paths: ctx.paths, settings: settingsWith(change) });
const index = () => ctx.indexer.indexAll();
const scopeOf = (dir: string, change?: (s: Settings) => void) =>
  resolveCleanupScope(envWith(change), { dir });
const inventory = (dir: string, change?: (s: Settings) => void): CleanupInventory =>
  cleanupInventory(ctx.db, envWith(change), scopeOf(dir, change), { now: NOW });
async function scan(
  dir: string,
  change?: (s: Settings) => void,
): Promise<{ findings: CleanupFinding[]; decided: number }> {
  const env = envWith(change);
  return scanCleanupScope(ctx.db, env, resolveCleanupScope(env, { dir }), { now: NOW });
}
const ofKind = (findings: CleanupFinding[], kind: string) => findings.filter((f) => f.kind === kind);
const pathsOf = (findings: CleanupFinding[]) => findings.map((f) => f.files.map((m) => m.path));

/** A row of `files` as a pass would have written it, for the inventory (which never opens a file). */
function row(full: string, size: number, ageDays = 1, root = work): number {
  const rel = path.relative(root, full);
  const info = ctx.db
    .prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, '[]', '{}')",
    )
    .run(
      root,
      full,
      rel,
      path.basename(full),
      path.extname(full).toLowerCase(),
      path.dirname(full),
      size,
      NOW - ageDays * DAY - 3_600_000,
      NOW,
    );
  return Number(info.lastInsertRowid);
}
const terms = (id: number, list: Array<[string, number]>) =>
  ctx.db
    .prepare("INSERT INTO file_terms (file_id, terms, updated_at) VALUES (?, ?, ?)")
    .run(id, JSON.stringify(list), NOW);
const related = (a: number, b: number, score: number) =>
  ctx.db
    .prepare("INSERT INTO file_related (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, ?, '[]', ?)")
    .run(a, b, score, NOW);

describe("S1 the inventory at its own layer", () => {
  it("C2 byKind holds six groups in order, one asserted case per group, and an empty group answers zero", () => {
    const dir = folder("tipos");
    const sizes: Record<string, number> = {
      "a.md": 10,
      "b.markdown": 20,
      "c.txt": 30,
      "d.pdf": 40,
      "e.png": 50,
      "f.ts": 60,
      "g.xyz": 70,
    };
    for (const [name, size] of Object.entries(sizes)) row(path.join(dir, name), size);
    const byKind = inventory(dir).byKind;
    expect(byKind.map((g) => g.kind)).toEqual(["notes", "text", "pdf", "image", "code", "other"]);
    expect(byKind[0]).toEqual({ kind: "notes", count: 2, bytes: 30 }); // a.md and b.markdown
    expect(byKind[1]).toEqual({ kind: "text", count: 1, bytes: 30 }); // c.txt
    expect(byKind[2]).toEqual({ kind: "pdf", count: 1, bytes: 40 }); // d.pdf
    expect(byKind[3]).toEqual({ kind: "image", count: 1, bytes: 50 }); // e.png
    expect(byKind[4]).toEqual({ kind: "code", count: 1, bytes: 60 }); // f.ts
    expect(byKind[5]).toEqual({ kind: "other", count: 1, bytes: 70 }); // g.xyz

    const only = folder("so-notas");
    row(path.join(only, "a.md"), 5);
    expect(inventory(only).byKind).toEqual([
      { kind: "notes", count: 1, bytes: 5 },
      { kind: "text", count: 0, bytes: 0 },
      { kind: "pdf", count: 0, bytes: 0 },
      { kind: "image", count: 0, bytes: 0 },
      { kind: "code", count: 0, bytes: 0 },
      { kind: "other", count: 0, bytes: 0 },
    ]);
  });

  it("C3 byAge holds four bands in order, and the edges 30/31, 90/91, 365/366 land where they belong", () => {
    const dir = folder("idades");
    for (const age of [0, 30, 31, 90, 91, 365, 366]) row(path.join(dir, `idade-${age}.md`), 1, age);
    const byAge = inventory(dir).byAge;
    expect(byAge.map((b) => [b.from, b.to])).toEqual([
      [0, 30],
      [31, 90],
      [91, 365],
      [366, null],
    ]);
    expect(byAge.map((b) => b.count)).toEqual([2, 2, 2, 1]);
  });

  it("C4 topFolders holds the 10 folders with the most bytes, most first, the 11th absent; a folder's bytes are its files' at any depth", () => {
    const dir = folder("pastas");
    for (let i = 1; i <= 11; i++) row(path.join(dir, `p${String(i).padStart(2, "0")}`, "x.txt"), i * 100);
    const top = inventory(dir).topFolders;
    expect(top).toHaveLength(10);
    expect(top.map((f) => f.bytes)).toEqual([1100, 1000, 900, 800, 700, 600, 500, 400, 300, 200]);
    expect(top.map((f) => f.path)).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => path.join(dir, `p${String(i).padStart(2, "0")}`)),
    );
    expect(top.map((f) => f.path)).not.toContain(path.join(dir, "p01"));

    const deep = folder("fundo");
    row(path.join(deep, "a", "b", "c.txt"), 700);
    row(path.join(deep, "a", "d.txt"), 300);
    expect(inventory(deep).topFolders).toEqual([
      { path: path.join(deep, "a"), count: 2, bytes: 1000 },
      { path: path.join(deep, "a", "b"), count: 1, bytes: 700 },
    ]);
  });

  it("C5 two first-level subfolders give one group each with their top 3 shared terms; one folder gives the components of file_related at 0.3; 14 subfolders give the 12 largest", () => {
    const dir = folder("grupos");
    const c = [1, 2, 3].map((i) => row(path.join(dir, "clientes", `c${i}.md`), 1));
    const p = [1, 2].map((i) => row(path.join(dir, "projetos", `p${i}.md`), 1));
    terms(c[0]!, [
      ["acme", 9],
      ["contrato", 3],
      ["fatura", 2],
      ["outro", 50],
    ]);
    terms(c[1]!, [
      ["acme", 9],
      ["contrato", 3],
      ["fatura", 2],
    ]);
    terms(c[2]!, [
      ["acme", 9],
      ["contrato", 3],
    ]);
    terms(p[0]!, [
      ["roteiro", 4],
      ["prazo", 2],
      ["meta", 1],
    ]);
    terms(p[1]!, [
      ["roteiro", 4],
      ["prazo", 2],
      ["meta", 1],
    ]);
    expect(inventory(dir).clusters).toEqual([
      {
        kind: "folder",
        name: "clientes",
        path: path.join(dir, "clientes"),
        count: 3,
        terms: ["acme", "contrato", "fatura"],
      },
      {
        kind: "folder",
        name: "projetos",
        path: path.join(dir, "projetos"),
        count: 2,
        terms: ["roteiro", "prazo", "meta"],
      },
    ]);

    const flat = folder("plano");
    const x = [1, 2, 3, 4].map((i) => row(path.join(flat, `x${i}.md`), 1));
    for (const id of x)
      terms(id, [
        ["comum", 1],
        ["tema", 1],
      ]);
    related(x[0]!, x[1]!, 0.3); // 0.30 joins
    related(x[1]!, x[2]!, 0.5);
    related(x[2]!, x[3]!, 0.29); // 0.29 joins nothing
    expect(inventory(flat).clusters).toEqual([
      { kind: "related", name: "comum · tema", path: null, count: 3, terms: ["comum", "tema"] },
    ]);

    const many = folder("muitas");
    for (let i = 1; i <= 14; i++)
      for (let j = 0; j < i; j++) row(path.join(many, `s${String(i).padStart(2, "0")}`, `f${j}.md`), 1);
    const groups = inventory(many).clusters;
    expect(groups).toHaveLength(12);
    expect(groups.map((g) => g.count)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(groups.map((g) => g.name)).not.toContain("s01");
    expect(groups.map((g) => g.name)).not.toContain("s02");
  });

  it("C6 the inventory is computed from the rows alone, and a row today's policy excludes is counted nowhere", () => {
    const dir = folder("so-linhas");
    put(path.join(dir, "a.md"), "# A\nalfa\n");
    put(path.join(dir, "b.txt"), "beta beta\n");
    put(path.join(dir, "privado", "c.md"), "# C\nsegredo\n");
    index();
    const before = inventory(dir);
    expect(before.total).toEqual({
      count: 3,
      bytes: ["# A\nalfa\n", "beta beta\n", "# C\nsegredo\n"].reduce((n, t) => n + Buffer.byteLength(t), 0),
    });
    fs.rmSync(dir, { recursive: true, force: true });
    const after = inventory(dir);
    expect(after.total).toEqual(before.total);
    expect(after.byKind).toEqual(before.byKind);

    // A user exclude added after the pass, and a secret-named row: neither is counted anywhere.
    row(path.join(dir, ".env"), 500);
    const hidden = inventory(dir, (s) => {
      s.excludes = [...s.excludes, "privado"];
    });
    expect(hidden.total).toEqual({ count: 2, bytes: 19 });
    expect(hidden.byKind.reduce((n, g) => n + g.count, 0)).toBe(2);
    expect(hidden.byKind.find((g) => g.kind === "other")).toEqual({ kind: "other", count: 0, bytes: 0 });
    expect(hidden.byAge.reduce((n, b) => n + b.count, 0)).toBe(2);
    expect(hidden.topFolders.map((f) => f.path)).not.toContain(path.join(dir, "privado"));
  });

  it("C7 a context's scope counts its ok path and its notes folder, never a sibling with the same prefix nor a missing path", () => {
    const dir = folder("ctx");
    const app = path.join(dir, "projetos", "app");
    const gone = path.join(dir, "sumiu");
    fs.mkdirSync(app, { recursive: true });
    const id = `contexto-c7-${seq}`;
    row(path.join(app, "x.md"), 11);
    row(path.join(dir, "projetos", "app-antigo", "y.md"), 22);
    row(path.join(gone, "z.md"), 33); // left in the index under the missing path
    row(path.join(memory, "notes", id, "_resumo.md"), 44, 1, memory);
    const env = envWith((s) => {
      s.contexts = [{ id, name: "Contexto C7", paths: [app, gone] }];
    });
    const scope = resolveCleanupScope(env, { context: id });
    const inv = cleanupInventory(ctx.db, env, scope, { now: NOW });
    expect(inv.scope).toEqual({ kind: "context", id });
    expect(inv.total).toEqual({ count: 2, bytes: 55 });
  });
});

describe("S2 the scanner's finding rules at their own layer", () => {
  it("C12 the same bytes are one duplicate listing every copy; the same size with other bytes is none", async () => {
    const two = folder("dup2");
    put(path.join(two, "a.md"), "# Igual\nmesmo texto\n");
    put(path.join(two, "copia", "a.md"), "# Igual\nmesmo texto\n");
    const three = folder("dup3");
    for (const name of ["x.md", "y.md", "z/x.md"]) put(path.join(three, name), "# Tres\nconteudo igual\n");
    const differ = folder("dup0");
    put(path.join(differ, "a.md"), "# Um\nabcdef\n");
    put(path.join(differ, "b.md"), "# Um\nfedcba\n");
    index();
    const d2 = ofKind((await scan(two)).findings, "duplicate");
    expect(pathsOf(d2)).toEqual([[path.join(two, "a.md"), path.join(two, "copia", "a.md")]]);
    const d3 = ofKind((await scan(three)).findings, "duplicate");
    expect(pathsOf(d3)).toEqual([["x.md", "y.md", "z/x.md"].map((n) => path.join(three, n))]);
    expect(ofKind((await scan(differ)).findings, "duplicate")).toEqual([]);
  });

  const words = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => `palavra${String(from + i).padStart(4, "0")}`).join(" ");
  const jaccard = (a: string, b: string) => {
    const x = minhashShingles(a);
    const y = minhashShingles(b);
    const both = [...x].filter((s) => y.has(s)).length;
    return both / (x.size + y.size - both);
  };

  it("C13 a pair with an exact Jaccard of 0.95 is one near-duplicate whose detail holds an estimate of 0.8 or more; 0.5 is none; the same bytes are a duplicate only", async () => {
    const near = folder("quase");
    const base = words(0, 99);
    const more = `${base} ${words(1000, 5)}`;
    expect(jaccard(base, more)).toBeCloseTo(0.95, 10);
    put(path.join(near, "a.md"), base);
    put(path.join(near, "b.md"), more);
    const far = folder("longe");
    const half = `${words(0, 54)} ${words(2000, 50)}`;
    expect(jaccard(words(0, 54), half)).toBeCloseTo(0.5, 10);
    put(path.join(far, "a.md"), words(0, 54));
    put(path.join(far, "b.md"), half);
    const same = folder("iguais");
    put(path.join(same, "a.md"), base);
    put(path.join(same, "b.md"), base);
    index();

    const found = ofKind((await scan(near)).findings, "near-duplicate");
    expect(pathsOf(found)).toEqual([[path.join(near, "a.md"), path.join(near, "b.md")]]);
    expect(found[0]!.detail.similarity).toBeGreaterThanOrEqual(0.8);
    expect(ofKind((await scan(far)).findings, "near-duplicate")).toEqual([]);
    const both = (await scan(same)).findings;
    expect(ofKind(both, "duplicate")).toHaveLength(1);
    expect(ofKind(both, "near-duplicate")).toEqual([]);
  });

  it("C14 a signature is 64 Uint32 little-endian (256 bytes) of minhash-v1:64:w5, the same in two processes of another LANG and TZ, and words are folded", () => {
    expect(MINHASH_ALGO).toBe("minhash-v1:64:w5");
    const text = "Plano de Vendas para 2027 com metas e prazos do trimestre";
    const sig = minhashSignature(text)!;
    expect(sig.byteLength).toBe(256);
    const view = new DataView(sig.buffer, sig.byteOffset, sig.byteLength);
    const values = Array.from({ length: 64 }, (_, i) => view.getUint32(i * 4, true));
    expect(Buffer.from(Uint32Array.from(values).buffer).equals(Buffer.from(sig))).toBe(
      os.endianness() === "LE",
    );
    const url = pathToFileURL(path.resolve(import.meta.dirname, "../core/src/memory/minhash.ts")).href;
    const code = `import(${JSON.stringify(url)}).then((m) => process.stdout.write(Buffer.from(m.minhashSignature(${JSON.stringify(text)})).toString("hex")))`;
    const child = (env: Record<string, string>) =>
      execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], {
        env: { ...process.env, ...env },
        encoding: "utf8",
      });
    const tr = child({ LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Asia/Tokyo" });
    const us = child({ LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "America/Los_Angeles" });
    expect(tr).toHaveLength(512);
    expect(tr).toBe(us);
    expect(tr).toBe(Buffer.from(sig).toString("hex"));
    expect(Buffer.from(minhashSignature("Plano de Vendas para 2027 com metas")!)).toEqual(
      Buffer.from(minhashSignature("plano de vendas para 2027 com METAS")!),
    );
  });

  it("C15 migration 24 makes file_minhash with door 2's columns, again leaves it so, keeps 23 as run-context, and an index pass that removes a file deletes its signature", async () => {
    const columns = () =>
      (ctx.db.pragma("table_info(file_minhash)") as Json[]).map(({ name, type, notnull, pk }) => ({
        name,
        type,
        notnull,
        pk,
      }));
    const want = [
      { name: "file_id", type: "INTEGER", notnull: 0, pk: 1 },
      { name: "algo", type: "TEXT", notnull: 1, pk: 0 },
      { name: "sig", type: "BLOB", notnull: 1, pk: 0 },
      { name: "mtime", type: "INTEGER", notnull: 1, pk: 0 },
      { name: "size", type: "INTEGER", notnull: 1, pk: 0 },
    ];
    expect(columns()).toEqual(want);
    const m24 = MIGRATIONS.find((m) => m.version === 24)!;
    ctx.db.exec(m24.sql!);
    expect(columns()).toEqual(want);
    expect(MIGRATIONS.find((m) => m.version === 23)!.name).toBe("run-context");

    const dir = folder("assinatura");
    const file = put(
      path.join(dir, "a.md"),
      "# Assinatura\numa nota com texto bastante para ter assinatura\n",
    );
    index();
    await scan(dir);
    const id = (ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    expect(ctx.db.prepare("SELECT file_id FROM file_minhash WHERE file_id = ?").get(id)).toEqual({
      file_id: id,
    });
    fs.rmSync(file);
    index();
    expect(ctx.db.prepare("SELECT file_id FROM file_minhash WHERE file_id = ?").get(id)).toBeUndefined();
  });

  it("C16 a second scan over unchanged files rewrites no signature; a changed mtime, a changed size and an old algo are recomputed, and only those", async () => {
    const dir = folder("recalculo");
    const files = [1, 2, 3, 4].map((i) =>
      put(path.join(dir, `n${i}.md`), `# Nota ${i}\n${words(i * 100, 30)}\n`, 10),
    );
    index();
    await scan(dir);
    const ids = files.map(
      (f) => (ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(f) as { id: number }).id,
    );
    const rows = () =>
      ids.map(
        (id) =>
          ctx.db.prepare("SELECT algo, sig, mtime, size FROM file_minhash WHERE file_id = ?").get(id) as Json,
      );
    const changes = () => (ctx.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const first = rows();
    expect(first.every((r) => r && r.algo === MINHASH_ALGO)).toBe(true);
    const before = changes();
    await scan(dir);
    expect(changes()).toBe(before);
    expect(rows()).toEqual(first);

    // n1: another mtime, the same bytes; n2: another size, the same mtime; n3: stored under an older algorithm.
    const t1 = (NOW - 3 * DAY) / 1000;
    fs.utimesSync(files[0]!, t1, t1);
    const st2 = fs.statSync(files[1]!);
    fs.appendFileSync(files[1]!, " mais");
    fs.utimesSync(files[1]!, st2.atime, st2.mtime);
    index();
    ctx.db.prepare("UPDATE file_minhash SET algo = 'minhash-v0:test' WHERE file_id = ?").run(ids[2]);
    const mark = changes();
    await scan(dir);
    expect(changes() - mark).toBe(3);
    const now = rows();
    const stored = (i: number) =>
      ctx.db.prepare("SELECT mtime, size FROM files WHERE id = ?").get(ids[i]) as Json;
    expect(now[0]).toMatchObject({ algo: MINHASH_ALGO, mtime: stored(0).mtime });
    expect(now[0]!.mtime).not.toBe(first[0]!.mtime);
    expect(now[1]).toMatchObject({ algo: MINHASH_ALGO, size: stored(1).size });
    expect(now[1]!.size).not.toBe(first[1]!.size);
    expect(now[2]).toMatchObject({ algo: MINHASH_ALGO });
    expect(now[3]).toEqual(first[3]);
  });

  it("C17 migration 24 makes cleanup_decisions with door 3's columns and primary key, and a second row for one (scope, key) fails", () => {
    const columns = (ctx.db.pragma("table_info(cleanup_decisions)") as Json[]).map(
      ({ name, type, notnull, pk }) => ({
        name,
        type,
        notnull,
        pk,
      }),
    );
    expect(columns).toEqual([
      { name: "scope", type: "TEXT", notnull: 1, pk: 1 },
      { name: "key", type: "TEXT", notnull: 1, pk: 2 },
      { name: "decision", type: "TEXT", notnull: 1, pk: 0 },
      { name: "keep_file_id", type: "INTEGER", notnull: 0, pk: 0 },
      { name: "until", type: "INTEGER", notnull: 0, pk: 0 },
      { name: "decided_at", type: "INTEGER", notnull: 1, pk: 0 },
    ]);
    const insert = ctx.db.prepare(
      "INSERT INTO cleanup_decisions (scope, key, decision, keep_file_id, until, decided_at) VALUES (?, ?, ?, NULL, NULL, ?)",
    );
    insert.run("dir:/c17", "stale:abc", "keep", NOW);
    expect(() => insert.run("dir:/c17", "stale:abc", "archive", NOW)).toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it("C18 stale follows memory.cleanup.staleDays: 181 days is stale and 180 is not by default; with 90, 91 is and 90 is not", async () => {
    const dir = folder("parados");
    for (const age of [181, 180, 91, 90]) put(path.join(dir, `idade-${age}.md`), `# Idade ${age}\n`, age);
    index();
    const staleOf = async (change?: (s: Settings) => void) =>
      ofKind((await scan(dir, change)).findings, "stale")
        .map((f) => path.basename(f.files[0]!.path))
        .sort();
    expect(await staleOf()).toEqual(["idade-181.md"]);
    expect(
      await staleOf((s) => {
        s.memory.cleanup = { staleDays: 90, largeBytes: 5_242_880 };
      }),
    ).toEqual(["idade-180.md", "idade-181.md", "idade-91.md"]);
  });

  it("C19 last_reviewed past the bound makes a recent note stale by that date; an old mtime is stale by itself; an unreadable date and review_every count for nothing", async () => {
    const dir = folder("revisao");
    const day = (ago: number) => new Date(NOW - ago * DAY).toISOString().slice(0, 10);
    put(path.join(dir, "revista-ha-200.md"), `---\nlast_reviewed: ${day(200)}\n---\n# A\n`, 2);
    put(path.join(dir, "revista-ha-10.md"), `---\nlast_reviewed: ${day(10)}\n---\n# B\n`, 200);
    put(path.join(dir, "revista-ontem.md"), "---\nlast_reviewed: ontem\n---\n# C\n", 2);
    put(path.join(dir, "revisar-a-cada.md"), "---\nreview_every: 7d\n---\n# D\n", 30);
    index();
    const stale = ofKind((await scan(dir)).findings, "stale");
    const byName = new Map(stale.map((f) => [path.basename(f.files[0]!.path), f.detail]));
    expect([...byName.keys()].sort()).toEqual(["revista-ha-10.md", "revista-ha-200.md"]);
    expect(byName.get("revista-ha-200.md")).toEqual({
      since: "last_reviewed",
      lastReviewed: day(200),
      ageDays: 200,
    });
    expect(byName.get("revista-ha-10.md")).toEqual({ since: "mtime", ageDays: 200 });
  });

  it("C20 a note with no link either way that resolves is an orphan; a wikilink keeps both ends; a pdf never is; a link to an excluded file does not count", async () => {
    const dir = folder("orfas");
    put(path.join(dir, "sozinha.md"), "# Sozinha\nnada aqui\n");
    put(path.join(dir, "origem.md"), "# Origem\nveja [[alvo]]\n");
    put(path.join(dir, "alvo.md"), "# Alvo\n");
    put(path.join(dir, "doc.pdf"), "%PDF-1.4 sem links");
    put(path.join(dir, "para-segredo.md"), "# Para segredo\nveja [[escondida]]\n");
    put(path.join(dir, "cofre", "escondida.md"), "# Escondida\n");
    index();
    const orphans = ofKind(
      (
        await scan(dir, (s) => {
          s.excludes = [...s.excludes, "cofre"];
        })
      ).findings,
      "orphan",
    ).map((f) => path.basename(f.files[0]!.path));
    expect(orphans.sort()).toEqual(["para-segredo.md", "sozinha.md"]);
  });

  it("C22 an empty folder, and a folder holding only an empty one, are each one empty-folder; a folder with an indexed file is none; folders are listed through listWorkspaceDir", async () => {
    const dir = folder("vazias");
    fs.mkdirSync(path.join(dir, "vazia"));
    fs.mkdirSync(path.join(dir, "pai", "oca"), { recursive: true });
    put(path.join(dir, "cheia", "nota.md"), "# Cheia\n");
    index();
    const listed = vi.mocked(safeFs.listWorkspaceDir);
    listed.mockClear();
    const folders = ofKind((await scan(dir)).findings, "empty-folder");
    expect(folders.map((f) => f.detail.folder).sort()).toEqual([
      path.join(dir, "pai"),
      path.join(dir, "vazia"),
    ]);
    expect(folders.every((f) => f.files.length === 0)).toBe(true);
    const asked = listed.mock.calls.map((call) => call[1]);
    expect(asked).toContain(dir);
    expect(asked).toContain(path.join(dir, "cheia"));
  });

  it("C23 large-file follows memory.cleanup.largeBytes: 5 242 881 bytes is large and 5 242 880 is not by default; with 1 048 576, 1 048 577 is", async () => {
    const dir = folder("grandes");
    put(path.join(dir, "maior.bin"), Buffer.alloc(5_242_881, 1));
    put(path.join(dir, "limite.bin"), Buffer.alloc(5_242_880, 2));
    put(path.join(dir, "medio.bin"), Buffer.alloc(1_048_577, 3));
    index();
    const largeOf = async (change?: (s: Settings) => void) =>
      ofKind((await scan(dir, change)).findings, "large-file")
        .map((f) => path.basename(f.files[0]!.path))
        .sort();
    expect(await largeOf()).toEqual(["maior.bin"]);
    expect(
      await largeOf((s) => {
        s.memory.cleanup = { staleDays: 180, largeBytes: 1_048_576 };
      }),
    ).toEqual(["limite.bin", "maior.bin", "medio.bin"]);
  });

  it("C24 a .md with no title in its front matter and no '# ' line is untitled; title: or '# ' is not; a .txt never is", async () => {
    const dir = folder("titulos");
    put(path.join(dir, "sem.md"), "apenas texto\n## subtitulo\n");
    put(path.join(dir, "frente.md"), "---\ntitle: Plano\n---\ntexto\n");
    put(path.join(dir, "cabeca.md"), "# Plano\ntexto\n");
    put(path.join(dir, "texto.txt"), "apenas texto\n");
    index();
    const untitled = ofKind((await scan(dir)).findings, "untitled").map((f) =>
      path.basename(f.files[0]!.path),
    );
    expect(untitled).toEqual(["sem.md"]);
  });

  it("C25 every key is <kind>: and 64 lowercase hex; unchanged members keep it; one byte of a duplicate's member changes it", async () => {
    const dir = folder("chaves");
    for (const name of ["a.md", "b.md", "c.md"]) put(path.join(dir, name), "sem titulo, igual\n", 400);
    index();
    const first = (await scan(dir)).findings;
    expect(first.length).toBeGreaterThan(0);
    for (const f of first) expect(f.key).toMatch(new RegExp(`^${f.kind}:[0-9a-f]{64}$`));
    const again = (await scan(dir)).findings;
    expect(again.map((f) => f.key)).toEqual(first.map((f) => f.key));
    const dup = ofKind(first, "duplicate")[0]!;
    fs.writeFileSync(path.join(dir, "c.md"), "sem titulo, iguaL\n");
    index();
    const next = ofKind((await scan(dir)).findings, "duplicate");
    expect(next).toHaveLength(1);
    expect(next[0]!.key).toMatch(/^duplicate:[0-9a-f]{64}$/);
    expect(next[0]!.key).not.toBe(dup.key);
  });

  it("C26 a stored decision hides its finding by kind: keep, archive, merge and an unexpired snooze hide; an expired snooze and unsure do not; another scope's keep hides nothing; a changed member is asked again", async () => {
    const dir = folder("decisoes");
    const names = ["keep", "archive", "merge", "snooze-futuro", "snooze-passado", "unsure", "outro-escopo"];
    for (const name of names) put(path.join(dir, `${name}.md`), `sem titulo ${name}\n`);
    index();
    const scopeKey = scopeOf(dir).key;
    const untitled = async () =>
      new Map(
        ofKind((await scan(dir)).findings, "untitled").map((f) => [
          path.basename(f.files[0]!.path, ".md"),
          f.key,
        ]),
      );
    const keys = await untitled();
    const decide = (name: string, decision: string, until: number | null = null, scope = scopeKey) =>
      ctx.db
        .prepare(
          "INSERT OR REPLACE INTO cleanup_decisions (scope, key, decision, keep_file_id, until, decided_at) VALUES (?, ?, ?, NULL, ?, ?)",
        )
        .run(scope, keys.get(name), decision, until, NOW);
    decide("keep", "keep");
    decide("archive", "archive");
    decide("merge", "merge");
    decide("snooze-futuro", "snooze", NOW + DAY);
    decide("snooze-passado", "snooze", NOW - DAY);
    decide("unsure", "unsure");
    decide("outro-escopo", "keep", null, "dir:/outro/escopo");
    const result = await scan(dir);
    const shown = new Set(
      ofKind(result.findings, "untitled").map((f) => path.basename(f.files[0]!.path, ".md")),
    );
    expect(shown.has("keep")).toBe(false);
    expect(shown.has("archive")).toBe(false);
    expect(shown.has("merge")).toBe(false);
    expect(shown.has("snooze-futuro")).toBe(false);
    expect(shown.has("snooze-passado")).toBe(true);
    expect(shown.has("unsure")).toBe(true);
    expect(shown.has("outro-escopo")).toBe(true);

    fs.appendFileSync(path.join(dir, "keep.md"), "mais\n");
    index();
    const after = ofKind((await scan(dir)).findings, "untitled").find(
      (f) => path.basename(f.files[0]!.path) === "keep.md",
    );
    expect(after).toBeDefined();
    expect(after!.key).not.toBe(keys.get("keep"));
  });

  it("C84 door 7: a broken link's key hashes its member and the link (kind, target, line), an empty folder's its real path; two links of one note have two keys, two empty folders two keys", async () => {
    const dir = folder("porta7");
    const note = put(path.join(dir, "nota.md"), "# Nota\n[[um-alvo]]\n[[outro-alvo]]\n");
    fs.mkdirSync(path.join(dir, "vazia-a"));
    fs.mkdirSync(path.join(dir, "vazia-b"));
    index();
    const { findings } = await scan(dir);
    const hex = (text: string | Buffer) => crypto.createHash("sha256").update(text).digest("hex");
    const sha = hex(fs.readFileSync(note));
    const broken = ofKind(findings, "broken-link");
    expect(broken.map((f) => [f.detail.target, f.detail.line, f.detail.linkKind])).toEqual([
      ["um-alvo", 2, "wikilink"],
      ["outro-alvo", 3, "wikilink"],
    ]);
    expect(broken.map((f) => f.key)).toEqual([
      `broken-link:${hex(`${note}\u0000${sha}\n\u0001wikilink\u0000um-alvo\u00002`)}`,
      `broken-link:${hex(`${note}\u0000${sha}\n\u0001wikilink\u0000outro-alvo\u00003`)}`,
    ]);
    const empty = ofKind(findings, "empty-folder");
    expect(empty.map((f) => [f.files, f.key])).toEqual(
      ["vazia-a", "vazia-b"].map((name) => [
        [],
        `empty-folder:${hex(`\u0001folder\u0000${fs.realpathSync(path.join(dir, name))}`)}`,
      ]),
    );
    expect(new Set([...broken, ...empty].map((f) => f.key)).size).toBe(4);
  });

  it("C27 memory/archive/, ROUTER.md, areas/, journal/ and contexts/ give no finding, one case per place; maps/ and inbox/ do; an excluded file gives none", async () => {
    const old = 400;
    const ignored = {
      archive: put(
        path.join(memory, "archive", "2026-01-01-abcd1234", "velha.md"),
        "sem titulo arquivo\n",
        old,
      ),
      router: put(path.join(memory, "ROUTER.md"), "sem titulo roteador\n", old),
      areas: put(path.join(memory, "areas", "area.md"), "sem titulo area\n", old),
      journal: put(path.join(memory, "journal", "2025-01-01.md"), "sem titulo diario\n", old),
      contexts: put(path.join(memory, "contexts", "ctx.md"), "sem titulo contexto\n", old),
    };
    const reported = {
      maps: put(path.join(memory, "maps", "mapa.md"), "sem titulo mapa\n", old),
      inbox: put(path.join(memory, "inbox", "entrada.md"), "sem titulo entrada\n", old),
    };
    const excluded = put(path.join(memory, "notes", "fechada", "oculta.md"), "sem titulo oculta\n", old);
    index();
    const { findings } = await scan(memory, (s) => {
      s.excludes = [...s.excludes, "fechada"];
    });
    const about = (file: string) =>
      findings.filter((f) => f.files.some((m) => m.path === file)).map((f) => f.kind);
    expect(about(ignored.archive)).toEqual([]);
    expect(about(ignored.router)).toEqual([]);
    expect(about(ignored.areas)).toEqual([]);
    expect(about(ignored.journal)).toEqual([]);
    expect(about(ignored.contexts)).toEqual([]);
    expect(about(reported.maps).sort()).toEqual(["orphan", "stale", "untitled"]);
    expect(about(reported.inbox).sort()).toEqual(["orphan", "stale", "untitled"]);
    expect(about(excluded)).toEqual([]);
  });
});

describe("S3 the decision rules at their own layer", () => {
  const finding = (kind: CleanupFinding["kind"], key: string, ids: number[]): CleanupFinding => ({
    key,
    kind,
    files: ids.map((id) => ({ id, path: `/x/${id}.md`, size: 1, mtime: 1, sha256: "0".repeat(64) })),
    detail: {},
    suggested: "keep",
  });
  const dup = finding("duplicate", `duplicate:${"1".repeat(64)}`, [11, 12]);
  const near = finding("near-duplicate", `near-duplicate:${"2".repeat(64)}`, [21, 22]);
  const orphan = finding("orphan", `orphan:${"3".repeat(64)}`, [31]);
  const findings = [dup, near, orphan];

  it("C35 each refused entry is refused for its own reason: the same entry with that one thing right is accepted; one refused entry stores nothing of its request", () => {
    // [the refusal, the entry, the same entry with only that reason taken away, a word of the reason]
    const cases: Array<[string, Json, Json, string]> = [
      [
        "a key the scan did not report",
        { key: `orphan:${"9".repeat(64)}`, decision: "keep" },
        { key: orphan.key, decision: "keep" },
        "no finding",
      ],
      [
        "decision delete",
        { key: orphan.key, decision: "delete" },
        { key: orphan.key, decision: "archive" },
        "Not a decision",
      ],
      [
        "merge without keepFileId",
        { key: dup.key, decision: "merge" },
        { key: dup.key, decision: "merge", keepFileId: 12 },
        "keepFileId",
      ],
      [
        "merge with an id outside the finding",
        { key: dup.key, decision: "merge", keepFileId: 31 },
        { key: dup.key, decision: "merge", keepFileId: 11 },
        "not a member",
      ],
      [
        "merge on an orphan",
        { key: orphan.key, decision: "merge", keepFileId: 31 },
        { key: near.key, decision: "merge", keepFileId: 21 },
        "duplicate",
      ],
      [
        "snooze without until",
        { key: orphan.key, decision: "snooze" },
        { key: orphan.key, decision: "snooze", until: NOW + 1 },
        "until",
      ],
      [
        "snooze until a second ago",
        { key: orphan.key, decision: "snooze", until: NOW - 1000 },
        { key: orphan.key, decision: "snooze", until: NOW + 1000 },
        "later than now",
      ],
    ];
    for (const [name, bad, good, why] of cases) {
      expect(cleanupDecisionRefusal(findings, good as never, NOW), `${name}: the right one`).toBeNull();
      expect(cleanupDecisionRefusal(findings, bad as never, NOW), name).toContain(why);
    }
    // the edge of until: now itself is not later than now
    expect(
      cleanupDecisionRefusal(findings, { key: orphan.key, decision: "snooze", until: NOW }, NOW),
    ).toContain("later than now");

    const scope = `dir:/c35/${++seq}`;
    const scanRecord = { scopeKey: scope, findings } as unknown as CleanupScanRecord;
    const stored = () =>
      ctx.db.prepare("SELECT COUNT(*) AS n FROM cleanup_decisions WHERE scope = ?").get(scope) as {
        n: number;
      };
    for (const [name, bad] of cases) {
      expect(
        () =>
          saveCleanupDecisions(ctx.db, scanRecord, [{ key: dup.key, decision: "keep" }, bad as never], {
            now: NOW,
          }),
        name,
      ).toThrow(expect.objectContaining({ statusCode: 400, code: "validation" }));
      expect(stored().n, name).toBe(0);
    }
    expect(
      saveCleanupDecisions(
        ctx.db,
        scanRecord,
        cases.map(([, , good]) => good as never),
        { now: NOW },
      ).saved,
    ).toBe(7);
    // one row per (scope, key): the later entry for a key replaces the earlier
    expect(stored().n).toBe(3);
  });
});

describe("S4 nothing removes a user file", () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const REMOVERS = new Set(["unlink", "unlinkSync", "rm", "rmSync", "rmdir", "rmdirSync"]);
  interface Removal {
    file: string;
    fn: string;
    name: string;
    args: string;
    pos: number;
  }
  /** Every call whose callee ends in a name that removes a directory entry, with the function it sits in. */
  function removals(file: string, text: string, only?: string): Removal[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out: Removal[] = [];
    const visit = (node: ts.Node, fn: string | null) => {
      let here = fn;
      if (ts.isFunctionDeclaration(node) && node.name) here = node.name.text;
      if (ts.isCallExpression(node) && (only === undefined || here === only)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (name && REMOVERS.has(name))
          out.push({
            file,
            fn: here ?? "",
            name,
            args: node.arguments.map((a) => a.getText(sf)).join(", "),
            pos: node.getStart(sf),
          });
      }
      ts.forEachChild(node, (child) => visit(child, here));
    };
    visit(sf, null);
    return out;
  }

  it("C50 the walker sees fs.unlinkSync, fs.rmSync, fs.promises.rm and a destructured unlink, and not the word in a comment or a string", () => {
    const sample = [
      'import fs from "node:fs";',
      "const { unlink } = fs.promises;",
      "export function f(p: string) {",
      "  // fs.unlinkSync(p) in a comment",
      '  const s = "fs.rmSync(p)";',
      "  fs.unlinkSync(p);",
      "  fs.rmSync(p, { force: true });",
      "  void fs.promises.rm(p);",
      "  void unlink(p);",
      "  return s;",
      "}",
    ].join("\n");
    expect(removals("sample.ts", sample).map((r) => `${r.name}(${r.args})`)).toEqual([
      "unlinkSync(p)",
      "rmSync(p, { force: true })",
      "rm(p)",
      "unlink(p)",
    ]);
  });

  it("C50 in the new cleanup modules and moveWorkspaceFile, the only removals are one unlink of from after the copy's hash check, and one rmdir of an empty archive folder in the undo", () => {
    const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
    const modules = [
      "core/src/memory/cleanup.ts",
      "core/src/memory/cleanupScan.ts",
      "core/src/memory/cleanupApply.ts",
      "core/src/memory/minhash.ts",
      "apps/api/src/routes/cleanup.ts",
    ];
    const found = [
      ...modules.flatMap((rel) => removals(rel, read(rel))),
      ...removals(
        "core/src/security/safeWrite.ts",
        read("core/src/security/safeWrite.ts"),
        "moveWorkspaceFile",
      ),
    ];
    expect(found.map((r) => `${r.file} ${r.fn} ${r.name}(${r.args})`)).toEqual([
      "core/src/memory/cleanupApply.ts removeEmptyArchive rmdirSync(dir)",
      "core/src/security/safeWrite.ts moveWorkspaceFile unlinkSync(realFrom)",
    ]);
    // the unlink comes after the copy is hashed and compared, in the same function
    const safeWrite = read("core/src/security/safeWrite.ts");
    const unlinkAt = found.find((r) => r.name === "unlinkSync")!.pos;
    const checkAt = safeWrite.indexOf("copy.sha256() !== sha256");
    expect(checkAt).toBeGreaterThan(safeWrite.indexOf("export function moveWorkspaceFile"));
    expect(checkAt).toBeLessThan(unlinkAt);
    // the rmdir is the undo's: removeEmptyArchive is called from undoCleanup and from nowhere else
    const apply = read("core/src/memory/cleanupApply.ts");
    const sf = ts.createSourceFile("cleanupApply.ts", apply, ts.ScriptTarget.Latest, true);
    const callers: string[] = [];
    const visit = (node: ts.Node, fn: string | null) => {
      const here = ts.isFunctionDeclaration(node) && node.name ? node.name.text : fn;
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "removeEmptyArchive"
      )
        callers.push(here ?? "");
      ts.forEachChild(node, (child) => visit(child, here));
    };
    visit(sf, null);
    expect(callers).toEqual(["undoCleanup"]);
  });
});

/* ---- round 1: the apply planner and the undo at their own layer (Test policy row 1) ------------------------------ */

describe("S4 the apply planner and the undo at their own layer", () => {
  const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
  const asked: string[][] = [];
  const deps = (): CleanupMoveDeps => ({
    db: ctx.db,
    paths: ctx.paths,
    settings: ctx.settings(),
    indexer: {
      requestIndexPaths: (p: readonly string[]) => {
        asked.push([...p]);
        return Promise.resolve();
      },
    },
  });
  /** A folder of `memory/notes/` for one test. */
  const notes = (name: string) => {
    const dir = path.join(memory, "notes", `layer-${name}-${++seq}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  let ids = 0;
  /** A member as the scan saw it: its path, size and the hash of its bytes now. */
  const member = (file: string): CleanupFindingFile => {
    const st = fs.statSync(file);
    return { id: ++ids, path: file, size: st.size, mtime: st.mtimeMs, sha256: sha(fs.readFileSync(file)) };
  };
  const finding = (
    kind: CleanupFinding["kind"],
    files: string[],
    detail: CleanupFinding["detail"] = {},
  ): CleanupFinding => ({
    key: `${kind}:${sha(`${kind}-${++ids}`)}`,
    kind,
    files: files.map(member),
    detail,
    suggested: "keep",
  });
  /** A finished scan of its own scope key, with `decisions` stored on its findings through the decision rules. */
  function decided(
    findings: CleanupFinding[],
    decisions: Array<[number, string, number?]>,
  ): CleanupScanRecord {
    const scan: CleanupScanRecord = {
      scanId: `layer-${++seq}`,
      scope: { kind: "dir", path: memory },
      scopeKey: `dir:layer-${seq}`,
      status: "finished",
      phase: "findings",
      code: null,
      startedAt: NOW,
      finishedAt: NOW,
      findings,
      decided: 0,
    };
    saveCleanupDecisions(
      ctx.db,
      scan,
      decisions.map(([i, decision, keepFileId]) => ({ key: findings[i]!.key, decision, keepFileId })),
      { now: NOW },
    );
    return scan;
  }
  const dayOf = (at: number) => {
    const d = new Date(at);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  };
  /** Every name under a folder with its bytes' hash (a folder as "dir", a link as its target). */
  const snapshot = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (at: string) => {
      if (!fs.existsSync(at)) return;
      for (const e of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, e.name);
        if (e.isSymbolicLink()) out[full] = `link:${fs.readlinkSync(full)}`;
        else if (e.isDirectory()) {
          out[full] = "dir";
          walk(full);
        } else out[full] = sha(fs.readFileSync(full));
      }
    };
    walk(dir);
    return out;
  };
  /** The next archive folder this apply will make, by pinning the 8 hex of its name. */
  const pinArchive = (hex: string) => {
    const real = crypto.randomBytes.bind(crypto);
    return vi
      .spyOn(crypto, "randomBytes")
      .mockImplementation(((n: number, ...rest: unknown[]) =>
        n === 4
          ? Buffer.from(hex, "hex")
          : (real as (...a: unknown[]) => Buffer)(n, ...rest)) as typeof crypto.randomBytes);
  };
  /** Three files of `memory/notes/` archived by one apply. */
  function archivedThree(name: string, count = 3) {
    const dir = notes(name);
    const files = Array.from({ length: count }, (_, i) =>
      put(path.join(dir, `f${i}.md`), `layer ${name} ${i}\n`),
    );
    const scan = decided(
      files.map((f) => finding("untitled", [f])),
      files.map((_, i) => [i, "archive"] as [number, string]),
    );
    const res = applyCleanup(deps(), scan, { now: NOW });
    expect(res.moved).toHaveLength(count);
    return { files, res, toOf: (from: string) => res.moved.find((m) => m.from === from)!.to };
  }

  it("C41 archive on memory/notes/clientes/a.md and memory/notes/b.md moves both under memory/archive/<day>-<8 hex>/ with their paths, and the manifest is door 4's shape exactly (own layer)", () => {
    const dir = notes("c41");
    const a = put(path.join(dir, "clientes", "a.md"), "layer a\n");
    const b = put(path.join(dir, "b.md"), "layer bb\n");
    const scan = decided(
      [finding("untitled", [a]), finding("untitled", [b])],
      [
        [0, "archive"],
        [1, "archive"],
      ],
    );
    const [ma, mb] = [scan.findings[0]!.files[0]!, scan.findings[1]!.files[0]!];
    const res = applyCleanup(deps(), scan, { now: NOW });
    const folder = path.dirname(res.manifest!);
    expect(path.dirname(folder)).toBe(path.join(memory, "archive"));
    expect(path.basename(folder)).toMatch(new RegExp(`^${dayOf(NOW)}-[0-9a-f]{8}$`));
    const rel = (f: string) => path.relative(memory, f);
    expect(res.moved).toEqual([
      { from: a, to: path.join(folder, rel(a)) },
      { from: b, to: path.join(folder, rel(b)) },
    ]);
    expect(res.skipped).toEqual([]);
    expect(res.proposals).toBeNull();
    expect(fs.existsSync(a) || fs.existsSync(b)).toBe(false);
    expect(fs.readFileSync(path.join(folder, rel(a)), "utf8")).toBe("layer a\n");
    expect(JSON.parse(fs.readFileSync(res.manifest!, "utf8"))).toEqual({
      v: 1,
      createdAt: NOW,
      scope: scan.scopeKey,
      entries: [
        { from: a, to: path.join(folder, rel(a)), sha256: ma.sha256, size: ma.size },
        { from: b, to: path.join(folder, rel(b)), sha256: mb.sha256, size: mb.size },
      ],
    });
  });

  it("C42 a file changed after the scan is skipped as changed and a file gone as missing, both left where they are, and the third moves (own layer)", () => {
    const dir = notes("c42");
    const [changed, gone, fine] = ["mudou", "sumiu", "fica"].map((n) =>
      put(path.join(dir, `${n}.md`), `layer ${n}\n`),
    );
    const scan = decided(
      [finding("untitled", [changed!]), finding("untitled", [gone!]), finding("untitled", [fine!])],
      [
        [0, "archive"],
        [1, "archive"],
        [2, "archive"],
      ],
    );
    fs.appendFileSync(changed!, "+");
    fs.rmSync(gone!);
    const res = applyCleanup(deps(), scan, { now: NOW });
    expect(res.skipped).toEqual([
      { path: changed, reason: "changed" },
      { path: gone, reason: "missing" },
    ]);
    expect(res.moved.map((m) => m.from)).toEqual([fine]);
    expect(fs.readFileSync(changed!, "utf8")).toBe("layer mudou\n+");
    expect(fs.existsSync(gone!)).toBe(false);
  });

  it("C43 a file reached through a link on the way is forbidden_path and one whose destination exists is exists; both sides unchanged (own layer)", () => {
    const dir = notes("c43");
    const through = put(path.join(dir, "sub", "x.md"), "layer x\n");
    const taken = put(path.join(dir, "y.md"), "layer y\n");
    const scan = decided(
      [finding("untitled", [through]), finding("untitled", [taken])],
      [
        [0, "archive"],
        [1, "archive"],
      ],
    );
    fs.renameSync(path.join(dir, "sub"), path.join(dir, "sub-real"));
    fs.symlinkSync(path.join(dir, "sub-real"), path.join(dir, "sub"));
    const spy = pinArchive("1a7e1a7e");
    try {
      const folder = path.join(memory, "archive", `${dayOf(NOW)}-1a7e1a7e`);
      const occupant = put(path.join(folder, path.relative(memory, taken)), "ja estava\n");
      const before = snapshot(memory);
      const res = applyCleanup(deps(), scan, { now: NOW });
      expect(res.skipped).toEqual([
        { path: through, reason: "forbidden_path" },
        { path: taken, reason: "exists" },
      ]);
      expect([res.moved, res.manifest]).toEqual([[], null]);
      expect(snapshot(memory)).toEqual(before);
      expect(fs.readFileSync(occupant, "utf8")).toBe("ja estava\n");
    } finally {
      spy.mockRestore();
    }
  });

  it("C44 files outside memory/, a file already in the archive and an empty folder are proposals: nothing moved or written there, one line each in artifacts/cleanup/<day>-<id>.md (own layer)", () => {
    const out = folder("c44");
    const one = put(path.join(out, "um.md"), "layer um\n");
    const two = put(path.join(out, "pasta", "dois.md"), "layer dois\n");
    const kept = put(
      path.join(memory, "archive", "2026-01-01-0000c044", "notes", "velho.md"),
      "layer velho\n",
    );
    const empty = path.join(out, "vazia");
    fs.mkdirSync(empty);
    const scan = decided(
      [
        finding("stale", [one], { since: "mtime", ageDays: 400 }),
        finding("untitled", [two]),
        finding("untitled", [kept]),
        finding("empty-folder", [], { folder: empty }),
      ],
      [
        [0, "archive"],
        [1, "archive"],
        [2, "archive"],
        [3, "archive"],
      ],
    );
    const before = { ...snapshot(out), ...snapshot(memory) };
    const res = applyCleanup(deps(), scan, { now: NOW });
    expect([res.moved, res.skipped, res.manifest]).toEqual([[], [], null]);
    expect({ ...snapshot(out), ...snapshot(memory) }).toEqual(before);
    expect(path.dirname(res.proposals!)).toBe(path.join(ctx.paths.artifacts, "cleanup"));
    expect(path.basename(res.proposals!)).toMatch(new RegExp(`^${dayOf(NOW)}-[0-9a-f]{8}\\.md$`));
    const lines = fs
      .readFileSync(res.proposals!, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- [ ] "));
    expect(lines).toEqual([
      `- [ ] ${one} — archive — parado há 400 dias`,
      `- [ ] ${two} — archive — sem título`,
      `- [ ] ${kept} — archive — sem título`,
      `- [ ] ${empty}${path.sep} — archive — pasta vazia`,
    ]);
  });

  it("C45 a merge keeping the newest of three duplicates leaves it in place and moves the other two (own layer)", () => {
    const dir = notes("c45");
    const files = ["a", "b", "c"].map((n, i) => put(path.join(dir, `${n}.md`), "layer igual\n", 3 - i));
    const dup = finding("duplicate", files);
    const newest = dup.files[2]!.id;
    const res = applyCleanup(deps(), decided([dup], [[0, "merge", newest]]), { now: NOW });
    expect(res.moved.map((m) => m.from)).toEqual([files[0], files[1]]);
    expect(fs.existsSync(files[2]!)).toBe(true);
    expect(fs.existsSync(files[0]!) || fs.existsSync(files[1]!)).toBe(false);
  });

  it("C46 the indexer is asked for every origin and every destination of the moves (own layer)", () => {
    asked.length = 0;
    const { res } = archivedThree("c46", 2);
    expect(asked).toEqual([res.moved.flatMap((m) => [m.from, m.to])]);
    expect(asked[0]).toHaveLength(4);
  });

  it("C47 the scan an apply names: none is not_found, a running one scan_running, a replaced one scan_stale; under the exclusive lock the apply is restore_in_progress; none moves (own layer)", () => {
    const dir = notes("c47");
    const file = put(path.join(dir, "a.md"), "layer c47\n");
    const scan = decided([finding("untitled", [file])], [[0, "archive"]]);
    const running = { ...scan, scanId: "running", status: "running" as const };
    const newer = { ...scan, scanId: "newer" };
    const scans = (list: CleanupScanRecord[], latest: CleanupScanRecord) => ({
      get: (id: string) => list.find((s) => s.scanId === id),
      latest: (key: string) => (key === scan.scopeKey ? latest : undefined),
    });
    expect(() => cleanupScanFor(scans([scan], scan), "outro", "apply")).toThrow(CleanupNotFoundError);
    expect(() => cleanupScanFor(scans([running], running), "running", "apply")).toThrow(
      CleanupScanRunningError,
    );
    expect(() => cleanupScanFor(scans([scan, newer], newer), scan.scanId, "apply")).toThrow(
      CleanupScanStaleError,
    );
    expect(cleanupScanFor(scans([scan], scan), scan.scanId, "apply")).toBe(scan);
    const held = RestoreLock.acquire(ctx.paths, 0, "exclusive");
    try {
      expect(() => applyCleanup(deps(), scan, { now: NOW })).toThrow(RestoreInProgressError);
    } finally {
      held.release();
    }
    expect(fs.readFileSync(file, "utf8")).toBe("layer c47\n");
  });

  it("C48 the undo moves back the untouched file, skips a changed one and a missing one, and one whose origin exists; the folder stays while it is not empty (own layer)", () => {
    const { files, res, toOf } = archivedThree("c48");
    const folder = path.dirname(res.manifest!);
    fs.appendFileSync(toOf(files[0]!), "+");
    fs.rmSync(toOf(files[1]!));
    const r = undoCleanup(deps(), res.manifest!);
    expect(r.restored).toEqual([{ from: files[2], to: toOf(files[2]!) }]);
    expect(r.skipped).toEqual([
      { path: files[0], reason: "changed" },
      { path: files[1], reason: "missing" },
    ]);
    expect(fs.readFileSync(files[2]!, "utf8")).toBe("layer c48 2\n");
    expect(fs.existsSync(folder)).toBe(true);

    const second = archivedThree("c48b", 1);
    put(second.files[0]!, "outra no lugar\n");
    const again = undoCleanup(deps(), second.res.manifest!);
    expect([again.restored, again.skipped]).toEqual([[], [{ path: second.files[0], reason: "exists" }]]);
    expect(fs.existsSync(path.dirname(second.res.manifest!))).toBe(true);
  });

  it("C49 the undo refuses a path outside memory/archive/, another file name and a path that climbs out (validation), a manifest that is not there (not_found), v 2 (undo_conflict) and works under no exclusive lock (restore_in_progress); none moves (own layer)", () => {
    const { res } = archivedThree("c49", 1);
    const folder = path.dirname(res.manifest!);
    const v2 = put(
      path.join(memory, "archive", "2026-01-01-0000c049", "manifest.json"),
      JSON.stringify({ v: 2, entries: [] }),
    );
    put(path.join(folder, "outro.json"), "{}");
    const before = snapshot(memory);
    const cases: Array<[string, string, new (...a: never[]) => Error]> = [
      ["outside memory/archive/", path.join(memory, "notes", "manifest.json"), CleanupValidationError],
      ["another file name", path.join(folder, "outro.json"), CleanupValidationError],
      ["climbs out", `${memory}/archive/../notes/manifest.json`, CleanupValidationError],
      [
        "not there",
        path.join(memory, "archive", "2026-01-01-00000000", "manifest.json"),
        CleanupNotFoundError,
      ],
      ["v 2", v2, CleanupUndoConflictError],
    ];
    for (const [name, manifest, error] of cases)
      expect(() => undoCleanup(deps(), manifest), name).toThrow(error);
    const held = RestoreLock.acquire(ctx.paths, 0, "exclusive");
    try {
      expect(() => undoCleanup(deps(), res.manifest!)).toThrow(RestoreInProgressError);
    } finally {
      held.release();
    }
    expect(snapshot(memory)).toEqual(before);
  });

  it("C85 after an undo that moved every entry back, the manifest is at artifacts/cleanup/<archive name>.manifest.json with its bytes and the archive folder is gone (own layer)", () => {
    const { files, res } = archivedThree("c85", 2);
    const text = fs.readFileSync(res.manifest!, "utf8");
    const folder = path.dirname(res.manifest!);
    const r = undoCleanup(deps(), res.manifest!);
    expect(r.restored.map((e) => e.from)).toEqual(files);
    expect(r.skipped).toEqual([]);
    expect(
      fs.readFileSync(
        path.join(ctx.paths.artifacts, "cleanup", `${path.basename(folder)}.manifest.json`),
        "utf8",
      ),
    ).toBe(text);
    expect(fs.existsSync(folder)).toBe(false);
  });

  it("C86 the undo answers undo_conflict, one case per reason, and moves nothing: JSON it cannot read, v other than 1, an entry whose from is outside memory/ or inside the archive, and one whose to is outside its own folder (own layer)", () => {
    const { files, res, toOf } = archivedThree("c86", 1);
    const good = JSON.parse(fs.readFileSync(res.manifest!, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = good.entries[0]!;
    const outside = path.join(folder(`c86-fora`), "f0.md");
    const cases: Array<[string, string]> = [
      ["not JSON", "{ isto não é json"],
      ["v 2", JSON.stringify({ ...good, v: 2 })],
      ["from outside memory/", JSON.stringify({ ...good, entries: [{ ...entry, from: outside }] })],
      [
        "from inside the archive",
        JSON.stringify({
          ...good,
          entries: [{ ...entry, from: path.join(memory, "archive", "2026-01-01-0000aaaa", "f0.md") }],
        }),
      ],
      [
        "to outside its folder",
        JSON.stringify({
          ...good,
          entries: [{ ...entry, to: path.join(memory, "archive", "2026-01-01-0000bbbb", "f0.md") }],
        }),
      ],
    ];
    const original = fs.readFileSync(res.manifest!, "utf8");
    try {
      for (const [name, text] of cases) {
        fs.writeFileSync(res.manifest!, text);
        const before = { ...snapshot(memory), ...snapshot(path.dirname(outside)) };
        expect(() => undoCleanup(deps(), res.manifest!), name).toThrow(CleanupUndoConflictError);
        expect({ ...snapshot(memory), ...snapshot(path.dirname(outside)) }, name).toEqual(before);
      }
    } finally {
      fs.writeFileSync(res.manifest!, original);
    }
    expect(fs.existsSync(toOf(files[0]!))).toBe(true);
  });
});

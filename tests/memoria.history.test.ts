import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { recordVersion } from "../core/src/memory/historyStore.js";
import { code, memoriaWorld, sha, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { unifiedDiff } from "../core/src/sync/diff.js";

/**
 * cerebro-memoria-confiavel S2 over HTTP (C21-C38): the internal history of memory/ - the versions every writer
 * records, what an index pass finds, the retention, the three routes and who may call them. Every claim reads back what
 * the routes and the passes wrote (L-051): `GET /api/memory/history`, or the two tables when the claim is about them.
 */

const opened: MemoriaWorld[] = [];
afterAll(async () => {
  while (opened.length) await opened.pop()!.close();
});
async function world(name: string): Promise<MemoriaWorld> {
  const w = await memoriaWorld(`mordomo-memoria-history-${name}-`);
  opened.push(w);
  return w;
}

const history = async (w: MemoriaWorld, rel?: string, limit?: number): Promise<Json[]> => {
  const q = new URLSearchParams();
  if (rel !== undefined) q.set("path", rel);
  if (limit !== undefined) q.set("limit", String(limit));
  const res = await w.call("GET", `/api/memory/history${q.size ? `?${q}` : ""}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.versions as Json[];
};
const blobs = (w: MemoriaWorld) =>
  w.ctx.db.prepare("SELECT * FROM memory_blobs ORDER BY sha256").all() as Json[];
const versionRows = (w: MemoriaWorld) =>
  w.ctx.db.prepare("SELECT * FROM memory_versions ORDER BY id").all() as Json[];
const abs = (w: MemoriaWorld, rel: string) => path.join(w.memory, ...rel.split("/"));

/** Create a note through the route; its path relative to memory/ and its version. */
async function create(w: MemoriaWorld, title: string, content = "Texto.\n", folder?: string) {
  const res = await w.call("POST", "/api/memory/notes", { title, content, ...(folder ? { folder } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    file: res.body.path as string,
    rel: path.relative(w.memory, res.body.path).split(path.sep).join("/"),
    version: res.body.version as string,
  };
}
/** Save a note through the route; its new version. */
async function save(w: MemoriaWorld, file: string, content: string, baseVersion: string): Promise<string> {
  const res = await w.call("PUT", "/api/memory/notes", { path: file, content, baseVersion });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.version as string;
}
const current = (file: string) => sha(fs.readFileSync(file));
/** Text that deflate cannot shrink much: random bytes as hex. */
const noise = (n: number) => crypto.randomBytes(n).toString("hex");

describe("C21 each owner write records one version", () => {
  it("C21 create, save, properties, task and review each record exactly one version by owner with their origin; its sha256 is the answered version and its bytes the file's", async () => {
    const w = await world("c21");
    const note = await create(w, "Nota C21", "- [ ] uma tarefa\n");
    await w.index();
    const seen: Array<[string, string]> = [];
    const expectOne = async (origin: string, version: string) => {
      const versions = await history(w, note.rel);
      expect(versions.length, origin).toBe(seen.length + 1);
      const newest = versions[0]!;
      expect([newest.author, newest.origin, newest.sha256]).toEqual(["owner", origin, version]);
      const got = await w.call("GET", `/api/memory/history/${newest.id}`);
      expect(got.body.content).toBe(fs.readFileSync(note.file, "utf8"));
      seen.push([origin, version]);
    };
    await expectOne("create", note.version);

    let version = await save(w, note.file, "- [ ] uma tarefa\n\nMais texto.\n", note.version);
    await expectOne("save", version);

    const props = await w.call("PUT", "/api/memory/notes/properties", {
      path: note.file,
      baseVersion: version,
      set: { status: "active" },
    });
    expect(props.status, JSON.stringify(props.body)).toBe(200);
    version = props.body.version;
    await expectOne("properties", version);

    const text = fs.readFileSync(note.file, "utf8");
    const line = text.split("\n").findIndex((l) => l.startsWith("- [ ]")) + 1;
    const task = await w.call("PUT", "/api/memory/tasks", {
      path: note.file,
      line,
      done: true,
      baseVersion: version,
    });
    expect(task.status, JSON.stringify(task.body)).toBe(200);
    version = task.body.version;
    await expectOne("task", version);

    await w.index();
    const review = await w.call("POST", "/api/memory/reviews", {
      path: note.file,
      action: "keep",
      baseVersion: version,
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    await expectOne("review", review.body.version);

    // an index pass over the same bytes adds nothing
    await w.index();
    expect((await history(w, note.rel)).map((v) => v.origin)).toEqual([
      "review",
      "task",
      "properties",
      "save",
      "create",
    ]);
  });
});

describe("C22 the cleanup's moves are versions", () => {
  async function ended(w: MemoriaWorld, scanId: string): Promise<Json> {
    for (let i = 0; i < 4000; i++) {
      const res = await w.call("GET", `/api/memory/cleanup/scans/${scanId}`);
      if (res.body.status !== "running") return res.body;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`scan ${scanId} did not end`);
  }
  it("C22 apply of a one-move manifest records cleanup at the archive path and removed at notes/velha.md; the undo records cleanup at notes/velha.md and removed at the archive path", async () => {
    const w = await world("c22");
    const old = w.put(abs(w, "notes/velha.md"), "sem titulo velha\n");
    await w.index();
    const started = await w.call("POST", "/api/memory/cleanup/scans", { dir: path.join(w.memory, "notes") });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    const scan = await ended(w, started.body.scanId);
    const finding = (scan.findings as Json[]).find(
      (f) => f.kind === "untitled" && (f.files as Json[]).some((m) => m.path === old),
    )!;
    expect(finding).toBeDefined();
    const decided = await w.call("PUT", "/api/memory/cleanup/decisions", {
      scanId: scan.scanId,
      decisions: [{ key: finding.key, decision: "archive" }],
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const blobsBefore = blobs(w).length;
    const applied = await w.call("POST", "/api/memory/cleanup/apply", { scanId: scan.scanId });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.moved).toHaveLength(1);
    const to = applied.body.moved[0].to as string;
    const toRel = path.relative(w.memory, to).split(path.sep).join("/");
    expect(toRel).toMatch(/^archive\/[^/]+\/notes\/velha\.md$/);

    const atArchive = (await history(w, toRel))[0]!;
    expect([atArchive.author, atArchive.origin, atArchive.sha256]).toEqual([
      "owner",
      "cleanup",
      sha("sem titulo velha\n"),
    ]);
    const left = (await history(w, "notes/velha.md"))[0]!;
    expect([left.author, left.origin, left.sha256, left.size]).toEqual(["owner", "removed", null, null]);
    // the archived bytes were already a blob (the baseline); the removed version adds none
    expect(blobs(w)).toHaveLength(blobsBefore);

    const undone = await w.call("POST", "/api/memory/cleanup/undo", { manifest: applied.body.manifest });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    const back = (await history(w, "notes/velha.md"))[0]!;
    expect([back.author, back.origin, back.sha256]).toEqual(["owner", "cleanup", sha("sem titulo velha\n")]);
    const archivedGone = (await history(w, toRel))[0]!;
    expect([archivedGone.origin, archivedGone.sha256]).toEqual(["removed", null]);
  });
});

describe("C23 a change made outside is an external version", () => {
  it("C23 an fs edit and a pass record one external version with the new bytes; a second pass none; a new mtime over the same bytes none", async () => {
    const w = await world("c23");
    const file = w.put(abs(w, "notes/fora.md"), "# Fora\n\nAntes.\n");
    await w.index();
    expect((await history(w, "notes/fora.md")).map((v) => v.origin)).toEqual(["baseline"]);
    fs.writeFileSync(file, "# Fora\n\nDepois, mudado fora.\n");
    await w.index();
    const versions = await history(w, "notes/fora.md");
    expect(versions.map((v) => [v.author, v.origin])).toEqual([
      ["external", "external"],
      ["system", "baseline"],
    ]);
    expect(versions[0]!.sha256).toBe(sha("# Fora\n\nDepois, mudado fora.\n"));
    await w.index();
    expect(await history(w, "notes/fora.md")).toHaveLength(2);
    const later = Date.now() / 1000 + 60;
    fs.utimesSync(file, later, later);
    await w.index();
    expect(await history(w, "notes/fora.md")).toHaveLength(2);
  });
});

describe("C24 a file that is gone is a removed version", () => {
  it("C24 an fs delete and a pass record one removed version (sha256 null, author external, no blob); a second pass none more; created again it is external", async () => {
    const w = await world("c24");
    const file = w.put(abs(w, "notes/some.md"), "# Some\n");
    await w.index();
    const blobsBefore = blobs(w).length;
    fs.rmSync(file);
    await w.index();
    let versions = await history(w, "notes/some.md");
    expect(versions.map((v) => [v.author, v.origin, v.sha256])).toEqual([
      ["external", "removed", null],
      ["system", "baseline", sha("# Some\n")],
    ]);
    expect(versions[0]!.exists).toBe(false);
    expect(blobs(w)).toHaveLength(blobsBefore);
    await w.index();
    expect(await history(w, "notes/some.md")).toHaveLength(2);
    w.put(file, "# Some, de novo\n");
    await w.index();
    versions = await history(w, "notes/some.md");
    expect(versions.map((v) => v.origin)).toEqual(["external", "removed", "baseline"]);
    expect(versions[0]!.sha256).toBe(sha("# Some, de novo\n"));
  });
});

describe("C25 the versioned set through an index pass", () => {
  it("C25 the nine versioned paths get one version each, the eight others none", async () => {
    const w = await world("c25");
    const outside = w.indexedRoot("c25-fora");
    const versioned = [
      "MEMORY.md",
      "notes/a.md",
      "topics/x.md",
      "archive/x.md",
      "notes/journal/x.md",
      "notes/areas/x.md",
      "notes/contexts/x.md",
      "notes/ROUTER.md",
      "notes/exato.md",
    ];
    const not = [
      "journal/2026-10-31.md",
      "areas/a.md",
      "contexts/c.md",
      "ROUTER.md",
      "notes/a.txt",
      "notes/b.json",
      "notes/grande.md",
    ];
    for (const rel of [...versioned, ...not]) {
      const text =
        rel === "notes/exato.md"
          ? "a".repeat(1_048_576)
          : rel === "notes/grande.md"
            ? "a".repeat(1_048_577)
            : `# ${rel}\n`;
      w.put(abs(w, rel), rel === "notes/b.json" ? "{}\n" : text);
    }
    const out = w.put(path.join(outside, "fora.md"), "# Fora\n");
    const before = versionRows(w).length;
    await w.index();
    const byPath = new Map<string, number>();
    for (const r of versionRows(w).slice(before)) byPath.set(r.path, (byPath.get(r.path) ?? 0) + 1);
    for (const rel of versioned) expect(byPath.get(rel), rel).toBe(1);
    for (const rel of not) expect(byPath.get(rel), rel).toBeUndefined();
    expect(
      versionRows(w).some((r) => String(r.path).includes("fora") || path.isAbsolute(String(r.path))),
    ).toBe(false);
    expect(fs.existsSync(out)).toBe(true);
  });
});

describe("C26 the same bytes are one blob", () => {
  it("C26 A, B, A again: three versions and two blobs; another path saved with A adds none; each blob is sha256, deflate, size and inflates to the bytes", async () => {
    const w = await world("c26");
    const A = "# A\n\nO texto A.\n";
    const B = "# B\n\nO texto B, outro.\n";
    const one = await create(w, "Um");
    const two = await create(w, "Dois");
    const versions0 = versionRows(w).length;
    const blobs0 = blobs(w).length;
    let v = await save(w, one.file, A, one.version);
    v = await save(w, one.file, B, v);
    await save(w, one.file, A, v);
    expect(versionRows(w).length - versions0).toBe(3);
    expect(blobs(w).length - blobs0).toBe(2);
    await save(w, two.file, A, two.version);
    expect(blobs(w).length - blobs0).toBe(2);
    for (const text of [A, B]) {
      const row = blobs(w).find((b) => b.sha256 === sha(text))!;
      expect(row).toBeDefined();
      expect([row.codec, row.size]).toEqual(["deflate", Buffer.byteLength(text)]);
      expect(zlib.inflateRawSync(row.bytes).toString("utf8")).toBe(text);
    }
  });
});

describe("C27 fifty versions per path", () => {
  it("C27 50 kept; the 51st drops exactly the oldest by id; its blob goes when no other version names it", async () => {
    const w = await world("c27");
    const note = await create(w, "Cinquenta", "versão 1\n");
    let v = note.version;
    for (let i = 2; i <= 50; i++) v = await save(w, note.file, `versão ${i}\n`, v);
    let versions = await history(w, note.rel);
    expect(versions).toHaveLength(50);
    const oldest = versions.at(-1)!;
    expect(oldest.origin).toBe("create");
    const oldestSha = oldest.sha256;
    v = await save(w, note.file, "versão 51\n", v);
    versions = await history(w, note.rel);
    expect(versions).toHaveLength(50);
    expect(versions.map((x) => x.id)).not.toContain(oldest.id);
    expect(Math.min(...versions.map((x) => x.id))).toBeGreaterThan(oldest.id);
    expect(blobs(w).some((b) => b.sha256 === oldestSha)).toBe(false);
  });

  it("C27 the dropped version's blob is kept when another path's version names it", async () => {
    const w = await world("c27b");
    const shared = "# Igual\n\nOs mesmos bytes.\n";
    const other = w.put(abs(w, "notes/outra.md"), shared);
    const file = w.put(abs(w, "notes/cinquenta.md"), shared);
    await w.index();
    let v = current(file);
    for (let i = 2; i <= 51; i++) v = await save(w, file, `versão ${i}\n`, v);
    const versions = await history(w, "notes/cinquenta.md");
    expect(versions).toHaveLength(50);
    expect(versions.some((x) => x.origin === "baseline")).toBe(false);
    expect(blobs(w).some((b) => b.sha256 === sha(shared))).toBe(true);
    expect((await history(w, "notes/outra.md"))[0]!.sha256).toBe(sha(shared));
    expect(fs.existsSync(other)).toBe(true);
  });
});

describe("C28 the byte cap", () => {
  const putCap = async (w: MemoriaWorld, maxBytes: number) => {
    const now = await w.call("GET", "/api/settings");
    const res = await w.call("PUT", "/api/settings", {
      memory: { ...now.body.memory, history: { maxBytes } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.settings.memory.history.maxBytes).toBe(maxBytes);
  };
  const stored = (w: MemoriaWorld) =>
    (w.ctx.db.prepare("SELECT COALESCE(SUM(length(bytes)), 0) n FROM memory_blobs").get() as { n: number }).n;

  it("C28 at the cap exactly nothing is dropped; above it the oldest versions outside the newest 5 go until the store fits, with their blobs", async () => {
    const w = await world("c28");
    const texts = Array.from({ length: 14 }, () => `${noise(400)}\n`);
    const file = w.put(abs(w, "notes/cheia.md"), texts[0]!);
    await w.index();
    let v = current(file);
    for (let i = 1; i < 12; i++) v = await save(w, file, texts[i]!, v);
    expect(blobs(w)).toHaveLength(12);
    const thirteenth = zlib.deflateRawSync(Buffer.from(texts[12]!)).length;
    await putCap(w, stored(w) + thirteenth);
    v = await save(w, file, texts[12]!, v);
    expect(await history(w, "notes/cheia.md")).toHaveLength(13);
    expect(stored(w)).toBe(w.ctx.settings().memory.history.maxBytes);

    const before = await history(w, "notes/cheia.md");
    await save(w, file, texts[13]!, v);
    const after = await history(w, "notes/cheia.md");
    const cap = w.ctx.settings().memory.history.maxBytes;
    expect(stored(w)).toBeLessThanOrEqual(cap);
    const kept = new Set(after.map((x) => x.id));
    const dropped = before.filter((x) => !kept.has(x.id));
    expect(dropped.length).toBeGreaterThan(0);
    // the dropped are the oldest, never one of the newest 5
    expect(dropped.map((x) => x.id)).toEqual(before.slice(-dropped.length).map((x) => x.id));
    expect(after.length).toBeGreaterThanOrEqual(5);
    // no more than needed: with the newest dropped one back, the store would not fit
    const newestDropped = dropped[0]!;
    expect(blobs(w).some((b) => b.sha256 === newestDropped.sha256)).toBe(false);
    // before[k] holds texts[12 - k]
    const back = zlib.deflateRawSync(Buffer.from(texts[12 - before.indexOf(newestDropped)]!)).length;
    expect(stored(w) + back).toBeGreaterThan(cap);
    // every blob is named by a version
    const named = new Set(versionRows(w).map((r) => r.sha256));
    for (const b of blobs(w)) expect(named.has(b.sha256)).toBe(true);
  });

  it("C28 a store where every path holds 5 or fewer versions keeps them all, even above the cap", async () => {
    const w = await world("c28b");
    await putCap(w, 1);
    for (const name of ["um", "dois", "tres"]) {
      const file = w.put(abs(w, `notes/${name}.md`), `${noise(200)}\n`);
      await w.index();
      let v = current(file);
      for (let i = 0; i < 4; i++) v = await save(w, file, `${noise(200)}\n`, v);
    }
    for (const name of ["um", "dois", "tres"]) expect(await history(w, `notes/${name}.md`)).toHaveLength(5);
    expect(stored(w)).toBeGreaterThan(1);
  });
});

describe("C29 the versions of one path", () => {
  it("C29 newest first with exactly the eight keys; limit=1 the newest; an absolute path, .., limit=0 and limit=abc are 400", async () => {
    const w = await world("c29");
    const note = await create(w, "A", "um\n");
    const v = await save(w, note.file, "dois\n", note.version);
    await save(w, note.file, "três\n", v);
    const rel = note.rel;
    expect(rel).toBe("notes/a.md");
    const versions = await history(w, "notes/a.md");
    expect(versions.map((x) => x.origin)).toEqual(["save", "save", "create"]);
    expect(versions.map((x) => x.id)).toEqual([...versions.map((x) => x.id)].sort((a, b) => b - a));
    for (const x of versions) {
      expect(Object.keys(x).sort()).toEqual([
        "at",
        "author",
        "exists",
        "id",
        "origin",
        "path",
        "sha256",
        "size",
      ]);
      expect(x.path).toBe("notes/a.md");
    }
    const one = await history(w, "notes/a.md", 1);
    expect(one.map((x) => x.id)).toEqual([versions[0]!.id]);
    for (const q of ["path=%2Fabs%2Fa.md", "path=..%2Ffora.md", "limit=0", "limit=abc"]) {
      expect(code(await w.call("GET", `/api/memory/history?${q}`)), q).toEqual([400, "validation"]);
    }
  });
});

describe("C30 the newest 100 across memory/", () => {
  it("C30 of 101 versions over four paths, the newest 100 by id descending; of exactly 100, 100; exists follows the file", async () => {
    const w = await world("c30");
    const files: Array<{ file: string; v: string }> = [];
    for (const name of ["Um", "Dois", "Três", "Quatro"]) {
      const n = await create(w, name, "0\n");
      files.push({ file: n.file, v: n.version });
    }
    let total = versionRows(w).length;
    for (let i = 0; total < 100; i++, total++) {
      const f = files[i % 4]!;
      f.v = await save(w, f.file, `${i}\n`, f.v);
    }
    expect(versionRows(w)).toHaveLength(100);
    expect(await history(w)).toHaveLength(100);
    files[0]!.v = await save(w, files[0]!.file, "um a mais\n", files[0]!.v);
    const all = versionRows(w).map((r) => r.id as number);
    expect(all).toHaveLength(101);
    const listed = await history(w);
    expect(listed.map((x) => x.id)).toEqual(all.sort((a, b) => b - a).slice(0, 100));
    const gone = path.relative(w.memory, files[1]!.file).split(path.sep).join("/");
    expect(listed.filter((x) => x.path === gone).every((x) => x.exists === true)).toBe(true);
    fs.rmSync(files[1]!.file);
    const after = await history(w);
    expect(after.filter((x) => x.path === gone).length).toBeGreaterThan(0);
    expect(after.filter((x) => x.path === gone).every((x) => x.exists === false)).toBe(true);
    expect(after.filter((x) => x.path !== gone).every((x) => x.exists === true)).toBe(true);
  });
});

describe("C31 one version", () => {
  it("C31 its text, the diff from the current text to it, and the current version; for a path that is gone the diff from nothing and current null; unknown and removed ids are 404", async () => {
    const w = await world("c31");
    const note = await create(w, "Diff", "linha um\nlinha dois\n");
    const created = fs.readFileSync(note.file, "utf8");
    const v1 = (await history(w, note.rel))[0]!;
    const v = await save(w, note.file, "linha um\nlinha três\n", note.version);
    const got = await w.call("GET", `/api/memory/history/${v1.id}`);
    expect(got.status).toBe(200);
    const original = fs.readFileSync(note.file, "utf8");
    expect(original).toBe("linha um\nlinha três\n");
    expect(got.body).toEqual({
      id: v1.id,
      path: note.rel,
      at: v1.at,
      author: "owner",
      origin: "create",
      content: created,
      diff: unifiedDiff(original, created),
      current: v,
    });
    fs.rmSync(note.file);
    await w.index();
    const gone = await w.call("GET", `/api/memory/history/${v1.id}`);
    expect(gone.body.diff).toBe(unifiedDiff("", created));
    expect(gone.body.current).toBeNull();
    const removed = (await history(w, note.rel))[0]!;
    expect(removed.origin).toBe("removed");
    expect(code(await w.call("GET", `/api/memory/history/${removed.id}`))).toEqual([404, "not_found"]);
    expect(code(await w.call("GET", "/api/memory/history/999999"))).toEqual([404, "not_found"]);
  });
});

describe("C32 restore over the file", () => {
  it("C32 the second of three versions with baseVersion: 200 path and version; the bytes byte for byte (CRLF, no final newline); one restore version by owner, the newest", async () => {
    const w = await world("c32");
    const file = w.put(abs(w, "notes/crlf.md"), "um\r\ndois");
    await w.index();
    const second = "um\r\ndois\r\ntrês sem fim";
    let v = await save(w, file, second, current(file));
    v = await save(w, file, "outra coisa\n", v);
    const versions = await history(w, "notes/crlf.md");
    expect(versions).toHaveLength(3);
    const target = versions[1]!;
    const res = await w.call("POST", "/api/memory/history/restore", { id: target.id, baseVersion: v });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ path: "notes/crlf.md", version: sha(second) });
    expect(fs.readFileSync(file).equals(Buffer.from(second, "utf8"))).toBe(true);
    const after = await history(w, "notes/crlf.md");
    expect(after).toHaveLength(4);
    expect([after[0]!.author, after[0]!.origin, after[0]!.sha256]).toEqual(["owner", "restore", sha(second)]);
  });
});

describe("C33 restore of a note that is gone", () => {
  it("C33 notes/sumiu.md saved twice, deleted and indexed: its second version with no baseVersion is created again, 200, and a restore version", async () => {
    const w = await world("c33");
    const file = w.put(abs(w, "notes/sumiu.md"), "# Sumiu\n");
    await w.index();
    let v = await save(w, file, "# Sumiu\n\nprimeira\n", current(file));
    v = await save(w, file, "# Sumiu\n\nsegunda\n", v);
    fs.rmSync(file);
    await w.index();
    const versions = await history(w, "notes/sumiu.md");
    expect(versions[0]!.origin).toBe("removed");
    const second = versions.find((x) => x.sha256 === v)!;
    const res = await w.call("POST", "/api/memory/history/restore", { id: second.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe("# Sumiu\n\nsegunda\n");
    const after = await history(w, "notes/sumiu.md");
    expect([after[0]!.origin, after[0]!.sha256]).toEqual(["restore", v]);
  });
});

describe("C34 restore conflicts", () => {
  it("C34 a baseVersion that is not the file's is 409 edit_conflict: bytes, mtime and versions unchanged; no baseVersion over a removed path made again is 409 and the new file stays", async () => {
    const w = await world("c34");
    const note = await create(w, "Conflito", "um\n");
    const v = await save(w, note.file, "dois\n", note.version);
    const first = (await history(w, note.rel)).at(-1)!;
    const stat = fs.statSync(note.file);
    const count = (await history(w, note.rel)).length;
    const res = await w.call("POST", "/api/memory/history/restore", {
      id: first.id,
      baseVersion: note.version,
    });
    expect(code(res)).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(note.file, "utf8")).toBe("dois\n");
    expect(fs.statSync(note.file).mtimeMs).toBe(stat.mtimeMs);
    expect(await history(w, note.rel)).toHaveLength(count);
    expect(v).toBe(current(note.file));

    fs.rmSync(note.file);
    await w.index();
    expect((await history(w, note.rel))[0]!.origin).toBe("removed");
    fs.writeFileSync(note.file, "feito de novo\n");
    const again = await w.call("POST", "/api/memory/history/restore", { id: first.id });
    expect(code(again)).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(note.file, "utf8")).toBe("feito de novo\n");
  });
});

describe("C35 restore refusals", () => {
  it("C35 journal/ is 403 note_not_editable; a path through a link 403 forbidden_path; unknown and removed ids 404; no id 400; none writes a file", async () => {
    const w = await world("c35");
    const journalId = recordVersion(
      w.ctx.db,
      { rel: "journal/2026-10-31.md", bytes: Buffer.from("# 2026-10-31\n"), author: "owner", origin: "save" },
      268_435_456,
    );
    const real = w.put(abs(w, "notes/real/a.md"), "# A real\n");
    w.put(abs(w, "notes/ligado/a.md"), "# A ligado\n");
    await w.index();
    const linked = (await history(w, "notes/ligado/a.md"))[0]!;
    fs.rmSync(abs(w, "notes/ligado"), { recursive: true });
    fs.symlinkSync(path.dirname(real), abs(w, "notes/ligado"));
    const gone = w.put(abs(w, "notes/gone.md"), "# Gone\n");
    await w.index();
    fs.rmSync(gone);
    await w.index();
    const removed = (await history(w, "notes/gone.md"))[0]!;
    expect(removed.origin).toBe("removed");

    const listing = () => {
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          out.push(
            `${full}:${e.isFile() ? fs.readFileSync(full, "utf8") : e.isSymbolicLink() ? "link" : "dir"}`,
          );
          if (e.isDirectory()) walk(full);
        }
      };
      walk(w.memory);
      return out.sort();
    };
    const before = listing();
    const restore = (body: Json) => w.call("POST", "/api/memory/history/restore", body);
    expect(code(await restore({ id: journalId }))).toEqual([403, "note_not_editable"]);
    expect(code(await restore({ id: linked.id }))).toEqual([403, "forbidden_path"]);
    expect(code(await restore({ id: 999_999 }))).toEqual([404, "not_found"]);
    expect(code(await restore({ id: removed.id }))).toEqual([404, "not_found"]);
    expect(code(await restore({}))).toEqual([400, "validation"]);
    expect(listing()).toEqual(before);
  });
});

describe("C36 who may call the history", () => {
  it("C36 a device with every scope gets 403 owner_only from the restore; content reads, monitor gets 403 scope_required; a memory skill's run credential 403 forbidden from all three", async () => {
    const w = await world("c36");
    const note = await create(w, "Quem", "um\n");
    await save(w, note.file, "dois\n", note.version);
    const first = (await history(w, note.rel)).at(-1)!;
    const all = w.device(["content", "monitor", "run", "approve"]);
    const content = w.device(["content"]);
    const monitor = w.device(["monitor"]);
    const run = w.run("write").headers;
    const bytes = fs.readFileSync(note.file);
    const rows = versionRows(w).length;

    const restoreBody = { id: first.id, baseVersion: current(note.file) };
    expect(code(await w.call("POST", "/api/memory/history/restore", restoreBody, all))).toEqual([
      403,
      "owner_only",
    ]);
    expect(fs.readFileSync(note.file).equals(bytes)).toBe(true);
    expect(versionRows(w)).toHaveLength(rows);

    const reads = [
      `/api/memory/history?path=${encodeURIComponent(note.rel)}`,
      `/api/memory/history/${first.id}`,
    ];
    for (const url of reads) {
      expect((await w.call("GET", url, undefined, content)).status, url).toBe(200);
      expect(code(await w.call("GET", url, undefined, monitor)), url).toEqual([403, "scope_required"]);
      expect(code(await w.call("GET", url, undefined, run)), url).toEqual([403, "forbidden"]);
    }
    expect(code(await w.call("POST", "/api/memory/history/restore", restoreBody, run))).toEqual([
      403,
      "forbidden",
    ]);
    expect(fs.readFileSync(note.file).equals(bytes)).toBe(true);
    expect(versionRows(w)).toHaveLength(rows);
  });
});

describe("C37 the first pass writes the baselines", () => {
  it("C37 four versioned and three unversioned files: four baseline versions by system; a second pass none; a cap below their size keeps all four", async () => {
    const w = await world("c37");
    w.update((s) => {
      s.memory.history = { maxBytes: 10 };
    });
    const versioned = ["MEMORY.md", "notes/a.md", "notes/b.md", "topics/t.md"];
    for (const rel of versioned) w.put(abs(w, rel), `# ${rel}\n\n${noise(100)}\n`);
    for (const rel of ["journal/2026-10-31.md", "notes/c.txt", "ROUTER.md"]) w.put(abs(w, rel), `# ${rel}\n`);
    const before = versionRows(w).length;
    await w.index();
    const rows = versionRows(w).slice(before);
    expect(rows.map((r) => [r.path, r.author, r.origin]).sort()).toEqual(
      versioned.map((rel) => [rel, "system", "baseline"]).sort(),
    );
    const size = (w.ctx.db.prepare("SELECT SUM(length(bytes)) n FROM memory_blobs").get() as { n: number }).n;
    expect(size).toBeGreaterThan(10);
    await w.index();
    expect(versionRows(w).length - before).toBe(4);
  });
});

describe("C38 nothing of the history is written under memory/", () => {
  it("C38 ten writes that record a version change the listing of memory/ only by the files they wrote; the two tables hold the versions", async () => {
    const w = await world("c38");
    const a = await create(w, "Dez A", "a\n");
    const b = await create(w, "Dez B", "b\n");
    await w.index();
    const listing = () => {
      const out: Record<string, string> = {};
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            out[full] = "dir";
            walk(full);
          } else out[full] = sha(fs.readFileSync(full));
        }
      };
      walk(w.memory);
      return out;
    };
    const before = listing();
    const versions = versionRows(w).length;
    let va = a.version;
    let vb = b.version;
    for (let i = 0; i < 5; i++) {
      va = await save(w, a.file, `a ${i}\n`, va);
      vb = await save(w, b.file, `b ${i}\n`, vb);
    }
    await w.index();
    const after = listing();
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
    expect(changed.sort()).toEqual([a.file, b.file].sort());
    expect(Object.keys(after).some((k) => k.split(path.sep).includes(".git"))).toBe(false);
    expect(versionRows(w).length - versions).toBe(10);
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OsEvent } from "@mordomo/core";
import { RestoreLock } from "../core/src/restoreLock.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch B, S4: `POST /api/memory/cleanup/apply` and `POST
 * /api/memory/cleanup/undo`, through `app.inject` against `buildServer` over a real home (one home per case, so the
 * paths under `memory/` are the ones the claims name). The test's own eyes on the disk are `fs`.
 */

const DAY = 86_400_000;
const hex = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const code = (r: { body: Json }) => r.body?.error?.code;
const opened: NotesViewWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (opened.length) await opened.pop()!.close();
});

async function world(): Promise<NotesViewWorld> {
  const w = await notesViewWorld("mordomo-cleanup-apply-");
  opened.push(w);
  return w;
}
const day = () => {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
async function ended(w: NotesViewWorld, scanId: string): Promise<Json> {
  for (let i = 0; i < 4000; i++) {
    const res = await w.call("GET", `/api/memory/cleanup/scans/${scanId}`);
    if (res.body.status !== "running") return res.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`scan ${scanId} did not end`);
}
async function scanned(w: NotesViewWorld, dir: string): Promise<Json> {
  const res = await w.call("POST", "/api/memory/cleanup/scans", { dir });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return ended(w, res.body.scanId);
}
/** Answer `decision` on the finding of `kind` whose first member is `file`. */
async function answer(
  w: NotesViewWorld,
  scan: Json,
  entries: Array<[string, string, string, Json?]>,
): Promise<void> {
  const decisions = entries.map(([file, kind, decision, extra]) => {
    const f = (scan.findings as Json[]).find(
      (x) => x.kind === kind && (x.files as Json[]).some((m) => m.path === file),
    );
    expect(f, `${kind} of ${file}`).toBeDefined();
    return { key: f!.key, decision, ...(extra ?? {}) };
  });
  const res = await w.call("PUT", "/api/memory/cleanup/decisions", { scanId: scan.scanId, decisions });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
const apply = (w: NotesViewWorld, scanId: string) => w.call("POST", "/api/memory/cleanup/apply", { scanId });
const undo = (w: NotesViewWorld, manifest: string) =>
  w.call("POST", "/api/memory/cleanup/undo", { manifest });
/** Every name under a folder with its bytes' hash (a folder as "dir"). */
function snapshot(dir: string, skip: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    if (!fs.existsSync(at)) return;
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (skip.some((s) => full === s || full.startsWith(`${s}${path.sep}`))) continue;
      if (entry.isSymbolicLink()) out[full] = `link:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        out[full] = "dir";
        walk(full);
      } else out[full] = hex(fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
}
const archiveName = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

describe("S4 apply", () => {
  it("C41 archive answers on memory/notes/clientes/a.md and memory/notes/b.md move both under memory/archive/<day>-<8 hex>/ with their paths, and manifest.json is door 4's shape exactly", async () => {
    const w = await world();
    const notes = path.join(w.memory, "notes");
    const a = w.put(path.join(notes, "clientes", "a.md"), "sem titulo a\n");
    const b = w.put(path.join(notes, "b.md"), "sem titulo b\n");
    await w.index();
    const scan = await scanned(w, notes);
    await answer(w, scan, [
      [a, "untitled", "archive"],
      [b, "untitled", "archive"],
    ]);
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const folder = path.dirname(res.body.manifest);
    expect(path.dirname(folder)).toBe(path.join(w.memory, "archive"));
    expect(path.basename(folder)).toMatch(archiveName);
    expect(path.basename(folder).slice(0, 10)).toBe(day());
    expect(res.body.manifest).toBe(
      path.join(w.home, "memory", "archive", path.basename(folder), "manifest.json"),
    );
    const toA = path.join(folder, "notes", "clientes", "a.md");
    const toB = path.join(folder, "notes", "b.md");
    const byFrom = (x: Json, y: Json) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0);
    expect([...(res.body.moved as Json[])].sort(byFrom)).toEqual(
      [
        { from: a, to: toA },
        { from: b, to: toB },
      ].sort(byFrom),
    );
    expect(res.body.skipped).toEqual([]);
    expect(res.body.proposals).toBeNull();
    expect(fs.readFileSync(toA, "utf8")).toBe("sem titulo a\n");
    expect(fs.readFileSync(toB, "utf8")).toBe("sem titulo b\n");
    expect(fs.existsSync(a) || fs.existsSync(b)).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(res.body.manifest, "utf8"));
    const entry = (from: string, to: string, text: string) => ({
      from,
      to,
      sha256: hex(text),
      size: Buffer.byteLength(text),
    });
    expect(manifest).toEqual({
      v: 1,
      createdAt: expect.any(Number),
      scope: `dir:${notes}`,
      entries: expect.arrayContaining([entry(a, toA, "sem titulo a\n"), entry(b, toB, "sem titulo b\n")]),
    });
    expect(manifest.entries).toHaveLength(2);
    expect(Object.keys(manifest).sort()).toEqual(["createdAt", "entries", "scope", "v"]);
    for (const e of manifest.entries) expect(Object.keys(e).sort()).toEqual(["from", "sha256", "size", "to"]);
  });

  it("C42 a file changed after the scan is skipped as changed, a deleted one as missing, both stay where they are, and the third moves", async () => {
    const w = await world();
    const dir = path.join(w.memory, "notes", "c42");
    const [x, y, z] = ["x", "y", "z"].map((n) => w.put(path.join(dir, `${n}.md`), `sem titulo ${n}\n`));
    await w.index();
    const scan = await scanned(w, dir);
    await answer(
      w,
      scan,
      [x, y, z].map((f) => [f!, "untitled", "archive"] as [string, string, string]),
    );
    fs.appendFileSync(x!, "+");
    fs.rmSync(y!);
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.skipped).toEqual([
      { path: x, reason: "changed" },
      { path: y, reason: "missing" },
    ]);
    expect(fs.readFileSync(x!, "utf8")).toBe("sem titulo x\n+");
    expect(fs.existsSync(y!)).toBe(false);
    expect((res.body.moved as Json[]).map((m) => m.from)).toEqual([z]);
    expect(fs.existsSync(z!)).toBe(false);
    expect(fs.readFileSync(res.body.moved[0].to, "utf8")).toBe("sem titulo z\n");
  });

  it("C43 a file reached through a link on the way is skipped as forbidden_path and one whose destination exists as exists; origin and destination stay byte for byte", async () => {
    const w = await world();
    const dir = path.join(w.memory, "notes", "c43");
    const through = w.put(path.join(dir, "sub", "x.md"), "sem titulo x\n");
    const taken = w.put(path.join(dir, "y.md"), "sem titulo y\n");
    await w.index();
    const scan = await scanned(w, dir);
    await answer(w, scan, [
      [through, "untitled", "archive"],
      [taken, "untitled", "archive"],
    ]);
    // after the scan: sub/ becomes a link to a folder holding the same bytes
    fs.renameSync(path.join(dir, "sub"), path.join(dir, "sub-real"));
    fs.symlinkSync(path.join(dir, "sub-real"), path.join(dir, "sub"));
    // the archive folder of this apply already holds y.md
    const realRandom = crypto.randomBytes.bind(crypto);
    vi.spyOn(crypto, "randomBytes").mockImplementation(((n: number, ...rest: unknown[]) =>
      n === 4
        ? Buffer.from("c43c43c4", "hex")
        : (realRandom as (...a: unknown[]) => Buffer)(n, ...rest)) as typeof crypto.randomBytes);
    const folder = path.join(w.memory, "archive", `${day()}-c43c43c4`);
    const occupant = w.put(path.join(folder, "notes", "c43", "y.md"), "ja estava aqui\n");
    const before = snapshot(w.memory);
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.skipped).toEqual([
      { path: through, reason: "forbidden_path" },
      { path: taken, reason: "exists" },
    ]);
    expect(res.body.moved).toEqual([]);
    expect(res.body.manifest).toBeNull();
    expect(snapshot(w.memory)).toEqual(before);
    expect(fs.readFileSync(occupant, "utf8")).toBe("ja estava aqui\n");
  });

  it("C44 archive answers on two files of an indexed folder outside memory/ move and write nothing there, write the proposal list with one line per file, return its path, and change nothing outside memory/archive/ and artifacts/cleanup/", async () => {
    const w = await world();
    const root = w.indexedRoot("c44");
    const one = w.put(path.join(root, "um.md"), "sem titulo um\n");
    const two = w.put(path.join(root, "pasta", "dois.md"), "sem titulo dois\n");
    await w.index();
    const scan = await scanned(w, root);
    await answer(w, scan, [
      [one, "untitled", "archive"],
      [two, "untitled", "archive"],
    ]);
    const outside = snapshot(root);
    // Outside memory/archive/ and artifacts/cleanup/; the request log and the database's shared memory change with every
    // request the server answers, whatever the route, and are not files the apply writes.
    const engineOwn = [path.join(w.home, "logs"), path.join(w.home, "config", "db")];
    const kept = [path.join(w.memory, "archive"), path.join(w.home, "artifacts", "cleanup"), ...engineOwn];
    const homeBefore = snapshot(w.home, kept);
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toEqual([]);
    expect(res.body.manifest).toBeNull();
    expect(snapshot(root)).toEqual(outside);
    const list = res.body.proposals as string;
    expect(path.dirname(list)).toBe(path.join(w.home, "artifacts", "cleanup"));
    expect(path.basename(list)).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.md$/);
    expect(path.basename(list).slice(0, 10)).toBe(day());
    const lines = fs
      .readFileSync(list, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("- [ ] "));
    expect(lines.sort()).toEqual(
      [`- [ ] ${one} — archive — sem título`, `- [ ] ${two} — archive — sem título`].sort(),
    );
    expect(snapshot(w.home, kept)).toEqual(homeBefore);
    expect(fs.existsSync(path.join(w.memory, "archive"))).toBe(false);
  });

  it("C45 a merge keeping the newest of three duplicates under memory/notes/ leaves it and moves the other two", async () => {
    const w = await world();
    const dir = path.join(w.memory, "notes", "c45");
    const files = [30, 20, 2].map((age, i) => {
      const f = w.put(path.join(dir, `copia-${i}.md`), "# Copia\nmesmo texto\n");
      const at = (Date.now() - age * DAY) / 1000;
      fs.utimesSync(f, at, at);
      return f;
    });
    await w.index();
    const scan = await scanned(w, dir);
    const dup = (scan.findings as Json[]).find((f) => f.kind === "duplicate")!;
    expect(dup.files).toHaveLength(3);
    const newest = [...(dup.files as Json[])].sort((a, b) => b.mtime - a.mtime)[0]!;
    expect(newest.path).toBe(files[2]);
    await answer(w, scan, [[files[0]!, "duplicate", "merge", { keepFileId: newest.id }]]);
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(new Set((res.body.moved as Json[]).map((m) => m.from))).toEqual(new Set([files[0], files[1]]));
    expect(fs.readFileSync(files[2]!, "utf8")).toBe("# Copia\nmesmo texto\n");
    expect(fs.existsSync(files[0]!) || fs.existsSync(files[1]!)).toBe(false);
    for (const m of res.body.moved as Json[])
      expect(fs.readFileSync(m.to, "utf8")).toBe("# Copia\nmesmo texto\n");
  });

  it("C46 the index is asked for the four paths of two moves; after index.finished the search finds the file under memory/archive/ and not at its origin, the next scan reports neither, and the origin folder's fresh _index.md is stale with no folder of memory/archive/ in the map", async () => {
    const w = await world();
    const dir = path.join(w.memory, "notes", "c46");
    const a = w.put(path.join(dir, "a.md"), "# Alfa\nzebrafaxina palavra unica\n");
    const b = w.put(path.join(dir, "b.md"), "# Beta\noutra nota\n");
    w.put(path.join(dir, "fica.md"), "# Fica\nesta nao sai\n");
    await w.index();
    const maps = async () => (await w.call("GET", "/api/memory/maps?root=memory")).body.folders as Json[];
    const origin = (await maps()).find((f) => f.path === dir)!;
    expect(origin).toBeDefined();
    w.put(
      origin.indexPath,
      [
        "---",
        "type: index",
        "status: active",
        `children-digest: ${origin.digest}`,
        "generated-by: organize-brain",
        "---",
        "",
        "# Índice",
        "",
      ].join("\n"),
    );
    await w.index();
    expect((await maps()).find((f) => f.path === dir)!.state).toBe("fresh");

    const scan = await scanned(w, dir);
    await answer(w, scan, [
      [a, "orphan", "archive"],
      [b, "orphan", "archive"],
    ]);
    const asked = vi.spyOn(w.ctx.indexer, "requestIndexPaths");
    const finished = new Promise<void>((resolve) => {
      const off = w.ctx.events.subscribe((e: OsEvent) => {
        if (e.type === "index.finished") {
          off();
          resolve();
        }
      });
    });
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const moved = res.body.moved as Json[];
    expect(moved).toHaveLength(2);
    expect(asked).toHaveBeenCalledTimes(1);
    expect([...(asked.mock.calls[0]![0] as string[])].sort()).toEqual(
      [a, b, ...moved.map((m) => m.to as string)].sort(),
    );
    await finished;

    const search = await w.call("GET", "/api/memory/search?q=zebrafaxina");
    expect(search.status, JSON.stringify(search.body)).toBe(200);
    const found = JSON.stringify(search.body);
    const toA = moved.find((m) => m.from === a)!.to as string;
    expect(found).toContain(toA);
    expect(found).not.toContain(JSON.stringify(a));

    const next = await scanned(w, w.memory);
    const about = (next.findings as Json[]).filter((f) =>
      (f.files as Json[]).some((m) => [a, b, ...moved.map((x) => x.to)].includes(m.path)),
    );
    expect(about).toEqual([]);

    const after = await maps();
    expect(after.find((f) => f.path === dir)!.state).toBe("stale");
    expect(after.filter((f) => String(f.path).startsWith(path.join(w.memory, "archive")))).toEqual([]);
  });

  it("C47 apply answers 404 not_found for an unknown scan, 409 scan_running while it runs, 409 scan_stale for a replaced scan and 409 restore_in_progress under the exclusive lock; none moves a file", async () => {
    const w = await world();
    const dir = path.join(w.memory, "notes", "c47");
    for (let i = 0; i < 600; i++) w.put(path.join(dir, `n${i}.md`), `sem titulo numero ${i}\n`);
    await w.index();
    const before = snapshot(w.memory);

    const missing = await apply(w, "nao-existe");
    expect([missing.status, code(missing)]).toEqual([404, "not_found"]);

    const running = w.ctx.cleanup.start({ dir });
    const busy = await apply(w, running);
    expect(w.ctx.cleanup.get(running)!.status).toBe("running");
    expect([busy.status, code(busy)]).toEqual([409, "scan_running"]);
    const first = await ended(w, running);
    await answer(w, first, [[path.join(dir, "n0.md"), "untitled", "archive"]]);

    const second = await scanned(w, dir);
    const stale = await apply(w, first.scanId);
    expect([stale.status, code(stale)]).toEqual([409, "scan_stale"]);

    await answer(w, second, [[path.join(dir, "n1.md"), "untitled", "archive"]]);
    const held = RestoreLock.acquire(w.ctx.paths, 0, "exclusive");
    try {
      const locked = await apply(w, second.scanId);
      expect([locked.status, code(locked)]).toEqual([409, "restore_in_progress"]);
    } finally {
      held.release();
    }
    expect(snapshot(w.memory)).toEqual(before);
  }, 120_000);
});

describe("S4 undo", () => {
  /** Three notes under memory/notes/<name>/ archived by one apply. */
  async function archived(
    w: NotesViewWorld,
    name: string,
    count = 3,
  ): Promise<{ files: string[]; res: Json }> {
    const dir = path.join(w.memory, "notes", name);
    const files = Array.from({ length: count }, (_, i) =>
      w.put(path.join(dir, `f${i}.md`), `sem titulo ${name} ${i}\n`),
    );
    await w.index();
    const scan = await scanned(w, dir);
    await answer(
      w,
      scan,
      files.map((f) => [f, "untitled", "archive"] as [string, string, string]),
    );
    const res = await apply(w, scan.scanId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toHaveLength(count);
    return { files, res: res.body };
  }
  const toOf = (res: Json, from: string) => (res.moved as Json[]).find((m) => m.from === from)!.to as string;

  it("C48 the undo moves back the untouched file, skips a changed one and a missing one, skips one whose origin exists, and takes the archive folder away only when it is left empty", async () => {
    const w = await world();
    const { files, res } = await archived(w, "c48");
    const [changed, missing, untouched] = files as [string, string, string];
    fs.appendFileSync(toOf(res, changed), "+");
    fs.rmSync(toOf(res, missing));
    const back = await undo(w, res.manifest);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.restored).toEqual([{ from: untouched, to: toOf(res, untouched) }]);
    expect(back.body.skipped).toEqual([
      { path: changed, reason: "changed" },
      { path: missing, reason: "missing" },
    ]);
    expect(fs.readFileSync(untouched, "utf8")).toBe("sem titulo c48 2\n");
    expect(fs.existsSync(toOf(res, untouched))).toBe(false);
    expect(fs.existsSync(path.dirname(res.manifest))).toBe(true);

    // the origin is taken again: exists
    const second = await archived(w, "c48-existe", 1);
    const from = second.files[0]!;
    w.put(from, "outra nota no lugar\n");
    const taken = await undo(w, second.res.manifest);
    expect(taken.body).toEqual({ restored: [], skipped: [{ path: from, reason: "exists" }] });
    expect(fs.readFileSync(toOf(second.res, from), "utf8")).toBe("sem titulo c48-existe 0\n");
    expect(fs.existsSync(path.dirname(second.res.manifest))).toBe(true);

    // every entry back: the folder is left empty and goes
    const third = await archived(w, "c48-vazia", 2);
    const all = await undo(w, third.res.manifest);
    expect(all.body.restored).toHaveLength(2);
    expect(all.body.skipped).toEqual([]);
    for (const f of third.files) expect(fs.existsSync(f)).toBe(true);
    expect(fs.existsSync(path.dirname(third.res.manifest))).toBe(false);
  }, 60_000);

  it("C49 undo answers 400 validation for a path outside memory/archive/, another file name and a path that climbs out; 404 for a manifest that does not exist; 409 undo_conflict for v 2; 409 restore_in_progress under the lock; none moves a file", async () => {
    const w = await world();
    const { res } = await archived(w, "c49", 1);
    const folder = path.dirname(res.manifest);
    const v2 = path.join(w.memory, "archive", "2026-01-01-0000beef", "manifest.json");
    w.put(v2, JSON.stringify({ v: 2, createdAt: 1, scope: "dir:/x", entries: [] }));
    w.put(path.join(folder, "outro.json"), "{}");
    const files = () => ({ ...snapshot(w.memory), ...snapshot(path.join(w.home, "artifacts")) });
    const before = files();
    const cases: Array<[string, string, number, string]> = [
      ["outside memory/archive/", path.join(w.memory, "notes", "manifest.json"), 400, "validation"],
      ["another file name", path.join(folder, "outro.json"), 400, "validation"],
      ["climbs out", `${w.memory}/archive/../notes/manifest.json`, 400, "validation"],
      [
        "does not exist",
        path.join(w.memory, "archive", "2026-01-01-00000000", "manifest.json"),
        404,
        "not_found",
      ],
      ["v 2", v2, 409, "undo_conflict"],
    ];
    for (const [name, manifest, status, errorCode] of cases) {
      const r = await undo(w, manifest);
      expect([r.status, code(r)], name).toEqual([status, errorCode]);
    }
    const held = RestoreLock.acquire(w.ctx.paths, 0, "exclusive");
    try {
      const locked = await undo(w, res.manifest);
      expect([locked.status, code(locked)]).toEqual([409, "restore_in_progress"]);
    } finally {
      held.release();
    }
    expect(files()).toEqual(before);
  });

  it("C85 after an undo that moved every entry back, the manifest is at artifacts/cleanup/<day>-<8 hex>.manifest.json with its bytes, and the archive folder is gone", async () => {
    const w = await world();
    const { res } = await archived(w, "registro", 2);
    const text = fs.readFileSync(res.manifest, "utf8");
    const name = path.basename(path.dirname(res.manifest));
    expect(name).toMatch(archiveName);
    const back = await undo(w, res.manifest);
    expect(back.body.restored).toHaveLength(2);
    expect(back.body.skipped).toEqual([]);
    expect(fs.readFileSync(path.join(w.home, "artifacts", "cleanup", `${name}.manifest.json`), "utf8")).toBe(
      text,
    );
    expect(fs.existsSync(path.dirname(res.manifest))).toBe(false);
    expect(fs.readdirSync(path.join(w.memory, "archive"))).toEqual([]);
  });

  it("C86 undo answers 409 undo_conflict, one case per reason, and moves nothing: JSON it cannot read, v other than 1, an entry whose from is outside memory/ or inside the archive, and one whose to is outside its own folder", async () => {
    const w = await world();
    const { res } = await archived(w, "c86", 1);
    const original = fs.readFileSync(res.manifest, "utf8");
    const good = JSON.parse(original) as { entries: Json[] };
    const entry = good.entries[0]!;
    const outside = path.join(w.indexedRoot("c86-fora"), "f0.md");
    const cases: Array<[string, string]> = [
      ["not JSON", "{ isto não é json"],
      ["v 2", JSON.stringify({ ...good, v: 2 })],
      ["from outside memory/", JSON.stringify({ ...good, entries: [{ ...entry, from: outside }] })],
      [
        "from inside the archive",
        JSON.stringify({
          ...good,
          entries: [{ ...entry, from: path.join(w.memory, "archive", "2026-01-01-0000aaaa", "f0.md") }],
        }),
      ],
      [
        "to outside its folder",
        JSON.stringify({
          ...good,
          entries: [{ ...entry, to: path.join(w.memory, "archive", "2026-01-01-0000bbbb", "f0.md") }],
        }),
      ],
    ];
    const files = () => ({ ...snapshot(w.memory, [res.manifest]), ...snapshot(path.dirname(outside)) });
    const before = files();
    for (const [name, text] of cases) {
      fs.writeFileSync(res.manifest, text);
      const r = await undo(w, res.manifest);
      expect([r.status, code(r)], name).toEqual([409, "undo_conflict"]);
      expect(files(), name).toEqual(before);
    }
    fs.writeFileSync(res.manifest, original);
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MONDAY, code, rituaisWorld, sha, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/**
 * S4 of .specs/features/cerebro-rituais through `GET /api/memory/weekly-review` and
 * `POST /api/memory/weekly-review/archive` (door 5): what `archive` and `inbox` list, the move to `memory/archive/` with
 * the cleanup's manifest, the proposal for what lies outside `memory/`, the refusals, the skips, the week's count and
 * the cleanup's undo of a weekly manifest. Now is Monday 2026-11-09 10:00 local; the files' `mtime` is set by the test.
 */

const WEEK = "2026-11-09";
const DAY = 86_400_000;
const ITEM_KEYS = ["doneSince", "editable", "path", "title"];
const INBOX_KEYS = ["ageDays", "path", "title"];
/** The bare hex SHA-256 the manifest records (the world's `sha` is the note version, `sha256:<hex>`). */
const hex = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const archiveName = new RegExp(`^${WEEK}-[0-9a-f]{8}$`);
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-archive-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  w.update((s) => {
    s.indexedFolders = [];
    s.contexts = [];
  });
  await w.reset();
});
let randomSpy: { mockRestore(): void } | null = null;
afterEach(() => {
  // Only the spy of this file: the world's clock is a spy too.
  randomSpy?.mockRestore();
  randomSpy = null;
});

const notes = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
const inbox = (...parts: string[]) => path.join(w.memory, "inbox", ...parts);
const done = (file: string, extra: Record<string, string> = {}) =>
  w.note(file, { type: "project", status: "done", ...extra }, "# Feito\n");
const rel = (file: string) => path.relative(w.memory, file).split(path.sep).join("/");
const localDay = (at: number) => {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
/** Every name under a folder with its bytes' hash (a folder as "dir", a link as its target). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    if (!fs.existsSync(at)) return;
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isSymbolicLink()) out[full] = `link:${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        out[full] = "dir";
        walk(full);
      } else out[full] = sha(fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
}
const history = async (file: string): Promise<Json[]> => {
  const res = await w.call("GET", `/api/memory/history?path=${encodeURIComponent(rel(file))}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.versions as Json[];
};
/** Fix the 8 hex of the next archive folder. */
function fixArchiveId(hex: string): void {
  const real = crypto.randomBytes.bind(crypto);
  randomSpy = vi
    .spyOn(crypto, "randomBytes")
    .mockImplementation(((n: number, ...rest: unknown[]) =>
      n === 4
        ? Buffer.from(hex, "hex")
        : (real as (...a: unknown[]) => Buffer)(n, ...rest)) as typeof crypto.randomBytes);
}

// ---- C34, C35 ----------------------------------------------------------------------------------------------------

describe("C34 who is in archive", () => {
  it("C34 a done project of memory/ and one outside with exactly path, title, editable and doneSince; not under memory/archive/, not type: status", async () => {
    const root = w.indexedRoot("fora");
    const mine = done(notes("p.md"), { title: "Projeto P" });
    const outside = done(path.join(root, "q.md"));
    const archived = done(path.join(w.memory, "archive", "2026-10-01-ab12cd34", "notes", "r.md"));
    const status = w.note(notes("s.md"), { type: "status", status: "done" });
    const at = new Date(2026, 10, 3, 23, 30).getTime();
    w.touch(mine, at);
    w.touch(outside, at + 60_000);
    await w.index();
    const review = await w.review();
    const byPath = (x: Json, y: Json) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
    expect([...review.archive.items].sort(byPath)).toEqual(
      [
        { path: mine, title: "Projeto P", editable: true, doneSince: localDay(at) },
        { path: outside, title: "Feito", editable: false, doneSince: localDay(at + 60_000) },
      ].sort(byPath),
    );
    for (const item of review.archive.items) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    expect(review.archive.items.map((i: Json) => i.path)).not.toContain(archived);
    expect(review.archive.items.map((i: Json) => i.path)).not.toContain(status);
    expect(review.archive.total).toBe(2);
  });
});

describe("C35 who is in inbox", () => {
  it("C35 every indexed file under memory/inbox/ at any depth with exactly path, title and ageDays, oldest first; memory/inboxes/ is not listed", async () => {
    const a = w.put(inbox("a.md"), "# A\n");
    const b = w.put(inbox("sub", "b.pdf"), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]));
    const lookAlike = w.put(path.join(w.memory, "inboxes", "x.md"), "# X\n");
    w.touch(a, MONDAY - 2 * DAY);
    w.touch(b, MONDAY - 5 * DAY);
    w.touch(lookAlike, MONDAY - 9 * DAY);
    await w.index();
    const review = await w.review();
    expect(review.inbox.items.map((i: Json) => [i.path, i.ageDays])).toEqual([
      [b, 5],
      [a, 2],
    ]);
    for (const item of review.inbox.items) expect(Object.keys(item).sort()).toEqual(INBOX_KEYS);
    expect(review.inbox.items.find((i: Json) => i.path === a).title).toBe("A");
    expect(review.inbox.total).toBe(2);
  });

  it("C35 with one file in the inbox, items has 1", async () => {
    w.put(inbox("so.md"), "# Só\n");
    await w.index();
    const review = await w.review();
    expect(review.inbox.items).toHaveLength(1);
    expect(review.inbox.total).toBe(1);
  });
});

// ---- C36, C37 ----------------------------------------------------------------------------------------------------

describe("C36 the archive of the week", () => {
  it("C36 a done project and an inbox file move under memory/archive/2026-11-09-<8 hex>/ with their bytes, the manifest of scope weekly:2026-11-09, the answer, and one cleanup version per move", async () => {
    const p = done(notes("p.md"));
    const a = w.put(inbox("a.md"), "# Caixa A\n");
    const pBytes = fs.readFileSync(p);
    await w.index();
    const before = Date.now();
    const res = await w.archive({ week: WEEK, paths: [p, a] });
    const after = Date.now();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const folder = path.dirname(res.body.manifest);
    expect(path.dirname(folder)).toBe(path.join(w.memory, "archive"));
    expect(path.basename(folder)).toMatch(archiveName);
    const toP = path.join(folder, "notes", "p.md");
    const toA = path.join(folder, "inbox", "a.md");
    expect(res.body).toEqual({
      manifest: path.join(folder, "manifest.json"),
      moved: [
        { from: p, to: toP },
        { from: a, to: toA },
      ],
      skipped: [],
      proposals: null,
    });
    expect(fs.readFileSync(toP).equals(pBytes)).toBe(true);
    expect(fs.readFileSync(toA, "utf8")).toBe("# Caixa A\n");
    expect(fs.existsSync(p) || fs.existsSync(a)).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(res.body.manifest, "utf8"));
    expect(manifest).toEqual({
      v: 1,
      createdAt: manifest.createdAt,
      scope: `weekly:${WEEK}`,
      entries: [
        { from: p, to: toP, sha256: hex(pBytes), size: pBytes.length },
        { from: a, to: toA, sha256: hex("# Caixa A\n"), size: Buffer.byteLength("# Caixa A\n") },
      ],
    });
    expect(manifest.createdAt).toBeGreaterThanOrEqual(before);
    expect(manifest.createdAt).toBeLessThanOrEqual(after);
    for (const to of [toP, toA]) {
      const cleanup = (await history(to)).filter((v) => v.origin === "cleanup");
      expect(
        cleanup.map((v) => [v.author, v.sha256]),
        to,
      ).toEqual([["owner", sha(fs.readFileSync(to))]]);
    }
  });

  it("C36 with exactly one path, one move and one entry", async () => {
    const a = w.put(inbox("um.md"), "# Um\n");
    await w.index();
    const res = await w.archive({ week: WEEK, paths: [a] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toHaveLength(1);
    expect(res.body.moved[0].from).toBe(a);
    expect(JSON.parse(fs.readFileSync(res.body.manifest, "utf8")).entries).toHaveLength(1);
  });
});

describe("C37 a path outside memory/ is a proposal", () => {
  it("C37 a done project of an indexed folder is neither moved nor written and is a line of the proposal list; alone, manifest null and moved empty", async () => {
    const root = w.indexedRoot("fora");
    const outside = done(path.join(root, "fora.md"));
    const outside2 = done(path.join(root, "fora2.md"));
    const a = w.put(inbox("a.md"), "# A\n");
    await w.index();
    const listed = (await w.review()).archive.items.map((i: Json) => i.path);
    expect(listed).toEqual(expect.arrayContaining([outside, outside2]));
    const stat = (f: string) => [sha(fs.readFileSync(f)), fs.statSync(f).mtimeMs];
    const was = [stat(outside), stat(outside2)];

    const mixed = await w.archive({ week: WEEK, paths: [outside, a] });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(200);
    expect(mixed.body.moved.map((m: Json) => m.from)).toEqual([a]);
    expect(path.basename(mixed.body.proposals)).toMatch(new RegExp(`^${WEEK}-[0-9a-f]{8}\\.md$`));
    expect(path.dirname(mixed.body.proposals)).toBe(path.join(w.ctx.paths.artifacts, "cleanup"));
    const lines = fs.readFileSync(mixed.body.proposals, "utf8").split("\n");
    expect(lines.filter((l) => l.startsWith("- [ ] "))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith(`- [ ] ${outside} `))).toBe(true);

    const alone = await w.archive({ week: WEEK, paths: [outside2] });
    expect(alone.status, JSON.stringify(alone.body)).toBe(200);
    expect(alone.body.manifest).toBeNull();
    expect(alone.body.moved).toEqual([]);
    expect(alone.body.skipped).toEqual([]);
    expect(path.basename(alone.body.proposals)).toMatch(new RegExp(`^${WEEK}-[0-9a-f]{8}\\.md$`));
    expect(
      fs
        .readFileSync(alone.body.proposals, "utf8")
        .split("\n")
        .filter((l) => l.startsWith("- [ ] ")),
    ).toEqual([
      expect.stringMatching(new RegExp(`^- \\[ \\] ${outside2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `)),
    ]);
    expect([stat(outside), stat(outside2)]).toEqual(was);
  });
});

// ---- C38, C39 ----------------------------------------------------------------------------------------------------

describe("C38 the paths the archive refuses", () => {
  it("C38 each refused body answers 400 validation and moves nothing, alone", async () => {
    const active = w.note(notes("ativo.md"), { type: "project", status: "active" });
    const paused = w.note(notes("pausado.md"), { type: "project", status: "paused" });
    const nowhere = w.put(notes("solta.md"), "# Solta\n");
    const inArchive = done(path.join(w.memory, "archive", "2026-10-01-ab12cd34", "notes", "velho.md"));
    const listed = w.put(inbox("listado.md"), "# Listado\n");
    await w.index();
    const review = await w.review();
    expect(review.projects.items.map((i: Json) => i.path)).toEqual([active]);
    expect(review.someday.projects.map((i: Json) => i.path)).toEqual([paused]);
    expect(review.inbox.items.map((i: Json) => i.path)).toEqual([listed]);
    const before = snapshot(w.memory);
    for (const paths of [[active], [paused], [nowhere], [inArchive], [listed, nowhere], []]) {
      const res = await w.archive({ week: WEEK, paths });
      expect(code(res), JSON.stringify(paths)).toEqual([400, "validation"]);
    }
    expect(snapshot(w.memory)).toEqual(before);
    expect(w.weeks()).toEqual([]);
  });

  it("C38 101 listed paths answer 400 validation and move nothing; exactly 100 are accepted and moved", async () => {
    const files = Array.from({ length: 101 }, (_, i) =>
      w.put(inbox(`f${String(i).padStart(3, "0")}.md`), `# F${i}\n`),
    );
    await w.index();
    expect((await w.review()).inbox.total).toBe(101);
    const before = snapshot(w.memory);
    expect(code(await w.archive({ week: WEEK, paths: files }))).toEqual([400, "validation"]);
    expect(snapshot(w.memory)).toEqual(before);
    const res = await w.archive({ week: WEEK, paths: files.slice(0, 100) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved).toHaveLength(100);
    expect(fs.existsSync(files[100]!)).toBe(true);
  });

  it("C38 the list checked is the one with no context (G31): a done project outside the active context is accepted", async () => {
    const root = w.indexedRoot("r");
    const app = path.join(root, "app");
    fs.mkdirSync(app, { recursive: true });
    w.update((s) => {
      s.contexts = [{ id: "app", name: "App", paths: [app] }];
    });
    const elsewhere = done(notes("fora-do-contexto.md"));
    await w.index();
    expect((await w.review("context=app")).archive.items).toEqual([]);
    const res = await w.archive({ week: WEEK, paths: [elsewhere] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved.map((m: Json) => m.from)).toEqual([elsewhere]);
  });
});

describe("C39 the week of the archive", () => {
  it("C39 2026-11-02, 2026-11-16 and 2026-11-10 answer 409 week_mismatch and 2026-W46 400 validation, moving nothing", async () => {
    const a = w.put(inbox("a.md"), "# A\n");
    await w.index();
    const before = snapshot(w.memory);
    for (const week of ["2026-11-02", "2026-11-16", "2026-11-10"]) {
      expect(code(await w.archive({ week, paths: [a] })), week).toEqual([409, "week_mismatch"]);
    }
    expect(code(await w.archive({ week: "2026-W46", paths: [a] }))).toEqual([400, "validation"]);
    expect(snapshot(w.memory)).toEqual(before);
    expect(w.weeks()).toEqual([]);
    expect((await w.archive({ week: WEEK, paths: [a] })).status).toBe(200);
  });
});

// ---- C40 ---------------------------------------------------------------------------------------------------------

describe("C40 the skips", () => {
  /** The other file of each case, moved while one is skipped; the manifest names only it. */
  async function other(res: { status: number; body: Json }, moved: string): Promise<void> {
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved.map((m: Json) => m.from)).toEqual([moved]);
    expect(fs.existsSync(moved)).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(res.body.manifest, "utf8"));
    expect(manifest.entries.map((e: Json) => e.from)).toEqual([moved]);
  }

  it("C40 a file deleted after the GET is skipped as missing", async () => {
    const gone = w.put(inbox("a.md"), "# A\n");
    const stays = w.put(inbox("b.md"), "# B\n");
    await w.index();
    expect((await w.review()).inbox.total).toBe(2);
    fs.rmSync(gone);
    const res = await w.archive({ week: WEEK, paths: [gone, stays] });
    expect(res.body.skipped).toEqual([{ path: gone, reason: "missing" }]);
    await other(res, stays);
    expect(fs.existsSync(gone)).toBe(false);
  });

  it("C40 a destination made to exist is skipped as exists, origin and destination byte for byte", async () => {
    const taken = w.put(inbox("a.md"), "# A\n");
    const stays = w.put(inbox("b.md"), "# B\n");
    await w.index();
    fixArchiveId("c40c40c4");
    const occupant = w.put(
      path.join(w.memory, "archive", `${WEEK}-c40c40c4`, "inbox", "a.md"),
      "já estava\n",
    );
    const res = await w.archive({ week: WEEK, paths: [taken, stays] });
    expect(res.body.skipped).toEqual([{ path: taken, reason: "exists" }]);
    await other(res, stays);
    expect(fs.readFileSync(taken, "utf8")).toBe("# A\n");
    expect(fs.readFileSync(occupant, "utf8")).toBe("já estava\n");
  });

  it("C40 a folder on the way replaced by a link is skipped as forbidden_path, origin and destination byte for byte", async () => {
    const through = w.put(inbox("sub", "x.md"), "# X\n");
    const stays = w.put(inbox("b.md"), "# B\n");
    await w.index();
    fs.renameSync(inbox("sub"), inbox("sub-real"));
    fs.symlinkSync(inbox("sub-real"), inbox("sub"));
    const res = await w.archive({ week: WEEK, paths: [through, stays] });
    expect(res.body.skipped).toEqual([{ path: through, reason: "forbidden_path" }]);
    await other(res, stays);
    expect(fs.readFileSync(inbox("sub-real", "x.md"), "utf8")).toBe("# X\n");
    const folder = path.dirname(res.body.manifest);
    expect(fs.existsSync(path.join(folder, "inbox", "sub-real", "x.md"))).toBe(false);
    expect(fs.existsSync(path.join(folder, "inbox", "sub", "x.md"))).toBe(false);
  });

  it("C40 a path replaced by a folder after the GET is skipped as changed (G9), and the folder stays as it was", async () => {
    const replaced = w.put(inbox("a.md"), "# A\n");
    const stays = w.put(inbox("b.md"), "# B\n");
    await w.index();
    fs.rmSync(replaced);
    fs.mkdirSync(replaced);
    fs.writeFileSync(path.join(replaced, "dentro.md"), "# Dentro\n");
    const res = await w.archive({ week: WEEK, paths: [replaced, stays] });
    expect(res.body.skipped).toEqual([{ path: replaced, reason: "changed" }]);
    await other(res, stays);
    expect(fs.readFileSync(path.join(replaced, "dentro.md"), "utf8")).toBe("# Dentro\n");
    expect(fs.existsSync(path.join(path.dirname(res.body.manifest), "inbox", "a.md"))).toBe(false);
  });
});

// ---- C41, C42 ----------------------------------------------------------------------------------------------------

describe("C41 the week's archived count", () => {
  it("C41 2 moved, then 1 more, then only skips and proposals, then the undo: archived 2, 3, 3, 3", async () => {
    const root = w.indexedRoot("fora");
    const outside = done(path.join(root, "fora.md"));
    const [a, b, c] = ["a", "b", "c"].map((n) => w.put(inbox(`${n}.md`), `# ${n}\n`));
    const gone = w.put(inbox("gone.md"), "# gone\n");
    await w.index();
    const first = await w.archive({ week: WEEK, paths: [a, b] });
    expect(first.body.moved).toHaveLength(2);
    expect(w.weeks()).toEqual([{ week: WEEK, archived: 2, finished_at: null, counts: null }]);
    const second = await w.archive({ week: WEEK, paths: [c] });
    expect(second.body.moved).toHaveLength(1);
    expect(w.weeks()).toEqual([{ week: WEEK, archived: 3, finished_at: null, counts: null }]);
    fs.rmSync(gone!);
    const third = await w.archive({ week: WEEK, paths: [gone, outside] });
    expect(third.status, JSON.stringify(third.body)).toBe(200);
    expect(third.body.moved).toEqual([]);
    expect(third.body.skipped).toEqual([{ path: gone, reason: "missing" }]);
    expect(third.body.proposals).not.toBeNull();
    expect(w.weeks()).toEqual([{ week: WEEK, archived: 3, finished_at: null, counts: null }]);
    const undone = await w.call("POST", "/api/memory/cleanup/undo", { manifest: first.body.manifest });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.restored).toHaveLength(2);
    expect(w.weeks()).toEqual([{ week: WEEK, archived: 3, finished_at: null, counts: null }]);
  });
});

describe("C42 the cleanup's undo of a weekly manifest", () => {
  it("C42 both files back with their bytes, the manifest set aside under artifacts/cleanup/, and the next GET lists them again", async () => {
    const p = done(notes("p.md"));
    const a = w.put(inbox("a.md"), "# A\n");
    const pBytes = fs.readFileSync(p);
    await w.index();
    const res = await w.archive({ week: WEEK, paths: [p, a] });
    expect(res.body.moved).toHaveLength(2);
    const after = await w.review();
    expect(after.archive.items).toEqual([]);
    expect(after.inbox.items).toEqual([]);
    const name = path.basename(path.dirname(res.body.manifest));
    const undone = await w.call("POST", "/api/memory/cleanup/undo", { manifest: res.body.manifest });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.skipped).toEqual([]);
    expect(fs.readFileSync(p).equals(pBytes)).toBe(true);
    expect(fs.readFileSync(a, "utf8")).toBe("# A\n");
    const aside = path.join(w.ctx.paths.artifacts, "cleanup", `${name}.manifest.json`);
    expect(name).toMatch(archiveName);
    expect(JSON.parse(fs.readFileSync(aside, "utf8")).scope).toBe(`weekly:${WEEK}`);
    await w.index();
    const again = await w.review();
    expect(again.archive.items.map((i: Json) => i.path)).toEqual([p]);
    expect(again.inbox.items.map((i: Json) => i.path)).toEqual([a]);
  });

  it("C42 a partial undo moves back the other file and skips the changed one; a second undo after it is put back moves it", async () => {
    const a = w.put(inbox("a.md"), "# A\n");
    const b = w.put(inbox("b.md"), "# B\n");
    await w.index();
    const res = await w.archive({ week: WEEK, paths: [a, b] });
    expect(res.body.moved).toHaveLength(2);
    const archivedA = res.body.moved.find((m: Json) => m.from === a).to as string;
    fs.writeFileSync(archivedA, "# A mudou\n");
    const first = await w.call("POST", "/api/memory/cleanup/undo", { manifest: res.body.manifest });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.restored.map((r: Json) => r.from)).toEqual([b]);
    expect(first.body.skipped).toEqual([{ path: a, reason: "changed" }]);
    expect(fs.readFileSync(b, "utf8")).toBe("# B\n");
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(res.body.manifest)).toBe(true);
    fs.writeFileSync(archivedA, "# A\n");
    const second = await w.call("POST", "/api/memory/cleanup/undo", { manifest: res.body.manifest });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.restored.map((r: Json) => r.from)).toEqual([a]);
    expect(fs.readFileSync(a, "utf8")).toBe("# A\n");
  });
});

// ---- C44 ---------------------------------------------------------------------------------------------------------

describe("C44 two archives of one file at once", () => {
  it("C44 the file is archived once, one answer moved it and the other skipped it as missing, archived grew by 1, and the same call again is 400 validation", async () => {
    const a = w.put(inbox("a.md"), "# A\n");
    await w.index();
    const [x, y] = await Promise.all([
      w.archive({ week: WEEK, paths: [a] }),
      w.archive({ week: WEEK, paths: [a] }),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    const answers = [x.body, y.body];
    const mover = answers.find((b) => b.moved.length === 1)!;
    const other = answers.find((b) => b.moved.length === 0)!;
    expect(mover).toBeDefined();
    expect(other).toBeDefined();
    expect(other.skipped).toEqual([{ path: a, reason: "missing" }]);
    const copies = Object.entries(snapshot(path.join(w.memory, "archive"))).filter(
      ([f]) => path.basename(f) === "a.md",
    );
    expect(copies).toHaveLength(1);
    expect(w.weeks().map((r) => r.archived)).toEqual([1]);
    expect(code(await w.archive({ week: WEEK, paths: [a] }))).toEqual([400, "validation"]);
  });
});

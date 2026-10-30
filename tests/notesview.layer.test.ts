import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { defaultSettings, type Settings } from "../core/src/config/schema.js";
import {
  FrontMatterUnreadableError,
  PropertyValidationError,
  parseProperties,
  setProperties,
  validatePropertyChange,
} from "../core/src/memory/frontMatter.js";
import {
  NoteTooLargeError,
  NoteValidationError,
  StructureFixedError,
  createNote,
  folderSegments,
} from "../core/src/memory/notes.js";
import {
  TreeFolderMissingError,
  TreeRootError,
  entryEditability,
  memoryTree,
} from "../core/src/memory/tree.js";
import { PathAccessError } from "../core/src/errors.js";
import { UiPreferencesSchema } from "../contracts/src/preferences.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-vista-notas, batch A, the decisions at their own layer (checks.md, Test policy rows 1 and 2),
 * with no HTTP: the tree (`memoryTree`, `entryEditability`), the properties (`parseProperties`, `setProperties`,
 * `validatePropertyChange`), and a new note's folder and the fixed structure (`folderSegments`, `createNote`). The HTTP
 * side of each claim is in `notesview.tree.test.ts`, `notesview.properties.test.ts` and `notesview.create.test.ts`.
 * Batch B adds the caps of the notes view's preferences (`UiPreferencesSchema`, door 4), which no route decides. Round 1
 * of the verification adds the tree's roots and cap (C5, C6, C10, C11) and doors 6, 7 and 8 (C82, C83, C84).
 */

const POSIX = process.platform !== "win32";
let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let work: string;
let memory: string;
let seq = 0;

beforeAll(() => {
  temp = makeTempHome("mordomo-notes-layer-");
  ctx = new AppContext(temp.paths.home);
  memory = temp.paths.memory;
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-notes-layer-work-")));
});
afterAll(() => {
  ctx.close();
  temp.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

function settingsWith(change: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  change(s);
  return s;
}
const env = (settings: Settings = settingsWith()) => ({ paths: temp.paths, settings });
/** A row of `files`, as the index holds it. */
function row(root: string, rel: string, extra: { title?: string; mtime?: number } = {}): number {
  const full = path.join(root, rel);
  const info = ctx.db
    .prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      root,
      full,
      rel,
      path.basename(full),
      path.extname(full),
      path.dirname(full),
      null,
      1,
      extra.mtime ?? 1,
      1,
      extra.title ?? null,
      "[]",
      "{}",
    );
  return Number(info.lastInsertRowid);
}
const folder = (name: string) => `${name}-${++seq}`;
const names = (entries: Array<{ name: string }>) => entries.map((e) => e.name);
function thrown(fn: () => unknown): Error & { code?: string; statusCode?: number } {
  try {
    fn();
  } catch (err) {
    return err as Error & { code?: string; statusCode?: number };
  }
  throw new Error("expected the call to throw");
}

describe("door 1 at its own layer: the tree", () => {
  it("C2 own layer: memoryTree answers one level, folders first, by name accent-folded and case-insensitive, or by mtime descending, with each folder's count at any depth", () => {
    const d = folder("c2");
    row(work, path.join(d, "Zebra.md"), { mtime: 30 });
    row(work, path.join(d, "abelha.md"), { mtime: 10 });
    row(work, path.join(d, "Ábaco.md"), { mtime: 20 });
    row(work, path.join(d, "Zulu", "um.md"), { mtime: 40 });
    row(work, path.join(d, "Zulu", "fundo", "dois.md"), { mtime: 50 });
    row(work, path.join(d, "árvore", "tres.md"), { mtime: 5 });
    const byName = memoryTree(ctx.db, env(), { root: work, dir: d });
    expect(names(byName.folders)).toEqual(["árvore", "Zulu"]);
    expect(byName.folders.map((f) => f.count)).toEqual([1, 2]);
    expect(names(byName.files)).toEqual(["Ábaco.md", "abelha.md", "Zebra.md"]);
    const updated = memoryTree(ctx.db, env(), { root: work, dir: d, sort: "updated" });
    expect(names(updated.folders)).toEqual(["Zulu", "árvore"]);
    expect(names(updated.files)).toEqual(["Zebra.md", "Ábaco.md", "abelha.md"]);
  });

  it("C4 own layer: a user exclude, a secret name and the home's config/ hide a row from the list and the count, and a folder of hidden rows only is absent", () => {
    const d = folder("c4");
    row(work, path.join(d, "ok.md"));
    row(work, path.join(d, "privado", "segredo.md"));
    row(work, path.join(d, ".env"));
    const settings = settingsWith((s) => {
      s.excludes = [...s.excludes, "privado"];
      s.indexedFolders.push({ path: temp.paths.home, area: null, enabled: true });
    });
    const top = memoryTree(ctx.db, env(settings), { root: work });
    expect(top.folders.find((f) => f.name === d)?.count).toBe(1);
    const inner = memoryTree(ctx.db, env(settings), { root: work, dir: d });
    expect(names(inner.files)).toEqual(["ok.md"]);
    expect(inner.folders).toEqual([]);
    row(temp.paths.home, path.join("config", "c4.md"));
    row(temp.paths.home, path.join("c4-visivel", "a.md"));
    const home = memoryTree(ctx.db, env(settings), { root: temp.paths.home });
    expect(names(home.folders)).toContain("c4-visivel");
    expect(names(home.folders)).not.toContain("config");
  });

  it("C7 own layer: entryEditability gives outside_memory, generated (ROUTER.md, areas/, journal/, contexts/ and below), not_markdown, and editable for a .md under notes/ and maps/", () => {
    const cases: Array<[string, boolean, ReturnType<typeof entryEditability>]> = [
      [path.join(work, "a.md"), false, { editable: false, reason: "outside_memory" }],
      [path.join(work, "sub"), true, { editable: false, reason: "outside_memory" }],
      [path.join(memory, "ROUTER.md"), false, { editable: false, reason: "generated" }],
      [path.join(memory, "areas"), true, { editable: false, reason: "generated" }],
      [path.join(memory, "journal"), true, { editable: false, reason: "generated" }],
      [path.join(memory, "contexts"), true, { editable: false, reason: "generated" }],
      [path.join(memory, "areas", "x.md"), false, { editable: false, reason: "generated" }],
      [path.join(memory, "journal", "2026-10-30.md"), false, { editable: false, reason: "generated" }],
      [path.join(memory, "contexts", "c.md"), false, { editable: false, reason: "generated" }],
      [path.join(memory, "notes", "x.txt"), false, { editable: false, reason: "not_markdown" }],
      [path.join(memory, "notes", "n.md"), false, { editable: true }],
      [path.join(memory, "maps", "m.md"), false, { editable: true }],
      [path.join(memory, "notes"), true, { editable: true }],
    ];
    for (const [entry, isFolder, expected] of cases) {
      expect(entryEditability(memory, entry, isFolder), entry).toEqual(expected);
    }
    // and memoryTree hands them on per entry
    row(memory, path.join("journal", "c7.md"));
    const top = memoryTree(ctx.db, env());
    expect(top.folders.find((f) => f.name === "journal")).toEqual({
      rel: "journal",
      name: "journal",
      count: expect.any(Number),
      editable: false,
      reason: "generated",
    });
  });

  it("C8 own layer: the index note is the folder's _index.md where cerebro-organizar puts it, before README.md, else index.md, README.md, CLAUDE.md, AGENTS.md in that order, else null", () => {
    const slug = `${path
      .basename(work)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "")}-${crypto.createHash("sha256").update(work).digest("hex").slice(0, 8)}`;
    const p = folder("c8p");
    row(work, path.join(p, "README.md"));
    const mapped = row(memory, path.join("maps", slug, p, "_index.md"));
    expect(memoryTree(ctx.db, env(), { root: work, dir: p }).indexNote).toBe(mapped);
    const m = folder("c8m");
    const own = row(memory, path.join("notes", m, "_index.md"));
    row(memory, path.join("notes", m, "README.md"));
    expect(memoryTree(ctx.db, env(), { dir: `notes/${m}` }).indexNote).toBe(own);
    const order: Array<[string[], string | null]> = [
      [["AGENTS.md", "CLAUDE.md", "README.md", "index.md"], "index.md"],
      [["AGENTS.md", "CLAUDE.md", "README.md"], "README.md"],
      [["AGENTS.md", "CLAUDE.md"], "CLAUDE.md"],
      [["AGENTS.md"], "AGENTS.md"],
      [["a.md"], null],
    ];
    for (const [files, expected] of order) {
      const d = folder("c8o");
      const ids = new Map(files.map((f) => [f, row(work, path.join(d, f))]));
      expect(memoryTree(ctx.db, env(), { root: work, dir: d }).indexNote, files.join(",")).toBe(
        expected === null ? null : ids.get(expected),
      );
    }
  });
});

const PRINT = [
  "---",
  "type: context",
  "status: active",
  "tags: [offer, accelerator]",
  "updated: 2026-10-14",
  "---",
];

describe("doors 2 and 3 at their own layer: the properties", () => {
  it("C14 own layer: the kind of each key, one case per row, quoted values read without quotes and odd values kept as written", () => {
    const text = [
      "---",
      "tags: [a, b]",
      "aliases:",
      "  - um",
      "  - dois",
      "created: 2026-10-29T19:03:23.000Z",
      "updated: 2026-10-14",
      "last_reviewed: 2026-10-15",
      "due: 2026-11-01",
      "status: blocked",
      "natureza: certeza",
      "escopo: equipe",
      "review_every: 30d",
      'title: "Plano \\"A\\""',
      "type: context",
      "children-digest: sha256:abc",
      "generated-by: organize-brain",
      "owner: Ana",
      "---",
      "corpo",
    ].join("\n");
    const kinds = Object.fromEntries(parseProperties(text).properties.map((p) => [p.key, [p.kind, p.value]]));
    expect(kinds).toEqual({
      tags: ["list", ["a", "b"]],
      aliases: ["list", ["um", "dois"]],
      created: ["date", "2026-10-29T19:03:23.000Z"],
      updated: ["date", "2026-10-14"],
      last_reviewed: ["date", "2026-10-15"],
      due: ["date", "2026-11-01"],
      status: ["status", "blocked"],
      natureza: ["select", "certeza"],
      escopo: ["select", "equipe"],
      review_every: ["interval", "30d"],
      title: ["text", 'Plano "A"'],
      type: ["text", "context"],
      "children-digest": ["text", "sha256:abc"],
      "generated-by": ["text", "organize-brain"],
      owner: ["text", "Ana"],
    });
  });

  it("C16 own layer: setProperties changes only the status line, and the same change again leaves the text as it is", () => {
    const text = `${PRINT.join("\n")}\n# Corpo\n`;
    const next = setProperties(text, { set: { status: "archived" } });
    expect(next).toBe(text.replace("status: active", "status: archived"));
    expect(setProperties(next, { set: { status: "archived" } })).toBe(next);
    expect(parseProperties(next).properties.find((p) => p.key === "status")?.value).toBe("archived");
  });

  it("C17 own layer: new keys go right before the closing --- in the order given; a text with no header gets one at the top", () => {
    const text = `${PRINT.join("\n")}\ncorpo\n`;
    expect(setProperties(text, { set: { last_reviewed: "2026-10-30", due: "2026-11-01" } })).toBe(
      [...PRINT.slice(0, -1), "last_reviewed: 2026-10-30", "due: 2026-11-01", "---", "corpo", ""].join("\n"),
    );
    const bare = "# Sem\n\ntexto\n";
    expect(setProperties(bare, { set: { last_reviewed: "2026-10-30", due: "2026-11-01" } })).toBe(
      `---\nlast_reviewed: 2026-10-30\ndue: 2026-11-01\n---\n${bare}`,
    );
  });

  it("C18 own layer: remove deletes a key's line, and a block list with its item lines; the rest is kept", () => {
    const lines = [
      "---",
      "type: context",
      "tags:",
      "  - um",
      "  - dois",
      "  - tres",
      "status: active",
      "---",
      "corpo",
      "",
    ];
    const text = lines.join("\n");
    expect(setProperties(text, { remove: ["type"] })).toBe(
      lines.filter((l) => l !== "type: context").join("\n"),
    );
    expect(setProperties(text, { remove: ["tags"] })).toBe(
      ["---", "type: context", "status: active", "---", "corpo", ""].join("\n"),
    );
  });

  it("C19 own layer: each refused key or value is PropertyValidationError (400 validation), and setProperties throws before any text is made", () => {
    const text = `${PRINT.join("\n")}\ncorpo\n`;
    const cases: Array<[string, Parameters<typeof validatePropertyChange>[0]]> = [
      ["updated 14/10/2026", { set: { updated: "14/10/2026" } }],
      ["status blocked", { set: { status: "blocked" } }],
      ["text with a line break", { set: { title: "a\nb" } }],
      ["text of 501", { set: { title: "a".repeat(501) } }],
      ["list of 21", { set: { aliases: Array.from({ length: 21 }, (_, i) => `apelido ${i}`) } }],
      ["tag a", { set: { tags: ["a"] } }],
      ["tag com espaço", { set: { tags: ["com espaço"] } }],
      ["key Status", { set: { Status: "active" } }],
      ["key 1x", { remove: ["1x"] }],
      ["key of 41", { set: { [`a${"b".repeat(40)}`]: "v" } }],
      ["natureza certeza", { set: { natureza: "certeza" } }],
      ["escopo publico", { set: { escopo: "publico" } }],
      ["review_every 0d", { set: { review_every: "0d" } }],
      ["review_every 1000d", { set: { review_every: "1000d" } }],
      ["review_every 30", { set: { review_every: "30" } }],
    ];
    for (const [what, change] of cases) {
      const err = thrown(() => setProperties(text, change));
      expect(err, what).toBeInstanceOf(PropertyValidationError);
      expect([err.statusCode, err.code], what).toEqual([400, "validation"]);
    }
    // the edges that are accepted
    expect(() =>
      validatePropertyChange({
        set: {
          title: "a".repeat(500),
          tags: Array.from({ length: 20 }, (_, i) => `t${i}`),
          review_every: "999d",
          natureza: "plano",
          escopo: "pessoal",
          [`a${"b".repeat(39)}`]: "v",
        },
      }),
    ).not.toThrow();
    expect(() => validatePropertyChange({ set: { review_every: "never", due: "2026-02-28" } })).not.toThrow();
  });

  it("C20 own layer: a header past 4 096 bytes and one with no closing --- are FrontMatterUnreadableError (409 front_matter_unreadable)", () => {
    const long = [
      "---",
      ...Array.from({ length: 100 }, (_, i) => `campo${i}: ${"x".repeat(45)}`),
      "---",
      "corpo",
    ].join("\n");
    for (const text of [long, "---\ntype: context\n\ncorpo\n"]) {
      const err = thrown(() => setProperties(text, { set: { status: "archived" } }));
      expect(err).toBeInstanceOf(FrontMatterUnreadableError);
      expect([err.statusCode, err.code]).toEqual([409, "front_matter_unreadable"]);
    }
    // just under the limit is read
    const fits = ["---", `campo: ${"x".repeat(4096 - 20)}`, "---", ""].join("\n");
    expect(Buffer.byteLength(fits)).toBeLessThanOrEqual(4096);
    expect(() => setProperties(fits, { set: { status: "done" } })).not.toThrow();
  });
});

describe("doors 2 and 5 at their own layer: a new note's folder and the fixed structure", () => {
  it.skipIf(!POSIX)(
    "C25 own layer: folderSegments refuses 5 levels, an empty level, .., a level that keeps no letter and an absolute path (400 validation); createNote refuses a link on the way (403) and a content past the limit (413)",
    () => {
      expect(folderSegments("clientes/acme")).toEqual(["clientes", "acme"]);
      expect(folderSegments("Clientes Grandes/ÁCME")).toEqual(["clientes-grandes", "acme"]);
      expect(folderSegments("a/b/c/d")).toEqual(["a", "b", "c", "d"]);
      for (const bad of ["a/b/c/d/e", "a//b", "../x", "..", "!!!", "/etc"]) {
        const err = thrown(() => folderSegments(bad));
        expect(err, bad).toBeInstanceOf(NoteValidationError);
        expect([err.statusCode, err.code], bad).toEqual([400, "validation"]);
      }
      const notes = path.join(memory, "notes");
      fs.mkdirSync(notes, { recursive: true });
      const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-notes-layer-alvo-")));
      try {
        fs.symlinkSync(target, path.join(notes, "c25-link"));
        const link = thrown(() => createNote(env(), { title: "Pelo link", folder: "c25-link/nova" }));
        expect(link).toBeInstanceOf(PathAccessError);
        expect(fs.readdirSync(target)).toEqual([]);
      } finally {
        fs.rmSync(target, { recursive: true, force: true });
      }
      const big = thrown(() =>
        createNote(env(), { title: "Grande", folder: "c25-grande", content: "x".repeat(1024 * 1024 + 1) }),
      );
      expect(big).toBeInstanceOf(NoteTooLargeError);
      expect([big.statusCode, big.code]).toEqual([413, "note_too_large"]);
      expect(fs.existsSync(path.join(notes, "c25-grande"))).toBe(false);
    },
  );

  it("C26 own layer: with fixedStructure on, a new folder, an area without its folder and no folder are StructureFixedError (409 structure_fixed); a folder that exists is written", () => {
    const settings = settingsWith((s) => {
      s.memory.notes.fixedStructure = true;
      s.areas = ["Área C26"];
    });
    const notes = path.join(memory, "notes");
    fs.mkdirSync(path.join(notes, "c26-existe"), { recursive: true });
    for (const [what, input] of [
      ["new folder", { title: "Nova", folder: "c26-nova" }],
      ["area without folder", { title: "Área", area: "Área C26" }],
      ["straight into notes/", { title: "Solta" }],
    ] as const) {
      const err = thrown(() => createNote(env(settings), input));
      expect(err, what).toBeInstanceOf(StructureFixedError);
      expect([err.statusCode, err.code], what).toEqual([409, "structure_fixed"]);
    }
    expect(fs.existsSync(path.join(notes, "c26-nova"))).toBe(false);
    expect(fs.existsSync(path.join(notes, "area-c26"))).toBe(false);
    expect(fs.existsSync(path.join(notes, "solta.md"))).toBe(false);
    const ok = createNote(env(settings), { title: "Dentro", folder: "c26-existe" });
    expect(ok.path).toBe(path.join(notes, "c26-existe", "dentro.md"));
    // off, the same three are written
    const off = settingsWith((s) => {
      s.areas = ["Área C26"];
    });
    expect(createNote(env(off), { title: "Nova", folder: "c26-nova" }).path).toBe(
      path.join(notes, "c26-nova", "nova.md"),
    );
    expect(createNote(env(off), { title: "Solta" }).path).toBe(path.join(notes, "solta.md"));
  });
});

describe("door 4 at its own layer: the notes view's preferences", () => {
  const brainWith = (notes: unknown, rest: Record<string, unknown> = {}) =>
    UiPreferencesSchema.parse({ brain: { ...rest, notes } }).brain;

  it("C47 own layer: brain.notes keeps the first 12 of 13 tabs and the first 500 of 501 expanded folders; an unreadable sort or home reads its default and every other field is kept", () => {
    const tabs = Array.from({ length: 13 }, (_, i) => `/h/memory/notes/n${i}.md`);
    const expanded = Array.from({ length: 501 }, (_, i) => `/h/memory/notes/p${i}`);
    const read = brainWith({
      root: "/h/memory",
      home: { "/h/memory": "/h/memory/notes/n0.md" },
      tabs,
      active: tabs[2],
      sort: "updated",
      expanded,
    });
    expect(read.notes!.tabs).toEqual(tabs.slice(0, 12));
    expect(read.notes!.expanded).toEqual(expanded.slice(0, 500));
    expect(read.notes!.root).toBe("/h/memory");
    expect(read.notes!.active).toBe(tabs[2]);
    expect(read.notes!.sort).toBe("updated");
    expect(read.notes!.home).toEqual({ "/h/memory": "/h/memory/notes/n0.md" });

    // An unreadable field reads its default; the other notes fields and every other brain field are kept.
    const odd = brainWith(
      {
        root: "/h/memory",
        home: 3,
        tabs: tabs.slice(0, 2),
        active: tabs[1],
        sort: "size",
        expanded: ["/h/a"],
      },
      {
        layout: "force",
        localHops: 2,
        showNames: true,
        workspace: { pinned: [{ id: 1, x: 2, y: 3 }], collapsed: ["x"] },
      },
    );
    expect(odd.notes!.sort).toBe("name");
    expect(odd.notes!.home).toEqual({});
    expect(odd.notes!.root).toBe("/h/memory");
    expect(odd.notes!.tabs).toEqual(tabs.slice(0, 2));
    expect(odd.notes!.active).toBe(tabs[1]);
    expect(odd.notes!.expanded).toEqual(["/h/a"]);
    expect(odd.layout).toBe("force");
    expect(odd.localHops).toBe(2);
    expect(odd.showNames).toBe(true);
    expect(odd.workspace).toEqual({ pinned: [{ id: 1, x: 2, y: 3 }], collapsed: ["x"] });

    // A brain document without notes reads none (nothing is added to it), and one whose notes is not an object
    // keeps every other brain field.
    expect(brainWith(undefined, { layout: "force" })).toEqual({ layout: "force" });
    expect(brainWith(3, { layout: "force" }).layout).toBe("force");
  });
});

describe("door 1 at its own layer: the roots and the cap (round 1)", () => {
  const ctxOf = (id: string, paths: string[]) => ({ id, name: id.toUpperCase(), paths });

  it("C5 own layer: a root that is neither memory/ nor an enabled indexed folder (/tmp/fora, a disabled one) is TreeRootError (400 unknown_root); a dir with no indexed row and ../<another root's folder> are TreeFolderMissingError (404 not_found)", () => {
    const off = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-notes-layer-off-")));
    try {
      const settings = settingsWith((s) => {
        s.indexedFolders.push({ path: off, area: null, enabled: false });
      });
      row(off, "desligada.md");
      for (const root of ["/tmp/fora", off]) {
        const err = thrown(() => memoryTree(ctx.db, env(settings), { root }));
        expect(err, root).toBeInstanceOf(TreeRootError);
        expect([err.statusCode, err.code], root).toEqual([400, "unknown_root"]);
      }
      const d = folder("c5");
      row(work, path.join(d, "a.md"));
      row(memory, path.join("notes", "c5-memoria", "b.md"));
      for (const dir of ["nao-existe", path.relative(work, path.join(memory, "notes", "c5-memoria"))]) {
        const err = thrown(() => memoryTree(ctx.db, env(settings), { root: work, dir }));
        expect(err, dir).toBeInstanceOf(TreeFolderMissingError);
        expect([err.statusCode, err.code], dir).toEqual([404, "not_found"]);
      }
      expect(names(memoryTree(ctx.db, env(settings), { root: work, dir: d }).files)).toEqual(["a.md"]);
    } finally {
      fs.rmSync(off, { recursive: true, force: true });
    }
  });

  it("C6 own layer: a folder of 1 003 entries (1 001 files and 2 subfolders) gives the first 1 000 in order, truncated and omitted 3; one of 1 000 gives truncated false and omitted 0", () => {
    const big = folder("c6");
    row(work, path.join(big, "sub-a", "x.md"));
    row(work, path.join(big, "sub-b", "y.md"));
    for (let i = 0; i < 1001; i++) row(work, path.join(big, `f${String(i).padStart(4, "0")}.md`));
    const cut = memoryTree(ctx.db, env(), { root: work, dir: big });
    expect(names(cut.folders)).toEqual(["sub-a", "sub-b"]);
    expect(cut.files).toHaveLength(998);
    expect(cut.files[0]!.name).toBe("f0000.md");
    expect(cut.files.at(-1)!.name).toBe("f0997.md");
    expect([cut.truncated, cut.omitted]).toEqual([true, 3]);
    const full = folder("c6-mil");
    for (let i = 0; i < 1000; i++) row(work, path.join(full, `g${String(i).padStart(4, "0")}.md`));
    const all = memoryTree(ctx.db, env(), { root: work, dir: full });
    expect(all.files).toHaveLength(1000);
    expect([all.truncated, all.omitted]).toEqual([false, 0]);
  });

  it("C10 own layer: with a context the roots are its ok paths in its order (a missing one left out), then its notes folder when it exists; the root defaults to the first; the entries are the context's", () => {
    const base = folder("c10");
    const app = path.join(work, base, "projetos", "app");
    const gone = path.join(work, base, "apagada");
    const clientes = path.join(memory, "notes", `${base}-x`, "clientes");
    const id = `c10l-${seq}`;
    const notes = path.join(memory, "notes", id);
    for (const dir of [app, clientes, notes]) fs.mkdirSync(dir, { recursive: true });
    row(work, path.join(base, "projetos", "app", "a.md"));
    row(work, path.join(base, "projetos", "app-antigo", "velho.md"));
    row(memory, path.relative(memory, path.join(clientes, "cliente.md")));
    row(memory, path.relative(memory, path.join(notes, "nota.md")));
    const context = ctxOf(id, [app, gone, clientes]);
    const top = memoryTree(ctx.db, env(), { context });
    expect(top.roots.map((r) => [r.path, r.editable])).toEqual([
      [app, false],
      [clientes, true],
      [notes, true],
    ]);
    expect(top.root).toBe(app);
    expect(names(top.files)).toEqual(["a.md"]);
    expect(JSON.stringify(top)).not.toContain("app-antigo");
    expect(names(memoryTree(ctx.db, env(), { context, root: clientes }).files)).toEqual(["cliente.md"]);
    expect(names(memoryTree(ctx.db, env(), { context, root: notes }).files)).toEqual(["nota.md"]);
  });

  it("C11 own layer: with a context, memory/ and an indexed folder outside it are TreeRootError (400 unknown_root)", () => {
    const base = folder("c11");
    const inside = path.join(work, base, "dentro");
    fs.mkdirSync(inside, { recursive: true });
    row(work, path.join(base, "dentro", "a.md"));
    const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-notes-layer-c11-")));
    try {
      const settings = settingsWith((s) => {
        s.indexedFolders.push({ path: elsewhere, area: null, enabled: true });
      });
      const context = ctxOf(`c11l-${seq}`, [inside]);
      expect(memoryTree(ctx.db, env(settings), { context }).root).toBe(inside);
      for (const root of [memory, elsewhere]) {
        const err = thrown(() => memoryTree(ctx.db, env(settings), { context, root }));
        expect(err, root).toBeInstanceOf(TreeRootError);
        expect([err.statusCode, err.code], root).toEqual([400, "unknown_root"]);
      }
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("C82 own layer: a context with no ok path and no notes folder answers roots [], root null and no entry; with a root asked it is TreeRootError (400 unknown_root)", () => {
    const context = ctxOf(`c82l-${++seq}`, [path.join(work, "nao-existe-c82")]);
    expect(memoryTree(ctx.db, env(), { context })).toEqual({
      roots: [],
      root: null,
      dir: "",
      folders: [],
      files: [],
      indexNote: null,
      truncated: false,
      omitted: 0,
    });
    for (const root of [memory, work]) {
      const err = thrown(() => memoryTree(ctx.db, env(), { context, root }));
      expect(err, root).toBeInstanceOf(TreeRootError);
      expect([err.statusCode, err.code], root).toEqual([400, "unknown_root"]);
    }
  });
});

describe("door 7 at its own layer: area and folder together", () => {
  it("C83 own layer: createNote with an area and a folder is NoteValidationError (400 validation) and makes nothing; each alone is written", () => {
    const settings = settingsWith((s) => {
      s.areas = ["Área C83"];
    });
    const notes = path.join(memory, "notes");
    const err = thrown(() =>
      createNote(env(settings), { title: "Ambas", area: "Área C83", folder: "c83l-pasta" }),
    );
    expect(err).toBeInstanceOf(NoteValidationError);
    expect([err.statusCode, err.code]).toEqual([400, "validation"]);
    expect(fs.existsSync(path.join(notes, "c83l-pasta"))).toBe(false);
    expect(fs.existsSync(path.join(notes, "area-c83", "ambas.md"))).toBe(false);
    expect(createNote(env(settings), { title: "Só pasta", folder: "c83l-pasta" }).path).toBe(
      path.join(notes, "c83l-pasta", "so-pasta.md"),
    );
    const inArea = createNote(env(settings), { title: "Só área", area: "Área C83" }).path;
    expect(path.dirname(inArea)).toBe(path.join(notes, "area-c83"));
  });
});

describe("door 8 at its own layer: the details of the property writer", () => {
  it("C84 own layer: a text is written plain only when it reads the same unquoted, else as a JSON string, one case per rule", () => {
    const text = "---\nowner: x\n---\ncorpo\n";
    const cases: Array<[what: string, value: string, line: string]> = [
      ["letters", "Ana", "owner: Ana"],
      ["the allowed marks", "Plano (A), v.2/3 d'o-x_y", "owner: Plano (A), v.2/3 d'o-x_y"],
      ["empty", "", 'owner: ""'],
      ["starts with a digit", "1º lugar", 'owner: "1º lugar"'],
      ["starts with a mark", "#tag", 'owner: "#tag"'],
      ["ends with a space", "Ana ", 'owner: "Ana "'],
      ["true", "true", 'owner: "true"'],
      ["null", "null", 'owner: "null"'],
      ["yes", "yes", 'owner: "yes"'],
      ["a colon", "a: b", 'owner: "a: b"'],
      ["a double quote", 'diz "oi"', 'owner: "diz \\"oi\\""'],
    ];
    for (const [what, value, line] of cases) {
      const next = setProperties(text, { set: { owner: value } });
      expect(next, what).toBe(`---\n${line}\n---\ncorpo\n`);
      expect(parseProperties(next).properties[0]!.value, what).toBe(value);
    }
  });

  it("C84 own layer: an unquoted value loses its trailing # comment, a quoted one keeps a # inside; a value set to what it holds keeps its line byte for byte", () => {
    const text =
      '---\nstatus: active # revisto\nowner: Ana   # dona\nnota: "Ana # não é comentário"\n---\ncorpo\n';
    expect(parseProperties(text).properties.map((p) => [p.key, p.value])).toEqual([
      ["status", "active"],
      ["owner", "Ana"],
      ["nota", "Ana # não é comentário"],
    ]);
    expect(setProperties(text, { set: { status: "active", owner: "Ana" } })).toBe(text);
  });

  it("C84 own layer: a repeated key's first line is the property and the later lines are other properties, kept as they are when the property is written", () => {
    const text = "---\ntype: um\ntype: dois\n---\ncorpo\n";
    const read = parseProperties(text);
    expect(read.properties).toEqual([{ key: "type", kind: "text", value: "um" }]);
    expect(read.otherProperties).toBe("type: dois");
    expect(setProperties(text, { set: { type: "tres" } })).toBe("---\ntype: tres\ntype: dois\n---\ncorpo\n");
  });

  it("C84 own layer: the same key in set and remove is PropertyValidationError (400 validation)", () => {
    const err = thrown(() =>
      setProperties(`${PRINT.join("\n")}\n`, { set: { status: "done" }, remove: ["status"] }),
    );
    expect(err).toBeInstanceOf(PropertyValidationError);
    expect([err.statusCode, err.code]).toEqual([400, "validation"]);
  });

  it("C84 own layer: a block list stays a block with its first item's indentation, and an inline list stays inline", () => {
    for (const indent of ["  ", "    "]) {
      const text = `---\ntags:\n${indent}- um\n${indent}- dois\n---\n`;
      expect(setProperties(text, { set: { tags: ["um", "tres", "quatro"] } }), JSON.stringify(indent)).toBe(
        `---\ntags:\n${indent}- um\n${indent}- tres\n${indent}- quatro\n---\n`,
      );
    }
    expect(setProperties("---\ntags: [um, dois]\n---\n", { set: { tags: ["um", "tres"] } })).toBe(
      "---\ntags: [um, tres]\n---\n",
    );
  });

  it("C84 own layer: an unreadable header (past 4 096 bytes, or with no closing ---) reads as none: [], null, 0", () => {
    const long = [
      "---",
      ...Array.from({ length: 100 }, (_, i) => `campo${i}: ${"x".repeat(45)}`),
      "---",
      "corpo",
    ].join("\n");
    for (const text of [long, "---\ntype: context\n\ncorpo\n"])
      expect(parseProperties(text)).toEqual({ properties: [], otherProperties: null, bodyStart: 0 });
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-vista-notas, batch A, S1 at the HTTP boundary: `GET /api/memory/tree` (the roots, one level
 * of a folder, its order, its cap, what is editable, the index note, the context, the indexing flag). Each test is
 * written from its check in `checks.md`; the decisions are also proven at their own layer in `notesview.layer.test.ts`.
 */

const POSIX = process.platform !== "win32";
let w: NotesViewWorld;
let memory: string;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-notes-tree-");
  memory = w.memory;
});
afterAll(async () => {
  await w?.close();
});

async function tree(query: Record<string, string> = {}, headers?: Record<string, string>): Promise<Json> {
  const qs = new URLSearchParams(query).toString();
  const res = await w.call("GET", `/api/memory/tree${qs ? `?${qs}` : ""}`, undefined, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function refused(query: Record<string, string>): Promise<{ status: number; body: Json }> {
  return w.call("GET", `/api/memory/tree?${new URLSearchParams(query).toString()}`);
}
const names = (entries: Json[]) => entries.map((e) => e.name as string);
const idOf = (file: string): number =>
  (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number } | undefined)?.id ?? -1;
/** Door 8 of cerebro-organizar, computed here from the door's text. */
function slugOf(root: string): string {
  const name = path
    .basename(root)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${name || "pasta"}-${crypto.createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
}

describe.skipIf(!POSIX)("S1 the tree route", () => {
  it("C1 with no root or context the roots are memory/ (editable) then each enabled indexed folder in settings order (not editable), and the answer is the top level of memory/", async () => {
    const a = w.indexedRoot("c1a");
    const off = w.outside("c1off");
    const b = w.indexedRoot("c1b");
    w.update((s) => {
      const [first, second] = s.indexedFolders.filter((f) => f.path === a || f.path === b);
      s.indexedFolders = [first!, { path: off, area: null, enabled: false }, second!];
    });
    w.put(path.join(a, "a.md"), "# A\n");
    w.put(path.join(off, "off.md"), "# Off\n");
    w.put(path.join(memory, "c1-topo.md"), "# Topo da memória\n");
    w.put(path.join(memory, "notes", "c1", "dentro.md"), "# Dentro\n");
    await w.index();

    const body = await tree();
    expect(body.roots).toEqual([
      { path: memory, name: "memory", editable: true, indexing: false },
      { path: a, name: path.basename(a), editable: false, indexing: false },
      { path: b, name: path.basename(b), editable: false, indexing: false },
    ]);
    expect(body.roots.map((r: Json) => r.path)).not.toContain(off);
    expect(body.root).toBe(memory);
    expect(body.dir).toBe("");
    // the entries are memory/'s top level: c1-topo.md and the folder notes, nothing from below it
    const topo = body.files.find((f: Json) => f.name === "c1-topo.md");
    expect(topo).toMatchObject({ rel: "c1-topo.md", title: "Topo da memória", editable: true });
    expect(names(body.folders)).toContain("notes");
    expect(names(body.files)).not.toContain("dentro.md");
    for (const entry of [...body.folders, ...body.files]) {
      expect(fs.existsSync(path.join(memory, entry.name)), entry.name).toBe(true);
      expect(entry.rel).toBe(entry.name);
    }
  });

  it("C2 one level of a folder: only its direct subfolders (with the count of files at any depth) and files, folders first, ordered by name accent-folded and case-insensitive, or by mtime descending with sort=updated", async () => {
    const r = w.indexedRoot("c2");
    const d = path.join(r, "pasta");
    const day = (n: number) => new Date(Date.UTC(2026, 9, n));
    const file = (rel: string, n: number) => {
      const full = w.put(path.join(d, rel), `# ${path.basename(rel, ".md")}\n`);
      fs.utimesSync(full, day(n), day(n));
    };
    file("Zebra.md", 3);
    file("abelha.md", 1);
    file("Ábaco.md", 2);
    file(path.join("Zulu", "um.md"), 4);
    file(path.join("Zulu", "fundo", "dois.md"), 5);
    file(path.join("árvore", "tres.md"), 1);
    file(path.join("Beta", "quatro.md"), 2);
    await w.index();

    const byName = await tree({ root: r, dir: "pasta" });
    expect(byName.dir).toBe("pasta");
    expect(names(byName.folders)).toEqual(["árvore", "Beta", "Zulu"]);
    expect(byName.folders.map((f: Json) => [f.rel, f.count])).toEqual([
      ["pasta/árvore", 1],
      ["pasta/Beta", 1],
      ["pasta/Zulu", 2],
    ]);
    expect(names(byName.files)).toEqual(["Ábaco.md", "abelha.md", "Zebra.md"]);
    expect(byName.files.map((f: Json) => f.rel)).toEqual([
      "pasta/Ábaco.md",
      "pasta/abelha.md",
      "pasta/Zebra.md",
    ]);
    expect(names(byName.files)).not.toContain("um.md");
    expect(names(byName.files)).not.toContain("dois.md");
    expect(await tree({ root: r, dir: "pasta", sort: "name" })).toEqual(byName);

    const updated = await tree({ root: r, dir: "pasta", sort: "updated" });
    // folders still first; each group by mtime descending (a folder by its newest file)
    expect(names(updated.folders)).toEqual(["Zulu", "Beta", "árvore"]);
    expect(names(updated.files)).toEqual(["Zebra.md", "Ábaco.md", "abelha.md"]);
    const mtimes = updated.files.map((f: Json) => f.mtime as number);
    expect([...mtimes].sort((x, y) => y - x)).toEqual(mtimes);
  });

  it("C3 after the files of a folder are deleted from disk the tree still answers each with the title and mtime the index holds: the rows are the source and no file is opened", async () => {
    const r = w.indexedRoot("c3");
    const one = w.put(path.join(r, "c3", "alfa.md"), "# Alfa do índice\n");
    const two = w.put(path.join(r, "c3", "beta.md"), "---\ntitle: Beta do cabeçalho\n---\ncorpo\n");
    await w.index();
    const before = await tree({ root: r, dir: "c3" });
    expect(before.files.map((f: Json) => [f.name, f.title])).toEqual([
      ["alfa.md", "Alfa do índice"],
      ["beta.md", "Beta do cabeçalho"],
    ]);
    fs.rmSync(one);
    fs.rmSync(two);
    const opened: string[] = [];
    const watch = (fn: "openSync" | "readFileSync") => {
      const original = fs[fn].bind(fs) as (...args: unknown[]) => unknown;
      return vi.spyOn(fs, fn).mockImplementation(((...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].startsWith(r)) opened.push(`${fn} ${args[0]}`);
        return original(...args);
      }) as never);
    };
    const spies = [watch("openSync"), watch("readFileSync")];
    try {
      const after = await tree({ root: r, dir: "c3" });
      expect(after.files.map((f: Json) => [f.name, f.title, f.mtime])).toEqual(
        before.files.map((f: Json) => [f.name, f.title, f.mtime]),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(opened).toEqual([]);
  });

  it("C4 a row excluded by today's policy (a user exclude added after the pass, a secret name, the home's config/) is not listed nor counted, and a folder of excluded rows only is absent", async () => {
    const r = w.indexedRoot("c4");
    w.put(path.join(r, "c4", "ok.md"), "# Ok\n");
    w.put(path.join(r, "c4", "privado", "segredo.md"), "# Segredo\n");
    await w.index();
    expect((await tree({ root: r, dir: "c4" })).folders.map((f: Json) => f.name)).toEqual(["privado"]);
    w.update((s) => {
      s.excludes = [...s.excludes, "privado"];
    });
    w.row(r, path.join("c4", ".env"));
    const top = await tree({ root: r });
    expect(top.folders.find((f: Json) => f.name === "c4")).toMatchObject({ count: 1 });
    const inner = await tree({ root: r, dir: "c4" });
    expect(names(inner.files)).toEqual(["ok.md"]);
    expect(inner.folders).toEqual([]);

    // the home's config/: a root that holds the home shows its other folders, never config/
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: w.home, area: null, enabled: true }];
    });
    w.row(w.home, path.join("config", "c4-nota.md"));
    w.row(w.home, path.join("c4-visivel", "a.md"));
    const home = await tree({ root: w.home });
    expect(names(home.folders)).toContain("c4-visivel");
    expect(names(home.folders)).not.toContain("config");
    expect((await refused({ root: w.home, dir: "config" })).status).toBe(404);
    w.update((s) => {
      s.indexedFolders = s.indexedFolders.filter((f) => f.path !== w.home);
      s.excludes = s.excludes.filter((e) => e !== "privado");
    });
  });

  it("C5 a root that is neither memory/ nor an enabled indexed folder is 400 unknown_root; a dir with no indexed row, and one that climbs into another root, is 404 not_found", async () => {
    const r = w.indexedRoot("c5");
    const other = w.indexedRoot("c5-outra");
    const off = w.outside("c5-desligada");
    w.put(path.join(r, "c5", "a.md"), "# A\n");
    w.put(path.join(other, "segredo", "b.md"), "# B\n");
    w.put(path.join(off, "c.md"), "# C\n");
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: off, area: null, enabled: false }];
    });
    await w.index();
    for (const root of ["/tmp/fora", off]) {
      const res = await refused({ root });
      expect(res.status, root).toBe(400);
      expect(res.body.error.code, root).toBe("unknown_root");
    }
    const climbs = `../${path.basename(other)}/segredo`;
    for (const dir of ["nao-existe", climbs]) {
      const res = await refused({ root: r, dir });
      expect(res.status, dir).toBe(404);
      expect(res.body.error.code, dir).toBe("not_found");
      expect(JSON.stringify(res.body)).not.toContain("b.md");
    }
  });

  it("C6 a folder of 1 003 entries answers the first 1 000 in order with truncated true and omitted 3; one of 1 000 answers truncated false and omitted 0", async () => {
    const r = w.indexedRoot("c6");
    const pad = (n: number) => String(n).padStart(4, "0");
    for (let i = 0; i < 1001; i++) w.row(r, path.join("grande", `f${pad(i)}.md`));
    w.row(r, path.join("grande", "s1", "x.md"));
    w.row(r, path.join("grande", "s2", "x.md"));
    const big = await tree({ root: r, dir: "grande" });
    expect(names(big.folders)).toEqual(["s1", "s2"]);
    expect(big.files).toHaveLength(998);
    expect(names(big.files)).toEqual(Array.from({ length: 998 }, (_, i) => `f${pad(i)}.md`));
    expect(big.truncated).toBe(true);
    expect(big.omitted).toBe(3);

    for (let i = 0; i < 998; i++) w.row(r, path.join("exata", `f${pad(i)}.md`));
    w.row(r, path.join("exata", "s1", "x.md"));
    w.row(r, path.join("exata", "s2", "x.md"));
    const exact = await tree({ root: r, dir: "exata" });
    expect(exact.folders.length + exact.files.length).toBe(1000);
    expect(exact.truncated).toBe(false);
    expect(exact.omitted).toBe(0);
  });

  it("C7 editable and reason: outside memory/ is outside_memory; ROUTER.md, areas/, journal/, contexts/ and what is under them are generated; a non-.md under memory/ is not_markdown; a .md under notes/ and maps/ is editable with no reason", async () => {
    const r = w.indexedRoot("c7");
    w.put(path.join(r, "sub", "a.md"), "# A\n");
    w.put(path.join(r, "b.md"), "# B\n");
    w.put(path.join(memory, "ROUTER.md"), "# Roteador\n");
    w.put(path.join(memory, "areas", "projetos.md"), "# Projetos\n");
    w.put(path.join(memory, "journal", "2026-10-30.md"), "# 2026-10-30\n");
    w.put(path.join(memory, "contexts", "c7.md"), "# Contexto\n");
    w.put(path.join(memory, "notes", "c7", "x.txt"), "texto\n");
    w.put(path.join(memory, "notes", "c7", "n.md"), "# N\n");
    w.put(path.join(memory, "maps", "c7", "m.md"), "# M\n");
    await w.index();

    const user = await tree({ root: r });
    expect(user.folders.find((f: Json) => f.name === "sub")).toMatchObject({
      editable: false,
      reason: "outside_memory",
    });
    expect(user.files.find((f: Json) => f.name === "b.md")).toMatchObject({
      editable: false,
      reason: "outside_memory",
    });

    const top = await tree();
    expect(top.files.find((f: Json) => f.name === "ROUTER.md")).toMatchObject({
      editable: false,
      reason: "generated",
    });
    for (const folder of ["areas", "journal", "contexts"]) {
      expect(
        top.folders.find((f: Json) => f.name === folder),
        folder,
      ).toMatchObject({ editable: false, reason: "generated" });
      const inner = await tree({ dir: folder });
      expect(inner.files.length, folder).toBeGreaterThan(0);
      for (const f of inner.files) expect(f, folder).toMatchObject({ editable: false, reason: "generated" });
    }
    for (const folder of ["notes", "maps"]) {
      const entry = top.folders.find((f: Json) => f.name === folder);
      expect(entry, folder).toMatchObject({ editable: true });
      expect(entry, folder).not.toHaveProperty("reason");
    }
    const notes = await tree({ dir: "notes/c7" });
    expect(notes.files.find((f: Json) => f.name === "x.txt")).toMatchObject({
      editable: false,
      reason: "not_markdown",
    });
    const n = notes.files.find((f: Json) => f.name === "n.md");
    expect(n).toMatchObject({ editable: true });
    expect(n).not.toHaveProperty("reason");
    const m = (await tree({ dir: "maps/c7" })).files.find((f: Json) => f.name === "m.md");
    expect(m).toMatchObject({ editable: true });
    expect(m).not.toHaveProperty("reason");
  });

  it("C8 indexNote is the folder's _index.md where cerebro-organizar puts it (beside the notes, or under memory/maps/<rootSlug>/), before README.md; else the first of index.md, README.md, CLAUDE.md, AGENTS.md; null with none; an _index.md written after the pass counts after the next pass", async () => {
    const clientes = path.join(memory, "notes", "c8-clientes");
    const own = w.put(path.join(clientes, "_index.md"), "---\ntype: index\n---\n# Índice\n");
    w.put(path.join(clientes, "README.md"), "# Leia\n");
    w.put(path.join(clientes, "a.md"), "# A\n");
    const r = w.indexedRoot("c8");
    w.put(path.join(r, "projetos", "README.md"), "# Leia\n");
    w.put(path.join(r, "projetos", "a.md"), "# A\n");
    const mapped = w.put(
      path.join(memory, "maps", slugOf(r), "projetos", "_index.md"),
      "# Índice dos projetos\n",
    );
    const readmeB = w.put(path.join(r, "b", "README.md"), "# Leia\n");
    w.put(path.join(r, "b", "AGENTS.md"), "# Agentes\n");
    const indexC = w.put(path.join(r, "c", "index.md"), "# Índice\n");
    w.put(path.join(r, "c", "README.md"), "# Leia\n");
    const claudeD = w.put(path.join(r, "d", "CLAUDE.md"), "# Claude\n");
    w.put(path.join(r, "d", "AGENTS.md"), "# Agentes\n");
    w.put(path.join(r, "e", "a.md"), "# A\n");
    const readmeF = w.put(path.join(r, "f", "README.md"), "# Leia\n");
    await w.index();

    expect((await tree({ dir: "notes/c8-clientes" })).indexNote).toBe(idOf(own));
    expect(idOf(own)).toBeGreaterThan(0);
    expect((await tree({ root: r, dir: "projetos" })).indexNote).toBe(idOf(mapped));
    expect(idOf(mapped)).toBeGreaterThan(0);
    expect((await tree({ root: r, dir: "b" })).indexNote).toBe(idOf(readmeB));
    expect((await tree({ root: r, dir: "c" })).indexNote).toBe(idOf(indexC));
    expect((await tree({ root: r, dir: "d" })).indexNote).toBe(idOf(claudeD));
    expect((await tree({ root: r, dir: "e" })).indexNote).toBeNull();

    expect((await tree({ root: r, dir: "f" })).indexNote).toBe(idOf(readmeF));
    const late = w.put(path.join(memory, "maps", slugOf(r), "f", "_index.md"), "# Índice tardio\n");
    expect((await tree({ root: r, dir: "f" })).indexNote).toBe(idOf(readmeF));
    await w.index();
    expect(idOf(late)).toBeGreaterThan(0);
    expect((await tree({ root: r, dir: "f" })).indexNote).toBe(idOf(late));
  });

  it("C9 each file carries type from its row's fields.type: context for type: context, null without it", async () => {
    const dir = path.join(memory, "notes", "c9");
    w.put(path.join(dir, "contexto.md"), "---\ntype: context\nstatus: active\n---\n# Contexto\n");
    w.put(path.join(dir, "simples.md"), "# Simples\n");
    await w.index();
    const body = await tree({ dir: "notes/c9" });
    expect(body.files.map((f: Json) => [f.name, f.type])).toEqual([
      ["contexto.md", "context"],
      ["simples.md", null],
    ]);
  });

  it("C10 with a context the roots are its ok paths in its order then its notes folder when it exists, root defaults to the first, and the entries are the context's only", async () => {
    const r = w.indexedRoot("c10");
    const app = path.join(r, "projetos", "app");
    w.put(path.join(app, "a.md"), "# App\n");
    w.put(path.join(r, "projetos", "app-antigo", "velho.md"), "# Velho\n");
    const gone = path.join(r, "apagada");
    fs.mkdirSync(gone, { recursive: true });
    const clientes = path.join(memory, "notes", "app-x", "clientes");
    w.put(path.join(clientes, "cliente.md"), "# Cliente\n");
    const notes = path.join(memory, "notes", "c10");
    w.put(path.join(notes, "nota.md"), "# Nota do contexto\n");
    await w.index();
    w.update((s) => {
      s.contexts = [...s.contexts, { id: "c10", name: "C10", paths: [app, gone, clientes] }];
    });
    fs.rmSync(gone, { recursive: true });

    const body = await tree({ context: "c10" });
    expect(body.roots.map((x: Json) => [x.path, x.editable])).toEqual([
      [app, false],
      [clientes, true],
      [notes, true],
    ]);
    expect(body.root).toBe(app);
    expect(names(body.files)).toEqual(["a.md"]);
    expect(JSON.stringify(body)).not.toContain("app-antigo");
    expect(names((await tree({ context: "c10", root: clientes })).files)).toEqual(["cliente.md"]);
    expect(names((await tree({ context: "c10", root: notes })).files)).toEqual(["nota.md"]);
    // the context without its notes folder: no third root
    w.update((s) => {
      s.contexts = [...s.contexts, { id: "c10-sem", name: "C10 sem notas", paths: [app] }];
    });
    expect((await tree({ context: "c10-sem" })).roots.map((x: Json) => x.path)).toEqual([app]);
  });

  it("C11 a context that names none is 404 context_not_found, a root outside the context's roots is 400 unknown_root, and context=all answers exactly what no context answers", async () => {
    const r = w.indexedRoot("c11");
    const inside = path.join(r, "dentro");
    w.put(path.join(inside, "a.md"), "# A\n");
    const elsewhere = w.indexedRoot("c11-fora");
    w.put(path.join(elsewhere, "b.md"), "# B\n");
    await w.index();
    w.update((s) => {
      s.contexts = [...s.contexts, { id: "c11", name: "C11", paths: [inside] }];
    });
    const none = await refused({ context: "nao-existe" });
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe("context_not_found");
    for (const root of [memory, elsewhere]) {
      const res = await refused({ context: "c11", root });
      expect(res.status, root).toBe(400);
      expect(res.body.error.code, root).toBe("unknown_root");
    }
    expect(await tree({ context: "all" })).toEqual(await tree());
    expect(await tree({ context: "all", root: elsewhere })).toEqual(await tree({ root: elsewhere }));
  });

  it('C82 a context with no ok path and no notes folder answers 200 with roots [], root null, dir "" and no entry; with a root asked it answers 400 unknown_root', async () => {
    const r = w.indexedRoot("c82");
    const gone = path.join(r, "sumida");
    fs.mkdirSync(gone, { recursive: true });
    w.put(path.join(r, "outra.md"), "# Outra\n");
    await w.index();
    w.update((s) => {
      s.contexts = [...s.contexts, { id: "c82", name: "C82", paths: [gone] }];
    });
    fs.rmSync(gone, { recursive: true });
    expect(fs.existsSync(path.join(memory, "notes", "c82"))).toBe(false);
    expect(await tree({ context: "c82" })).toEqual({
      roots: [],
      root: null,
      dir: "",
      folders: [],
      files: [],
      indexNote: null,
      truncated: false,
      omitted: 0,
    });
    for (const root of [memory, r, gone]) {
      const res = await refused({ context: "c82", root });
      expect(res.status, root).toBe(400);
      expect(res.body.error.code, root).toBe("unknown_root");
    }
  });

  it("C12 while an index pass runs every root answers indexing true, and once it ends every root answers false", async () => {
    const r = w.indexedRoot("c12");
    for (let i = 0; i < 3000; i++) {
      w.put(
        path.join(r, `lote-${Math.floor(i / 100)}`, `n${i}.md`),
        `# Nota ${i}\n\n${"palavra ".repeat(60)}${i}\n`,
      );
    }
    const pass = w.index();
    pass.catch(() => undefined);
    let during: Json | null = null;
    const deadline = Date.now() + 60_000;
    while (during === null && Date.now() < deadline) {
      const before = (await w.call("GET", "/api/memory/status")).body.indexing.state;
      const answer = await tree();
      const after = (await w.call("GET", "/api/memory/status")).body.indexing.state;
      if (before === "running" && after === "running") during = answer;
      else await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(during, "the tree was asked while the pass ran").not.toBeNull();
    expect(during!.roots.length).toBeGreaterThan(1);
    for (const root of during!.roots) expect(root.indexing, root.path).toBe(true);
    await pass;
    expect((await w.call("GET", "/api/memory/status")).body.indexing.state).toBe("idle");
    const ended = await tree();
    for (const root of ended.roots) expect(root.indexing, root.path).toBe(false);
  }, 120_000);
});

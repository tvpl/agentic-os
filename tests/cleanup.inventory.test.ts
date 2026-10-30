import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch A, S1: `GET /api/memory/cleanup/inventory` through `app.inject` against
 * `buildServer` over a real home, with folders outside the home indexed by a real pass. The rules themselves, one case
 * per row, are in `cleanup.layer.test.ts`.
 */

let w: NotesViewWorld;
let seq = 0;
const inv = (query: string) => w.call("GET", `/api/memory/cleanup/inventory?${query}`);
const q = (value: string) => encodeURIComponent(value);
const code = (r: { body: Json }) => r.body?.error?.code;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-cleanup-inv-");
});
afterAll(async () => {
  await w.close();
});

async function context(name: string, paths: string[]): Promise<string> {
  const res = await w.call("POST", "/api/contexts", { name, paths });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

describe("S1 the inventory of a scope", () => {
  it("C1 context=<id> answers 200 with its scope, the total of its 14 files and every key computed over them", async () => {
    const root = w.indexedRoot(`c1-${++seq}`);
    let bytes = 0;
    for (let i = 0; i < 14; i++) {
      const text = `# Nota ${i}\n${"x".repeat(i * 10)}\n`;
      bytes += Buffer.byteLength(text);
      w.put(path.join(root, i % 2 ? "sub" : "", `n${i}.md`), text);
    }
    w.put(path.join(w.outside("c1-fora"), "longe.md"), "# Longe\n");
    await w.index();
    const id = await context("Inventário C1", [root]);
    const res = await inv(`context=${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.scope).toEqual({ kind: "context", id });
    expect(res.body.total).toEqual({ count: 14, bytes });
    expect(Object.keys(res.body).sort()).toEqual([
      "byAge",
      "byKind",
      "bySize",
      "clusters",
      "scope",
      "topFolders",
      "total",
    ]);
    const sum = (list: Json[]) => list.reduce((n, x) => n + x.count, 0);
    expect(sum(res.body.byKind)).toBe(14);
    expect(res.body.byKind[0]).toEqual({ kind: "notes", count: 14, bytes });
    expect(sum(res.body.bySize)).toBe(14);
    expect(sum(res.body.byAge)).toBe(14);
    expect(res.body.byAge[0].count).toBe(14);
    expect(res.body.topFolders).toEqual([
      { path: path.join(root, "sub"), count: 7, bytes: expect.any(Number) },
    ]);
    expect(res.body.clusters).toEqual(expect.any(Array));
  });

  it("C2 byKind through the route: six groups in order, a case per group", async () => {
    const root = w.indexedRoot(`c2-${++seq}`);
    const files: Record<string, string> = {
      "a.md": "# A\n",
      "b.markdown": "# B\n",
      "c.txt": "texto\n",
      "d.pdf": "%PDF-1.4\n",
      "e.png": "png?\n",
      "f.ts": "export {};\n",
      "g.xyz": "xyz\n",
    };
    for (const [name, text] of Object.entries(files)) w.put(path.join(root, name), text);
    await w.index();
    const res = await inv(`dir=${q(root)}`);
    expect(res.status).toBe(200);
    const len = (name: string) => Buffer.byteLength(files[name]!);
    expect(res.body.byKind).toEqual([
      { kind: "notes", count: 2, bytes: len("a.md") + len("b.markdown") },
      { kind: "text", count: 1, bytes: len("c.txt") },
      { kind: "pdf", count: 1, bytes: len("d.pdf") },
      { kind: "image", count: 1, bytes: len("e.png") },
      { kind: "code", count: 1, bytes: len("f.ts") },
      { kind: "other", count: 1, bytes: len("g.xyz") },
    ]);
  });

  it("C6 the files deleted after the pass are still counted from the rows; an exclude added later and a secret-named row are counted nowhere", async () => {
    const root = w.indexedRoot(`c6-${++seq}`);
    w.put(path.join(root, "a.md"), "# A\nalfa\n");
    w.put(path.join(root, "b.txt"), "beta\n");
    w.put(path.join(root, "privado", "c.md"), "# C\n");
    await w.index();
    const before = await inv(`dir=${q(root)}`);
    expect(before.body.total.count).toBe(3);
    for (const name of ["a.md", "b.txt", "privado"])
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    const after = await inv(`dir=${q(root)}`);
    expect(after.status).toBe(200);
    expect(after.body.total).toEqual(before.body.total);
    expect(after.body.byKind).toEqual(before.body.byKind);

    w.row(root, ".env");
    w.update((s) => {
      s.excludes = [...s.excludes, "privado"];
    });
    const hidden = await inv(`dir=${q(root)}`);
    expect(hidden.body.total).toEqual({
      count: 2,
      bytes: Buffer.byteLength("# A\nalfa\n") + Buffer.byteLength("beta\n"),
    });
    expect(hidden.body.byKind.reduce((n: number, g: Json) => n + g.count, 0)).toBe(2);
    expect(hidden.body.topFolders).toEqual([]);
  });

  it("C7 a context counts its ok path and its notes folder, never app-antigo/ nor a row left under a missing path", async () => {
    const root = w.indexedRoot(`c7-${++seq}`);
    const app = path.join(root, "projetos", "app");
    const gone = path.join(root, "sumiu");
    w.put(path.join(app, "x.md"), "# X\n");
    w.put(path.join(root, "projetos", "app-antigo", "y.md"), "# Y\n");
    w.put(path.join(gone, "z.md"), "# Z\n");
    const id = await context("Inventário C7", [app, gone]);
    w.put(path.join(w.memory, "notes", id, "_resumo.md"), "# Resumo\n");
    await w.index();
    fs.rmSync(gone, { recursive: true, force: true });
    const res = await inv(`context=${id}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toEqual({
      count: 2,
      bytes: Buffer.byteLength("# X\n") + Buffer.byteLength("# Resumo\n"),
    });
  });

  it("C8 dir= inside an indexed folder or under memory/ is the folder and below; outside every root, the home's config/ and a disabled folder are 400 scope_required", async () => {
    const root = w.indexedRoot(`c8-${++seq}`);
    w.put(path.join(root, "projetos", "a.md"), "# A\n");
    w.put(path.join(root, "projetos", "sub", "b.md"), "# B\n");
    w.put(path.join(root, "outros", "c.md"), "# C\n");
    const clientes = path.join(w.memory, "notes", "clientes");
    w.put(path.join(clientes, "acme.md"), "# Acme\n");
    w.put(path.join(w.memory, "notes", "fora-de-clientes.md"), "# Fora\n");
    const disabled = w.outside(`c8-desligada-${seq}`);
    w.put(path.join(disabled, "d.md"), "# D\n");
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: disabled, area: null, enabled: false }];
    });
    await w.index();

    const projetos = await inv(`dir=${q(path.join(root, "projetos"))}`);
    expect(projetos.status).toBe(200);
    expect(projetos.body.scope).toEqual({ kind: "dir", path: path.join(root, "projetos") });
    expect(projetos.body.total.count).toBe(2);
    const notes = await inv(`dir=${q(clientes)}`);
    expect(notes.status).toBe(200);
    expect(notes.body.scope).toEqual({ kind: "dir", path: clientes });
    expect(notes.body.total.count).toBe(1);

    for (const dir of ["/tmp/fora", path.join(w.home, "config"), disabled]) {
      const res = await inv(`dir=${q(dir)}`);
      expect(res.status, dir).toBe(400);
      expect(code(res), dir).toBe("scope_required");
      expect(res.body.total, dir).toBeUndefined();
    }
  });

  it("C9 the scope refusals with status and code, the same through POST /scans, and none starts a scan", async () => {
    const root = w.indexedRoot(`c9-${++seq}`);
    w.put(path.join(root, "a.md"), "# A\n");
    await w.index();
    const id = await context("Inventário C9", [root]);
    const cases: Array<{ query: string; body: Json; status: number; code: string }> = [
      {
        query: "context=nao-existe",
        body: { context: "nao-existe" },
        status: 404,
        code: "context_not_found",
      },
      { query: "", body: {}, status: 400, code: "scope_required" },
      { query: "context=all", body: { context: "all" }, status: 400, code: "scope_required" },
      {
        query: `context=${id}&dir=${q(root)}`,
        body: { context: id, dir: root },
        status: 400,
        code: "validation",
      },
    ];
    const seen: string[] = [];
    const off = w.ctx.events.subscribe((e) => {
      if (e.type.startsWith("cleanup.")) seen.push(e.type);
    });
    try {
      for (const c of cases) {
        const get = await inv(c.query);
        expect([get.status, code(get)], c.query).toEqual([c.status, c.code]);
        const post = await w.call("POST", "/api/memory/cleanup/scans", c.body);
        expect([post.status, code(post)], JSON.stringify(c.body)).toEqual([c.status, c.code]);
        expect(post.body.scanId).toBeUndefined();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen).toEqual([]);
    } finally {
      off();
    }
  });
});

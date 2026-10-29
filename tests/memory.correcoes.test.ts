import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { API } from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { openDb } from "../core/src/db/db.js";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { linkEdges } from "../core/src/memory/links.js";
import { relatedFiles } from "../core/src/memory/graph.js";
import { generateRouters } from "../core/src/memory/routers.js";
import { searchFiles, strictWordsSearch } from "../core/src/memory/search.js";
import { IndexWorkerHost } from "../core/src/memory/indexHost.js";
import { FsWatchSentinel } from "../core/src/sentinels/fsWatch.js";
import { openApiDocument } from "../apps/api/src/openapi.js";
import { makeTempHome } from "./helpers.js";
import { bundleIndexWorker } from "./helpers/indexWorkerBundle.js";
import { repoRoot } from "./helpers/childBundle.js";

/**
 * .specs/features/cerebro-correcoes: one truth about links (S1), today's policy on every read (S2), a question in
 * words finds notes (S3), the routers follow the index (S5), and the contract (cross-cutting). Everything goes through
 * a real index of real files; the claims about routes cross the HTTP boundary.
 */

const corpus = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "tests/fixtures/semantic-corpus.json"), "utf8"),
) as { notes: Array<{ name: string; text: string }>; questions: Array<{ q: string; expected: string }> };

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let app: FastifyInstance;
let token: string;
const owner = () => ({ "x-mordomo-token": token });
let seq = 0;
/** A folder inside memory/ for one test, so tests do not see each other's files. */
const area = (name = "c") => {
  const dir = path.join(temp.paths.memory, `${name}${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const put = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const idOf = (file: string): number =>
  (ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
const get = async (url: string) => app.inject({ url, headers: owner() });
/** Listen for one event type on a context's bus; the returned function stops listening. */
const on = (bus: AppContext["events"], type: string, fn: () => void) =>
  bus.subscribe((event) => {
    if (event.type === type) fn();
  });

interface Edge {
  source: number;
  target: number;
  kind: string;
}
async function graphEdges(): Promise<Edge[]> {
  const res = await get("/api/memory/graph?maxNodes=4000&related=0");
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { edges: Edge[] }).edges;
}
/** The link edges (not the folder or similarity ones) from a to b. */
const between = (edges: Edge[], a: number, b: number) =>
  edges.filter(
    (e) => e.source === a && e.target === b && (e.kind === "markdown-link" || e.kind === "wikilink"),
  );
async function searchNames(q: string, limit = 50): Promise<string[]> {
  const res = await get(`/api/memory/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as Array<{ name: string }>).map((h) => h.name);
}
/** Change the excludes for one test; the returned function puts them back. */
function exclude(...names: string[]): () => void {
  const settings = ctx.settings();
  const before = [...settings.excludes];
  settings.excludes = [...before, ...names];
  ctx.settingsStore.save(settings);
  return () => {
    const now = ctx.settings();
    now.excludes = before;
    ctx.settingsStore.save(now);
  };
}

beforeAll(async () => {
  temp = makeTempHome("mordomo-correcoes-");
  ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});
afterAll(async () => {
  await app.close();
  ctx.close();
  temp.cleanup();
});

describe("S1 one truth about links", () => {
  it("C1 a wikilink is one graph edge of kind wikilink", async () => {
    const dir = area();
    const a = put(path.join(dir, "a1.md"), "# A\n\nveja [[Bee1]]\n");
    const b = put(path.join(dir, "bee1.md"), "# B\n");
    await ctx.indexer.indexAllAsync();
    const edges = between(await graphEdges(), idOf(a), idOf(b));
    expect(edges).toEqual([{ source: idOf(a), target: idOf(b), kind: "wikilink", why: expect.any(String) }]);
  });

  it("C1 at its own layer: linkEdges gives a resolved wikilink, nothing for an unresolved one, nothing to a file the policy refuses", async () => {
    const dir = area();
    const a = put(path.join(dir, "a1b.md"), "# A\n\n[[Bee1b]] [[Ninguem1b]] [[Oculta1b]]\n");
    const b = put(path.join(dir, "bee1b.md"), "# B\n");
    const hidden = put(path.join(dir, "oculta1b.md"), "# O\n");
    await ctx.indexer.indexAllAsync();
    const from = (allow: (row: { root: string; rel: string }) => boolean) =>
      linkEdges(ctx.db, allow, new Set([idOf(a)])).map((e) => [e.target, e.kind]);
    expect(from(() => true)).toEqual([
      [idOf(b), "wikilink"],
      [idOf(hidden), "wikilink"],
    ]);
    expect(from((row) => !row.rel.endsWith("oculta1b.md"))).toEqual([[idOf(b), "wikilink"]]);
  });

  it("C2 a Markdown link with a fragment is one edge, written twice still one", async () => {
    const dir = area();
    const a = put(
      path.join(dir, "a2.md"),
      "# A\n\n[texto](./b2.md#parte)\n\nde novo [texto](./b2.md#parte) e [x](b2.md)\n",
    );
    const b = put(path.join(dir, "b2.md"), "# B\n");
    await ctx.indexer.indexAllAsync();
    const edges = between(await graphEdges(), idOf(a), idOf(b));
    expect(edges.map((e) => e.kind)).toEqual(["markdown-link"]);
  });

  it("C3 a link in a fence or an inline code span is no edge, no related row, no orphan rescue and no recall pointer", async () => {
    const dir = area();
    const a = put(
      path.join(dir, "a3.md"),
      "# Fonte três\n\n```\n[[Alvo3]] e [x](./alvo3.md)\n```\n\n~~~\n[[Alvo3]]\n~~~\n\nuse `[[Alvo3]]` e `[y](./alvo3.md)` ali\n",
    );
    const b = put(path.join(dir, "alvo3.md"), "# Alvo três\n\nquindim\n");
    await ctx.indexer.indexAllAsync();
    expect(between(await graphEdges(), idOf(a), idOf(b))).toEqual([]);
    const related = (await get(`/api/memory/related?id=${idOf(a)}`)).json() as Array<{
      file: { path: string };
    }>;
    expect(related.map((r) => r.file.path)).not.toContain(b);
    const hygiene = (await get("/api/memory/hygiene?perKind=500")).json() as {
      items: Array<{ kind: string; id: string }>;
    };
    const orphans = hygiene.items.filter((i) => i.kind === "orphan").map((i) => i.id);
    expect(orphans).toContain(a);
    expect(orphans).toContain(b);
    const recall = (
      await get(`/api/memory/recall?q=${encodeURIComponent("fonte três")}&record=0`)
    ).json() as {
      answerContext: Array<{ path: string; via?: string }>;
    };
    // the target may be a candidate of its own (its title has a word of the question), never one reached from a
    expect(recall.answerContext.some((c) => c.via === a)).toBe(false);
  });

  it("C4 a key two files share draws only the edge to the file the links route resolves", async () => {
    const root = area();
    const near = put(path.join(root, "x", "alvo4.md"), "# perto\n");
    const far = put(path.join(root, "y", "z", "alvo4.md"), "# longe\n");
    const src = put(path.join(root, "x", "fonte4.md"), "[[alvo4]]\n");
    await ctx.indexer.indexAllAsync();
    const links = (await get(`/api/memory/links?id=${idOf(src)}`)).json() as {
      outgoing: Array<{ resolved: { path: string } | null }>;
    };
    expect(links.outgoing[0]!.resolved!.path).toBe(near);
    const edges = await graphEdges();
    expect(between(edges, idOf(src), idOf(near)).map((e) => e.kind)).toEqual(["wikilink"]);
    expect(between(edges, idOf(src), idOf(far))).toEqual([]);
  });

  it("C5 a rename leaves no edge to the new name nor to the old id; a file created later is linked with the source untouched", async () => {
    const dir = area();
    const a = put(path.join(dir, "a5.md"), "# A\n\n[[Bee5]]\n");
    const b = put(path.join(dir, "bee5.md"), "# B\n");
    await ctx.indexer.indexAllAsync();
    const oldB = idOf(b);
    expect(between(await graphEdges(), idOf(a), oldB)).toHaveLength(1);
    const aBefore = { bytes: fs.readFileSync(a), mtime: fs.statSync(a).mtimeMs };

    const c = path.join(dir, "cee5.md");
    fs.renameSync(b, c);
    await ctx.indexer.indexAllAsync();
    const afterRename = await graphEdges();
    expect(between(afterRename, idOf(a), idOf(c))).toEqual([]);
    expect(afterRename.some((e) => e.target === oldB || e.source === oldB)).toBe(false);

    const again = put(path.join(dir, "bee5.md"), "# B de novo\n");
    await ctx.indexer.requestIndexPaths([again]);
    expect(between(await graphEdges(), idOf(a), idOf(again)).map((e) => e.kind)).toEqual(["wikilink"]);
    expect(fs.readFileSync(a)).toEqual(aBefore.bytes);
    expect(fs.statSync(a).mtimeMs).toBe(aBefore.mtime);
  });

  it("C6 a note linked only by wikilinks is no orphan; one with no resolving link, and one with only a broken one, are", async () => {
    const dir = area();
    const hub = put(path.join(dir, "hub6.md"), "# Hub\n\n[[Folha6]]\n");
    const leaf = put(path.join(dir, "folha6.md"), "# Folha\n");
    const alone = put(path.join(dir, "sozinha6.md"), "# Sozinha\n");
    const broken = put(path.join(dir, "quebrada6.md"), "# Quebrada\n\n[[Ninguem6]] e [z](./nada6.md)\n");
    await ctx.indexer.indexAllAsync();
    const res = await get("/api/memory/hygiene?perKind=500");
    expect(res.statusCode).toBe(200);
    const orphans = (res.json() as { items: Array<{ kind: string; id: string }> }).items
      .filter((i) => i.kind === "orphan")
      .map((i) => i.id);
    expect(orphans).not.toContain(hub);
    expect(orphans).not.toContain(leaf);
    expect(orphans).toContain(alone);
    expect(orphans).toContain(broken);
  });

  it("C7 related names a wikilink and a Markdown link by their kind", async () => {
    const dir = area();
    const a = put(path.join(dir, "a7.md"), "# A\n\n[[Wiki7]] e [md](./md7.md)\n");
    const wiki = put(path.join(dir, "wiki7.md"), "# W\n");
    const md = put(path.join(dir, "md7.md"), "# M\n");
    await ctx.indexer.indexAllAsync();
    const res = await get(`/api/memory/related?id=${idOf(a)}`);
    expect(res.statusCode).toBe(200);
    const why = new Map(
      (res.json() as Array<{ file: { path: string }; why: string }>).map((r) => [r.file.path, r.why]),
    );
    expect(why.get(wiki)).toBe("Connected by a wikilink.");
    expect(why.get(md)).toBe("Connected by a markdown link.");
  });

  it("C8 the recall follows a wikilink of the winning section, and follows nothing with pointerLimit 0", async () => {
    const dir = area();
    const src = put(
      path.join(dir, "rota-cambuci8.md"),
      "# Rota cambuci\n\nVer [[Detalhe8]] sobre a rota cambuci.\n",
    );
    const target = put(
      path.join(dir, "detalhe8.md"),
      "# Notas\n\n## Rota cambuci completa\n\nrota cambuci, rota cambuci, rota cambuci: a rota cambuci sai da praça do cambuci.\n",
    );
    await ctx.indexer.indexAllAsync();
    const { recall } = await import("../core/src/memory/recall.js");
    const followed = recall(ctx.db, ctx.paths, ctx.settings(), "rota cambuci", { k: 1 });
    // the source is the one candidate opened, so the target can only come through its wikilink
    expect(followed.candidates[0]!.path).toBe(src);
    expect(followed.answerContext.some((c) => c.path === target && c.via === src)).toBe(true);
    const none = recall(ctx.db, ctx.paths, ctx.settings(), "rota cambuci", { k: 1, pointerLimit: 0 });
    expect(none.candidates[0]!.path).toBe(src);
    expect(none.answerContext.some((c) => c.path === target)).toBe(false);
  });

  it("C9 migration 22 drops file_links and the pending map, keeps files and note_links byte for byte, and runs on a database without them", () => {
    const home = makeTempHome("mordomo-m22-");
    try {
      const old = openDb(
        home.paths,
        MIGRATIONS.filter((m) => m.version <= 21),
      ).db;
      old
        .prepare(
          "INSERT INTO files (id, root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES (1, '/r', '/r/a.md', 'a.md', 'a.md', '.md', '/r', NULL, 1, 1, 1, NULL, '[]'), (2, '/r', '/r/b.md', 'b.md', 'b.md', '.md', '/r', NULL, 1, 1, 1, NULL, '[]')",
        )
        .run();
      old.prepare("INSERT INTO file_links (src_id, dst_id, kind) VALUES (1, 2, 'markdown-link')").run();
      old
        .prepare(
          "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (1, 'wikilink', 'b', NULL, 3)",
        )
        .run();
      old.prepare("INSERT INTO meta (key, value) VALUES ('index.pending_links', '{\"/r/c.md\":[1]}')").run();
      const before = {
        files: old.prepare("SELECT * FROM files ORDER BY id").all(),
        notes: old.prepare("SELECT * FROM note_links").all(),
      };
      old.close();

      const { db, migration } = openDb(home.paths);
      expect(migration.toVersion).toBe(22);
      expect(db.pragma("user_version", { simple: true })).toBe(22);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'file_links'").get()).toBeUndefined();
      expect(db.prepare("SELECT value FROM meta WHERE key = 'index.pending_links'").get()).toBeUndefined();
      expect(db.prepare("SELECT * FROM files ORDER BY id").all()).toEqual(before.files);
      expect(db.prepare("SELECT * FROM note_links").all()).toEqual(before.notes);
      db.close();
    } finally {
      home.cleanup();
    }
    // a database that never had them (created at 22 from nothing)
    const fresh = makeTempHome("mordomo-m22-fresh-");
    try {
      const { db, migration } = openDb(fresh.paths);
      expect(migration.toVersion).toBe(22);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'file_links'").get()).toBeUndefined();
      db.close();
    } finally {
      fresh.cleanup();
    }
  });

  it("C10 no source of the core, the API or the interface names file_links outside the migrations", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "dist") walk(full);
        } else if (
          /\.(ts|tsx|mjs|js)$/.test(entry.name) &&
          fs.readFileSync(full, "utf8").includes("file_links")
        ) {
          found.push(path.relative(repoRoot, full));
        }
      }
    };
    for (const dir of ["core/src", "apps/api/src", "apps/command-centre/src"]) walk(path.join(repoRoot, dir));
    expect(found).toEqual([path.join("core", "src", "db", "migrations.ts")]);
  });

  it("C11 the graph contract lists the four edge kinds and not same-area; the label tables name wikilink in both locales", async () => {
    const schema = API["memory.graph"].responses[200];
    const edge = (kind: string) => ({
      nodes: [],
      edges: [{ source: 1, target: 2, kind, why: "x" }],
      truncated: false,
      totalFiles: 0,
    });
    for (const kind of ["markdown-link", "wikilink", "same-dir", "related"])
      expect(schema.safeParse(edge(kind)).success).toBe(true);
    expect(schema.safeParse(edge("same-area")).success).toBe(false);
    const locales = fs.readFileSync(path.join(repoRoot, "apps/command-centre/src/locales/brain.ts"), "utf8");
    expect(locales).not.toContain("brain.kind.same-area");
    expect(locales.match(/"brain\.kind\.wikilink":/g)).toHaveLength(2);
    for (const file of [
      "apps/command-centre/src/brain/PreviewPanel.tsx",
      "apps/command-centre/src/nucleo/scenes/BrainScene.tsx",
      "apps/command-centre/src/nucleo/scenes/BrainSceneMenu.tsx",
    ]) {
      const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
      expect(text, file).not.toContain("same-area");
      expect(text, file).toContain("brain.kind.wikilink");
    }
  });

  it("C12 linkEdges runs the same number of statement executions for 3 000 files and 20 000 links as for 30 and 200", () => {
    const measure = (files: number, links: number): number => {
      const home = makeTempHome("mordomo-edges-");
      const { db } = openDb(home.paths);
      try {
        const file = db.prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES ('/r', ?, ?, ?, '.md', '/r', NULL, 1, 1, 1, NULL, '[]')",
        );
        const link = db.prepare(
          "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (?, ?, ?, NULL, ?)",
        );
        db.transaction(() => {
          for (let i = 0; i < files; i++) file.run(`/r/n${i}.md`, `n${i}.md`, `n${i}.md`);
          for (let j = 0; j < links; j++) {
            const src = (j % files) + 1;
            const dst = (j * 7) % files;
            if (j % 2) link.run(src, "wikilink", `n${dst}`, j);
            else link.run(src, "markdown-link", `/r/n${dst}.md`, j);
          }
        })();
        let executions = 0;
        const real = db.prepare.bind(db);
        const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
          const stmt = real(sql);
          for (const method of ["all", "get", "run", "iterate"] as const) {
            const original = (stmt[method] as (...args: unknown[]) => unknown).bind(stmt);
            (stmt as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
              executions++;
              return original(...args);
            };
          }
          return stmt;
        }) as typeof db.prepare);
        const edges = linkEdges(db, () => true);
        spy.mockRestore();
        expect(edges.length).toBeGreaterThan(0);
        return executions;
      } finally {
        db.close();
        home.cleanup();
      }
    };
    const small = measure(30, 200);
    const big = measure(3000, 20000);
    expect(big).toBe(small);
    expect(small).toBeLessThanOrEqual(2);
  });
});

describe("S2 today's policy on every read", () => {
  it("C13 an excluded row and a stale row under the home's config/ are no node, touch no edge and are not counted", async () => {
    const dir = area();
    const open = put(path.join(dir, "aberta13.md"), "# Aberta\n\n[[Fechada13]]\n");
    const closed = put(path.join(dir, "privado13", "fechada13.md"), "# Fechada\n");
    await ctx.indexer.indexAllAsync();
    const closedId = idOf(closed);
    ctx.db
      .prepare(
        "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES (?, ?, 'config/stale13.md', 'stale13.md', '.md', ?, NULL, 1, ?, 1, NULL, '[]')",
      )
      .run(
        temp.paths.home,
        path.join(temp.paths.home, "config", "stale13.md"),
        path.join(temp.paths.home, "config"),
        Date.now() + 1e9,
      );
    const staleId = idOf(path.join(temp.paths.home, "config", "stale13.md"));
    // a row under the home's logs/ and one with a secret name, indexed before the policy refused them
    const extra = ctx.db.prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, 1, NULL, '[]')",
    );
    const logsId = Number(
      extra.run(
        temp.paths.home,
        path.join(temp.paths.home, "logs", "api13.md"),
        "logs/api13.md",
        "api13.md",
        ".md",
        path.join(temp.paths.home, "logs"),
        Date.now() + 1e9,
      ).lastInsertRowid,
    );
    const secretId = Number(
      extra.run(
        dir,
        path.join(dir, "chave13.pem"),
        "chave13.pem",
        "chave13.pem",
        ".pem",
        dir,
        Date.now() + 1e9,
      ).lastInsertRowid,
    );
    const refused = [closedId, staleId, logsId, secretId];
    const restore = exclude("privado13");
    try {
      const res = await get("/api/memory/graph?maxNodes=4000&related=0");
      const body = res.json() as { nodes: Array<{ id: number }>; edges: Edge[]; totalFiles: number };
      const ids = new Set(body.nodes.map((n) => n.id));
      for (const id of refused) expect(ids.has(id), String(id)).toBe(false);
      expect(ids.has(idOf(open))).toBe(true);
      expect(body.edges.some((e) => refused.includes(e.source) || refused.includes(e.target))).toBe(false);
      const allowed = ctx.indexer.rowFilter();
      const rows = ctx.db.prepare("SELECT root, rel FROM files").all() as Array<{
        root: string;
        rel: string;
      }>;
      expect(body.totalFiles).toBe(rows.filter((r) => allowed(r)).length);
    } finally {
      restore();
      for (const id of [staleId, logsId, secretId]) ctx.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    }
  });

  it("C14 related answers 404 for an excluded id and for a missing one; an allowed id lists no excluded file", async () => {
    const dir = area();
    const a = put(path.join(dir, "a14.md"), "# A\n\n[[Oculta14]] e [[Visivel14]]\n");
    const hidden = put(path.join(dir, "privado14", "oculta14.md"), "# O\n");
    const visible = put(path.join(dir, "visivel14.md"), "# V\n");
    await ctx.indexer.indexAllAsync();
    const restore = exclude("privado14");
    try {
      const refused = await get(`/api/memory/related?id=${idOf(hidden)}`);
      expect(refused.statusCode).toBe(404);
      expect((refused.json() as { error: { code: string } }).error.code).toBe("not_found");
      const missing = await get("/api/memory/related?id=987654");
      expect(missing.statusCode).toBe(404);
      expect((missing.json() as { error: { code: string } }).error.code).toBe("not_found");
      const ok = await get(`/api/memory/related?id=${idOf(a)}`);
      expect(ok.statusCode).toBe(200);
      const paths = (ok.json() as Array<{ file: { path: string } }>).map((r) => r.file.path);
      expect(paths).toContain(visible);
      expect(paths).not.toContain(hidden);
      // at its own layer: null for a refused id and for a missing one, no refused file for an allowed one
      const allow = ctx.indexer.rowFilter();
      expect(relatedFiles(ctx.db, idOf(hidden), allow)).toBeNull();
      expect(relatedFiles(ctx.db, 987654, allow)).toBeNull();
      expect(relatedFiles(ctx.db, idOf(a), allow)!.map((r) => r.file.path)).not.toContain(hidden);
    } finally {
      restore();
    }
  });

  it("C15 with the 20 best matches excluded the search still fills its page in the order the matches had", async () => {
    const dir = area();
    // the excluded files hold the word many times (best BM25), the allowed ones once
    for (let i = 0; i < 20; i++)
      put(path.join(dir, "privado15", `forte${i}.md`), `# forte\n\n${"jabuticaba15 ".repeat(30)}\n`);
    for (let i = 0; i < 10; i++)
      put(path.join(dir, `fraca${i}.md`), `# fraca ${i}\n\njabuticaba15 ${"palavra ".repeat(i * 5)}\n`);
    await ctx.indexer.indexAllAsync();
    const unfiltered = await searchNames("jabuticaba15", 200);
    const restore = exclude("privado15");
    try {
      const page = await searchNames("jabuticaba15", 8);
      expect(page).toHaveLength(8);
      expect(page.every((n) => n.startsWith("fraca"))).toBe(true);
      expect(page).toEqual(unfiltered.filter((n) => n.startsWith("fraca")).slice(0, 8));
      for (let i = 5; i < 10; i++) fs.rmSync(path.join(dir, `fraca${i}.md`));
      await ctx.indexer.indexAllAsync();
      expect(await searchNames("jabuticaba15", 8)).toHaveLength(5);
    } finally {
      restore();
    }
  });

  it("C16 the empty query lists the most recent allowed rows, the excluded ones skipped before the cut", async () => {
    const now = Date.now() + 2e9;
    const insert = ctx.db.prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES (?, ?, ?, ?, '.md', ?, NULL, 1, ?, 1, NULL, '[]')",
    );
    const root = temp.paths.memory;
    const ids: number[] = [];
    // the six most recent are a secret name, a row of the home's config/ and four of an excluded folder
    const rows: Array<[string, number]> = [
      ["chave16.pem", now + 12],
      ["../config/c16.md", now + 11],
      ...[0, 1, 2, 3].map((i): [string, number] => [`privado16/p${i}.md`, now + 10 - i]),
      ...[0, 1, 2, 3, 4, 5].map((i): [string, number] => [`livre16/l${i}.md`, now + 5 - i]),
    ];
    for (const [rel, mtime] of rows) {
      const full = path.join(root, rel);
      ids.push(
        Number(insert.run(root, full, rel, path.basename(rel), path.dirname(full), mtime).lastInsertRowid),
      );
    }
    const restore = exclude("privado16");
    try {
      expect(await searchNames("", 4)).toEqual(["l0.md", "l1.md", "l2.md", "l3.md"]);
    } finally {
      restore();
      for (const id of ids) ctx.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    }
  });
});

describe("S3 a question in words finds notes", () => {
  it("C17 the stopwords of a question are not searched and a note with some of the words is found", async () => {
    const dir = area();
    put(path.join(dir, "verba17.md"), "# Verba\n\nO orçamento17 do trimestre foi fechado em março.\n");
    // a note made only of the question's stopwords: found only if the stopwords were searched
    put(path.join(dir, "vazia17.md"), "o que sobre o que sobre\n");
    await ctx.indexer.indexAllAsync();
    const names = await searchNames("o que decidimos sobre o orçamento17");
    expect(names).toContain("verba17.md");
    expect(names).not.toContain("vazia17.md");
    const own = searchFiles(ctx.db, { query: "o que decidimos sobre o orçamento17" }).map((h) => h.name);
    expect(own[0]).toBe("verba17.md");
    expect(own).not.toContain("vazia17.md");
    // the question as typed, every word required, finds nothing
    expect(strictWordsSearch(ctx.db, { query: "o que decidimos sobre o orçamento17" })).toEqual([]);
  });

  it("C18 the notes with every word come before the notes with only some", async () => {
    const dir = area();
    put(path.join(dir, "todas18.md"), "# t\n\ngoiaba18 caju18 pitanga18\n");
    put(path.join(dir, "duas18.md"), `# d\n\n${"goiaba18 caju18 ".repeat(20)}\n`);
    put(path.join(dir, "uma18.md"), `# u\n\n${"goiaba18 ".repeat(40)}\n`);
    await ctx.indexer.indexAllAsync();
    const names = await searchNames("goiaba18 caju18 pitanga18");
    expect(names[0]).toBe("todas18.md");
    expect([...names.slice(1)].sort()).toEqual(["duas18.md", "uma18.md"]);
    // at its own layer, the same order: every word, then more words
    expect(searchFiles(ctx.db, { query: "goiaba18 caju18 pitanga18" }).map((h) => h.name)).toEqual([
      "todas18.md",
      "duas18.md",
      "uma18.md",
    ]);
  });

  it("C19 with no note holding every word, more words come first, then BM25", async () => {
    const dir = area();
    put(path.join(dir, "tres19.md"), "# a\n\nmanga19 kiwi19 lima19 e mais texto aqui para alongar\n");
    put(path.join(dir, "duas19a.md"), "# b\n\nmanga19 kiwi19\n");
    put(
      path.join(dir, "duas19b.md"),
      "# c\n\nmanga19 kiwi19 e um texto bem mais longo que o outro, para o bm25 o deixar atrás\n",
    );
    put(path.join(dir, "uma19.md"), `# d\n\n${"manga19 ".repeat(50)}\n`);
    await ctx.indexer.indexAllAsync();
    // nobody holds the fourth word
    const names = await searchNames("manga19 kiwi19 lima19 melancia19");
    expect(names).toEqual(["tres19.md", "duas19a.md", "duas19b.md", "uma19.md"]);
    expect(searchFiles(ctx.db, { query: "manga19 kiwi19 lima19 melancia19" }).map((h) => h.name)).toEqual(
      names,
    );
  });

  it("C20 with the semantic search off the words find the expected note in the first three for at least 11 of 12 questions", async () => {
    const home = makeTempHome("mordomo-corpus-");
    const local = new AppContext(home.paths.home);
    try {
      const dir = path.join(home.paths.memory, "corpus");
      for (const note of corpus.notes) put(path.join(dir, `${note.name}.md`), note.text);
      await local.indexer.indexAllAsync();
      const server = await buildServer(local);
      try {
        let found = 0;
        for (const q of corpus.questions) {
          const res = await server.inject({
            url: `/api/memory/search?q=${encodeURIComponent(q.q)}&limit=10`,
            headers: { "x-mordomo-token": local.token() },
          });
          expect(res.statusCode).toBe(200);
          const names = (res.json() as Array<{ name: string }>).map((h) => h.name.replace(/\.md$/, ""));
          if (names.slice(0, 3).includes(q.expected)) found++;
        }
        expect(corpus.questions).toHaveLength(12);
        expect(found).toBeGreaterThanOrEqual(11);
      } finally {
        await server.close();
      }
    } finally {
      local.close();
      home.cleanup();
    }
  });

  it("C21 a question of stopwords is searched as typed; one of punctuation only is the listing of the most recent files", async () => {
    const dir = area();
    put(path.join(dir, "frase21.md"), "# Frase\n\nsobre entre\n");
    put(path.join(dir, "metade21.md"), "# Metade\n\nsobre apenas\n");
    await ctx.indexer.indexAllAsync();
    // only stopwords: every word as typed is required, so the note with one of them is not an answer
    const strict = await searchNames("sobre entre");
    expect(strict).toContain("frase21.md");
    expect(strict).not.toContain("metade21.md");
    expect(searchFiles(ctx.db, { query: "sobre entre" }).map((h) => h.name)).toEqual(strict);
    const punctuation = await get("/api/memory/search?q=%3F!&limit=5");
    expect(punctuation.statusCode).toBe(200);
    const recent = await get("/api/memory/search?q=&limit=5");
    expect(punctuation.json()).toEqual(recent.json());
  });

  it("C22 every answer holds a file once, in text and in auto with the hash provider; semantic is 409 off and vectors only on", async () => {
    const dir = area();
    put(path.join(dir, "repete22.md"), "# repete22\n\nameixa22 pera22 ameixa22 pera22 uva22\n");
    put(path.join(dir, "outra22.md"), "# outra\n\nameixa22\n");
    await ctx.indexer.indexAllAsync();
    const once = (ids: number[]) => expect(new Set(ids).size).toBe(ids.length);
    // a file that holds every word is also a match of the "any word" query: it is still listed once
    const both = await get(`/api/memory/search?q=${encodeURIComponent("ameixa22 pera22")}&limit=50`);
    const bothIds = (both.json() as Array<{ id: number; name: string }>).map((h) => h.id);
    expect(bothIds.length).toBe(2);
    once(bothIds);
    once(searchFiles(ctx.db, { query: "ameixa22 pera22", limit: 50 }).map((h) => h.id));
    const ids = async (mode: string) =>
      (
        (
          await get(`/api/memory/search?q=${encodeURIComponent("ameixa22 pera22 jaca22")}&mode=${mode}`)
        ).json() as Array<{
          id: number;
        }>
      ).map((h) => h.id);
    once(await ids("text"));
    const off = await get("/api/memory/search?q=ameixa22&mode=semantic");
    expect(off.statusCode).toBe(409);
    expect((off.json() as { error: { code: string } }).error.code).toBe("semantic_disabled");

    const settings = ctx.settings();
    settings.memory.embeddings = { ...settings.memory.embeddings, enabled: true, provider: "hash" };
    ctx.settingsStore.save(settings);
    try {
      await ctx.indexer.indexAllAsync();
      const auto = await ids("auto");
      expect(auto.length).toBeGreaterThan(0);
      once(auto);
      const semantic = (await get("/api/memory/search?q=ameixa22&mode=semantic")).json() as Array<{
        id: number;
        via: string;
      }>;
      expect(semantic.length).toBeGreaterThan(0);
      expect(new Set(semantic.map((h) => h.via))).toEqual(new Set(["semantic"]));
      once(semantic.map((h) => h.id));
    } finally {
      const back = ctx.settings();
      back.memory.embeddings = { ...back.memory.embeddings, enabled: false };
      ctx.settingsStore.save(back);
    }
  });
});

describe("S5 the routers follow the index", () => {
  const router = () => path.join(temp.paths.memory, "ROUTER.md");
  const finished = () =>
    new Promise<void>((resolve) => {
      const off = on(ctx.events, "index.finished", () => {
        off();
        resolve();
      });
    });

  it("C27 a pass of the route and one of the sentinel rewrite ROUTER.md before index.finished; a pass with no change writes none", async () => {
    const { appendJournal } = await import("../core/src/memory/journal.js");
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    let atFinish = "";
    const off = on(ctx.events, "index.finished", () => {
      atFinish = fs.readFileSync(router(), "utf8");
    });
    try {
      // today's journal is in the router: a new line in it is a change the routers must follow
      const first = `marcador27-rota-${seq}`;
      appendJournal(ctx.paths, { text: first, section: "Today" });
      const res = await app.inject({ method: "POST", url: "/api/memory/index", headers: owner() });
      expect(res.statusCode, res.body).toBe(200);
      expect(atFinish).toContain(first);

      // the sentinel's pass
      const second = `marcador27-sentinela-${seq}`;
      const day = appendJournal(ctx.paths, { text: second, section: "Today" });
      const sentinel = new FsWatchSentinel({
        bus: ctx.events,
        getSettings: () => ctx.settings(),
        indexer: ctx.indexer,
      });
      const done = finished();
      (sentinel as unknown as { record(root: string, rel: string): void }).record(
        temp.paths.memory,
        path.relative(temp.paths.memory, day.path),
      );
      sentinel.flush(temp.paths.memory);
      await done;
      sentinel.stop();
      expect(atFinish).toContain(second);

      // the rewritten router is itself a change for one more pass: the passes settle within three, and after that a
      // pass with no change writes nothing
      const changes = async () => {
        const body = (
          await app.inject({ method: "POST", url: "/api/memory/index", headers: owner() })
        ).json() as {
          stats: { added: number; updated: number; removed: number };
        };
        return body.stats.added + body.stats.updated + body.stats.removed;
      };
      let settledAfter = 0;
      while ((await changes()) > 0) expect(++settledAfter).toBeLessThan(3);
      const quiet = fs.statSync(router()).mtimeMs;
      expect(await changes()).toBe(0);
      expect(fs.statSync(router()).mtimeMs).toBe(quiet);
    } finally {
      off();
    }
  });

  it("C27 in the worker (the installed service's path): a pass that changed a file rewrites ROUTER.md before index.finished", async () => {
    const { appendJournal } = await import("../core/src/memory/journal.js");
    const script = await bundleIndexWorker();
    const home = makeTempHome("mordomo-c27-worker-");
    const local = new AppContext(home.paths.home);
    try {
      put(path.join(home.paths.memory, "notes", "uma27w.md"), "# Uma\n");
      await local.indexer.indexAllAsync();
      generateRouters(local.db, local.paths, local.settings());
      local.indexer.attachRunner(
        new IndexWorkerHost({
          paths: local.paths,
          db: local.db,
          bus: local.events,
          getSettings: () => local.settings(),
          indexer: local.indexer,
          workerEntry: script,
        }),
      );
      const marker = "marcador27-worker";
      appendJournal(local.paths, { text: marker, section: "Today" });
      let atFinish = "";
      let mode = "";
      const off = local.events.subscribe((event) => {
        if (event.type === "index.started") mode = (event.payload as { mode: string }).mode;
        if (event.type === "index.finished")
          atFinish = fs.readFileSync(path.join(home.paths.memory, "ROUTER.md"), "utf8");
      });
      try {
        await local.indexer.indexAllAsync();
      } finally {
        off();
      }
      expect(mode).toBe("worker");
      expect(atFinish).toContain(marker);
    } finally {
      local.close();
      home.cleanup();
    }
  }, 120_000);

  it("C27 on a home with no routers yet a pass that changed files creates none", async () => {
    const home = makeTempHome("mordomo-c27-fresh-");
    const local = new AppContext(home.paths.home);
    try {
      put(path.join(home.paths.memory, "notes", "uma27f.md"), "# Uma\n");
      const stats = await local.indexer.indexAllAsync();
      expect(stats.added).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(home.paths.memory, "ROUTER.md"))).toBe(false);
      expect(fs.existsSync(path.join(home.paths.memory, "areas"))).toBe(false);
    } finally {
      local.close();
      home.cleanup();
    }
  });

  it("C28 a regeneration with nothing changed keeps every router file's mtime and inode", () => {
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    const files = [
      router(),
      ...fs
        .readdirSync(path.join(temp.paths.memory, "areas"))
        .map((f) => path.join(temp.paths.memory, "areas", f)),
    ];
    const before = files.map((f) => fs.statSync(f)).map((s) => [s.mtimeMs, s.ino]);
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    expect(files.map((f) => fs.statSync(f)).map((s) => [s.mtimeMs, s.ino])).toEqual(before);
  });

  it("C29 with the watcher on memory/ one edit gives at most two passes and the second writes no router", async () => {
    const home = makeTempHome("mordomo-watch-");
    const local = new AppContext(home.paths.home);
    const settings = local.settings();
    settings.indexedFolders = [{ path: home.paths.memory, area: null, enabled: true }];
    settings.sentinels.fsWatch = { ...settings.sentinels.fsWatch, enabled: true, debounceMs: 1000 };
    local.settingsStore.save(settings);
    const note = put(path.join(home.paths.memory, "notes", "vigiada29.md"), "# Vigiada\n");
    await local.indexer.indexAllAsync();
    generateRouters(local.db, local.paths, local.settings());
    await local.indexer.indexAllAsync();
    let passes = 0;
    const routerWrites: number[] = [];
    const off = on(local.events, "index.finished", () => {
      passes++;
      routerWrites.push(fs.statSync(path.join(home.paths.memory, "ROUTER.md")).mtimeMs);
    });
    const sentinel = new FsWatchSentinel({
      bus: local.events,
      getSettings: () => local.settings(),
      indexer: local.indexer,
    });
    try {
      sentinel.start();
      expect(sentinel.watched()).toEqual([home.paths.memory]);
      await new Promise((r) => setTimeout(r, 100));
      fs.appendFileSync(note, "\numa linha nova\n");
      await new Promise((r) => setTimeout(r, 6000));
      expect(passes).toBeGreaterThanOrEqual(1);
      expect(passes).toBeLessThanOrEqual(2);
      if (passes === 2) expect(routerWrites[1]).toBe(routerWrites[0]);
      const settled = passes;
      await new Promise((r) => setTimeout(r, 3000));
      expect(passes).toBe(settled);
    } finally {
      off();
      sentinel.stop();
      local.close();
      home.cleanup();
    }
  }, 30_000);

  it("C30 a router that cannot be written fails neither the route nor the announcement, and is logged as routers_failed", async () => {
    const home = makeTempHome("mordomo-routers-fail-");
    const local = new AppContext(home.paths.home);
    const outside = makeTempHome("mordomo-outside-");
    try {
      const settings = local.settings();
      settings.setupCompleted = true;
      local.settingsStore.save(settings);
      put(path.join(home.paths.memory, "notes", "uma30.md"), "# Uma\n");
      await local.indexer.indexAllAsync();
      generateRouters(local.db, local.paths, local.settings());
      const target = path.join(outside.paths.home, "alvo.md");
      fs.writeFileSync(target, "fora\n");
      fs.rmSync(path.join(home.paths.memory, "ROUTER.md"));
      fs.symlinkSync(target, path.join(home.paths.memory, "ROUTER.md"));
      put(path.join(home.paths.memory, "notes", "duas30.md"), "# Duas\n");
      let announced = false;
      const off = on(local.events, "index.finished", () => {
        announced = true;
      });
      const server = await buildServer(local);
      try {
        const res = await server.inject({
          method: "POST",
          url: "/api/memory/index",
          headers: { "x-mordomo-token": local.token() },
        });
        expect(res.statusCode, res.body).toBe(200);
        expect((res.json() as { stats: { added: number } }).stats.added).toBeGreaterThan(0);
        expect(announced).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe("fora\n");
        const log = fs.readFileSync(path.join(home.paths.logs, "memory.jsonl"), "utf8").trim().split("\n");
        expect(log.filter((l) => JSON.parse(l).code === "routers_failed")).toHaveLength(1);
      } finally {
        off();
        await server.close();
      }
    } finally {
      local.close();
      home.cleanup();
      outside.cleanup();
    }
  });
});

describe("cross-cutting", () => {
  it("C32 the OpenAPI document gives related a 404 and the graph the wikilink kind", () => {
    const doc = openApiDocument(API) as unknown as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    expect(Object.keys(doc.paths["/api/v1/memory/related"]!.get!.responses)).toContain("404");
    expect(JSON.stringify(doc.paths["/api/v1/memory/graph"]!.get!.responses["200"])).toContain('"wikilink"');
    expect(JSON.stringify(doc.paths["/api/v1/memory/graph"]!.get!.responses["200"])).not.toContain(
      '"same-area"',
    );
  });

  it("C34 the inline indexer and the worker write the same note_links and no file_links for the same tree", async () => {
    const script = await bundleIndexWorker();
    const run = async (useWorker: boolean): Promise<unknown[]> => {
      const home = makeTempHome("mordomo-c34-");
      const local = new AppContext(home.paths.home);
      try {
        const dir = path.join(home.paths.memory, "arvore");
        put(path.join(dir, "a.md"), "# A\n\n[[B]] e [c](./c.md#x)\n\n```\n[[Nao]]\n```\n");
        put(path.join(dir, "b.md"), "# B\n\n[[A|volta]]\n");
        put(path.join(dir, "c.md"), "# C\n");
        if (useWorker) {
          local.indexer.attachRunner(
            new IndexWorkerHost({
              paths: local.paths,
              db: local.db,
              bus: local.events,
              getSettings: () => local.settings(),
              indexer: local.indexer,
              workerEntry: script,
            }),
          );
        }
        await local.indexer.indexAllAsync();
        expect(
          local.db.prepare("SELECT name FROM sqlite_master WHERE name = 'file_links'").get(),
        ).toBeUndefined();
        return local.db
          .prepare(
            "SELECT f.rel AS src, n.kind, n.target, n.label, n.line FROM note_links n JOIN files f ON f.id = n.src_id ORDER BY f.rel, n.line, n.target",
          )
          .all()
          .map((row) => {
            const r = row as { target: string };
            return {
              ...r,
              target: r.target.startsWith(home.paths.home)
                ? path.relative(home.paths.home, r.target)
                : r.target,
            };
          });
      } finally {
        local.close();
        home.cleanup();
      }
    };
    const inline = await run(false);
    const worker = await run(true);
    expect(inline.length).toBe(3);
    expect(worker).toEqual(inline);
  }, 120_000);
});

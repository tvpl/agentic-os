import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MemoryIndexer,
  SettingsStore,
  openDb,
  searchFiles,
  listFacets,
  buildGraph,
  relatedFiles,
  previewFile,
  generateRouters,
  checkRouters,
  resolveOpenablePath,
  PathAccessError,
  events,
  type Db,
  type MordomoPaths,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

let ctx: { paths: MordomoPaths; cleanup: () => void };
let db: Db;
let store: SettingsStore;
let workspace: string;

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  store = new SettingsStore(ctx.paths);
  workspace = path.join(ctx.paths.home, "workspace");
  fs.mkdirSync(path.join(workspace, "finance"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "finance", "budget-2026.md"),
    "# Budget 2026\n\nQuarterly budget planning #finance\n\nSee [notes](../notes.md).\n",
  );
  fs.writeFileSync(path.join(workspace, "notes.md"), "# Notes\n\nGeneral notes about projects.\n");
  fs.writeFileSync(path.join(workspace, ".env"), "SECRET_TOKEN=supersecret123\n");
  fs.writeFileSync(path.join(workspace, "node_modules", "junk", "index.js"), "module.exports = 1;\n");
  store.update({
    indexedFolders: [{ path: workspace, area: "Finanças", enabled: true }],
    areas: ["Worker", "Documentos", "Finanças", "Projetos"],
  });
});

afterEach(() => {
  db.close();
  ctx.cleanup();
});

describe("memory indexer", () => {
  it("indexes real files, honours exclusions and never reads secrets", () => {
    const indexer = new MemoryIndexer(db, () => store.load());
    const stats = indexer.indexAll();
    expect(stats.added).toBe(2); // budget + notes; .env and node_modules excluded
    expect(stats.skippedExcluded).toBeGreaterThan(0);

    const rows = db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;
    expect(rows.some((r) => r.path.endsWith(".env"))).toBe(false);
    expect(rows.some((r) => r.path.includes("node_modules"))).toBe(false);

    // FTS must not contain the secret value either
    const leak = db
      .prepare("SELECT COUNT(*) c FROM files_fts WHERE files_fts MATCH ?")
      .get('"supersecret123"') as { c: number };
    expect(leak.c).toBe(0);
  });

  it("is incremental: unchanged files are not re-added", () => {
    const indexer = new MemoryIndexer(db, () => store.load());
    indexer.indexAll();
    const second = indexer.indexAll();
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);

    fs.appendFileSync(path.join(workspace, "notes.md"), "\nMore content here.\n");
    const third = indexer.indexAll();
    expect(third.updated).toBe(1);
  });

  it("removes deleted files from the index", () => {
    const indexer = new MemoryIndexer(db, () => store.load());
    indexer.indexAll();
    fs.unlinkSync(path.join(workspace, "notes.md"));
    const stats = indexer.indexAll();
    expect(stats.removed).toBe(1);
  });

  it("never reads hard-blocked directories even when the excludes list allows them", () => {
    fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n");
    fs.mkdirSync(path.join(workspace, ".aws"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".aws", "credentials"), "[default]\naws_access_key_id = AKIAAAAAAAAAAAAAAAAA\n");
    store.update({ excludes: [] });
    new MemoryIndexer(db, () => store.load()).indexAll();
    const rows = db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;
    expect(rows.some((r) => r.path.includes(`${path.sep}.git${path.sep}`))).toBe(false);
    expect(rows.some((r) => r.path.includes(`${path.sep}.aws${path.sep}`))).toBe(false);
    expect(rows.some((r) => r.path.includes("node_modules"))).toBe(false);
  });

  it("detects binary content by bytes, not by extension", () => {
    const bin = Buffer.alloc(64);
    bin.write("looks like text at first");
    bin[40] = 0; // NUL inside the first 8 KiB
    fs.writeFileSync(path.join(workspace, "blob.txt"), bin);
    const stats = new MemoryIndexer(db, () => store.load()).indexAll();
    expect(stats.skippedBinary).toBe(1);
    const row = db.prepare("SELECT id FROM files WHERE name = 'blob.txt'").get() as { id: number };
    expect(row).toBeTruthy(); // the file is listed, its bytes are not indexed
    const hit = db
      .prepare("SELECT COUNT(*) c FROM files_fts WHERE files_fts MATCH ?")
      .get('"looks like text"') as { c: number };
    expect(hit.c).toBe(0);
  });

  it("keeps markdown links incremental: added later, restored after delete, dropped on edit", () => {
    const indexer = new MemoryIndexer(db, () => store.load());
    fs.writeFileSync(path.join(workspace, "hub.md"), "# Hub\n\n[later](./later.md) and [notes](./notes.md)\n");
    indexer.indexAll();
    const idOf = (name: string) =>
      (db.prepare("SELECT id FROM files WHERE name = ?").get(name) as { id: number } | undefined)?.id;
    const linkCount = (src: number, dst: number) =>
      (db.prepare("SELECT COUNT(*) c FROM file_links WHERE src_id = ? AND dst_id = ? AND kind = 'markdown-link'").get(src, dst) as { c: number }).c;
    const hub = idOf("hub.md")!;
    expect(linkCount(hub, idOf("notes.md")!)).toBe(1);

    // Target appears later without touching hub.md: the pending link resolves.
    fs.writeFileSync(path.join(workspace, "later.md"), "# Later\n");
    const s2 = indexer.indexAll();
    expect(s2.updated).toBe(0);
    expect(linkCount(hub, idOf("later.md")!)).toBe(1);

    // Target deleted then restored: the edge comes back even though hub.md is unchanged.
    fs.unlinkSync(path.join(workspace, "later.md"));
    indexer.indexAll();
    fs.writeFileSync(path.join(workspace, "later.md"), "# Later again\n");
    indexer.indexAll();
    expect(linkCount(hub, idOf("later.md")!)).toBe(1);

    // Editing the source drops links it no longer has.
    fs.writeFileSync(path.join(workspace, "hub.md"), "# Hub\n\nonly [notes](./notes.md) now\n");
    indexer.indexAll();
    expect(linkCount(hub, idOf("later.md")!)).toBe(0);
    expect(linkCount(hub, idOf("notes.md")!)).toBe(1);
  });

  it("gives nested roots to the longest root deterministically", () => {
    const nested = path.join(workspace, "finance");
    store.update({
      indexedFolders: [
        { path: workspace, area: "Documentos", enabled: true },
        { path: nested, area: "Finanças", enabled: true },
      ],
    });
    const indexer = new MemoryIndexer(db, () => store.load());
    indexer.indexAll();
    const budget = db.prepare("SELECT root, area, rel FROM files WHERE name = 'budget-2026.md'").get() as {
      root: string; area: string; rel: string;
    };
    expect(budget.root).toBe(nested);
    expect(budget.area).toBe("Finanças");
    expect(budget.rel).toBe("budget-2026.md");
    expect(indexer.indexAll().updated).toBe(0);

    // Disabling the nested root hands the file back to the parent (root/area/rel updated).
    store.update({
      indexedFolders: [
        { path: workspace, area: "Documentos", enabled: true },
        { path: nested, area: "Finanças", enabled: false },
      ],
    });
    expect(indexer.indexAll().updated).toBe(1);
    const again = db.prepare("SELECT root, area FROM files WHERE name = 'budget-2026.md'").get() as { root: string; area: string };
    expect(again.root).toBe(workspace);
    expect(again.area).toBe("Documentos");
  });

  it("indexAllAsync yields between chunks and emits progress/finished events", async () => {
    for (let i = 0; i < 450; i++) fs.writeFileSync(path.join(workspace, `n${i}.txt`), `note ${i}`);
    const indexer = new MemoryIndexer(db, () => store.load());
    const seen: string[] = [];
    const unsubscribe = events.subscribe((e) => {
      if (e.type === "index.progress" || e.type === "index.finished") seen.push(e.type);
    });
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 0);
    const callbacks: number[] = [];
    try {
      const first = indexer.indexAllAsync((p) => callbacks.push(p.scanned));
      expect(indexer.indexAllAsync()).toBe(first); // concurrent callers share the run
      const stats = await first;
      expect(stats.added).toBe(452);
    } finally {
      clearInterval(ticker);
      unsubscribe();
    }
    expect(ticks).toBeGreaterThan(0); // the event loop got turns during indexing
    expect(callbacks.length).toBeGreaterThanOrEqual(3);
    expect(seen.filter((t) => t === "index.progress").length).toBeGreaterThanOrEqual(3);
    expect(seen[seen.length - 1]).toBe("index.finished");
    expect(indexer.isIndexing()).toBe(false);
    expect(indexer.lastIndex()?.stats.added).toBe(452);
  });
});

describe("search", () => {
  it("finds a real file by content with a snippet", () => {
    new MemoryIndexer(db, () => store.load()).indexAll();
    const hits = searchFiles(db, { query: "quarterly budget" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.name).toBe("budget-2026.md");
    expect(hits[0]!.snippet).toContain("mark");
    // FTS syntax injection must not throw
    expect(() => searchFiles(db, { query: 'NEAR( "a" OR' })).not.toThrow();
  });

  it("filters by area and extension and lists facets", () => {
    new MemoryIndexer(db, () => store.load()).indexAll();
    expect(searchFiles(db, { query: "", area: "Finanças" }).length).toBe(2);
    expect(searchFiles(db, { query: "", ext: "md" }).length).toBe(2);
    const facets = listFacets(db);
    expect(facets.total).toBe(2);
    expect(facets.areas[0]!.area).toBe("Finanças");
    expect(facets.tags.some((t) => t.tag === "finance")).toBe(true);
  });
});

describe("graph and relations", () => {
  it("builds nodes/edges including markdown links with explanations", () => {
    new MemoryIndexer(db, () => store.load()).indexAll();
    const graph = buildGraph(db, {});
    expect(graph.nodes.length).toBe(2);
    const linkEdge = graph.edges.find((e) => e.kind === "markdown-link");
    expect(linkEdge).toBeTruthy();
    expect(linkEdge!.why).toContain("markdown link");

    const budget = graph.nodes.find((n) => n.name === "budget-2026.md")!;
    const related = relatedFiles(db, budget.id);
    expect(related.some((r) => r.file.name === "notes.md")).toBe(true);
  });

  it("caps nodes before building edges and stays fast on 1500 files", () => {
    const insert = db.prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]')",
    );
    const link = db.prepare("INSERT OR IGNORE INTO file_links (src_id, dst_id, kind) VALUES (?, ?, 'markdown-link')");
    db.transaction(() => {
      for (let i = 0; i < 1500; i++) {
        const dir = path.join(workspace, `d${i % 30}`);
        const p = path.join(dir, `f${i}.md`);
        const info = insert.run(workspace, p, path.relative(workspace, p), `f${i}.md`, ".md", dir, "Finanças", 10, i, i);
        const id = Number(info.lastInsertRowid);
        if (id > 1) link.run(id, id - 1);
      }
    })();
    const started = performance.now();
    const graph = buildGraph(db, { maxNodes: 4000 });
    const elapsed = performance.now() - started;
    expect(graph.nodes.length).toBe(1500);
    expect(graph.edges.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(500);

    const capped = buildGraph(db, { maxNodes: 100 });
    expect(capped.nodes.length).toBe(100);
    expect(capped.truncated).toBe(true);
    const ids = new Set(capped.nodes.map((n) => n.id));
    expect(capped.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});

describe("preview", () => {
  it("previews text files and blocks secret files", () => {
    const settings = store.load();
    const ok = previewFile(settings, [], path.join(workspace, "notes.md"));
    expect(ok.kind).toBe("text");
    expect(ok.content).toContain("General notes");

    const blocked = previewFile(settings, [], path.join(workspace, ".env"));
    expect(blocked.kind).toBe("blocked");
    expect(blocked.content).toBeNull();

    expect(() => previewFile(settings, [], "/etc/passwd")).toThrow();
  });

  it("refuses hard-blocked directories and settings excludes inside an indexed root", () => {
    fs.mkdirSync(path.join(workspace, ".git"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".git", "config"), "[core]\n");
    fs.mkdirSync(path.join(workspace, ".aws"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".aws", "credentials"), "[default]\n");
    fs.mkdirSync(path.join(workspace, "private"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "private", "diary.md"), "# Diary\n");
    store.update({ excludes: [] }); // even with an empty list the hard blocklist holds
    let settings = store.load();
    expect(previewFile(settings, [], path.join(workspace, ".git", "config")).kind).toBe("blocked");
    expect(previewFile(settings, [], path.join(workspace, ".aws", "credentials")).kind).toBe("blocked");
    expect(previewFile(settings, [], path.join(workspace, "node_modules", "junk", "index.js")).kind).toBe("blocked");
    expect(previewFile(settings, [], path.join(workspace, "private", "diary.md")).kind).toBe("text");

    store.update({ excludes: ["private"] });
    settings = store.load();
    expect(previewFile(settings, [], path.join(workspace, "private", "diary.md")).kind).toBe("blocked");
    expect(() => resolveOpenablePath(settings, [], path.join(workspace, "private", "diary.md"))).toThrow(PathAccessError);
    expect(() => resolveOpenablePath(settings, [], path.join(workspace, ".git", "config"))).toThrow(PathAccessError);
    expect(resolveOpenablePath(settings, [], path.join(workspace, "notes.md"))).toBe(fs.realpathSync(path.join(workspace, "notes.md")));
  });

  it("detects binary content by bytes and previews extension-less text", () => {
    const bin = Buffer.alloc(100, 0x41);
    bin[10] = 0;
    fs.writeFileSync(path.join(workspace, "fake.md"), bin);
    fs.writeFileSync(path.join(workspace, "Makefile"), "all:\n\techo hi\n");
    const settings = store.load();
    expect(previewFile(settings, [], path.join(workspace, "fake.md")).kind).toBe("binary");
    const mk = previewFile(settings, [], path.join(workspace, "Makefile"));
    expect(mk.kind).toBe("text");
    expect(mk.content).toContain("echo hi");
    expect(previewFile(settings, [], path.join(workspace, "notes.md")).kind).toBe("text");
  });
});

describe("routers", () => {
  it("generates master + area indexes and detects broken pointers", () => {
    new MemoryIndexer(db, () => store.load()).indexAll();
    const { written } = generateRouters(db, ctx.paths, store.load());
    expect(written.some((w) => w.endsWith("ROUTER.md"))).toBe(true);
    const master = fs.readFileSync(path.join(ctx.paths.memory, "ROUTER.md"), "utf8");
    expect(master).toContain("Finanças");
    const financas = fs.readFileSync(path.join(ctx.paths.memory, "areas", "financas.md"), "utf8");
    expect(financas).toContain("budget-2026.md");

    expect(checkRouters(db, ctx.paths, store.load()).length).toBe(0);

    fs.unlinkSync(path.join(workspace, "notes.md"));
    const issues = checkRouters(db, ctx.paths, store.load());
    expect(issues.some((i) => i.problem.includes("Broken pointer"))).toBe(true);
  });

  it("does not throw when memory/ or memory/areas is missing", () => {
    fs.rmSync(ctx.paths.memory, { recursive: true, force: true });
    expect(() => checkRouters(db, ctx.paths, store.load())).not.toThrow();
    expect(checkRouters(db, ctx.paths, store.load())[0]?.problem).toContain("Master router missing");
    expect(() => generateRouters(db, ctx.paths, store.load())).not.toThrow();
    fs.rmSync(path.join(ctx.paths.memory, "areas"), { recursive: true, force: true });
    const issues = checkRouters(db, ctx.paths, store.load());
    expect(issues.some((i) => i.problem.includes("Missing index"))).toBe(true);
  });
});

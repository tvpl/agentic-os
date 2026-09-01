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
});

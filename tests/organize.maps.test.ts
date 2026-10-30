import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, type RouteDefinition } from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { generateRouters } from "../core/src/memory/routers.js";
import { makeTempHome } from "./helpers.js";
import { buildWorld, SCENARIOS } from "./helpers/contractWorld.js";
import { organizeWorld, repoRoot, type Json, type OrganizeWorld } from "./helpers/organizeWorld.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";

/**
 * .specs/features/cerebro-organizar, batch B, S3 at the HTTP boundary: `GET /api/memory/maps` (the folders, the
 * digest of their children, the state and the place of their index note, who sees what), the front-matter keys that
 * enter `fields`, the two sections of `ROUTER.md`, and the route's place in the contract (C49). Each test is written
 * from its check in `checks.md`; the decisions themselves are also proven at their own layer in
 * `organize.layer.test.ts`.
 */

const POSIX = process.platform !== "win32";
const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
/** Door 4, computed here from the door's text. */
const digestOf = (names: string[]) => `sha256:${sha([...names].sort().join("\n"))}`;
/** Door 8, computed here from the door's text. */
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
  return `${name || "pasta"}-${sha(root).slice(0, 8)}`;
}
const ENTRY_KEYS = ["children", "digest", "index", "indexDigest", "indexPath", "path", "rel", "state"];

let w: OrganizeWorld;
let memory: string;
const roots: string[] = [];

beforeAll(async () => {
  w = await organizeWorld("mordomo-organize-maps-");
  memory = w.ctx.paths.memory;
});
afterAll(async () => {
  await w.close();
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A new indexed root of its own (a real path outside the home), so a test knows every folder in it. */
function freshRoot(name: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `mordomo-maps-${name}-`)));
  roots.push(root);
  w.update((s) => {
    s.indexedFolders = [...s.indexedFolders, { path: root, area: null, enabled: true }];
  });
  return root;
}
const index = () => w.ctx.indexer.indexAllAsync();
async function maps(query = "", headers?: Record<string, string>): Promise<Json[]> {
  const res = await w.call("GET", `/api/memory/maps${query}`, undefined, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.folders as Json[];
}
const byPath = (folders: Json[], p: string) => folders.find((f) => f.path === p);
/** A row of `files` as an index pass would have written it (a stale row, or more rows than a test wants to write). */
function row(root: string, rel: string): void {
  const full = path.join(root, rel);
  w.ctx.db
    .prepare(
      "INSERT OR IGNORE INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      1,
      1,
      null,
      "[]",
      "{}",
    );
}
const indexNote = (file: string, digest: string | null) =>
  w.put(
    file,
    [
      "---",
      "type: index",
      "status: active",
      ...(digest !== null ? [`children-digest: ${digest}`] : []),
      "generated-by: organize-brain",
      "---",
      "",
      "# Índice",
      "",
    ].join("\n"),
  );

describe.skipIf(!POSIX)("S3 the folder map", () => {
  it("C24 over a root with a.md, b.md, sub/c.md, sub/deep/d.md and an empty vazia/, the map of the root is the root (3), sub (2) and sub/deep (1), each with its eight fields; without root it also holds the folders of memory/notes/", async () => {
    const root = freshRoot("c24");
    w.put(path.join(root, "a.md"), "# A\n");
    w.put(path.join(root, "b.md"), "# B\n");
    w.put(path.join(root, "sub", "c.md"), "# C\n");
    w.put(path.join(root, "sub", "deep", "d.md"), "# D\n");
    fs.mkdirSync(path.join(root, "vazia"));
    const note = w.put(path.join(memory, "notes", "c24-projeto", "plano.md"), "# Plano\n");
    await index();

    const folders = await maps(`?root=${encodeURIComponent(root)}`);
    expect(folders.map((f) => [f.rel, f.children]).sort()).toEqual([
      ["", 3],
      ["sub", 2],
      ["sub/deep", 1],
    ]);
    expect(folders.map((f) => f.path).sort()).toEqual([
      root,
      path.join(root, "sub"),
      path.join(root, "sub", "deep"),
    ]);
    for (const f of folders) expect(Object.keys(f).sort(), f.path).toEqual(ENTRY_KEYS);

    const all = await maps();
    for (const p of [root, path.join(root, "sub"), path.join(root, "sub", "deep")])
      expect(byPath(all, p), p).toBeDefined();
    const notes = byPath(all, path.dirname(note));
    expect(notes).toMatchObject({ rel: "notes/c24-projeto", children: 1 });
    for (const f of all) expect(Object.keys(f).sort(), f.path).toEqual(ENTRY_KEYS);
    // Every folder is one of an indexed root or one under memory/notes/.
    const indexed = w.ctx.settings().indexedFolders.map((f) => f.path);
    for (const f of all) {
      const under = (base: string) => f.path === base || f.path.startsWith(base + path.sep);
      expect(indexed.some(under) || f.path.startsWith(path.join(memory, "notes") + path.sep), f.path).toBe(
        true,
      );
    }
  });

  it("C25 a folder of b.md, a.md, sub/, .oculto.md and _index.md has the digest of d:sub, f:a.md, f:b.md, the same on two calls", async () => {
    const root = freshRoot("c25");
    w.put(path.join(root, "b.md"), "# B\n");
    w.put(path.join(root, "a.md"), "# A\n");
    w.put(path.join(root, "sub", "x.md"), "# X\n");
    w.put(path.join(root, ".oculto.md"), "# oculto\n");
    w.put(path.join(root, "_index.md"), "# índice à mão\n");
    await index();
    // Whatever the walk made of the two names, the index knows them as rows of this folder.
    row(root, ".oculto.md");
    row(root, "_index.md");
    const expected = `sha256:${crypto.createHash("sha256").update("d:sub\nf:a.md\nf:b.md").digest("hex")}`;
    const first = byPath(await maps(`?root=${encodeURIComponent(root)}`), root)!;
    const second = byPath(await maps(`?root=${encodeURIComponent(root)}`), root)!;
    expect(first.digest).toBe(expected);
    expect(second.digest).toBe(expected);
    expect(first.children).toBe(3);
  });

  it("C26 a folder with no _index.md is missing, with index and indexDigest null, and its indexPath is in the folder under memory/notes/ and under memory/maps/<root slug>/ for a folder of the user", async () => {
    const root = freshRoot("C26 Pasta Raiz");
    w.put(path.join(root, "r.md"), "# R\n");
    w.put(path.join(root, "clientes", "acme", "c.md"), "# C\n");
    const note = w.put(path.join(memory, "notes", "c26-notas", "n.md"), "# N\n");
    await index();
    const all = await maps();
    const home = w.home;
    const expectMissing = (f: Json | undefined, indexPath: string) => {
      expect(f, indexPath).toBeDefined();
      expect(f).toMatchObject({ state: "missing", index: null, indexDigest: null, indexPath });
    };
    expectMissing(byPath(all, path.dirname(note)), path.join(path.dirname(note), "_index.md"));
    expectMissing(byPath(all, root), path.join(home, "memory", "maps", slugOf(root), "_index.md"));
    expectMissing(
      byPath(all, path.join(root, "clientes", "acme")),
      path.join(home, "memory", "maps", slugOf(root), "clientes", "acme", "_index.md"),
    );
    expect(byPath(all, path.join(root, "clientes"))!.rel).toBe("clientes");
  });

  it("C27 an _index.md at indexPath whose children-digest is the digest is fresh with index and indexDigest; another digest, and none, are stale", async () => {
    const root = freshRoot("c27");
    w.put(path.join(root, "certo", "a.md"), "# A\n");
    w.put(path.join(root, "errado", "b.md"), "# B\n");
    w.put(path.join(root, "sem", "c.md"), "# C\n");
    const notes = path.dirname(w.put(path.join(memory, "notes", "c27-notas", "n.md"), "# N\n"));
    await index();
    const before = await maps();
    const at = (p: string) => byPath(before, p)!;
    const right = at(path.join(root, "certo"));
    indexNote(right.indexPath, right.digest);
    indexNote(at(path.join(root, "errado")).indexPath, digestOf(["f:outro.md"]));
    indexNote(at(path.join(root, "sem")).indexPath, null);
    const inNotes = at(notes);
    expect(inNotes.indexPath).toBe(path.join(notes, "_index.md"));
    indexNote(inNotes.indexPath, inNotes.digest);

    const after = await maps();
    expect(byPath(after, path.join(root, "certo"))).toMatchObject({
      state: "fresh",
      index: right.indexPath,
      indexDigest: right.digest,
    });
    expect(byPath(after, path.join(root, "errado"))).toMatchObject({
      state: "stale",
      index: at(path.join(root, "errado")).indexPath,
      indexDigest: digestOf(["f:outro.md"]),
    });
    expect(byPath(after, path.join(root, "sem"))).toMatchObject({ state: "stale", indexDigest: null });
    expect(byPath(after, notes)).toMatchObject({
      state: "fresh",
      index: inNotes.indexPath,
      digest: inNotes.digest,
    });
  });

  it("C28 a file added to a fresh folder makes it stale after the pass; an edited child keeps it fresh with the same digest", async () => {
    const root = freshRoot("c28");
    const kept = w.put(path.join(root, "pasta", "um.md"), "# Um\n");
    await index();
    const start = byPath(await maps(`?root=${encodeURIComponent(root)}`), path.join(root, "pasta"))!;
    indexNote(start.indexPath, start.digest);
    expect(byPath(await maps(`?root=${encodeURIComponent(root)}`), path.join(root, "pasta"))!.state).toBe(
      "fresh",
    );

    fs.writeFileSync(kept, "# Um\n\nTexto novo, nenhum filho a mais.\n");
    await index();
    const edited = byPath(await maps(`?root=${encodeURIComponent(root)}`), path.join(root, "pasta"))!;
    expect(edited.state).toBe("fresh");
    expect(edited.digest).toBe(start.digest);

    w.put(path.join(root, "pasta", "dois.md"), "# Dois\n");
    await index();
    const grown = byPath(await maps(`?root=${encodeURIComponent(root)}`), path.join(root, "pasta"))!;
    expect(grown.state).toBe("stale");
    expect(grown.digest).toBe(digestOf(["f:um.md", "f:dois.md"]));
  });

  it("C29 an absolute root that is no indexed root is 404 not_found, relativo/pasta and ../x are 400 validation, and memory answers only folders under memory/notes/", async () => {
    const nowhere = w.dir("nao-indexada", w.outside);
    const unknown = await w.call("GET", `/api/memory/maps?root=${encodeURIComponent(nowhere)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");
    for (const bad of ["relativo/pasta", "../x"]) {
      const res = await w.call("GET", `/api/memory/maps?root=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code, bad).toBe("validation");
    }
    w.put(path.join(memory, "notes", "c29", "n.md"), "# N\n");
    await index();
    const mem = await maps("?root=memory");
    expect(byPath(mem, path.join(memory, "notes", "c29"))).toBeDefined();
    for (const f of mem) expect(f.path.startsWith(path.join(memory, "notes") + path.sep), f.path).toBe(true);
  });

  it("C30 a user-excluded folder, a secret-named folder and the home's config/ are no entries and are not counted in their parent's children or digest", async () => {
    const root = freshRoot("c30");
    w.put(path.join(root, "visivel.md"), "# V\n");
    w.put(path.join(root, "rascunhos", "r.md"), "# R\n");
    await index();
    // Excluded after the pass: the rows stay in the index until a full pass, and today's policy hides them.
    w.update((s) => {
      s.excludes = [...s.excludes, "rascunhos"];
    });
    row(root, path.join(".ssh", "id.md"));
    const hidden = await maps(`?root=${encodeURIComponent(root)}`);
    expect(hidden.map((f) => f.rel)).toEqual([""]);
    expect(byPath(hidden, root)).toMatchObject({ children: 1, digest: digestOf(["f:visivel.md"]) });

    // The home's config/, under a root that holds the home (a stale index of a folder granted before AD-011).
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: w.home, area: null, enabled: true }];
    });
    try {
      row(w.home, path.join("config", "segredo.md"));
      row(w.home, path.join("publica", "p.md"));
      const withHome = await maps(`?root=${encodeURIComponent(w.home)}`);
      expect(withHome.map((f) => f.rel).sort()).toEqual(["", "publica"]);
      expect(byPath(withHome, w.home)).toMatchObject({ children: 1, digest: digestOf(["d:publica"]) });
    } finally {
      w.update((s) => {
        s.indexedFolders = s.indexedFolders.filter((f) => f.path !== w.home);
        s.excludes = s.excludes.filter((e) => e !== "rascunhos");
      });
    }
  });

  it("C31 a run's credential sees memory/notes/ and its folder (or its context's ok paths) and gets 404 for another root; a content device sees every root, a monitor device 403 scope_required", async () => {
    const a = freshRoot("c31a");
    const b = freshRoot("c31b");
    w.put(path.join(a, "sub", "x.md"), "# X\n");
    w.put(path.join(a, "sub", "fundo", "y.md"), "# Y\n");
    w.put(path.join(a, "outra", "z.md"), "# Z\n");
    w.put(path.join(b, "b.md"), "# B\n");
    const notes = path.dirname(w.put(path.join(memory, "notes", "c31", "n.md"), "# N\n"));
    await index();
    const credential = (extra: Record<string, unknown>) => {
      const record = w.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "held open",
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 60_000,
        profile: "controlled_write",
        skillSlug: "organize-brain",
        startedBy: null,
        ...extra,
      } as never);
      return { "x-mordomo-token": w.ctx.runApiAccessFor(record, "write")!.token };
    };
    const sub = path.join(a, "sub");
    const folderRun = credential({
      request: {
        version: 1,
        kind: "skill",
        skillSlug: "organize-brain",
        inputs: { folder: sub },
        mode: "write",
      },
    });
    const seen = await maps("", folderRun);
    expect(seen.map((f) => f.path)).toEqual(expect.arrayContaining([notes, sub, path.join(sub, "fundo")]));
    for (const f of seen) {
      const ok =
        f.path.startsWith(path.join(memory, "notes") + path.sep) ||
        f.path === sub ||
        f.path.startsWith(sub + path.sep);
      expect(ok, f.path).toBe(true);
    }
    expect(byPath(await maps(`?root=${encodeURIComponent(sub)}`, folderRun), sub)).toBeDefined();
    const other = await w.call("GET", `/api/memory/maps?root=${encodeURIComponent(b)}`, undefined, folderRun);
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe("not_found");

    // A run of a context: its ok paths too.
    const id = `c31-contexto-${Date.now()}`;
    w.update((s) => {
      s.contexts = [...s.contexts, { id, name: "C31", paths: [b] }];
    });
    const contextRun = credential({
      contextId: id,
      request: { version: 1, kind: "skill", skillSlug: "organize-brain", inputs: {}, mode: "write" },
    });
    const inContext = await maps("", contextRun);
    expect(byPath(inContext, b)).toBeDefined();
    expect(byPath(inContext, notes)).toBeDefined();
    for (const f of inContext) {
      const ok =
        f.path.startsWith(path.join(memory, "notes") + path.sep) ||
        f.path === b ||
        f.path.startsWith(b + path.sep);
      expect(ok, f.path).toBe(true);
    }

    // Paired devices: content sees every root, monitor is refused.
    w.update((s) => {
      s.remote.enabled = true;
    });
    const device = (scopes: Array<"content" | "monitor">) => {
      const { code } = w.ctx.devices.startPairing("c31", scopes);
      return { "x-mordomo-token": w.ctx.devices.claim(code, "c31")!.token };
    };
    const everything = await maps("", device(["content"]));
    for (const p of [a, sub, path.join(a, "outra"), b, notes]) expect(byPath(everything, p), p).toBeDefined();
    const refused = await w.call("GET", "/api/memory/maps", undefined, device(["monitor"]));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("scope_required");
  });
});

describe.skipIf(!POSIX)("S3 the front matter in fields", () => {
  it("C33 the seven front-matter keys are in fields (query natureza:plano finds the file), an inline status:: draft wins, a value of 64 characters is kept and one of 65 is not", async () => {
    const dir = path.join(memory, "notes", "c33");
    const head = (extra: string[], body = "") =>
      [
        "---",
        "type: index",
        "status: active",
        "updated: 2026-10-29",
        "last_reviewed: 2026-10-29",
        "natureza: plano",
        ...extra,
        "---",
        "",
        "# Nota",
        "",
        body,
      ].join("\n");
    const v64 = "e".repeat(64);
    const plain = w.put(path.join(dir, "campos.md"), head(["escopo: equipe", "review_every: 90d"]));
    const inline = w.put(
      path.join(dir, "inline.md"),
      head(["escopo: equipe", "review_every: 90d"], "status:: draft\n"),
    );
    const long = w.put(path.join(dir, "longo.md"), head([`escopo: ${v64}`, `review_every: ${v64}x`]));
    await index();
    const res = await w.call("GET", "/api/memory/query?where=natureza:plano");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const files = res.body.files as Json[];
    const of = (p: string) => files.find((f) => f.path === p)?.fields as Record<string, string> | undefined;
    expect(of(plain)).toMatchObject({
      type: "index",
      status: "active",
      updated: "2026-10-29",
      last_reviewed: "2026-10-29",
      natureza: "plano",
      escopo: "equipe",
      review_every: "90d",
    });
    expect(of(inline)!.status).toBe("draft");
    expect(of(long)!.escopo).toBe(v64);
    expect(of(long)).not.toHaveProperty("review_every");
  });
});

describe.skipIf(!POSIX)("S3 the router", () => {
  it("C34 ROUTER.md lists each index note under Folder indexes and at most 20 missing or stale folders by children under Folders without an index; with none, both headings are absent", async () => {
    const root = freshRoot("c34");
    w.put(path.join(root, "fresca", "a.md"), "# A\n");
    w.put(path.join(root, "velha", "b.md"), "# B\n");
    await index();
    // 25 folders waiting for an index, with more children than any other folder of this home (101 to 125): rows
    // the index holds (written after the pass, which would drop rows of files it does not find).
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 101 + i; j++)
        row(root, path.join(`grande-${String(i).padStart(2, "0")}`, `f${j}.md`));
    }
    const before = await maps(`?root=${encodeURIComponent(root)}`);
    const fresh = byPath(before, path.join(root, "fresca"))!;
    const stale = byPath(before, path.join(root, "velha"))!;
    indexNote(fresh.indexPath, fresh.digest);
    indexNote(stale.indexPath, digestOf(["f:nada.md"]));

    generateRouters(w.ctx.db, w.ctx.paths, w.ctx.settings());
    const router = fs.readFileSync(path.join(memory, "ROUTER.md"), "utf8");
    const sectionOf = (heading: string) => {
      const lines = router.split("\n");
      const start = lines.indexOf(heading);
      expect(start, heading).toBeGreaterThanOrEqual(0);
      const end = lines.findIndex((l, i) => i > start && /^#{1,2} |^<!-- journal/.test(l));
      return lines.slice(start + 1, end === -1 ? undefined : end).filter((l) => l.startsWith("- "));
    };
    const indexes = sectionOf("## Folder indexes");
    const link = (file: string) => `(./${path.relative(memory, file).split(path.sep).join("/")})`;
    for (const f of [fresh, stale]) {
      const line = indexes.find((l) => l.includes(link(f.indexPath)));
      expect(line, f.path).toBeDefined();
      expect(line).toContain(f.path);
    }
    // Only index notes that exist are linked.
    expect(indexes.some((l) => l.includes(path.join(root, "grande-00")))).toBe(false);
    const waiting = sectionOf("## Folders without an index");
    expect(waiting).toHaveLength(20);
    const expected = Array.from({ length: 20 }, (_, k) =>
      path.join(root, `grande-${String(24 - k).padStart(2, "0")}`),
    );
    expect(waiting.map((l) => expected.findIndex((p) => l.includes(`\`${p}\``)))).toEqual(
      Array.from({ length: 20 }, (_, k) => k),
    );

    // A home with no folder at all: neither heading.
    const temp = makeTempHome("mordomo-organize-maps-empty-");
    const ctx = new AppContext(temp.paths.home);
    try {
      generateRouters(ctx.db, ctx.paths, ctx.settings());
      const empty = fs.readFileSync(path.join(ctx.paths.memory, "ROUTER.md"), "utf8");
      expect(empty).not.toContain("## Folder indexes");
      expect(empty).not.toContain("## Folders without an index");
    } finally {
      ctx.close();
      temp.cleanup();
    }
  });
});

describe("cross-cutting: the route in the contract", () => {
  it("C49 GET /api/memory/maps is in the API table, the document, EXPECTED_ROUTE_SCOPES, RUN_API_READ_ROUTES, the content row of docs/security.md and the refusal probe; skills.run declares the two folder errors", async () => {
    const entry = API["memory.maps" as keyof typeof API] as RouteDefinition | undefined;
    expect(entry).toBeDefined();
    expect(`${entry!.method} ${entry!.path}`).toBe("GET /api/memory/maps");
    expect(entry!.scope).toBe("content");
    const query = (entry!.query as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};
    expect(Object.keys(query)).toEqual(["root"]);
    expect(Object.keys(entry!.responses).map(Number)).toEqual([200]);
    const ok = (entry!.responses[200] as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
      folders: [
        {
          path: "/x",
          rel: "",
          children: 1,
          digest: `sha256:${"0".repeat(64)}`,
          index: null,
          indexDigest: null,
          state: "missing",
          indexPath: "/h/memory/maps/x-00000000/_index.md",
        },
      ],
    });
    expect(ok.success).toBe(true);
    const codes = (e: RouteDefinition) => (e.errors ?? []).map((x) => `${x.status} ${x.code}`);
    expect(codes(entry!)).toContain("404 not_found");
    expect(codes(API["skills.run"] as RouteDefinition)).toEqual(
      expect.arrayContaining(["400 folder_not_indexed", "409 folder_protection_unsupported"]),
    );
    expect(EXPECTED_ROUTE_SCOPES["GET /api/memory/maps"]).toBe("content");

    // RUN_API_READ_ROUTES: the set in the server's source holds the route.
    const server = fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "server.ts"), "utf8");
    const set = /const RUN_API_READ_ROUTES = new Set\(\[([\s\S]*?)\]\);/.exec(server)?.[1] ?? "";
    expect(set).toContain('"GET /api/memory/maps"');

    // docs/security.md: in the content row and in no other.
    const security = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const scopeRow = (scope: string) =>
      security.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    expect(scopeRow("content")).toContain("`GET /api/memory/maps`");
    for (const other of ["monitor", "run", "approve", "owner"])
      expect(scopeRow(other).includes("`GET /api/memory/maps`"), other).toBe(false);

    // The refusal probe has a scenario that reaches it, and the document describes it with both errors.
    const world = await buildWorld();
    try {
      const scenario = SCENARIOS["GET /api/memory/maps"];
      expect(scenario).toBeDefined();
      const answer = await scenario!.run(world);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const doc = (await world.call("GET", "/api/openapi.json")).body as {
        paths: Record<string, Record<string, any>>;
      };
      const op = doc.paths["/api/v1/memory/maps"]?.get;
      expect(op).toBeDefined();
      expect(op.operationId).toBe("memory.maps");
      expect(op["x-mordomo-scope"]).toBe("content");
      expect(JSON.stringify(op.responses["400"])).toContain("validation");
      expect(JSON.stringify(op.responses["404"])).toContain("not_found");
      expect(JSON.stringify(op.parameters)).toContain('"root"');
    } finally {
      await world.close();
    }
  }, 120_000);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DeviceScope } from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { generateRouters } from "../core/src/memory/routers.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-contextos, batch A: defining work contexts (S1), the reads that follow one (S2) and the map
 * of each (S4). Every claim about a route crosses the HTTP boundary of a real server over a real home and a real
 * index of real files; what is on disk is read back with `fs` (the test's own eyes, not the engine's).
 */

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let app: FastifyInstance;
let token: string;
/** The indexed folder every test makes its folders in (outside the home). */
let work: string;
/** A folder outside every indexed folder and outside memory/. */
let outside: string;
const cleanups: Array<() => void> = [];

const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });
let seq = 0;
/** A new folder under the indexed folder (or under `base`), made on disk. */
const dir = (name: string, base = work): string => {
  const full = path.join(base, `${name}-${++seq}`);
  fs.mkdirSync(full, { recursive: true });
  return full;
};
const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const under = (folder: string, file: string) => file.startsWith(folder + path.sep);
const idOf = (file: string): number =>
  (ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
const settingsBytes = () => fs.readFileSync(path.join(temp.paths.config, "settings.json"), "utf8");

type Json = Record<string, any>;
async function call(method: string, url: string, payload?: unknown, headers = owner()) {
  // A request without a body carries no content type (the server refuses an empty JSON body).
  const { "content-type": type, ...bare } = headers;
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: payload !== undefined ? { ...bare, "content-type": type } : bare,
    ...(payload !== undefined ? { payload: payload as Json } : {}),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as Json };
}
const create = (body: Json, headers = owner()) => call("POST", "/api/contexts", body, headers);
const get = (url: string, headers = owner()) => call("GET", url, undefined, headers);
const errorCode = (r: { body: Json }) => r.body?.error?.code;

/** Change the settings for one test; the returned function puts back what it changed. */
function withSettings(change: (s: ReturnType<AppContext["settings"]>) => void): () => void {
  const before = ctx.settings();
  const next = ctx.settings();
  change(next);
  ctx.settingsStore.save(next);
  return () => {
    const now = ctx.settings();
    now.indexedFolders = before.indexedFolders;
    now.excludes = before.excludes;
    now.providers = before.providers;
    ctx.settingsStore.save(now);
  };
}

/** A paired device holding exactly the closure of `scopes`. */
function pair(scopes: readonly DeviceScope[]): string {
  const { code } = ctx.devices.startPairing(`phone-${++seq}`, scopes);
  const claimed = ctx.devices.claim(code, `phone-${seq}`);
  expect(claimed).not.toBeNull();
  return claimed!.token;
}

beforeAll(async () => {
  temp = makeTempHome("mordomo-contexts-");
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-work-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-outside-")));
  cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
  cleanups.push(() => fs.rmSync(outside, { recursive: true, force: true }));
  ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.indexedFolders = [{ path: work, area: "Projetos", enabled: true }];
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  temp.cleanup();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("S1 defining contexts", () => {
  it("C1 POST /api/contexts answers 201 with the id from the name, the path as given, the notes folder, no brief, the map, and stores it", async () => {
    const folder = path.join(work, "clientes", "x");
    fs.mkdirSync(folder, { recursive: true });
    const res = await create({ name: "App do cliente X", paths: [folder] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toBe("app-do-cliente-x");
    expect(res.body.name).toBe("App do cliente X");
    expect(res.body.paths.map((p: Json) => p.path)).toEqual([folder]);
    expect(res.body.notesDir).toBe(path.join(temp.paths.home, "memory", "notes", "app-do-cliente-x"));
    expect(res.body.brief).toBeNull();
    expect(res.body.map).toBe(path.join(temp.paths.home, "memory", "contexts", "app-do-cliente-x.md"));
    const stored = ctx.settings().contexts.find((c) => c.id === "app-do-cliente-x");
    expect(stored).toEqual({ id: "app-do-cliente-x", name: "App do cliente X", paths: [folder] });
    const onDisk = JSON.parse(settingsBytes()) as { contexts: Json[] };
    expect(onDisk.contexts.find((c) => c.id === "app-do-cliente-x")).toEqual(stored);
  });

  it("C2 a derived id that exists becomes -2, then -3; a given id that exists is 409 context_exists and nothing changes", async () => {
    const folder = dir("repetido");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await create({ name: "Repetido", paths: [folder] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      ids.push(res.body.id);
    }
    expect(ids).toEqual(["repetido", "repetido-2", "repetido-3"]);
    const before = settingsBytes();
    const taken = await create({ name: "Outro nome", paths: [folder], id: "repetido-2" });
    expect(taken.status).toBe(409);
    expect(errorCode(taken)).toBe("context_exists");
    expect(settingsBytes()).toBe(before);
    expect(
      ctx
        .settings()
        .contexts.filter((c) => c.id.startsWith("repetido"))
        .map((c) => c.name),
    ).toEqual(["Repetido", "Repetido", "Repetido"]);
  });

  it("C3 each refused kind of path answers 400 context_path_not_indexed naming the path and stores nothing", async () => {
    const home = temp.paths.home;
    // The home itself is made an indexed folder, so its config/ and logs/ are refused by the policy, not for being
    // outside every folder.
    const secretsDir = dir("cofre");
    const restore = withSettings((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: home, area: null, enabled: true }];
      s.excludes = [...s.excludes, path.basename(secretsDir)];
    });
    try {
      const secretFile = put(path.join(dir("chaves"), ".env"), "KEY=1\n");
      const linky = dir("linky");
      fs.symlinkSync(path.join(home, "config"), path.join(linky, "cfg"));
      const refused: Array<[string, string]> = [
        ["outside every folder", dir("fora", outside)],
        ["the home's config/", path.join(home, "config")],
        ["the home's logs/", path.join(home, "logs")],
        ["a user exclude", secretsDir],
        ["a secret file name", secretFile],
        ["a folder holding a link into config/", linky],
      ];
      fs.mkdirSync(path.join(home, "logs"), { recursive: true });
      for (const [kind, p] of refused) {
        const before = settingsBytes();
        const res = await create({ name: `Recusado ${kind}`, paths: [p] });
        expect(res.status, `${kind}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(errorCode(res), kind).toBe("context_path_not_indexed");
        expect(res.body.error.message, kind).toContain(p);
        expect(settingsBytes(), kind).toBe(before);
      }
    } finally {
      restore();
    }
  });

  it("C4 a bad name, no path, nine paths, one real folder twice and a 51st context are each 400 validation and store nothing", async () => {
    const folder = dir("valida");
    const alias = path.join(work, `alias-${++seq}`);
    fs.symlinkSync(folder, alias);
    const nine = Array.from({ length: 9 }, () => dir("nove"));
    const bodies: Array<[string, Json]> = [
      ["empty name", { name: "", paths: [folder] }],
      ["blank name", { name: "   ", paths: [folder] }],
      ["61 characters", { name: "x".repeat(61), paths: [folder] }],
      ["line break", { name: "App\nX", paths: [folder] }],
      ["no path", { name: "Sem caminho", paths: [] }],
      ["nine paths", { name: "Nove", paths: nine }],
      ["one real folder twice", { name: "Duas vezes", paths: [folder, alias] }],
    ];
    for (const [kind, body] of bodies) {
      const before = settingsBytes();
      const res = await create(body);
      expect(res.status, `${kind}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(errorCode(res), kind).toBe("validation");
      expect(settingsBytes(), kind).toBe(before);
    }
    // the 51st
    const kept = ctx.settings().contexts;
    const full = ctx.settings();
    for (let i = full.contexts.length; i < 50; i++)
      full.contexts.push({ id: `cheio-${i}`, name: `Cheio ${i}`, paths: [folder] });
    ctx.settingsStore.save(full);
    try {
      expect(ctx.settings().contexts).toHaveLength(50);
      const before = settingsBytes();
      const res = await create({ name: "O quinquagésimo primeiro", paths: [folder] });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(errorCode(res)).toBe("validation");
      expect(settingsBytes()).toBe(before);
    } finally {
      const back = ctx.settings();
      back.contexts = kept;
      ctx.settingsStore.save(back);
    }
  });

  it("C5 PATCH changes only the name or only the paths, checks new paths as a new context's, and the id never changes", async () => {
    const first = dir("patch");
    const second = dir("patch");
    const made = await create({ name: "Antes", paths: [first] });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    const stored = () => ctx.settings().contexts.find((c) => c.id === id);

    const renamed = await call("PATCH", `/api/contexts/${id}`, { name: "Depois" });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.id).toBe(id);
    expect(stored()).toEqual({ id, name: "Depois", paths: [first] });

    const moved = await call("PATCH", `/api/contexts/${id}`, { paths: [second, first] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(stored()).toEqual({ id, name: "Depois", paths: [second, first] });

    const before = settingsBytes();
    const bad = dir("fora", outside);
    const refused = await call("PATCH", `/api/contexts/${id}`, { paths: [bad] });
    expect(refused.status).toBe(400);
    expect(errorCode(refused)).toBe("context_path_not_indexed");
    expect(refused.body.error.message).toContain(bad);
    expect(settingsBytes()).toBe(before);

    // an id in the body is not a field of the change: the id stays
    const named = await call("PATCH", `/api/contexts/${id}`, { id: "outro-id", name: "Terceiro" });
    expect(named.status).toBe(200);
    expect(named.body.id).toBe(id);
    expect(stored()).toEqual({ id, name: "Terceiro", paths: [second, first] });
    expect(ctx.settings().contexts.some((c) => c.id === "outro-id")).toBe(false);
  });

  it("C6 DELETE removes the entry, keeps the notes byte for byte, deletes the map, and resets the active context only when it was this one", async () => {
    const folder = dir("apagar");
    const a = (await create({ name: "Apagar A", paths: [folder] })).body.id as string;
    const b = (await create({ name: "Apagar B", paths: [folder] })).body.id as string;
    const notes = path.join(temp.paths.memory, "notes", a);
    const kept = [
      put(path.join(notes, "ideia.md"), "# Ideia\n\ntexto\n"),
      put(path.join(notes, "sub", "_resumo.md"), "resumo"),
    ];
    const bytes = kept.map((f) => fs.readFileSync(f));
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    const mapA = path.join(temp.paths.memory, "contexts", `${a}.md`);
    expect(fs.existsSync(mapA)).toBe(true);

    ctx.uiPreferences.update({ activeContext: a });
    const res = await call("DELETE", `/api/contexts/${a}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ deleted: true, id: a });
    expect(ctx.settings().contexts.some((c) => c.id === a)).toBe(false);
    kept.forEach((file, i) => expect(fs.readFileSync(file).equals(bytes[i]!), file).toBe(true));
    expect(fs.existsSync(mapA)).toBe(false);
    expect(ctx.uiPreferences.load().activeContext).toBeNull();

    // the active context names another one: it stays
    const c = (await create({ name: "Apagar C", paths: [folder] })).body.id as string;
    ctx.uiPreferences.update({ activeContext: b });
    expect((await call("DELETE", `/api/contexts/${c}`)).status).toBe(200);
    expect(ctx.uiPreferences.load().activeContext).toBe(b);
    ctx.uiPreferences.update({ activeContext: null });
  });

  it("C7 each path has the state ok, missing or not_indexed, and files counts the indexed rows of the context by real path and separator", async () => {
    const okA = dir("estado-ok");
    const okB = dir("estado-ok");
    const sibling = `${okA}-antigo`;
    for (const name of ["um", "dois", "tres"]) put(path.join(okA, `${name}.md`), `# ${name}\n`);
    put(path.join(okB, "sub", "quatro.md"), "# quatro\n");
    put(path.join(sibling, "vizinho.md"), "# vizinho\n");
    const gone = dir("estado-sumiu");
    const otherRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-other-")));
    cleanups.push(() => fs.rmSync(otherRoot, { recursive: true, force: true }));
    const disabled = dir("desligada", otherRoot);
    const excluded = dir("escondida");
    const restore = withSettings((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: otherRoot, area: null, enabled: true }];
    });
    try {
      await ctx.indexer.indexAllAsync();
      const made = await create({ name: "Estados", paths: [okA, okB, gone, disabled, excluded] });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const listed = async () =>
        ((await get("/api/contexts")).body.contexts as Json[]).find((c) => c.id === made.body.id)!;
      const all = await listed();
      expect(all.paths.map((p: Json) => p.state)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
      // the rows of okA and okB, by the test's own count: never the sibling whose name starts like okA
      const rows = (ctx.db.prepare("SELECT path FROM files").all() as Array<{ path: string }>).map(
        (r) => r.path,
      );
      const expected = rows.filter((p) => under(okA, p) || under(okB, p) || p === okA || p === okB).length;
      expect(expected).toBe(4);
      expect(rows.some((p) => under(sibling, p))).toBe(true);
      expect(all.files).toBe(expected);

      fs.rmSync(gone, { recursive: true });
      const s = ctx.settings();
      s.indexedFolders = s.indexedFolders.map((f) => (f.path === otherRoot ? { ...f, enabled: false } : f));
      s.excludes = [...s.excludes, path.basename(excluded)];
      ctx.settingsStore.save(s);
      const after = await listed();
      expect(after.paths).toEqual([
        { path: okA, state: "ok" },
        { path: okB, state: "ok" },
        { path: gone, state: "missing" },
        { path: disabled, state: "not_indexed" },
        { path: excluded, state: "not_indexed" },
      ]);
    } finally {
      restore();
    }
  });

  it("C8 a settings.json with one unreadable contexts entry starts with that entry dropped and the others kept", async () => {
    const folder = dir("tolerante");
    const good = (id: string) => ({ id, name: `Bom ${id}`, paths: [folder] });
    const bad: Array<[string, Json]> = [
      ["a bad id", { id: "Não-É-Id!", name: "Ruim", paths: [folder] }],
      [
        "nine paths",
        { id: "nove", name: "Nove", paths: Array.from({ length: 9 }, (_, i) => path.join(folder, `p${i}`)) },
      ],
      ["a name with a line break", { id: "quebra", name: "Linha\nquebrada", paths: [folder] }],
    ];
    for (const [kind, entry] of bad) {
      const home = makeTempHome("mordomo-contexts-tolerant-");
      try {
        fs.writeFileSync(
          path.join(home.paths.config, "settings.json"),
          JSON.stringify({
            version: 2,
            setupCompleted: true,
            indexedFolders: [{ path: work }],
            contexts: [good("primeiro"), entry, good("segundo")],
          }),
        );
        const started = new AppContext(home.paths.home);
        try {
          expect(
            started.settings().contexts.map((c) => c.id),
            kind,
          ).toEqual(["primeiro", "segundo"]);
          const server = await buildServer(started);
          try {
            const res = await server.inject({
              url: "/api/contexts",
              headers: { "x-mordomo-token": started.token() },
            });
            expect(res.statusCode, kind).toBe(200);
            expect(
              (res.json() as { contexts: Json[] }).contexts.map((c) => c.id),
              kind,
            ).toEqual(["primeiro", "segundo"]);
          } finally {
            await server.close();
          }
        } finally {
          started.close();
        }
      } finally {
        home.cleanup();
      }
    }
  });

  it("C9 a device with every scope is 403 owner_only on the writes; content lists, monitor alone does not", async () => {
    const folder = dir("dispositivo");
    const id = (await create({ name: "Do dono", paths: [folder] })).body.id as string;
    const all = as(pair(["monitor", "content", "run", "approve"]));
    const before = settingsBytes();
    for (const [method, url, body] of [
      ["POST", "/api/contexts", { name: "Do telefone", paths: [folder] }],
      ["PATCH", `/api/contexts/${id}`, { name: "Mudado pelo telefone" }],
      ["DELETE", `/api/contexts/${id}`, undefined],
    ] as const) {
      const res = await call(method, url, body, all);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(errorCode(res), `${method} ${url}`).toBe("owner_only");
    }
    expect(settingsBytes()).toBe(before);
    const content = await get("/api/contexts", as(pair(["content"])));
    expect(content.status).toBe(200);
    expect((content.body.contexts as Json[]).some((c) => c.id === id)).toBe(true);
    const monitor = await get("/api/contexts", as(pair(["monitor"])));
    expect(monitor.status).toBe(403);
  });
});

// ---- S2: the reads follow the context ----------------------------------------------------------------------------

/** `projetos/app` and `projetos/app-antigo`, both indexed, both holding the word; a context on the first. */
interface Corpus {
  app: string;
  old: string;
  id: string;
  appNote: string;
  oldNote: string;
}
let corpus: Corpus | null = null;
async function appCorpus(): Promise<Corpus> {
  if (corpus) return corpus;
  const projetos = dir("projetos");
  const app = path.join(projetos, "app");
  const old = path.join(projetos, "app-antigo");
  const oldNote = put(
    path.join(old, "girassol-antigo.md"),
    "---\ntags: [legado]\n---\n# Girassol antigo\n\n## Girassol\n\ngirassol girassol girassol amarelo semente girassol\n",
  );
  const appNote = put(
    path.join(app, "girassol.md"),
    `---\ntags: [flor]\n---\n# Girassol\n\n## Girassol\n\ngirassol amarelo, veja [o antigo](../app-antigo/girassol-antigo.md) e [o outro](./outro.md)\n`,
  );
  put(
    path.join(app, "outro.md"),
    "# Outro\n\ngirassol semente\n\nveja [o antigo](../app-antigo/girassol-antigo.md)\n",
  );
  put(path.join(app, "dados.txt"), "girassol em texto puro com bastante conteudo para o indice\n");
  await ctx.indexer.indexAllAsync();
  const made = await create({ name: `App ${seq}`, paths: [app] });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  corpus = { app, old, id: made.body.id as string, appNote, oldNote };
  return corpus;
}

describe("S2 the reads follow the context", () => {
  it("C10 search with the context returns only files under projetos/app/, none under app-antigo", async () => {
    const c = await appCorpus();
    const whole = (await get("/api/memory/search?q=girassol&limit=200")).body as unknown as Json[];
    expect(whole.some((h) => under(c.old, h.path))).toBe(true);
    const res = await get(`/api/memory/search?q=girassol&limit=200&context=${c.id}`);
    expect(res.status).toBe(200);
    const hits = res.body as unknown as Json[];
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(under(c.app, hit.path), hit.path).toBe(true);
    expect(hits.some((h) => under(c.old, h.path))).toBe(false);
  });

  it("C11 recall with the context has candidates and sections only of it, and a pointer out of it is not followed", async () => {
    const c = await appCorpus();
    const whole = (await get("/api/memory/recall?q=girassol%20amarelo%20semente&k=10&record=0")).body;
    expect(
      [...whole.candidates, ...whole.answerContext].some((x: Json) => x.path === c.oldNote),
      "without the context the old note is reached",
    ).toBe(true);
    const res = await get(`/api/memory/recall?q=girassol%20amarelo%20semente&k=10&record=0&context=${c.id}`);
    expect(res.status).toBe(200);
    expect(res.body.candidates.length).toBeGreaterThan(0);
    for (const cand of res.body.candidates as Json[]) expect(under(c.app, cand.path), cand.path).toBe(true);
    expect(res.body.answerContext.length).toBeGreaterThan(0);
    for (const section of res.body.answerContext as Json[])
      expect(under(c.app, section.path), section.path).toBe(true);
    expect((res.body.answerContext as Json[]).some((s) => s.path === c.oldNote)).toBe(false);
  });

  it("C12 the graph with the context has only its nodes, edges only between them, and totalFiles counts only them", async () => {
    const c = await appCorpus();
    const whole = (await get("/api/memory/graph?maxNodes=4000")).body;
    const oldId = idOf(c.oldNote);
    expect((whole.edges as Json[]).some((e) => e.target === oldId && e.source === idOf(c.appNote))).toBe(
      true,
    );
    const res = await get(`/api/memory/graph?maxNodes=4000&context=${c.id}`);
    expect(res.status).toBe(200);
    const nodes = res.body.nodes as Json[];
    for (const node of nodes) expect(under(c.app, node.path), node.path).toBe(true);
    const ids = new Set(nodes.map((n) => n.id));
    for (const edge of res.body.edges as Json[]) {
      expect(ids.has(edge.source), JSON.stringify(edge)).toBe(true);
      expect(ids.has(edge.target), JSON.stringify(edge)).toBe(true);
    }
    const rows = (ctx.db.prepare("SELECT path FROM files").all() as Array<{ path: string }>).filter((r) =>
      under(c.app, r.path),
    );
    expect(rows).toHaveLength(3);
    expect(res.body.totalFiles).toBe(rows.length);
    expect(nodes).toHaveLength(rows.length);
  });

  it("C13 related with the context lists no file outside it, and a file outside it is 404 not_found", async () => {
    const c = await appCorpus();
    const whole = (await get(`/api/memory/related?id=${idOf(c.appNote)}`)).body as unknown as Json[];
    expect(whole.some((r) => r.file.path === c.oldNote)).toBe(true);
    const res = await get(`/api/memory/related?id=${idOf(c.appNote)}&context=${c.id}`);
    expect(res.status).toBe(200);
    const related = res.body as unknown as Json[];
    expect(related.length).toBeGreaterThan(0);
    for (const r of related) expect(under(c.app, r.file.path), r.file.path).toBe(true);
    const out = await get(`/api/memory/related?id=${idOf(c.oldNote)}&context=${c.id}`);
    expect(out.status).toBe(404);
    expect(errorCode(out)).toBe("not_found");
  });

  it("C14 status with the context counts the facets only over its files and the rest is the answer without it", async () => {
    const c = await appCorpus();
    const plain = (await get("/api/memory/status")).body;
    const res = await get(`/api/memory/status?context=${c.id}`);
    expect(res.status).toBe(200);
    const rows = (
      ctx.db.prepare("SELECT path, area, ext, tags FROM files").all() as Array<{
        path: string;
        area: string | null;
        ext: string;
        tags: string;
      }>
    ).filter((r) => under(c.app, r.path));
    const count = (values: string[]) => {
      const m = new Map<string, number>();
      for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
      return m;
    };
    const facets = res.body.facets;
    expect(facets.total).toBe(rows.length);
    expect(new Map((facets.areas as Json[]).map((a) => [a.area, a.count]))).toEqual(
      count(rows.flatMap((r) => (r.area ? [r.area] : []))),
    );
    expect(new Map((facets.exts as Json[]).map((e) => [e.ext, e.count]))).toEqual(
      count(rows.map((r) => r.ext)),
    );
    expect(new Map((facets.tags as Json[]).map((t) => [t.tag, t.count]))).toEqual(
      count(rows.flatMap((r) => JSON.parse(r.tags) as string[])),
    );
    expect((facets.tags as Json[]).some((t) => t.tag === "legado")).toBe(false);
    expect(plain.facets.total).toBeGreaterThan(rows.length);
    const { facets: _a, ...rest } = res.body;
    const { facets: _b, ...plainRest } = plain;
    expect(rest).toEqual(plainRest);
  });

  it("C15 the five routes are 404 context_not_found for an unknown context, and context=all or none answers the whole index as before", async () => {
    const c = await appCorpus();
    const appId = idOf(c.appNote);
    const urls = [
      "/api/memory/search?q=girassol&limit=200",
      "/api/memory/recall?q=girassol%20amarelo&k=10&record=0",
      "/api/memory/graph?maxNodes=4000",
      `/api/memory/related?id=${appId}`,
      "/api/memory/status",
    ];
    const strip = (body: Json): Json => {
      const { durationMs: _d, ...rest } = body;
      return rest;
    };
    for (const url of urls) {
      const unknown = await get(`${url}&context=nao-existe`.replace("status&", "status?"));
      expect(unknown.status, url).toBe(404);
      expect(errorCode(unknown), url).toBe("context_not_found");
      const none = await get(url);
      const all = await get(`${url}&context=all`.replace("status&", "status?"));
      expect(none.status, url).toBe(200);
      expect(all.status, url).toBe(200);
      expect(Array.isArray(all.body) ? all.body : strip(all.body), url).toEqual(
        Array.isArray(none.body) ? none.body : strip(none.body),
      );
    }
    // the whole index: the old folder answers too
    const hits = (await get("/api/memory/search?q=girassol&limit=200&context=all")).body as unknown as Json[];
    expect(hits.some((h) => under(c.old, h.path))).toBe(true);
    // the writes of a context that does not exist are 404 context_not_found too (Coverage: PATCH, DELETE)
    const patch = await call("PATCH", "/api/contexts/nao-existe", { name: "x" });
    expect([patch.status, errorCode(patch)]).toEqual([404, "context_not_found"]);
    const del = await call("DELETE", "/api/contexts/nao-existe");
    expect([del.status, errorCode(del)]).toEqual([404, "context_not_found"]);
  });

  it("C16 with one of two paths deleted from disk, or its indexed folder disabled, the five routes answer 200 from the other path", async () => {
    const c = await appCorpus();
    const gone = dir("vai-sumir");
    put(path.join(gone, "girassol-perdido.md"), "# Girassol perdido\n\ngirassol amarelo semente\n");
    const otherRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-off-")));
    cleanups.push(() => fs.rmSync(otherRoot, { recursive: true, force: true }));
    const off = path.join(otherRoot, "pasta");
    put(path.join(off, "girassol-desligado.md"), "# Girassol desligado\n\ngirassol amarelo semente\n");
    const restore = withSettings((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: otherRoot, area: null, enabled: true }];
    });
    try {
      await ctx.indexer.indexAllAsync();
      const withGone = (await create({ name: "Com sumida", paths: [gone, c.app] })).body.id as string;
      const withOff = (await create({ name: "Com desligada", paths: [off, c.app] })).body.id as string;
      fs.rmSync(gone, { recursive: true });
      const s = ctx.settings();
      s.indexedFolders = s.indexedFolders.map((f) => (f.path === otherRoot ? { ...f, enabled: false } : f));
      ctx.settingsStore.save(s);
      for (const id of [withGone, withOff]) {
        const search = await get(`/api/memory/search?q=girassol&limit=200&context=${id}`);
        expect(search.status, id).toBe(200);
        expect((search.body as unknown as Json[]).length, id).toBeGreaterThan(0);
        for (const hit of search.body as unknown as Json[])
          expect(under(c.app, hit.path), `${id} ${hit.path}`).toBe(true);
        const recall = await get(
          `/api/memory/recall?q=girassol%20amarelo%20semente&k=10&record=0&context=${id}`,
        );
        expect(recall.status, id).toBe(200);
        expect(recall.body.answerContext.length, id).toBeGreaterThan(0);
        for (const x of [...recall.body.candidates, ...recall.body.answerContext] as Json[])
          expect(under(c.app, x.path), `${id} ${x.path}`).toBe(true);
        const graph = await get(`/api/memory/graph?maxNodes=4000&context=${id}`);
        expect(graph.status, id).toBe(200);
        expect(graph.body.totalFiles, id).toBe(3);
        for (const node of graph.body.nodes as Json[])
          expect(under(c.app, node.path), `${id} ${node.path}`).toBe(true);
        const related = await get(`/api/memory/related?id=${idOf(c.appNote)}&context=${id}`);
        expect(related.status, id).toBe(200);
        for (const r of related.body as unknown as Json[])
          expect(under(c.app, r.file.path), `${id} ${r.file.path}`).toBe(true);
        const status = await get(`/api/memory/status?context=${id}`);
        expect(status.status, id).toBe(200);
        expect(status.body.facets.total, id).toBe(3);
      }
    } finally {
      restore();
    }
  });
});

// ---- S4: the map of a context ------------------------------------------------------------------------------------

const mapOf = (id: string) => path.join(temp.paths.memory, "contexts", `${id}.md`);

describe("S4 the map of a context", () => {
  it("C26 generateRouters writes the map: header, name, paths with state, the brief, and the key files linked to from inside first, then the most recent", async () => {
    const folder = dir("mapa");
    const outsider = dir("mapa-fora");
    const t0 = Math.floor(Date.now() / 1000) - 10_000;
    const stamp = (file: string, age: number) => {
      fs.utimesSync(file, t0 + age, t0 + age);
      return file;
    };
    const hub = stamp(put(path.join(folder, "hub.md"), "---\ntitle: Hub Central\n---\nhub\n"), 1);
    const mid = stamp(put(path.join(folder, "mid.md"), "sem título\n"), 2);
    for (let i = 1; i <= 3; i++)
      stamp(
        put(
          path.join(folder, `fonte-${i}.md`),
          `# Fonte ${i}\n\n[hub](./hub.md) ${i < 3 ? "[mid](./mid.md)" : ""}\n`,
        ),
        3 + i,
      );
    const plains: string[] = [];
    for (let i = 1; i <= 35; i++)
      plains.push(
        stamp(
          put(path.join(folder, `simples-${String(i).padStart(2, "0")}.md`), `# Simples ${i}\n`),
          100 + i,
        ),
      );
    // Links from outside the context do not count: the oldest plain file is linked to many times from outside.
    for (let i = 1; i <= 5; i++)
      put(path.join(outsider, `de-fora-${i}.md`), `[x](../${path.basename(folder)}/simples-01.md)\n`);
    await ctx.indexer.indexAllAsync();
    const made = await create({ name: "Mapa do projeto", paths: [folder] });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    const brief = put(path.join(temp.paths.memory, "notes", id, "_resumo.md"), "# Resumo\n\no que importa\n");
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    const text = fs.readFileSync(mapOf(id), "utf8");
    const lines = text.split("\n");
    expect(lines[0]).toBe("<!-- generated by MordomoOS -->");
    expect(text).toContain("Mapa do projeto");
    expect(lines).toContain(`- ${folder} (ok)`);
    expect(text).toContain("_resumo.md");
    expect(text).toContain(brief);
    const fileLines = lines.filter((l) => l.startsWith("- ") && l.includes(" → "));
    expect(fileLines).toHaveLength(30);
    expect(fileLines[0]).toBe(`- Hub Central → ${hub}`);
    expect(fileLines[1]).toBe(`- mid.md → ${mid}`);
    // then by mtime, the newest first: the 35 plain files from simples-35 down, after the three sources
    const row = (file: string) =>
      ctx.db.prepare("SELECT title, name FROM files WHERE path = ?").get(file) as {
        title: string | null;
        name: string;
      };
    const recent = [...plains].reverse().slice(0, 28);
    expect(fileLines.slice(2)).toEqual(recent.map((f) => `- ${row(f).title ?? row(f).name} → ${f}`));
    expect(fileLines.some((l) => l.endsWith(path.join(folder, "simples-01.md")))).toBe(false);
  });

  it("C27 a context of 200 files gives a map of at most 4 800 characters that ends with the number of files left out", async () => {
    const folder = dir("grande");
    for (let i = 0; i < 200; i++)
      put(
        path.join(folder, `${"arquivo-com-um-nome-bem-comprido-".repeat(3)}${String(i).padStart(3, "0")}.md`),
        `nota ${i}\n`,
      );
    await ctx.indexer.indexAllAsync();
    const id = (await create({ name: "Grande", paths: [folder] })).body.id as string;
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    const text = fs.readFileSync(mapOf(id), "utf8");
    expect(text.length).toBeLessThanOrEqual(4800);
    const listed = text.split("\n").filter((l) => l.startsWith("- ") && l.includes(" → ")).length;
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThan(30);
    expect(text.trimEnd().split("\n").at(-1)).toBe(
      `…(${200 - listed} arquivos a mais; use o recall com o contexto)`,
    );
  });

  it("C28 after a delete the next generateRouters deletes the map, after a rename it rewrites it with the new name", async () => {
    const folder = dir("ciclo");
    put(path.join(folder, "nota.md"), "# Nota\n");
    await ctx.indexer.indexAllAsync();
    const keep = (await create({ name: "Nome velho", paths: [folder] })).body.id as string;
    const drop = (await create({ name: "Vai embora", paths: [folder] })).body.id as string;
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    expect(fs.readFileSync(mapOf(keep), "utf8")).toContain("Nome velho");
    expect(fs.existsSync(mapOf(drop))).toBe(true);
    // removed from the settings by another way than the route: the next regeneration takes the map away
    const s = ctx.settings();
    s.contexts = s.contexts.filter((c) => c.id !== drop);
    ctx.settingsStore.save(s);
    expect((await call("PATCH", `/api/contexts/${keep}`, { name: "Nome novo" })).status).toBe(200);
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    expect(fs.existsSync(mapOf(drop))).toBe(false);
    const text = fs.readFileSync(mapOf(keep), "utf8");
    expect(text).toContain("Nome novo");
    expect(text).not.toContain("Nome velho");
  });

  it("C29 PUT /api/memory/notes on a map is 403 note_not_editable with the file unchanged, and GET /api/memory/note says editable false with a reason", async () => {
    const folder = dir("nao-editavel");
    const id = (await create({ name: "Não editável", paths: [folder] })).body.id as string;
    generateRouters(ctx.db, ctx.paths, ctx.settings());
    const file = mapOf(id);
    const before = fs.readFileSync(file);
    const read = await get(`/api/memory/note?p=${encodeURIComponent(file)}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.editable).toBe(false);
    expect(typeof read.body.reason).toBe("string");
    expect(read.body.reason.length).toBeGreaterThan(0);
    const save = await call("PUT", "/api/memory/notes", {
      path: file,
      content: "# mudado\n",
      baseVersion: read.body.version,
    });
    expect(save.status).toBe(403);
    expect(errorCode(save)).toBe("note_not_editable");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});

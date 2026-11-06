import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFolderAccess } from "../core/src/memory/folderAccess.js";
import { localDateString } from "../core/src/memory/journal.js";
import { code, memoriaWorld, runWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { FIXTURES, order, seedFixture } from "./helpers/searchFixtures.js";

/**
 * .specs/features/cerebro-memoria-confiavel, batch B1, S4: the access of folders on every route a device or a run's
 * credential reads (C109 to C118, C122 to C124; the run routes are in `memoria.access-runs.test.ts`). Every claim is
 * read through HTTP over a real home (`memoriaWorld`).
 *
 * "The twin" (C113 to C115): the same world, the access of folders emptied and `fin` added to `settings.excludes`, the
 * index passed again (the excluded rows go), and the owner's answer. `settings.excludes` holds globs matched on each
 * segment of a path relative to its root, so the exclusion that names the folder `<memory>/notes/fin` is the segment
 * `fin` (an absolute path in that list matches no segment and excludes nothing); no other folder of this home has a
 * segment `fin`, and `notes/fin2/` is kept by it (a glob matches the whole segment).
 */

const opened: MemoriaWorld[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

interface Seeded {
  w: MemoriaWorld;
  fin: string;
  outra: string;
  fin2: string;
  secret: string;
  visible: string;
  neighbour: string;
}

async function seeded(
  prefix = "mordomo-access-",
  /** `runWorld` where a run is started (Claude enabled, the fake CLI); `memoriaWorld` otherwise. */
  make: (prefix: string) => Promise<MemoriaWorld> = memoriaWorld,
): Promise<Seeded> {
  const w = await make(prefix);
  opened.push(w);
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  const fin2 = path.join(w.memory, "notes", "fin2");
  const secret = w.put(
    path.join(fin, "segredo.md"),
    "# Segredo financeiro\n\nOrçamento sigiloso do trimestre, ligado a [[visivel]].\n\nstatus:: aberto\n",
  );
  const visible = w.put(
    path.join(outra, "visivel.md"),
    "# Visível\n\nOrçamento público do trimestre, ligado a [[segredo]].\n\nstatus:: aberto\n",
  );
  const neighbour = w.put(
    path.join(fin2, "vizinha.md"),
    "# Vizinha\n\nOrçamento da vizinha do trimestre.\n\nstatus:: aberto\n",
  );
  await w.index();
  return { w, fin, outra, fin2, secret, visible, neighbour };
}

const setAccess = async (w: MemoriaWorld, folderAccess: Json[]) => {
  const res = await w.call("PUT", "/api/settings", { folderAccess });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  // A change of the access starts a pass that builds what the devices read (their related edges, door 20); the proofs
  // read after it has ended.
  await w.index();
};

/** The twin of a world where `fin` is hidden: no access of folders, `fin` excluded, the index passed again. */
async function twin(w: MemoriaWorld): Promise<void> {
  w.update((s) => {
    s.folderAccess = [];
    s.excludes = [...s.excludes, "fin"];
  });
  await w.index();
  // The twin's "related by content" edges are worked out from nothing (round 2 finding 3): the pass above relates only
  // what changed, with the weights of a corpus that held the hidden notes, so it is not the world without them.
  const ids = (w.ctx.db.prepare("SELECT id FROM files").all() as Array<{ id: number }>).map((r) => r.id);
  w.ctx.indexer.refreshRelated(new Set(ids));
  const left = w.ctx.db
    .prepare("SELECT COUNT(*) c FROM files WHERE path LIKE ?")
    .get(`%${path.sep}fin${path.sep}%`) as {
    c: number;
  };
  expect(left.c, "the twin's index holds no row of the excluded folder").toBe(0);
}

/** An answer without what changes from one call to the next (its timings and the moment it was made). */
function stable(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body), (key, value) =>
    ["durationMs", "generatedAt"].includes(key) ? undefined : value,
  );
}

/**
 * The twin's answer as anyone but the owner is given it (plan amendment 4): the search's and the recall's scores are `1 /
 * position` in the list returned; every other field, and every other route, as the owner's.
 */
function asNonOwner(url: string, body: Json): Json {
  const ranked = (list: Json[]) => list.map((item, i) => ({ ...item, score: 1 / (i + 1) }));
  if (url.startsWith("/api/memory/search")) return ranked(body as unknown as Json[]) as unknown as Json;
  if (url.startsWith("/api/memory/recall?")) {
    return { ...body, answerContext: ranked(body.answerContext), candidates: ranked(body.candidates) };
  }
  return body;
}

const idOf = (w: MemoriaWorld, file: string): number =>
  (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;

const pathsIn = (body: unknown): string[] =>
  [...JSON.stringify(body).matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]!);

// ---- C109: the setting ----------------------------------------------------------------------------------------------

describe("C109 settings.folderAccess", () => {
  it("C109 one entry is stored and read back; 200 entries pass and 201 are refused; bad entries store nothing; the default is []", async () => {
    const { w, fin, secret, visible } = await seeded();
    // the default, under which a device and a run reach every folder as before
    expect((await w.call("GET", "/api/settings")).body.folderAccess).toEqual([]);
    const device = w.device(["content"]);
    const before = await w.call("GET", "/api/memory/search?q=orcamento", undefined, device);
    expect(before.status).toBe(200);
    expect((before.body.hits ?? before.body.results ?? before.body).length ?? 0).toBeGreaterThan(0);
    expect(pathsIn(before.body)).toEqual(expect.arrayContaining([secret, visible]));
    const run = w.run("write");
    const runSearch = await w.call("GET", "/api/memory/search?q=orcamento", undefined, run.headers);
    expect(pathsIn(runSearch.body)).toEqual(expect.arrayContaining([secret, visible]));

    // one entry (L-050)
    const financeiro = path.join(w.memory, "notes", "financeiro");
    fs.mkdirSync(financeiro, { recursive: true });
    const one = [{ path: financeiro, agents: "read", devices: "hide" }];
    const put = await w.call("PUT", "/api/settings", { folderAccess: one });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.settings.folderAccess).toEqual(one);
    expect((await w.call("GET", "/api/settings")).body.folderAccess).toEqual(one);

    // 200 entries (the accepted edge, L-057) and 201 (refused)
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        path: path.join(fin, `pasta-${i}`),
        agents: "write",
        devices: "read",
      }));
    const at200 = await w.call("PUT", "/api/settings", { folderAccess: many(200) });
    expect(at200.status, JSON.stringify(at200.body).slice(0, 300)).toBe(200);
    expect((await w.call("GET", "/api/settings")).body.folderAccess).toHaveLength(200);
    await setAccess(w, one);
    expect(code(await w.call("PUT", "/api/settings", { folderAccess: many(201) }))).toEqual([
      400,
      "validation",
    ]);
    expect((await w.call("GET", "/api/settings")).body.folderAccess).toEqual(one);

    // each bad entry alone, nothing stored
    const bad: Array<[string, Json]> = [
      ["an unknown level", { path: fin, agents: "secret", devices: "hide" }],
      ["a relative path", { path: "notes/fin", agents: "read", devices: "hide" }],
      [
        "a path outside memory/ and every enabled indexed folder",
        { path: w.outside("fora"), agents: "read", devices: "hide" },
      ],
    ];
    for (const [why, entry] of bad) {
      expect(code(await w.call("PUT", "/api/settings", { folderAccess: [entry] })), why).toEqual([
        400,
        "validation",
      ]);
      expect((await w.call("GET", "/api/settings")).body.folderAccess, why).toEqual(one);
    }
    // inside an enabled indexed folder is accepted
    const root = w.indexedRoot("projeto");
    await setAccess(w, [{ path: root, agents: "read", devices: "read" }]);
  });
});

// ---- C110 to C112: the resolver at the route ------------------------------------------------------------------------

describe("C110 the longest entry decides at the route", () => {
  it("C110 a device's search finds the notes/outra/ note and not the notes/fin/ one", async () => {
    const { w, fin, secret, visible } = await seeded();
    await setAccess(w, [
      { path: path.join(w.memory, "notes"), agents: "write", devices: "read" },
      { path: fin, agents: "write", devices: "hide" },
    ]);
    const res = await w.call("GET", "/api/memory/search?q=orcamento", undefined, w.device(["content"]));
    expect(res.status).toBe(200);
    expect(pathsIn(res.body)).toContain(visible);
    expect(pathsIn(res.body)).not.toContain(secret);
  });
});

/** Write `settings.json` by hand, as the owner would with an editor, and have the store read it again. */
function handEdit(w: MemoriaWorld, change: (raw: Json) => void): void {
  const file = w.ctx.paths.settingsFile;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
  change(raw);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  w.ctx.settingsStore.invalidate();
}

describe("C111 an entry with a level this version cannot read", () => {
  it('C111 devices: "secret" reads that entry as hide for both, and the other entries stay as written', async () => {
    const { w, fin, outra, secret, visible } = await seeded("mordomo-access-c111-", runWorld);
    handEdit(w, (raw) => {
      raw.folderAccess = [
        { path: fin, agents: "write", devices: "secret" },
        { path: outra, agents: "read", devices: "read" },
      ];
    });
    expect(w.ctx.settings().folderAccess).toEqual([
      { path: fin, agents: "hide", devices: "hide" },
      { path: outra, agents: "read", devices: "read" },
    ]);
    const res = await w.call("GET", "/api/memory/search?q=orcamento", undefined, w.device(["content"]));
    expect(pathsIn(res.body)).not.toContain(secret);
    expect(pathsIn(res.body)).toContain(visible);
    // agents: hide too - a run started there is refused for that reason
    const started = await w.call("POST", "/api/runs", {
      prompt: "olhe",
      mode: "read_only",
      cwd: fin,
      provider: "claude",
    });
    expect(code(started)).toEqual([403, "folder_hidden"]);
    expect(w.ctx.runs.list({ limit: 50 }).filter((r) => r.cwd === fin)).toEqual([]);
  });
});

describe("C112 a folderAccess this version cannot read", () => {
  it('C112 "x" reads every root as hide for devices and read for agents; the owner as before; the file is kept', async () => {
    const { w, secret, visible } = await seeded("mordomo-access-c112-", runWorld);
    handEdit(w, (raw) => {
      raw.folderAccess = "x";
    });
    const device = w.device(["content"]);
    const search = await w.call("GET", "/api/memory/search?q=orcamento", undefined, device);
    expect(search.status).toBe(200);
    expect(pathsIn(search.body).filter((p) => p.startsWith(w.memory))).toEqual([]);
    const tree = await w.call(
      "GET",
      `/api/memory/tree?root=${encodeURIComponent(w.memory)}&dir=notes`,
      undefined,
      device,
    );
    // no folder: nothing under notes/ is shown, so the folder asked for is not one
    expect(tree.status === 200 ? tree.body.folders : [], JSON.stringify(tree.body)).toEqual([]);
    const root = await w.call(
      "GET",
      `/api/memory/tree?root=${encodeURIComponent(w.memory)}`,
      undefined,
      device,
    );
    expect(root.status).toBe(200);
    expect(root.body.folders).toEqual([]);
    expect(root.body.files).toEqual([]);
    expect(
      code(await w.call("GET", `/api/memory/note?p=${encodeURIComponent(visible)}`, undefined, device)),
    ).toEqual([404, "not_found"]);
    // agents: read - a write run in memory/ is refused, a read-only run starts
    expect(
      code(
        await w.call("POST", "/api/runs", {
          prompt: "escreva",
          mode: "write",
          cwd: w.memory,
          provider: "claude",
        }),
      ),
    ).toEqual([403, "folder_read_only"]);
    const ro = await w.call("POST", "/api/runs", {
      prompt: "leia",
      mode: "read_only",
      cwd: w.memory,
      provider: "claude",
    });
    expect(ro.status, JSON.stringify(ro.body)).toBe(200);
    // the owner reads and writes as before
    const owned = await w.call("GET", "/api/memory/search?q=orcamento");
    expect(pathsIn(owned.body)).toEqual(expect.arrayContaining([secret, visible]));
    const note = await w.call("GET", `/api/memory/note?p=${encodeURIComponent(secret)}`);
    expect(note.status).toBe(200);
    const saved = await w.call("PUT", "/api/memory/notes", {
      path: secret,
      content: "# Segredo financeiro\n\nmudado pelo dono\n",
      baseVersion: note.body.version,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // the original is kept, as for any field this version cannot read
    expect(JSON.parse(fs.readFileSync(`${w.ctx.paths.settingsFile}.invalid`, "utf8")).folderAccess).toBe("x");
    expect(w.ctx.settings().folderAccess).toEqual([{ path: "*", agents: "read", devices: "hide" }]);
  });

  // verification round 1, finding 7: the resolver's own reading of what it cannot place, at its own layer and through
  // a hand-edited list the stored schema lets in (a relative path)
  it('C112 the resolver itself reads a field that is not a list ("x") as read for agents and hide for devices', async () => {
    const w = await memoriaWorld("mordomo-access-c112-layer-");
    opened.push(w);
    const access = resolveFolderAccess({
      paths: w.ctx.paths,
      settings: { ...w.ctx.settings(), folderAccess: "x" } as never,
    });
    const file = path.join(w.memory, "notes", "a.md");
    expect([access.unreadable, access.level(file, "agents"), access.level(file, "devices")]).toEqual([
      true,
      "read",
      "hide",
    ]);
  });

  it("C112 an entry whose path is relative or not a string names no folder: every path reads hide for both, beside an entry that says write", async () => {
    const w = await memoriaWorld("mordomo-access-c112-unplaced-");
    opened.push(w);
    const file = path.join(w.memory, "notes", "a.md");
    for (const bad of ["notes/fin", 42, null]) {
      const access = resolveFolderAccess({
        paths: w.ctx.paths,
        settings: {
          ...w.ctx.settings(),
          folderAccess: [
            { path: w.memory, agents: "write", devices: "write" },
            { path: bad, agents: "write", devices: "write" },
          ],
        } as never,
      });
      expect([access.level(file, "agents"), access.level(file, "devices")], String(bad)).toEqual([
        "hide",
        "hide",
      ]);
      expect([access.level(w.home, "agents"), access.level(w.home, "devices")], String(bad)).toEqual([
        "hide",
        "hide",
      ]);
    }
  });

  it("C112 a hand-edited list with a relative path: a device finds nothing, any run in memory/ is 403 folder_hidden, the owner as before", async () => {
    const { w, secret, visible } = await seeded("mordomo-access-c112-relative-", runWorld);
    handEdit(w, (raw) => {
      raw.folderAccess = [{ path: "notes/fin", agents: "write", devices: "write" }];
    });
    expect(w.ctx.settings().folderAccess).toEqual([{ path: "notes/fin", agents: "write", devices: "write" }]);
    const device = w.device(["content"]);
    const search = await w.call("GET", "/api/memory/search?q=orcamento", undefined, device);
    expect(search.status).toBe(200);
    expect(pathsIn(search.body).filter((p) => p.startsWith(w.memory))).toEqual([]);
    expect(
      code(await w.call("GET", `/api/memory/note?p=${encodeURIComponent(visible)}`, undefined, device)),
    ).toEqual([404, "not_found"]);
    for (const mode of ["write", "read_only"]) {
      expect(
        code(await w.call("POST", "/api/runs", { prompt: "x", mode, cwd: w.memory, provider: "claude" })),
        mode,
      ).toEqual([403, "folder_hidden"]);
    }
    const owned = await w.call("GET", "/api/memory/search?q=orcamento");
    expect(pathsIn(owned.body)).toEqual(expect.arrayContaining([secret, visible]));
  });
});

// ---- C113 to C116: every route a device reads ----------------------------------------------------------------------

describe("C113 the index readers a device calls, against the twin", () => {
  it("C113 search, recall (with a followed link), graph, related, links and query equal the twin's", async () => {
    const { w, fin, secret, visible, neighbour } = await seeded();
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const device = w.device(["content"]);
    const visibleId = idOf(w, visible);
    const neighbourId = idOf(w, neighbour);
    const urls = [
      "/api/memory/search?q=orcamento",
      "/api/memory/recall?q=orcamento%20trimestre&record=false",
      "/api/memory/graph",
      `/api/memory/related?id=${visibleId}`,
      `/api/memory/related?id=${neighbourId}`,
      `/api/memory/links?id=${visibleId}`,
      "/api/memory/query?where=status:aberto",
    ];
    const seen: Record<string, unknown> = {};
    for (const url of urls) {
      const res = await w.call("GET", url, undefined, device);
      expect(res.status, `${url} ${JSON.stringify(res.body)}`).toBe(200);
      expect(pathsIn(res.body), url).not.toContain(secret);
      seen[url] = stable(res.body);
    }
    // the owner, before the twin, does see the hidden note on each path (the case is not empty)
    const ownerRecall = await w.call("GET", "/api/memory/recall?q=orcamento%20trimestre&record=false");
    expect(pathsIn(ownerRecall.body)).toContain(secret);
    const ownerLinks = await w.call("GET", `/api/memory/links?id=${visibleId}`);
    expect(pathsIn(ownerLinks.body)).toContain(secret);
    await twin(w);
    for (const url of urls) {
      const res = await w.call("GET", url);
      expect(res.status, url).toBe(200);
      expect(seen[url], url).toEqual(stable(asNonOwner(url, res.body)));
    }
  });
});

describe("C113 the order a hidden folder does not change", () => {
  it("C113 a device's search order equals the twin's when the hidden notes would change the weight of a word (bm25 over the whole index would not)", async () => {
    const fixture = FIXTURES[0]!;
    const w = await memoriaWorld("mordomo-access-c113-order-");
    opened.push(w);
    const { fin, outra } = await seedFixture(w, fixture);
    const url = `/api/memory/search?q=${encodeURIComponent(fixture.query)}&limit=200`;
    expect(
      order((await w.call("GET", url)).body, outra),
      "over the whole index the order is the other one",
    ).toEqual(["b.md", "a.md"]);
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const device = await w.call("GET", url, undefined, w.device(["content"]));
    await twin(w);
    const owned = await w.call("GET", url);
    expect(order(owned.body, outra)).toEqual(fixture.twin);
    expect(order(device.body, outra)).toEqual(fixture.twin);
  });
});

describe("C114 the folder and journal readers a device calls, against the twin", () => {
  it("C114 tree, maps, hygiene, journal?days=7, routers/check and recall/stats equal the twin's; a hidden day is 404 and not made; contexts omit the path", async () => {
    const { w, fin, outra, secret } = await seeded();
    const journal = path.join(w.memory, "journal");
    // a day of the journal, the routers with a broken pointer into the hidden folder and one outside it, and recalls
    // that recorded both folders
    const yesterday = new Date(Date.now() - 86_400_000);
    const two = (n: number) => String(n).padStart(2, "0");
    const day = `${yesterday.getFullYear()}-${two(yesterday.getMonth() + 1)}-${two(yesterday.getDate())}`;
    w.put(path.join(journal, `${day}.md`), `# ${day}\n\n## Notes\n\n- orçamento revisto\n`);
    await w.index();
    expect((await w.call("POST", "/api/memory/routers")).status).toBe(200);
    const areas = path.join(w.memory, "areas");
    fs.mkdirSync(areas, { recursive: true });
    fs.writeFileSync(
      path.join(areas, "ponteiros.md"),
      `# Ponteiros\n\n- a → \`${path.join(fin, "sumiu.md")}\`\n- b → \`${path.join(outra, "sumiu.md")}\`\n`,
    );
    for (const q of ["segredo%20sigiloso", "visivel%20publico"]) {
      expect((await w.call("GET", `/api/memory/recall?q=${q}`)).status).toBe(200);
    }
    const stats = await w.call("GET", "/api/memory/recall/stats");
    expect(pathsIn(stats.body), "the owner's stats name the hidden note (the case is not empty)").toContain(
      secret,
    );
    const checked = await w.call("GET", "/api/memory/routers/check");
    expect(JSON.stringify(checked.body)).toContain(path.join(fin, "sumiu.md"));
    w.update((s) => {
      s.contexts = [{ id: "projeto", name: "Projeto", paths: [fin, outra] }];
    });

    await setAccess(w, [
      { path: fin, agents: "write", devices: "hide" },
      { path: journal, agents: "write", devices: "hide" },
    ]);
    // the routers and the context's map the change of access rewrote are indexed, as they are in the twin
    await w.index();
    const device = w.device(["content"]);
    const today = localDateString();
    const todayFile = path.join(journal, `${today}.md`);
    if (fs.existsSync(todayFile)) fs.rmSync(todayFile);
    const urls = [
      `/api/memory/tree?root=${encodeURIComponent(w.memory)}`,
      `/api/memory/tree?root=${encodeURIComponent(w.memory)}&dir=notes`,
      "/api/memory/maps",
      "/api/memory/hygiene",
      `/api/memory/journal?days=7&date=${today}`,
      "/api/memory/routers/check",
      "/api/memory/recall/stats",
    ];
    const seen: Record<string, unknown> = {};
    for (const url of urls) {
      const res = await w.call("GET", url, undefined, device);
      expect(res.status, `${url} ${JSON.stringify(res.body)}`).toBe(200);
      expect(
        pathsIn(res.body).some((p) => p.startsWith(fin + path.sep) || p === fin),
        url,
      ).toBe(false);
      seen[url] = stable(res.body);
    }
    expect((seen[`/api/memory/journal?days=7&date=${today}`] as Json).days).toEqual([]);
    // one day: 404 not_found, and no file is made (G15)
    expect(code(await w.call("GET", `/api/memory/journal?date=${today}`, undefined, device))).toEqual([
      404,
      "not_found",
    ]);
    expect(fs.existsSync(todayFile)).toBe(false);
    // the contexts: the hidden path is omitted, the other kept (G11)
    const contexts = await w.call("GET", "/api/contexts", undefined, device);
    expect(contexts.status).toBe(200);
    expect(contexts.body.contexts.map((c: Json) => c.paths.map((p: Json) => p.path))).toEqual([[outra]]);
    expect(JSON.stringify(contexts.body)).not.toContain(fin);

    w.update((s) => {
      s.contexts = [];
      s.excludes = [...s.excludes, "journal"];
    });
    await twin(w);
    for (const url of urls) {
      const res = await w.call("GET", url);
      expect(res.status, url).toBe(200);
      expect(seen[url], url).toEqual(stable(res.body));
    }
  });
});

async function scanEnded(w: MemoriaWorld, scanId: string): Promise<Json> {
  for (let i = 0; i < 4000; i++) {
    const res = await w.call("GET", `/api/memory/cleanup/scans/${scanId}`);
    if (res.body.status !== "running") return res.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`scan ${scanId} did not end`);
}

describe("C115 facts, reviews and the cleanup a device reads", () => {
  it("C115 no fact sourced in the hidden folder, no review item in it, and the cleanup inventory and scan equal the twin's", async () => {
    const { w, fin, outra, secret, visible } = await seeded();
    // a duplicate pair across the two folders (a finding that names a hidden file)
    w.put(path.join(fin, "copia.md"), "# Cópia\n\nO mesmo texto, palavra por palavra, nas duas pastas.\n");
    w.put(path.join(outra, "copia.md"), "# Cópia\n\nO mesmo texto, palavra por palavra, nas duas pastas.\n");
    await w.index();
    for (const [subject, sourcePath] of [
      ["Segredo", secret],
      ["Visível", visible],
    ] as const) {
      const res = await w.call("POST", "/api/memory/facts", {
        subject,
        predicate: "status",
        object: "ativo",
        sourcePath,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const notes = path.join(w.memory, "notes");
    const ownerFacts = await w.call("GET", "/api/memory/facts");
    expect(ownerFacts.body.facts.map((f: Json) => f.subject).sort()).toEqual(["Segredo", "Visível"]);
    const ownerUnclassified = await w.call("GET", "/api/memory/reviews?kind=unclassified");
    expect(pathsIn(ownerUnclassified.body)).toContain(secret);

    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const device = w.device(["content"]);
    const facts = await w.call("GET", "/api/memory/facts", undefined, device);
    expect(facts.body.facts.map((f: Json) => f.subject)).toEqual(["Visível"]);
    for (const kind of ["due", "unclassified"]) {
      const res = await w.call("GET", `/api/memory/reviews?kind=${kind}`, undefined, device);
      expect(res.status).toBe(200);
      expect(
        pathsIn(res.body).some((p) => p.startsWith(fin + path.sep)),
        kind,
      ).toBe(false);
    }
    expect(
      pathsIn((await w.call("GET", "/api/memory/reviews?kind=unclassified", undefined, device)).body),
    ).toContain(visible);
    const inventoryUrl = `/api/memory/cleanup/inventory?dir=${encodeURIComponent(notes)}`;
    const inventory = await w.call("GET", inventoryUrl, undefined, device);
    expect(inventory.status, JSON.stringify(inventory.body)).toBe(200);
    const started = await w.call("POST", "/api/memory/cleanup/scans", { dir: notes });
    expect(started.status).toBe(202);
    await scanEnded(w, started.body.scanId);
    const ownerScan = await w.call("GET", `/api/memory/cleanup/scans/${started.body.scanId}`);
    expect(
      pathsIn(ownerScan.body),
      "the owner's scan names the hidden copy (the case is not empty)",
    ).toContain(path.join(fin, "copia.md"));
    const scan = await w.call("GET", `/api/memory/cleanup/scans/${started.body.scanId}`, undefined, device);
    expect(scan.status).toBe(200);

    await twin(w);
    expect(stable(inventory.body)).toEqual(stable((await w.call("GET", inventoryUrl)).body));
    const again = await w.call("POST", "/api/memory/cleanup/scans", { dir: notes });
    const twinScan = await scanEnded(w, again.body.scanId);
    const bare = (s: Json) => {
      const { scanId: _id, startedAt: _s, finishedAt: _f, ...rest } = s;
      return stable(rest);
    };
    expect(bare(scan.body)).toEqual(bare(twinScan));
  });
});

describe("C116 dashboards, history, proposals, artifacts and the run diff a device reads", () => {
  it("C116 no item, version, proposal, export or hunk of the hidden folder", async () => {
    const { w, fin, outra, secret, visible } = await seeded();
    // a dashboard that lists the notes of both folders
    const created = await w.call("POST", "/api/dashboards", { template: "overview" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const definition = {
      ...created.body.definition,
      refresh: "manual",
      widgets: [
        { id: "notas", kind: "list", title: "Notas", source: { kind: "notes" }, options: { limit: 50 } },
      ],
    };
    const put = await w.call("PUT", `/api/dashboards/${created.body.id}`, {
      definition,
      baseVersion: created.body.version,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect((await w.call("POST", `/api/dashboards/${created.body.id}/refresh`)).status).toBe(200);
    const ownerBoard = await w.call("GET", `/api/dashboards/${created.body.id}`);
    expect(pathsIn(ownerBoard.body.snapshot), "the owner's snapshot lists the hidden note").toContain(secret);
    // history: a version in each folder, written by the owner's saves
    for (const file of [secret, visible]) {
      const note = await w.call("GET", `/api/memory/note?p=${encodeURIComponent(file)}`);
      const saved = await w.call("PUT", "/api/memory/notes", {
        path: file,
        content: `${note.body.content}\nmais uma linha\n`,
        baseVersion: note.body.version,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    }
    const history = await w.call("GET", "/api/memory/history");
    const hiddenVersion = history.body.versions.find((v: Json) => v.path === "notes/fin/segredo.md");
    expect(hiddenVersion).toBeDefined();
    // proposals: a fact sourced in the hidden folder, a note save into it, and a note save outside it
    const proposal = async (body: Json) => {
      const res = await w.call("POST", "/api/memory/proposals", body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.proposal.id as string;
    };
    const factId = await proposal({
      kind: "fact",
      subject: "S",
      predicate: "p",
      object: "o",
      sourcePath: secret,
    });
    const hiddenSave = await proposal({
      kind: "note_save",
      path: secret,
      content: "x\n",
      baseVersion: "sha256:" + "0".repeat(64),
    });
    const visibleSave = await proposal({
      kind: "note_save",
      path: visible,
      content: "y\n",
      baseVersion: "sha256:" + "0".repeat(64),
    });
    // artifacts: one export and one artifact of a run
    const exported = w.put(
      path.join(w.ctx.paths.artifacts, "exports", "notas-2026-10-31-2330", "a.md"),
      "# exportada\n",
    );
    const runArtifact = w.put(path.join(w.ctx.paths.artifacts, "corrida", "b.md"), "# de uma corrida\n");
    // a run whose diff names a hidden file
    const record = w.ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "x",
      cwd: w.memory,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      startedBy: "owner",
    });
    const ownerDiff = await w.call("GET", `/api/runs/${record.id}/diff?file=${encodeURIComponent(secret)}`);
    expect(ownerDiff.status).toBe(200);
    expect(ownerDiff.body.kind).not.toBe("unavailable");

    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const device = w.device(["content"]);
    // dashboards (G13): no item of the hidden folder, the visible one kept
    const board = await w.call("GET", `/api/dashboards/${created.body.id}`, undefined, device);
    expect(board.status).toBe(200);
    expect(pathsIn(board.body.snapshot)).not.toContain(secret);
    expect(pathsIn(board.body.snapshot)).toContain(visible);
    // history: no version under it, and 404 for one
    const versions = await w.call("GET", "/api/memory/history", undefined, device);
    expect(versions.body.versions.map((v: Json) => v.path)).not.toContain("notes/fin/segredo.md");
    expect(versions.body.versions.map((v: Json) => v.path)).toContain("notes/outra/visivel.md");
    expect(code(await w.call("GET", `/api/memory/history/${hiddenVersion.id}`, undefined, device))).toEqual([
      404,
      "not_found",
    ]);
    expect(
      code(
        await w.call(
          "GET",
          `/api/memory/history?path=${encodeURIComponent("notes/fin/segredo.md")}`,
          undefined,
          device,
        ),
      ),
    ).toEqual([200, undefined]);
    expect(
      (await w.call("GET", `/api/memory/history?path=notes/fin/segredo.md`, undefined, device)).body.versions,
    ).toEqual([]);
    // proposals (G14): neither hidden one is listed, and each is 404
    const listed = await w.call("GET", "/api/memory/proposals", undefined, device);
    expect(listed.body.items.map((p: Json) => p.id)).toEqual([visibleSave]);
    expect(listed.body.total).toBe(1);
    for (const id of [factId, hiddenSave]) {
      expect(code(await w.call("GET", `/api/memory/proposals/${id}`, undefined, device)), id).toEqual([
        404,
        "not_found",
      ]);
    }
    expect((await w.call("GET", `/api/memory/proposals/${visibleSave}`, undefined, device)).status).toBe(200);
    // artifacts (G11): nothing under artifacts/exports/ in the list, the recent ones, file or raw
    const list = await w.call("GET", "/api/artifacts/list", undefined, device);
    expect(list.status).toBe(200);
    expect(pathsIn(list.body).some((p) => p.includes(`${path.sep}exports${path.sep}`))).toBe(false);
    expect(pathsIn(list.body)).toContain(runArtifact);
    const ownerList = await w.call("GET", "/api/artifacts/list");
    expect(pathsIn(ownerList.body), "the owner's list holds the export").toContain(exported);
    const recent = await w.call("GET", "/api/artifacts/recent", undefined, device);
    expect(pathsIn(recent.body).some((p) => p.includes(`${path.sep}exports${path.sep}`))).toBe(false);
    const file = await w.call(
      "GET",
      `/api/artifacts/file?p=${encodeURIComponent(exported)}`,
      undefined,
      device,
    );
    expect(file.status).not.toBe(200);
    expect(JSON.stringify(file.body)).not.toContain("exportada");
    const raw = await w.call(
      "GET",
      `/api/artifacts/raw?p=${encodeURIComponent(exported)}`,
      undefined,
      device,
    );
    expect(raw.status).not.toBe(200);
    expect(
      (await w.call("GET", `/api/artifacts/file?p=${encodeURIComponent(runArtifact)}`, undefined, device))
        .status,
    ).toBe(200);
    // the run diff (G11): no hunk of the hidden file
    const diff = await w.call(
      "GET",
      `/api/runs/${record.id}/diff?file=${encodeURIComponent(secret)}`,
      undefined,
      device,
    );
    expect(diff.status).toBe(200);
    expect(diff.body.kind).toBe("unavailable");
    expect(JSON.stringify(diff.body)).not.toContain("sigiloso");
    expect(fin).toBeTruthy();
    expect(outra).toBeTruthy();
  });
});

// ---- C117 and C118: what a device is answered for a hidden note, and its settings ---------------------------------

describe("C117 a hidden note is not there for a device", () => {
  it("C117 note and preview answer a device 404 not_found, the same body as for a path that does not exist", async () => {
    const { w, fin, secret, visible } = await seeded();
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const device = w.device(["content"]);
    const missing = path.join(fin, "nao-existe.md");
    const missingOutside = path.join(w.memory, "notes", "outra", "nao-existe.md");
    for (const route of ["note", "preview"]) {
      const hidden = await w.call(
        "GET",
        `/api/memory/${route}?p=${encodeURIComponent(secret)}`,
        undefined,
        device,
      );
      expect(code(hidden), route).toEqual([404, "not_found"]);
      const gone = await w.call(
        "GET",
        `/api/memory/${route}?p=${encodeURIComponent(missingOutside)}`,
        undefined,
        device,
      );
      expect(hidden.body, route).toEqual(gone.body);
      expect(
        (await w.call("GET", `/api/memory/${route}?p=${encodeURIComponent(missing)}`, undefined, device))
          .body,
      ).toEqual(gone.body);
      expect(
        (await w.call("GET", `/api/memory/${route}?p=${encodeURIComponent(secret)}`)).status,
        `${route} owner`,
      ).toBe(200);
      expect(
        (await w.call("GET", `/api/memory/${route}?p=${encodeURIComponent(visible)}`, undefined, device))
          .status,
      ).toBe(200);
    }
  });
});

describe("C118 the settings a device reads", () => {
  it("C118 a monitor device's settings have no folderAccess, no hidden indexed folder and no hidden context path; the rest equals the owner's", async () => {
    const { w, fin, outra } = await seeded();
    const shown = w.indexedRoot("visivel");
    const hiddenRoot = w.indexedRoot("escondida");
    w.update((s) => {
      s.contexts = [{ id: "ctx", name: "Ctx", paths: [fin, outra] }];
    });
    await setAccess(w, [
      { path: fin, agents: "write", devices: "hide" },
      { path: hiddenRoot, agents: "write", devices: "hide" },
    ]);
    const owner = (await w.call("GET", "/api/settings")).body;
    const device = (await w.call("GET", "/api/settings", undefined, w.device(["monitor"]))).body;
    expect("folderAccess" in device).toBe(false);
    expect(owner.folderAccess).toHaveLength(2);
    expect(device.indexedFolders.map((f: Json) => f.path)).toEqual([shown]);
    expect(owner.indexedFolders.map((f: Json) => f.path)).toEqual([shown, hiddenRoot]);
    expect(device.contexts).toEqual([{ id: "ctx", name: "Ctx", paths: [outra] }]);
    expect(owner.contexts).toEqual([{ id: "ctx", name: "Ctx", paths: [fin, outra] }]);
    const { folderAccess: _a, indexedFolders: _b, contexts: _c, ...ownerRest } = owner;
    const { indexedFolders: _d, contexts: _e, ...deviceRest } = device;
    expect(deviceRest).toEqual(ownerRest);
  });
});

// ---- C122 to C124: the owner, the tree's marks, the document --------------------------------------------------------

describe("C122 the owner is never bound by a level", () => {
  it("C122 with notes/fin hide for both, the owner gets the hidden note from search, note and tree, and saves it", async () => {
    const { w, fin, secret } = await seeded();
    await setAccess(w, [{ path: fin, agents: "hide", devices: "hide" }]);
    const search = await w.call("GET", "/api/memory/search?q=sigiloso");
    expect(search.status).toBe(200);
    expect(pathsIn(search.body)).toContain(secret);
    const note = await w.call("GET", `/api/memory/note?p=${encodeURIComponent(secret)}`);
    expect(note.status).toBe(200);
    expect(note.body.content).toContain("sigiloso");
    const tree = await w.call("GET", `/api/memory/tree?root=${encodeURIComponent(w.memory)}&dir=notes/fin`);
    expect(tree.status).toBe(200);
    expect(tree.body.files.map((f: Json) => f.name)).toEqual(["segredo.md"]);
    const saved = await w.call("PUT", "/api/memory/notes", {
      path: secret,
      content: "# Segredo financeiro\n\ndo dono\n",
      baseVersion: note.body.version,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(fs.readFileSync(secret, "utf8")).toBe("# Segredo financeiro\n\ndo dono\n");
  });
});

describe("C123 the tree marks a restricted folder", () => {
  it("C123 access on a folder not write/write, inherited levels below an entry, none on write/write; an unknown root is 400", async () => {
    const { w, fin } = await seeded();
    w.put(path.join(fin, "sub", "dentro.md"), "# Dentro\n");
    await w.index();
    await setAccess(w, [{ path: fin, agents: "read", devices: "hide" }]);
    const notes = await w.call("GET", `/api/memory/tree?root=${encodeURIComponent(w.memory)}&dir=notes`);
    expect(notes.status).toBe(200);
    const byName = Object.fromEntries(notes.body.folders.map((f: Json) => [f.name, f]));
    expect(byName.fin.access).toEqual({ agents: "read", devices: "hide" });
    expect("access" in byName.outra).toBe(false);
    expect("access" in byName.fin2).toBe(false);
    const inside = await w.call("GET", `/api/memory/tree?root=${encodeURIComponent(w.memory)}&dir=notes/fin`);
    expect(inside.body.folders.map((f: Json) => [f.name, f.access])).toEqual([
      ["sub", { agents: "read", devices: "hide" }],
    ]);
    expect(code(await w.call("GET", "/api/memory/tree?root=/nao/e/raiz"))).toEqual([400, "unknown_root"]);
  });
});

describe("C124 docs/security.md on the access of folders", () => {
  it("C124 names the three levels, the two audiences, the owner's exemption, 404 for a device and the refusal of Codex and Cursor", () => {
    const doc = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "security.md"), "utf8");
    const start = doc.search(/^#+ .*folder access/im);
    expect(start, "a section on folder access").toBeGreaterThan(-1);
    const rest = doc.slice(start);
    const body = rest.indexOf("\n");
    const next = rest.slice(body).search(/^#{1,2} /m);
    const section = next === -1 ? rest : rest.slice(0, body + next);
    for (const term of [
      "`write`",
      "`read`",
      "`hide`",
      "agents",
      "devices",
      "owner",
      "`404 not_found`",
      "Codex",
      "Cursor",
      "`409 folder_hide_unsupported`",
    ]) {
      expect(section, term).toContain(term);
    }
    expect(section).toMatch(/owner['’]s token[^.]*never|never[^.]*owner/i);
  });
});

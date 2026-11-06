import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fsWatchPayload } from "../core/src/sentinels/fsWatch.js";
import { FIXTURES, order } from "./helpers/searchFixtures.js";
import { code, memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { stream, ticket } from "./helpers/sse.js";

/**
 * .specs/features/cerebro-memoria-confiavel, round 2 of the verification, part B: what a paired device is told that
 * depends on files it may not see (C172 to C177). Over a real home (`memoriaWorld`); `notes/fin` is `hide` for devices
 * and `write` for agents unless a case says so.
 */

const opened: MemoriaWorld[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

async function world(prefix: string): Promise<MemoriaWorld> {
  const w = await memoriaWorld(prefix);
  opened.push(w);
  return w;
}

const hideFromDevices = async (w: MemoriaWorld, entries: string[]) => {
  const res = await w.call("PUT", "/api/settings", {
    folderAccess: entries.map((p) => ({ path: p, agents: "write", devices: "hide" })),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const filler = (n: number): string => Array.from({ length: n }, () => "palavra").join(" ");

/** The twin's edges are worked out from nothing: the index passed again, then every file's edges again. */
async function recomputeEdges(w: MemoriaWorld): Promise<void> {
  await w.index();
  const ids = (w.ctx.db.prepare("SELECT id FROM files").all() as Array<{ id: number }>).map((r) => r.id);
  w.ctx.indexer.refreshRelated(new Set(ids));
}

/**
 * Two notes that share five words, three of them (`zeta planeta orbita`) held by 40 hidden notes more: over the whole
 * corpus those three are "almost everywhere" and weigh nothing, so the pair reads `estrela, galaxia`; in a world
 * without the hidden notes it reads the other three.
 */
async function sharedVocabulary(
  w: MemoriaWorld,
): Promise<{ a: string; b: string; fin: string; outra: string }> {
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  const a = w.put(
    path.join(outra, "a.md"),
    "# A\n\nestrela galaxia nebulosa zeta planeta orbita zeta planeta orbita zeta planeta orbita\n",
  );
  const b = w.put(
    path.join(outra, "b.md"),
    "# B\n\nestrela galaxia cometa zeta planeta orbita zeta planeta orbita zeta planeta orbita\n",
  );
  for (let i = 0; i < 6; i++)
    w.put(path.join(outra, `cheio-${i}.md`), `# Cheio ${i}\n\n${filler(20)} unico${i}x\n`);
  for (let i = 0; i < 40; i++)
    w.put(
      path.join(fin, `h${i}.md`),
      `# H${i}\n\nplaneta orbita zeta ruido${i}a ruido${i}b ruido${i}c ruido${i}d ruido${i}e\n`,
    );
  await w.index();
  return { a, b, fin, outra };
}

const whyOf = (body: unknown, other: string): string | undefined =>
  (body as Json[]).find((r) => r.file.path === other)?.why;

// ---- C113 (round 2): the edges are the twin's from scratch -----------------------------------------------------------

describe("C113 the edges a hidden folder does not change", () => {
  it("C113 a device's related and graph 'Similar content' equal the twin's worked out from nothing, and over the whole corpus they are other", async () => {
    const w = await world("mordomo-round2-c113-");
    const { a, b, fin, outra } = await sharedVocabulary(w);
    const idOf = (file: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    const url = `/api/memory/related?id=${idOf(a)}`;
    const graphUrl = `/api/memory/graph?related=true&maxNodes=400`;
    const similar = (graph: Json) =>
      (graph.edges as Json[])
        .filter((e) => e.kind === "related")
        .map((e) => [e.source, e.target, e.why].join("|"))
        .sort();
    const wholeCorpus = whyOf((await w.call("GET", url)).body, b);
    expect(wholeCorpus, "over the whole corpus the pair is joined by the two words").toMatch(
      /estrela, galaxia/,
    );

    await hideFromDevices(w, [fin]);
    await w.index();
    const device = w.device(["content"]);
    const seen = whyOf((await w.call("GET", url, undefined, device)).body, b);
    const seenGraph = similar((await w.call("GET", graphUrl, undefined, device)).body);

    w.update((s) => {
      s.folderAccess = [];
      s.excludes = [...s.excludes, "fin"];
    });
    await recomputeEdges(w);
    const twin = whyOf((await w.call("GET", url)).body, b);
    expect(twin, "in the twin the pair is joined by the three it shares there").toMatch(
      /zeta|planeta|orbita/,
    );
    expect(twin).not.toBe(wholeCorpus);
    expect(seen).toBe(twin);
    expect(seenGraph).toEqual(similar((await w.call("GET", graphUrl)).body));
    expect(seenGraph.length).toBeGreaterThan(0);
    expect(outra).toBeTruthy();
  });
});

// ---- C172: the related edges of the devices ---------------------------------------------------------------------------

describe("C172 the table of related edges of the devices", () => {
  it("C172 the owner's edges when nothing is hidden; none of the owner's while the pass is owed; the visible files' after it, kept by passes, emptied when shown", async () => {
    const w = await world("mordomo-round2-c172-");
    const { a, b, fin, outra } = await sharedVocabulary(w);
    const idOf = (file: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    const rows = () =>
      (w.ctx.db.prepare("SELECT COUNT(*) c FROM file_related_devices").get() as { c: number }).c;
    const url = `/api/memory/related?id=${idOf(a)}`;
    const device = w.device(["content"]);
    const reads = async () => whyOf((await w.call("GET", url, undefined, device)).body, b);

    // nothing hidden: a device reads the owner's table and there is no copy
    expect(w.ctx.indexer.relatedTable("devices")).toBe("file_related");
    expect(rows()).toBe(0);
    expect(await reads()).toMatch(/estrela, galaxia/);

    // hidden, and the pass that builds the table owed: the owner's edges are not the device's (they were worked out with
    // the hidden notes); it is told of no "similar content" until the pass ends
    w.update((s) => {
      s.folderAccess = [{ path: fin, agents: "write", devices: "hide" }];
    });
    expect(w.ctx.indexer.relatedTable("devices")).toBe("file_related_devices");
    expect(await reads()).toBeUndefined();
    expect(rows()).toBe(0);
    await w.index();
    const built = await reads();
    expect(built).toMatch(/zeta|planeta|orbita/);
    // every edge of the table joins two files the devices may see
    const visibleIds = new Set(
      (w.ctx.db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>)
        .filter((r) => !r.path.startsWith(fin + path.sep))
        .map((r) => r.id),
    );
    const edges = w.ctx.db.prepare("SELECT src_id, dst_id FROM file_related_devices").all() as Array<{
      src_id: number;
      dst_id: number;
    }>;
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(visibleIds.has(e.src_id) && visibleIds.has(e.dst_id)).toBe(true);

    // a hidden note added: the devices' edges are as they were
    w.put(
      path.join(fin, "novo.md"),
      "# Novo\n\nestrela galaxia planeta orbita zeta ruidoa ruidob ruidoc ruidod ruidoe\n",
    );
    await w.index();
    expect(await reads()).toBe(built);

    // a visible note moved into the hidden folder takes its edges with it
    fs.renameSync(b, path.join(fin, "b.md"));
    await w.index();
    expect(await reads()).toBeUndefined();
    expect(
      (
        w.ctx.db
          .prepare("SELECT COUNT(*) c FROM file_related_devices WHERE src_id = ? OR dst_id = ?")
          .get(idOf(path.join(fin, "b.md")), idOf(path.join(fin, "b.md"))) as { c: number }
      ).c,
    ).toBe(0);
    fs.renameSync(path.join(fin, "b.md"), b);
    await w.index();
    expect(await reads()).toMatch(/zeta|planeta|orbita/);

    // shown again: back to the owner's table, the copy emptied
    await w.call("PUT", "/api/settings", { folderAccess: [] });
    await w.index();
    expect(w.ctx.indexer.relatedTable("devices")).toBe("file_related");
    expect(rows()).toBe(0);
    expect(outra).toBeTruthy();
  });
});

// ---- C173: the vector list --------------------------------------------------------------------------------------------

describe("C173 the semantic search a hidden folder does not shorten", () => {
  it("C173 with 60 hidden notes nearer to the question than the 4 visible ones, a device's mode=semantic and auto answer the twin's, via included", async () => {
    const w = await world("mordomo-round2-c173-");
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: true,
        provider: "hash",
      } as typeof s.memory.embeddings;
    });
    const fin = path.join(w.memory, "notes", "fin");
    const outra = path.join(w.memory, "notes", "outra");
    for (let i = 0; i < 60; i++)
      w.put(path.join(fin, `h${i}.md`), `# H${i}\n\nplaneta orbita zeta estrela hidden${i}x\n`);
    const visibleTexts = [
      "planeta orbita lua sol",
      "planeta orbita lua mar",
      "planeta orbita zeta chuva",
      "orbita zeta estrela vento",
    ];
    visibleTexts.forEach((t, i) => w.put(path.join(outra, `v${i}.md`), `# V${i}\n\n${t} ${filler(2)}\n`));
    await w.index();
    expect(w.ctx.semantic.status().vectors).toBe(64);
    const ask = (mode: string) =>
      `/api/memory/search?q=${encodeURIComponent("planeta orbita zeta estrela")}&mode=${mode}&limit=200`;
    const shape = (body: unknown) =>
      (body as Json[]).map((h) => [path.relative(w.memory, h.path as string), h.via, h.score]);

    const ownerSemantic = await w.call("GET", ask("semantic"));
    expect(ownerSemantic.status, JSON.stringify(ownerSemantic.body)).toBe(200);
    expect((ownerSemantic.body as Json[]).length, "the owner's list is full of the hidden notes").toBe(50);

    await hideFromDevices(w, [fin]);
    await w.index();
    const device = w.device(["content"]);
    const seen = {
      semantic: await w.call("GET", ask("semantic"), undefined, device),
      auto: await w.call("GET", ask("auto"), undefined, device),
    };

    w.update((s) => {
      s.folderAccess = [];
      s.excludes = [...s.excludes, "fin"];
    });
    await w.index();
    const twin = {
      semantic: await w.call("GET", ask("semantic")),
      auto: await w.call("GET", ask("auto")),
    };
    expect((twin.semantic.body as Json[]).length, "the twin holds the four").toBe(4);
    for (const mode of ["semantic", "auto"] as const) {
      expect(seen[mode].status, mode).toBe(200);
      // the same files in the same order with the same `via`; the score is the place in the list for a device
      expect(
        shape(seen[mode].body).map(([p, via]) => [p, via]),
        mode,
      ).toEqual(shape(twin[mode].body).map(([p, via]) => [p, via]));
      expect(
        (seen[mode].body as Json[]).map((h) => h.score),
        mode,
      ).toEqual((seen[mode].body as Json[]).map((_, i) => 1 / (i + 1)));
    }
    expect(shape(seen.auto.body).some(([, via]) => via === "both")).toBe(true);
  });
});

// ---- C174: the history of a note that moved ---------------------------------------------------------------------------

describe("C174 the history of a note moved into a hidden folder", () => {
  it("C174 a device is told of no version of a note that went on to a hidden folder, under either path; a copy keeps the original's, a move out its new path's", async () => {
    const w = await world("mordomo-round2-c174-");
    const fin = path.join(w.memory, "notes", "fin");
    const inbox = path.join(w.memory, "notes", "inbox");
    const outra = path.join(w.memory, "notes", "outra");
    // a note with three versions in a visible folder, written by the owner
    const made = await w.call("POST", "/api/memory/notes", {
      title: "Plano",
      folder: "inbox",
      content: "# Plano\n\nversão um sigilosa\n",
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const plano = made.body.path as string;
    for (const text of ["versão dois sigilosa", "versão três sigilosa"]) {
      const read = await w.call("GET", `/api/memory/note?p=${encodeURIComponent(plano)}`);
      const saved = await w.call("PUT", "/api/memory/notes", {
        path: plano,
        content: `# Plano\n\n${text}\n`,
        baseVersion: read.body.version,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    }
    // a second note that moves between two visible folders, a third that is copied into the hidden one, a fourth that
    // starts hidden and moves out
    const mover = w.put(path.join(inbox, "mover.md"), "# Mover\n\nconteúdo que anda entre pastas visíveis\n");
    const copia = w.put(path.join(inbox, "copia.md"), "# Cópia\n\nconteúdo copiado para a pasta oculta\n");
    const sai = w.put(path.join(fin, "sai.md"), "# Sai\n\nconteúdo que sai da pasta oculta\n");
    await w.index();
    fs.mkdirSync(outra, { recursive: true });
    fs.renameSync(mover, path.join(outra, "mover.md"));
    fs.copyFileSync(copia, path.join(fin, "copia-oculta.md"));
    fs.renameSync(sai, path.join(outra, "sai.md"));
    fs.renameSync(plano, path.join(fin, "plano.md"));
    await w.index();
    // a note deleted after a hidden one with the same bytes was already there: it went nowhere, so it keeps its versions
    // (the hidden note began before the deletion, not after the note's last version)
    const gemea = w.put(path.join(fin, "gemea.md"), "# Gêmea\n\nconteúdo igual nas duas pastas\n");
    await w.index();
    const velha = w.put(path.join(inbox, "velha.md"), "# Gêmea\n\nconteúdo igual nas duas pastas\n");
    await w.index();
    fs.rmSync(velha);
    await w.index();
    expect(gemea).toBeTruthy();

    const rel = (file: string) => path.relative(w.memory, file).split(path.sep).join("/");
    const owner = await w.call("GET", "/api/memory/history");
    const ownerOf = (file: string) => (owner.body.versions as Json[]).filter((v) => v.path === rel(file));
    expect(
      ownerOf(plano).length,
      "the owner sees the old path's versions (the case is not empty)",
    ).toBeGreaterThanOrEqual(3);
    const planoIds = ownerOf(plano)
      .filter((v) => v.size !== null)
      .map((v) => v.id as number);
    expect(planoIds.length).toBeGreaterThanOrEqual(3);

    await hideFromDevices(w, [fin]);
    const device = w.device(["content"]);
    const listed = (await w.call("GET", "/api/memory/history?limit=100", undefined, device)).body
      .versions as Json[];
    const listedPaths = new Set(listed.map((v) => v.path as string));
    // the moved note: neither the path it left nor the one it went to
    expect(listedPaths.has(rel(plano))).toBe(false);
    expect(listedPaths.has(rel(path.join(fin, "plano.md")))).toBe(false);
    expect(
      (await w.call("GET", `/api/memory/history?path=${encodeURIComponent(rel(plano))}`, undefined, device))
        .body.versions,
    ).toEqual([]);
    const missing = await w.call("GET", "/api/memory/history/99999", undefined, device);
    for (const id of planoIds) {
      const hidden = await w.call("GET", `/api/memory/history/${id}`, undefined, device);
      expect(code(hidden), `version ${id}`).toEqual([404, "not_found"]);
      expect(hidden.body.error.message.replace(String(id), "N")).toBe(
        missing.body.error.message.replace("99999", "N"),
      );
      expect((await w.call("GET", `/api/memory/history/${id}`)).status, `owner ${id}`).toBe(200);
    }
    // round 3 finding 2 (plan amendment 16): the rule no longer follows the note. A note that moved between two visible
    // folders keeps its versions under the new path only; the old path's, up to the removal, are hidden while a folder is
    // hidden (this was visible under both paths in round 2, and is named in checks.md as the cost of the sound rule)
    expect(listedPaths.has(rel(mover))).toBe(false);
    expect(listedPaths.has(rel(path.join(outra, "mover.md")))).toBe(true);
    // a copy into the hidden folder does not take the original's versions with it: the original is still there
    expect(listedPaths.has(rel(copia))).toBe(true);
    expect(listedPaths.has(rel(path.join(fin, "copia-oculta.md")))).toBe(false);
    // a deleted note has no history for a device either (it may have gone anywhere)
    expect(listedPaths.has(rel(velha))).toBe(false);
    // a note that left the hidden folder: its new path's versions are visible, the old path's are not
    expect(listedPaths.has(rel(path.join(outra, "sai.md")))).toBe(true);
    expect(listedPaths.has(rel(sai))).toBe(false);
    // the owner's list holds every one of them
    expect(
      new Set((owner.body.versions as Json[]).map((v) => v.path as string)).has(
        rel(path.join(fin, "plano.md")),
      ),
    ).toBe(true);
  });
});

// ---- C175: an export under an indexed root ----------------------------------------------------------------------------

describe("C175 the copies an export leaves under an indexed root", () => {
  it("C175 a device ranks over an index without them: its own table when a root holds artifacts/exports/, the order the twin's", async () => {
    const w = await world("mordomo-round2-c175-");
    expect(w.ctx.indexer.audienceTable("devices"), "no root holds the exports: the owner's index").toBe(
      "files_fts",
    );
    const fixture = FIXTURES[0]!;
    const outra = path.join(w.memory, "notes", "outra");
    const exported = path.join(w.ctx.paths.artifacts, "exports", "copia-2026-11-01-0900");
    for (const [name, body] of fixture.visible) w.put(path.join(outra, name), body);
    // the notes of a hidden folder, copied by an export into the folder no device is served
    for (const [name, body] of fixture.hidden) w.put(path.join(exported, name), body);
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: w.ctx.paths.artifacts, area: null, enabled: true }];
    });
    await w.index();
    const url = `/api/memory/search?q=${encodeURIComponent(fixture.query)}&limit=200`;
    expect(
      order((await w.call("GET", url)).body, outra),
      "over the whole index the copies change the order",
    ).toEqual(["b.md", "a.md"]);
    expect(w.ctx.indexer.audienceTable("devices")).toBe("files_fts_devices");
    const device = await w.call("GET", url, undefined, w.device(["content"]));
    expect(JSON.stringify(device.body)).not.toContain(exported);

    w.update((s) => {
      s.excludes = [...s.excludes, "exports"];
    });
    await w.index();
    const twin = await w.call("GET", url);
    expect(order(twin.body, outra)).toEqual(fixture.twin);
    expect(order(device.body, outra)).toEqual(fixture.twin);
  });
});

// ---- C176: the counts of a pass -----------------------------------------------------------------------------------------

describe("C176 the counts a device is given", () => {
  it("C176 a device with a hidden folder reads no count of the index pass, in the status or on the stream; with nothing hidden, as before", async () => {
    const w = await world("mordomo-round2-c176-");
    const fin = path.join(w.memory, "notes", "fin");
    for (let i = 0; i < 25; i++)
      w.put(path.join(fin, `h${i}.md`), `# H${i}\n\nnota oculta número ${i} com texto bastante\n`);
    w.put(path.join(w.memory, "notes", "outra", "v.md"), "# V\n\numa nota visível com texto bastante\n");
    await w.index();
    const device = w.device(["monitor"]);
    const status = async (headers?: Record<string, string>) =>
      (await w.call("GET", "/api/memory/status", undefined, headers)).body;
    const owner = await status();
    expect(owner.lastIndex.stats.scanned, "the pass counted the hidden files too").toBeGreaterThanOrEqual(26);
    // nothing hidden: the device is told what the owner is
    expect((await status(device)).lastIndex.stats).toEqual(owner.lastIndex.stats);

    await hideFromDevices(w, [fin]);
    await w.index();
    const hidden = await status(device);
    const stats = Object.values(hidden.lastIndex.stats as Record<string, number>);
    expect(stats.length).toBeGreaterThan(0);
    expect(stats.every((n) => n === 0)).toBe(true);
    expect(hidden.indexing.scanned).toBe(0);
    expect(hidden.facets.total).toBe(1);
    expect((await status()).lastIndex.stats.scanned, "the owner keeps the count").toBeGreaterThanOrEqual(26);

    // the stream: the counts of a pass that ends while a device listens
    const emit = async () => {
      w.ctx.events.emit("index.finished", {
        stats: {
          scanned: 26,
          added: 26,
          updated: 0,
          removed: 0,
          skippedExcluded: 0,
          skippedBinary: 0,
          related: 0,
          durationMs: 40,
        },
      });
      w.ctx.events.emit("notification.read", { all: true });
    };
    const seen = await stream(
      w,
      `/api/events?ticket=${await ticket(w, device, { target: "events" })}`,
      /notification\.read/,
      emit,
    );
    expect(seen).toContain("index.finished");
    expect(seen).not.toContain('"scanned":26');
    expect(seen).toContain('"scanned":0');
    // nor the row of the inbox that says how many files the pass scanned
    expect(seen).not.toContain("scanned ·");
    expect(
      ((await w.call("GET", "/api/notifications", undefined, device)).body.items as Json[]).map(
        (n) => n.kind,
      ),
    ).not.toContain("index");
    expect(((await w.call("GET", "/api/notifications")).body.items as Json[]).map((n) => n.kind)).toContain(
      "index",
    );
    const own = await stream(
      w,
      `/api/events?ticket=${await ticket(w, w.owner(), { target: "events" })}`,
      /notification\.read/,
      emit,
    );
    expect(own).toContain('"scanned":26');
  });
});

// ---- C177: the name of a hidden folder in what a sentinel says ----------------------------------------------------------

describe("C177 the fs sentinel and a hidden indexed folder", () => {
  it("C177 a row about a folder hidden from the devices is no row for a device, in the inbox, the sentinels and the stream; a visible folder's keeps its name; so does the owner's", async () => {
    const w = await world("mordomo-round2-c177-");
    const cofre = w.indexedRoot("c177-cofre");
    const aberta = w.indexedRoot("c177-aberta");
    const name = path.basename(cofre);
    const open = path.basename(aberta);
    await hideFromDevices(w, [cofre]);
    const device = w.device(["monitor"]);
    // the hidden folder speaks last, so it is the newest row of the inbox and the sentinel's last word
    const fire = () => {
      w.ctx.events.emit("sentinel.fired", fsWatchPayload(aberta, 2));
      w.ctx.events.emit("sentinel.fired", fsWatchPayload(cofre, 3));
    };
    fire();
    const owner = await w.call("GET", "/api/notifications");
    expect(JSON.stringify(owner.body), "the owner is told the name").toContain(name);
    expect(
      (await w.call("GET", "/api/sentinels")).body.sentinels.find((s: Json) => s.id === "fsWatch").lastTitle,
    ).toBe(`3 files changed in ${name}`);

    const inbox = await w.call("GET", "/api/notifications", undefined, device);
    expect((inbox.body.items as Json[]).map((n) => n.title)).toEqual([`2 files changed in ${open}`]);
    expect(inbox.body.unread).toBe(1);
    expect(JSON.stringify(inbox.body)).not.toContain(name);

    const sentinels = await w.call("GET", "/api/sentinels", undefined, device);
    expect(JSON.stringify(sentinels.body)).not.toContain(name);
    expect((sentinels.body.sentinels as Json[]).find((s) => s.id === "fsWatch")!.lastTitle).toBe(
      `2 files changed in ${open}`,
    );

    const streamed = await stream(
      w,
      `/api/events?ticket=${await ticket(w, device, { target: "events" })}`,
      /notification\.read/,
      async () => {
        fire();
        w.ctx.events.emit("notification.read", { all: true });
      },
    );
    expect(streamed).toContain(`2 files changed in ${open}`);
    expect(streamed).not.toContain(name);
    expect(streamed).not.toContain("3 files changed");
  });
});

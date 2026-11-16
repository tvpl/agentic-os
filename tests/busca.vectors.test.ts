import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { hashEmbed, hashProvider, vectorToBlob } from "../core/src/memory/embeddings.js";
import { SemanticSearch } from "../core/src/memory/semantic.js";
import { VectorIndex } from "../core/src/memory/vectors.js";
import {
  buscaWorld,
  code,
  embeddingsServer,
  type BuscaWorld,
  type EmbeddingsServer,
  type Json,
} from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S3 at the boundary: what an index pass writes to `section_vectors`, read
 * back; the status and the search over sections, through `app.inject` against `buildServer` over a real home.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const worlds: BuscaWorld[] = [];
const servers: EmbeddingsServer[] = [];
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  for (const s of servers) await s.close();
  for (const w of worlds) await w.close();
});

async function world(prefix: string): Promise<BuscaWorld> {
  const w = await buscaWorld(prefix);
  worlds.push(w);
  return w;
}
async function server(dim: number): Promise<EmbeddingsServer> {
  const s = await embeddingsServer(dim);
  servers.push(s);
  return s;
}
function httpOn(w: BuscaWorld, url: string, model: string, dimensions: number): void {
  w.update((s) => {
    s.memory.embeddings = {
      ...s.memory.embeddings,
      enabled: true,
      provider: "http",
      endpoint: url,
      model,
      dimensions,
    } as typeof s.memory.embeddings;
  });
}
/** The texts the `hash` provider is given from here on. */
function spyHash(): string[] {
  const sent: string[] = [];
  const embed = hashProvider.embed.bind(hashProvider);
  vi.spyOn(hashProvider, "embed").mockImplementation(async (texts, signal) => {
    sent.push(...texts);
    return embed(texts, signal);
  });
  return sent;
}
const mtimeOf = (file: string) => Math.floor(fs.statSync(file).mtimeMs);
const sections = (n: number, word = "assunto") =>
  Array.from({ length: n }, (_, i) => `## Seção ${i + 1}\n\n${word} número ${i + 1} do texto\n`).join("\n");
const status = async (w: BuscaWorld, headers?: Record<string, string>, query = "") => {
  const res = await w.call("GET", `/api/memory/status${query}`, undefined, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.semantic as Json;
};

describe("C20 what is embedded, by kind of file", () => {
  it("C20 a .txt of 40, 41 and 80 lines gives 1, 2 and 2 rows; a .markdown splits by headings; a .json and a .pdf get none", async () => {
    const w = await world("mordomo-busca-c20-");
    const root = w.indexedRoot("c20");
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `linha ${i + 1}`).join("\n") + "\n";
    const t40 = w.put(path.join(root, "quarenta.txt"), lines(40));
    const t41 = w.put(path.join(root, "quarenta-e-um.txt"), lines(41));
    const t80 = w.put(path.join(root, "oitenta.txt"), lines(80));
    const md = w.put(path.join(root, "nota.markdown"), "antes\n# A\ncorpo\n## B\nmais\n");
    const json = w.put(path.join(root, "dados.json"), '{"texto": "palavras de um json"}\n');
    const pdf = w.put(path.join(root, "doc.pdf"), "palavras de um pdf\n");
    w.hashOn();
    await w.index();
    const at = (file: string) => w.rowsOf(file).map((r) => [r.ord, r.start_line, r.end_line]);
    expect(at(t40)).toEqual([[0, 1, 40]]);
    expect(at(t41)).toEqual([
      [0, 1, 40],
      [1, 41, 41],
    ]);
    expect(at(t80)).toEqual([
      [0, 1, 40],
      [1, 41, 80],
    ]);
    expect(w.rowsOf(md).map((r) => r.heading)).toEqual(["(top)", "A", "A > B"]);
    expect(w.rowsOf(json)).toEqual([]);
    expect(w.rowsOf(pdf)).toEqual([]);
  });
});

describe("C21 the rows a pass writes", () => {
  it("C21 heading paths, lines, ord with no gap, provider, dim, mtime and size, read back; the table is door 1's", async () => {
    const w = await world("mordomo-busca-c21-");
    w.hashOn();
    const nested = w.note("aninhada", "# A\ncorpo a\n## B\ncorpo b\n### C\ncorpo c\n");
    const skipped = w.note("pulada", "# A\ncorpo a\n### C\ncorpo c\n## D\ncorpo d\n");
    const preamble = w.note("preambulo", "antes de tudo\n\n# A\ncorpo\n");
    const one = w.note("uma", "# Só\n\numa seção\n");
    const gap = w.note("lacuna", "# A\ncorpo a\n### Vazia\n\n#### C\ncorpo c\n");
    await w.index();
    const shape = (file: string) => w.rowsOf(file).map((r) => [r.ord, r.heading, r.start_line, r.end_line]);
    expect(shape(nested)).toEqual([
      [0, "A", 2, 2],
      [1, "A > B", 4, 4],
      [2, "A > B > C", 6, 6],
    ]);
    expect(shape(skipped)).toEqual([
      [0, "A", 2, 2],
      [1, "A > C", 4, 4],
      [2, "A > D", 6, 6],
    ]);
    expect(shape(preamble)).toEqual([
      [0, "(top)", 1, 1],
      [1, "A", 4, 4],
    ]);
    expect(shape(one)).toEqual([[0, "Só", 3, 3]]);
    expect(shape(gap)).toEqual([
      [0, "A", 2, 2],
      [1, "A > Vazia > C", 6, 6],
    ]);
    for (const file of [nested, skipped, preamble, one, gap])
      for (const row of w.rowsOf(file)) {
        expect(row).toMatchObject({
          provider: "hash-v1:256",
          dim: 256,
          mtime: mtimeOf(file),
          size: fs.statSync(file).size,
        });
        expect(row.vec.length).toBe(256 * 4);
      }
    const columns = (w.ctx.db.pragma("table_info(section_vectors)") as Json[]).map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      pk: c.pk,
    }));
    expect(columns).toEqual([
      { name: "file_id", type: "INTEGER", notnull: 1, pk: 1 },
      { name: "ord", type: "INTEGER", notnull: 1, pk: 2 },
      { name: "heading", type: "TEXT", notnull: 1, pk: 0 },
      { name: "start_line", type: "INTEGER", notnull: 1, pk: 0 },
      { name: "end_line", type: "INTEGER", notnull: 1, pk: 0 },
      { name: "provider", type: "TEXT", notnull: 1, pk: 0 },
      { name: "dim", type: "INTEGER", notnull: 1, pk: 0 },
      { name: "vec", type: "BLOB", notnull: 1, pk: 0 },
      { name: "mtime", type: "INTEGER", notnull: 1, pk: 0 },
      { name: "size", type: "INTEGER", notnull: 1, pk: 0 },
    ]);
  });
});

describe("C22 the limit of 64 sections", () => {
  it("C22 64 non-empty sections give 64 rows; 65 give 64 and no row carries the 65th heading", async () => {
    const w = await world("mordomo-busca-c22-");
    w.hashOn();
    const at64 = w.note("sessenta-e-quatro", sections(64));
    const at65 = w.note("sessenta-e-cinco", sections(65));
    await w.index();
    expect(w.rowsOf(at64).map((r) => r.ord)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    const rows = w.rowsOf(at65);
    expect(rows.map((r) => r.ord)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(rows.at(-1)!.heading).toBe("Seção 64");
    expect(rows.some((r) => r.heading === "Seção 65")).toBe(false);
  });
});

describe("C24 only what changed is recomputed", () => {
  it("C24 a changed note sends its sections only, a removed section loses its row, an unchanged pass sends nothing, a deleted file keeps no row", async () => {
    const w = await world("mordomo-busca-c24-");
    w.hashOn();
    const a = w.note(
      "alfa",
      "# Alfa\n\n## Um\nprimeiro alfa\n## Dois\nsegundo alfa\n## Três\nterceiro alfa\n",
    );
    const b = w.note("beta", "# Beta\n\n## Um\nprimeiro beta\n");
    const c = w.note("gama", "# Gama\n\n## Um\nprimeiro gama\n## Dois\nsegundo gama\n");
    await w.index();
    const before = { b: w.rowsOf(b), c: w.rowsOf(c) };
    expect(w.rowsOf(a)).toHaveLength(3);

    // the note changes (its text, its size and its mtime) and loses a section
    const sent = spyHash();
    w.put(a, "# Alfa\n\n## Um\nprimeiro alfa reescrito\n## Dois\nsegundo alfa\n");
    fs.utimesSync(a, new Date("2026-11-16T10:05:00"), new Date("2026-11-16T10:05:00"));
    await w.index();
    expect(sent).toHaveLength(2);
    expect(sent.every((t) => t.startsWith("Alfa > Alfa > "))).toBe(true);
    expect(w.rowsOf(b)).toEqual(before.b);
    expect(w.rowsOf(c)).toEqual(before.c);
    expect(w.rowsOf(a).map((r) => [r.ord, r.heading])).toEqual([
      [0, "Alfa > Um"],
      [1, "Alfa > Dois"],
    ]);
    expect(w.rowsOf(a).every((r) => r.mtime === mtimeOf(a) && r.size === fs.statSync(a).size)).toBe(true);

    // a third pass with nothing changed sends nothing
    sent.length = 0;
    await w.index();
    expect(sent).toEqual([]);

    // a deleted file has no row left
    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(b) as { id: number }).id;
    fs.rmSync(b);
    await w.index();
    expect(w.ctx.db.prepare("SELECT COUNT(*) AS n FROM section_vectors WHERE file_id = ?").get(id)).toEqual({
      n: 0,
    });
  });
});

describe("C25 a difference of provider, dimension or model recomputes every row", () => {
  it("C25 hash to http, 8 to 16 dimensions, and embeddings off, each read back after the pass", async () => {
    const w = await world("mordomo-busca-c25-");
    w.hashOn();
    w.note("um", "# Um\n\n## A\nprimeiro\n## B\nsegundo\n");
    w.note("dois", "# Dois\n\nsó um corpo\n");
    await w.index();
    expect(new Set(w.allRows().map((r) => r.provider))).toEqual(new Set(["hash-v1:256"]));
    const count = w.allRows().length;
    expect(count).toBe(3);

    const s8 = await server(8);
    httpOn(w, s8.url, "modelo", 8);
    await w.index();
    expect(w.allRows()).toHaveLength(count);
    expect(w.allRows().every((r) => r.provider === "http:modelo:8" && r.dim === 8)).toBe(true);

    const s16 = await server(16);
    httpOn(w, s16.url, "modelo", 16);
    await w.index();
    expect(w.allRows()).toHaveLength(count);
    expect(w.allRows().every((r) => r.provider === "http:modelo:16" && r.dim === 16)).toBe(true);

    w.update((s) => {
      s.memory.embeddings = { ...s.memory.embeddings, enabled: false };
    });
    await w.index();
    expect(w.allRows()).toEqual([]);
    expect((await status(w)).sections).toBe(0);
  });
});

describe("C26 a provider failure mid-pass keeps what was written", () => {
  it("C26 a 500 on the second batch keeps the first batch's rows, records the error, finishes the pass; the next pass fills the rest", async () => {
    const w = await world("mordomo-busca-c26-");
    for (let i = 0; i < 20; i++)
      w.note(`nota-${String(i).padStart(2, "0")}`, `# Nota ${i}\n\nconteúdo da nota ${i}\n`);
    await w.index();
    const s = await server(8);
    s.fail = (n) => n === 2;
    httpOn(w, s.url, "modelo", 8);
    const events: string[] = [];
    const unsubscribe = w.ctx.events.subscribe((e) => void events.push(e.type));
    await w.index();
    unsubscribe();
    expect(s.bodies.map((b) => b.input.length)).toEqual([16, 4]);
    const rows = w.allRows();
    expect(rows).toHaveLength(16);
    // the rows are the sections of the first batch
    const firstBatch = new Set(s.bodies[0]!.input);
    const ids = w.ctx.db
      .prepare("SELECT id FROM files WHERE ext = '.md' ORDER BY id LIMIT 16")
      .all() as Json[];
    expect(rows.map((r) => r.file_id)).toEqual(ids.map((r) => r.id));
    expect(firstBatch.size).toBe(16);
    const stored = JSON.parse(
      (
        w.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.semantic_error'").get() as {
          value: string;
        }
      ).value,
    );
    expect(Object.keys(stored).sort()).toEqual(["at", "kind", "message"]);
    expect(stored.kind).toBe("status");
    expect(typeof stored.at).toBe("number");
    expect(stored.message).toBe("the endpoint answered 500");
    expect(events).toContain("index.finished");
    expect(events).not.toContain("index.failed");
    expect((await status(w)).error).toBe("the endpoint answered 500");

    s.fail = () => false;
    await w.index();
    expect(w.allRows()).toHaveLength(20);
    expect((await status(w)).error).toBeNull();
  });
});

describe("C27 http never sends what today's policy refuses", () => {
  it("C27 an excluded file, a file under the home's config/ and a folder whose grant was revoked are never sent; a folder hidden from devices only is", async () => {
    const w = await world("mordomo-busca-c27-");
    const kept = w.indexedRoot("mantida");
    const revoked = w.indexedRoot("revogada");
    w.put(path.join(kept, "visivel.md"), "# Visível\n\num texto que pode sair VISIVELTOKEN\n");
    w.put(path.join(kept, "privado", "excluida.md"), "# Excluída\n\nEXCLUIDATOKEN não sai\n");
    w.put(path.join(revoked, "antiga.md"), "# Antiga\n\nREVOGADATOKEN não sai\n");
    const hiddenDir = path.join(w.memory, "notes", "fin");
    const hidden = w.put(path.join(hiddenDir, "oculta.md"), "# Oculta\n\nOCULTATOKEN só do dono\n");
    // indexed while nothing was sent
    await w.index();
    // a row under the home's config/, as an old index could hold it
    const configRow = w.row(w.home, "config/segredo.md", { title: "Segredo" });
    w.ctx.db
      .prepare(
        "INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, 'segredo.md', 'config/segredo.md', ?)",
      )
      .run(configRow, "# Segredo\n\nCONFIGTOKEN não sai\n");
    // the owner excludes a folder, revokes the other's grant, hides a folder from the devices and turns http on
    const res = await w.call("PUT", "/api/settings", {
      folderAccess: [{ path: hiddenDir, agents: "write", devices: "hide" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    w.update((s) => {
      s.excludes = [...s.excludes, "privado"];
      s.indexedFolders = s.indexedFolders.map((f) => (f.path === revoked ? { ...f, enabled: false } : f));
    });
    const s = await server(8);
    httpOn(w, s.url, "modelo", 8);
    // a pass over a few paths (a note just saved), then a full pass
    await w.ctx.indexer.requestIndexPaths([w.note("nova", "# Nova\n\numa nota nova\n")]);
    await w.index();
    const sent = s.bodies.flatMap((b) => b.input).join("\n");
    for (const token of ["EXCLUIDATOKEN", "CONFIGTOKEN", "REVOGADATOKEN"])
      expect(sent, token).not.toContain(token);
    expect(sent).toContain("VISIVELTOKEN");
    // hidden from devices only: embedded (the owner reads it), never counted, ranked or named for a device
    expect(sent).toContain("OCULTATOKEN");
    expect(w.rowsOf(hidden)).toHaveLength(1);
    const device = w.device(["content"]);
    for (const mode of ["semantic", "auto"]) {
      const hits = await w.call(
        "GET",
        `/api/memory/search?q=OCULTATOKEN%20dono&mode=${mode}`,
        undefined,
        device,
      );
      expect(hits.status).toBe(200);
      expect(JSON.stringify(hits.body)).not.toContain("oculta");
    }
    const owner = await status(w);
    const seen = await status(w, device);
    expect(owner.sections - seen.sections).toBe(1);
    expect(owner.vectors - seen.vectors).toBe(1);
  });
});

describe("C29 a semantic hit names its best section", () => {
  const NOTE =
    "# Nota\n\n## Primeira\n\nO jardim tem roseiras vermelhas e um banco de pedra.\n\n## Segunda\n\nA bicicleta azul fica pendurada na parede da garagem.\n\n## Terceira\n\nA geladeira da cozinha foi trocada em maio.\n";
  const QUESTION = "bicicleta azul pendurada parede garagem";
  const SECOND_LINE = NOTE.split("\n").findIndex((l) => l.startsWith("A bicicleta")) + 1;

  it("C29 in semantic and auto the hit carries section and line of the second section; in text it carries neither", async () => {
    const w = await world("mordomo-busca-c29-");
    w.hashOn();
    w.note("nota", NOTE);
    w.note("outra", "# Outra\n\nUma nota sobre receitas de bolo de cenoura.\n");
    await w.index();
    expect(SECOND_LINE).toBe(9);
    for (const mode of ["semantic", "auto"]) {
      const res = await w.call("GET", `/api/memory/search?q=${encodeURIComponent(QUESTION)}&mode=${mode}`);
      expect(res.status).toBe(200);
      const hit = (res.body as Json[]).find((h) => h.name === "nota.md")!;
      expect(hit, mode).toMatchObject({ section: "Nota > Segunda", line: SECOND_LINE });
    }
    const text = await w.call("GET", `/api/memory/search?q=${encodeURIComponent(QUESTION)}&mode=text`);
    expect(text.status).toBe(200);
    expect((text.body as Json[]).length).toBeGreaterThan(0);
    for (const hit of text.body as Json[]) {
      expect(Object.keys(hit)).not.toContain("section");
      expect(Object.keys(hit)).not.toContain("line");
    }
  });

  it("C29 at its own layer, a file's similarity is its best section's: one section at 0.9 ranks above three at 0.6", async () => {
    const w = await world("mordomo-busca-c29-layer-");
    const x = w.row("/r", "x.md");
    const y = w.row("/r", "y.md");
    const at = (cos: number) => vectorToBlob(new Float32Array([cos, Math.sqrt(1 - cos * cos)]));
    const insert = w.ctx.db.prepare(
      "INSERT INTO section_vectors (file_id, ord, heading, start_line, end_line, provider, dim, vec, mtime, size) VALUES (?, ?, ?, ?, ?, 't:2', 2, ?, 1, 1)",
    );
    insert.run(x, 0, "X", 1, 1, at(0.9));
    for (let ord = 0; ord < 3; ord++) insert.run(y, ord, `Y${ord}`, ord + 1, ord + 1, at(0.6));
    const query = new Float32Array([1, 0]);
    for (const loader of [
      undefined,
      () => {
        throw new Error("no sqlite-vec");
      },
    ]) {
      const ranked = new VectorIndex(w.ctx.db, loader).rank(
        query,
        { id: "t:2", dim: 2 },
        { sql: "", params: [] },
        10,
      );
      expect(ranked.map((r) => [r.id, r.ord, r.section])).toEqual([
        [x, 0, "X"],
        [y, 0, "Y0"],
      ]);
      expect(ranked[0]!.similarity).toBeCloseTo(0.9, 5);
      expect(ranked[1]!.similarity).toBeCloseTo(0.6, 5);
    }
  });
});

describe("C31 the status of the semantic search", () => {
  it("C31 exactly its keys; sections 6 and vectors 3 over notes of 2, 1 and 3 sections; a device without the hidden rows; context narrows neither", async () => {
    const w = await world("mordomo-busca-c31-");
    w.hashOn();
    w.note("duas", "# Duas\n\n## A\num\n## B\ndois\n");
    w.note("unica", "# Única\n\nsozinha aqui\n");
    const hiddenDir = path.join(w.memory, "notes", "fin");
    w.put(path.join(hiddenDir, "tres.md"), "# Três\n\n## A\num\n## B\ndois\n## C\ntrês\n");
    await w.index();
    const owner = await status(w);
    expect(Object.keys(owner).sort()).toEqual(
      ["enabled", "provider", "backend", "vectors", "sections", "model", "blocked", "error"].sort(),
    );
    expect(owner).toMatchObject({
      enabled: true,
      provider: "hash-v1:256",
      sections: 6,
      vectors: 3,
      model: null,
    });

    const created = await w.call("POST", "/api/contexts", { name: "Só fin", paths: [hiddenDir] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await status(w, undefined, `?context=${created.body.id}`)).toEqual(owner);

    const res = await w.call("PUT", "/api/settings", {
      folderAccess: [{ path: hiddenDir, agents: "write", devices: "hide" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await w.index();
    const device = await status(w, w.device(["content"]));
    expect(device).toMatchObject({ sections: 3, vectors: 2, model: null });
  });
});

describe("C32 the readers of the old table read sections, and the search's refusals stay", () => {
  it("C32 with hash on and no section row, auto answers text and semantic []; other, nao-existe and off answer as before", async () => {
    const w = await world("mordomo-busca-c32-");
    w.note("jardim", "# Jardim\n\nAs roseiras do jardim são podadas em julho.\n");
    w.note("cozinha", "# Cozinha\n\nA geladeira da cozinha foi trocada.\n");
    await w.index();
    w.hashOn();
    expect(w.allRows()).toEqual([]);
    const ask = (mode: string, extra = "") =>
      w.call("GET", `/api/memory/search?q=jardim%20roseiras&mode=${mode}${extra}`);
    const text = await ask("text");
    expect(text.status).toBe(200);
    expect((text.body as Json[]).map((h) => h.name)).toEqual(["jardim.md"]);
    expect((await ask("auto")).body).toEqual(text.body);
    const semantic = await ask("semantic");
    expect([semantic.status, semantic.body]).toEqual([200, []]);
    expect(code(await ask("other"))).toEqual([400, "validation"]);
    expect(code(await ask("auto", "&context=nao-existe"))).toEqual([404, "context_not_found"]);
    w.update((s) => {
      s.memory.embeddings = { ...s.memory.embeddings, enabled: false };
    });
    expect(code(await ask("semantic"))).toEqual([409, "semantic_disabled"]);
  });

  it("C32 no source file under core/, apps/ or contracts/ names file_vectors outside migrations 21 and 34's SQL", async () => {
    const { MIGRATIONS } = await import("../core/src/db/migrations.js");
    const count = (text: string) => text.split("file_vectors").length - 1;
    const inSql =
      count(MIGRATIONS.find((m) => m.version === 21)!.sql!) +
      count(MIGRATIONS.find((m) => m.version === 34)!.sql!);
    expect(inSql).toBe(2);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", "dist", ".tmp"].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
          const n = count(fs.readFileSync(full, "utf8"));
          if (n > 0) found.push(`${path.relative(repoRoot, full)}:${n}`);
        }
      }
    };
    for (const dir of ["core", "apps", "contracts"]) walk(path.join(repoRoot, dir));
    expect(found).toEqual([`core/src/db/migrations.ts:${inSql}`]);
  });
});

describe("C33 the two backends rank sections the same way", () => {
  it("C33 with sqlite-vec and with the loader failing, the same sections in the same order, ties to the lower file id then ord", async () => {
    const w = await world("mordomo-busca-c33-");
    w.hashOn();
    const root = w.indexedRoot("c33");
    w.note(
      "jardim",
      "# Jardim\n\n## Rosas\nAs roseiras são podadas em julho.\n## Banco\nUm banco de pedra no jardim.\n",
    );
    w.note(
      "garagem",
      "# Garagem\n\n## Bicicleta\nA bicicleta azul fica na parede.\n## Carro\nO carro velho do avô.\n",
    );
    // two files of the same text (a tie between files) and a .txt whose two blocks are the same (a tie inside a file)
    w.put(path.join(root, "igual-1.md"), "# Igual\n\numa frase sobre o jardim e a garagem\n");
    w.put(path.join(root, "igual-2.md"), "# Igual\n\numa frase sobre o jardim e a garagem\n");
    const block = Array.from({ length: 40 }, () => "linha sobre o jardim da casa").join("\n");
    const twin = w.put(path.join(root, "blocos.txt"), `${block}\n${block}\n`);
    await w.index();
    expect(w.rowsOf(twin).map((r) => r.ord)).toEqual([0, 1]);
    const sqlite = new VectorIndex(w.ctx.db);
    const js = new VectorIndex(w.ctx.db, () => {
      throw new Error("no sqlite-vec");
    });
    expect(sqlite.backend()).toBe("sqlite-vec");
    expect(js.backend()).toBe("js");
    const ids = Object.fromEntries(
      (w.ctx.db.prepare("SELECT id, name FROM files").all() as Json[]).map((r) => [r.name, r.id]),
    );
    for (const question of [
      "roseiras podadas",
      "bicicleta azul parede",
      "frase jardim garagem",
      "jardim da casa",
      "carro",
    ]) {
      const query = hashEmbed(question);
      const a = sqlite.rank(query, hashProvider, { sql: "", params: [] }, 50);
      const b = js.rank(query, hashProvider, { sql: "", params: [] }, 50);
      expect(a.length, question).toBeGreaterThan(0);
      expect(
        b.map((r) => [r.id, r.ord, r.section, r.line]),
        question,
      ).toEqual(a.map((r) => [r.id, r.ord, r.section, r.line]));
      b.forEach((r, i) => expect(r.similarity).toBeCloseTo(a[i]!.similarity, 5));
    }
    for (const index of [sqlite, js]) {
      const tie = index.rank(hashEmbed("frase jardim garagem"), hashProvider, { sql: "", params: [] }, 50);
      const first = tie.findIndex((r) => r.id === ids["igual-1.md"]);
      const second = tie.findIndex((r) => r.id === ids["igual-2.md"]);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBe(first + 1);
      expect(ids["igual-1.md"]).toBeLessThan(ids["igual-2.md"]);
      const blocks = index.rank(hashEmbed("linha jardim casa"), hashProvider, { sql: "", params: [] }, 50);
      expect(blocks.find((r) => r.id === ids["blocos.txt"])).toMatchObject({ ord: 0, line: 1 });
    }
  });
});

describe("C34 passes at the same time", () => {
  it("C34 two POST /api/memory/index together give one pass, and the table holds one row per (file_id, ord), as many as sections", async () => {
    const w = await world("mordomo-busca-c34-");
    w.hashOn();
    for (let i = 0; i < 30; i++) w.note(`nota-${i}`, `# Nota ${i}\n\n${sections(3, `tema${i}`)}`);
    const events: string[] = [];
    const unsubscribe = w.ctx.events.subscribe((e) => void events.push(e.type));
    const [one, two] = await Promise.all([
      w.call("POST", "/api/memory/index", {}),
      w.call("POST", "/api/memory/index", {}),
    ]);
    unsubscribe();
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(two.body).toEqual(one.body);
    expect(events.filter((t) => t === "index.started")).toHaveLength(1);
    expect(events.filter((t) => t === "index.finished")).toHaveLength(1);
    expect(
      w.ctx.db
        .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT file_id || ':' || ord) AS d FROM section_vectors")
        .get(),
    ).toEqual({ n: 90, d: 90 });
  });
});

describe("C35 the search in JavaScript over 20 000 sections", () => {
  it("C35 with the JavaScript backend forced and 20 000 rows of 256 dimensions, one mode=semantic search answers in under 1 000 ms", async () => {
    const w = await world("mordomo-busca-c35-");
    w.hashOn();
    const insertFile = w.ctx.db.prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES ('/r', ?, ?, ?, '.md', '/r', NULL, 1, 1, 1, NULL, '[]', '{}')",
    );
    const insertRow = w.ctx.db.prepare(
      "INSERT INTO section_vectors (file_id, ord, heading, start_line, end_line, provider, dim, vec, mtime, size) VALUES (?, ?, ?, 1, 1, 'hash-v1:256', 256, ?, 1, 1)",
    );
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    w.ctx.db.transaction(() => {
      for (let f = 0; f < 2_500; f++) {
        const id = Number(insertFile.run(`/r/n${f}.md`, `n${f}.md`, `n${f}.md`).lastInsertRowid);
        for (let ord = 0; ord < 8; ord++) {
          const v = Float32Array.from({ length: 256 }, random);
          const norm = Math.hypot(...v);
          insertRow.run(id, ord, `S${ord}`, vectorToBlob(v.map((x) => x / norm)));
        }
      }
    })();
    expect(w.allRows()).toHaveLength(20_000);
    (w.ctx as unknown as { semantic: SemanticSearch }).semantic = new SemanticSearch(
      w.ctx.db,
      () => w.ctx.settings(),
      () => {
        throw new Error("the JavaScript backend, forced");
      },
    );
    const started = performance.now();
    const res = await w.call("GET", "/api/memory/search?q=planeta%20orbita%20estrela&mode=semantic");
    const ms = performance.now() - started;
    expect(res.status).toBe(200);
    console.log(
      `[C35] one mode=semantic search over 20 000 sections, JavaScript backend: ${ms.toFixed(0)} ms`,
    );
    expect(ms).toBeLessThan(1_000);
  });
});

describe("C37 sections with nothing to embed", () => {
  it("C37 a section with no letter or digit gets no row; one whose vector is all zeros gets none and leaves no older row", async () => {
    const w = await world("mordomo-busca-c37-");
    w.hashOn();
    const marks = w.note("marcas", "## A\ntexto um\n## B\n--- *** ...\n## C\ntexto três\n");
    const stop = w.note("vazia", "## Tema\npalavra verdadeira\n");
    await w.index();
    expect(w.rowsOf(marks).map((r) => [r.ord, r.heading])).toEqual([
      [0, "A"],
      [1, "C"],
    ]);
    expect(w.rowsOf(stop)).toHaveLength(1);
    // only stop words, with no title and no area: the hash provider gives all zeros
    w.put(stop, "## de\nque para com o a\n");
    fs.utimesSync(stop, new Date("2026-11-16T10:05:00"), new Date("2026-11-16T10:05:00"));
    expect(hashEmbed("de\nque para com o a").every((n) => n === 0)).toBe(true);
    await w.index();
    expect(w.rowsOf(stop)).toEqual([]);
  });
});

describe("C38 the progress of the vectors phase, in sections", () => {
  it("C38 index.progress with phase vectors counts sections, the last with scanned = total", async () => {
    const w = await world("mordomo-busca-c38-");
    w.hashOn();
    for (let i = 0; i < 25; i++) w.note(`nota-${i}`, sections(10, `tema${i}`));
    const progress: Json[] = [];
    const unsubscribe = w.ctx.events.subscribe(
      (e) =>
        e.type === "index.progress" &&
        (e.payload as Json).phase === "vectors" &&
        void progress.push(e.payload as Json),
    );
    await w.index();
    unsubscribe();
    expect(w.allRows()).toHaveLength(250);
    expect(progress.map((p) => [p.scanned, p.total])).toEqual([
      [200, 250],
      [250, 250],
    ]);
  });
});

describe("C39 the independent test of S3", () => {
  it("C39 a note with three titled sections gives three rows with their paths, and a phrase of the second finds it with that section and line", async () => {
    const w = await world("mordomo-busca-c39-");
    w.hashOn();
    const text =
      "# Viagem\n\n## Passagens\n\nAs passagens de avião foram compradas em setembro.\n\n## Hotel\n\nO hotel fica perto da praia e tem café da manhã incluído.\n\n## Passeios\n\nUm passeio de barco pelas ilhas no terceiro dia.\n";
    const file = w.note("viagem", text);
    w.note("outra", "# Outra\n\nUma lista de compras do mercado.\n");
    await w.index();
    expect(w.rowsOf(file).map((r) => r.heading)).toEqual([
      "Viagem > Passagens",
      "Viagem > Hotel",
      "Viagem > Passeios",
    ]);
    const res = await w.call(
      "GET",
      `/api/memory/search?q=${encodeURIComponent("hotel perto da praia café da manhã")}&mode=semantic`,
    );
    expect(res.status).toBe(200);
    const hit = (res.body as Json[])[0]!;
    const line = text.split("\n").findIndex((l) => l.startsWith("O hotel")) + 1;
    expect(hit).toMatchObject({ name: "viagem.md", section: "Viagem > Hotel", line });
  });
});

describe("C40 the batch's rows in one transaction", () => {
  it("C40 a reader polling from another connection during a pass only ever counts whole batches", async () => {
    const w = await world("mordomo-busca-c40-");
    w.hashOn();
    for (let i = 0; i < 100; i++) w.note(`nota-${i}`, sections(10, `tema${i}`));
    const dbFile = w.ctx.paths.dbFile;
    const stop = new Int32Array(new SharedArrayBuffer(4));
    const reader = new Worker(
      `
      const { workerData, parentPort } = require("node:worker_threads");
      const Database = require(workerData.driver);
      const db = new Database(workerData.dbFile, { readonly: true, fileMustExist: true });
      db.pragma("busy_timeout = 5000");
      const flag = new Int32Array(workerData.stop);
      const count = db.prepare("SELECT COUNT(*) AS n FROM section_vectors");
      const seen = new Set();
      while (Atomics.load(flag, 0) === 0) seen.add(count.get().n);
      seen.add(count.get().n);
      db.close();
      parentPort.postMessage([...seen]);
      `,
      { eval: true, workerData: { dbFile, stop: stop.buffer, driver: require.resolve("better-sqlite3") } },
    );
    const counts = new Promise<number[]>((resolve) => reader.once("message", resolve));
    await w.index();
    Atomics.store(stop, 0, 1);
    const seen = (await counts).sort((a, b) => a - b);
    await reader.terminate();
    expect(w.allRows()).toHaveLength(1_000);
    expect(seen.at(-1)).toBe(1_000);
    expect(seen.filter((n) => n % 200 !== 0)).toEqual([]);
  });
});

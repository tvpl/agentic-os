import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OsEvent } from "../core/src/events.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { auditFiles } from "./fsReadAudit.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, batch A, S1: what the index learns about the nature of a file and of its passages,
 * through real index passes over a real home and folders outside it, read back through `GET /api/memory/search`
 * (`app.inject` against `buildServer`) and the rows the pass wrote. The reader and the parser, one case per row, are
 * in `natureza.layer.test.ts`.
 */

vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return { ...actual, readWorkspaceText: vi.fn(actual.readWorkspaceText) };
});

const repoRoot = path.resolve(import.meta.dirname, "..");
let w: NotesViewWorld;
let seq = 0;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-natureza-index-");
});
afterAll(async () => {
  await w.close();
});

const search = async (query: string) => {
  const res = await w.call("GET", `/api/memory/search?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as Json[];
};
const hitOf = async (word: string, file: string) =>
  (await search(`q=${encodeURIComponent(word)}&mode=text`)).find((h) => h.path === file);
const idOf = (file: string) =>
  (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
const passagesOf = (file: string) =>
  w.ctx.db
    .prepare("SELECT natureza, start_line, end_line FROM note_passages WHERE file_id = ? ORDER BY start_line")
    .all(idOf(file));

describe("S1 the index knows the nature", () => {
  it("C1 a file whose front matter holds natureza: plano and escopo: equipe is a hit with natureza plano and escopo equipe, and its fields hold both", async () => {
    const root = w.indexedRoot(`c1-${++seq}`);
    const file = w.put(
      path.join(root, "lancamento.md"),
      "---\nnatureza: plano\nescopo: equipe\n---\n\n# Lançamento\n\nO pitangueira lançamento do curso.\n",
    );
    await w.index();
    const hit = await hitOf("pitangueira", file);
    expect(hit, "the file is a hit").toBeDefined();
    expect(hit!.natureza).toBe("plano");
    expect(hit!.escopo).toBe("equipe");
    expect(hit!.fields).toMatchObject({ natureza: "plano", escopo: "equipe" });
  });

  it("C2 each value is read through the closed lists at the route, and the pass over the files finishes with index.finished and no failure", async () => {
    const root = w.indexedRoot(`c2-${++seq}`);
    const files: Record<string, [string, "natureza" | "escopo", string | null, string]> = {
      "talvez.md": ["---\nnatureza: talvez\n---\n# A\n\nguabiroba um\n", "natureza", null, "talvez"],
      "publico.md": ["---\nescopo: publico\n---\n# B\n\nguabiroba dois\n", "escopo", null, "publico"],
      "acento.md": ["---\nnatureza: Opinião\n---\n# C\n\nguabiroba tres\n", "natureza", "opiniao", "Opinião"],
      "caixa.md": ["---\nnatureza: PLANO\n---\n# D\n\nguabiroba quatro\n", "natureza", "plano", "PLANO"],
      "espaco.md": [
        '---\nnatureza: " plano "\n---\n# E\n\nguabiroba cinco\n',
        "natureza",
        "plano",
        " plano ",
      ],
      "inline.md": [
        "---\nnatureza: plano\n---\n# F\n\nguabiroba seis\n\nnatureza:: fato\n",
        "natureza",
        "fato",
        "fato",
      ],
      "inline-fora.md": [
        "---\nnatureza: plano\n---\n# G\n\nguabiroba sete\n\nnatureza:: talvez\n",
        "natureza",
        null,
        "talvez",
      ],
    };
    for (const [name, [text]] of Object.entries(files)) w.put(path.join(root, name), text);
    const events: OsEvent[] = [];
    const off = w.ctx.events.subscribe((e: OsEvent) => {
      if (e.type === "index.finished" || e.type === "index.failed") events.push(e);
    });
    let stats: Json;
    try {
      stats = (await w.index()) as Json;
    } finally {
      off();
    }
    expect(events.map((e) => e.type)).toEqual(["index.finished"]);
    expect(stats.added).toBeGreaterThanOrEqual(Object.keys(files).length);
    const hits = await search("q=guabiroba&mode=text&limit=50");
    for (const [name, [, key, read, stored]] of Object.entries(files)) {
      const hit = hits.find((h) => h.path === path.join(root, name));
      expect(hit, name).toBeDefined();
      expect(hit![key], name).toBe(read);
      // what the index stored is the text as written (cerebro-organizar door 6, amendment 2)
      expect(hit!.fields[key], name).toBe(stored);
    }
  });

  it("C2 a natureza: talvez row stored by a pass before this feature reads null at the route with no new pass", async () => {
    const root = w.indexedRoot(`c2-old-${++seq}`);
    const id = w.row(root, "antiga.md", { fields: { natureza: "talvez" }, mtime: Date.now() });
    w.ctx.db
      .prepare(
        "INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, 'antiga.md', 'antiga.md', 'cambuci antigo')",
      )
      .run(id);
    const hit = (await search("q=cambuci&mode=text")).find((h) => h.id === id);
    expect(hit).toBeDefined();
    expect(hit!.fields.natureza).toBe("talvez");
    expect(hit!.natureza).toBeNull();
  });

  it("C4 lines 5-7 > [!plano] Lançamento, > em março, > com 3 turmas give exactly one note_passages row plano 5-7, and the other forms of door 2 each a row", async () => {
    const root = w.indexedRoot(`c4-${++seq}`);
    const file = w.put(
      path.join(root, "curso.md"),
      [
        "# Curso",
        "",
        "Texto antes.",
        "",
        "> [!plano] Lançamento",
        "> em março",
        "> com 3 turmas",
        "",
        "Depois.",
      ].join("\n"),
    );
    const caps = w.put(path.join(root, "caps.md"), "# Caps\n\n> [!FATO]\n> o preço é 900\n");
    const bare = w.put(path.join(root, "bare.md"), "> [!hipotese]\n> talvez dobre\n");
    const longer = w.put(
      path.join(root, "longer.md"),
      "> [!relato] Reunião\n> falamos de preço\n> e de prazo\n",
    );
    await w.index();
    expect(passagesOf(file)).toEqual([{ natureza: "plano", start_line: 5, end_line: 7 }]);
    expect(passagesOf(caps)).toEqual([{ natureza: "fato", start_line: 3, end_line: 4 }]);
    expect(passagesOf(bare)).toEqual([{ natureza: "hipotese", start_line: 1, end_line: 2 }]);
    expect(passagesOf(longer)).toEqual([{ natureza: "relato", start_line: 1, end_line: 3 }]);
  });

  it("C6 the passage writer: one block is 1 row, three are 3 rows in line order, and none after a change is 0 rows", async () => {
    const root = w.indexedRoot(`c6-${++seq}`);
    const one = w.put(path.join(root, "uma.md"), "# Uma\n\n> [!opiniao]\n> acho caro\n");
    const three = w.put(
      path.join(root, "tres.md"),
      "# Três\n\n> [!fato]\n> custa 900\n\ntexto\n\n> [!plano]\n> subir\n\n> [!relato]\n> falamos\n",
    );
    await w.index();
    expect(passagesOf(one)).toEqual([{ natureza: "opiniao", start_line: 3, end_line: 4 }]);
    expect(passagesOf(three)).toEqual([
      { natureza: "fato", start_line: 3, end_line: 4 },
      { natureza: "plano", start_line: 8, end_line: 9 },
      { natureza: "relato", start_line: 11, end_line: 12 },
    ]);
    w.put(three, "# Três\n\nsem passagem nenhuma agora, um texto mais longo\n");
    const later = (Date.now() + 5_000) / 1000;
    fs.utimesSync(three, later, later);
    await w.index();
    expect(passagesOf(three)).toEqual([]);
    expect(passagesOf(one)).toEqual([{ natureza: "opiniao", start_line: 3, end_line: 4 }]);
  });

  it("C9 a removal that fails right after DELETE FROM files keeps the files row and the passages; a removal that lands drops both and keeps review_state", async () => {
    const root = w.indexedRoot(`c9-${++seq}`);
    const file = w.put(path.join(root, "sai.md"), "# Sai\n\n> [!plano]\n> vai sair\n");
    await w.index();
    const id = idOf(file);
    expect(passagesOf(file)).toEqual([{ natureza: "plano", start_line: 3, end_line: 4 }]);
    const state = { path: file, last_reviewed: 111, snooze_until: 222, never: 0, updated_at: 333 };
    w.ctx.db
      .prepare(
        "INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES (@path, @last_reviewed, @snooze_until, @never, @updated_at)",
      )
      .run(state);
    fs.rmSync(file);

    // The statement after `DELETE FROM files` fails: the whole write transaction of the removal rolls back.
    const db = w.ctx.db;
    const realPrepare = db.prepare.bind(db);
    let deleted = false;
    let injected = false;
    const spy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      // the statement right after the `DELETE FROM files` of the removal fails, once
      if (deleted && !injected) {
        injected = true;
        throw new Error("injected after DELETE FROM files");
      }
      const statement = realPrepare(sql);
      if (sql === "DELETE FROM files WHERE id = ?") {
        const run = statement.run.bind(statement);
        (statement as { run: unknown }).run = (...args: unknown[]) => {
          const out = run(...(args as [number]));
          deleted = true;
          return out;
        };
      }
      return statement;
    }) as typeof db.prepare);
    try {
      await expect(w.index()).rejects.toThrow("injected after DELETE FROM files");
    } finally {
      spy.mockRestore();
    }
    expect(injected).toBe(true);
    expect(db.prepare("SELECT id FROM files WHERE id = ?").get(id)).toEqual({ id });
    expect(
      db.prepare("SELECT natureza, start_line, end_line FROM note_passages WHERE file_id = ?").all(id),
    ).toEqual([{ natureza: "plano", start_line: 3, end_line: 4 }]);

    await w.index();
    expect(db.prepare("SELECT id FROM files WHERE id = ?").get(id)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM note_passages WHERE file_id = ?").get(id)).toEqual({ n: 0 });
    expect(db.prepare("SELECT * FROM review_state WHERE path = ?").get(file)).toEqual(state);
  });
});

describe("C8 the passages of files indexed before migration 25", () => {
  it("C8 the next pass fills them from the stored text without opening a file, a pass stopped after the first slice leaves no marker, and the pass after it fills the rest", async () => {
    const v = await notesViewWorld("mordomo-natureza-backfill-");
    try {
      const root = v.indexedRoot("c8");
      const first = v.put(path.join(root, "a.md"), "# A\n\n> [!plano] Um\n> primeiro\n");
      const plain = v.put(path.join(root, "b.md"), "# B\n\nsem passagem\n");
      const second = v.put(path.join(root, "c.md"), "# C\n\ntexto\n\n> [!fato]\n> segundo\n> mais\n");
      await v.index();
      // What a database migrated to 25 holds for files a pass indexed before it: no passage and no marker.
      v.ctx.db.prepare("DELETE FROM note_passages").run();
      v.ctx.db.prepare("DELETE FROM meta WHERE key = 'index.note_passages'").run();
      const marker = () => v.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.note_passages'").get();
      const rows = (file: string) =>
        v.ctx.db
          .prepare(
            "SELECT natureza, start_line, end_line FROM note_passages WHERE file_id = (SELECT id FROM files WHERE path = ?)",
          )
          .all(file);

      // Every open of a path under the folder, and every safe text read, is recorded.
      const opened: string[] = [];
      const realOpen = fs.openSync;
      const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((
        file: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(file).startsWith(root)) opened.push(String(file));
        return (realOpen as (...a: unknown[]) => number)(file, ...rest);
      }) as typeof fs.openSync);
      const textReads = vi.mocked(safeFs.readWorkspaceText);
      textReads.mockClear();
      const readOfRoot = () => textReads.mock.calls.filter(([, file]) => String(file).startsWith(root));

      // A pass stopped after the first slice: the second write of the backfill fails.
      const db = v.ctx.db;
      const realPrepare = db.prepare.bind(db);
      let inserts = 0;
      const prepareSpy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
        if (sql.startsWith("INSERT OR IGNORE INTO note_passages") && ++inserts === 2)
          throw new Error("stopped");
        return realPrepare(sql);
      }) as typeof db.prepare);
      try {
        await expect(v.index()).rejects.toThrow("stopped");
      } finally {
        prepareSpy.mockRestore();
      }
      expect(marker()).toBeUndefined();
      // The first slice landed (one of the two files, in the order of their rows) and the second did not.
      const filled = [first, second].filter((f) => rows(f).length > 0);
      expect(filled).toHaveLength(1);
      expect(rows(filled[0]!)).toEqual(
        filled[0] === first
          ? [{ natureza: "plano", start_line: 3, end_line: 4 }]
          : [{ natureza: "fato", start_line: 5, end_line: 7 }],
      );

      try {
        await v.index();
      } finally {
        openSpy.mockRestore();
      }
      expect(rows(first)).toEqual([{ natureza: "plano", start_line: 3, end_line: 4 }]);
      expect(rows(second)).toEqual([{ natureza: "fato", start_line: 5, end_line: 7 }]);
      expect(rows(plain)).toEqual([]);
      expect(marker()).toEqual({ value: "1" });
      expect(opened).toEqual([]);
      expect(readOfRoot()).toEqual([]);
      // and the code that does it reads no file by itself (the raw-read audit of tests/fsReadAudit.ts)
      expect(auditFiles(repoRoot, [path.join(repoRoot, "core", "src", "memory", "natureza.ts")])).toEqual([]);
    } finally {
      await v.close();
    }
  });
});

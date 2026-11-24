import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { makeTempHome } from "./helpers.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch A, S1 (door 1): the mentions a real index pass writes for each
 * Markdown file, read back from `entity_mentions`; the migration 35 backfill through a real migration and a real pass.
 */

vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return { ...actual, readWorkspaceText: vi.fn(actual.readWorkspaceText) };
});

let w: NotesViewWorld;
let root: string;
let seq = 0;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-entidades-index-");
  root = w.indexedRoot("entidades");
});
afterAll(async () => {
  await w.close();
});

/** A folder of its own for each case, so a case's links resolve only to its own notes. */
const dir = (name: string) => path.join(root, `${name}-${++seq}`);
const rowsOf = (world: NotesViewWorld, file: string) =>
  world.ctx.db
    .prepare(
      "SELECT line, proof, kind, name, norm FROM entity_mentions WHERE src_id = (SELECT id FROM files WHERE path = ?) ORDER BY line, rowid",
    )
    .all(file) as Json[];

describe("C1 a profile note", () => {
  it("C1 `type: profile`, titled Ana Souza with aliases [Ana, A. Souza]: exactly three nota rows at line 1, kind perfil", async () => {
    const d = dir("c1");
    const ana = w.put(
      path.join(d, "ana.md"),
      "---\ntype: profile\ntitle: Ana Souza\naliases: [Ana, A. Souza]\n---\ncontato do banco.\n",
    );
    await w.index();
    expect(rowsOf(w, ana)).toEqual([
      { line: 1, proof: "nota", kind: "perfil", name: "Ana Souza", norm: "ana souza" },
      { line: 1, proof: "nota", kind: "perfil", name: "Ana", norm: "ana" },
      { line: 1, proof: "nota", kind: "perfil", name: "A. Souza", norm: "a souza" },
    ]);
  });
});

describe("C2 a project note", () => {
  it("C2 `type: project` gives one nota row of kind projeto with its title", async () => {
    const d = dir("c2");
    const atlas = w.put(path.join(d, "atlas.md"), "---\ntype: project\ntitle: Atlas\n---\nplano do ano.\n");
    await w.index();
    expect(rowsOf(w, atlas)).toEqual([
      { line: 1, proof: "nota", kind: "projeto", name: "Atlas", norm: "atlas" },
    ]);
  });

  it("C2 with no title, the file name without extension: atlas-2027.md is atlas-2027, norm atlas 2027", async () => {
    const d = dir("c2-sem-titulo");
    const atlas = w.put(path.join(d, "atlas-2027.md"), "---\ntype: project\n---\nplano do ano.\n");
    await w.index();
    expect(rowsOf(w, atlas)).toEqual([
      { line: 1, proof: "nota", kind: "projeto", name: "atlas-2027", norm: "atlas 2027" },
    ]);
  });
});

describe("C3 links to a home note", () => {
  it("C3 a wikilink on line 7 and a Markdown link on line 9, both resolved to the profile note, are two link rows; a link to a plain note and an unresolved one give none", async () => {
    const d = dir("c3");
    // The wikilink `[[Ana Souza]]` resolves by file name (links.ts), so the profile note is `Ana Souza.md`, and the
    // Markdown link names that same file.
    w.put(path.join(d, "pessoas", "Ana Souza.md"), "---\ntype: profile\ntitle: Ana Souza\n---\nperfil.\n");
    w.put(path.join(d, "pessoas", "rascunho.md"), "---\ntitle: Rascunho\n---\nnota comum.\n");
    const source = w.put(
      path.join(d, "notas", "reuniao.md"),
      [
        "linha um",
        "linha dois",
        "linha tres",
        "[[rascunho]] sem tipo",
        "[[inexistente]] sem destino",
        "linha seis",
        "falei com [[Ana Souza]] hoje",
        "linha oito",
        "veja a [ficha](../pessoas/Ana%20Souza.md)",
        "",
      ].join("\n"),
    );
    await w.index();
    expect(rowsOf(w, source).filter((r) => r.proof === "link")).toEqual([
      { line: 7, proof: "link", kind: "perfil", name: "Ana Souza", norm: "ana souza" },
      { line: 9, proof: "link", kind: "perfil", name: "Ana Souza", norm: "ana souza" },
    ]);
    // the plain note and the link to nothing are in note_links, and give no mention
    expect(
      w.ctx.db
        .prepare(
          "SELECT line FROM note_links WHERE src_id = (SELECT id FROM files WHERE path = ?) ORDER BY line",
        )
        .all(source),
    ).toEqual([{ line: 4 }, { line: 5 }, { line: 7 }, { line: 9 }]);
    expect(rowsOf(w, source)).toEqual(rowsOf(w, source).filter((r) => r.line === 7 || r.line === 9));
  });
});

describe("C4 tags", () => {
  it("C4 `tags: [Cliente-X]` gives a tag row at the line of tags:, and #Cliente-X on line 12 one at line 12", async () => {
    const d = dir("c4");
    const lines = ["---", "title: Visita", "tags: [Cliente-X]", "---"];
    while (lines.length < 11) lines.push("texto comum");
    lines.push("lembrar #Cliente-X amanha", "");
    const note = w.put(path.join(d, "visita.md"), lines.join("\n"));
    await w.index();
    expect(rowsOf(w, note)).toEqual([
      { line: 3, proof: "tag", kind: "tag", name: "Cliente-X", norm: "cliente x" },
      { line: 12, proof: "tag", kind: "tag", name: "Cliente-X", norm: "cliente x" },
    ]);
  });
});

/** A capitalised word of letters only for `n` (`Kaa`, `Kab`, …): every term of C7 is a different name. */
const word = (n: number) =>
  "K" +
  String.fromCharCode(97 + (Math.floor(n / 26 / 26) % 26), 97 + (Math.floor(n / 26) % 26), 97 + (n % 26));

describe("C7 the cap", () => {
  it("C7 a note with 250 extractable mentions stores exactly 200, the first 200 in text order (line, then column)", async () => {
    const d = dir("c7");
    // 83 lines of three terms and one of one: 250 terms; the 200th is the second term of line 67.
    const all: Array<{ line: number; name: string }> = [];
    const lines: string[] = [];
    for (let line = 1, n = 0; n < 250; line++) {
      const names: string[] = [];
      for (let k = 0; k < 3 && n < 250; k++, n++) names.push(`Pessoa ${word(n)}`);
      names.forEach((name) => all.push({ line, name }));
      lines.push(names.join(", "));
    }
    const note = w.put(path.join(d, "muitos.md"), lines.join("\n") + "\n");
    await w.index();
    const rows = rowsOf(w, note);
    expect(all).toHaveLength(250);
    expect(rows).toHaveLength(200);
    expect(rows.map((r) => ({ line: r.line, name: r.name }))).toEqual(all.slice(0, 200));
    expect(rows.at(-1)).toMatchObject({ line: 67, name: all[199]!.name });
    expect(all[200]).toMatchObject({ line: 67 });
    expect(rows.every((r) => r.proof === "termo")).toBe(true);
  });
});

describe("C8 a file written again, and removed", () => {
  it("C8 re-indexing a changed note replaces its rows; removing the file removes them (ON DELETE CASCADE)", async () => {
    const d = dir("c8");
    const note = w.put(path.join(d, "nota.md"), "---\ntags: [velha]\n---\nCom o Banco Central hoje.\n");
    await w.index();
    expect(rowsOf(w, note).map((r) => [r.proof, r.name])).toEqual([
      ["tag", "velha"],
      ["termo", "Banco Central"],
    ]);
    w.put(note, "---\ntags: [nova]\n---\nCom o Banco Central hoje, e mais texto.\n");
    await w.index();
    expect(rowsOf(w, note)).toEqual([
      { line: 2, proof: "tag", kind: "tag", name: "nova", norm: "nova" },
      { line: 4, proof: "termo", kind: "termo", name: "Banco Central", norm: "banco central" },
    ]);

    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(note) as { id: number }).id;
    const count = () =>
      (
        w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE src_id = ?").get(id) as {
          n: number;
        }
      ).n;
    const total = () =>
      (w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions").get() as { n: number }).n;
    const before = total();
    expect(count()).toBe(2);
    fs.rmSync(note);
    await w.index();
    expect(count()).toBe(0);
    expect(total()).toBe(before - 2);
    // the cascade alone removes them: deleting the files row is enough
    const other = w.put(path.join(d, "outra.md"), "---\ntags: [solta]\n---\ntexto.\n");
    await w.index();
    const otherId = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(other) as { id: number }).id;
    expect(
      (
        w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE src_id = ?").get(otherId) as {
          n: number;
        }
      ).n,
    ).toBe(1);
    w.ctx.db.prepare("DELETE FROM files WHERE id = ?").run(otherId);
    expect(
      (
        w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE src_id = ?").get(otherId) as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });
});

describe("C9 migration 35 over a populated index", () => {
  it("C9 the first full pass fills every note's rows from the stored text with no file opened, writes the marker, and a second pass recomputes none", async () => {
    const temp = makeTempHome("mordomo-entidades-c9-");
    const folder = fs.realpathSync(fs.mkdtempSync(path.join(path.dirname(temp.paths.home), "entidades-c9-")));
    const open = () => {
      const ctx = new AppContext(temp.paths.home);
      const s = ctx.settings();
      s.setupCompleted = true;
      s.indexedFolders = [{ path: folder, area: null, enabled: true }];
      ctx.settingsStore.save(s);
      return ctx;
    };
    try {
      // 40 notes: profiles, projects, tags, terms and links between them
      for (let i = 0; i < 40; i++) {
        const kind = i % 4 === 0 ? "type: profile\n" : i % 4 === 1 ? "type: project\n" : "";
        fs.writeFileSync(
          path.join(folder, `nota-${i}.md`),
          `---\ntitle: Nota ${i}\n${kind}tags: [grupo-${i % 3}]\n---\nReunião com Banco Central do Brasil.\n` +
            `Ver [[nota-${(i + 4) % 40}]] e #Cliente-X.\n`,
        );
      }
      const first = open();
      await first.indexer.indexAllAsync();
      const snapshot = (db: AppContext["db"]) =>
        db
          .prepare(
            "SELECT f.path, m.line, m.proof, m.kind, m.name, m.norm FROM entity_mentions m JOIN files f ON f.id = m.src_id ORDER BY f.path, m.line, m.proof, m.norm",
          )
          .all();
      const want = snapshot(first.db);
      expect(new Set((want as Json[]).map((r) => r.path)).size).toBe(40);
      expect((want as Json[]).some((r) => r.proof === "link")).toBe(true);
      // What a database at 34 holds: no table of migration 35, no marker.
      first.db.exec("DROP TABLE entity_mentions; DROP TABLE entity_overrides; DROP TABLE summary_runs;");
      first.db.prepare("DELETE FROM meta WHERE key = 'index.entity_mentions'").run();
      first.db.pragma("user_version = 34");
      first.close();

      const ctx = open();
      try {
        expect(ctx.db.pragma("user_version", { simple: true })).toBe(35);
        expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions").get()).toEqual({ n: 0 });
        const opened: string[] = [];
        const realOpen = fs.openSync;
        const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((
          target: fs.PathLike,
          ...rest: unknown[]
        ) => {
          if (String(target).startsWith(folder)) opened.push(String(target));
          return (realOpen as (...a: unknown[]) => number)(target, ...rest);
        }) as typeof fs.openSync);
        const textReads = vi.mocked(safeFs.readWorkspaceText);
        textReads.mockClear();
        try {
          await ctx.indexer.indexAllAsync();
          expect(snapshot(ctx.db)).toEqual(want);
          expect(ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.entity_mentions'").get()).toEqual({
            value: "1",
          });

          // the second pass recomputes none: no DELETE of the mentions of an unchanged file
          const realPrepare = ctx.db.prepare.bind(ctx.db);
          let deletes = 0;
          const prepareSpy = vi.spyOn(ctx.db, "prepare").mockImplementation(((sql: string) => {
            if (sql.startsWith("DELETE FROM entity_mentions")) deletes++;
            return realPrepare(sql);
          }) as typeof ctx.db.prepare);
          try {
            await ctx.indexer.indexAllAsync();
          } finally {
            prepareSpy.mockRestore();
          }
          expect(deletes).toBe(0);
          expect(snapshot(ctx.db)).toEqual(want);
        } finally {
          openSpy.mockRestore();
        }
        expect(opened).toEqual([]);
        expect(textReads.mock.calls.filter(([, f]) => String(f).startsWith(folder))).toEqual([]);
      } finally {
        ctx.close();
      }
    } finally {
      temp.cleanup();
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

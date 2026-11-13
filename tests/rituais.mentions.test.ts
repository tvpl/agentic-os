import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fileRowFromDb } from "../core/src/memory/indexer.js";
import { MONDAY, code, rituaisWorld, sha, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/**
 * S8 of .specs/features/cerebro-rituais through the routes (`app.inject` against `buildServer` over a real home):
 * `GET /api/memory/mentions` (door 6) and `POST /api/memory/mentions/link` (door 7), as the owner. Who else may call
 * them, and the audience differential, are in `rituais.access.test.ts`; the terms, the matcher and the rewrite at their
 * own layer are in `rituais.layer.test.ts`.
 */

let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-mentions-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  w.update((s) => {
    s.contexts = [];
    s.indexedFolders = [];
  });
  await w.reset();
});

const notes = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
const rowOf = (file: string): Json => {
  const row = w.ctx.db.prepare("SELECT * FROM files WHERE path = ?").get(file) as
    Record<string, unknown> | undefined;
  if (!row) throw new Error(`not indexed: ${file}`);
  return JSON.parse(JSON.stringify(fileRowFromDb(row))) as Json;
};
const idOf = (file: string): number => rowOf(file).id as number;
async function mentions(id: number, extra = ""): Promise<Json> {
  const res = await w.call("GET", `/api/memory/mentions?id=${id}${extra}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
const sourcesOf = (body: Json): string[] => (body.items as Json[]).map((i) => i.file.path as string);
const linesOf = (body: Json): number[] => (body.items as Json[]).map((i) => i.line as number);
const link = (body: Json) => w.call("POST", "/api/memory/mentions/link", body);
const versionsOf = (file: string) =>
  w.ctx.db
    .prepare("SELECT id, author, origin FROM memory_versions WHERE path = ? ORDER BY id")
    .all(path.relative(w.memory, file).split(path.sep).join("/")) as Json[];

/** A target note `Rede.md` (title Rede) under memory/notes/, indexed later by the caller. */
const rede = (body = "Sobre a rede.\n") => w.put(notes("Rede.md"), `---\ntitle: Rede\n---\n${body}`);

// ---- C58 ----------------------------------------------------------------------------------------------------------

describe("C58 one mention, the excerpt, two lines of one source", () => {
  it("C58 one source line gives 200 { file, terms, items: [{ file, line 5, excerpt, term, editable, version }], total: 1 }", async () => {
    const target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    const diario = w.put(notes("diario.md"), "# Diário\n\nlinha 3\nlinha 4\no curso de marco atrasou\nfim\n");
    await w.index();
    const body = await mentions(idOf(target));
    expect(body).toEqual({
      file: rowOf(target),
      terms: ["Curso de Março"],
      items: [
        {
          file: rowOf(diario),
          line: 5,
          excerpt: "o curso de marco atrasou",
          term: "Curso de Março",
          editable: true,
          version: sha(fs.readFileSync(diario)),
        },
      ],
      total: 1,
    });
  });

  it("C58 a line of 400 characters gives an excerpt of at most 160 characters holding the term as written", async () => {
    const target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    const long = `${"palavra ".repeat(25)}o curso de marco atrasou ${"outra ".repeat(40)}`.slice(0, 400);
    expect(long).toHaveLength(400);
    w.put(notes("longa.md"), `# Longa\n\n${long}\n`);
    await w.index();
    const [item] = (await mentions(idOf(target))).items as Json[];
    expect(item!.line).toBe(3);
    expect((item!.excerpt as string).length).toBeLessThanOrEqual(160);
    expect(item!.excerpt).toContain("curso de marco");
    expect(long).toContain(item!.excerpt);
  });

  it("C58 a source with the term on lines 5 and 9 gives two items", async () => {
    const target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    const diario = w.put(
      notes("diario.md"),
      "# Diário\n\n3\n4\no curso de marco atrasou\n6\n7\n8\nde novo o Curso de Março\n",
    );
    await w.index();
    const body = await mentions(idOf(target));
    expect(sourcesOf(body)).toEqual([diario, diario]);
    expect(linesOf(body)).toEqual([5, 9]);
    expect(body.total).toBe(2);
  });
});

// ---- C59 ----------------------------------------------------------------------------------------------------------

describe("C59 the terms through the route", () => {
  const termsOf = async (file: string, text: string): Promise<string[]> => {
    w.put(file, text);
    await w.index();
    return (await mentions(idOf(file))).terms as string[];
  };
  it("C59 the title of cm.md", async () => {
    expect(await termsOf(notes("cm.md"), "---\ntitle: Curso de Março\n---\nx\n")).toEqual(["Curso de Março"]);
  });
  it("C59 the file name with - and _ as spaces when there is no title", async () => {
    expect(await termsOf(notes("plano_de-vendas.md"), "sem título\n")).toEqual(["plano de vendas"]);
  });
  it("C59 each aliases item", async () => {
    expect(
      await termsOf(notes("cm.md"), "---\ntitle: Curso de Março\naliases: [CM 2026, Curso Março]\n---\nx\n"),
    ).toEqual(["Curso de Março", "CM 2026", "Curso Março"]);
  });
  it("C59 a term of exactly 4 characters is kept and one of 3 dropped", async () => {
    expect(await termsOf(notes("Rede.md"), "---\ntitle: Rede\n---\nx\n")).toEqual(["Rede"]);
    expect(await termsOf(notes("Ana.md"), "---\ntitle: Ana\n---\nx\n")).toEqual([]);
  });
  it("C59 terms that fold equal are one, the first of title, file name, aliases, answered in that order", async () => {
    expect(await termsOf(notes("cafe.md"), "---\ntitle: Café\naliases: [CAFÉ, Cafezinho]\n---\nx\n")).toEqual(
      ["Café", "Cafezinho"],
    );
    expect(
      await termsOf(notes("plano-beta.md"), "---\ntitle: Plano Alfa\naliases: [Plano Gama]\n---\nx\n"),
    ).toEqual(["Plano Alfa", "plano beta", "Plano Gama"]);
  });
});

// ---- C60 ----------------------------------------------------------------------------------------------------------

describe("C60 whole words after the fold", () => {
  it("C60 for Rede: 'a rede caiu', 'Rede: ok', 'caiu a REDE' and '(rede)' are listed; 'redes', 'parede' and 'Redenção' are not", async () => {
    const target = rede();
    const lines = ["a rede caiu", "Rede: ok", "caiu a REDE", "(rede)", "as redes", "a parede", "Redenção"];
    w.put(notes("fonte.md"), `${lines.join("\n")}\n`);
    await w.index();
    const body = await mentions(idOf(target));
    expect(linesOf(body)).toEqual([1, 2, 3, 4]);
    expect((body.items as Json[]).map((i) => i.excerpt)).toEqual(lines.slice(0, 4));
  });
  it("C60 for Café: 'um cafe' and 'CAFÉ!' are listed and 'cafeteria' is not", async () => {
    const target = w.put(notes("Café.md"), "---\ntitle: Café\n---\nx\n");
    w.put(notes("fonte.md"), "um cafe\nCAFÉ!\na cafeteria\n");
    await w.index();
    expect(linesOf(await mentions(idOf(target)))).toEqual([1, 2]);
  });
});

// ---- C61 ----------------------------------------------------------------------------------------------------------

describe("C61 no item where the term is not prose", () => {
  const cases: Array<[string, string]> = [
    ["the source's front matter", "---\ntitle: Rede\n---\nnada aqui\n"],
    ["a ``` block", "antes\n```\na rede caiu\n```\ndepois\n"],
    ["a ~~~ block", "antes\n~~~\na rede caiu\n~~~\ndepois\n"],
    ["inline code", "o `rede` aqui\n"],
    ["the text of a Markdown link", "veja [a rede](x.md)\n"],
    ["the URL of a Markdown link", "veja [x](https://rede.example/rede)\n"],
    ["a wikilink", "veja [[outra/Rede]]\n"],
    ["a wikilink alias", "veja [[x|rede]]\n"],
  ];
  for (const [name, text] of cases)
    it(`C61 ${name} gives no item`, async () => {
      const target = rede();
      w.put(notes("fonte.md"), text);
      await w.index();
      const body = await mentions(idOf(target));
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });
  it("C61 a line '`rede` e a rede' is one item (the plain one)", async () => {
    const target = rede();
    w.put(notes("fonte.md"), "`rede` e a rede\n");
    await w.index();
    const body = await mentions(idOf(target));
    expect(body.total).toBe(1);
    expect((body.items as Json[])[0]).toMatchObject({ line: 1, term: "Rede", excerpt: "`rede` e a rede" });
  });
  it("C61 a line holding the two terms Rede and Café is one item with the first term that matches", async () => {
    const target = w.put(notes("Rede.md"), "---\ntitle: Rede\naliases: [Café]\n---\nx\n");
    w.put(notes("fonte.md"), "a rede e o café\n");
    await w.index();
    const body = await mentions(idOf(target));
    expect(body.terms).toEqual(["Rede", "Café"]);
    expect(body.total).toBe(1);
    expect((body.items as Json[])[0]).toMatchObject({ line: 1, term: "Rede" });
  });
});

// ---- C62 ----------------------------------------------------------------------------------------------------------

describe("C62 a source that already links to the target", () => {
  it("C62 a wikilink [[Rede]] on line 2 leaves out the plain mention on line 8, and the backlinks stay", async () => {
    const target = rede();
    const source = w.put(notes("fonte.md"), "um\n[[Rede]]\n3\n4\n5\n6\n7\na rede caiu\n");
    await w.index();
    expect((await mentions(idOf(target))).items).toEqual([]);
    const links = await w.call("GET", `/api/memory/links?id=${idOf(target)}`);
    expect((links.body.backlinks as Json[]).map((b) => [b.file.path, b.kind, b.line])).toEqual([
      [source, "wikilink", 2],
    ]);
  });
  it("C62 a Markdown link [r](../notes/Rede.md) leaves the source out", async () => {
    const target = rede();
    const source = w.put(path.join(w.memory, "outros", "fonte.md"), "[r](../notes/Rede.md)\na rede caiu\n");
    await w.index();
    expect((await mentions(idOf(target))).items).toEqual([]);
    const links = await w.call("GET", `/api/memory/links?id=${idOf(target)}`);
    expect((links.body.backlinks as Json[]).map((b) => [b.file.path, b.kind])).toEqual([
      [source, "markdown-link"],
    ]);
  });
  it("C62 a link that does not resolve to the target ([[Redes]], or [[Rede]] resolving to a closer Rede.md) leaves the source in", async () => {
    const target = rede();
    const broken = w.put(notes("quebrado.md"), "[[Redes]]\na rede caiu\n");
    w.put(notes("sub", "Rede.md"), "---\ntitle: Outra\n---\noutra coisa\n");
    const closer = w.put(notes("sub", "perto.md"), "[[Rede]]\na rede caiu\n");
    await w.index();
    const body = await mentions(idOf(target));
    expect(sourcesOf(body).sort()).toEqual([broken, closer].sort());
    expect(linesOf(body)).toEqual([2, 2]);
  });
  it("C62 the target's own body mentioning its title is never an item", async () => {
    const target = rede("A rede é isto. Rede, rede, rede.\n");
    await w.index();
    const body = await mentions(idOf(target));
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});

// ---- C63 ----------------------------------------------------------------------------------------------------------

describe("C63 order and limits", () => {
  it("C63 by the source's mtime, newest first, then by path, then by line", async () => {
    const target = rede();
    const old = w.put(notes("a-velha.md"), "a rede\n");
    const tieB = w.put(notes("c-empate.md"), "x\na rede\n");
    const tieA = w.put(notes("b-empate.md"), "a rede\nx\na rede\n");
    const newest = w.put(notes("z-nova.md"), "a rede\n");
    w.touch(old, MONDAY - 3 * 86_400_000);
    w.touch(tieA, MONDAY - 2 * 86_400_000);
    w.touch(tieB, MONDAY - 2 * 86_400_000);
    w.touch(newest, MONDAY - 86_400_000);
    await w.index();
    const body = await mentions(idOf(target));
    expect((body.items as Json[]).map((i) => [i.file.path, i.line])).toEqual([
      [newest, 1],
      [tieA, 1],
      [tieA, 3],
      [tieB, 2],
      [old, 1],
    ]);
  });
  it("C63 25 sources: 20 items and total 25 by default; limit=1 gives 1; limit=50 gives 25", async () => {
    const target = rede();
    for (let i = 0; i < 25; i++) w.put(notes(`fonte-${String(i).padStart(2, "0")}.md`), "a rede caiu\n");
    await w.index();
    const id = idOf(target);
    const all = await mentions(id);
    expect([(all.items as Json[]).length, all.total]).toEqual([20, 25]);
    const one = await mentions(id, "&limit=1");
    expect([(one.items as Json[]).length, one.total]).toEqual([1, 25]);
    const fifty = await mentions(id, "&limit=50");
    expect([(fifty.items as Json[]).length, fifty.total]).toEqual([25, 25]);
  });
  it("C63 limit=0, limit=51 and no id answer 400 validation; an id that names no file answers 404 not_found", async () => {
    const target = rede();
    await w.index();
    const id = idOf(target);
    expect(code(await w.call("GET", `/api/memory/mentions?id=${id}&limit=0`))).toEqual([400, "validation"]);
    expect(code(await w.call("GET", `/api/memory/mentions?id=${id}&limit=51`))).toEqual([400, "validation"]);
    expect(code(await w.call("GET", "/api/memory/mentions"))).toEqual([400, "validation"]);
    expect(code(await w.call("GET", "/api/memory/mentions?id=999999"))).toEqual([404, "not_found"]);
  });
});

// ---- C65 ----------------------------------------------------------------------------------------------------------

describe("C65 the context", () => {
  it("C65 context=<id> lists only sources under its paths and memory/notes/<id>/, never the look-alike folder; a target outside it is answered; an unknown id is 400 validation", async () => {
    const root = w.indexedRoot("r");
    const app = path.join(root, "projetos", "app");
    fs.mkdirSync(app, { recursive: true });
    w.update((s) => {
      s.contexts = [{ id: "app", name: "App", paths: [app] }];
    });
    const target = rede();
    const inApp = w.put(path.join(app, "a.md"), "a rede caiu\n");
    const inNotes = w.put(notes("app", "b.md"), "a rede caiu\n");
    const lookAlike = w.put(path.join(root, "projetos", "app-antigo", "c.md"), "a rede caiu\n");
    const outside = w.put(notes("d.md"), "a rede caiu\n");
    await w.index();
    const all = await mentions(idOf(target));
    expect(sourcesOf(all).sort()).toEqual([inApp, inNotes, lookAlike, outside].sort());
    const ctx = await mentions(idOf(target), "&context=app");
    expect(sourcesOf(ctx).sort()).toEqual([inApp, inNotes].sort());
    expect(ctx.total).toBe(2);
    expect(ctx.file.path).toBe(target);
    expect(code(await w.call("GET", `/api/memory/mentions?id=${idOf(target)}&context=nao-existe`))).toEqual([
      400,
      "validation",
    ]);
  });
});

// ---- C66 ----------------------------------------------------------------------------------------------------------

describe("C66 aliases are indexed", () => {
  it("C66 after a pass a note's aliases are terms; a row of before answers without them until indexed again; changed aliases replace the old; [[CM 2026]] stays broken", async () => {
    const target = w.put(notes("cm.md"), "---\ntitle: Curso de Março\naliases: [CM 2026]\n---\nx\n");
    const other = w.put(notes("outra.md"), "veja [[CM 2026]]\n");
    await w.index();
    const id = idOf(target);
    expect((await mentions(id)).terms).toEqual(["Curso de Março", "CM 2026"]);

    // a row indexed before this feature: its stored fields hold no aliases, and the file did not change since
    const fields = { ...(rowOf(target).fields as Json) };
    expect(fields.aliases).toBeDefined();
    delete fields.aliases;
    w.ctx.db.prepare("UPDATE files SET fields = ? WHERE id = ?").run(JSON.stringify(fields), id);
    await w.index();
    expect((await mentions(id)).terms).toEqual(["Curso de Março"]);

    // the file is indexed again once it changes
    w.put(target, "---\ntitle: Curso de Março\naliases: [CM 2026]\n---\nxy\n");
    await w.index();
    expect((await mentions(id)).terms).toEqual(["Curso de Março", "CM 2026"]);

    // the aliases change and a second pass answers the new ones, not the old
    w.put(target, "---\ntitle: Curso de Março\naliases: [Curso Três]\n---\nxy\n");
    await w.index();
    expect((await mentions(id)).terms).toEqual(["Curso de Março", "Curso Três"]);
    await w.index();
    expect((await mentions(id)).terms).toEqual(["Curso de Março", "Curso Três"]);

    // the resolution of [[...]] does not change: [[CM 2026]] is still a broken link
    w.put(target, "---\ntitle: Curso de Março\naliases: [CM 2026]\n---\nxyz\n");
    await w.index();
    const links = await w.call("GET", `/api/memory/links?id=${idOf(other)}`);
    expect((links.body.outgoing as Json[]).map((o) => [o.target, o.resolved])).toEqual([["cm 2026", null]]);
    expect((await w.call("GET", `/api/memory/links?id=${id}`)).body.backlinks).toEqual([]);
  });
});

// ---- C67 ----------------------------------------------------------------------------------------------------------

describe("C67 Linkar", () => {
  async function world(line5: string): Promise<{ target: string; source: string; before: string }> {
    const target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    const before = `# Diário\r\n\nlinha 3\nlinha 4\n${line5}\nlinha 6\n`;
    const source = w.put(notes("diario.md"), before);
    await w.index();
    return { target, source, before };
  }
  it("C67 the alias form: 200 { path, version, link }, line 5 rewritten and every other byte kept, one save version, the old bytes restored, the source no longer listed", async () => {
    const { target, source, before } = await world("o curso de marco atrasou, o curso de marco");
    const prior = versionsOf(source);
    expect(sourcesOf(await mentions(idOf(target)))).toEqual([source]);
    const res = await link({
      source,
      line: 5,
      term: "Curso de Março",
      target: idOf(target),
      baseVersion: sha(before),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = fs.readFileSync(source, "utf8");
    expect(after).toBe(
      "# Diário\r\n\nlinha 3\nlinha 4\no [[Curso de Março|curso de marco]] atrasou, o curso de marco\nlinha 6\n",
    );
    expect(res.body).toEqual({
      path: source,
      version: sha(fs.readFileSync(source)),
      link: "[[Curso de Março|curso de marco]]",
    });
    const added = versionsOf(source).slice(prior.length);
    expect(added.map(({ author, origin }) => ({ author, origin }))).toEqual([
      { author: "owner", origin: "save" },
    ]);
    const previous = versionsOf(source).at(-2)!;
    const back = await w.call("POST", "/api/memory/history/restore", {
      id: previous.id,
      baseVersion: sha(fs.readFileSync(source)),
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(fs.readFileSync(source, "utf8")).toBe(before);
    // linked again, the next list no longer holds the source
    const again = await link({
      source,
      line: 5,
      term: "Curso de Março",
      target: idOf(target),
      baseVersion: sha(before),
    });
    expect(again.status).toBe(200);
    const listed = await mentions(idOf(target));
    expect(sourcesOf(listed)).toEqual([]);
    expect(listed.total).toBe(0);
  });
  it("C67 a written text equal to the name after foldName gives [[Curso de Março]]", async () => {
    const { target, source, before } = await world("o curso de março atrasou");
    const res = await link({
      source,
      line: 5,
      term: "Curso de Março",
      target: idOf(target),
      baseVersion: sha(before),
    });
    expect(res.status).toBe(200);
    expect(res.body.link).toBe("[[Curso de Março]]");
    expect(fs.readFileSync(source, "utf8")).toBe(
      "# Diário\r\n\nlinha 3\nlinha 4\no [[Curso de Março]] atrasou\nlinha 6\n",
    );
  });
});

// ---- C68 ----------------------------------------------------------------------------------------------------------

describe("C68 the first match outside code and links", () => {
  it("C68 only the third occurrence is rewritten", async () => {
    const target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    const before = "`curso de marco` e [curso de marco](x.md) e curso de marco\n";
    const source = w.put(notes("fonte.md"), before);
    await w.index();
    const res = await link({
      source,
      line: 1,
      term: "Curso de Março",
      target: idOf(target),
      baseVersion: sha(before),
    });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(source, "utf8")).toBe(
      "`curso de marco` e [curso de marco](x.md) e [[Curso de Março|curso de marco]]\n",
    );
  });
});

// ---- C69 ----------------------------------------------------------------------------------------------------------

describe("C69 the refusals of POST /api/memory/mentions/link", () => {
  let target: string;
  beforeEach(async () => {
    target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    await w.index();
  });
  async function refused(file: string, body: Json, want: [number, string]) {
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const res = await link({
      source: file,
      line: 1,
      term: "Curso de Março",
      target: idOf(target),
      baseVersion: sha(bytes ?? "x"),
      ...body,
    });
    expect(code(res), `${file} ${JSON.stringify(res.body)}`).toEqual(want);
    if (bytes) expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    else expect(fs.existsSync(file)).toBe(false);
  }
  it("C69 a line that no longer holds the term answers 409 mention_gone", async () => {
    await refused(w.put(notes("f.md"), "o curso atrasou\n"), {}, [409, "mention_gone"]);
  });
  it("C69 a term now only inside inline code answers 409 mention_gone", async () => {
    await refused(w.put(notes("f.md"), "o `curso de marco` atrasou\n"), {}, [409, "mention_gone"]);
  });
  it("C69 a line past the end answers 409 mention_gone", async () => {
    await refused(w.put(notes("f.md"), "o curso de marco atrasou\n"), { line: 5 }, [409, "mention_gone"]);
  });
  it("C69 a stale baseVersion answers 409 edit_conflict, also when the term is gone too", async () => {
    await refused(w.put(notes("f.md"), "o curso de marco atrasou\n"), { baseVersion: sha("antes") }, [
      409,
      "edit_conflict",
    ]);
    await refused(w.put(notes("g.md"), "o curso atrasou\n"), { baseVersion: sha("antes") }, [
      409,
      "edit_conflict",
    ]);
  });
  it("C69 a source outside memory/ answers 403 note_not_editable", async () => {
    const root = w.indexedRoot("fora");
    await refused(w.put(path.join(root, "f.md"), "o curso de marco atrasou\n"), {}, [
      403,
      "note_not_editable",
    ]);
  });
  it("C69 memory/journal/2026-11-04.md answers 403 note_not_editable", async () => {
    await refused(w.put(path.join(w.memory, "journal", "2026-11-04.md"), "o curso de marco atrasou\n"), {}, [
      403,
      "note_not_editable",
    ]);
  });
  it("C69 a source that does not exist answers 404 note_missing", async () => {
    await refused(notes("nao-existe.md"), {}, [404, "note_missing"]);
  });
  it("C69 a target id that names no file answers 404 not_found", async () => {
    await refused(w.put(notes("f.md"), "o curso de marco atrasou\n"), { target: 999_999 }, [
      404,
      "not_found",
    ]);
  });
  it("C69 a source above the editing limit answers 413 note_too_large", async () => {
    const limit = Math.min(w.ctx.settings().limits.maxIndexedFileBytes, 1024 * 1024);
    const big = Buffer.concat([Buffer.from("o curso de marco atrasou\n"), Buffer.alloc(limit, "a")]);
    await refused(w.put(notes("f.md"), big), {}, [413, "note_too_large"]);
  });
  it("C69 line: 0 and term: '' answer 400 validation", async () => {
    await refused(w.put(notes("f.md"), "o curso de marco atrasou\n"), { line: 0 }, [400, "validation"]);
    await refused(w.put(notes("g.md"), "o curso de marco atrasou\n"), { term: "" }, [400, "validation"]);
  });
});

// ---- C70 ----------------------------------------------------------------------------------------------------------

describe("C70 two links with one baseVersion", () => {
  it("C70 sent together: one 200, one 409 edit_conflict, and the file holds one link", async () => {
    const target = w.put(notes("Curso de Março.md"), "---\ntitle: Curso de Março\n---\nO curso.\n");
    const before = "o curso de marco atrasou, o curso de marco\n";
    const source = w.put(notes("fonte.md"), before);
    await w.index();
    const body = { source, line: 1, term: "Curso de Março", target: idOf(target), baseVersion: sha(before) };
    const answers = await Promise.all([link(body), link(body)]);
    expect(answers.map(code).sort()).toEqual([
      [200, undefined],
      [409, "edit_conflict"],
    ]);
    const after = fs.readFileSync(source, "utf8");
    expect(after.match(/\[\[/g)).toHaveLength(1);
    expect(after).toBe("o [[Curso de Março|curso de marco]] atrasou, o curso de marco\n");
  });
});

import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { extractLinks, wikilinkKey, type ParsedLink } from "../core/src/memory/linkParser.js";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-v2, S2: what a note says about other notes, and who points at one. The parser is proven on a
 * table; everything else goes through a real index of real files and the HTTP route.
 */

describe("C24 the links a Markdown file holds", () => {
  const SRC = "/vault/notes/fonte.md";
  const links = (text: string): Array<Pick<ParsedLink, "kind" | "target" | "label" | "line">> =>
    extractLinks(text, SRC).map(({ kind, target, label, line }) => ({ kind, target, label, line }));

  const POSITIVE: Array<[string, string, Array<Pick<ParsedLink, "kind" | "target" | "label" | "line">>]> = [
    ["wikilink", "vê [[Alvo]] aqui", [{ kind: "wikilink", target: "alvo", label: null, line: 1 }]],
    [
      "wikilink with folder and label",
      "[[pasta/Alvo|texto longo]]",
      [{ kind: "wikilink", target: "pasta/alvo", label: "texto longo", line: 1 }],
    ],
    [
      "wikilink with a heading",
      "[[Alvo#Título]]",
      [{ kind: "wikilink", target: "alvo", label: null, line: 1 }],
    ],
    ["embed", "![[Alvo]]", [{ kind: "wikilink", target: "alvo", label: null, line: 1 }]],
    [
      "relative Markdown link with a fragment",
      "[texto](./alvo.md#parte)",
      [{ kind: "markdown-link", target: "/vault/notes/alvo.md", label: "texto", line: 1 }],
    ],
  ];
  for (const [name, text, expected] of POSITIVE) {
    it(`C24 reads a ${name}`, () => expect(links(text)).toEqual(expected));
  }

  const NEGATIVE: Array<[string, string]> = [
    ["a fenced block (```)", "```\n[[Alvo]] e [x](./a.md)\n```"],
    ["a fenced block (~~~)", "~~~md\n[[Alvo]]\n~~~"],
    ["an inline code span", "use `[[Alvo]]` e ``[x](./a.md)`` assim"],
    ["an https address", "[site](https://exemplo.com/a.md)"],
    ["a mailto address", "[mail](mailto:a@b.c)"],
    ["an anchor", "[ver](#secao) e [[#Secao]]"],
  ];
  for (const [name, text] of NEGATIVE) {
    it(`C24 reads no link in ${name}`, () => expect(links(text)).toEqual([]));
  }

  it("C24 the table is the whole set: five forms read, six places that give nothing", () => {
    expect(POSITIVE).toHaveLength(5);
    expect(NEGATIVE).toHaveLength(6);
  });

  it("C24 keeps line numbers across front matter and fences, leaves the front matter alone, and dedupes a line", () => {
    const text = [
      "---",
      "title: x [[Dentro]]",
      "---",
      "",
      "[[Um]]",
      "```",
      "[[Nao]]",
      "```",
      "[[Dois]] e [[Dois]]",
      "[[Tres|a\\|b]]",
    ].join("\n");
    expect(links(text)).toEqual([
      { kind: "wikilink", target: "um", label: null, line: 5 },
      { kind: "wikilink", target: "dois", label: null, line: 9 },
      { kind: "wikilink", target: "tres", label: "a|b", line: 10 },
    ]);
  });

  it("C24 a closing fence must be as long as the opening one, and an unclosed fence runs to the end", () => {
    expect(links("````\n```\n[[Dentro]]\n````\n[[Fora]]")).toEqual([
      { kind: "wikilink", target: "fora", label: null, line: 5 },
    ]);
    expect(links("[[Antes]]\n```\n[[Depois]]")).toEqual([
      { kind: "wikilink", target: "antes", label: null, line: 1 },
    ]);
  });

  it("C24 Markdown targets are resolved against the file's folder, decoded, with angle brackets, and never to the file itself", () => {
    expect(links("[a](../outra/b%20c.md) [d](<com espaço.md>) [e](./fonte.md) ![img](x.png)")).toEqual([
      { kind: "markdown-link", target: "/vault/outra/b c.md", label: "a", line: 1 },
      { kind: "markdown-link", target: "/vault/notes/com espaço.md", label: "d", line: 1 },
      { kind: "markdown-link", target: "/vault/notes/x.png", label: "img", line: 1 },
    ]);
    expect(links("[quebrado](%E0%A4%A.md)")).toEqual([]);
  });

  it("C24 a wikilink key has no heading, no .md, forward slashes and lower case", () => {
    expect(wikilinkKey(" Pasta\\Sub/Nota.MD#Parte ")).toBe("pasta/sub/nota");
    // accents: composed (NFC) and lower case in the Unicode sense, however the person or the file system spelled them
    expect(wikilinkKey("Édito")).toBe("édito");
    expect(wikilinkKey("E\u0301dito")).toBe("édito");
    expect(wikilinkKey("AÇÃO.MD")).toBe("ação");
    expect(wikilinkKey("Índice/Pão de Queijo")).toBe("índice/pão de queijo");
    expect(wikilinkKey("./Nota.markdown")).toBe("nota");
    expect(wikilinkKey("foto.PNG")).toBe("foto.png");
    expect(wikilinkKey("#só-heading")).toBe("");
  });
});

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let app: FastifyInstance;
let token: string;
const owner = () => ({ "x-mordomo-token": token });
let seq = 0;
/** A folder inside memory/ for one test, so tests do not see each other's files. */
const area = () => {
  const dir = path.join(temp.paths.memory, `t${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const put = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const idOf = (file: string): number =>
  (ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
interface LinksBody {
  file: { path: string };
  backlinks: Array<{ file: { path: string }; kind: string; line: number; label: string | null }>;
  outgoing: Array<{
    kind: string;
    target: string;
    label: string | null;
    line: number;
    resolved: { path: string } | null;
    alternatives: Array<{ path: string }>;
  }>;
}
async function links(file: string): Promise<LinksBody> {
  const res = await app.inject({ url: `/api/memory/links?id=${idOf(file)}`, headers: owner() });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as LinksBody;
}

beforeAll(async () => {
  temp = makeTempHome("mordomo-links-");
  ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});
afterAll(async () => {
  await app.close();
  ctx.close();
  temp.cleanup();
});
afterEach(() => vi.restoreAllMocks());

describe("S2 backlinks and broken links", () => {
  it("C25 the route answers the backlinks of two kinds and the outgoing links with the broken one as null", async () => {
    const dir = area();
    const alvo = put(path.join(dir, "alvo25.md"), "# Alvo\n\nsou o destino\n[[Fantasma25]] não existe\n");
    const viaWiki = put(path.join(dir, "um.md"), "# Um\n\nlinha 3 aponta [[Alvo25|o alvo]]\n");
    const viaMd = put(path.join(dir, "dois.md"), "# Dois\n\n\nlinha 4: [ver](./alvo25.md#x)\n");
    put(path.join(dir, "fonte.md"), "[[alvo25]] e [[nada-aqui]]\n");
    await ctx.indexer.indexAllAsync();

    const body = await links(alvo);
    expect(body.file.path).toBe(alvo);
    expect(body.backlinks.map((b) => [b.file.path, b.kind, b.line, b.label])).toEqual([
      [path.join(dir, "dois.md"), "markdown-link", 4, "ver"],
      [path.join(dir, "fonte.md"), "wikilink", 1, null],
      [path.join(dir, "um.md"), "wikilink", 3, "o alvo"],
    ]);
    expect(body.outgoing).toEqual([
      { kind: "wikilink", target: "fantasma25", label: null, line: 4, resolved: null, alternatives: [] },
    ]);
    expect(viaWiki && viaMd).toBeTruthy();

    const fonte = await links(path.join(dir, "fonte.md"));
    expect(fonte.outgoing.map((o) => [o.target, o.resolved?.path ?? null])).toEqual([
      ["alvo25", alvo],
      ["nada-aqui", null],
    ]);
    // the id that does not exist, and the one that is not a number
    expect((await app.inject({ url: "/api/memory/links?id=999999", headers: owner() })).statusCode).toBe(404);
    const bad = await app.inject({ url: "/api/memory/links?id=abc", headers: owner() });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { code: string } }).error.code).toBe("validation");
    expect((await app.inject({ url: "/api/memory/links?id=1" })).statusCode).toBe(401);
  });

  it("C26 a name several files share resolves to the source's folder, else the shortest path, else alphabetical; the rest are alternatives", async () => {
    const root = area();
    const near = put(path.join(root, "projetos", "x", "alvo26.md"), "# perto\n");
    const short = put(path.join(root, "a", "alvo26.md"), "# curto\n");
    const alpha = put(path.join(root, "b", "alvo26.md"), "# alfa\n");
    const longer = put(path.join(root, "notas-longas", "alvo26.md"), "# longo\n");
    const sameFolder = put(
      path.join(root, "projetos", "x", "fonte.md"),
      "[[alvo26]] [[projetos/x/alvo26]] [[b/alvo26]]\n",
    );
    const elsewhere = put(path.join(root, "outros", "fonte.md"), "[[alvo26]]\n");
    await ctx.indexer.indexAllAsync();

    const first = await links(sameFolder);
    expect(first.outgoing.map((o) => o.resolved?.path)).toEqual([near, near, alpha]);
    expect(first.outgoing[0]!.alternatives.map((a) => a.path)).toEqual([short, alpha, longer]);
    // a key with a folder is only that file: no alternatives
    expect(first.outgoing[1]!.alternatives).toEqual([]);
    expect(first.outgoing[2]!.alternatives).toEqual([]);

    const second = await links(elsewhere);
    // `a/alvo26.md` and `b/alvo26.md` are as short as each other: alphabetical decides
    expect(second.outgoing[0]!.resolved!.path).toBe(short);
    expect(second.outgoing[0]!.alternatives.map((a) => a.path)).toEqual([alpha, near, longer]);

    // the file that won has the backlinks; the others have none from this link
    expect((await links(short)).backlinks.map((b) => b.file.path)).toEqual([elsewhere]);
    expect((await links(longer)).backlinks).toEqual([]);
    expect((await links(near)).backlinks.map((b) => [b.file.path, b.line])).toEqual([
      [sameFolder, 1],
      [sameFolder, 1],
    ]);
    expect((await links(alpha)).backlinks.map((b) => b.file.path)).toEqual([sameFolder]);
  });

  it("C26 a wikilink to a note whose name starts with an accented capital resolves, however it is typed or stored", async () => {
    const root = area();
    const edito = put(path.join(root, "Édito.md"), "# Édito\n");
    const indice = put(path.join(root, "Índice.md"), "# Índice\n");
    const acao = put(path.join(root, "Ação.md"), "# Ação\n");
    const acaoOutra = put(path.join(root, "zz", "Ação.md"), "# Ação, outra\n");
    const queijo = put(path.join(root, "Pão de Queijo.md"), "# Queijo\n");
    const cafe = put(path.join(root, "Cafe\u0301.md"), "# Café, NFD no disco\n"); // 'e' + combining acute
    const pasta = put(path.join(root, "pt-BR", "Édito.md"), "# Édito, na pasta\n");
    // one link a line: a line's links to the same name are one row
    const typed = [
      "[[Édito]]", //                       1  the same name typed four ways: the file in this folder wins
      "[[édito]]",
      "[[ÉDITO]]",
      "[[E\u0301dito]]", //                 4
      "[[Índice]]", //                       5
      "[[índice|o índice]]",
      "[[ação]]", //                         7  two files are called Ação: the shortest path wins
      "[[AÇÃO]]",
      "[[Pão de Queijo]]", //                9
      "[[pão de queijo#Receita]]",
      "[[Café]]", //                        11  a file name stored decomposed
      "[[cafe\u0301]]",
      "[[CAFÉ]]",
      "[[Edito]]", //                       14  without the accent it is another name
      "[[Acao]]",
      "[[pt-BR/Édito]]", //                 16
      "[[../Édito]]", //                    17  not a key
    ];
    const source = put(path.join(root, "pt-BR", "fonte.md"), typed.join("\n") + "\n");
    const fromRoot = put(path.join(root, "raiz.md"), "[[Édito]]\n");
    await ctx.indexer.indexAllAsync();
    const outgoing = (await links(source)).outgoing;
    expect(outgoing).toHaveLength(typed.length);
    expect(outgoing.map((o) => o.resolved?.path ?? null)).toEqual([
      pasta,
      pasta,
      pasta,
      pasta,
      indice,
      indice,
      acao,
      acao,
      queijo,
      queijo,
      cafe,
      cafe,
      cafe,
      null,
      null,
      pasta,
      null,
    ]);
    expect(outgoing[6]!.alternatives.map((a) => a.path)).toEqual([acaoOutra]);
    expect(outgoing.map((o) => o.target).slice(0, 4)).toEqual(["édito", "édito", "édito", "édito"]);
    // each target has its backlinks, the same note's other files none of them
    expect((await links(pasta)).backlinks.map((b) => [b.file.path, b.line])).toEqual([
      [source, 1],
      [source, 2],
      [source, 3],
      [source, 4],
      [source, 16],
    ]);
    expect((await links(edito)).backlinks.map((b) => [b.file.path, b.line])).toEqual([[fromRoot, 1]]);
    expect((await links(indice)).backlinks.map((b) => b.line)).toEqual([5, 6]);
    expect((await links(acao)).backlinks.map((b) => b.line)).toEqual([7, 8]);
    expect((await links(acaoOutra)).backlinks).toEqual([]);
    expect((await links(queijo)).backlinks.map((b) => b.line)).toEqual([9, 10]);
    expect((await links(cafe)).backlinks.map((b) => b.line)).toEqual([11, 12, 13]);
  });

  it("C30 links stored by the first extraction (decomposed accents) are folded by the next full pass, opening no file", async () => {
    const root = area();
    const alvo = put(path.join(root, "Édito.md"), "# Édito\n");
    const source = put(path.join(root, "origem.md"), "[[E\u0301dito]]\n[[Édito#parte]]\n[[outro]]\n");
    await ctx.indexer.indexAllAsync();
    expect((await links(source)).outgoing.map((o) => o.resolved?.path ?? null)).toEqual([alvo, alvo, null]);
    // what version 1 stored: lower case, never composed (and the marker of that version)
    ctx.db
      .prepare("UPDATE note_links SET target = 'e\u0301dito' WHERE src_id = ? AND target = 'édito'")
      .run(idOf(source));
    ctx.db.prepare("UPDATE meta SET value = '1' WHERE key = 'index.note_links'").run();
    expect((await links(source)).outgoing.map((o) => o.target)).toEqual([
      "e\u0301dito",
      "e\u0301dito",
      "outro",
    ]);
    expect((await links(source)).outgoing.map((o) => o.resolved?.path ?? null)).toEqual([null, null, null]);
    expect((await links(alvo)).backlinks).toEqual([]);

    const opened: string[] = [];
    const realOpen = fs.openSync;
    (fs as any).openSync = (file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file).startsWith(root)) opened.push(String(file));
      return (realOpen as (...a: unknown[]) => number)(file, ...rest);
    };
    try {
      await ctx.indexer.indexAllAsync();
    } finally {
      (fs as any).openSync = realOpen;
    }
    expect(opened).toEqual([]);
    expect((await links(source)).outgoing.map((o) => [o.target, o.resolved?.path ?? null])).toEqual([
      ["édito", alvo],
      ["édito", alvo],
      ["outro", null],
    ]);
    expect((await links(alvo)).backlinks.map((b) => [b.file.path, b.line])).toEqual([
      [source, 1],
      [source, 2],
    ]);
    expect(ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.note_links'").get()).toEqual({
      value: "2",
    });
  });

  it("C27 creating the target of a broken link resolves it and deleting it breaks it again, without reading any source", async () => {
    const dir = area();
    const source = put(path.join(dir, "origem.md"), "[[futuro27]] e [lá](./futuro27.md)\n");
    await ctx.indexer.indexAllAsync();
    expect((await links(source)).outgoing.map((o) => o.resolved)).toEqual([null, null]);

    const target = put(path.join(dir, "futuro27.md"), "# Futuro\n");
    const opened: string[] = [];
    const realOpen = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file).startsWith(temp.paths.memory)) opened.push(String(file));
      return (realOpen as (...a: unknown[]) => number)(file, ...rest);
    }) as typeof fs.openSync);
    await ctx.indexer.indexAllAsync();
    // only the new file was opened; the source that points at it was not read again
    expect(opened.filter((f) => f.startsWith(dir)).sort()).toEqual([target]);
    expect((await links(source)).outgoing.map((o) => o.resolved?.path)).toEqual([target, target]);
    expect((await links(target)).backlinks.map((b) => [b.file.path, b.kind])).toEqual([
      [source, "markdown-link"],
      [source, "wikilink"],
    ]);

    fs.rmSync(target);
    opened.length = 0;
    await ctx.indexer.indexAllAsync();
    expect(opened.filter((f) => f.startsWith(dir))).toEqual([]);
    expect((await links(source)).outgoing.map((o) => o.resolved)).toEqual([null, null]);
  });

  it("C28 a rename rewrites nothing: the links break in their sources, the bytes stay, and renaming back heals them", async () => {
    const dir = area();
    const target = put(path.join(dir, "antes28.md"), "# Antes\n");
    const source = put(path.join(dir, "fonte.md"), "[[antes28]] e [x](./antes28.md)\n");
    const other = put(path.join(dir, "outra.md"), "nada\n");
    await ctx.indexer.indexAllAsync();
    const before = new Map(
      [source, other, target].map((f) => [f, [fs.readFileSync(f), fs.statSync(f).mtimeMs] as const]),
    );
    expect((await links(source)).outgoing.every((o) => o.resolved?.path === target)).toBe(true);

    const renamed = path.join(dir, "depois28.md");
    fs.renameSync(target, renamed);
    await ctx.indexer.indexAllAsync();
    const broken = await links(source);
    expect(broken.outgoing.map((o) => o.resolved)).toEqual([null, null]);
    expect((await links(renamed)).backlinks).toEqual([]);
    for (const f of [source, other]) {
      expect(fs.readFileSync(f).equals(before.get(f)![0]), f).toBe(true);
      expect(fs.statSync(f).mtimeMs, f).toBe(before.get(f)![1]);
    }

    fs.renameSync(renamed, target);
    await ctx.indexer.indexAllAsync();
    expect((await links(source)).outgoing.every((o) => o.resolved?.path === target)).toBe(true);
  });

  it("C29 a row the policy excludes today is neither a backlink nor a target, and its own id is 404", async () => {
    const dir = area();
    const alvo = put(path.join(dir, "alvo29.md"), "# Alvo\n");
    const visivel = put(path.join(dir, "visivel.md"), "[[alvo29]]\n");
    await ctx.indexer.indexAllAsync();
    const alvoId = idOf(alvo);

    // stale rows an older index could hold: the token, a secret name, and a user exclude
    const insert = ctx.db.prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 1, 1, NULL, '[]', '{}')",
    );
    const link = ctx.db.prepare(
      "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (?, 'wikilink', ?, NULL, 1)",
    );
    const home = temp.paths.home;
    const stale = (root: string, rel: string, name: string) => {
      const full = path.join(root, rel);
      const info = insert.run(root, full, rel, name, path.extname(name), path.dirname(full));
      return { id: Number(info.lastInsertRowid), full };
    };
    const token = stale(home, path.join("config", "token"), "token");
    const secret = stale(dir, ".env", ".env");
    const settings = ctx.settings();
    settings.excludes = [...settings.excludes, "privado"];
    ctx.settingsStore.save(settings);
    const hidden = stale(dir, path.join("privado", "nota29.md"), "nota29.md");
    for (const row of [token, secret, hidden]) link.run(row.id, "alvo29");

    expect((await links(alvo)).backlinks.map((b) => b.file.path)).toEqual([visivel]);
    for (const row of [token, secret, hidden]) {
      const res = await app.inject({ url: `/api/memory/links?id=${row.id}`, headers: owner() });
      expect(res.statusCode, row.full).toBe(404);
    }
    // an excluded file is not a target either: a link that names it leads nowhere
    const source = put(path.join(dir, "aponta.md"), "[[nota29]] [[token]]\n");
    await ctx.indexer.indexAllAsync();
    const out = await links(source);
    expect(out.outgoing.map((o) => o.resolved)).toEqual([null, null]);
    void alvoId;
  });
});

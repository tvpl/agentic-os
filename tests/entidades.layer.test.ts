import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { entityNorm, extractMentions, extractTerms } from "../core/src/memory/entityMentions.js";
import {
  coMentionEdges,
  computeEntities,
  entityDetail,
  liveMentions,
  nameCandidates,
  nameSignature,
  type CorrectionRow,
  type EntityView,
  type MentionRow,
} from "../core/src/memory/entities.js";
import { notesViewWorld, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch A, S1 at its own layer (doors 1 and 2): the term rule, the norm, the
 * stages of the dedup (the same norm, the gate, MinHash over the names' 3-grams), the shown name, the term threshold, the
 * hub, and the cache of the reader. Called with no HTTP, one case per row of each decision.
 */

const names = (content: string) => extractTerms(content).map((t) => t.name);

describe("C5 the term rule", () => {
  const rows: Array<[string, string, string[]]> = [
    ["consecutive words only", "Reunião com Banco Central do Brasil", ["Banco Central"]],
    ["at most 4 words", "Projeto Atlas Nova Fase Dois", ["Projeto Atlas Nova Fase"]],
    ["\\p{Lu}", "São Paulo", ["São Paulo"]],
    ["a leading stopword", "O Projeto Atlas", ["Projeto Atlas"]],
    ["each word has 2 letters", "A B", []],
    ["one word alone", "Reunião", []],
    ["separated only by spaces", "Ana, Bruno", []],
  ];
  for (const [row, text, want] of rows) {
    it(`C5 ${row}: ${text}`, () => {
      expect(names(text)).toEqual(want);
    });
  }
  it("C5 a leading stopword of 2 letters goes by the stopword rule alone: Os Projetos Atlas", () => {
    // `O` is out by the 2-letter rule already; `Os` is a word, and a stopword of the recall.
    expect(names("Os Projetos Atlas")).toEqual(["Projetos Atlas"]);
    expect(names("Novos Projetos Atlas")).toEqual(["Novos Projetos Atlas"]);
  });
});

describe("C6 where no term is taken", () => {
  const rows: Array<[string, string]> = [
    ["the front matter", "---\ntitle: Nota\nresumo: Banco Central\n---\ntexto comum\n"],
    ["a fenced block of backticks", "texto\n```\nBanco Central\n```\nfim\n"],
    ["a fenced block of tildes", "texto\n~~~\nBanco Central\n~~~\nfim\n"],
    ["an inline code span", "uso de `Banco Central` aqui\n"],
    ["a link's URL", "veja [x](Banco Central/a.md) depois\n"],
  ];
  for (const [row, text] of rows) {
    it(`C6 ${row}`, () => {
      expect(text).toContain("Banco Central");
      expect(names(text)).toEqual([]);
    });
  }
  it("C6 the link's text outside the URL is read", () => {
    expect(names("veja [Banco Central](notas/a.md) depois\n")).toEqual(["Banco Central"]);
  });
});

describe("C136 a wikilink's address is not read as a term (Landing 1a)", () => {
  const termRows = (content: string) =>
    extractMentions(content, "/n/nota.md")
      .filter((r) => r.proof === "termo")
      .map((r) => [r.line, r.name]);

  it("C136 [[Banco Central do Brasil]] gives no termo row at its line; the same words in plain text on another line give one", () => {
    expect(termRows("falei com [[Banco Central do Brasil]] hoje\n")).toEqual([]);
    expect(termRows("falei com [[Banco Central]] hoje\nvisita ao Banco Central ontem\n")).toEqual([
      [2, "Banco Central"],
    ]);
  });

  it("C136 [[x|Banco Central]]: the address x is not read and the label after | is (Landing 1a)", () => {
    expect(termRows("falei com [[x|Banco Central]] hoje\n")).toEqual([[1, "Banco Central"]]);
    // the address of the same link is a term-shaped phrase and still none
    expect(termRows("falei com [[Mesa Redonda|Banco Central]] hoje\n")).toEqual([[1, "Banco Central"]]);
    expect(extractTerms("falei com [[Mesa Redonda|Banco Central]] hoje\n")).toEqual([
      { name: "Banco Central", line: 1, column: 25 },
    ]);
  });

  it("C136 the address inside a Markdown link's parentheses is none either; the link's text is read", () => {
    expect(termRows("veja [nota](Banco Central do Brasil/a.md) depois\n")).toEqual([]);
    expect(termRows("veja [Mesa Redonda](Banco Central/a.md) depois\n")).toEqual([[1, "Mesa Redonda"]]);
  });
});

describe("C10 the norm", () => {
  const rows: Array<[string, string, string]> = [
    ["case and punctuation", "#Cliente-X", "cliente x"],
    ["case", "cliente x", "cliente x"],
    ["spaces together", "CLIENTE  X", "cliente x"],
    ["diacritics", "João", "joao"],
    ["NFC and width", "Ｃａｆé", "cafe"],
    ["punctuation as space", "a.b-c", "a b c"],
    ["cedilla", "Ç", "c"],
    ["empty", "", ""],
  ];
  for (const [row, name, want] of rows) {
    it(`C10 ${row}: ${JSON.stringify(name)}`, () => {
      expect(entityNorm(name)).toBe(want);
    });
  }
  it("C10 an empty name gives no row", () => {
    expect(entityNorm("...")).toBe("");
    const rows = extractMentions(
      '---\ntype: profile\ntitle: Ana Souza\naliases: ["...", Ana]\n---\ntexto\n',
      "/n/ana.md",
    );
    expect(rows.map((r) => r.name)).toEqual(["Ana Souza", "Ana"]);
  });
});

let rowSeq = 0;
/** One mention row as the index stores it, in file `src`. */
function mention(
  src: number,
  proof: MentionRow["proof"],
  kind: MentionRow["kind"],
  name: string,
  extra: Partial<MentionRow> = {},
): MentionRow {
  return {
    srcId: src,
    line: ++rowSeq,
    proof,
    kind,
    name,
    norm: entityNorm(name),
    path: `/notas/${src}.md`,
    title: proof === "nota" ? name : null,
    ...extra,
  };
}

const correction = (
  id: number,
  action: CorrectionRow["action"],
  a: string,
  b: string | null = null,
  name: string | null = null,
): CorrectionRow => ({
  id,
  action,
  a,
  b,
  name,
  createdAt: id,
  undoneAt: null,
});

describe("C11 stage 1, the same norm", () => {
  const pairs: Array<[string, MentionRow[], string]> = [
    [
      "perfil over termo",
      [mention(1, "nota", "perfil", "Ana Souza"), mention(2, "termo", "termo", "ANA SOUZA")],
      "perfil:ana souza",
    ],
    [
      "projeto over tag",
      [mention(1, "tag", "tag", "atlas-x"), mention(2, "nota", "projeto", "Atlas X")],
      "projeto:atlas x",
    ],
    [
      "tag over termo",
      [mention(1, "termo", "termo", "Cliente X"), mention(2, "tag", "tag", "Cliente-X")],
      "tag:cliente x",
    ],
    [
      "perfil over projeto",
      [mention(1, "nota", "projeto", "Mesa Azul"), mention(2, "nota", "perfil", "Mesa Azul")],
      "perfil:mesa azul",
    ],
  ];
  for (const [pair, rows, key] of pairs) {
    it(`C11 ${pair}: one entity, key ${key}`, () => {
      const entities = computeEntities(rows, []);
      expect(entities.map((e) => e.key)).toEqual([key]);
      expect(entities[0]).toMatchObject({ kind: key.split(":")[0], files: 2, mentions: 2 });
    });
  }
});

/** The Shannon entropy of the characters of a string without spaces, worked out here from the claim. */
function entropy(s: string): number {
  const chars = [...s.replace(/ /g, "")];
  const counts = new Map<string, number>();
  chars.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
  return [...counts.values()].reduce((h, n) => h - (n / chars.length) * Math.log2(n / chars.length), 0);
}
const trigrams = (s: string) => new Set(Array.from({ length: s.length - 2 }, (_, i) => s.slice(i, i + 3)));

describe("C12 the entropy gate, each edge alone", () => {
  /** The same 32 values for both names: an estimated Jaccard of 1.0, so the gate alone decides. */
  const same = (norms: string[]) => (norm: string) =>
    norms.includes(norm) ? Uint32Array.from({ length: 32 }, (_, i) => i + 1) : nameSignature(norm);
  const tags = (a: string, b: string) => [mention(1, "tag", "tag", a), mention(2, "tag", "tag", b)];

  it("C12 a norm of 5 characters without spaces never merges, with a partner at Jaccard 1.0", () => {
    const [a, b] = ["abcde", "fghijk"];
    expect(entropy(a)).toBeGreaterThanOrEqual(2);
    expect(entropy(b)).toBeGreaterThanOrEqual(2);
    expect(
      computeEntities(tags(a, b), [], { signature: same([a, b]) })
        .map((e) => e.key)
        .sort(),
    ).toEqual(["tag:abcde", "tag:fghijk"]);
  });

  it("C12 a norm of 6 characters merges, with the same partner", () => {
    const [a, b] = ["abcdef", "fghijk"];
    expect(entropy(a)).toBeGreaterThanOrEqual(2);
    expect(computeEntities(tags(a, b), [], { signature: same([a, b]) })).toHaveLength(1);
  });

  it("C12 a norm of entropy 1.99 bits never merges, with a partner of the same 3-grams (Jaccard 1.0)", () => {
    const [a, b] = ["abcdabcdabcdabcdabcda", "abcdabcdabcd"];
    expect(entropy(a)).toBeCloseTo(1.995, 3);
    expect(entropy(a)).toBeLessThan(2);
    expect(entropy(b)).toBe(2);
    expect(trigrams(a)).toEqual(trigrams(b));
    expect(
      computeEntities(tags(a, b), [])
        .map((e) => e.key)
        .sort(),
    ).toEqual([`tag:${b}`, `tag:${a}`].sort());
  });

  it("C12 a norm of entropy 2.0 bits merges, with the same partner", () => {
    const [a, b] = ["abcdabcd", "abcdabcdabcd"];
    expect(entropy(a)).toBe(2);
    expect(trigrams(a)).toEqual(trigrams(b));
    expect(computeEntities(tags(a, b), [])).toHaveLength(1);
  });
});

/** Two signatures of `length` values that share band 0 and differ in `differ` of the last positions. */
function pairOf(length: number, differ: number): [Uint32Array, Uint32Array] {
  const a = Uint32Array.from({ length }, (_, i) => i + 1);
  const b = Uint32Array.from(a);
  for (let i = length - differ; i < length; i++) b[i] = 1_000_000 + i;
  return [a, b];
}
const fixed = (table: Record<string, Uint32Array>) => (norm: string) => table[norm] ?? nameSignature(norm);
const TWO = ["projeto atlantico", "projeto atlantica"] as const;
const twoTags = () => [mention(1, "tag", "tag", TWO[0]), mention(2, "tag", "tag", TWO[1])];
const withSimilarity = (differ: number, length = 100) => {
  const [a, b] = pairOf(length, differ);
  return computeEntities(twoTags(), [], { signature: fixed({ [TWO[0]]: a, [TWO[1]]: b }) });
};

describe("C13 MinHash over the names' 3-grams", () => {
  it("C13 the signature has 32 values, the minhash-v1 hash of the character 3-grams, the same in two processes of another LANG and TZ", () => {
    const norm = "banco central";
    const sig = nameSignature(norm);
    expect(sig).toHaveLength(32);
    expect(Array.from(nameSignature(norm))).toEqual(Array.from(sig));
    const url = pathToFileURL(path.resolve(import.meta.dirname, "../core/src/memory/minhash.ts")).href;
    const grams = [...trigrams(norm)];
    const code = `import(${JSON.stringify(url)}).then((m) => process.stdout.write(JSON.stringify(Array.from(m.minhashMins(${JSON.stringify(grams)}, 32)))))`;
    const child = (env: Record<string, string>) =>
      JSON.parse(
        execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], {
          env: { ...process.env, ...env },
          encoding: "utf8",
        }),
      ) as number[];
    const tr = child({ LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Asia/Tokyo" });
    const us = child({ LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "America/Los_Angeles" });
    expect(tr).toEqual(us);
    expect(tr).toEqual(Array.from(sig));
  });

  it("C13 two norms at estimated Jaccard 0.9 merge", () => {
    expect(withSimilarity(10)).toHaveLength(1);
  });

  it("C13 two norms at 0.89 do not", () => {
    expect(withSimilarity(11)).toHaveLength(2);
  });

  it("C13 two norms in no common band are never compared", () => {
    // 400 values: the first 32 (the 8 bands of 4) all differ, the other 368 agree: 0.92 if they were compared.
    const a = Uint32Array.from({ length: 400 }, (_, i) => i + 1);
    const b = Uint32Array.from(a);
    for (let i = 0; i < 32; i++) b[i] = 1_000_000 + i;
    expect(
      nameCandidates([
        { norm: TWO[0], sig: a },
        { norm: TWO[1], sig: b },
      ]),
    ).toEqual([]);
    const entities = computeEntities(twoTags(), [], { signature: fixed({ [TWO[0]]: a, [TWO[1]]: b }) });
    expect(entities).toHaveLength(2);
    expect(entities.flatMap((e) => e.duplicates)).toEqual([]);
  });
});

describe("C14 maybe the same", () => {
  const dupes = (differ: number) =>
    withSimilarity(differ).map((e) => ({
      key: e.key,
      duplicates: e.duplicates.map((d) => [d.key, d.similarity]),
    }));
  it("C14 0.7 lists each in the other's duplicates with similarity 0.7", () => {
    expect(dupes(30)).toEqual([
      { key: `tag:${TWO[1]}`, duplicates: [[`tag:${TWO[0]}`, 0.7]] },
      { key: `tag:${TWO[0]}`, duplicates: [[`tag:${TWO[1]}`, 0.7]] },
    ]);
  });
  it("C14 0.69 lists nothing", () => {
    expect(dupes(31).flatMap((e) => e.duplicates)).toEqual([]);
    expect(dupes(31)).toHaveLength(2);
  });
  it("C14 0.89 lists", () => {
    expect(dupes(11)).toEqual([
      { key: `tag:${TWO[1]}`, duplicates: [[`tag:${TWO[0]}`, 0.89]] },
      { key: `tag:${TWO[0]}`, duplicates: [[`tag:${TWO[1]}`, 0.89]] },
    ]);
  });
});

describe("C15 the shown name", () => {
  it("C15 with a nota mention, its name", () => {
    const rows = [
      mention(1, "nota", "perfil", "Ana Souza"),
      mention(2, "termo", "termo", "ANA SOUZA"),
      mention(3, "termo", "termo", "ANA SOUZA"),
      mention(4, "termo", "termo", "ANA SOUZA"),
    ];
    expect(computeEntities(rows, []).map((e) => e.name)).toEqual(["Ana Souza"]);
  });
  it("C15 without one, the most frequent: Banco Central x3 over BANCO CENTRAL x1", () => {
    const rows = [
      mention(1, "termo", "termo", "BANCO CENTRAL"),
      mention(2, "termo", "termo", "Banco Central"),
      mention(3, "termo", "termo", "Banco Central"),
      mention(4, "termo", "termo", "Banco Central"),
    ];
    expect(computeEntities(rows, []).map((e) => [e.key, e.name])).toEqual([
      ["termo:banco central", "Banco Central"],
    ]);
  });
  it("C15 on a tie, the first alphabetically", () => {
    const rows = [
      mention(1, "termo", "termo", "Zulu Beta"),
      mention(2, "termo", "termo", "Zulu Beta"),
      mention(3, "termo", "termo", "Alfa Beta"),
      mention(4, "termo", "termo", "Alfa Beta"),
    ];
    const merged = computeEntities(rows, [correction(1, "merge", "zulu beta", "alfa beta")]);
    expect(merged.map((e) => [e.key, e.name, e.aliases])).toEqual([
      ["termo:alfa beta", "Alfa Beta", ["Zulu Beta"]],
    ]);
  });
});

describe("C16 the term threshold", () => {
  it("C16 a term in exactly 1 file is not an entity; in 2 files it is; over the 1 of the 2 an audience sees, it is not", () => {
    const one = [
      mention(1, "termo", "termo", "Banco Central"),
      mention(1, "termo", "termo", "Banco Central"),
    ];
    expect(computeEntities(one, [])).toEqual([]);
    const two = [...one, mention(2, "termo", "termo", "Banco Central")];
    expect(computeEntities(two, []).map((e) => [e.key, e.files])).toEqual([["termo:banco central", 2]]);
    const seen = (allowed: number) => two.filter((r) => r.srcId === allowed);
    expect(computeEntities(seen(2), [])).toEqual([]);
  });
});

describe("C19 a hub", () => {
  const spread = (files: number) =>
    computeEntities(
      Array.from({ length: files }, (_, i) => mention(i + 1, "tag", "tag", "geral")),
      [],
    )[0]!;
  it("C19 mentions in 51 files: listed with files 51 and hub true", () => {
    expect(spread(51)).toMatchObject({ key: "tag:geral", files: 51, hub: true });
  });
  it("C19 in 50 files: hub false", () => {
    expect(spread(50)).toMatchObject({ key: "tag:geral", files: 50, hub: false });
  });
  it("C19 a hub carries no co-mention edge", () => {
    const hub = spread(51);
    expect(coMentionEdges([hub])).toEqual([]);
    expect(coMentionEdges([spread(50)])).toHaveLength((50 * 49) / 2);
  });
});

describe("C20 the cache", () => {
  let w: NotesViewWorld;
  beforeAll(async () => {
    w = await notesViewWorld("mordomo-entidades-cache-");
    const root = w.indexedRoot("cache");
    w.put(path.join(root, "a.md"), "---\ntags: [cliente-x]\n---\nReunião com Banco Central.\n");
    w.put(path.join(root, "b.md"), "Visita ao Banco Central.\n");
    await w.index();
  });
  afterAll(async () => {
    await w.close();
  });

  it("C20 two reads compute once; a finished pass and a new correction each make the next read compute again; one view per audience", async () => {
    const reader = w.ctx.entities;
    reader.invalidate();
    const compute = vi.spyOn(reader, "compute");
    try {
      const all = () => true;
      reader.read("owner", all);
      reader.read("owner", all);
      expect(compute).toHaveBeenCalledTimes(1);

      // an owner's view does not serve a device
      reader.read("devices", all);
      expect(compute).toHaveBeenCalledTimes(2);
      reader.read("devices", all);
      expect(compute).toHaveBeenCalledTimes(2);

      await w.index();
      reader.read("owner", all);
      expect(compute).toHaveBeenCalledTimes(3);
      reader.read("owner", all);
      expect(compute).toHaveBeenCalledTimes(3);

      const res = await w.call("POST", "/api/memory/entities/corrections", {
        action: "rename",
        key: "tag:cliente x",
        name: "Cliente X",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const before = compute.mock.calls.length;
      const view = reader.read("owner", all);
      expect(compute).toHaveBeenCalledTimes(before + 1);
      expect(view.byKey.get("tag:cliente x")?.name).toBe("Cliente X");
      reader.read("owner", all);
      expect(compute).toHaveBeenCalledTimes(before + 1);
    } finally {
      compute.mockRestore();
    }
  });
});

describe("C133 the nome rows of an add that is not active are ignored at read", () => {
  const add = (id: number, kind: string, aliases: string[] = []) =>
    correction(id, "add", "bruno lima", JSON.stringify({ kind, aliases }), "Bruno Lima");
  const nome = (src: number, kind: MentionRow["kind"], name: string) => mention(src, "nome", kind, name);
  const keys = (rows: MentionRow[], corrections: CorrectionRow[]) =>
    computeEntities(rows, corrections).map((e) => e.key);

  it("C133 an add that is active lists the entity from its nome rows", () => {
    const rows = [nome(1, "perfil", "Bruno Lima"), nome(2, "perfil", "Bruno")];
    expect(keys(rows, [add(1, "perfil", ["Bruno"])])).toEqual(["perfil:bruno lima"]);
  });

  it("C133 the same rows with the add undone list no entity, and none of the rows is read", () => {
    const rows = [nome(1, "perfil", "Bruno Lima"), nome(2, "perfil", "Bruno")];
    const undone = [{ ...add(1, "perfil", ["Bruno"]), undoneAt: 9 }];
    expect(keys(rows, undone)).toEqual([]);
    expect(liveMentions(rows, undone)).toEqual([]);
    expect(keys(rows, [])).toEqual([]);
  });

  it("C133 an entity with a nota row stays listed with only that row once the add is undone", () => {
    const rows = [
      mention(3, "nota", "perfil", "Bruno"),
      nome(1, "perfil", "Bruno Lima"),
      nome(2, "perfil", "Bruno"),
    ];
    const live = computeEntities(rows, [add(1, "perfil", ["Bruno"])]);
    expect(live.map((e) => [e.key, e.mentions, e.files])).toEqual([["perfil:bruno", 3, 3]]);
    const undone = computeEntities(rows, [{ ...add(1, "perfil", ["Bruno"]), undoneAt: 9 }]);
    expect(undone.map((e) => [e.key, e.mentions, e.files])).toEqual([["perfil:bruno", 1, 1]]);
  });

  it("C133 a nome row stands for an active add of its own kind only: undone as perfil and accepted as projeto, the perfil rows are ignored", () => {
    const rows = [nome(1, "perfil", "Bruno Lima"), nome(2, "perfil", "Bruno")];
    const corrections = [{ ...add(1, "perfil", ["Bruno"]), undoneAt: 9 }, add(2, "projeto", ["Bruno"])];
    expect(liveMentions(rows, corrections)).toEqual([]);
    expect(computeEntities(rows, corrections).map((e) => [e.key, e.kind, e.mentions])).toEqual([
      ["projeto:bruno lima", "projeto", 0],
    ]);
  });
});

describe("C134 an entity's detail names only the norms the audience sees", () => {
  let world: NotesViewWorld;
  beforeAll(async () => {
    world = await notesViewWorld("mordomo-entidades-detail-");
  });
  afterAll(async () => {
    await world.close();
  });

  /** The view of an audience that reads `rows` (the corrections are the owner's, whoever reads). */
  const viewOf = (rows: MentionRow[], corrections: CorrectionRow[]): EntityView => {
    const entities = computeEntities(rows, corrections);
    const byNorm = new Map<string, (typeof entities)[number]>();
    for (const e of entities) for (const n of e.norms) byNorm.set(n, e);
    return { rows, corrections, entities, byKey: new Map(entities.map((e) => [e.key, e])), byNorm };
  };
  const open = [mention(1, "nota", "perfil", "Ana Souza")];
  const hiddenOnly = [
    mention(2, "termo", "termo", "Projeto Sigilo"),
    mention(3, "termo", "termo", "Projeto Sigilo"),
    mention(4, "nota", "perfil", "Ana Souzas"),
  ];
  const merge = correction(1, "merge", "ana souza", "projeto sigilo");

  it("C134 the owner's detail lists both names of a merge and the near-duplicate; the audience that reads only the open file lists ana souza and no duplicate", () => {
    const owner = entityDetail(world.ctx.db, viewOf([...open, ...hiddenOnly], [merge]), "perfil:ana souza");
    expect(owner?.corrections.map((c) => c.names)).toEqual([["ana souza", "projeto sigilo"]]);
    expect(owner?.duplicates.map((d) => d.key)).toEqual(["perfil:ana souzas"]);

    const seen = entityDetail(world.ctx.db, viewOf(open, [merge]), "perfil:ana souza");
    expect(seen?.corrections).toEqual([
      { id: 1, action: "merge", names: ["ana souza"], createdAt: 1, undoneAt: null },
    ]);
    expect(seen?.duplicates).toEqual([]);
    expect(JSON.stringify(seen)).not.toMatch(/sigilo|souzas/i);
  });

  it("C134 a correction whose every name is hidden is not listed; one whose names are all visible keeps both", () => {
    const view = viewOf(
      [...open, mention(5, "tag", "tag", "cliente x"), mention(6, "tag", "tag", "cliente y")],
      [
        merge,
        correction(2, "rename", "projeto sigilo", null, "Outro nome"),
        correction(3, "separate", "ana souza", "cliente x"),
      ],
    );
    const seen = entityDetail(world.ctx.db, view, "perfil:ana souza");
    expect(seen?.corrections.map((c) => [c.id, c.action, c.names])).toEqual([
      [1, "merge", ["ana souza"]],
      [3, "separate", ["ana souza", "cliente x"]],
    ]);
  });
});

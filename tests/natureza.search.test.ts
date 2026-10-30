import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mordomoTools, type McpApi } from "../apps/api/src/mcp/mordomo.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, batch A, S2: the search and the recall segregated by nature and scope, through
 * `app.inject` against `buildServer` over a real home and real index passes. The labelling itself, one case per row, is
 * in `natureza.layer.test.ts`.
 */

let w: NotesViewWorld;
let seq = 0;
const enc = encodeURIComponent;
const code = (r: { body: Json }) => r.body?.error?.code;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-natureza-search-");
});
afterAll(async () => {
  await w.close();
});

const get = (url: string) => w.call("GET", url);
const search = async (query: string): Promise<Json[]> => {
  const res = await get(`/api/memory/search?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as Json[];
};
const recallOf = async (query: string) => {
  const res = await get(`/api/memory/recall?${query}&record=false`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.answerContext as Json[];
};
const note = (natureza: string | null, escopo: string | null, title: string, body: string): string => {
  const header = [
    natureza !== null ? `natureza: ${natureza}` : null,
    escopo !== null ? `escopo: ${escopo}` : null,
  ].filter(Boolean);
  return `${header.length ? `---\n${header.join("\n")}\n---\n` : ""}# ${title}\n\n${body}\n`;
};

describe("S2 the search by nature and scope", () => {
  it("C11 natureza=fato returns only the fato note and natureza=fato,relato the fato and the relato notes, in mode text, semantic and auto", async () => {
    const root = w.indexedRoot(`c11-${++seq}`);
    const fato = w.put(path.join(root, "fato.md"), note("fato", null, "Preço", "O preço anual é 900."));
    const relato = w.put(
      path.join(root, "relato.md"),
      note("relato", null, "Reunião", "Falamos do preço anual."),
    );
    w.put(path.join(root, "plano.md"), note("plano", null, "Plano", "Vamos subir o preço anual."));
    w.put(path.join(root, "solta.md"), note(null, null, "Solta", "Um preço anual sem natureza."));
    w.put(path.join(root, "talvez.md"), note("talvez", null, "Talvez", "Um preço anual talvez."));
    w.update((s) => {
      s.memory.embeddings = { ...s.memory.embeddings, enabled: true, provider: "hash" };
    });
    try {
      await w.index();
      for (const mode of ["text", "semantic", "auto"]) {
        const only = await search(`q=${enc("preço")}&natureza=fato&mode=${mode}`);
        expect(only.map((h) => h.path).sort(), mode).toEqual([fato]);
        const either = await search(`q=${enc("preço")}&natureza=fato,relato&mode=${mode}`);
        expect(either.map((h) => h.path).sort(), mode).toEqual([fato, relato].sort());
      }
      // the filter is the only thing that narrows: without it every note of the word is there
      expect(
        (await search(`q=${enc("preço")}&mode=text`)).filter((h) => h.path.startsWith(root)),
      ).toHaveLength(5);
    } finally {
      w.update((s) => {
        s.memory.embeddings = { ...s.memory.embeddings, enabled: false };
      });
    }
  });

  it("C12 escopo=pessoal returns only pessoal files, and natureza=fato&escopo=pessoal only the file that is both", async () => {
    const root = w.indexedRoot(`c12-${++seq}`);
    const both = w.put(path.join(root, "ambos.md"), note("fato", "pessoal", "Ambos", "carambola doce"));
    w.put(path.join(root, "equipe.md"), note("fato", "equipe", "Equipe", "carambola da equipe"));
    const pessoal = w.put(
      path.join(root, "plano.md"),
      note("plano", "pessoal", "Plano", "carambola plantar"),
    );
    w.put(path.join(root, "nada.md"), note(null, null, "Nada", "carambola solta"));
    await w.index();
    expect((await search("q=carambola&escopo=pessoal&mode=text")).map((h) => h.path).sort()).toEqual(
      [both, pessoal].sort(),
    );
    expect((await search("q=carambola&natureza=fato&escopo=pessoal&mode=text")).map((h) => h.path)).toEqual([
      both,
    ]);
  });

  it("C13 each refused search answers alone: 400 validation for a value outside the lists, 404 context_not_found and 409 semantic_disabled as before", async () => {
    const REFUSED = [
      "natureza=talvez",
      "natureza=Fato",
      "natureza=",
      "natureza=fato,talvez",
      "escopo=publico",
    ];
    for (const query of REFUSED) {
      const res = await get(`/api/memory/search?q=x&${query}`);
      expect(res.status, query).toBe(400);
      expect(code(res), query).toBe("validation");
    }
    const lost = await get("/api/memory/search?q=x&context=nao-existe&natureza=fato");
    expect(lost.status).toBe(404);
    expect(code(lost)).toBe("context_not_found");
    expect(w.ctx.settings().memory.embeddings.enabled).toBe(false);
    const off = await get("/api/memory/search?q=x&mode=semantic&natureza=fato");
    expect(off.status).toBe(409);
    expect(code(off)).toBe("semantic_disabled");
  });

  it("C14 every hit carries natureza and escopo, with one hit and with three, null on an unclassified one", async () => {
    const root = w.indexedRoot(`c14-${++seq}`);
    const classified = w.put(
      path.join(root, "a.md"),
      note("hipotese", "externo", "A", "graviola graviola graviola"),
    );
    const bare = w.put(path.join(root, "b.md"), note(null, null, "B", "graviola graviola"));
    const third = w.put(path.join(root, "c.md"), note("relato", null, "C", "graviola"));
    await w.index();
    const one = await search("q=graviola&mode=text&limit=1");
    expect(one).toHaveLength(1);
    expect(Object.keys(one[0]!)).toEqual(expect.arrayContaining(["natureza", "escopo"]));
    const three = await search("q=graviola&mode=text&limit=3");
    expect(three.map((h) => h.path).sort()).toEqual([classified, bare, third].sort());
    for (const hit of three) {
      expect(hit, hit.path).toHaveProperty("natureza");
      expect(hit, hit.path).toHaveProperty("escopo");
    }
    const by = (file: string) => three.find((h) => h.path === file)!;
    expect([by(classified).natureza, by(classified).escopo]).toEqual(["hipotese", "externo"]);
    expect([by(bare).natureza, by(bare).escopo]).toEqual([null, null]);
    expect([by(third).natureza, by(third).escopo]).toEqual(["relato", null]);
  });
});

describe("S2 the recall by nature", () => {
  it("C15 each row of AC 11 at the route: a passage of a fato note is plano, outside it fato, MEMORY.md Open loops plano, no nature null", async () => {
    const root = w.indexedRoot(`c15-${++seq}`);
    const fato = w.put(
      path.join(root, "pequi.md"),
      [
        "---",
        "natureza: fato",
        "---",
        "# Pequi",
        "",
        "## Pequi colheita",
        "",
        "O pequi colheita é em dezembro.",
        "",
        "## Pequi proposta",
        "",
        "> [!plano] Pequi",
        "> Vamos vender pequi proposta em janeiro.",
        "",
      ].join("\n"),
    );
    const bare = w.put(
      path.join(root, "pequi-solto.md"),
      "# Solto\n\n## Pequi solto\n\nUm pequi solto sem natureza.\n",
    );
    const memoryMd = w.put(
      path.join(w.memory, "MEMORY.md"),
      "# Memory\n\n## Facts\n\n- nada\n\n## Open loops\n\n- plantar pequi no sítio\n",
    );
    await w.index();
    const passage = (await recallOf(`q=${enc("pequi proposta")}&k=10`)).find((c) => c.path === fato)!;
    expect(passage).toMatchObject({ section: "Pequi proposta", natureza: "plano" });
    const outside = (await recallOf(`q=${enc("pequi colheita")}&k=10`)).find((c) => c.path === fato)!;
    expect(outside).toMatchObject({ section: "Pequi colheita", natureza: "fato" });
    const loops = (await recallOf(`q=${enc("plantar pequi sítio")}&k=10`)).find((c) => c.path === memoryMd)!;
    expect(loops).toMatchObject({ section: "Open loops", natureza: "plano" });
    const none = (await recallOf(`q=${enc("pequi solto")}&k=10`)).find((c) => c.path === bare)!;
    expect(none.natureza).toBeNull();
  });

  it("C18 natureza=fato returns the fato note's excerpt over a higher plano note, never an unclassified one, and a fato passage of a plano note as fato", async () => {
    const root = w.indexedRoot(`c18-${++seq}`);
    const plano = w.put(
      path.join(root, "preco-anual-plano.md"),
      note(
        "plano",
        null,
        "Preço anual",
        "## Preço anual\n\nO preço anual vai a 1 200, preço anual novo, preço anual.",
      ),
    );
    const fato = w.put(
      path.join(root, "tabela.md"),
      note("fato", null, "Tabela", "## Valores\n\nO preço anual é 900."),
    );
    const bare = w.put(
      path.join(root, "solta.md"),
      note(null, null, "Solta", "## Solta\n\nO preço anual de alguém."),
    );
    const mixed = w.put(
      path.join(root, "misto.md"),
      note(
        "plano",
        null,
        "Misto",
        "## Proposta\n\nTalvez subir.\n\n## Preço anual vigente\n\n> [!fato] Vigente\n> O preço anual vigente é 900, preço anual.",
      ),
    );
    // a plano note whose best section is a plano one, with a smaller fato passage: only the passage may come back
    const leaning = w.put(
      path.join(root, "inclinado.md"),
      note(
        "plano",
        null,
        "Inclinado",
        "## Preço anual futuro\n\nO preço anual futuro, preço anual novo, preço anual maior.\n\n## Hoje\n\n> [!fato]\n> Hoje o preço anual é 900.",
      ),
    );
    await w.index();
    const all = await recallOf(`q=${enc("preço anual")}&k=10`);
    expect(all.find((c) => c.path === leaning)).toMatchObject({
      section: "Preço anual futuro",
      natureza: "plano",
    });
    const score = (file: string) => all.find((c) => c.path === file)?.score ?? -1;
    expect(score(plano)).toBeGreaterThan(score(fato));
    const facts = await recallOf(`q=${enc("preço anual")}&natureza=fato&k=10`);
    expect(facts.find((c) => c.path === fato)).toMatchObject({ natureza: "fato" });
    expect(facts.filter((c) => c.natureza !== "fato")).toEqual([]);
    expect(facts.find((c) => c.path === plano)).toBeUndefined();
    expect(facts.find((c) => c.path === bare)).toBeUndefined();
    expect(facts.find((c) => c.path === mixed)).toMatchObject({
      section: "Preço anual vigente",
      natureza: "fato",
    });
    expect(facts.find((c) => c.path === leaning)).toMatchObject({ section: "Hoje", natureza: "fato" });
    // and the same section is the mixed note's best without a filter, still read as its passage's nature
    expect(all.find((c) => c.path === mixed)).toMatchObject({
      section: "Preço anual vigente",
      natureza: "fato",
    });
  });

  it("C19 escopo=equipe returns only equipe excerpts; natureza=talvez, natureza= and escopo=publico are 400 validation; context=nao-existe is 404 as before", async () => {
    const root = w.indexedRoot(`c19-${++seq}`);
    const equipe = w.put(
      path.join(root, "equipe.md"),
      note("fato", "equipe", "Equipe", "## Cupuaçu\n\nO cupuaçu da equipe."),
    );
    w.put(path.join(root, "pessoal.md"), note("fato", "pessoal", "Pessoal", "## Cupuaçu\n\nO cupuaçu meu."));
    w.put(path.join(root, "nada.md"), note(null, null, "Nada", "## Cupuaçu\n\nO cupuaçu de ninguém."));
    await w.index();
    const all = await recallOf("q=cupuaçu&k=10");
    expect(all.filter((c) => c.path.startsWith(root))).toHaveLength(3);
    const only = await recallOf("q=cupuaçu&escopo=equipe&k=10");
    expect(only.map((c) => c.path)).toEqual([equipe]);
    expect(only.map((c) => c.escopo)).toEqual(["equipe"]);
    for (const query of ["natureza=talvez", "natureza=", "escopo=publico"]) {
      const res = await get(`/api/memory/recall?q=cupuaçu&${query}`);
      expect(res.status, query).toBe(400);
      expect(code(res), query).toBe("validation");
    }
    const lost = await get("/api/memory/recall?q=cupuaçu&context=nao-existe");
    expect(lost.status).toBe(404);
    expect(code(lost)).toBe("context_not_found");
  });
});

describe("C20 what the recall answered before keeps its keys and values", () => {
  /**
   * The answer of this fixture at `aa687ed` (the base of the feature, run there by the same steps), paths relative to
   * its folder.
   */
  const RECORDED = [
    {
      path: "tabela.md",
      section: "Amora venda colheita feira de novo",
      excerpt:
        "Amora venda colheita feira: amora, venda, colheita e feira de novo, amora venda colheita feira amora venda.",
      score: 62.64,
      why: 'pointer from amora-d.md § "Amora venda colheita feira"; section "Amora venda colheita feira de novo" matches amora, colheita, venda, feira',
      via: "amora-d.md",
    },
    {
      path: "amora-d.md",
      section: "Amora venda colheita feira",
      excerpt: "A venda da amora colheita feira, amora madura. Mais em [tabela](./tabela.md).",
      score: 58.58,
      why: 'name matches amora; title matches venda; 4/4 keywords in the index; section "Amora venda colheita feira" matches amora, colheita, venda, feira',
    },
    {
      path: "amora-c.md",
      section: "Amora relato",
      excerpt: "> [!relato] Feira\n> A amora vendeu bem na feira, colheita boa.",
      score: 40.58,
      why: 'name matches amora; title matches amora; 3/4 keywords in the index; section "Amora relato" matches amora, colheita, feira',
    },
  ];

  it("C20 each answerContext item carries natureza and escopo and the six keys as recorded, and the MCP tool recall prints as before with no label", async () => {
    const v = await notesViewWorld("mordomo-natureza-c20-");
    try {
      const root = v.indexedRoot("c20");
      v.put(
        path.join(root, "amora-a.md"),
        "# Amora\n\n## Amora colheita\n\nA amora madura colhe em março. Veja [a venda](./amora-d.md).\n",
      );
      v.put(
        path.join(root, "amora-b.md"),
        "---\nnatureza: plano\nescopo: equipe\n---\n# Amora plano\n\n## Amora venda\n\nVamos vender amora na feira de sábado.\n",
      );
      v.put(
        path.join(root, "amora-c.md"),
        "# Amora relato\n\n> [!relato] Feira\n> A amora vendeu bem na feira, colheita boa.\n",
      );
      v.put(
        path.join(root, "amora-d.md"),
        "# Venda\n\n## Amora venda colheita feira\n\nA venda da amora colheita feira, amora madura. Mais em [tabela](./tabela.md).\n",
      );
      v.put(
        path.join(root, "tabela.md"),
        "# Tabela\n\n## Amora venda colheita feira de novo\n\nAmora venda colheita feira: amora, venda, colheita e feira de novo, amora venda colheita feira amora venda.\n",
      );
      // fixed mtimes, as when the answer was recorded: the candidates' tie-break is the most recent first
      const files = ["amora-a.md", "amora-b.md", "amora-c.md", "amora-d.md", "tabela.md"];
      files.forEach((name, i) =>
        fs.utimesSync(path.join(root, name), 1_700_000_000 + i * 1000, 1_700_000_000 + i * 1000),
      );
      await v.index();
      const question = enc("amora colheita venda feira");
      const res = await v.call("GET", `/api/memory/recall?q=${question}&k=2&record=false`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.answerContext as Json[];
      const rel = (p: string) => path.relative(root, p);
      expect(
        items.map(({ path: p, section, excerpt, score, why, via }) => ({
          path: rel(p),
          section,
          excerpt,
          score,
          why,
          ...(via !== undefined ? { via: rel(via) } : {}),
        })),
      ).toEqual(RECORDED);
      for (const item of items) {
        expect(Object.keys(item).sort(), item.path).toEqual(
          [...Object.keys(RECORDED.find((r) => r.path === rel(item.path))!), "natureza", "escopo"].sort(),
        );
      }
      expect(items.map((c) => [rel(c.path), c.natureza, c.escopo])).toEqual([
        ["tabela.md", null, null],
        ["amora-d.md", null, null],
        ["amora-c.md", "relato", null],
      ]);

      const api: McpApi = {
        get: async <T>(url: string) => (await v.call("GET", url)).body as T,
        post: async () => {
          throw new Error("not used");
        },
        put: async () => {
          throw new Error("not used");
        },
      };
      const tool = mordomoTools(api).find((t) => t.name === "recall")!;
      const printed = await tool.handler({ question: "amora colheita venda feira", k: 2 });
      expect(printed).toBe(
        items.map((c) => `## ${c.path} § ${c.section} (score ${c.score})\n${c.excerpt}`).join("\n\n"),
      );
      expect(String(printed)).not.toMatch(/\[(Plano|Hipótese|Opinião|Não classificado)/);
    } finally {
      await v.close();
    }
  });
});

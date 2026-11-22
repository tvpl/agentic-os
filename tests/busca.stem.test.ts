import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HASH_PROVIDER_ID, hashEmbed, hashProvider, vectorToBlob } from "../core/src/memory/embeddings.js";
import { extractKeywords, ftsTerm, recall, stemLite } from "../core/src/memory/recall.js";
import {
  anyWordQuery,
  anyWordSearch,
  everyWordSearch,
  strictQuery,
  strictWordsSearch,
} from "../core/src/memory/search.js";
import { counterparts } from "../core/src/memory/stem.js";
import { buscaWorld, corpusHome, type BuscaWorld } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S2: the other number of a Portuguese word in the search's text query.
 * The ending table at its own layer (`counterparts`), the search through `GET /api/memory/search?mode=text`, and what
 * must not move: the strict query, the hash provider and the recall's terms.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
interface Corpus {
  notes: Array<{ name: string; text: string }>;
  questions: Array<{ q: string; expected: string; kind: string }>;
}
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, "tests/fixtures", name), "utf8")) as Corpus;
const morphology = fixture("semantic-morphology.json");
const semanticCorpus = fixture("semantic-corpus.json");

const worlds: BuscaWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});
async function world(notes: Record<string, string>): Promise<BuscaWorld> {
  const w = await buscaWorld("mordomo-busca-stem-");
  worlds.push(w);
  for (const [name, text] of Object.entries(notes)) w.note(name, text);
  await w.index();
  return w;
}
const sorted = (list: string[]) => [...list].sort();

describe("S2 the number endings at their own layer", () => {
  const rows: Array<[string, string, string[]]> = [
    ["ao", "piao", ["pioes", "piaes", "piaos"]],
    ["oes", "pioes", ["piao"]],
    ["al", "jornal", ["jornais"]],
    ["ais", "jornais", ["jornal"]],
    ["el", "papel", ["papeis"]],
    ["eis", "papeis", ["papel"]],
    ["il", "barril", ["barris"]],
    ["ol", "farol", ["farois"]],
    ["m", "homem", ["homens"]],
    ["ns", "homens", ["homem"]],
    ["r", "colher", ["colheres"]],
    ["z", "rapaz", ["rapazes"]],
    ["s alone", "rios", ["rio"]],
  ];
  it.each(rows)("C11 the ending %s: %s gives %j", (_ending, word, expected) => {
    expect(sorted(counterparts(word))).toEqual(sorted(expected));
  });

  it.each([
    ["pioes", ["piao"]],
    ["jornais", ["jornal"]],
    ["homens", ["homem"]],
    ["papeis", ["papel"]],
  ])("C11 one rule per word, the longest ending first: %s gives only %j", (word, expected) => {
    expect(counterparts(word)).toEqual(expected);
  });

  it("C11 flores falls to s alone and gives flore (G3)", () => {
    expect(counterparts("flores")).toEqual(["flore"]);
  });
});

describe("S2 the length edge after folding", () => {
  it("C12 pao and pes (3 letters) get no counterparts; acao (exactly 4) gets acoes, acaes, acaos; rios (exactly 4) gets rio", () => {
    expect(counterparts("pao")).toEqual([]);
    expect(counterparts("pes")).toEqual([]);
    expect(sorted(counterparts("acao"))).toEqual(sorted(["acoes", "acaes", "acaos"]));
    expect(counterparts("rios")).toEqual(["rio"]);
  });

  it("C12 through the route: ação lists a note whose only form is ações, pão does not list one whose only form is pães", async () => {
    const w = await world({
      trimestre: "# Trimestre\n\nAs ações do trimestre foram revistas.\n",
      padaria: "# Padaria\n\nOs pães saem do forno às seis.\n",
    });
    const acao = await w.search("ação");
    expect(acao.status).toBe(200);
    expect(acao.names).toContain("trimestre.md");
    const pao = await w.search("pão");
    expect(pao.status).toBe(200);
    expect(pao.names).not.toContain("padaria.md");
  });
});

describe("S2 the other number through GET /api/memory/search?mode=text", () => {
  const notes = {
    banca: "# Banca\n\nO jornal chegou cedo.\n",
    leitura: "# Leitura\n\nOs jornais chegaram tarde.\n",
    escritorio: "# Escritório\n\nOs papéis estão na gaveta.\n",
    obra: "# Obra\n\nO homem subiu a escada.\n",
    estrada: "# Estrada\n\nOs faróis do carro queimaram.\n",
    viagem: "# Viagem\n\nO rio estava cheio.\n",
    loja: "# Loja\n\nAs devoluções caíram em março.\n",
    mesa: "# Mesa\n\nO jornal e os papéis ficam juntos.\n",
  };
  it.each([
    ["jornais", "banca.md"],
    ["jornal", "leitura.md"],
    ["papel", "escritorio.md"],
    ["homens", "obra.md"],
    ["farol", "estrada.md"],
    ["rios", "viagem.md"],
    ["devolução", "loja.md"],
  ])("C13 %s lists %s, which holds only the other number", async (q, name) => {
    const w = await world(notes);
    const res = await w.search(q);
    expect(res.status).toBe(200);
    expect(res.names).toContain(name);
  });

  it("C13 jornais papel lists the note holding jornal and papéis among the files that hold every word", async () => {
    const w = await world(notes);
    const res = await w.search("jornais papel");
    expect(res.status).toBe(200);
    expect(res.names[0]).toBe("mesa.md");
    expect(everyWordSearch(w.ctx.db, { query: "jornais papel" }).map((h) => h.name)).toEqual(["mesa.md"]);
  });
});

describe("S2 AC 10 by value", () => {
  const morphologyNotes = Object.fromEntries(morphology.notes.map((n) => [n.name, n.text]));

  it("C14 devoluções reclamações solicitações in mode=text lists politica-de-devolucao.md first", async () => {
    const w = await world(morphologyNotes);
    const res = await w.search("devoluções reclamações solicitações");
    expect(res.status).toBe(200);
    expect(res.names[0]).toBe("politica-de-devolucao.md");
  });

  it("C14 each other-number question has its note in the top 3 of the every-word and of the any-word query", async () => {
    const w = await world(morphologyNotes);
    const questions = morphology.questions.filter((q) => q.kind === "other-number");
    expect(questions).toHaveLength(6);
    const top3 = (hits: Array<{ name: string }>) => hits.slice(0, 3).map((h) => h.name);
    for (const q of questions) {
      expect(top3(everyWordSearch(w.ctx.db, { query: q.q })), `AND: ${q.q}`).toContain(`${q.expected}.md`);
      expect(top3(anyWordSearch(w.ctx.db, { query: q.q })), `OR: ${q.q}`).toContain(`${q.expected}.md`);
    }
  });
});

describe("S2 the strict query is not expanded", () => {
  it('C15 strictWordsSearch sends "devoluções"* exactly and lists no politica-de-devolucao.md', async () => {
    expect(strictQuery("devoluções")).toBe('"devoluções"*');
    const w = await world(Object.fromEntries(morphology.notes.map((n) => [n.name, n.text])));
    const names = strictWordsSearch(w.ctx.db, { query: "devoluções" }).map((h) => h.name);
    expect(names).not.toContain("politica-de-devolucao.md");
  });

  it("C15 the strict AND of the 12-question corpus still finds the same 5 questions", async () => {
    const w = await world(Object.fromEntries(semanticCorpus.notes.map((n) => [n.name, n.text])));
    expect(semanticCorpus.questions).toHaveLength(12);
    const found = semanticCorpus.questions
      .filter((q) =>
        strictWordsSearch(w.ctx.db, { query: q.q })
          .slice(0, 3)
          .map((h) => h.name)
          .includes(`${q.expected}.md`),
      )
      .map((q) => q.q);
    // recorded on the base c2b510b, before S2
    expect(found).toEqual([
      "refund policy",
      "database backup",
      "vacation policy",
      "api rate limits",
      "key rotation",
    ]);
  });

  it('C15 the look-alike zoom: zoons in the any-word query only, "zoom"* as the strict query, and the note zoom first', async () => {
    expect(anyWordQuery("zoom")).toContain('"zoons"*');
    expect(strictQuery("zoom")).toBe('"zoom"*');
    const w = await world({
      zoom: "# Zoom\n\nA chamada no zoom começa às nove.\n",
      camera: "# Câmera\n\nA lente tem um zoom ótico.\n",
    });
    const res = await w.search("zoom");
    expect(res.status).toBe(200);
    expect(res.names[0]).toBe("zoom.md");
  });
});

describe("S2 the hash provider is unchanged", () => {
  // 400 characters, with plurals of every kind the ending table knows
  const TEXT =
    "As devoluções dos pedidos chegam às segundas-feiras. Os jornais da cidade publicaram as reclamações dos clientes, " +
    "e os papéis das notas fiscais ficam nos barris do depósito. Os homens do armazém conferem os faróis dos caminhões, " +
    "as colheres da cantina e as flores do jardim. As solicitações de troca seguem as políticas da loja; os rapazes " +
    "registram as ações, os pães e os pés de alface em planilhas.";

  it("C16 hashEmbed of a fixed text hashes to the golden value of the base, the id is hash-v1:256, stemLite as on the base", () => {
    expect(TEXT).toHaveLength(400);
    // recorded on the base c2b510b, before S2
    expect(
      crypto
        .createHash("sha256")
        .update(vectorToBlob(hashEmbed(TEXT)))
        .digest("hex"),
    ).toBe("a132301af74ee4709910e541b3c451e60241bcc3d37c8af55334a94cb1e57490");
    expect(HASH_PROVIDER_ID).toBe("hash-v1:256");
    expect(stemLite("devolucoes")).toBe("devolucao");
    expect(stemLite("jornais")).toBe("jornai");
    expect(stemLite("flores")).toBe("flor");
    expect(stemLite("homem")).toBe("homem");
  });

  it("C17 a second pass over an unchanged corpus with hash calls embed 0 times and every section_vectors.vec reads back byte-identical", async () => {
    const home = await corpusHome("hash");
    try {
      const rows = () =>
        home.ctx.db
          .prepare("SELECT file_id, ord, vec FROM section_vectors ORDER BY file_id, ord")
          .all() as Array<{ file_id: number; ord: number; vec: Buffer }>;
      const first = rows();
      expect(first.length).toBeGreaterThanOrEqual(40);
      const embed = vi.spyOn(hashProvider, "embed");
      const second = await home.ctx.indexer.indexAllAsync();
      expect(embed).toHaveBeenCalledTimes(0);
      expect(second.embedded).toBe(0);
      const again = rows();
      expect(again.map((r) => [r.file_id, r.ord])).toEqual(first.map((r) => [r.file_id, r.ord]));
      again.forEach((r, i) => expect(r.vec.equals(first[i]!.vec), `${r.file_id}:${r.ord}`).toBe(true));
    } finally {
      vi.restoreAllMocks();
      home.cleanup();
    }
  });
});

describe("S2 the recall is not expanded (G5)", () => {
  it("C18 the recall's term is \"<keyword>\"* and its candidates for jornais equal the base's", async () => {
    expect(extractKeywords("jornais")).toEqual(["jornai"]);
    expect(ftsTerm("jornai")).toBe('"jornai"*');
    const w = await world({
      jornal: "# Jornal\n\nO jornal da cidade saiu cedo.\n",
      jornais: "# Jornais\n\nOs jornais da semana ficam na banca.\n",
    });
    expect(w.ctx.settings().memory.embeddings.enabled).toBe(false);
    const result = recall(w.ctx.db, w.ctx.paths, w.ctx.settings(), "jornais");
    // recorded on the base c2b510b, before S2
    expect(result.candidates).toEqual([
      {
        path: path.join(w.memory, "jornais.md"),
        score: 15,
        why: "name matches jornai; title matches jornai; 1/1 keywords in the index",
      },
    ]);
  });
});

describe("Correções do lote A: the word itself is in the OR (AC 9)", () => {
  const notes = {
    acoes: "# Carteira\n\nAs ações subiram na sexta.\n",
    acao: "# Campanha\n\nA ação de vendas começa amanhã.\n",
    jornal: "# Jornal\n\nO jornal da cidade saiu cedo.\n",
    jornais: "# Jornais\n\nOs jornais da semana ficam na banca.\n",
  };

  it("C138 ações finds the note that holds exactly ações and the one that holds ação", async () => {
    const w = await world(notes);
    const res = await w.search("ações");
    expect(res.status).toBe(200);
    expect(res.names).toContain("acoes.md");
    expect(res.names).toContain("acao.md");
  });

  it("C138 jornais still finds jornal and jornais", async () => {
    const w = await world(notes);
    const res = await w.search("jornais");
    expect(res.status).toBe(200);
    expect(res.names).toContain("jornal.md");
    expect(res.names).toContain("jornais.md");
  });

  it('C138 the strict query of ações is unchanged: "ações"* exactly, listing the ações note and not the ação one', async () => {
    expect(strictQuery("ações")).toBe('"ações"*');
    const w = await world(notes);
    expect(strictWordsSearch(w.ctx.db, { query: "ações" }).map((h) => h.name)).toEqual(["acoes.md"]);
  });
});

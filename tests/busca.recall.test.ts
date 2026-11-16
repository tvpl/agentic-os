import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API } from "@mordomo/contracts";
import { vectorToBlob } from "../core/src/memory/embeddings.js";
import { runRecall } from "../core/src/memory/recall.js";
import { embeddedText, sectionRows, type SectionRow } from "../core/src/memory/sections.js";
import { mordomoTools, type McpApi } from "../apps/api/src/mcp/mordomo.js";
import { GEMMA, QWEN, localWorld, type LocalWorld } from "./helpers/buscaStubs.js";
import {
  PT_CORPUS,
  PT_QUERIES,
  buscaWorld,
  code,
  embeddingsServer,
  type BuscaWorld,
  type EmbeddingsServer,
  type Json,
} from "./helpers/buscaWorld.js";
import { CHAIN } from "./busca.abstain.test.js";

/**
 * .specs/features/cerebro-busca-significado, S5 through `GET /api/memory/recall` (and the MCP tool): the vectors joined to
 * the words, the filters on every path a candidate arrives by, the abstention, the hops, the budget, the query flag and
 * the one embedding of the question. The vectors come from the stub child's table (checks "Level honesty" b): a near
 * section is a test's choice, not a model's.
 */

const opened: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const w of opened.splice(0)) await w.close();
});

const enc = encodeURIComponent;
/** The question's vector, and a section's at cosine `cos` to it (6 dimensions, the stub Qwen's). */
const Q = [1, 0, 0, 0, 0, 0];
const at = (cos: number) => [cos, Math.sqrt(1 - cos * cos), 0, 0, 0, 0];
const FAR = [0, 0, 1, 0, 0, 0];

async function stubWorld(model: string = QWEN): Promise<LocalWorld> {
  const w = await localWorld("mordomo-busca-recall-");
  opened.push(w);
  await w.install(model);
  return w;
}

/**
 * Index with the search off, give every section of every indexed text file the vector `near` names (FAR otherwise) and
 * each question its own, then index with the stub model: the rows the pass writes come from that table.
 */
async function embed(
  w: LocalWorld,
  near: (file: { path: string; rel: string }, row: SectionRow) => number[] | undefined,
  questions: Record<string, number[]>,
  model: string = QWEN,
): Promise<void> {
  w.update((s) => {
    s.memory.embeddings = { ...s.memory.embeddings, enabled: false };
  });
  await w.index();
  // the stub receives the entry's prefix before each text, cut at maxChars with it (G25)
  const [doc, query] = model === GEMMA ? ["D: ", "Q: "] : ["", ""];
  // the stub Gemma has 8 dimensions, the stub Qwen 6
  const dims = (v: number[]) => (model === GEMMA ? [...v, 0, 0] : v);
  const files = w.ctx.db
    .prepare(
      "SELECT f.path, f.rel, f.ext, f.area, f.title, t.content FROM files f JOIN files_fts t ON t.rowid = f.id",
    )
    .all() as Array<{
    path: string;
    rel: string;
    ext: string;
    area: string | null;
    title: string | null;
    content: string;
  }>;
  const vectors: Record<string, number[]> = {};
  for (const [q, v] of Object.entries(questions)) vectors[`${query}${q}`] = dims(v);
  for (const f of files)
    for (const row of sectionRows(f.content, f.ext))
      vectors[
        `${doc}${embeddedText({ area: f.area, title: f.title, path: row.path }, row.body, 2000)}`.slice(
          0,
          2000,
        )
      ] = dims(near(f, row) ?? FAR);
  w.child.control({ vectors });
  w.localOn(model);
  await w.index();
}

const recallOf = async (w: BuscaWorld, query: string, headers?: Record<string, string>) => {
  const res = await w.call("GET", `/api/memory/recall?${query}`, undefined, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const putRecall = async (w: BuscaWorld, recall: Json) =>
  w.call("PUT", "/api/settings", { memory: { recall } });
const names = (list: Json[], key = "path") =>
  list.map((c) => path.basename(c[key] as string, path.extname(c[key])));

// ---------------------------------------------------------------------------------------------- C70

describe("C70 a note near in meaning joins the recall", () => {
  it("C70 a note with no word of the question nearest to it is in answerContext with its vector section; a file found by words and vectors is counted and listed once", async () => {
    const w = await stubWorld();
    w.note("sinonimo", "## Outro\n\nNada aqui.\n\n## Prazo\n\nTrinta dias corridos para trocar.\n");
    w.note("palavras", "## Regra\n\nA devolução do produto vale para tudo.\n");
    w.note("longe", "## Longe\n\nUm assunto distante.\n");
    const question = "devolução produto";
    await embed(
      w,
      (f, row) =>
        f.rel.endsWith("sinonimo.md") && row.heading === "Prazo"
          ? at(0.95)
          : f.rel.endsWith("palavras.md")
            ? at(0.9)
            : undefined,
      { [question]: Q },
    );
    const body = await recallOf(w, `q=${enc(question)}&record=false`);
    const sinonimo = (body.answerContext as Json[]).find((c) => c.path.endsWith("sinonimo.md"));
    expect(sinonimo?.section).toBe("Prazo");
    expect(sinonimo?.excerpt).toBe("Trinta dias corridos para trocar.");
    expect(names(body.candidates).sort()).toEqual(["palavras", "sinonimo"]);
    expect(body.candidatesConsidered).toBe(2);
    expect(names(body.answerContext).filter((n) => n === "palavras")).toEqual(["palavras"]);
  });
});

// ---------------------------------------------------------------------------------------------- C71

describe("C71 the depth of 50 sections", () => {
  it("C71 the 50th nearest section's file is a candidate and the 51st's is not; with 60 hidden sections nearer, a device still gets the 50 nearest it may see", async () => {
    const w = await stubWorld();
    const vis = path.join(w.memory, "notes", "vis");
    const fin = path.join(w.memory, "notes", "fin");
    const pad = (i: number) => String(i).padStart(2, "0");
    const near = (f: { rel: string }) => {
      const m = /([nh])(\d\d)\.md$/.exec(f.rel);
      if (!m) return undefined;
      return m[1] === "h" ? at(0.999 - Number(m[2]) * 0.0001) : at(0.99 - Number(m[2]) * 0.01);
    };
    const question = "zzqx";
    for (let i = 0; i < 51; i++) w.put(path.join(vis, `n${pad(i)}.md`), `## S\n\nconteudo ${i}\n`);
    await embed(w, near, { [question]: Q });
    // 51 files with one near section each: the 50th nearest's file is in, the 51st's is not
    const run = await runRecall(w.ctx.db, w.ctx.paths, w.ctx.settings(), question, {
      semantic: w.ctx.semantic,
    });
    const fused = run.fused.map((f) => path.basename(f.path, ".md"));
    expect(fused.length).toBe(50);
    expect(fused).toContain("n49");
    expect(fused).not.toContain("n50");
    expect(fused.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `n${pad(i)}`));
    expect((await recallOf(w, `q=${question}&record=false`)).candidatesConsidered).toBe(50);
    // 60 notes nearer than all of them, in a folder hidden from devices
    for (let i = 0; i < 60; i++) w.put(path.join(fin, `h${pad(i)}.md`), `## S\n\noculto ${i}\n`);
    const res = await w.call("PUT", "/api/settings", {
      folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await embed(w, near, { [question]: Q });
    const owner = await runRecall(w.ctx.db, w.ctx.paths, w.ctx.settings(), question, {
      semantic: w.ctx.semantic,
    });
    expect(owner.fused.slice(0, 50).every((f) => path.basename(f.path).startsWith("h"))).toBe(true);
    // the device, through the route: the 50 nearest it may see
    const device = await recallOf(w, `q=${question}&record=false`, w.device(["content"]));
    expect(device.candidatesConsidered).toBe(50);
    expect(names(device.candidates)).toEqual(Array.from({ length: 10 }, (_, i) => `n${pad(i)}`));
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------- C72

/** Every path an answer names: its excerpts, where they were reached from, and its candidates. */
const named = (body: Json): string[] => [
  ...(body.answerContext as Json[]).flatMap((c) => [c.path, ...(c.via ? [c.via] : [])]),
  ...(body.candidates as Json[]).map((c) => c.path),
];

describe("C72 today's filters on every vector candidate and every followed link", () => {
  it("C72 config/, outside the context and its look-alike folder, hidden from the device, outside memory/ for a run: absent from answerContext, candidates and candidatesConsidered, near or linked", async () => {
    const w = await stubWorld();
    const r = w.indexedRoot("c72");
    const fin = path.join(w.memory, "notes", "fin");
    const cfg = path.join(w.home, "config");
    const LINKED = "## Alvo\n\nzzqx zzqx zzqx zzqx zzqx zzqx.\n";
    const file = {
      vSegredo: w.put(path.join(cfg, "v-segredo.md"), "## S\n\nsegredo perto\n"),
      lSegredo: w.put(path.join(cfg, "l-segredo.md"), LINKED),
      vOculta: w.put(path.join(fin, "v-oculta.md"), "## S\n\noculta perto\n"),
      lOculta: w.put(path.join(fin, "l-oculta.md"), LINKED),
      vVelho: w.put(path.join(r, "projetos", "app-antigo", "v-velho.md"), "## S\n\nvelho perto\n"),
      lVelho: w.put(path.join(r, "projetos", "app-antigo", "l-velho.md"), LINKED),
      vFora: w.put(path.join(r, "v-fora.md"), "## S\n\nfora perto\n"),
      lFora: w.put(path.join(r, "l-fora.md"), LINKED),
    };
    const link = (from: string, to: string) => path.relative(path.dirname(from), to);
    const portaA = path.join(w.memory, "porta-a.md");
    const portaB = path.join(w.memory, "porta-b.md");
    const portaC = path.join(w.memory, "porta-c.md");
    const portaCtx = path.join(r, "projetos", "app", "porta.md");
    w.put(portaA, `## Porta\n\nzzqx [a](${link(portaA, file.lSegredo)})\n`);
    w.put(portaB, `## Porta\n\nzzqx [b](${link(portaB, file.lOculta)})\n`);
    w.put(portaC, `## Porta\n\nzzqx [c](${link(portaC, file.lFora)})\n`);
    w.put(portaCtx, `## Porta\n\nzzqx [d](${link(portaCtx, file.lVelho)})\n`);
    w.update((s) => {
      s.contexts = [{ id: "ctx", name: "Ctx", paths: [path.join(r, "projetos", "app")] } as never];
    });
    expect(
      (
        await w.call("PUT", "/api/settings", {
          folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
        })
      ).status,
    ).toBe(200);
    const near = (f: { rel: string }) => (/(^|\/)v-[a-z]+\.md$/.test(f.rel) ? at(0.99) : undefined);
    await embed(w, near, { zzqx: Q });
    // a stale index: the home's config/ as rows and vectors, as an old pass would have left them
    const provider = w.allRows()[0]!.provider;
    for (const [p, vec] of [
      [file.vSegredo, at(0.999)],
      [file.lSegredo, FAR],
    ] as const) {
      const id = w.row(w.home, path.relative(w.home, p), { title: null });
      w.ctx.db
        .prepare(
          "INSERT INTO section_vectors (file_id, ord, heading, start_line, end_line, provider, dim, vec, mtime, size) VALUES (?, 0, 'S', 3, 3, ?, 6, ?, 1, 1)",
        )
        .run(id, provider, vectorToBlob(Float32Array.from(vec)));
    }
    const cases: Array<[string, string, Record<string, string> | undefined, string[]]> = [
      ["owner", "", undefined, [file.vSegredo, file.lSegredo]],
      ["device", "", w.device(["content"]), [file.vSegredo, file.lSegredo, file.vOculta, file.lOculta]],
      ["context", "&context=ctx", undefined, [file.vVelho, file.lVelho, file.vFora, file.lFora]],
      ["run", "", w.run("write").headers, [file.vVelho, file.lVelho, file.vFora, file.lFora]],
    ];
    for (const [who, extra, headers, refused] of cases) {
      const body = await recallOf(w, `q=zzqx&k=10&record=false${extra}`, headers);
      const seen = named(body);
      for (const p of refused) expect(seen, `${who} ${p}`).not.toContain(p);
      expect(body.candidatesConsidered, who).toBe((body.candidates as Json[]).length);
      expect(body.abstained, who).toBe(false);
    }
    // the owner is told of what it may read: the near files and the linked ones the others may not have
    const owner = await recallOf(w, "q=zzqx&k=10&record=false");
    expect(named(owner)).toEqual(
      expect.arrayContaining([file.vOculta, file.vVelho, file.vFora, file.lOculta]),
    );
    const nope = await w.call("GET", "/api/memory/recall?q=zzqx&context=nao-existe");
    expect(code(nope)).toEqual([404, "context_not_found"]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------- C73

describe("C73 which section a fused file gives, through the route", () => {
  const cases = [
    ["higher", "zzqx zzqx zzqx", "Vetor"],
    ["exactly equal", "zzqx", "Vetor"],
    ["lower", "nada", "Texto"],
  ] as const;
  it.each(cases)(
    "C73 the vector-nearest section scoring %s than the best text section gives %s",
    async (_c, body, want) => {
      const w = await stubWorld();
      w.note("nota", `## Texto\n\nzzqx\n\n## Vetor\n\n${body}\n`);
      await embed(w, (_f, row) => (row.heading === "Vetor" ? at(0.95) : undefined), { zzqx: Q });
      const res = await recallOf(w, "q=zzqx&record=false");
      expect((res.answerContext as Json[]).map((c) => c.section)).toEqual([want]);
    },
  );
});

// ---------------------------------------------------------------------------------------------- the text-only worlds

async function wordsWorld(): Promise<BuscaWorld> {
  const w = await buscaWorld("mordomo-busca-recall-words-");
  opened.push(w);
  return w;
}

/** C77's question: its best section matches 1 of its 4 keywords, and that section is far from it for `hash`. */
const WEAK_Q = "jardim xablau yyzzq wwqqp";
const FLORES =
  "rosas cravos lírios tulipas orquídeas margaridas violetas begônias azaleias hortênsias girassóis camélias dálias gérberas " +
  "jasmins lavandas papoulas petúnias gardênias magnólias amarílis crisântemos gladíolos copos-de-leite antúrios bromélias";
async function weakWorld(): Promise<BuscaWorld> {
  const w = await wordsWorld();
  w.note("jardim", `## Plantas\n\nO jardim tem ${FLORES}.\n`);
  w.note("cozinha", "## Cozinha\n\nA geladeira foi trocada em maio.\n");
  await w.index();
  return w;
}

// ---------------------------------------------------------------------------------------------- C74

describe("C74 every answer carries the three keys", () => {
  it("C74 a found answer reads abstained false, abstainReason null, rerank off; an abstained one abstained true with its reason", async () => {
    const w = await weakWorld();
    const found = await recallOf(w, `q=${enc("jardim flores")}&record=false`);
    expect(found.answerContext.length).toBeGreaterThan(0);
    expect([found.abstained, found.abstainReason, found.rerank]).toEqual([false, null, "off"]);
    const weak = await recallOf(w, `q=${enc(WEAK_Q)}&record=false`);
    expect([weak.abstained, weak.abstainReason, weak.rerank]).toEqual([true, "weak", "off"]);
  });
  it("C74 the MCP tool's request reads the three keys", async () => {
    const w = await weakWorld();
    const bodies: Json[] = [];
    const api: McpApi = {
      get: async <T>(url: string) => {
        const body = (await w.call("GET", url)).body;
        bodies.push(body);
        return body as T;
      },
      post: async () => {
        throw new Error("not used");
      },
      put: async () => {
        throw new Error("not used");
      },
    };
    const tool = mordomoTools(api).find((t) => t.name === "recall")!;
    await tool.handler({ question: "jardim flores" });
    await tool.handler({ question: WEAK_Q });
    expect(bodies.map((b) => [b.abstained, b.abstainReason, b.rerank])).toEqual([
      [false, null, "off"],
      [true, "weak", "off"],
    ]);
  });
  it("C74 the route's response schema declares abstained, abstainReason and rerank as required keys with their values", () => {
    const schema = API["memory.recall"].responses[200] as unknown as {
      shape: Record<string, { safeParse: (v: unknown) => { success: boolean }; isOptional: () => boolean }>;
    };
    const { abstained, abstainReason, rerank } = schema.shape;
    for (const key of [abstained, abstainReason, rerank]) expect(key!.isOptional()).toBe(false);
    expect([true, false, "x"].map((v) => abstained!.safeParse(v).success)).toEqual([true, true, false]);
    expect(["no_match", "weak", null, "other"].map((v) => abstainReason!.safeParse(v).success)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(
      ["off", "used", "skipped", "timeout", "failed", "on"].map((v) => rerank!.safeParse(v).success),
    ).toEqual([true, true, true, true, true, false]);
  });
});

// ---------------------------------------------------------------------------------------------- C75

describe("C75 no_match with abstain on and off", () => {
  it.each([true, false])(
    "C75 with abstain %s: only stop words and keywords with no candidate answer no_match and []",
    async (abstain) => {
      const w = await weakWorld();
      expect((await putRecall(w, { abstain })).status).toBe(200);
      for (const q of ["o que é isso?", "xenobiologiaquantica"]) {
        const body = await recallOf(w, `q=${enc(q)}&record=false`);
        expect([body.abstained, body.abstainReason, body.answerContext], q).toEqual([true, "no_match", []]);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------- C77, C78

describe("C77 the weak rule through the route", () => {
  it("C77 with hash (0.2) a question whose best section matches 1 of 4 keywords and whose nearest section is under 0.2 answers weak and []", async () => {
    const w = await weakWorld();
    w.hashOn();
    await w.index();
    expect(w.allRows().length).toBeGreaterThan(0);
    // the precondition, read from the search: the nearest section is under hash's 0.2
    const near = await w.ctx.semantic.nearestSections(WEAK_Q, () => true, 50);
    expect(near!.minSimilarity).toBe(0.2);
    expect(near!.best!).toBeLessThan(0.2);
    const body = await recallOf(w, `q=${enc(WEAK_Q)}&record=false`);
    expect(body.keywords).toHaveLength(4);
    expect([body.abstained, body.abstainReason, body.answerContext]).toEqual([true, "weak", []]);
  });
  it("C77 the same question with the embeddings off (no vectors) also answers weak", async () => {
    const w = await weakWorld();
    expect(w.ctx.settings().memory.embeddings.enabled).toBe(false);
    const body = await recallOf(w, `q=${enc(WEAK_Q)}&record=false`);
    expect([body.abstained, body.abstainReason, body.answerContext]).toEqual([true, "weak", []]);
  });
});

describe("C78 abstain off answers the weak match as today", () => {
  it("C78 with abstain false set by PUT, C77's question answers abstained false, null, and the excerpt the weak match finds", async () => {
    const w = await weakWorld();
    expect((await putRecall(w, { abstain: false })).status).toBe(200);
    expect(w.ctx.settings().memory.recall.abstain).toBe(false);
    const body = await recallOf(w, `q=${enc(WEAK_Q)}&record=false`);
    expect([body.abstained, body.abstainReason]).toEqual([false, null]);
    expect((body.answerContext as Json[]).map((c) => [names([c])[0], c.section, c.excerpt])).toEqual([
      ["jardim", "Plantas", `O jardim tem ${FLORES}.`],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------- C79

describe("C79 the answer's entries are today's", () => {
  /** cerebro-natureza C20's recorded answer (tests/natureza.search.test.ts), paths relative to its folder. */
  const RECORDED = [
    {
      path: "tabela.md",
      section: "Amora venda colheita feira de novo",
      excerpt:
        "Amora venda colheita feira: amora, venda, colheita e feira de novo, amora venda colheita feira amora venda.",
      score: 62.64,
      why: 'pointer from amora-d.md § "Amora venda colheita feira"; section "Amora venda colheita feira de novo" matches amora, colheita, venda, feira',
      via: "amora-d.md",
      natureza: null,
      escopo: null,
    },
    {
      path: "amora-d.md",
      section: "Amora venda colheita feira",
      excerpt: "A venda da amora colheita feira, amora madura. Mais em [tabela](./tabela.md).",
      score: 58.58,
      why: 'name matches amora; title matches venda; 4/4 keywords in the index; section "Amora venda colheita feira" matches amora, colheita, venda, feira',
      natureza: null,
      escopo: null,
    },
    {
      path: "amora-c.md",
      section: "Amora relato",
      excerpt: "> [!relato] Feira\n> A amora vendeu bem na feira, colheita boa.",
      score: 40.58,
      why: 'name matches amora; title matches amora; 3/4 keywords in the index; section "Amora relato" matches amora, colheita, feira',
      natureza: "relato",
      escopo: null,
    },
  ];
  it("C79 with the embeddings off and hops 1, natureza C20's recorded answer and keys, and recall-quality's four first contexts", async () => {
    const w = await wordsWorld();
    expect((await putRecall(w, { hops: 1 })).status).toBe(200);
    const root = w.indexedRoot("c79");
    const notes: Record<string, string> = {
      "amora-a.md":
        "# Amora\n\n## Amora colheita\n\nA amora madura colhe em março. Veja [a venda](./amora-d.md).\n",
      "amora-b.md":
        "---\nnatureza: plano\nescopo: equipe\n---\n# Amora plano\n\n## Amora venda\n\nVamos vender amora na feira de sábado.\n",
      "amora-c.md": "# Amora relato\n\n> [!relato] Feira\n> A amora vendeu bem na feira, colheita boa.\n",
      "amora-d.md":
        "# Venda\n\n## Amora venda colheita feira\n\nA venda da amora colheita feira, amora madura. Mais em [tabela](./tabela.md).\n",
      "tabela.md":
        "# Tabela\n\n## Amora venda colheita feira de novo\n\nAmora venda colheita feira: amora, venda, colheita e feira de novo, amora venda colheita feira amora venda.\n",
    };
    Object.entries(notes).forEach(([name, text], i) => {
      w.put(path.join(root, name), text);
      fs.utimesSync(path.join(root, name), 1_700_000_000 + i * 1000, 1_700_000_000 + i * 1000);
    });
    await w.index();
    const body = await recallOf(w, `q=${enc("amora colheita venda feira")}&k=2&record=false`);
    const rel = (p: string) => path.relative(root, p);
    const items = body.answerContext as Json[];
    expect(items.map((c) => ({ ...c, path: rel(c.path), ...(c.via ? { via: rel(c.via) } : {}) }))).toEqual(
      RECORDED,
    );
    for (const item of items)
      expect(Object.keys(item).sort()).toEqual(
        [
          "path",
          "section",
          "excerpt",
          "score",
          "why",
          "natureza",
          "escopo",
          ...(item.via ? ["via"] : []),
        ].sort(),
      );
    expect([body.abstained, body.abstainReason]).toEqual([false, null]);
  });
  it("C79 recall-quality's four questions give the same first paths and excerpts with hops 1, and the nonsense one abstains", async () => {
    const w = await wordsWorld();
    expect((await putRecall(w, { hops: 1 })).status).toBe(200);
    const files: Record<string, string> = {
      "banco-dados.md":
        "# Banco de dados\n\n## Recuperação\nO backup SQLite do projeto Atlas fica na pasta cofres. A restauração exige validar integridade.",
      "banco-financeiro.md":
        "# Banco financeiro\n\n## Pagamento\nA transferência do projeto Atlas foi aprovada por Marina no valor de 3200 reais.",
      "mobile.md":
        "# Aplicativo mobile\n\n## Desempenho\nO Metro do aplicativo Aurora usa porta 8081. O simulador iOS consome memória durante a compilação.",
      "agenda.md":
        "# Agenda\n\n## Revisão\nA revisão do projeto Aurora será terça-feira às 14 horas com Renata.",
    };
    for (const [name, text] of Object.entries(files)) w.put(path.join(w.memory, name), text);
    await w.index();
    const cases = [
      [
        "Onde fica o backup SQLite do banco de dados Atlas?",
        "banco-dados.md",
        "O backup SQLite do projeto Atlas fica na pasta cofres. A restauração exige validar integridade.",
      ],
      [
        "Quem aprovou a transferência do banco financeiro Atlas?",
        "banco-financeiro.md",
        "A transferência do projeto Atlas foi aprovada por Marina no valor de 3200 reais.",
      ],
      [
        "Qual porta usa o Metro Aurora?",
        "mobile.md",
        "O Metro do aplicativo Aurora usa porta 8081. O simulador iOS consome memória durante a compilação.",
      ],
      [
        "Quando será a revisão Aurora com Renata?",
        "agenda.md",
        "A revisão do projeto Aurora será terça-feira às 14 horas com Renata.",
      ],
    ];
    for (const [q, file, excerpt] of cases) {
      const body = await recallOf(w, `k=2&q=${enc(q)}&record=false`);
      expect([body.answerContext[0]?.path, body.answerContext[0]?.excerpt, body.abstained], q).toEqual([
        path.join(w.memory, file),
        excerpt,
        false,
      ]);
    }
    const absent = await recallOf(w, "q=xenobiologiaquantica&record=false");
    expect([absent.answerContext, absent.abstained, absent.abstainReason]).toEqual([[], true, "no_match"]);
  });
});

// ---------------------------------------------------------------------------------------------- C80, C81

describe("C80 the hops through the route", () => {
  it("C80 hops 1, 2 and 3 set by PUT give A B, A B C and A B C D with via the file that pointed; 0 and 4 are refused, 1 and 3 read back", async () => {
    const w = await wordsWorld();
    w.note("inicio", CHAIN.inicio);
    w.note("b", CHAIN.b);
    w.note("c", CHAIN.c);
    w.note("d", CHAIN.d);
    await w.index();
    const base = (p?: string) => (p ? path.basename(p, ".md") : null);
    for (const [hops, want] of [
      [1, ["b<inicio", "inicio<"]],
      [2, ["b<inicio", "c<b", "inicio<"]],
      [3, ["b<inicio", "c<b", "d<c", "inicio<"]],
    ] as const) {
      expect((await putRecall(w, { hops })).status).toBe(200);
      const read = await w.call("GET", "/api/settings");
      expect(read.body.memory.recall.hops).toBe(hops);
      const body = await recallOf(w, `q=${enc("inicio amora")}&k=1&record=false`);
      expect(
        (body.answerContext as Json[]).map((c) => `${base(c.path)}<${base(c.via) ?? ""}`).sort(),
        `hops ${hops}`,
      ).toEqual([...want]);
    }
    for (const hops of [0, 4]) {
      const before = fs.readFileSync(path.join(w.home, "config", "settings.json"));
      expect(code(await putRecall(w, { hops })), `hops ${hops}`).toEqual([400, "validation"]);
      expect(fs.readFileSync(path.join(w.home, "config", "settings.json")).equals(before)).toBe(true);
    }
  });
});

describe("C81 a second-level link is followed only to a file the caller may read", () => {
  it("C81 outside the context, hidden from the device, not indexed and under config/: not followed and absent", async () => {
    const w = await wordsWorld();
    const r = w.indexedRoot("c81");
    const app = path.join(r, "projetos", "app");
    const fin = path.join(w.memory, "notes", "fin");
    // A (both words, opened alone with k 1) → B (a higher section) → the target (higher again): the target is the
    // second level, and would be taken if the caller could read it
    const TARGET = `## Zzqx\n\n${Array.from({ length: 40 }, () => "zzqx").join(" ")}.\n`;
    const targets = {
      context: path.join(r, "projetos", "app-antigo", "alvo.md"),
      hidden: path.join(fin, "alvo.md"),
      config: path.join(w.home, "config", "alvo.md"),
      notIndexed: path.join(w.memory, "solta.md"),
    };
    const chain = (dir: string, name: string, target: string) => {
      w.put(path.join(dir, `${name}inicio.md`), `zzqx ${name}inicio, veja [b](./${name}-b.md).\n`);
      w.put(
        path.join(dir, `${name}-b.md`),
        `## Zzqx\n\n${Array.from({ length: 16 }, () => "zzqx").join(" ")} [t](${path.relative(dir, target)})\n`,
      );
    };
    chain(app, "ctx", targets.context);
    chain(w.memory, "dev", targets.hidden);
    chain(w.memory, "cfg", targets.config);
    chain(w.memory, "sol", targets.notIndexed);
    for (const t of [targets.context, targets.hidden, targets.config]) w.put(t, TARGET);
    w.update((s) => {
      s.contexts = [{ id: "ctx", name: "Ctx", paths: [app] } as never];
    });
    expect(
      (
        await w.call("PUT", "/api/settings", {
          folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
        })
      ).status,
    ).toBe(200);
    await w.index();
    // the config/ target as a stale row (an old pass's), and a target written after the pass, with no row
    w.row(w.home, "config/alvo.md");
    w.put(targets.notIndexed, TARGET);
    expect(w.ctx.db.prepare("SELECT 1 FROM files WHERE path = ?").get(targets.notIndexed)).toBeUndefined();
    const cases: Array<[string, string, Record<string, string> | undefined, string]> = [
      ["context", "q=zzqx%20ctxinicio&context=ctx", undefined, targets.context],
      ["device", "q=zzqx%20devinicio", w.device(["content"]), targets.hidden],
      ["config", "q=zzqx%20cfginicio", undefined, targets.config],
      ["not indexed", "q=zzqx%20solinicio", undefined, targets.notIndexed],
    ];
    for (const [who, query, headers, target] of cases) {
      const body = await recallOf(w, `${query}&k=1&record=false`, headers);
      const paths = (body.answerContext as Json[]).map((c) => c.path);
      // the first level is followed (A and B are there), the second is not
      expect(paths.map((p) => path.basename(p)).sort(), who).toEqual(
        [
          `${query.split("%20")[1]!.split("&")[0]}.md`,
          `${query.split("%20")[1]!.split("inicio")[0]}-b.md`,
        ].sort(),
      );
      expect(paths, who).not.toContain(target);
    }
    // the owner, who may read the hidden folder, is given its target at the second level
    const owner = await recallOf(w, "q=zzqx%20devinicio&k=1&record=false");
    expect((owner.answerContext as Json[]).map((c) => c.path)).toContain(targets.hidden);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------- C82

describe("C82 the token budget through the route", () => {
  it("C82 tokenBudget 500 set by PUT and excerptChars 2000: tokensEstimate at most 500 over every question of the Portuguese corpus", async () => {
    const w = await wordsWorld();
    const root = w.indexedRoot("c82");
    for (const name of fs.readdirSync(PT_CORPUS))
      fs.copyFileSync(path.join(PT_CORPUS, name), path.join(root, name));
    await w.index();
    expect((await putRecall(w, { tokenBudget: 500 })).status).toBe(200);
    const queries = (JSON.parse(fs.readFileSync(PT_QUERIES, "utf8")) as { queries: Array<{ q: string }> })
      .queries;
    let over = 0;
    let filled = 0;
    for (const { q } of queries) {
      const body = await recallOf(w, `q=${enc(q)}&excerptChars=2000&k=10&record=false`);
      if (body.tokensEstimate > 500) over++;
      if (body.tokensEstimate > 0) filled++;
      const sum = (body.answerContext as Json[]).reduce((n, c) => n + Math.ceil(c.excerpt.length / 4), 0);
      expect(body.tokensEstimate, q).toBe(sum);
    }
    expect(over).toBe(0);
    expect(filled).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------- C83

describe("C83 the MCP tool's text", () => {
  const tool = (get: (url: string) => Promise<Json>) =>
    mordomoTools({
      get: async <T>(url: string) => (await get(url)) as T,
      post: async () => {
        throw new Error("not used");
      },
      put: async () => {
        throw new Error("not used");
      },
    }).find((t) => t.name === "recall")!;
  it("C83 weak and no_match print the abstention line; a found answer prints its blocks as before", async () => {
    const w = await weakWorld();
    const t = tool(async (url) => (await w.call("GET", url)).body);
    expect(await t.handler({ question: WEAK_Q })).toBe(
      "Nothing found: no indexed section answers this (weak).",
    );
    expect(await t.handler({ question: "xenobiologiaquantica" })).toBe(
      "Nothing found: no indexed section answers this (no_match).",
    );
    const found = await recallOf(w, `q=${enc("jardim flores")}`);
    expect(await t.handler({ question: "jardim flores" })).toBe(
      (found.answerContext as Json[])
        .map((c) => `## ${c.path} § ${c.section} (score ${c.score})\n${c.excerpt}`)
        .join("\n\n"),
    );
  });
  it("C83 a non-abstained empty answer prints No indexed section matched. as before", async () => {
    const t = tool(async () => ({ answerContext: [], abstained: false, abstainReason: null, rerank: "off" }));
    expect(await t.handler({ question: "qualquer" })).toBe("No indexed section matched.");
  });
});

// ---------------------------------------------------------------------------------------------- C87

describe("C87 the recall's query flag", () => {
  it("C87 rerank=false and rerank=0 are accepted (off), rerank=maybe and a q of 2 001 characters are 400 validation", async () => {
    const w = await weakWorld();
    for (const flag of ["false", "0"]) {
      const body = await recallOf(w, `q=jardim&rerank=${flag}&record=false`);
      expect(body.rerank, flag).toBe("off");
    }
    expect(code(await w.call("GET", "/api/memory/recall?q=jardim&rerank=maybe"))).toEqual([
      400,
      "validation",
    ]);
    expect(code(await w.call("GET", `/api/memory/recall?q=${"a".repeat(2001)}`))).toEqual([
      400,
      "validation",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------- C88

describe("C88 the question is embedded once per recall", () => {
  it("C88 with the stub local model one recall sends exactly one query embed, with Q: from the entry's queryPrefix", async () => {
    const w = await stubWorld(GEMMA);
    w.note("nota", "## Nota\n\nUm texto qualquer sobre jardim.\n");
    await embed(w, () => at(0.9), { "jardim flores": Q }, GEMMA);
    const before = w.child.embeds().length;
    await recallOf(w, `q=${enc("jardim flores")}&record=false`);
    expect(
      w.child
        .embeds()
        .slice(before)
        .map((e) => e.texts),
    ).toEqual([["Q: jardim flores"]]);
  });
  it("C88 with http one recall sends one request whose input is [the question]", async () => {
    const w = await weakWorld();
    const server: EmbeddingsServer = await embeddingsServer(8);
    opened.push({ close: () => server.close() });
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: true,
        provider: "http",
        endpoint: server.url,
        model: "m",
        dimensions: 8,
      };
    });
    await w.index();
    const before = server.bodies.length;
    await recallOf(w, `q=${enc("jardim flores")}&record=false`);
    expect(server.bodies.slice(before).map((b) => b.input)).toEqual([["jardim flores"]]);
  });
});

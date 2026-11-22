import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { vectorToBlob, hashEmbed, HASH_DIM, HASH_PROVIDER_ID } from "../core/src/memory/embeddings.js";
import { GEMMA, QWEN, RERANKER, localWorld, type LocalWorld } from "./helpers/buscaStubs.js";
import { buscaWorld, code, type BuscaWorld, type Json } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado: who may call and the audience differentials (L-064, L-066, G44). Batch B
 * holds the search and the status over sections (C28); a twin home that never had the hidden folder's files is indexed
 * from nothing with the same provider, so nothing derived is shared with the home it is compared to.
 */

const worlds: BuscaWorld[] = [];
afterAll(async () => {
  for (const w of worlds) await w.close();
});

const VISIBLE: Record<string, string> = {
  jardim:
    "# Jardim\n\n## Rosas\n\nAs roseiras do jardim são podadas em julho.\n\n## Horta\n\nA horta tem alface, tomate e couve.\n",
  garagem:
    "# Garagem\n\n## Bicicleta\n\nA bicicleta azul fica pendurada na parede.\n\n## Ferramentas\n\nO martelo e a serra ficam na bancada.\n",
  cozinha: "# Cozinha\n\nA geladeira da cozinha foi trocada em maio, e o fogão é a gás.\n",
  viagem:
    "# Viagem\n\n## Hotel\n\nO hotel fica perto da praia.\n\n## Passeio\n\nUm passeio de barco pelas ilhas.\n\n## Volta\n\nO voo de volta sai às dez.\n",
  financas:
    "# Finanças\n\n## Contas\n\nA conta de luz vence no dia dez.\n\n## Impostos\n\nO imposto de renda vence em abril.\n",
};
const QUESTIONS = [
  "roseiras jardim podadas julho",
  "bicicleta azul parede garagem",
  "geladeira cozinha trocada maio",
  "hotel praia passeio barco ilhas",
  "conta luz imposto renda vence",
  "horta alface tomate couve martelo",
];
/** A hidden note has a section that is each question word for word: nearer to each of them than any visible note. */
const hiddenText = (i: number) => `segredo ${i}\n\n${QUESTIONS.map((q) => `## ${q}\n\n${q}\n`).join("\n")}`;

async function home(hidden: number | "never"): Promise<{ w: BuscaWorld; device: Record<string, string> }> {
  const w = await buscaWorld(`mordomo-busca-c28-${hidden}-`);
  worlds.push(w);
  w.hashOn();
  const outra = path.join(w.memory, "notes", "outra");
  for (const [name, text] of Object.entries(VISIBLE)) w.put(path.join(outra, `${name}.md`), text);
  if (hidden !== "never") {
    const fin = path.join(w.memory, "notes", "fin");
    for (let i = 0; i < hidden; i++) w.put(path.join(fin, `oculta-${i}.md`), hiddenText(i));
    const res = await w.call("PUT", "/api/settings", {
      folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  await w.index();
  return { w, device: w.device(["content"]) };
}

const answer = (w: BuscaWorld, body: Json) =>
  (body as Json[]).map((h) => [
    path.relative(w.memory, h.path),
    h.score,
    h.via,
    h.section ?? null,
    h.line ?? null,
  ]);

describe("C28 the audience differential of the search and the status", () => {
  it("C28 with 1 and 60 hidden notes nearer to every question, a device's search and status equal the twin's, in semantic and auto", async () => {
    const twin = await home("never");
    for (const n of [1, 60]) {
      const seen = await home(n);
      // the hidden notes are there and nearer: the owner's first n answers to every question are theirs
      for (const q of QUESTIONS) {
        const owner = await seen.w.call(
          "GET",
          `/api/memory/search?q=${encodeURIComponent(q)}&mode=semantic&limit=200`,
        );
        const first = (owner.body as Json[]).slice(0, n).map((h) => path.relative(seen.w.memory, h.path));
        expect(
          first.every((p) => p.startsWith("notes/fin/")),
          `N=${n} ${q}`,
        ).toBe(true);
      }
      for (const q of QUESTIONS)
        for (const mode of ["semantic", "auto"]) {
          const url = `/api/memory/search?q=${encodeURIComponent(q)}&mode=${mode}&limit=200`;
          const a = await seen.w.call("GET", url, undefined, seen.device);
          const b = await twin.w.call("GET", url, undefined, twin.device);
          expect([a.status, b.status]).toEqual([200, 200]);
          expect((b.body as Json[]).length, `${q} ${mode}`).toBeGreaterThan(0);
          expect(answer(seen.w, a.body), `N=${n} ${q} ${mode}`).toEqual(answer(twin.w, b.body));
        }
      const status = async (x: { w: BuscaWorld; device: Record<string, string> }) =>
        (await x.w.call("GET", "/api/memory/status", undefined, x.device)).body.semantic as Json;
      const mine = await status(seen);
      const theirs = await status(twin);
      expect([theirs.sections, theirs.vectors]).toEqual([10, 5]);
      expect([mine.sections, mine.vectors], `N=${n}`).toEqual([theirs.sections, theirs.vectors]);
    }
  });
});

// ---------------------------------------------------------------------------------------------- C60

describe("C60 who may call the two embedder routes", () => {
  it("C60 a device with every scope gets 403 owner_only and a run's credential 403 forbidden, through /api and /api/v1, with nothing fetched, written or deleted", async () => {
    const w = await localWorld("mordomo-busca-c60-");
    try {
      await w.install(QWEN);
      const fetched = w.host.requests.length;
      const device = w.device(["content", "monitor", "run", "approve"]);
      const run = w.run("write").headers;
      const modelsDir = path.join(w.home, "models");
      const listing = () =>
        (fs.readdirSync(modelsDir, { recursive: true }) as string[])
          .map((p) => p.split(path.sep).join("/"))
          .sort();
      const settings = () => fs.readFileSync(path.join(w.home, "config", "settings.json"));
      const bodies: Json[] = [
        { action: "install", id: RERANKER, acceptTerms: true },
        { action: "install", id: GEMMA, acceptTerms: true },
        { action: "cancel" },
        { action: "remove", id: QWEN },
        { action: "test" },
      ];
      for (const prefix of ["/api", "/api/v1"]) {
        for (const [who, headers, want] of [
          ["device", device, [403, "owner_only"]],
          ["run", run, [403, "forbidden"]],
        ] as const) {
          const beforeList = listing();
          const beforeSettings = settings();
          const get = await w.call("GET", `${prefix}/memory/embedder`, undefined, headers);
          expect(code(get), `${who} GET ${prefix}`).toEqual(want);
          for (const body of bodies) {
            const post = await w.call("POST", `${prefix}/memory/embedder`, body, headers);
            expect(code(post), `${who} POST ${prefix} ${JSON.stringify(body)}`).toEqual(want);
          }
          expect(w.host.requests.length, who).toBe(fetched);
          expect(listing(), who).toEqual(beforeList);
          expect(settings().equals(beforeSettings), who).toBe(true);
        }
      }
      // the owner still reads it, and the model is still there
      const owner = await w.embedder();
      expect(owner.status).toBe(200);
      expect((owner.body.models as Json[]).find((m) => m.id === QWEN)!.state).toBe("ready");
    } finally {
      await w.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------- C85, C93

/**
 * The recall's twins (G44): the notes of C28 plus a note whose one section is far from C85's weak question for `hash`, and
 * the chain of `tests/busca.abstain.test.ts` C80 (a link followed). The hidden notes hold every question word for word.
 */
const RECALL_VISIBLE: Record<string, string> = {
  ...VISIBLE,
  plantas:
    "## Plantas\n\nO quintal tem rosas cravos lírios tulipas orquídeas margaridas violetas begônias azaleias hortênsias girassóis camélias dálias gérberas jasmins lavandas papoulas petúnias gardênias magnólias amarílis.\n",
  inicio: "Inicio amora, veja [b](./b.md).\n",
  b: "## Amora\n\namora amora amora amora e [c](./c.md).\n",
  c: "## Amora\n\namora amora amora amora amora amora amora amora.\n",
};
const RECALL_QUESTIONS = [
  "roseiras jardim podadas julho",
  "bicicleta azul parede garagem",
  "conta luz imposto renda vence",
  // abstains as weak: its best section matches 1 of 4 keywords and is far from it
  "quintal xablau yyzzq wwqqp zzkkv",
  // its nearest sections are all hidden: no visible note holds a word of it
  "segredo cofre senha guardada",
  // follows a link: A is opened alone (k 1) and B, then C, score higher
  "inicio amora",
];
const recallHidden = (i: number) =>
  `segredo ${i} cofre senha guardada\n\n${RECALL_QUESTIONS.map((q) => `## ${q}\n\n${q} ocultomarca\n`).join("\n")}`;

async function recallHome(
  hidden: number | "never",
  make: (prefix: string) => Promise<BuscaWorld>,
): Promise<{ w: BuscaWorld; device: Record<string, string> }> {
  const w = await make(`mordomo-busca-c85-${hidden}-`);
  worlds.push(w);
  w.hashOn();
  const outra = path.join(w.memory, "notes", "outra");
  for (const [name, text] of Object.entries(RECALL_VISIBLE)) w.put(path.join(outra, `${name}.md`), text);
  // a note the device may read that is outside C93's work context (`notes/outra`)
  w.put(
    path.join(w.memory, "notes", "fora", "fora.md"),
    "## Fora\n\nforaunico roseiras jardim podadas julho\n",
  );
  if (hidden !== "never") {
    const fin = path.join(w.memory, "notes", "fin");
    for (let i = 0; i < hidden; i++) w.put(path.join(fin, `oculta-${i}.md`), recallHidden(i));
    const res = await w.call("PUT", "/api/settings", {
      folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  await w.index();
  return { w, device: w.device(["content"]) };
}

/** What C85 compares: the abstention, the reranker, the counts, the keywords and the excerpts (path, section, order). */
const recallAnswer = (w: BuscaWorld, body: Json) => ({
  abstained: body.abstained,
  abstainReason: body.abstainReason,
  rerank: body.rerank,
  candidatesConsidered: body.candidatesConsidered,
  keywords: body.keywords,
  answerContext: (body.answerContext as Json[]).map((c) => [
    path.relative(w.memory, c.path),
    c.section,
    c.via ? path.relative(w.memory, c.via) : null,
  ]),
});
const recallUrl = (q: string) =>
  `/api/memory/recall?q=${encodeURIComponent(q)}&record=false${q === "inicio amora" ? "&k=1" : ""}`;

describe("C85 the audience differential of the recall", () => {
  it("C85 with 1 and 60 hidden notes nearer to every question, a device's recall equals the twin's in abstention, rerank, counts, keywords and excerpts", async () => {
    const twin = await recallHome("never", (p) => buscaWorld(p));
    // the six questions do what they are there for, in the twin
    const twins = new Map<string, ReturnType<typeof recallAnswer>>();
    for (const q of RECALL_QUESTIONS) {
      const res = await twin.w.call("GET", recallUrl(q), undefined, twin.device);
      expect(res.status).toBe(200);
      twins.set(q, recallAnswer(twin.w, res.body));
    }
    expect(twins.get("quintal xablau yyzzq wwqqp zzkkv")!.abstainReason).toBe("weak");
    expect(twins.get("segredo cofre senha guardada")!.abstained).toBe(true);
    expect(twins.get("inicio amora")!.answerContext.some((c) => c[2] !== null)).toBe(true);
    expect(twins.get("roseiras jardim podadas julho")!.abstained).toBe(false);
    for (const n of [1, 60]) {
      const seen = await recallHome(n, (p) => buscaWorld(p));
      // the hidden notes are there: the owner is told of them among its candidates
      for (const q of RECALL_QUESTIONS) {
        const owner = await seen.w.call("GET", recallUrl(q));
        expect(
          (owner.body.candidates as Json[]).some((c) => c.path.includes(`${path.sep}fin${path.sep}`)),
          `N=${n} ${q}`,
        ).toBe(true);
      }
      for (const q of RECALL_QUESTIONS) {
        const a = await seen.w.call("GET", recallUrl(q), undefined, seen.device);
        expect(a.status).toBe(200);
        expect(recallAnswer(seen.w, a.body), `N=${n} ${q}`).toEqual(twins.get(q));
      }
    }
  }, 120_000);
});

describe("C93 only what the caller may read reaches the reranker", () => {
  it("C93 no text under config/, outside the context or hidden from the device is sent to the reranker, and the device's answer with it on equals the twin's", async () => {
    const make = async (prefix: string) => {
      const w = await localWorld(prefix);
      await w.install(RERANKER);
      w.update((s) => {
        s.memory.recall = { ...s.memory.recall, rerank: { ...s.memory.recall.rerank, enabled: true } };
      });
      return w as BuscaWorld & { child: LocalWorld["child"] };
    };
    const twin = await recallHome("never", make);
    const twinAnswers = new Map<string, unknown>();
    for (const q of RECALL_QUESTIONS) {
      const res = await twin.w.call("GET", recallUrl(q), undefined, twin.device);
      twinAnswers.set(q, recallAnswer(twin.w, res.body));
    }
    expect([...twinAnswers.values()].some((a) => (a as Json).rerank === "used")).toBe(true);
    for (const n of [1, 60]) {
      const seen = await recallHome(n, make);
      const w = seen.w as BuscaWorld & { child: LocalWorld["child"] };
      // a context over `notes/outra`, and a stale row of the home's config/ with its vector (an old pass's)
      w.update((s) => {
        s.contexts = [{ id: "ctx", name: "Ctx", paths: [path.join(w.memory, "notes", "outra")] } as never];
      });
      const cfgText = "configunico roseiras jardim podadas julho";
      w.put(path.join(w.home, "config", "cfg.md"), `## Cfg\n\n${cfgText}\n`);
      const id = w.row(w.home, "config/cfg.md");
      w.ctx.db
        .prepare(
          "INSERT INTO section_vectors (file_id, ord, heading, start_line, end_line, provider, dim, vec, mtime, size) VALUES (?, 0, 'Cfg', 3, 3, ?, ?, ?, 1, 1)",
        )
        .run(id, HASH_PROVIDER_ID, HASH_DIM, vectorToBlob(hashEmbed(`Cfg\n${cfgText}`)));
      /** The texts the reranker was sent during one request. */
      const sentBy = async (url: string, headers?: Record<string, string>) => {
        const before = w.child.log().length;
        const res = await w.call("GET", url, undefined, headers);
        expect(res.status).toBe(200);
        const texts = w.child
          .log()
          .slice(before)
          .filter((m) => m.t === "rerank")
          .flatMap((m) => m.texts as string[]);
        return { body: res.body, texts: texts.join("\n") };
      };
      let sent = 0;
      for (const q of RECALL_QUESTIONS) {
        const device = await sentBy(recallUrl(q), seen.device);
        expect(recallAnswer(w, device.body), `N=${n} ${q}`).toEqual(twinAnswers.get(q));
        expect(device.texts, `device ${q}`).not.toMatch(/ocultomarca|configunico/);
        const context = await sentBy(`${recallUrl(q)}&context=ctx`);
        expect(context.texts, `context ${q}`).not.toMatch(/ocultomarca|configunico|foraunico/);
        const owner = await sentBy(recallUrl(q));
        expect(owner.texts, `owner ${q}`).not.toContain("configunico");
        sent += device.texts.length + context.texts.length;
      }
      expect(sent).toBeGreaterThan(0);
    }
  }, 180_000);
});

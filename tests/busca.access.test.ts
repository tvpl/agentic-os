import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GEMMA, QWEN, RERANKER, localWorld } from "./helpers/buscaStubs.js";
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

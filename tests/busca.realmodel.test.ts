/**
 * OPT-IN, NOT A CI PROOF (.specs/features/cerebro-busca-significado, C137; "Level honesty" and `## Not verified here`):
 * the real local models on this machine, through the built CLI. Skipped unless `MORDOMO_REAL_MODEL=1`, as
 * `tests/memory.packaging.test.ts` is skipped without a build; no Coverage row and no Swept line credits it.
 *
 * The models are read from an existing home (`MORDOMO_REAL_MODEL_HOME`, default `~/.mordomo`), whose `models/<id>/`
 * holds each model as `POST /api/memory/embedder {action: "install"}` left it (verified); each run links them into a
 * fresh home. For EmbeddingGemma (the claim) and Qwen3-Embedding (the owner's measurement of the abstention, moved
 * here from C77): the Portuguese corpus indexed with the real model gives a `semantic` row of `mordomo eval` whose
 * `1-recall@20` is at least the `hash` baseline of C10 (0.729), cerebro-v2's C46 `synonym` question finds its note in
 * the top 3, and the run prints the rows, `abstainCorrect` and the best cosine of the 12 `abstain` questions against
 * the 48 others (what `minSimilarity` of the catalog is measured from).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../core/src/models/catalog.js";
import { resolvePaths } from "../core/src/paths.js";
import { corpusHome } from "./helpers/buscaWorld.js";

const REAL = process.env.MORDOMO_REAL_MODEL === "1";
const repoRoot = path.resolve(__dirname, "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const SOURCE = path.join(
  process.env.MORDOMO_REAL_MODEL_HOME ?? path.join(os.homedir(), ".mordomo"),
  "models",
);
const QUERIES = path.join(repoRoot, "tests", "fixtures", "pt-queries.json");
/** C10's `hash` baseline of the `semantic` row's `1-recall@20`. */
const HASH_RECALL = 0.729;

function mordomo(home: string, args: string[]) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 1_800_000,
    env: { ...process.env, MORDOMO_HOME: home, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** A home indexing `notes` (the Portuguese corpus by default) with the real model `id`, its vectors computed by the built CLI. */
async function realHome(id: string, notes?: Record<string, string>) {
  const home = await corpusHome("off", notes);
  const settings = home.ctx.settings();
  settings.memory.embeddings = {
    ...settings.memory.embeddings,
    enabled: true,
    provider: "local",
    local: { model: id as never },
  };
  home.ctx.settingsStore.save(settings);
  home.close();
  fs.mkdirSync(path.join(home.home, "models"), { recursive: true });
  fs.symlinkSync(path.join(SOURCE, id), path.join(home.home, "models", id), "dir");
  const index = mordomo(home.home, ["index", "--json"]);
  expect(index.status, index.stderr).toBe(0);
  return home;
}

type Row = { "1-recall@20": number; mrr: number; "hit@3": number };
function evalJson(home: string, file: string) {
  const res = mordomo(home, ["eval", file, "--json"]);
  expect(res.status, res.stderr).toBe(0);
  return JSON.parse(res.stdout) as {
    modes: Record<string, Row>;
    abstainCorrect: { n: number; total: number };
  };
}

const cos = (a: Float32Array, b: number[]) => {
  let dot = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(nb);
};

/** The best cosine of each question against every stored section (the vectors are unit length). */
async function bestCosines(home: string, id: string, questions: string[]): Promise<number[]> {
  // the built core: its child process is the real one (the source tree has none)
  const dist = (await import(path.join(repoRoot, "core", "dist", "models", "localModels.js"))) as {
    LocalModels: new (o: unknown) => {
      ready: (id: string) => unknown;
      embed: (e: unknown, t: string[], s: AbortSignal) => Promise<number[][]>;
      dispose: () => void;
    };
    localModelsOptions: (home: string) => unknown;
  };
  const local = new dist.LocalModels(dist.localModelsOptions(home));
  try {
    const entry = local.ready(id);
    expect(entry, `${id} ready in ${home}`).not.toBeNull();
    const prefix = MODEL_CATALOG.find((m) => m.id === id)!.queryPrefix ?? "";
    const vectors: number[][] = [];
    for (let i = 0; i < questions.length; i += 8)
      vectors.push(
        ...(await local.embed(
          entry,
          questions.slice(i, i + 8).map((q) => prefix + q),
          AbortSignal.timeout(600_000),
        )),
      );
    const db = new Database(resolvePaths(home).dbFile, { readonly: true });
    const rows = (db.prepare("SELECT vec FROM section_vectors").all() as Array<{ vec: Buffer }>).map(
      (r) => new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4),
    );
    db.close();
    return vectors.map((v) => Math.max(...rows.map((r) => cos(r, v))));
  } finally {
    local.dispose();
  }
}

/** What the run measured: printed, and appended to `MORDOMO_REAL_MODEL_REPORT` when it names a file. */
function report(text: string) {
  console.log(text);
  if (process.env.MORDOMO_REAL_MODEL_REPORT)
    fs.appendFileSync(process.env.MORDOMO_REAL_MODEL_REPORT, `${text}\n`);
}

const range = (xs: number[]) => `${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)}`;
const MODELS = ["embeddinggemma-300m-q4", "qwen3-embedding-0.6b-q4f16"];

describe.skipIf(!REAL)("C137 OPT-IN, NOT CREDITED: the real local models on this machine", () => {
  it.each(MODELS)(
    "C137 %s: the semantic row's 1-recall@20 is at least hash's 0.729, the synonym question is in the top 3, and the measurements are printed",
    async (id) => {
      expect(fs.existsSync(CLI), "npm run build first").toBe(true);
      expect(fs.existsSync(path.join(SOURCE, id, ".verified.json")), `${id} installed in ${SOURCE}`).toBe(
        true,
      );

      const pt = await realHome(id);
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-real-"));
      try {
        const run = evalJson(pt.home, QUERIES);
        const queries = (
          JSON.parse(fs.readFileSync(QUERIES, "utf8")) as { queries: Array<{ q: string; kind: string }> }
        ).queries;
        const best = await bestCosines(
          pt.home,
          id,
          queries.map((q) => q.q),
        );
        const abstain = best.filter((_, i) => queries[i]!.kind === "abstain");
        const answered = best.filter((_, i) => queries[i]!.kind !== "abstain");
        const catalog = MODEL_CATALOG.find((m) => m.id === id)!;
        report(
          [
            `C137 ${id}`,
            ...Object.entries(run.modes).map(
              ([mode, r]) =>
                `  ${mode} 1-recall@20=${r["1-recall@20"].toFixed(3)} mrr=${r.mrr.toFixed(3)} hit@3=${r["hit@3"].toFixed(3)}`,
            ),
            `  abstainCorrect=${run.abstainCorrect.n}/${run.abstainCorrect.total}`,
            `  best cosine: abstain ${range(abstain)}, the others ${range(answered)}; catalog minSimilarity ${catalog.minSimilarity}`,
          ].join("\n"),
        );
        expect(run.modes.semantic!["1-recall@20"]).toBeGreaterThanOrEqual(HASH_RECALL);

        // cerebro-v2's C46 corpus: the synonym question finds its note in the top 3 by meaning
        const v2 = JSON.parse(
          fs.readFileSync(path.join(repoRoot, "tests/fixtures/semantic-corpus.json"), "utf8"),
        ) as {
          notes: Array<{ name: string; text: string }>;
          questions: Array<{ q: string; expected: string; kind: string }>;
        };
        const synonym = v2.questions.find((q) => q.kind === "synonym")!;
        const home = await realHome(id, Object.fromEntries(v2.notes.map((n) => [`${n.name}.md`, n.text])));
        try {
          const file = path.join(work, "synonym.json");
          fs.writeFileSync(
            file,
            JSON.stringify({
              v: 1,
              queries: [{ q: synonym.q, kind: "single", expect: [`${synonym.expected}.md`] }],
            }),
          );
          const one = evalJson(home.home, file);
          report(`  synonym "${synonym.q}": semantic hit@3=${one.modes.semantic!["hit@3"].toFixed(3)}`);
          expect(one.modes.semantic!["hit@3"]).toBe(1);
        } finally {
          home.cleanup();
        }
      } finally {
        pt.cleanup();
        fs.rmSync(work, { recursive: true, force: true });
      }
    },
    3_600_000,
  );
});

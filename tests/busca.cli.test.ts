import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BIN } from "./helpers.js";
import { PT_QUERIES, corpusHome, embeddingsServer, type CorpusHome } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S1: `mordomo eval` through the BUILT cli, over a real home and a real index
 * (built by the test's own engine, closed before the CLI runs), as `natureza.cli.test.ts` runs `mordomo recall`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady) console.warn(`[busca.cli] skipping the CLI proof: ${CLI} is missing, run npm run build`);

function mordomo(home: string, args: string[]) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      MORDOMO_HOME: home,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** The numbers of the text output's line for a mode. */
const lineNumbers = (stdout: string, mode: string): number[] => {
  const line = stdout.split("\n").find((l) => l.startsWith(`${mode} `))!;
  return [...line.matchAll(/=(\d\.\d{3})/g)].map((m) => Number(m[1]));
};

describe.skipIf(!distReady)("S1 mordomo eval over a small home", () => {
  let small: CorpusHome;
  let work: string;
  let queries: string;
  beforeAll(async () => {
    small = await corpusHome("hash", {
      "jardim.md": "# Jardim\n\nAs roseiras do jardim são podadas em julho, depois da floração.\n",
      "cozinha.md": "# Cozinha\n\nA geladeira da cozinha foi trocada em maio.\n",
      "garagem.md": "# Garagem\n\nA bicicleta fica pendurada na parede da garagem.\n",
    });
    small.close();
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-busca-cli-")));
    queries = path.join(work, "queries.json");
    fs.writeFileSync(
      queries,
      JSON.stringify({
        v: 1,
        queries: [
          { q: "quando as roseiras do jardim são podadas?", kind: "single", expect: ["jardim.md"] },
          { q: "qual é o número do passaporte?", kind: "abstain", expect: [] },
        ],
      }),
    );
  });
  afterAll(() => {
    small?.cleanup();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("C4 the text output is exactly the four mode lines in order, then abstainCorrect; stderr empty, exit 0", () => {
    const res = mordomo(small.home, ["eval", queries]);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(
      [
        "and 1-recall@20=1.000 mrr=1.000 hit@3=1.000",
        "or 1-recall@20=1.000 mrr=1.000 hit@3=1.000",
        "semantic 1-recall@20=1.000 mrr=1.000 hit@3=1.000",
        "hybrid 1-recall@20=1.000 mrr=1.000 hit@3=1.000",
        "abstainCorrect=1/1",
        "",
      ].join("\n"),
    );
  });

  it("C5 --json prints one JSON object and nothing else, with the text run's numbers, the modes in order and no rerank", () => {
    const res = mordomo(small.home, ["eval", queries, "--json"]);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(res.stdout.endsWith("}\n")).toBe(true);
    const report = JSON.parse(res.stdout) as {
      modes: Record<string, Record<string, number>>;
      abstainCorrect: { n: number; total: number };
    };
    expect(`${JSON.stringify(report)}\n`).toBe(res.stdout);
    expect(Object.keys(report)).toEqual(["modes", "abstainCorrect"]);
    expect(Object.keys(report.modes)).toEqual(["and", "or", "semantic", "hybrid"]);
    expect(report.modes).not.toHaveProperty("rerank");
    const text = mordomo(small.home, ["eval", queries]).stdout;
    for (const mode of ["and", "or", "semantic", "hybrid"]) {
      expect(Object.keys(report.modes[mode]!), mode).toEqual(["1-recall@20", "mrr", "hit@3"]);
      const m = report.modes[mode]!;
      expect([m["1-recall@20"], m.mrr, m["hit@3"]], mode).toEqual(lineNumbers(text, mode));
      expect([m["1-recall@20"], m.mrr, m["hit@3"]], mode).toEqual([1, 1, 1]);
    }
    expect(report.abstainCorrect).toEqual({ n: 1, total: 1 });
  });

  const bad: Array<[string, string, string]> = [
    ["not JSON", "{ v: 1, queries: [", "file"],
    ['"v": 2', JSON.stringify({ v: 2, queries: [] }), "file"],
    ["queries not a list", JSON.stringify({ v: 1, queries: "q" }), "file"],
    [
      'queries[3] kind "other"',
      JSON.stringify({
        v: 1,
        queries: [0, 1, 2, 3].map((i) => ({
          q: `p${i}?`,
          kind: i === 3 ? "other" : "single",
          expect: ["a.md"],
        })),
      }),
      "queries[3]",
    ],
    [
      'queries[0] expect "a.md"',
      JSON.stringify({ v: 1, queries: [{ q: "p?", kind: "single", expect: "a.md" }] }),
      "queries[0]",
    ],
    [
      'queries[1] q ""',
      JSON.stringify({
        v: 1,
        queries: [
          { q: "p?", kind: "single", expect: ["a.md"] },
          { q: "", kind: "single", expect: ["a.md"] },
        ],
      }),
      "queries[1]",
    ],
    [
      "a query with no q",
      JSON.stringify({
        v: 1,
        queries: [
          { q: "p?", kind: "single", expect: ["a.md"] },
          { kind: "abstain", expect: [] },
        ],
      }),
      "queries[1]",
    ],
    [
      "queries[2] and queries[5] bad",
      JSON.stringify({
        v: 1,
        queries: [0, 1, 2, 3, 4, 5].map((i) => ({
          q: i === 5 ? "" : `p${i}?`,
          kind: i === 2 ? "other" : "single",
          expect: ["a.md"],
        })),
      }),
      "queries[2]",
    ],
  ];
  it.each(bad)("C6 %s: nothing on stdout, exit 2, stderr names %s", (_case, text, position) => {
    const file = path.join(work, `bad-${position.replace(/\W/g, "")}-${text.length}.json`);
    fs.writeFileSync(file, text);
    const res = mordomo(small.home, ["eval", file]);
    expect(res.stdout).toBe("");
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(new RegExp(`^eval: ${position.replace(/[[\]]/g, "\\$&")}: \\S.*\\n$`));
  });

  it("C6 a path that does not exist: nothing on stdout, exit 2, stderr names file", () => {
    const res = mordomo(small.home, ["eval", path.join(work, "no-such-file.json")]);
    expect(res.stdout).toBe("");
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/^eval: file: \S.*\n$/);
  });
});

describe.skipIf(!distReady)("S1 mordomo eval over the Portuguese corpus", () => {
  let corpus: CorpusHome;
  beforeAll(async () => {
    corpus = await corpusHome("hash");
    corpus.close();
  });
  afterAll(() => corpus?.cleanup());

  it("C7 two runs print byte-identical output, in text and in --json", () => {
    for (const flags of [[], ["--json"]]) {
      const first = mordomo(corpus.home, ["eval", PT_QUERIES, ...flags]);
      const second = mordomo(corpus.home, ["eval", PT_QUERIES, ...flags]);
      expect(first.status, first.stderr).toBe(0);
      expect(second.status, second.stderr).toBe(0);
      expect(first.stdout.length).toBeGreaterThan(0);
      expect(second.stdout).toBe(first.stdout);
    }
  });

  it("C10 mordomo eval tests/fixtures/pt-queries.json over the corpus with hash prints the recorded baseline", () => {
    const res = mordomo(corpus.home, ["eval", "tests/fixtures/pt-queries.json"]);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    // recorded once by the builder of batch A from this run (G11): a change to the search moves a number here
    // (moved once already: C138 put the word itself in the OR, and `or` mrr went 0.800 → 0.799, one question 5th → 6th;
    // moved again by batch B: one vector per section with its heading path (door 1) took `semantic` mrr 0.613 → 0.632 and
    // hit@3 0.646 → 0.667, recall@20 unchanged at 0.729)
    expect(res.stdout).toBe(BASELINE);
  });
});

const BASELINE = [
  "and 1-recall@20=0.146 mrr=0.146 hit@3=0.146",
  "or 1-recall@20=0.938 mrr=0.799 hit@3=0.896",
  "semantic 1-recall@20=0.729 mrr=0.632 hit@3=0.667",
  "hybrid 1-recall@20=0.938 mrr=0.784 hit@3=0.896",
  "abstainCorrect=5/12",
  "",
].join("\n");

describe.skipIf(!distReady)("S3 mordomo eval while a pass runs", () => {
  it("C34 an eval spawned while a pass is held in its vectors phase exits 0 with its five lines", async () => {
    const home = await corpusHome("off", {
      "jardim.md": "# Jardim\n\nAs roseiras do jardim são podadas em julho.\n",
      "cozinha.md": "# Cozinha\n\nA geladeira da cozinha foi trocada em maio.\n",
    });
    const server = await embeddingsServer(8);
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-busca-c34-")));
    try {
      const queries = path.join(work, "queries.json");
      fs.writeFileSync(
        queries,
        JSON.stringify({
          v: 1,
          queries: [{ q: "roseiras do jardim", kind: "single", expect: ["jardim.md"] }],
        }),
      );
      const settings = home.ctx.settings();
      settings.memory.embeddings = {
        ...settings.memory.embeddings,
        enabled: true,
        provider: "http",
        endpoint: server.url,
        model: "modelo",
        dimensions: 8,
      } as typeof settings.memory.embeddings;
      home.ctx.settingsStore.save(settings);
      // the pass's first batch is held until the eval has ended
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const inVectors = new Promise<void>((resolve) => (reached = resolve));
      server.hold = (n) => (n === 1 ? (reached(), held) : undefined);
      const pass = home.ctx.indexer.indexAllAsync();
      await inVectors;
      expect(home.ctx.indexer.isIndexing()).toBe(true);
      const res = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [CLI, "eval", queries], {
          cwd: repoRoot,
          env: { ...process.env, MORDOMO_HOME: home.home, NO_COLOR: "1", FORCE_COLOR: "0" },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
        child.on("close", (status) => resolve({ status, stdout, stderr }));
      });
      expect(home.ctx.indexer.isIndexing()).toBe(true);
      release();
      const stats = await pass;
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const lines = res.stdout.split("\n");
      expect(lines.map((l) => l.split(" ")[0]!.split("=")[0])).toEqual([
        "and",
        "or",
        "semantic",
        "hybrid",
        "abstainCorrect",
        "",
      ]);
      expect(stats.embedded).toBe(2);
    } finally {
      await server.close();
      home.cleanup();
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});

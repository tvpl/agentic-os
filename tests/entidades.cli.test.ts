import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_BIN } from "./helpers.js";
import { corpusHome, type CorpusHome } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch B, S4 (AC 46): `mordomo eval` through the BUILT cli prints the
 * `graph` mode right after `hybrid` while `memory.recall.graph.enabled` is on, and never while it is off.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");

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

describe("C52 mordomo eval's graph mode", () => {
  let small: CorpusHome;
  let work: string;
  let queries: string;
  const graph = (on: boolean) => {
    const file = path.join(small.home, "config", "settings.json");
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    settings.memory.recall = { ...settings.memory.recall, graph: { enabled: on } };
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  };
  beforeAll(async () => {
    expect(fs.existsSync(CLI), `${CLI}: run npm run build first`).toBe(true);
    small = await corpusHome("hash", {
      "girafa.md":
        "# Girafa\n\nA girafa do zoológico come folhas.\n\n## Ver também\n\n- [quem cuida](tratador.md)\n",
      "tratador.md": "# Tratador\n\nO tratador chega às sete horas.\n",
      "jardim.md": "# Jardim\n\nAs roseiras do jardim são podadas em julho.\n",
    });
    small.close();
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-entidades-cli-")));
    queries = path.join(work, "queries.json");
    fs.writeFileSync(
      queries,
      JSON.stringify({
        v: 1,
        queries: [
          { q: "o que a girafa do zoológico come?", kind: "single", expect: ["girafa.md"] },
          { q: "quando as roseiras são podadas?", kind: "single", expect: ["jardim.md"] },
          { q: "qual é o número do passaporte?", kind: "abstain", expect: [] },
        ],
      }),
    );
  });
  afterAll(() => {
    small?.cleanup();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("C52 with the graph on, the text prints graph right after hybrid and --json has modes.graph after modes.hybrid", () => {
    graph(true);
    const text = mordomo(small.home, ["eval", queries]);
    expect(text.stderr).toBe("");
    expect(text.status).toBe(0);
    const lines = text.stdout.trimEnd().split("\n");
    expect(lines.map((l) => l.split(/[ =]/)[0])).toEqual([
      "and",
      "or",
      "semantic",
      "hybrid",
      "graph",
      "abstainCorrect",
    ]);
    expect(lines[4]).toMatch(/^graph 1-recall@20=\d\.\d{3} mrr=\d\.\d{3} hit@3=\d\.\d{3}$/);
    expect(lines[4]).toBe("graph 1-recall@20=1.000 mrr=1.000 hit@3=1.000");

    const json = mordomo(small.home, ["eval", queries, "--json"]);
    expect(json.status).toBe(0);
    const report = JSON.parse(json.stdout);
    expect(Object.keys(report.modes)).toEqual(["and", "or", "semantic", "hybrid", "graph"]);
    expect(report.modes.graph).toEqual({ "1-recall@20": 1, mrr: 1, "hit@3": 1 });
  }, 120_000);

  it("C52 with the graph off neither the line nor the key appears", () => {
    graph(false);
    const text = mordomo(small.home, ["eval", queries]);
    expect(text.status).toBe(0);
    expect(text.stdout.split("\n").map((l) => l.split(/[ =]/)[0])).not.toContain("graph");
    expect(text.stdout).toContain("hybrid 1-recall@20=");
    const report = JSON.parse(mordomo(small.home, ["eval", queries, "--json"]).stdout);
    expect(Object.keys(report.modes)).toEqual(["and", "or", "semantic", "hybrid"]);
  }, 120_000);
});

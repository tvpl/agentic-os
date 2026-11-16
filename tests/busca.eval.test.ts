import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVAL_KINDS,
  EvalFormatError,
  evalMetrics,
  evalRankings,
  evalReport,
  parseEvalFile,
  readEvalFile,
  type EvalQuery,
  type EvalRankings,
} from "../core/src/memory/eval.js";
import { recall } from "../core/src/memory/recall.js";
import { PT_CORPUS, PT_QUERIES, corpusHome, type CorpusHome } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S1, at the eval's own layer: the shipped corpus, the format check of door 6,
 * the three metrics and the `abstain` count over hand-built rankings, and a run over a real index with `hash` or off.
 */

const homes: CorpusHome[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const home of homes.splice(0)) home.cleanup();
});
async function home(embeddings: "hash" | "off"): Promise<CorpusHome> {
  const h = await corpusHome(embeddings);
  homes.push(h);
  return h;
}
const sourceOf = (h: CorpusHome) => ({
  db: h.ctx.db,
  paths: h.ctx.paths,
  settings: h.ctx.settings(),
  semantic: h.ctx.semantic,
  allow: h.ctx.indexer.rowFilter(),
});

const q = (kind: EvalQuery["kind"], expect: string[] = kind === "abstain" ? [] : ["x.md"]): EvalQuery => ({
  q: `pergunta ${kind}`,
  kind,
  expect,
});
/** A ranking of `rank - 1` other files and then `path` (a 1-based rank). */
const at = (rank: number, file = "x.md"): string[] => [
  ...Array.from({ length: rank - 1 }, (_, i) => `outro-${i}.md`),
  file,
];

describe("S1 the Portuguese evaluation set", () => {
  it("C1 40 notes, 60 queries 12 of each kind, every expect path exists, multi has 2 or more, abstain is empty, and the file passes the format check", () => {
    const notes = fs.readdirSync(PT_CORPUS);
    expect(notes.filter((n) => n.endsWith(".md"))).toHaveLength(40);
    expect(notes).toHaveLength(40);
    const raw = JSON.parse(fs.readFileSync(PT_QUERIES, "utf8")) as { v: number; queries: EvalQuery[] };
    expect(Object.keys(raw)).toEqual(["v", "queries"]);
    expect(raw.v).toBe(1);
    expect(raw.queries).toHaveLength(60);
    const byKind = Object.fromEntries(
      EVAL_KINDS.map((k) => [k, raw.queries.filter((x) => x.kind === k).length]),
    );
    expect(byKind).toEqual({ single: 12, multi: 12, latest: 12, window: 12, abstain: 12 });
    for (const query of raw.queries) {
      if (query.kind === "abstain") {
        expect(query.expect, query.q).toEqual([]);
        continue;
      }
      expect(query.expect.length, query.q).toBeGreaterThan(0);
      if (query.kind === "multi") expect(query.expect.length, query.q).toBeGreaterThanOrEqual(2);
      for (const file of query.expect)
        expect(fs.existsSync(path.join(PT_CORPUS, file)), `${query.q}: ${file}`).toBe(true);
    }
    expect(readEvalFile(PT_QUERIES)).toHaveLength(60);
  });
});

describe("S1 the metrics at their own layer", () => {
  it("C2 ranks 1, 3, 4, 20 and 21 give 1-recall@20 0.800, hit@3 0.400 and mrr 0.327", () => {
    const queries = [q("single"), q("single"), q("latest"), q("window"), q("single")];
    expect(evalMetrics([at(1), at(3), at(4), at(20), at(21)], queries)).toEqual({
      "1-recall@20": 0.8,
      mrr: 0.327,
      "hit@3": 0.4,
    });
  });

  it("C2 a multi query with only its second path at rank 2 is found with reciprocal rank 0.5", () => {
    const queries = [q("multi", ["a.md", "b.md"])];
    expect(evalMetrics([at(2, "b.md")], queries)).toEqual({ "1-recall@20": 1, mrr: 0.5, "hit@3": 1 });
  });

  it("C2 exactly one query at rank 1 reads 1.000 on all three", () => {
    expect(evalMetrics([at(1)], [q("single")])).toEqual({ "1-recall@20": 1, mrr: 1, "hit@3": 1 });
  });
});

describe("S1 abstain queries at their own layer", () => {
  it("C3 abstain queries are in no denominator and abstainCorrect counts the recall's abstained answers", () => {
    const queries = [q("single"), q("abstain"), q("multi"), q("abstain"), q("abstain")];
    const ranking = [at(1), [], at(1), at(1, "y.md"), []];
    const rankings: EvalRankings = {
      and: ranking,
      or: ranking,
      semantic: ranking,
      hybrid: ranking,
      abstained: [false, true, false, false, true],
    };
    const report = evalReport(rankings, queries);
    for (const mode of ["and", "or", "semantic", "hybrid"] as const)
      expect(report.modes[mode], mode).toEqual({ "1-recall@20": 1, mrr: 1, "hit@3": 1 });
    expect(report.abstainCorrect).toEqual({ n: 2, total: 3 });
  });

  it("C3 a non-abstain query the recall abstains on counts as not found in the hybrid row", () => {
    const queries = [q("single"), q("single")];
    const rankings: EvalRankings = {
      and: [at(1), at(1)],
      or: [at(1), at(1)],
      semantic: [at(1), at(1)],
      hybrid: [at(1), at(1)],
      abstained: [false, true],
    };
    const report = evalReport(rankings, queries);
    expect(report.modes.hybrid).toEqual({ "1-recall@20": 0.5, mrr: 0.5, "hit@3": 0.5 });
    expect(report.modes.and).toEqual({ "1-recall@20": 1, mrr: 1, "hit@3": 1 });
    expect(report.abstainCorrect).toEqual({ n: 0, total: 0 });
  });
});

describe("S1 the format check", () => {
  const good = { q: "onde fica a chave?", kind: "single", expect: ["a.md"] };
  const position = (text: string): string => {
    try {
      parseEvalFile(text);
    } catch (error) {
      expect(error).toBeInstanceOf(EvalFormatError);
      expect((error as Error).message).toMatch(/^eval: (file|queries\[\d+\]): .+/);
      return (error as EvalFormatError).position;
    }
    throw new Error("the file passed the format check");
  };
  const file = (queries: unknown[]) => JSON.stringify({ v: 1, queries });
  const many = (n: number, bad: Record<number, unknown>) =>
    file(Array.from({ length: n }, (_, i) => (i in bad ? bad[i] : good)));

  it("C6 a file that is not JSON names file", () => {
    expect(position("{ v: 1, queries: [")).toBe("file");
  });
  it('C6 "v": 2 names file', () => {
    expect(position(JSON.stringify({ v: 2, queries: [good] }))).toBe("file");
  });
  it("C6 queries not a list names file", () => {
    expect(position(JSON.stringify({ v: 1, queries: { 0: good } }))).toBe("file");
  });
  it("C6 a path that does not exist names file", () => {
    const missing = path.join(os.tmpdir(), "mordomo-no-such-eval-file", "queries.json");
    let thrown: unknown;
    try {
      readEvalFile(missing);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EvalFormatError);
    expect((thrown as EvalFormatError).position).toBe("file");
    expect((thrown as Error).message).toMatch(/^eval: file: .+/);
  });
  it('C6 queries[3] with kind "other" names queries[3]', () => {
    expect(position(many(5, { 3: { ...good, kind: "other" } }))).toBe("queries[3]");
  });
  it('C6 queries[0] with expect "a.md" names queries[0]', () => {
    expect(position(many(2, { 0: { ...good, expect: "a.md" } }))).toBe("queries[0]");
  });
  it('C6 queries[1] with q "" names queries[1]', () => {
    expect(position(many(3, { 1: { ...good, q: "" } }))).toBe("queries[1]");
  });
  it("C6 a query with no q names its index", () => {
    expect(position(many(4, { 2: { kind: "single", expect: ["a.md"] } }))).toBe("queries[2]");
    expect(position(many(1, { 0: { kind: "abstain", expect: [] } }))).toBe("queries[0]");
  });
  it("C6 with queries[2] and queries[5] both bad, queries[2] is named", () => {
    expect(position(many(7, { 2: { ...good, kind: "other" }, 5: { ...good, q: "" } }))).toBe("queries[2]");
  });
  it("C6 a good file passes, one query (L-050) and an abstain query with expect []", () => {
    expect(parseEvalFile(file([good]))).toEqual([good]);
    expect(parseEvalFile(file([{ q: "x?", kind: "abstain", expect: [] }]))).toHaveLength(1);
  });
});

describe("S1 a run over the index", () => {
  it("C7 two runs over the same file and index give equal reports, and two reports over the same rankings are equal", async () => {
    const h = await home("hash");
    const queries = readEvalFile(PT_QUERIES);
    const first = await evalRankings(sourceOf(h), queries);
    const second = await evalRankings(sourceOf(h), queries);
    expect(second).toEqual(first);
    expect(evalReport(first, queries)).toEqual(evalReport(first, queries));
    expect(evalReport(second, queries)).toEqual(evalReport(first, queries));
  });

  it.each(["hash", "off"] as const)(
    "C8 with %s the eval calls fetch 0 times and fork 0 times",
    async (embeddings) => {
      const fetched = vi.spyOn(globalThis, "fetch");
      const forked = vi.spyOn(childProcess, "fork");
      syncBuiltinESMExports();
      const h = await home(embeddings);
      const queries = readEvalFile(PT_QUERIES);
      const report = evalReport(await evalRankings(sourceOf(h), queries), queries);
      expect(Object.keys(report.modes)).toEqual(["and", "or", "semantic", "hybrid"]);
      expect(fetched).not.toHaveBeenCalled();
      expect(forked).not.toHaveBeenCalled();
    },
  );

  it("C8 with the search off the semantic row is 0.000 and the hybrid row is the recall's text-only order", async () => {
    const h = await home("off");
    expect(h.ctx.settings().memory.embeddings.enabled).toBe(false);
    const queries = readEvalFile(PT_QUERIES);
    const rankings = await evalRankings(sourceOf(h), queries);
    expect(evalReport(rankings, queries).modes.semantic).toEqual({ "1-recall@20": 0, mrr: 0, "hit@3": 0 });
    queries.forEach((query, i) => {
      // the recall's own answer lists its first 10 candidates, in its order
      const candidates = recall(h.ctx.db, h.ctx.paths, h.ctx.settings(), query.q).candidates.map((c) =>
        path.relative(h.folder, c.path),
      );
      expect(rankings.hybrid[i]!.slice(0, 10), query.q).toEqual(candidates);
      expect(rankings.semantic[i], query.q).toEqual([]);
    });
  });
});

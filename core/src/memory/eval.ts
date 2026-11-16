import path from "node:path";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import { readScope, readWorkspaceText } from "../security/safeFs.js";
import type { FileRow } from "./indexer.js";
import { recall, recallOrder } from "./recall.js";
import { anyWordSearch, everyWordSearch } from "./search.js";
import { SemanticDisabledError, type SemanticSearch } from "./semantic.js";
import type { LocalModels } from "../models/localModels.js";

/**
 * `mordomo eval` (.specs/features/cerebro-busca-significado, S1, door 6): the owner's questions, each with the files that
 * answer it, run against the local index; for each mode of the search, how many questions find an answer in the top 20,
 * how high the first one is, and how many have one in the top 3; for the questions that have no answer, how many the
 * recall says it did not find.
 */

export const EVAL_KINDS = ["single", "multi", "latest", "window", "abstain"] as const;
export type EvalKind = (typeof EVAL_KINDS)[number];

export interface EvalQuery {
  q: string;
  kind: EvalKind;
  /** Paths relative to `memory/` or to the indexed folder that holds them; empty for an `abstain` question. */
  expect: string[];
}

export interface EvalMetrics {
  "1-recall@20": number;
  mrr: number;
  "hit@3": number;
}

export type EvalMode = "and" | "or" | "semantic" | "hybrid" | "rerank";

export interface EvalReport {
  /** The modes of door 6 in its order; `rerank` only while the reranker is on and ready (AC 8). */
  modes: Record<Exclude<EvalMode, "rerank">, EvalMetrics> & { rerank?: EvalMetrics };
  abstainCorrect: { n: number; total: number };
}

/** Per mode, per question (in the file's order), the paths found, best first; and whether the recall abstained. */
export interface EvalRankings {
  and: string[][];
  or: string[][];
  semantic: string[][];
  hybrid: string[][];
  /** The `hybrid` order after the reranker; absent while it is off or not ready. */
  rerank?: string[][];
  abstained: boolean[];
}

/** How deep a ranking is read: `1-recall@20` and `mrr` look at the first 20 files. */
export const EVAL_DEPTH = 20;

/** A file that does not obey door 6: where (`file` or `queries[<i>]`) and why. */
export class EvalFormatError extends Error {
  constructor(
    readonly position: string,
    readonly reason: string,
  ) {
    super(`eval: ${position}: ${reason}`);
    this.name = "EvalFormatError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The questions of an evaluation file's text, or the first place it breaks door 6 (G9). */
export function parseEvalFile(text: string): EvalQuery[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new EvalFormatError("file", "not valid JSON");
  }
  if (!isObject(data) || data.v !== 1) throw new EvalFormatError("file", '"v" must be 1');
  if (!Array.isArray(data.queries)) throw new EvalFormatError("file", '"queries" must be a list');
  return data.queries.map((query: unknown, i: number): EvalQuery => {
    const at = `queries[${i}]`;
    if (!isObject(query)) throw new EvalFormatError(at, "must be an object");
    if (typeof query.q !== "string" || query.q.trim() === "")
      throw new EvalFormatError(at, '"q" must be a question');
    if (typeof query.kind !== "string" || !(EVAL_KINDS as readonly string[]).includes(query.kind))
      throw new EvalFormatError(at, `"kind" must be one of ${EVAL_KINDS.join(", ")}`);
    const expect = query.expect;
    if (!Array.isArray(expect) || !expect.every((p) => typeof p === "string" && p.trim() !== ""))
      throw new EvalFormatError(at, '"expect" must be a list of paths');
    if (query.kind === "abstain" && expect.length > 0)
      throw new EvalFormatError(at, '"expect" must be empty for an abstain question');
    if (query.kind !== "abstain" && expect.length === 0)
      throw new EvalFormatError(at, '"expect" must name at least one path');
    return { q: query.q, kind: query.kind as EvalKind, expect: expect.map(normalPath) };
  });
}

/** The largest evaluation file read: far more than thousands of questions. */
const MAX_EVAL_BYTES = 10 * 1024 * 1024;

/**
 * The questions of an evaluation file on disk; a file that cannot be read is a `file` error. The file is read through
 * the workspace primitive with its own folder as the scope, so the home's `config/` and `logs/` are never read even
 * when the path names them (`homeDir`: the home; by default the file's folder).
 */
export function readEvalFile(file: string, homeDir: string = path.dirname(file)): EvalQuery[] {
  let text: string;
  try {
    const scope = readScope({ homeDir, roots: [path.dirname(path.resolve(file))] });
    text = readWorkspaceText(scope, path.resolve(file), { maxBytes: MAX_EVAL_BYTES, strict: true }).text;
  } catch (error) {
    throw new EvalFormatError("file", `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseEvalFile(text);
}

/** A relative path written with `/`, whatever the platform, and no leading `./`. */
function normalPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

/** Rounded half up to 3 decimals (G7); the tiny offset keeps 0.0005 from rounding down on its binary error. */
const round3 = (n: number): number => Math.round(n * 1000 + 1e-9) / 1000;

/**
 * The three numbers of one mode (G7): a question is found when one of its paths is in the first 20 (the first 3 for
 * `hit@3`); `mrr` is 1 / the rank of the first expected path found within 20, else 0. `abstain` questions are left out.
 */
export function evalMetrics(rankings: ReadonlyArray<readonly string[]>, queries: readonly EvalQuery[]): EvalMetrics {
  let counted = 0;
  let found = 0;
  let top3 = 0;
  let reciprocal = 0;
  queries.forEach((query, i) => {
    if (query.kind === "abstain") return;
    counted++;
    const expected = new Set(query.expect.map(normalPath));
    const rank = (rankings[i] ?? []).slice(0, EVAL_DEPTH).findIndex((p) => expected.has(normalPath(p)));
    if (rank < 0) return;
    found++;
    reciprocal += 1 / (rank + 1);
    if (rank < 3) top3++;
  });
  if (counted === 0) return { "1-recall@20": 0, mrr: 0, "hit@3": 0 };
  return { "1-recall@20": round3(found / counted), mrr: round3(reciprocal / counted), "hit@3": round3(top3 / counted) };
}

/**
 * The report of a run: the metrics of each mode in the order of door 6 and the `abstain` questions the recall answered
 * with "not found". A question the recall abstains on has an empty `hybrid` ranking (G6).
 */
export function evalReport(rankings: EvalRankings, queries: readonly EvalQuery[]): EvalReport {
  const hybrid = rankings.hybrid.map((ranking, i) => (rankings.abstained[i] ? [] : ranking));
  const rerank = rankings.rerank?.map((ranking, i) => (rankings.abstained[i] ? [] : ranking));
  const abstain = queries.map((query, i) => ({ query, abstained: rankings.abstained[i] === true }));
  return {
    modes: {
      and: evalMetrics(rankings.and, queries),
      or: evalMetrics(rankings.or, queries),
      semantic: evalMetrics(rankings.semantic, queries),
      hybrid: evalMetrics(hybrid, queries),
      ...(rerank ? { rerank: evalMetrics(rerank, queries) } : {}),
    },
    abstainCorrect: {
      n: abstain.filter((a) => a.query.kind === "abstain" && a.abstained).length,
      total: abstain.filter((a) => a.query.kind === "abstain").length,
    },
  };
}

/** What a run reads: the index, the home, the settings and the engine's semantic search; `allow` is today's policy. */
export interface EvalSource {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
  semantic: SemanticSearch;
  allow?: (row: { root: string; rel: string }) => boolean;
  /** The engine's local models: the `rerank` row runs through their reranker when it is on and ready (door 5). */
  local?: Pick<LocalModels, "reranker" | "rerank">;
}

/** How much of a candidate file the reranker reads. */
const RERANK_CHARS = 2000;

const relsOf = (files: readonly FileRow[]): string[] => files.map((file) => normalPath(file.rel));

/**
 * Each question through each mode (G6): `and` and `or` are the every-word and any-word queries of `searchFiles`,
 * `semantic` is `SemanticSearch` in `semantic` (nothing while the search is off), `hybrid` is the recall's file order
 * before opening; the recall abstains when it answers nothing.
 */
export async function evalRankings(source: EvalSource, queries: readonly EvalQuery[]): Promise<EvalRankings> {
  const { db, paths, settings, semantic, allow } = source;
  const out: EvalRankings = { and: [], or: [], semantic: [], hybrid: [], abstained: [] };
  const rerank = settings.memory.recall.rerank;
  const reranker = rerank.enabled ? (source.local?.reranker() ?? null) : null;
  if (reranker) out.rerank = [];
  const textOf = db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  for (const { q } of queries) {
    const filters = { query: q, limit: EVAL_DEPTH, ...(allow ? { allow } : {}) };
    out.and.push(relsOf(everyWordSearch(db, filters)));
    out.or.push(relsOf(anyWordSearch(db, filters)));
    try {
      out.semantic.push(relsOf(await semantic.search(filters, "semantic")));
    } catch (error) {
      if (!(error instanceof SemanticDisabledError)) throw error;
      out.semantic.push([]);
    }
    const order = recallOrder(db, paths, settings, q, EVAL_DEPTH);
    out.hybrid.push(relsOf(order));
    if (reranker && out.rerank) {
      // The best `candidates` of the fused order, reordered by the reranker's "yes" probability; the rest after them.
      // A reranker that fails or is late leaves the fused order (door 5).
      const head = order.slice(0, rerank.candidates);
      const texts = head.map((file) =>
        ((textOf.get(file.id) as { content: string } | undefined)?.content ?? "").slice(0, RERANK_CHARS),
      );
      let ranked = order;
      try {
        const scores = await source.local!.rerank(reranker, q, texts, rerank.timeoutMs);
        const sorted = head.map((file, i) => ({ file, score: scores[i]!, i })).sort((a, b) => b.score - a.score || a.i - b.i);
        ranked = [...sorted.map((s) => s.file), ...order.slice(head.length)];
      } catch {
        ranked = order;
      }
      out.rerank.push(relsOf(ranked));
    }
    out.abstained.push(recall(db, paths, settings, q).answerContext.length === 0);
  }
  return out;
}

/** Read the file, run it over the index and report: `EvalFormatError` when the file does not obey door 6. */
export async function runEval(source: EvalSource, file: string): Promise<EvalReport> {
  const queries = readEvalFile(file, source.paths.home);
  return evalReport(await evalRankings(source, queries), queries);
}

/** The text of a report (G8): one line per mode, then `abstainCorrect=<n>/<total>`. */
export function formatEvalText(report: EvalReport): string {
  const lines = Object.entries(report.modes).map(
    ([mode, m]) =>
      `${mode} 1-recall@20=${m["1-recall@20"].toFixed(3)} mrr=${m.mrr.toFixed(3)} hit@3=${m["hit@3"].toFixed(3)}`,
  );
  lines.push(`abstainCorrect=${report.abstainCorrect.n}/${report.abstainCorrect.total}`);
  return `${lines.join("\n")}\n`;
}

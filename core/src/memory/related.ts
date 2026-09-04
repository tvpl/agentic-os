import type { Db } from "../db/db.js";

/**
 * "Related by content" edges for the Second Brain (plan Onda 4).
 *
 * A dependency-free approximation of semantic similarity: every indexed file
 * becomes a sparse TF-IDF vector over its first ~20k characters (as stored in
 * the FTS table), and pairs whose cosine passes `minSim` are linked. It runs
 * over the nodes already selected for the graph, so cost is bounded by the
 * graph cap (400 by default, 4000 max) rather than the workspace size.
 *
 * The result is cached on the (id, mtime) fingerprint of the input set: the
 * canvas re-requests the graph often, the corpus changes rarely.
 */

export interface RelatedEdge {
  source: number;
  target: number;
  /** Cosine similarity in (0, 1]. */
  score: number;
  /** Up to three shared high-weight terms, for the edge's "why". */
  terms: string[];
}

export interface RelatedOptions {
  /** Neighbours kept per file (default 3). */
  topK?: number;
  /** Minimum cosine similarity (default 0.18). */
  minSim?: number;
  /** Characters of each document considered (default 20 000). */
  maxChars?: number;
  /** Terms kept per document by tf (default 80). */
  maxTerms?: number;
}

const STOP = new Set(
  (
    "a an and are as at be but by for from has have if in into is it its of on or that the this to was were will with " +
    "not no yes you your we our they their he she his her them then than so do does did done can could should would may " +
    "also just more most some such only over under out up down about after before again all any each other which who whom " +
    "what when where why how here there these those very via per etc " +
    "o a os as um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre e ou mas que se não nao sim " +
    "ao aos à às é são ser está estão foi era isso isto esse essa este esta aqui ali lá mais menos muito pouco também tambem " +
    "como quando onde porque porquê quem qual quais ele ela eles elas eu tu nós nos vós vocês voce você me te seu sua seus suas " +
    "meu minha meus minhas nosso nossa ja já até ate pelo pela pelos pelas cada todo toda todos todas outro outra outros outras " +
    "md txt http https www com org true false null undefined"
  ).split(/\s+/),
);

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu;

/** Lower-cased alphabetic tokens of 3+ characters minus stop words. Exported for tests. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.length > 40 || STOP.has(tok) || /^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

interface Doc {
  id: number;
  /** term → weight (unit-normalised). */
  vec: Map<string, number>;
}

function termFrequencies(text: string, maxTerms: number): Map<string, number> {
  const tf = new Map<string, number>();
  for (const tok of tokenize(text)) tf.set(tok, (tf.get(tok) ?? 0) + 1);
  if (tf.size <= maxTerms) return tf;
  return new Map([...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxTerms));
}

/** Pure core: documents in → edges out. Exported for tests. */
export function relatedFromTexts(
  docs: ReadonlyArray<{ id: number; text: string }>,
  opts: RelatedOptions = {},
): RelatedEdge[] {
  const topK = opts.topK ?? 3;
  const minSim = opts.minSim ?? 0.18;
  const maxTerms = opts.maxTerms ?? 80;
  const n = docs.length;
  if (n < 2) return [];

  const tfs = docs.map((d) => termFrequencies(d.text, maxTerms));
  const df = new Map<string, number>();
  for (const tf of tfs) for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);

  const vecs: Doc[] = [];
  const postings = new Map<string, Array<[number, number]>>();
  tfs.forEach((tf, i) => {
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of tf) {
      const d = df.get(term) ?? 1;
      if (d >= n * 0.6 && n > 4) continue; // appears almost everywhere: no signal
      const w = (1 + Math.log(count)) * Math.log(1 + n / d);
      vec.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, w] of vec) {
      const u = w / norm;
      vec.set(term, u);
      const list = postings.get(term) ?? [];
      list.push([i, u]);
      postings.set(term, list);
    }
    vecs.push({ id: docs[i]!.id, vec });
  });

  // Sparse dot products through the inverted index; each pair once (i < j).
  const sims = new Map<number, Map<number, number>>();
  for (const list of postings.values()) {
    if (list.length < 2 || list.length > n * 0.6) continue;
    for (let a = 0; a < list.length; a++) {
      const [i, wi] = list[a]!;
      for (let b = a + 1; b < list.length; b++) {
        const [j, wj] = list[b]!;
        const row = sims.get(i) ?? new Map<number, number>();
        row.set(j, (row.get(j) ?? 0) + wi * wj);
        sims.set(i, row);
      }
    }
  }

  // Top-K per node (symmetric): keep a pair when it is in either side's top-K.
  const best = new Map<number, Array<[number, number]>>();
  const push = (i: number, j: number, s: number) => {
    const list = best.get(i) ?? [];
    list.push([j, s]);
    best.set(i, list);
  };
  for (const [i, row] of sims) {
    for (const [j, s] of row) {
      if (s < minSim) continue;
      push(i, j, s);
      push(j, i, s);
    }
  }
  const keep = new Set<string>();
  for (const [i, list] of best) {
    list.sort((a, b) => b[1] - a[1]);
    for (const [j] of list.slice(0, topK)) keep.add(i < j ? `${i}:${j}` : `${j}:${i}`);
  }

  const out: RelatedEdge[] = [];
  for (const key of keep) {
    const [i, j] = key.split(":").map(Number) as [number, number];
    const s = sims.get(i)?.get(j) ?? 0;
    const vi = vecs[i]!.vec;
    const vj = vecs[j]!.vec;
    const shared: Array<[string, number]> = [];
    for (const [term, w] of vi) {
      const wj = vj.get(term);
      if (wj !== undefined) shared.push([term, w * wj]);
    }
    shared.sort((a, b) => b[1] - a[1]);
    out.push({
      source: vecs[i]!.id,
      target: vecs[j]!.id,
      score: Math.round(s * 1000) / 1000,
      terms: shared.slice(0, 3).map(([t]) => t),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

const cache = new Map<string, RelatedEdge[]>();
const CACHE_MAX = 8;

/**
 * Related edges among the given files, computed from the indexed content and
 * memoised on the (id, mtime) fingerprint of the set.
 */
export function relatedEdges(
  db: Db,
  files: ReadonlyArray<{ id: number; mtime: number }>,
  opts: RelatedOptions = {},
): RelatedEdge[] {
  if (files.length < 2) return [];
  const key = `${opts.topK ?? ""}|${opts.minSim ?? ""}|${files.map((f) => `${f.id}@${f.mtime}`).join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const maxChars = opts.maxChars ?? 20_000;
  const docs: Array<{ id: number; text: string }> = [];
  const ids = files.map((f) => f.id);
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = db
      .prepare(
        `SELECT rowid AS id, name, substr(content, 1, ${maxChars}) AS content FROM files_fts WHERE rowid IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as Array<{ id: number; name: string; content: string | null }>;
    for (const r of rows) {
      const body = r.content ?? "";
      if (body.trim().length < 40) continue; // binaries and stubs carry no signal
      docs.push({ id: r.id, text: `${r.name}\n${body}` });
    }
  }
  const out = relatedFromTexts(docs, opts);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}

/** Test hook: drop the memo (the fingerprint already changes with mtime, this is for isolation). */
export function clearRelatedCache(): void {
  cache.clear();
}

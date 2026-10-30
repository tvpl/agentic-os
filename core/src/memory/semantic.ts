import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { chooseProvider, type EmbeddingProvider } from "./embeddings.js";
import { fileRowFromDb } from "./indexer.js";
import {
  admits,
  searchFiles,
  searchFilters,
  searchHitOf,
  type SearchFilters,
  type SearchHit,
  type SearchVia,
} from "./search.js";
import { VectorIndex, countVectors, storedSemanticError, type VectorBackend, type VectorLoader } from "./vectors.js";

/**
 * The semantic half of the search and its fusion with the words (.specs/features/cerebro-v2, S4): reciprocal rank
 * fusion over the BM25 order and the cosine order. Off by default; with `memory.embeddings.enabled` off nothing here
 * loads an extension, computes a vector or opens a connection.
 */

/** Reciprocal rank fusion's constant: how fast a lower rank stops mattering. */
export const RRF_K = 60;
/** How deep each list goes before they are fused. */
const DEPTH = 50;

export type SearchMode = "auto" | "text" | "semantic";

/** Raised for `mode=semantic` while the semantic search is off or has no provider it may use (`409 semantic_disabled`). */
export class SemanticDisabledError extends Error {
  readonly statusCode = 409;
  readonly code = "semantic_disabled";
  constructor(reason: string) {
    super(`Semantic search is not on: ${reason}. Turn on memory.embeddings in the settings.`);
    this.name = "SemanticDisabledError";
  }
}

export interface SemanticStatus {
  enabled: boolean;
  /** `hash-v1:256`, `http:<model>:<dim>`; null when off or blocked. */
  provider: string | null;
  /** Where the cosine is computed; null while the search is off (nothing is loaded then). */
  backend: VectorBackend | null;
  vectors: number;
  /** Why an enabled search has no provider it may use (the endpoint policy), or null. */
  blocked: string | null;
  /** How the last attempt to embed failed, or null. */
  error: string | null;
}

/** Fuse ranked lists of file ids: a file's score is the sum of `1 / (k + rank)` over the lists it is in; ties go to the lower id. */
export function fuse(lists: ReadonlyArray<readonly number[]>, k: number = RRF_K): Array<{ id: number; score: number }> {
  const scores = new Map<number, number>();
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export class SemanticSearch {
  private readonly vectors: VectorIndex;
  /** The last failure to embed a QUERY (a down endpoint): per instance, cleared by the next success. */
  private queryError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly getSettings: () => Settings,
    loader?: VectorLoader,
  ) {
    this.vectors = new VectorIndex(db, loader);
  }

  /** The provider the settings ask for, if it may be used (`null` while off or blocked). */
  private provider(): EmbeddingProvider | null {
    const choice = chooseProvider(this.getSettings().memory.embeddings);
    return choice.state === "ready" ? choice.provider : null;
  }

  status(): SemanticStatus {
    const config = this.getSettings().memory.embeddings;
    const choice = chooseProvider(config);
    return {
      enabled: config.enabled,
      provider: choice.state === "ready" ? choice.provider.id : null,
      backend: choice.state === "ready" ? this.vectors.backend() : null,
      vectors: choice.state === "ready" ? countVectors(this.db) : 0,
      blocked: choice.state === "blocked" ? choice.reason : null,
      error: this.queryError ?? storedSemanticError(this.db)?.message ?? null,
    };
  }

  /**
   * `text`: the words only. `semantic`: the vectors only (409 when the search is off). `auto`: both fused when the
   * search is on and has vectors, else the words, unchanged. A provider that fails to embed the question never fails
   * the search: it falls back to the words and says so in `status().error`.
   */
  async search(filters: SearchFilters, mode: SearchMode = "auto"): Promise<SearchHit[]> {
    const limit = Math.min(filters.limit ?? 50, 200);
    const config = this.getSettings().memory.embeddings;
    if (mode === "text") return searchFiles(this.db, filters);
    const choice = chooseProvider(config);
    if (choice.state !== "ready") {
      if (mode === "semantic")
        throw new SemanticDisabledError(choice.state === "blocked" ? choice.reason : "memory.embeddings.enabled is off");
      return searchFiles(this.db, filters);
    }
    const provider = choice.provider;
    const question = filters.query.trim();
    const text = question === "" ? [] : searchFiles(this.db, { ...filters, limit: DEPTH });
    if (question === "" || countVectors(this.db) === 0) return mode === "semantic" ? [] : searchFiles(this.db, filters);

    let ranked: Array<{ id: number; similarity: number }> = [];
    try {
      const [vector] = await provider.embed([question], new AbortController().signal);
      this.queryError = null;
      if (vector && vector.some((n) => n !== 0)) {
        const { clauses, params } = searchFilters(filters);
        ranked = this.vectors.rank(
          vector,
          provider,
          { sql: clauses.map((clause) => `AND ${clause}`).join(" "), params },
          DEPTH,
        );
      }
    } catch (error) {
      this.queryError = error instanceof Error ? error.message : String(error);
      if (mode === "semantic") return [];
      return searchFiles(this.db, filters);
    }

    const byId = new Map<number, SearchHit>();
    for (const hit of text) byId.set(hit.id, hit);
    const semanticIds = ranked.map((r) => r.id);
    const missing = semanticIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const rows = this.db
        .prepare(`SELECT * FROM files WHERE id IN (${missing.map(() => "?").join(",")})`)
        .all(...missing) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const file = fileRowFromDb(row);
        if (admits(filters, file)) byId.set(file.id, searchHitOf(file, { snippet: null, score: 0, via: "semantic" }));
      }
    }
    const textIds = text.map((hit) => hit.id);
    const lists = mode === "semantic" ? [semanticIds] : [textIds, semanticIds];
    const inText = new Set(mode === "semantic" ? [] : textIds);
    const inSemantic = new Set(semanticIds);
    return fuse(lists)
      .filter(({ id }) => byId.has(id))
      .slice(0, limit)
      .map(({ id, score }) => {
        const hit = byId.get(id)!;
        const via: SearchVia = inText.has(id) && inSemantic.has(id) ? "both" : inSemantic.has(id) ? "semantic" : "text";
        return { ...hit, score, via };
      });
  }
}

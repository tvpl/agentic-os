import { createRequire } from "node:module";
import type { Db } from "../db/db.js";
import {
  EmbeddingError,
  blobToVector,
  chooseProvider,
  vectorToBlob,
  type EmbeddingProvider,
  type EmbeddingSettings,
} from "./embeddings.js";

/**
 * The vectors of the index (.specs/features/cerebro-v2, S4): which files owe one, computing them, and ranking by
 * cosine distance. Ranking uses sqlite-vec's `vec_distance_cosine` when the extension loads and the same cosine in
 * JavaScript when it does not (Windows ARM, musl, a package that is missing): the two give the same order. Nothing
 * here loads an extension, opens a connection or computes anything unless `memory.embeddings.enabled` is on.
 */

export type VectorBackend = "sqlite-vec" | "js";

/** Loads the sqlite-vec extension into a connection; throws when it cannot. Replaceable, for tests and packagers. */
export type VectorLoader = (db: Db) => void;

/** The loader of the `sqlite-vec` package, found the way Node finds any package from this file (dev tree, installer). */
export const loadSqliteVec: VectorLoader = (db) => {
  const require = createRequire(import.meta.url);
  (require("sqlite-vec") as { load: (db: Db) => void }).load(db);
};

/** The files whose text is embedded: Markdown and plain text, which is what a note is. */
const EMBEDDED_EXTENSIONS = "('.md', '.markdown', '.txt')";
const SEMANTIC_ERROR_KEY = "index.semantic_error";
const BATCH_SIZE = 200;
const hasWords = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

export interface SemanticError {
  at: number;
  kind: string;
  message: string;
}

export function storedSemanticError(db: Db): SemanticError | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SEMANTIC_ERROR_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SemanticError;
  } catch {
    return null;
  }
}

function setSemanticError(db: Db, error: SemanticError | null): void {
  if (error === null) db.prepare("DELETE FROM meta WHERE key = ?").run(SEMANTIC_ERROR_KEY);
  else
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      SEMANTIC_ERROR_KEY,
      JSON.stringify(error),
    );
}

export function countVectors(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM file_vectors").get() as { c: number }).c;
}

export interface EmbedPendingOptions {
  /** Aborts a request in flight. */
  signal?: AbortSignal;
  /** True once the pass was asked to stop: checked between batches. */
  shouldStop?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Bring the vectors up to date: one for every Markdown or text file that has none, has one from another provider (or
 * length), or whose file changed since (size, mtime). Embeddings off: every vector goes. A failure of the provider
 * ends the phase, not the pass: what was embedded stays, the failure is remembered (`semantic.error`), the next pass
 * does the rest. Returns how many were embedded.
 */
export async function embedPending(
  db: Db,
  config: EmbeddingSettings,
  options: EmbedPendingOptions = {},
): Promise<{ embedded: number; stopped: boolean }> {
  const choice = chooseProvider(config);
  if (choice.state !== "ready") {
    // Off, or on but without an endpoint it may use: no vector survives that nobody can refresh.
    if (choice.state === "off") db.prepare("DELETE FROM file_vectors").run();
    setSemanticError(db, null);
    return { embedded: 0, stopped: false };
  }
  const provider = choice.provider;
  // A vector of a file that is gone, or of a kind that is not embedded, is not kept.
  db.prepare(`DELETE FROM file_vectors WHERE file_id NOT IN (SELECT id FROM files WHERE ext IN ${EMBEDDED_EXTENSIONS})`).run();

  const owed = db
    .prepare(
      `SELECT f.id AS id, f.mtime AS mtime, f.size AS size
         FROM files f LEFT JOIN file_vectors v ON v.file_id = f.id
        WHERE f.ext IN ${EMBEDDED_EXTENSIONS}
          AND (v.file_id IS NULL OR v.provider != ? OR v.dim != ? OR v.mtime != f.mtime OR v.size != f.size)
        ORDER BY f.id`,
    )
    .all(provider.id, provider.dim) as Array<{ id: number; mtime: number; size: number }>;
  const textOf = db.prepare("SELECT substr(content, 1, ?) AS text FROM files_fts WHERE rowid = ?");
  const write = db.prepare(
    `INSERT INTO file_vectors (file_id, provider, dim, vec, mtime, size) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_id) DO UPDATE SET provider = excluded.provider, dim = excluded.dim, vec = excluded.vec,
       mtime = excluded.mtime, size = excluded.size`,
  );
  const drop = db.prepare("DELETE FROM file_vectors WHERE file_id = ?");
  const size = provider.local ? BATCH_SIZE : 16;
  const signal = options.signal ?? new AbortController().signal;
  let embedded = 0;
  for (let from = 0; from < owed.length; from += size) {
    if (options.shouldStop?.()) return { embedded, stopped: true };
    const batch = owed.slice(from, from + size).map((row) => ({
      ...row,
      text: (textOf.get(provider.maxChars, row.id) as { text: string } | undefined)?.text ?? "",
    }));
    const sendable = batch.filter((row) => hasWords(row.text));
    let vectors: Float32Array[];
    try {
      vectors = sendable.length > 0 ? await provider.embed(sendable.map((row) => row.text), signal) : [];
    } catch (error) {
      if (signal.aborted) return { embedded, stopped: true };
      const kind = error instanceof EmbeddingError ? error.kind : "network";
      setSemanticError(db, { at: Date.now(), kind, message: error instanceof Error ? error.message : String(error) });
      return { embedded, stopped: false };
    }
    db.transaction(() => {
      sendable.forEach((row, i) => {
        const vector = vectors[i]!;
        // A text of nothing but stop words has no direction: no vector, and none left over from an older text.
        if (vector.every((n) => n === 0)) drop.run(row.id);
        else write.run(row.id, provider.id, provider.dim, vectorToBlob(vector), row.mtime, row.size);
      });
      for (const row of batch) if (!hasWords(row.text)) drop.run(row.id);
    })();
    embedded += sendable.length;
    options.onProgress?.(Math.min(from + size, owed.length), owed.length);
  }
  setSemanticError(db, null);
  return { embedded, stopped: false };
}

// -------------------------------------------------------------------------------------------------- ranking

export interface RankFilters {
  /** `AND f.area = ?` and the like, with their parameters (`searchFilters`). */
  sql: string;
  params: unknown[];
}

export interface Ranked {
  id: number;
  /** Cosine similarity, 1 at best. */
  similarity: number;
}

/** Distances that differ by less than this are ties, and a tie goes to the lower file id on both backends. */
const TIE = 1e-6;
const ROUND = 1 / TIE;

/**
 * The per-engine door to ranking. It remembers whether sqlite-vec loaded into THIS connection (an extension is
 * loaded per connection, so the answer is a property of the instance, never of the module).
 */
export class VectorIndex {
  private state: VectorBackend | "untried" = "untried";
  private failure: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly loader: VectorLoader = loadSqliteVec,
  ) {}

  /** `js` after a loader that threw; the reason stays in `unavailable()`. */
  backend(): VectorBackend {
    if (this.state === "untried") {
      try {
        this.loader(this.db);
        this.db.prepare("SELECT vec_version() AS v").get();
        this.state = "sqlite-vec";
      } catch (error) {
        this.state = "js";
        this.failure = error instanceof Error ? error.message : String(error);
      }
    }
    return this.state;
  }

  /** Why sqlite-vec is not in use, or null. */
  unavailable(): string | null {
    this.backend();
    return this.failure;
  }

  /**
   * The files nearest to `query` among the vectors of `provider`, best first, at most `limit`, those under
   * `minSimilarity` left out. `filters` narrows the files (area, extension, folder, tag, date).
   */
  rank(
    query: Float32Array,
    provider: Pick<EmbeddingProvider, "id" | "dim"> & { minSimilarity?: number },
    filters: RankFilters,
    limit: number,
  ): Ranked[] {
    const params = [...filters.params];
    const scope = `v.provider = ? AND v.dim = ? ${filters.sql}`;
    const rows: Array<{ id: number; d: number }> = [];
    if (this.backend() === "sqlite-vec") {
      const hits = this.db
        .prepare(
          `SELECT v.file_id AS id, vec_distance_cosine(v.vec, ?) AS d
             FROM file_vectors v JOIN files f ON f.id = v.file_id
            WHERE ${scope} ORDER BY d LIMIT ?`,
        )
        .all(vectorToBlob(query), provider.id, provider.dim, ...params, limit + 64) as Array<{ id: number; d: number | null }>;
      for (const hit of hits) if (hit.d !== null && Number.isFinite(hit.d)) rows.push({ id: hit.id, d: hit.d });
    } else {
      const stmt = this.db.prepare(
        `SELECT v.file_id AS id, v.vec AS vec FROM file_vectors v JOIN files f ON f.id = v.file_id WHERE ${scope}`,
      );
      for (const row of stmt.iterate(provider.id, provider.dim, ...params) as Iterable<{ id: number; vec: Buffer }>) {
        const vector = blobToVector(row.vec);
        let dot = 0;
        for (let i = 0; i < query.length; i++) dot += query[i]! * vector[i]!;
        rows.push({ id: row.id, d: 1 - dot });
      }
    }
    const floor = provider.minSimilarity ?? 0;
    return rows
      .map((row) => ({ id: row.id, similarity: 1 - row.d, key: Math.round(row.d * ROUND) }))
      .filter((row) => row.similarity >= floor)
      .sort((a, b) => a.key - b.key || a.id - b.id)
      .slice(0, limit)
      .map(({ id, similarity }) => ({ id, similarity }));
  }
}

import { createRequire } from "node:module";
import type { Db } from "../db/db.js";
import { EMBEDDED_EXTENSIONS, embeddedText, sectionRows } from "./sections.js";
import {
  EmbeddingError,
  blobToVector,
  chooseProvider,
  vectorToBlob,
  type EmbeddingProvider,
  type EmbeddingSettings,
  type LocalEmbedding,
} from "./embeddings.js";

/**
 * The vectors of the index (.specs/features/cerebro-v2, S4; one per section since cerebro-busca-significado, door 1):
 * which sections owe one, computing them, and ranking by cosine distance. Ranking uses sqlite-vec's `vec_distance_cosine` when the extension loads and the same cosine in
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

const SEMANTIC_ERROR_KEY = "index.semantic_error";
const BATCH_SIZE = 200;
/** A child process of the local models that ends unasked is started again at most this many times in one pass (AC 36). */
export const LOCAL_RESTARTS = 3;
const EMBEDDED = `(${EMBEDDED_EXTENSIONS.map((ext) => `'${ext}'`).join(", ")})`;

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

/**
 * What the status counts (G14): the files with at least one section row, and the section rows; with `allow`, only those
 * of files the caller may see (a device is not told of the others).
 */
export function countVectors(
  db: Db,
  allow?: (row: { root: string; rel: string }) => boolean,
): { files: number; sections: number } {
  if (!allow)
    return db
      .prepare("SELECT COUNT(DISTINCT file_id) AS files, COUNT(*) AS sections FROM section_vectors")
      .get() as { files: number; sections: number };
  const count = { files: 0, sections: 0 };
  for (const row of db
    .prepare("SELECT f.root, f.rel, COUNT(*) AS n FROM section_vectors v JOIN files f ON f.id = v.file_id GROUP BY v.file_id")
    .iterate() as IterableIterator<{ root: string; rel: string; n: number }>)
    if (allow(row)) {
      count.files++;
      count.sections += row.n;
    }
  return count;
}

export interface EmbedPendingOptions {
  /** Aborts a request in flight. */
  signal?: AbortSignal;
  /** True once the pass was asked to stop: checked between batches. */
  shouldStop?: () => boolean;
  onProgress?: (done: number, total: number) => void;
  /**
   * Today's policy over a stored row (`MemoryIndexer.rowFilter`). A row it refuses is not embedded: with an endpoint the
   * text leaves the machine, and a row that a new exclude or a private folder now covers stays in `files` until a full
   * pass prunes it - a pass over a few paths (a note just saved) does not.
   */
  allow?: (row: { root: string; rel: string }) => boolean;
  /** The provider to embed with in place of the one the settings name (a test's recording provider). */
  provider?: EmbeddingProvider;
  /** The engine's local models, for `provider: "local"` (door 2). */
  local?: LocalEmbedding;
}

/**
 * Bring the vectors up to date, a section at a time (door 1): every section of a Markdown or text file that has no row,
 * or whose file has a row from another provider (or length) or changed since (size, mtime), is embedded again, and
 * the rows of the sections it no longer has go. Embeddings off: every row goes. Each batch is written in one
 * transaction. A failure of the provider ends the phase, not the pass: what was embedded stays, the failure is
 * remembered (`semantic.error`), the next pass does the rest. Returns how many sections were embedded.
 */
export async function embedPending(
  db: Db,
  config: EmbeddingSettings,
  options: EmbedPendingOptions = {},
): Promise<{ embedded: number; stopped: boolean }> {
  const choice = chooseProvider(config, options.local);
  if (choice.state !== "ready") {
    // Off, or on but without an endpoint it may use: no vector survives that nobody can refresh.
    if (choice.state === "off") db.prepare("DELETE FROM section_vectors").run();
    setSemanticError(db, null);
    return { embedded: 0, stopped: false };
  }
  const provider = options.provider ?? choice.provider;
  // A vector of a file that is gone, or of a kind that is not embedded, is not kept.
  db.prepare(`DELETE FROM section_vectors WHERE file_id NOT IN (SELECT id FROM files WHERE ext IN ${EMBEDDED})`).run();

  const due = db
    .prepare(
      `SELECT f.id AS id, f.mtime AS mtime, f.size AS size, f.root AS root, f.rel AS rel, f.ext AS ext,
              f.area AS area, f.title AS title
         FROM files f
        WHERE f.ext IN ${EMBEDDED}
          AND (NOT EXISTS (SELECT 1 FROM section_vectors v WHERE v.file_id = f.id)
               OR EXISTS (SELECT 1 FROM section_vectors v WHERE v.file_id = f.id
                          AND (v.provider != ? OR v.dim != ? OR v.mtime != f.mtime OR v.size != f.size)))
        ORDER BY f.id`,
    )
    .all(provider.id, provider.dim) as Array<{
    id: number;
    mtime: number;
    size: number;
    root: string;
    rel: string;
    ext: string;
    area: string | null;
    title: string | null;
  }>;
  const owed = options.allow ? due.filter((row) => options.allow!(row)) : due;
  const textOf = db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const write = db.prepare(
    `INSERT INTO section_vectors (file_id, ord, heading, start_line, end_line, provider, dim, vec, mtime, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_id, ord) DO UPDATE SET heading = excluded.heading, start_line = excluded.start_line,
       end_line = excluded.end_line, provider = excluded.provider, dim = excluded.dim, vec = excluded.vec,
       mtime = excluded.mtime, size = excluded.size`,
  );
  const drop = db.prepare("DELETE FROM section_vectors WHERE file_id = ? AND ord = ?");
  const dropFrom = db.prepare("DELETE FROM section_vectors WHERE file_id = ? AND ord >= ?");
  const settle = db.prepare("UPDATE section_vectors SET size = ? WHERE file_id = ?");

  // Every owed section, file after file; the last section of a file carries how many the file has, so the rows past
  // it go with the batch that writes it. A file with no section left loses its rows at once.
  const sections: Array<{
    fileId: number;
    ord: number;
    heading: string;
    startLine: number;
    endLine: number;
    mtime: number;
    size: number;
    text: string;
    count: number | null;
  }> = [];
  const emptied: number[] = [];
  for (const file of owed) {
    const content = (textOf.get(file.id) as { content: string } | undefined)?.content ?? "";
    const rows = sectionRows(content, file.ext);
    if (rows.length === 0) emptied.push(file.id);
    rows.forEach((row, i) =>
      sections.push({
        fileId: file.id,
        ord: row.ord,
        heading: row.heading,
        startLine: row.startLine,
        endLine: row.endLine,
        mtime: file.mtime,
        size: file.size,
        text: embeddedText({ area: file.area, title: file.title, path: row.path }, row.body, provider.maxChars),
        count: i === rows.length - 1 ? rows.length : null,
      }),
    );
  }
  if (emptied.length > 0) db.transaction(() => emptied.forEach((id) => dropFrom.run(id, 0)))();

  const size = provider.batch ?? (provider.local ? BATCH_SIZE : 16);
  const signal = options.signal ?? new AbortController().signal;
  let embedded = 0;
  // The local child that ended unasked (AC 36, G19): its batch is owed to the next pass, the error is kept, and the
  // next batch starts it again, at most `LOCAL_RESTARTS` times; then the phase stops.
  let crashes = 0;
  const owedFiles = new Set<number>();
  const owe = () => {
    if (owedFiles.size === 0) return;
    const mark = db.prepare("UPDATE section_vectors SET size = -1 WHERE file_id = ?");
    db.transaction(() => owedFiles.forEach((id) => mark.run(id)))();
  };
  for (let from = 0; from < sections.length; from += size) {
    if (options.shouldStop?.()) return owe(), { embedded, stopped: true };
    const batch = sections.slice(from, from + size);
    let vectors: Float32Array[];
    try {
      vectors = await provider.embed(
        batch.map((row) => row.text),
        signal,
      );
    } catch (error) {
      if (signal.aborted) return owe(), { embedded, stopped: true };
      const kind = error instanceof EmbeddingError ? error.kind : "network";
      setSemanticError(db, { at: Date.now(), kind, message: error instanceof Error ? error.message : String(error) });
      if (kind === "local_crashed" && ++crashes <= LOCAL_RESTARTS) {
        for (const row of batch) owedFiles.add(row.fileId);
        continue;
      }
      return owe(), { embedded, stopped: false };
    }
    // A file whose last section is in a later batch is written with size -1 until that batch settles it: a pass that
    // ends before then leaves the file owed (its rows do not match it), not complete with sections missing.
    const completes = new Set(batch.filter((row) => row.count !== null).map((row) => row.fileId));
    db.transaction(() => {
      batch.forEach((row, i) => {
        const vector = vectors[i]!;
        // A text of nothing but stop words has no direction: no row, and none left over from an older text.
        if (vector.every((n) => n === 0)) drop.run(row.fileId, row.ord);
        else
          write.run(
            row.fileId,
            row.ord,
            row.heading,
            row.startLine,
            row.endLine,
            provider.id,
            provider.dim,
            vectorToBlob(vector),
            row.mtime,
            completes.has(row.fileId) ? row.size : -1,
          );
        if (row.count !== null) {
          dropFrom.run(row.fileId, row.count);
          settle.run(row.size, row.fileId);
        }
      });
    })();
    embedded += batch.length;
    options.onProgress?.(Math.min(from + size, sections.length), sections.length);
  }
  owe();
  // A pass that recovered from a crash keeps its error: only a clean pass clears it (G19).
  if (crashes === 0) setSemanticError(db, null);
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
  /** Cosine similarity of the file's best section, 1 at best. */
  similarity: number;
  /** That section: its place in the file, its heading path and its first body line. */
  ord: number;
  section: string;
  line: number;
}

/** Distances that differ by less than this are ties, and a tie goes to the lower file id (then `ord`) on both backends. */
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
   * The files nearest to `query` among the section vectors of `provider`, best first, at most `limit`, those under
   * `minSimilarity` left out. A file's similarity is its best section's, and the hit names that section. `filters`
   * narrows the files (area, extension, folder, tag, date). Every row is read (O(sections)); distances within 1e-6 are
   * ties, and a tie goes to the lower file id, then the lower `ord`, on both backends.
   */
  rank(
    query: Float32Array,
    provider: Pick<EmbeddingProvider, "id" | "dim"> & { minSimilarity?: number },
    filters: RankFilters,
    limit: number,
  ): Ranked[] {
    const params = [...filters.params];
    const scope = `v.provider = ? AND v.dim = ? ${filters.sql}`;
    const rows: Array<{ id: number; ord: number; heading: string; line: number; d: number }> = [];
    type Row = { id: number; ord: number; heading: string; line: number };
    if (this.backend() === "sqlite-vec") {
      const hits = this.db
        .prepare(
          `SELECT v.file_id AS id, v.ord AS ord, v.heading AS heading, v.start_line AS line,
                  vec_distance_cosine(v.vec, ?) AS d
             FROM section_vectors v JOIN files f ON f.id = v.file_id
            WHERE ${scope}`,
        )
        .all(vectorToBlob(query), provider.id, provider.dim, ...params) as Array<Row & { d: number | null }>;
      for (const hit of hits) if (hit.d !== null && Number.isFinite(hit.d)) rows.push({ ...hit, d: hit.d });
    } else {
      const stmt = this.db.prepare(
        `SELECT v.file_id AS id, v.ord AS ord, v.heading AS heading, v.start_line AS line, v.vec AS vec
           FROM section_vectors v JOIN files f ON f.id = v.file_id WHERE ${scope}`,
      );
      for (const row of stmt.iterate(provider.id, provider.dim, ...params) as Iterable<Row & { vec: Buffer }>) {
        const vector = blobToVector(row.vec);
        let dot = 0;
        for (let i = 0; i < query.length; i++) dot += query[i]! * vector[i]!;
        rows.push({ id: row.id, ord: row.ord, heading: row.heading, line: row.line, d: 1 - dot });
      }
    }
    const floor = provider.minSimilarity ?? 0;
    const sorted = rows
      .map((row) => ({ ...row, similarity: 1 - row.d, key: Math.round(row.d * ROUND) }))
      .filter((row) => row.similarity >= floor)
      .sort((a, b) => a.key - b.key || a.id - b.id || a.ord - b.ord);
    // The first section of a file in that order is its best.
    const out: Ranked[] = [];
    const seen = new Set<number>();
    for (const row of sorted) {
      if (out.length >= limit) break;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ id: row.id, similarity: row.similarity, ord: row.ord, section: row.heading, line: row.line });
    }
    return out;
  }
}

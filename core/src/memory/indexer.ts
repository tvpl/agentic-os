import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { IndexedFolder, Settings } from "../config/schema.js";
import type { EventBus } from "../events.js";
import { relatedFromTerms, termFrequencies } from "./related.js";
import { PathAccessError, realpathLenient } from "../security/paths.js";
import { openWorkspaceFile, readScope, statWorkspacePath, type ReadScope } from "../security/safeFs.js";
import { removeStaleSaveTemp } from "../security/safeWrite.js";
import { isBinaryBuffer, makeWorkspaceFilter } from "./excludes.js";
import { fieldsFromDb, parseInlineFields } from "./fields.js";
import { parseFrontMatter } from "./frontMatter.js";
import { extractLinks, type ParsedLink } from "./linkParser.js";
import { embedPending } from "./vectors.js";
import type { IndexPhase, IndexProgress, IndexStats } from "@mordomo/contracts";

export type { IndexProgress, IndexStats };

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".sh", ".ps1",
  ".html", ".css", ".scss", ".sql", ".xml", ".ini", ".cfg", ".conf", ".log",
]);

/**
 * Rows one write transaction of a pass carries, and files prepared between two safe points (an event-loop turn inline,
 * the pace sleep in the worker). Small on purpose: while a transaction is open it holds the database's only write
 * lock, and a writer that waits for it (the service, on its own connection) is parked inside the driver with its event
 * loop stopped. See `write` below.
 */
export const INDEX_CHUNK_SIZE = 25;
/**
 * What a wave aims to hold the write lock for. The number of files in a wave follows what the last waves cost per
 * file (a note with many distinct words costs the FTS index more), so the bound holds for the text in hand and on a
 * slow disk, not only for the one it was measured on.
 */
const WAVE_TARGET_HOLD_MS = 5;
/** Progress events of the file phases are announced at most this often (the first and last of a phase always are). */
const PROGRESS_EVERY_MS = 200;
/** A wave of big files is also cut by size: the SQL of a transaction grows with the text it stores. */
export const INDEX_WAVE_BYTES = 1_000_000;
/** Edges of `file_related` written per transaction (a row is a few microseconds). */
const RELATED_WRITE_ROWS = 500;
/**
 * How long a worker rests after a transaction, in multiples of the time the transaction held the write lock. A writer
 * that finds the lock taken polls at growing intervals (1, 2, 5, 10, 15, 20, 25 ... 100 ms) and does not queue: the
 * lock has to be free often enough for a poll to land in a gap. With the lock held for a seventh of the time or less,
 * a waiting writer gets it at its first or second poll.
 */
export const WRITE_REST_RATIO = 6;
const LAST_INDEX_KEY = "last_index";
/**
 * Which version of the link extraction the stored `note_links` come from (the first full pass after migration 20, or
 * after the version moves, fills them again from the stored text, opening no file). "2": wikilink keys are NFC and
 * Unicode lower case (`foldName`); version "1" lowered them without composing them.
 */
const NOTE_LINKS_KEY = "index.note_links";
const NOTE_LINKS_VERSION = "2";
/** When the related-by-content edges were last refreshed: the files whose terms are newer than this still owe them. */
const RELATED_AT_KEY = "index.related_at";

/** An incomplete scan cannot prove that previously indexed files disappeared. */
export class IncompleteIndexScanError extends Error {
  readonly code = "index_scan_incomplete";
  readonly statusCode = 409;
  constructor() {
    super("Index scan incomplete: a configured folder could not be read. The previous index was preserved. Check folder access or remove unavailable roots from settings, then retry.");
    this.name = "IncompleteIndexScanError";
  }
}



/** The pass was cancelled (`POST /api/memory/index/cancel`); the blocks it had committed stay. */
export class IndexCancelledError extends Error {
  readonly code = "index_cancelled";
  readonly statusCode = 409;
  constructor() {
    super("The index pass was cancelled. What it had already indexed was kept.");
    this.name = "IndexCancelledError";
  }
}

/**
 * Whatever runs a pass on behalf of `indexAllAsync` and `requestIndexPaths` when it is more than the loop below: the
 * worker host (`indexHost.ts`). Without one the pass runs in the caller's own thread.
 */
export interface IndexRunner {
  isRunning(): boolean;
  run(request: { only?: readonly string[]; onProgress?: (p: IndexProgress) => void }): Promise<IndexStats>;
}

export interface FileRow {
  id: number;
  root: string;
  path: string;
  rel: string;
  name: string;
  ext: string;
  dir: string;
  area: string | null;
  size: number;
  mtime: number;
  indexedAt: number;
  title: string | null;
  tags: string[];
  /** Dataview-style `key:: value` inline fields (markdown only). */
  fields: Record<string, string>;
}

interface Candidate {
  root: string;
  full: string;
  rel: string;
  area: string | null;
}

/** One candidate read and parsed, ready to be written (`prepareFile`, `applyFile`). */
interface PreparedFile {
  c: Candidate;
  ext: string;
  name: string;
  size: number;
  mtime: number;
  /** What `files_fts` stores (the first 200 000 characters). */
  content: string;
  title: string | null;
  tagsJson: string;
  fieldsJson: string;
  /** The JSON of the file's top terms, or null when the text is too short to carry any. */
  terms: string | null;
  noteLinks: ParsedLink[];
  markdown: boolean;
}

/**
 * Today's policy over stored rows (`MemoryIndexer.rowFilter`), for a reader that has the settings and the home but no
 * indexer (the routers): true when the row's file may still be shown.
 */
export function storedRowFilter(
  excludes: readonly string[],
  options: { homeDir: string; platform?: NodeJS.Platform },
): (row: { root: string; rel: string }) => boolean {
  const filter = makeWorkspaceFilter(excludes, options);
  const realRoots = new Map<string, string>();
  return (row) => {
    let real = realRoots.get(row.root);
    if (real === undefined) {
      real = realpathLenient(row.root);
      realRoots.set(row.root, real);
    }
    return !filter.isExcluded(row.rel, path.join(real, row.rel));
  };
}

/** Top terms of a file (first 20k chars), kept for the related-edge refresh. */
function termsOf(name: string, content: string): string | null {
  const body = content.slice(0, 20_000);
  if (body.trim().length < 40) return null;
  return JSON.stringify([...termFrequencies(`${name}\n${body}`, 80).entries()]);
}

/**
 * Incremental workspace indexer.
 * - honours the exclusion policy (settings excludes, hard blocklist, secret
 *   files) BEFORE reading anything;
 * - never moves, renames or rewrites indexed files;
 * - re-reads content only when size/mtime (or owning root/area) changed;
 * - binary detection is content-based (NUL byte in the first 8 KiB);
 * - links are extracted per Markdown file when it is (re)indexed and stored
 *   in `note_links` with the target as text, resolved when somebody reads them,
 *   so a file that appears later is linked without its sources being re-read;
 * - every chunk of upserts/removals runs in one transaction;
 * - nested indexed roots are deterministic: the longest root owns the file.
 *
 * `indexAll()` is synchronous (CLI, tests); `indexAllAsync()` runs the same
 * steps in chunks, yielding to the event loop between them and emitting
 * `index.progress` / `index.finished` on the shared event bus.
 */
export class MemoryIndexer {
  private running = false;
  private inFlight: Promise<IndexStats> | null = null;
  private implicitRoots: IndexedFolder[] = [];
  /** Ids added or updated during the current pass (their related edges are refreshed at the end). */
  private touched = new Set<number>();
  /** Paths asked for through `requestIndexPaths` that no pass has taken yet, and the run that will take them. */
  private readonly requested = new Set<string>();
  private requestedRun: Promise<void> | null = null;
  private runner: IndexRunner | null = null;
  private cancelRequested = false;
  /** How long the write transactions since the last `takeWriteMs` held the write lock. */
  private writeMs = 0;
  /** Runs when a pass that changed rows ends, before `index.finished` is announced (`setAfterPass`). */
  private afterPass: ((stats: IndexStats) => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly getSettings: () => Settings,
    /** `homeDir`: the MordomoOS home, whose `config/` and `logs/` are never indexed (required: no indexer without it). */
    private readonly filterOptions: { homeDir: string; platform?: NodeJS.Platform },
    /** Where a pass is announced (`index.progress`, `index.finished`, `index.failed`); without one it is silent. */
    private readonly bus?: EventBus,
  ) {}

  /**
   * A test over stored rows, for readers of old data (search, recall): true when
   * today's policy still lets the row's file be shown. The index may hold rows
   * written before a path became private (the home's `config/`, a new exclude).
   */
  rowFilter(): (row: { root: string; rel: string }) => boolean {
    return storedRowFilter(this.getSettings().excludes, this.filterOptions);
  }

  /**
   * Drop rows that today's policy would not index (see `rowFilter`), with their
   * links and terms. An index built before the home's `config/` was private can
   * hold token-bearing rows until the next full pass; this removes them at once.
   */
  purgeExcluded(): number {
    const allowed = this.rowFilter();
    const rows = this.db.prepare("SELECT id, path, root, rel FROM files").all() as Array<{
      id: number;
      path: string;
      root: string;
      rel: string;
    }>;
    const doomed = rows.filter((row) => !allowed(row));
    if (doomed.length === 0) return 0;
    const stats: IndexStats = {
      scanned: 0, added: 0, updated: 0, removed: 0, skippedExcluded: 0, skippedBinary: 0, related: 0, durationMs: 0,
    };
    this.write(() => {
      for (const row of doomed) this.removeFile(row.id, stats);
    });
    return stats.removed;
  }

  /**
   * Roots indexed in addition to `settings.indexedFolders` (the MordomoOS
   * `memory/` folder — journal, MEMORY.md — is registered this way by
   * `installJournalHooks`). Same exclusion policy, same incremental rules.
   */
  addImplicitRoot(folder: IndexedFolder): void {
    const resolved = path.resolve(folder.path);
    if (this.implicitRoots.some((r) => path.resolve(r.path) === resolved)) return;
    this.implicitRoots.push({ ...folder, path: resolved });
  }

  listImplicitRoots(): IndexedFolder[] {
    return this.implicitRoots.map((r) => ({ ...r }));
  }

  /** True while an index run (sync or async) is in progress. */
  isIndexing(): boolean {
    return this.running || (this.runner?.isRunning() ?? false);
  }

  /**
   * Run `work` in ONE write transaction that takes the write lock at its first statement (`BEGIN IMMEDIATE`), and keep
   * the time it held it. Two reasons it is not a deferred transaction: a transaction that reads first and writes
   * later fails at once with "database is locked" when another connection committed in between (no waiting helps:
   * its snapshot is stale), and the service writes to this file all the time while a worker pass runs.
   */
  private write<T>(work: () => T): T {
    const started = performance.now();
    try {
      return this.db.transaction(work).immediate();
    } finally {
      this.writeMs += performance.now() - started;
    }
  }

  /**
   * Milliseconds the write transactions run since the last call held the write lock; the worker rests a multiple of it
   * (`WRITE_REST_RATIO`) before its next step so that the other connection finds the lock free.
   */
  takeWriteMs(): number {
    const held = this.writeMs;
    this.writeMs = 0;
    return held;
  }

  indexAll(): IndexStats {
    const gen = this.steps(undefined);
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
  }

  /**
   * Same work as `indexAll`, but chunked: between chunks the event loop gets a
   * turn (SSE, scheduler and routes keep responding). Concurrent calls share
   * the in-flight run instead of starting a second one.
   */
  indexAllAsync(onProgress?: (p: IndexProgress) => void): Promise<IndexStats> {
    if (this.inFlight) return this.inFlight;
    const run = this.runner
      ? this.runner.run(onProgress ? { onProgress } : {})
      : this.runInline(undefined, onProgress);
    this.inFlight = run.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * What to do when a pass that added, updated or removed a row ends, before `index.finished` is announced: the engine
   * regenerates the routers here (.specs/features/cerebro-correcoes, S5). A hook that throws never fails the pass.
   */
  setAfterPass(hook: ((stats: IndexStats) => void) | null): void {
    this.afterPass = hook;
  }

  /** The end of a pass, wherever it ran (this thread or the worker host): the hook, then the caller announces. */
  finishPass(stats: IndexStats): void {
    if (!this.afterPass || stats.added + stats.updated + stats.removed === 0) return;
    try {
      this.afterPass(stats);
    } catch {
      // the hook reports its own failure; the pass stands
    }
  }

  /** Hand the passes to a runner (the worker host) from now on. */
  attachRunner(runner: IndexRunner | null): void {
    this.runner = runner;
  }

  /**
   * A pass in this thread, in chunks: between chunks the event loop gets a turn. `runId` labels its events; `only`
   * limits it to these paths. Cancelled by `cancelInline`, between two chunks.
   */
  async runInline(
    runId: string | undefined,
    onProgress?: (p: IndexProgress) => void,
    only?: readonly string[],
  ): Promise<IndexStats> {
    this.cancelRequested = false;
    const stopped = () => this.cancelRequested;
    try {
      const gen = this.steps(onProgress, only, runId, false);
      let step = gen.next();
      while (!step.done) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (this.cancelRequested) {
          this.cancelRequested = false;
          gen.return(undefined as never);
          throw new IndexCancelledError();
        }
        step = gen.next();
      }
      const stats = step.value;
      const abort = new AbortController();
      const watch = setInterval(() => stopped() && abort.abort(), 50);
      try {
        await this.runVectors(stats, only !== undefined, { signal: abort.signal, shouldStop: stopped, onProgress, runId });
      } finally {
        clearInterval(watch);
      }
      if (this.cancelRequested) {
        this.cancelRequested = false;
        throw new IndexCancelledError();
      }
      this.finishPass(stats);
      this.bus?.emit("index.finished", { stats, ...(runId ? { runId } : {}) });
      return stats;
    } catch (error) {
      if (!(error instanceof IndexCancelledError)) {
        this.bus?.emit("index.failed", {
          code: error instanceof IncompleteIndexScanError ? error.code : "index_failed",
          previousIndexPreserved: error instanceof IncompleteIndexScanError,
          ...(runId ? { runId } : {}),
        });
      }
      throw error;
    }
  }

  /**
   * The vectors phase of a pass, after the files: embed what owes a vector (`embedPending`), fold the count into the
   * stats, and into the `last_index` the pass stored. Needs no extension (a vector is a BLOB); a failure of the
   * provider ends this phase and is remembered, never the pass.
   */
  async runVectors(
    stats: IndexStats,
    only: boolean,
    options: {
      signal?: AbortSignal | undefined;
      shouldStop?: (() => boolean) | undefined;
      onProgress?: ((p: IndexProgress) => void) | undefined;
      runId?: string | undefined;
    } = {},
  ): Promise<void> {
    const config = this.getSettings().memory.embeddings;
    let announced = false;
    const { embedded } = await embedPending(this.db, config, {
      allow: this.rowFilter(),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.shouldStop ? { shouldStop: options.shouldStop } : {}),
      onProgress: (done, total) => {
        announced = true;
        const p: IndexProgress = {
          ...(options.runId ? { runId: options.runId } : {}),
          phase: "vectors",
          scanned: done,
          total,
          added: stats.added,
          updated: stats.updated,
          removed: stats.removed,
        };
        options.onProgress?.(p);
        this.bus?.emit("index.progress", p);
      },
    });
    void announced;
    if (embedded > 0 || config.enabled) stats.embedded = embedded;
    if (!only && stats.embedded !== undefined) {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(LAST_INDEX_KEY) as { value: string } | undefined;
      if (row) {
        const last = JSON.parse(row.value) as { at: number; stats: IndexStats };
        last.stats.embedded = stats.embedded;
        this.db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(JSON.stringify(last), LAST_INDEX_KEY);
      }
    }
  }

  /** Ask the pass that runs in this thread to stop at the next chunk. False when none runs. */
  cancelInline(): boolean {
    if (!this.running) return false;
    this.cancelRequested = true;
    return true;
  }

  /**
   * The pass as a generator, for a caller that drives it itself (the worker thread): each `yield` is a safe point to
   * stop at, and nothing is announced on any bus. `only` and `runId` are as in `runInline`.
   */
  iteratePass(
    onProgress: (p: IndexProgress) => void,
    only?: readonly string[],
    runId?: string,
  ): Generator<void, IndexStats> {
    return this.steps(onProgress, only, runId, false);
  }

  /** A pass over these paths only (a note that was just saved), synchronously. Same rules as `indexAll`. */
  indexPaths(paths: readonly string[]): IndexStats {
    const gen = this.steps(undefined, paths);
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
  }

  /**
   * Ask for these paths to be indexed soon: the request waits behind a pass that is running, and every request made
   * meanwhile becomes ONE pass over the union of their paths. Resolves when the pass that covered them ended.
   */
  requestIndexPaths(paths: readonly string[]): Promise<void> {
    for (const p of paths) this.requested.add(path.resolve(p));
    if (this.requestedRun) return this.requestedRun;
    const own: { run?: Promise<void> } = {};
    own.run = (async () => {
      // The run is stored below before any of it executes: a request made while it works joins it.
      await Promise.resolve();
      try {
        // Let a running pass finish first: it cannot see what changed after its scan.
        while (this.running || this.inFlight) {
          await (this.inFlight ?? new Promise<void>((resolve) => setTimeout(resolve, 5))).catch(() => undefined);
        }
        while (this.requested.size > 0) {
          const batch = [...this.requested];
          this.requested.clear();
          if (this.runner) await this.runner.run({ only: batch });
          else this.indexPaths(batch);
        }
      } finally {
        if (this.requestedRun === own.run) this.requestedRun = null;
      }
    })();
    this.requestedRun = own.run;
    return own.run;
  }

  lastIndex(): { at: number; stats: IndexStats } | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(LAST_INDEX_KEY) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as { at: number; stats: IndexStats }) : null;
  }

  /** The whole run as a generator; each `yield` is a safe point to give the loop a turn. */
  private *steps(
    onProgress: ((p: IndexProgress) => void) | undefined,
    /** Only these paths: no scan, no pruning of the files not named, and `last_index` stays as it was. */
    only?: readonly string[],
    /** The pass these events belong to (`index.started`). */
    runId?: string,
    /** Announce `index.finished` / `index.failed` here (the caller that adds a phase after this one announces them itself). */
    announce = true,
  ): Generator<void, IndexStats> {
    if (this.running) throw new Error("An index run is already in progress.");
    this.running = true;
    try {
      const started = Date.now();
      const settings = this.getSettings();
      const stats: IndexStats = {
        scanned: 0, added: 0, updated: 0, removed: 0, skippedExcluded: 0, skippedBinary: 0, related: 0, durationMs: 0,
      };
      const filter = makeWorkspaceFilter(settings.excludes, this.filterOptions);
      const maxBytes = settings.limits.maxIndexedFileBytes;

      // Deterministic root set: de-duplicated by resolved path (first entry
      // wins for the area). A directory that is itself another enabled root is
      // skipped by the parent walk, so the longest (most specific) root owns it.
      const rootArea = new Map<string, string | null>();
      for (const f of [...settings.indexedFolders, ...this.implicitRoots]) {
        if (!f.enabled) continue;
        const r = path.resolve(f.path);
        if (!rootArea.has(r)) rootArea.set(r, f.area);
      }
      const roots = [...rootArea.keys()].sort();
      const rootSet = new Set(roots);
      // Every byte below is read through the safe-read primitive on the real path, under these roots.
      const scope = readScope({ ...this.filterOptions, roots, excludes: settings.excludes });

      let announcedAt = 0;
      const emit = (total?: number, phase?: IndexPhase, force = true) => {
        const at = Date.now();
        if (!force && at - announcedAt < PROGRESS_EVERY_MS) return;
        announcedAt = at;
        const p: IndexProgress = {
          ...(runId ? { runId } : {}),
          ...(phase ? { phase } : {}),
          scanned: stats.scanned,
          ...(total !== undefined ? { total } : {}),
          added: stats.added,
          updated: stats.updated,
          removed: stats.removed,
        };
        onProgress?.(p);
        this.bus?.emit("index.progress", p);
      };

      // Phase 1: scan (no content is read here).
      const candidates: Candidate[] = [];
      const gone = new Set<string>();
      let dirsSinceYield = 0;
      if (only) this.collectPaths(only, roots, rootArea, filter, scope, stats, candidates, gone);
      for (const root of only ? [] : roots) {
        // The home check compares real paths; the walk never follows a symlink,
        // so only the root can be spelled through one.
        const realRoot = realpathLenient(root);
        if (filter.reasonToSkip("", realRoot)) {
          stats.skippedExcluded++;
          continue;
        }
        const area = rootArea.get(root) ?? null;
        const stack = [root];
        while (stack.length > 0) {
          const dir = stack.pop()!;
          let entries: fs.Dirent[];
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            // Scanning precedes every upsert/removal, so aborting here preserves
            // the entire previous snapshot, including FTS and relationships.
            throw new IncompleteIndexScanError();
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(root, full);
            if (filter.isExcluded(rel, path.join(realRoot, rel))) {
              stats.skippedExcluded++;
              continue;
            }
            if (entry.isSymbolicLink()) continue; // symlinks could escape the root
            if (entry.isDirectory()) {
              if (rootSet.has(full)) continue; // owned by the nested root
              stack.push(full);
              continue;
            }
            if (!entry.isFile()) continue;
            // the temporary file of a save that died (the walk is a full pass; `only` names its paths)
            if (entry.name.startsWith(".mordomo-save-") && removeStaleSaveTemp(full)) continue;
            stats.scanned++;
            candidates.push({ root, full, rel, area });
          }
          if (++dirsSinceYield >= 50) {
            dirsSinceYield = 0;
            emit(undefined, "scan");
            yield;
          }
        }
      }

      emit(candidates.length, "scan");
      yield;

      // Phase 2: upserts, in waves. A wave is READ without any lock (the files, their parsing, the terms and the links:
      // most of the time of a file) and then WRITTEN in one short transaction.
      const seen = new Set<string>();
      const total = candidates.length;
      emit(total, "index");
      let holdPerFileMs = 0.5;
      for (let next = 0; next < candidates.length; ) {
        const wave: PreparedFile[] = [];
        let bytes = 0;
        const limit = Math.max(1, Math.min(INDEX_CHUNK_SIZE, Math.floor(WAVE_TARGET_HOLD_MS / holdPerFileMs)));
        while (next < candidates.length && wave.length < limit && bytes < INDEX_WAVE_BYTES) {
          const c = candidates[next++]!;
          const prepared = this.prepareFile(c, scope, stats, maxBytes);
          // A file the policy refuses at read time (a link swapped in after the scan) is not "seen":
          // its old row goes with the vanished files below.
          if (prepared === "refused") {
            stats.skippedExcluded++;
            continue;
          }
          seen.add(c.full);
          if (prepared === "kept") continue;
          wave.push(prepared);
          bytes += prepared.content.length;
        }
        if (wave.length > 0) {
          const began = performance.now();
          this.write(() => wave.forEach((file) => this.applyFile(file, stats)));
          holdPerFileMs = 0.7 * holdPerFileMs + 0.3 * Math.max(0.01, (performance.now() - began) / wave.length);
        }
        emit(total, "index", false);
        yield;
      }
      emit(total, "index");

      // Phase 3: rows whose file vanished or whose root is no longer indexed.
      const all = this.db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
      const stale = all.filter((row) => (only ? gone.has(row.path) : !seen.has(row.path)));
      emit(total, "prune");
      for (let i = 0; i < stale.length; i += INDEX_CHUNK_SIZE) {
        const rows = stale.slice(i, i + INDEX_CHUNK_SIZE);
        this.write(() => rows.forEach((row) => this.removeFile(row.id, stats)));
        emit(total, "prune", false);
        yield;
      }
      emit(total, "prune");

      // Files that did not change since migration 20 get their links from the stored text.
      if (!only) yield* this.backfillNoteLinks();

      // Phase 4: related-by-content edges for what changed (IDF over the whole corpus).
      emit(total, "related");
      yield;
      // What this pass changed, and what an earlier pass changed and died before it could relate (their terms are
      // newer than the last refresh): a pass that is cut short and then repeated ends with the same edges as one that
      // was not.
      // `relatedFrom` must be later than every term stored so far: `relatedOwed` keeps `updated_at >= since` (a write that
      // shares the millisecond is never lost), so a term stored in this very millisecond would be owed again next pass.
      for (const tick = Date.now(); Date.now() === tick; ) continue;
      const relatedFrom = Date.now();
      const owing = this.relatedOwed();
      for (const id of this.touched) owing.add(id);
      stats.related = yield* this.refreshRelatedSteps(owing);
      this.touched = new Set();

      stats.durationMs = Date.now() - started;
      this.write(() => {
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(RELATED_AT_KEY, String(relatedFrom));
        if (only) return;
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(LAST_INDEX_KEY, JSON.stringify({ at: Date.now(), stats }));
      });
      emit(total, "related");
      if (announce) {
        this.finishPass(stats);
        this.bus?.emit("index.finished", { stats, ...(runId ? { runId } : {}) });
      }
      return stats;
    } catch (error) {
      if (announce)
        this.bus?.emit("index.failed", {
          code: error instanceof IncompleteIndexScanError ? error.code : "index_failed",
          previousIndexPreserved: error instanceof IncompleteIndexScanError,
          ...(runId ? { runId } : {}),
        });
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * The candidates for a pass over named paths: each must lie under an indexed root, pass the same filter the scan
   * applies, and be reached without a link on the way. A path that is not there any more is `gone` (its row, if any,
   * is removed).
   */
  private collectPaths(
    only: readonly string[],
    roots: readonly string[],
    rootArea: ReadonlyMap<string, string | null>,
    filter: ReturnType<typeof makeWorkspaceFilter>,
    scope: ReadScope,
    stats: IndexStats,
    candidates: Candidate[],
    gone: Set<string>,
  ): void {
    for (const wanted of only) {
      const full = path.resolve(wanted);
      const root = roots
        .filter((r) => full === r || full.startsWith(r + path.sep))
        .sort((a, b) => b.length - a.length)[0];
      if (root === undefined || full === root) continue;
      const rel = path.relative(root, full);
      const realRoot = realpathLenient(root);
      if (filter.isExcluded(rel, path.join(realRoot, rel))) {
        stats.skippedExcluded++;
        continue;
      }
      try {
        const { path: real, stat } = statWorkspacePath(scope, full);
        // A link on the way (or at the end) makes the real path another one: the scan does not follow links.
        if (real !== path.join(realRoot, rel) || !stat.isFile()) continue;
      } catch (err) {
        if (err instanceof PathAccessError) stats.skippedExcluded++;
        else if ((err as NodeJS.ErrnoException).code === "ENOENT") gone.add(full);
        continue;
      }
      stats.scanned++;
      candidates.push({ root, full, rel, area: rootArea.get(root) ?? null });
    }
  }

  /**
   * Everything about one candidate that needs no database write: its stat, its text through the safe reader, the front
   * matter, the terms and the links. `"kept"` is a file whose row is current; `"refused"` one the policy turned away
   * at read time. Runs OUTSIDE any write transaction: this is most of the time a file costs.
   */
  private prepareFile(c: Candidate, scope: ReadScope, stats: IndexStats, maxBytes: number): PreparedFile | "kept" | "refused" {
    const { root, full, area } = c;
    let stat: fs.Stats;
    try {
      stat = statWorkspacePath(scope, full).stat;
    } catch (err) {
      return err instanceof PathAccessError ? "refused" : "kept";
    }
    if (!stat.isFile()) return "kept";
    const existing = this.db
      .prepare("SELECT id, size, mtime, root, area FROM files WHERE path = ?")
      .get(full) as { id: number; size: number; mtime: number; root: string; area: string | null } | undefined;
    const mtime = Math.floor(stat.mtimeMs);
    if (
      existing &&
      existing.size === stat.size &&
      existing.mtime === mtime &&
      existing.root === root &&
      (existing.area ?? null) === area
    ) {
      return "kept";
    }

    const ext = path.extname(full).toLowerCase();
    let content = "";
    let title: string | null = null;
    let tags: string[] = [];
    let fields: Record<string, string> = {};
    if ((TEXT_EXTENSIONS.has(ext) || ext === "") && stat.size <= maxBytes) {
      try {
        const file = openWorkspaceFile(scope, full);
        try {
          const buf = file.readBytes(maxBytes).bytes;
          if (isBinaryBuffer(buf)) stats.skippedBinary++;
          else content = buf.toString("utf8");
        } finally {
          file.close();
        }
      } catch (err) {
        if (err instanceof PathAccessError) return "refused";
        content = "";
      }
      if (ext === ".md" || ext === ".markdown") {
        const header = parseFrontMatter(content);
        title = header?.title ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
        const inline = [...content.matchAll(/(?:^|\s)#([\p{L}\d_-]{2,30})\b/gu)].map((m) => m[1]!);
        tags = [...new Set([...(header?.tags ?? []), ...inline])].slice(0, 20);
        fields = parseInlineFields(content);
      }
    }
    const name = path.basename(full);
    const markdown = ext === ".md" || ext === ".markdown";
    return {
      c,
      ext,
      name,
      size: stat.size,
      mtime,
      content: content.slice(0, 200_000),
      title,
      tagsJson: JSON.stringify(tags),
      fieldsJson: JSON.stringify(fields),
      terms: termsOf(name, content),
      noteLinks: markdown ? extractLinks(content, full) : [],
      markdown,
    };
  }

  /** The rows of one prepared file, inside the wave's write transaction. */
  private applyFile(file: PreparedFile, stats: IndexStats): void {
    const { root, full, rel, area } = file.c;
    const now = Date.now();
    // Looked up again here: the row was read before the transaction, and the transaction is what decides.
    const existing = this.db.prepare("SELECT id FROM files WHERE path = ?").get(full) as { id: number } | undefined;
    let id: number;
    if (existing) {
      id = existing.id;
      this.db
        .prepare(
          "UPDATE files SET root = ?, rel = ?, dir = ?, size = ?, mtime = ?, indexed_at = ?, title = ?, tags = ?, area = ?, fields = ? WHERE id = ?",
        )
        .run(root, rel, path.dirname(full), file.size, file.mtime, now, file.title, file.tagsJson, area, file.fieldsJson, id);
      this.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(id);
      this.db
        .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
        .run(id, file.name, rel, file.content);
      this.storeTerms(id, file.terms);
      stats.updated++;
    } else {
      const info = this.db
        .prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(root, full, rel, file.name, file.ext, path.dirname(full), area, file.size, file.mtime, now, file.title, file.tagsJson, file.fieldsJson);
      id = Number(info.lastInsertRowid);
      this.db
        .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
        .run(id, file.name, rel, file.content);
      this.storeTerms(id, file.terms);
      stats.added++;
    }
    if (file.markdown) this.writeNoteLinks(id, file.noteLinks);
  }

  /** Replace what one Markdown file says about other files (`note_links`). */
  private writeNoteLinks(id: number, links: readonly ParsedLink[]): void {
    this.db.prepare("DELETE FROM note_links WHERE src_id = ?").run(id);
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO note_links (src_id, kind, target, label, line) VALUES (?, ?, ?, ?, ?)",
    );
    for (const link of links) insert.run(id, link.kind, link.target, link.label, link.line);
  }

  /**
   * After migration 20 (or a change in how links are read) the files that did not change have no `note_links` yet:
   * they are filled from the text the index already stores, so no file is opened for it. In slices, like the pass; the
   * marker is written with the last one, so a pass that stops halfway does it again.
   */
  private *backfillNoteLinks(): Generator<void> {
    const stored = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(NOTE_LINKS_KEY) as { value: string } | undefined;
    if (stored?.value === NOTE_LINKS_VERSION) return;
    const rows = this.db
      .prepare("SELECT id, path FROM files WHERE ext IN ('.md', '.markdown')")
      .all() as Array<{ id: number; path: string }>;
    const textOf = this.db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
    for (let i = 0; i < rows.length; i += INDEX_CHUNK_SIZE) {
      const slice = rows.slice(i, i + INDEX_CHUNK_SIZE).map((row) => ({
        id: row.id,
        links: extractLinks((textOf.get(row.id) as { content: string } | undefined)?.content ?? "", row.path),
      }));
      this.write(() => slice.forEach((row) => this.writeNoteLinks(row.id, row.links)));
      yield;
    }
    this.write(() =>
      this.db
        .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(NOTE_LINKS_KEY, NOTE_LINKS_VERSION),
    );
  }

  /** Ids of the files whose terms were stored after the last refresh of the related edges. */
  private relatedOwed(): Set<number> {
    const at = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(RELATED_AT_KEY) as { value: string } | undefined;
    const since = at ? Number(at.value) : 0;
    const rows = this.db.prepare("SELECT file_id FROM file_terms WHERE updated_at >= ?").all(since) as Array<{ file_id: number }>;
    return new Set(rows.map((row) => row.file_id));
  }

  private removeFile(id: number, stats: IndexStats): void {
    this.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(id);
    this.db.prepare("DELETE FROM note_links WHERE src_id = ?").run(id);
    this.db.prepare("DELETE FROM file_vectors WHERE file_id = ?").run(id);
    this.db.prepare("DELETE FROM file_terms WHERE file_id = ?").run(id);
    this.db.prepare("DELETE FROM file_related WHERE src_id = ? OR dst_id = ?").run(id, id);
    this.touched.delete(id);
    stats.removed++;
  }

  /** The row of a file's terms (see `termsOf`): `null` is a file with too little text to carry any. */
  private storeTerms(id: number, terms: string | null): void {
    this.touched.add(id);
    if (terms === null) {
      this.db.prepare("DELETE FROM file_terms WHERE file_id = ?").run(id);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO file_terms (file_id, terms, updated_at) VALUES (?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET terms = excluded.terms, updated_at = excluded.updated_at",
      )
      .run(id, terms, Date.now());
  }

  /**
   * Recompute the cosine neighbours of the changed files against the whole
   * corpus (top-3, symmetric) and replace their rows. Returns the edge count.
   */
  refreshRelated(changed: ReadonlySet<number>): number {
    const gen = this.refreshRelatedSteps(changed);
    let step = gen.next();
    while (!step.done) step = gen.next();
    return step.value;
  }

  /** `refreshRelated` with a safe point between the write transactions (the edges are computed first, with no lock). */
  private *refreshRelatedSteps(changed: ReadonlySet<number>): Generator<void, number> {
    if (changed.size === 0) return 0;
    const rows = this.db.prepare("SELECT file_id, terms FROM file_terms").all() as Array<{ file_id: number; terms: string }>;
    if (rows.length < 2) return 0;
    const docs = rows.map((r) => ({ id: r.file_id, tf: new Map<string, number>(JSON.parse(r.terms) as Array<[string, number]>) }));
    // A full pass (every file changed) recomputes everything; a small delta only its own neighbourhoods.
    const focus = changed.size >= rows.length ? undefined : changed;
    const edges = relatedFromTerms(docs, { topK: 3, minSim: 0.18 }, focus);
    const now = Date.now();
    // Old edges out first, then the new ones, in slices. A pass that stops in between leaves its files owing their
    // edges (`related_at` moves only at the end), and the next pass writes them again.
    if (!focus) this.write(() => this.db.prepare("DELETE FROM file_related").run());
    else {
      const ids = [...changed];
      for (let i = 0; i < ids.length; i += RELATED_WRITE_ROWS) {
        const del = this.db.prepare("DELETE FROM file_related WHERE src_id = ? OR dst_id = ?");
        this.write(() => ids.slice(i, i + RELATED_WRITE_ROWS).forEach((id) => del.run(id, id)));
        yield;
      }
    }
    const ins = this.db.prepare(
      "INSERT OR REPLACE INTO file_related (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < edges.length; i += RELATED_WRITE_ROWS) {
      this.write(() =>
        edges.slice(i, i + RELATED_WRITE_ROWS).forEach((e) => ins.run(e.source, e.target, e.score, JSON.stringify(e.terms), now)),
      );
      yield;
    }
    return edges.length;
  }
}

export function fileRowFromDb(row: Record<string, unknown>): FileRow {
  return {
    id: row.id as number,
    root: row.root as string,
    path: row.path as string,
    rel: row.rel as string,
    name: row.name as string,
    ext: row.ext as string,
    dir: row.dir as string,
    area: (row.area as string | null) ?? null,
    size: row.size as number,
    mtime: row.mtime as number,
    indexedAt: row.indexed_at as number,
    title: (row.title as string | null) ?? null,
    tags: JSON.parse((row.tags as string) ?? "[]") as string[],
    fields: fieldsFromDb(row.fields),
  };
}

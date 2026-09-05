import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { IndexedFolder, Settings } from "../config/schema.js";
import { events } from "../events.js";
import { relatedFromTerms, termFrequencies } from "./related.js";
import { isBinaryBuffer, makeWorkspaceFilter } from "./excludes.js";
import { fieldsFromDb, parseInlineFields } from "./fields.js";

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".sh", ".ps1",
  ".html", ".css", ".scss", ".sql", ".xml", ".ini", ".cfg", ".conf", ".log",
]);

/** Files processed per transaction / per event-loop turn in `indexAllAsync`. */
export const INDEX_CHUNK_SIZE = 200;
const PENDING_LINKS_KEY = "index.pending_links";
const LAST_INDEX_KEY = "last_index";

export interface IndexStats {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  skippedExcluded: number;
  /** Files whose bytes were not indexed because they looked binary (NUL in first 8 KiB). */
  skippedBinary: number;
  /** Related-by-content edges (re)computed for the files that changed. */
  related: number;
  durationMs: number;
}

/** Payload of `index.progress` events and of the `indexAllAsync` callback. */
export interface IndexProgress {
  scanned: number;
  /** Known once the scan phase finished. */
  total?: number;
  added: number;
  updated: number;
  removed: number;
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

/** Unresolved markdown links: target absolute path → ids of the source files pointing at it. */
type PendingLinks = Map<string, number[]>;

/**
 * Incremental workspace indexer.
 * - honours the exclusion policy (settings excludes, hard blocklist, secret
 *   files) BEFORE reading anything;
 * - never moves, renames or rewrites indexed files;
 * - re-reads content only when size/mtime (or owning root/area) changed;
 * - binary detection is content-based (NUL byte in the first 8 KiB);
 * - markdown links are extracted per file when it is (re)indexed and stored
 *   in `file_links`; links to files not indexed yet wait in a pending map so
 *   they resolve as soon as the target appears — nothing is re-read wholesale;
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

  constructor(
    private readonly db: Db,
    private readonly getSettings: () => Settings,
  ) {}

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
    return this.running;
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
    const run = (async () => {
      const gen = this.steps(onProgress);
      let step = gen.next();
      while (!step.done) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        step = gen.next();
      }
      return step.value;
    })();
    this.inFlight = run.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  lastIndex(): { at: number; stats: IndexStats } | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(LAST_INDEX_KEY) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as { at: number; stats: IndexStats }) : null;
  }

  /** The whole run as a generator; each `yield` is a safe point to give the loop a turn. */
  private *steps(onProgress: ((p: IndexProgress) => void) | undefined): Generator<void, IndexStats> {
    if (this.running) throw new Error("An index run is already in progress.");
    this.running = true;
    try {
      const started = Date.now();
      const settings = this.getSettings();
      const stats: IndexStats = {
        scanned: 0, added: 0, updated: 0, removed: 0, skippedExcluded: 0, skippedBinary: 0, related: 0, durationMs: 0,
      };
      const filter = makeWorkspaceFilter(settings.excludes);
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

      const emit = (total?: number) => {
        const p: IndexProgress = {
          scanned: stats.scanned,
          ...(total !== undefined ? { total } : {}),
          added: stats.added,
          updated: stats.updated,
          removed: stats.removed,
        };
        onProgress?.(p);
        events.emit("index.progress", p);
      };

      // Phase 1: scan (no content is read here).
      const candidates: Candidate[] = [];
      let dirsSinceYield = 0;
      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        if (filter.reasonToSkip("", root)) {
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
            continue;
          }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(root, full);
            if (filter.isExcluded(rel, full)) {
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
            stats.scanned++;
            candidates.push({ root, full, rel, area });
          }
          if (++dirsSinceYield >= 50) {
            dirsSinceYield = 0;
            emit();
            yield;
          }
        }
      }

      // Phase 2: upserts, one transaction per chunk.
      const pending = this.loadPendingLinks();
      const seen = new Set<string>();
      const total = candidates.length;
      const upsertChunk = this.db.transaction((chunk: Candidate[]) => {
        for (const c of chunk) {
          seen.add(c.full);
          this.upsertFile(c, stats, maxBytes, pending);
        }
      });
      for (let i = 0; i < candidates.length; i += INDEX_CHUNK_SIZE) {
        upsertChunk(candidates.slice(i, i + INDEX_CHUNK_SIZE));
        emit(total);
        yield;
      }

      // Phase 3: rows whose file vanished or whose root is no longer indexed.
      const all = this.db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
      const stale = all.filter((row) => !seen.has(row.path));
      const removeChunk = this.db.transaction((rows: Array<{ id: number; path: string }>) => {
        for (const row of rows) this.removeFile(row.id, row.path, pending, stats);
      });
      for (let i = 0; i < stale.length; i += INDEX_CHUNK_SIZE) {
        removeChunk(stale.slice(i, i + INDEX_CHUNK_SIZE));
        emit(total);
        yield;
      }

      // Phase 4: related-by-content edges for what changed (IDF over the whole corpus).
      stats.related = this.refreshRelated(this.touched);
      this.touched = new Set();

      stats.durationMs = Date.now() - started;
      const finish = this.db.transaction(() => {
        this.savePendingLinks(pending);
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(LAST_INDEX_KEY, JSON.stringify({ at: Date.now(), stats }));
      });
      finish();
      emit(total);
      events.emit("index.finished", { stats });
      return stats;
    } finally {
      this.running = false;
    }
  }

  private upsertFile(c: Candidate, stats: IndexStats, maxBytes: number, pending: PendingLinks): void {
    const { root, full, rel, area } = c;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      return;
    }
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
      return;
    }

    const ext = path.extname(full).toLowerCase();
    let content = "";
    let title: string | null = null;
    let tags: string[] = [];
    let fields: Record<string, string> = {};
    if ((TEXT_EXTENSIONS.has(ext) || ext === "") && stat.size <= maxBytes) {
      try {
        const buf = fs.readFileSync(full);
        if (isBinaryBuffer(buf)) stats.skippedBinary++;
        else content = buf.toString("utf8");
      } catch {
        content = "";
      }
      if (ext === ".md" || ext === ".markdown") {
        title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
        tags = [...new Set([...content.matchAll(/(?:^|\s)#([\p{L}\d_-]{2,30})\b/gu)].map((m) => m[1]!))].slice(0, 20);
        fields = parseInlineFields(content);
      }
    }
    const fieldsJson = JSON.stringify(fields);

    const now = Date.now();
    const name = path.basename(full);
    let id: number;
    if (existing) {
      id = existing.id;
      this.db
        .prepare(
          "UPDATE files SET root = ?, rel = ?, dir = ?, size = ?, mtime = ?, indexed_at = ?, title = ?, tags = ?, area = ?, fields = ? WHERE id = ?",
        )
        .run(root, rel, path.dirname(full), stat.size, mtime, now, title, JSON.stringify(tags), area, fieldsJson, id);
      this.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(id);
      this.db
        .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
        .run(id, name, rel, content.slice(0, 200_000));
      this.storeTerms(id, name, content);
      stats.updated++;
    } else {
      const info = this.db
        .prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(root, full, rel, name, ext, path.dirname(full), area, stat.size, mtime, now, title, JSON.stringify(tags), fieldsJson);
      id = Number(info.lastInsertRowid);
      this.db
        .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
        .run(id, name, rel, content.slice(0, 200_000));
      this.storeTerms(id, name, content);
      stats.added++;
      // Markdown files indexed earlier that point at this path get their link now.
      const waiting = pending.get(full);
      if (waiting) {
        for (const src of waiting) this.insertLink(src, id);
        pending.delete(full);
      }
    }
    if (ext === ".md" || ext === ".markdown") {
      this.refreshLinks(id, full, content, pending);
    }
  }

  /** Recompute the outgoing markdown links of one file (called only when it changed). */
  private refreshLinks(id: number, full: string, content: string, pending: PendingLinks): void {
    this.db.prepare("DELETE FROM file_links WHERE src_id = ? AND kind = 'markdown-link'").run(id);
    dropSource(pending, id);
    const dir = path.dirname(full);
    const lookup = this.db.prepare("SELECT id FROM files WHERE path = ?");
    const targets = new Set<string>();
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)#?\s]+)\)/g)) {
      const target = match[1]!;
      if (/^[a-z]+:\/\//i.test(target)) continue;
      let decoded: string;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        continue;
      }
      const resolved = path.resolve(dir, decoded);
      if (resolved === full) continue;
      targets.add(resolved);
    }
    for (const resolved of targets) {
      const dst = lookup.get(resolved) as { id: number } | undefined;
      if (dst) {
        this.insertLink(id, dst.id);
      } else {
        const list = pending.get(resolved) ?? [];
        if (!list.includes(id)) list.push(id);
        pending.set(resolved, list);
      }
    }
  }

  private insertLink(src: number, dst: number): void {
    if (src === dst) return;
    this.db
      .prepare("INSERT OR IGNORE INTO file_links (src_id, dst_id, kind) VALUES (?, ?, 'markdown-link')")
      .run(src, dst);
  }

  private removeFile(id: number, filePath: string, pending: PendingLinks, stats: IndexStats): void {
    // Remember who linked here so the edge comes back if the file reappears.
    const inbound = this.db
      .prepare("SELECT src_id FROM file_links WHERE dst_id = ? AND kind = 'markdown-link'")
      .all(id) as Array<{ src_id: number }>;
    if (inbound.length > 0) {
      const list = pending.get(filePath) ?? [];
      for (const { src_id } of inbound) if (!list.includes(src_id)) list.push(src_id);
      pending.set(filePath, list);
    }
    this.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(id);
    this.db.prepare("DELETE FROM file_links WHERE src_id = ? OR dst_id = ?").run(id, id);
    this.db.prepare("DELETE FROM file_terms WHERE file_id = ?").run(id);
    this.db.prepare("DELETE FROM file_related WHERE src_id = ? OR dst_id = ?").run(id, id);
    this.touched.delete(id);
    dropSource(pending, id);
    stats.removed++;
  }

  /** Top terms of a file (first 20k chars), kept for the related-edge refresh. */
  private storeTerms(id: number, name: string, content: string): void {
    const body = content.slice(0, 20_000);
    this.touched.add(id);
    if (body.trim().length < 40) {
      this.db.prepare("DELETE FROM file_terms WHERE file_id = ?").run(id);
      return;
    }
    const tf = termFrequencies(`${name}\n${body}`, 80);
    this.db
      .prepare(
        "INSERT INTO file_terms (file_id, terms, updated_at) VALUES (?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET terms = excluded.terms, updated_at = excluded.updated_at",
      )
      .run(id, JSON.stringify([...tf.entries()]), Date.now());
  }

  /**
   * Recompute the cosine neighbours of the changed files against the whole
   * corpus (top-3, symmetric) and replace their rows. Returns the edge count.
   */
  refreshRelated(changed: ReadonlySet<number>): number {
    if (changed.size === 0) return 0;
    const rows = this.db.prepare("SELECT file_id, terms FROM file_terms").all() as Array<{ file_id: number; terms: string }>;
    if (rows.length < 2) return 0;
    const docs = rows.map((r) => ({ id: r.file_id, tf: new Map<string, number>(JSON.parse(r.terms) as Array<[string, number]>) }));
    // A full pass (every file changed) recomputes everything; a small delta only its own neighbourhoods.
    const focus = changed.size >= rows.length ? undefined : changed;
    const edges = relatedFromTerms(docs, { topK: 3, minSim: 0.18 }, focus);
    const now = Date.now();
    const write = this.db.transaction(() => {
      if (!focus) this.db.prepare("DELETE FROM file_related").run();
      else {
        const del = this.db.prepare("DELETE FROM file_related WHERE src_id = ? OR dst_id = ?");
        for (const id of changed) del.run(id, id);
      }
      const ins = this.db.prepare(
        "INSERT OR REPLACE INTO file_related (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, ?, ?, ?)",
      );
      for (const e of edges) ins.run(e.source, e.target, e.score, JSON.stringify(e.terms), now);
    });
    write();
    return edges.length;
  }

  private loadPendingLinks(): PendingLinks {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(PENDING_LINKS_KEY) as
      | { value: string }
      | undefined;
    const out: PendingLinks = new Map();
    if (!row) return out;
    try {
      for (const [target, srcs] of Object.entries(JSON.parse(row.value) as Record<string, number[]>)) {
        if (Array.isArray(srcs) && srcs.length > 0) out.set(target, srcs.filter((n) => Number.isInteger(n)));
      }
    } catch {
      /* corrupt map: start clean; links re-resolve as files change */
    }
    return out;
  }

  private savePendingLinks(pending: PendingLinks): void {
    const obj: Record<string, number[]> = {};
    for (const [target, srcs] of pending) if (srcs.length > 0) obj[target] = srcs;
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(PENDING_LINKS_KEY, JSON.stringify(obj));
  }
}

function dropSource(pending: PendingLinks, id: number): void {
  for (const [target, srcs] of pending) {
    const kept = srcs.filter((s) => s !== id);
    if (kept.length === 0) pending.delete(target);
    else if (kept.length !== srcs.length) pending.set(target, kept);
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

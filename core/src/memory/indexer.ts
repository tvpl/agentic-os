import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings } from "../config/schema.js";
import { makeExcludeMatcher, isSecretFile } from "../security/paths.js";

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".sh", ".ps1",
  ".html", ".css", ".scss", ".sql", ".xml", ".ini", ".cfg", ".conf", ".log",
]);

export interface IndexStats {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  skippedExcluded: number;
  durationMs: number;
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
}

/**
 * Incremental workspace indexer.
 * - honours the exclusion list BEFORE reading anything;
 * - never moves, renames or rewrites indexed files;
 * - re-reads content only when size/mtime changed;
 * - extracts markdown titles, tags (#tag) and [links](…) for the graph.
 */
export class MemoryIndexer {
  constructor(
    private readonly db: Db,
    private readonly getSettings: () => Settings,
  ) {}

  indexAll(): IndexStats {
    const started = Date.now();
    const settings = this.getSettings();
    const stats: IndexStats = { scanned: 0, added: 0, updated: 0, removed: 0, skippedExcluded: 0, durationMs: 0 };
    const exclude = makeExcludeMatcher(settings.excludes);
    const seen = new Set<string>();

    const folders = settings.indexedFolders.filter((f) => f.enabled);
    for (const folder of folders) {
      const root = path.resolve(folder.path);
      if (!fs.existsSync(root)) continue;
      this.walk(root, root, folder.area, exclude, seen, stats, settings.limits.maxIndexedFileBytes);
    }

    // Remove rows for files that no longer exist or whose root was unselected.
    const activeRoots = folders.map((f) => path.resolve(f.path));
    const all = this.db.prepare("SELECT id, path, root FROM files").all() as Array<{
      id: number;
      path: string;
      root: string;
    }>;
    const removeStmt = this.db.prepare("DELETE FROM files WHERE id = ?");
    const removeFts = this.db.prepare("DELETE FROM files_fts WHERE rowid = ?");
    const removeLinks = this.db.prepare("DELETE FROM file_links WHERE src_id = ? OR dst_id = ?");
    for (const row of all) {
      if (!seen.has(row.path) || !activeRoots.includes(path.resolve(row.root))) {
        if (seen.has(row.path)) continue;
        removeStmt.run(row.id);
        removeFts.run(row.id);
        removeLinks.run(row.id, row.id);
        stats.removed++;
      }
    }

    this.rebuildMarkdownLinks();
    stats.durationMs = Date.now() - started;
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES ('last_index', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ at: Date.now(), stats }));
    return stats;
  }

  lastIndex(): { at: number; stats: IndexStats } | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'last_index'").get() as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as { at: number; stats: IndexStats }) : null;
  }

  private walk(
    root: string,
    dir: string,
    area: string | null,
    exclude: (rel: string) => boolean,
    seen: Set<string>,
    stats: IndexStats,
    maxBytes: number,
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (exclude(rel) || isSecretFile(entry.name)) {
        stats.skippedExcluded++;
        continue;
      }
      if (entry.isSymbolicLink()) continue; // symlinks could escape the root
      if (entry.isDirectory()) {
        this.walk(root, full, area, exclude, seen, stats, maxBytes);
        continue;
      }
      if (!entry.isFile()) continue;
      stats.scanned++;
      seen.add(full);
      this.upsertFile(root, full, rel, area, stats, maxBytes);
    }
  }

  private upsertFile(
    root: string,
    full: string,
    rel: string,
    area: string | null,
    stats: IndexStats,
    maxBytes: number,
  ): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      return;
    }
    const existing = this.db
      .prepare("SELECT id, size, mtime FROM files WHERE path = ?")
      .get(full) as { id: number; size: number; mtime: number } | undefined;
    const mtime = Math.floor(stat.mtimeMs);
    if (existing && existing.size === stat.size && existing.mtime === mtime) return;

    const ext = path.extname(full).toLowerCase();
    let content = "";
    let title: string | null = null;
    let tags: string[] = [];
    if (TEXT_EXTENSIONS.has(ext) && stat.size <= maxBytes) {
      try {
        content = fs.readFileSync(full, "utf8");
      } catch {
        content = "";
      }
      if (ext === ".md" || ext === ".markdown") {
        title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
        tags = [...new Set([...content.matchAll(/(?:^|\s)#([\p{L}\d_-]{2,30})\b/gu)].map((m) => m[1]!))].slice(0, 20);
      }
    }

    const now = Date.now();
    if (existing) {
      this.db
        .prepare("UPDATE files SET size = ?, mtime = ?, indexed_at = ?, title = ?, tags = ?, area = ? WHERE id = ?")
        .run(stat.size, mtime, now, title, JSON.stringify(tags), area, existing.id);
      this.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(existing.id);
      this.db
        .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
        .run(existing.id, path.basename(full), rel, content.slice(0, 200_000));
      stats.updated++;
    } else {
      const info = this.db
        .prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          root,
          full,
          rel,
          path.basename(full),
          ext,
          path.dirname(full),
          area,
          stat.size,
          mtime,
          now,
          title,
          JSON.stringify(tags),
        );
      this.db
        .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
        .run(info.lastInsertRowid, path.basename(full), rel, content.slice(0, 200_000));
      stats.added++;
    }
  }

  /** Extract markdown links between indexed files (relation kind: markdown-link). */
  private rebuildMarkdownLinks(): void {
    this.db.prepare("DELETE FROM file_links WHERE kind = 'markdown-link'").run();
    const mdFiles = this.db
      .prepare("SELECT id, path, dir FROM files WHERE ext IN ('.md', '.markdown')")
      .all() as Array<{ id: number; path: string; dir: string }>;
    const byPath = new Map<string, number>();
    for (const f of this.db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>) {
      byPath.set(path.resolve(f.path), f.id);
    }
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO file_links (src_id, dst_id, kind) VALUES (?, ?, 'markdown-link')",
    );
    for (const md of mdFiles) {
      let content: string;
      try {
        content = fs.readFileSync(md.path, "utf8");
      } catch {
        continue;
      }
      for (const match of content.matchAll(/\[[^\]]*\]\(([^)#?\s]+)\)/g)) {
        const target = match[1]!;
        if (/^[a-z]+:\/\//i.test(target)) continue;
        const resolved = path.resolve(md.dir, decodeURIComponent(target));
        const dstId = byPath.get(resolved);
        if (dstId && dstId !== md.id) insert.run(md.id, dstId);
      }
    }
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
  };
}

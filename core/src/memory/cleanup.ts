import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { isInside, realpathLenient } from "../security/paths.js";
import { contextMembership, contextNotesDir, contextOkPaths, findContext } from "./contexts.js";
import { storedRowFilter } from "./indexer.js";
import { GENERATED_DIRS, GENERATED_FILES } from "./notes.js";

/**
 * The guided cleanup (.specs/features/cerebro-faxina-guiada): the scope of a cleanup and what it holds. The inventory
 * is built from the `files` rows alone (AC 2): no file is opened, and a row today's policy hides counts nowhere.
 */

export interface CleanupEnv {
  paths: MordomoPaths;
  settings: Settings;
}

export type CleanupScopeView = { kind: "context"; id: string } | { kind: "dir"; path: string };

/** A scope resolved against today's settings: what the routes answer, the key decisions are stored under, the test. */
export interface CleanupScope {
  view: CleanupScopeView;
  /** `context:<id>` or `dir:<absolute path>` (door 3). */
  key: string;
  /** The folders the scope's files lie under (a context: its `ok` paths, then its notes folder). */
  roots: string[];
  /** Whether an index row is the scope's (today's policy is applied apart). */
  within(row: { root: string; rel: string }): boolean;
}

/** `400 scope_required`: no scope, the whole index, or a folder outside every indexed root (door 5, amendment 4). */
export class CleanupScopeRequiredError extends Error {
  readonly statusCode = 400;
  readonly code = "scope_required";
  constructor(message: string) {
    super(message);
    this.name = "CleanupScopeRequiredError";
  }
}

/** `400 validation`: `context` and `dir` together (amendment 3). */
export class CleanupScopeValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "CleanupScopeValidationError";
  }
}

/** `404 context_not_found`. */
export class CleanupContextNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "context_not_found";
  constructor(id: string) {
    super(`No work context is called ${id}.`);
    this.name = "CleanupContextNotFoundError";
  }
}

const memoryOf = (env: CleanupEnv): string => path.resolve(env.paths.memory);

/** `realpathLenient` of the roots of the index, once per root for the life of one test. */
function realRootOf(): (root: string) => string {
  const seen = new Map<string, string>();
  return (root) => {
    let real = seen.get(root);
    if (real === undefined) {
      real = realpathLenient(root);
      seen.set(root, real);
    }
    return real;
  };
}

/** The scope of a context: its `ok` paths (door 6 of cerebro-contextos) and its notes folder (amendment 3). */
function contextScope(env: CleanupEnv, context: WorkContext): CleanupScope {
  const member = contextMembership(env, context);
  const notes = path.resolve(contextNotesDir(env.paths, context.id));
  const realNotes = realpathLenient(notes);
  const roots = [...contextOkPaths(env, context).map((p) => path.resolve(p)), notes];
  const realRoot = realRootOf();
  return {
    view: { kind: "context", id: context.id },
    key: `context:${context.id}`,
    roots: roots.filter((r, i) => roots.indexOf(r) === i),
    within: (row) => isInside(realNotes, path.join(realRoot(row.root), row.rel)) || member(row),
  };
}

/**
 * The scope a request names (AC 3, AC 4): a context by id, or a folder inside an enabled indexed folder or `memory/`
 * (by real path). Neither, `context=all`, or a folder outside them is `400 scope_required`; both is `400 validation`;
 * an id that names no context is `404 context_not_found`.
 */
export function resolveCleanupScope(
  env: CleanupEnv,
  request: { context?: string | undefined; dir?: string | undefined },
): CleanupScope {
  if (request.context !== undefined && request.dir !== undefined) {
    throw new CleanupScopeValidationError("Name a context or a folder, not both.");
  }
  if (request.dir !== undefined) {
    const dir = path.resolve(request.dir);
    const real = realpathLenient(dir);
    const roots = [...env.settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path), env.paths.memory];
    const privateDirs = ["config", "logs"].map((name) => realpathLenient(path.join(env.paths.home, name)));
    if (!roots.some((root) => isInside(realpathLenient(path.resolve(root)), real)) || privateDirs.some((p) => isInside(p, real))) {
      throw new CleanupScopeRequiredError(
        `Not a folder inside an enabled indexed folder or memory/: ${request.dir}`,
      );
    }
    const realRoot = realRootOf();
    return {
      view: { kind: "dir", path: dir },
      key: `dir:${dir}`,
      roots: [dir],
      within: (row) => isInside(real, path.join(realRoot(row.root), row.rel)),
    };
  }
  const context = findContext(env.settings, request.context);
  if (context === null) {
    throw new CleanupScopeRequiredError("Name a work context or a folder: the cleanup never runs over the whole index.");
  }
  if (context === undefined) throw new CleanupContextNotFoundError(request.context!);
  return contextScope(env, context);
}

/** One indexed row of a scope, as the cleanup reads it. */
export interface CleanupRow {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  title: string | null;
  fields: string | null;
}

/** The rows of the scope that today's policy allows, in path order. Real paths are resolved once per folder. */
export function cleanupRows(db: Db, env: CleanupEnv, scope: CleanupScope): CleanupRow[] {
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const rows = db
    .prepare("SELECT id, root, rel, path, name, ext, size, mtime, title, fields FROM files ORDER BY path")
    .all() as CleanupRow[];
  return rows.filter((row) => policy(row) && scope.within(row));
}

// ---- the inventory -------------------------------------------------------------------------------------------------

export const CLEANUP_KIND_ORDER = ["notes", "text", "pdf", "image", "code", "other"] as const;
export type CleanupKindGroup = (typeof CLEANUP_KIND_ORDER)[number];

const KIND_OF_EXT: ReadonlyMap<string, CleanupKindGroup> = new Map([
  ...[".md", ".markdown"].map((e) => [e, "notes"] as const),
  ...[".txt", ".text", ".csv", ".tsv", ".log", ".rtf", ".doc", ".docx", ".odt"].map((e) => [e, "text"] as const),
  [".pdf", "pdf"] as const,
  ...[".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff", ".heic", ".avif"].map(
    (e) => [e, "image"] as const,
  ),
  ...[
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h",
    ".cpp", ".hpp", ".cs", ".sh", ".ps1", ".html", ".css", ".scss", ".sql", ".json", ".yaml", ".yml", ".toml", ".xml",
    ".ini", ".cfg", ".conf",
  ].map((e) => [e, "code"] as const),
]);

/** The group of a file by its extension (AC 1). */
export function kindGroupOf(ext: string): CleanupKindGroup {
  return KIND_OF_EXT.get(ext.toLowerCase()) ?? "other";
}

const DAY = 86_400_000;
/** A file's age: whole days since `mtime`. */
export const ageInDays = (mtime: number, now: number): number => Math.max(0, Math.floor((now - mtime) / DAY));

/** The age bands of AC 1: 0-30, 31-90, 91-365, more than 365 days. */
export const AGE_BANDS: ReadonlyArray<{ from: number; to: number | null }> = [
  { from: 0, to: 30 },
  { from: 31, to: 90 },
  { from: 91, to: 365 },
  { from: 366, to: null },
];

export const TOP_FOLDERS = 10;
export const MAX_CLUSTERS = 12;
/** The least score of a `file_related` edge that joins two files into one group (AC 5). */
export const CLUSTER_MIN_SCORE = 0.3;

export interface CleanupInventory {
  scope: CleanupScopeView;
  total: { count: number; bytes: number };
  byKind: Array<{ kind: CleanupKindGroup; count: number; bytes: number }>;
  bySize: Array<{ upTo: number | null; count: number; bytes: number }>;
  byAge: Array<{ from: number; to: number | null; count: number }>;
  topFolders: Array<{ path: string; count: number; bytes: number }>;
  clusters: Array<{ kind: "folder" | "related"; name: string; path: string | null; count: number; terms: string[] }>;
  /** The most recent `mtime` (ms) of the rows `total` counts, or null when there are none (amendment 18). */
  newest: number | null;
}

/** The top 3 terms the files share (by how many of them hold it, then by weight, then by name), from `file_terms`. */
function sharedTerms(db: Db, ids: readonly number[]): string[] {
  const get = db.prepare("SELECT terms FROM file_terms WHERE file_id = ?");
  const df = new Map<string, number>();
  const weight = new Map<string, number>();
  for (const id of ids) {
    const row = get.get(id) as { terms: string } | undefined;
    if (!row) continue;
    let terms: Array<[string, number]>;
    try {
      terms = JSON.parse(row.terms) as Array<[string, number]>;
    } catch {
      continue;
    }
    for (const [term, freq] of terms) {
      df.set(term, (df.get(term) ?? 0) + 1);
      weight.set(term, (weight.get(term) ?? 0) + (Number(freq) || 0));
    }
  }
  const least = Math.min(2, ids.length);
  return [...df.entries()]
    .filter(([, n]) => n >= least)
    .sort((a, b) => b[1] - a[1] || weight.get(b[0])! - weight.get(a[0])! || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 3)
    .map(([term]) => term);
}

/** The groups of AC 5: by first-level subfolder when there are two or more, else by `file_related` components. */
function clustersOf(
  db: Db,
  rows: ReadonlyArray<{ id: number; first: string | null }>,
): CleanupInventory["clusters"] {
  const byFolder = new Map<string, number[]>();
  for (const row of rows) {
    if (row.first === null) continue;
    const list = byFolder.get(row.first) ?? [];
    list.push(row.id);
    byFolder.set(row.first, list);
  }
  const bySize = <T extends { count: number; name: string }>(a: T, b: T) =>
    b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (byFolder.size >= 2) {
    return [...byFolder.entries()]
      .map(([folder, ids]) => ({ folder, ids, name: path.basename(folder), count: ids.length }))
      .sort(bySize)
      .slice(0, MAX_CLUSTERS)
      .map(({ folder, ids, name, count }) => ({ kind: "folder" as const, name, path: folder, count, terms: sharedTerms(db, ids) }));
  }
  // One folder only: the connected components of the edges scored CLUSTER_MIN_SCORE or more, among the scope's files.
  const ids = new Set(rows.map((r) => r.id));
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const id of ids) parent.set(id, id);
  const edges = db.prepare("SELECT src_id, dst_id FROM file_related WHERE score >= ?").all(CLUSTER_MIN_SCORE) as Array<{
    src_id: number;
    dst_id: number;
  }>;
  for (const { src_id, dst_id } of edges) {
    if (!ids.has(src_id) || !ids.has(dst_id)) continue;
    const a = find(src_id);
    const b = find(dst_id);
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const groups = new Map<number, number[]>();
  for (const id of ids) {
    const r = find(id);
    const list = groups.get(r) ?? [];
    list.push(id);
    groups.set(r, list);
  }
  return [...groups.values()]
    .filter((members) => members.length >= 2)
    .map((members) => {
      const terms = sharedTerms(db, members);
      return { members, terms, name: terms.join(" · "), count: members.length };
    })
    .sort(bySize)
    .slice(0, MAX_CLUSTERS)
    .map(({ terms, name, count }) => ({ kind: "related" as const, name, path: null, count, terms }));
}

/** The root of the scope a row lies under (the longest), and the row's path relative to it, by real path. */
function placeOf(realRoots: ReadonlyArray<{ root: string; real: string }>, real: string): { root: string; inner: string } | null {
  let best: { root: string; real: string } | null = null;
  for (const r of realRoots) if (isInside(r.real, real) && (best === null || r.real.length > best.real.length)) best = r;
  return best ? { root: best.root, inner: path.relative(best.real, real) } : null;
}

/** What a scope holds (AC 1, AC 2, AC 5): from the rows of `files` alone, judged by today's policy. */
export function cleanupInventory(
  db: Db,
  env: CleanupEnv,
  scope: CleanupScope,
  options: { now?: number } = {},
): CleanupInventory {
  const now = options.now ?? Date.now();
  const rows = cleanupRows(db, env, scope);
  const largeBytes = env.settings.memory.cleanup.largeBytes;
  const byKind = new Map(CLEANUP_KIND_ORDER.map((kind) => [kind, { kind, count: 0, bytes: 0 }]));
  const sizeBands = [102_400, 1_048_576, largeBytes, null].map((upTo) => ({ upTo, count: 0, bytes: 0 }));
  const byAge = AGE_BANDS.map((band) => ({ ...band, count: 0 }));
  const folders = new Map<string, { count: number; bytes: number }>();
  const placed: Array<{ id: number; first: string | null }> = [];
  const realRoots = scope.roots.map((root) => ({ root, real: realpathLenient(root) }));
  const realOf = new Map<string, string>();
  let bytes = 0;
  let newest: number | null = null;
  for (const row of rows) {
    bytes += row.size;
    if (newest === null || row.mtime > newest) newest = row.mtime;
    const kind = byKind.get(kindGroupOf(row.ext))!;
    kind.count++;
    kind.bytes += row.size;
    const size = sizeBands.find((b) => b.upTo === null || row.size <= b.upTo)!;
    size.count++;
    size.bytes += row.size;
    const age = ageInDays(row.mtime, now);
    byAge.find((b) => b.to === null || age <= b.to)!.count++;

    let realRoot = realOf.get(row.root);
    if (realRoot === undefined) {
      realRoot = realpathLenient(row.root);
      realOf.set(row.root, realRoot);
    }
    const place = placeOf(realRoots, path.join(realRoot, row.rel));
    if (!place) {
      placed.push({ id: row.id, first: null });
      continue;
    }
    const parts = place.inner.split(path.sep).slice(0, -1);
    placed.push({ id: row.id, first: parts.length > 0 ? path.join(place.root, parts[0]!) : null });
    for (let depth = 1; depth <= parts.length; depth++) {
      const folder = path.join(place.root, ...parts.slice(0, depth));
      const acc = folders.get(folder) ?? { count: 0, bytes: 0 };
      acc.count++;
      acc.bytes += row.size;
      folders.set(folder, acc);
    }
  }
  const topFolders = [...folders.entries()]
    .map(([folder, acc]) => ({ path: folder, ...acc }))
    .sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, TOP_FOLDERS);
  return {
    scope: scope.view,
    total: { count: rows.length, bytes },
    byKind: [...byKind.values()],
    bySize: sizeBands,
    byAge,
    topFolders,
    clusters: clustersOf(db, placed),
    newest,
  };
}

/** Whether a path is one the scan never reports (AC 14, amendment 5): `memory/archive/` and what the engine generates. */
export function ignoredByCleanup(env: CleanupEnv, full: string): boolean {
  const rel = path.relative(memoryOf(env), full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  const top = parts[0]!.toLowerCase();
  if (top === "archive" || GENERATED_DIRS.has(top)) return true;
  return parts.length === 1 && GENERATED_FILES.has(top);
}

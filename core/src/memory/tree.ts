import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { isInside, realpathLenient } from "../security/paths.js";
import { homeReadScope, statWorkspacePath } from "../security/safeFs.js";
import { contextMembership, contextNotesDir, contextOkPaths } from "./contexts.js";
import { fieldsFromDb } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { INDEX_NOTE, MAPS_DIR, rootSlug } from "./maps.js";
import { GENERATED_DIRS, GENERATED_FILES } from "./notes.js";

/**
 * The notes tree (.specs/features/cerebro-vista-notas, door 1): one level of one root per request, built from the
 * `files` rows alone, judged by today's policy (and, with a work context, by its membership). No file is opened: the
 * title, the type and the date are what the index holds. The only look at the disk is whether a context's notes folder
 * exists, through the safe stat.
 */

/** The most entries one level answers; the rest are counted in `omitted`. */
export const TREE_MAX_ENTRIES = 1000;
/** The names a folder's index note may have besides `_index.md`, in the order they are taken. */
export const INDEX_NOTE_NAMES = ["index.md", "README.md", "CLAUDE.md", "AGENTS.md"] as const;

export type TreeReason = "outside_memory" | "generated" | "not_markdown";
export type TreeSort = "name" | "updated";

export interface TreeRoot {
  path: string;
  name: string;
  editable: boolean;
  indexing: boolean;
}

export interface TreeFolder {
  rel: string;
  name: string;
  count: number;
  editable: boolean;
  reason?: TreeReason;
}

export interface TreeFile {
  id: number;
  rel: string;
  name: string;
  title: string | null;
  type: string | null;
  mtime: number;
  editable: boolean;
  reason?: TreeReason;
}

export interface MemoryTree {
  roots: TreeRoot[];
  root: string | null;
  dir: string;
  folders: TreeFolder[];
  files: TreeFile[];
  indexNote: number | null;
  truncated: boolean;
  omitted: number;
}

export interface TreeEnv {
  paths: MordomoPaths;
  settings: Settings;
}

export interface TreeQuery {
  /** The work context the tree is scoped to; null or absent for the whole index. */
  context?: WorkContext | null;
  root?: string | undefined;
  dir?: string | undefined;
  sort?: TreeSort | undefined;
  /** Whether an index pass runs now (every root says so: a pass walks them all). */
  indexing?: boolean;
}

/** `400 unknown_root`: not a root of this tree. */
export class TreeRootError extends Error {
  readonly statusCode = 400;
  readonly code = "unknown_root";
  constructor(root: string) {
    super(`Not a root of the notes tree: ${root}`);
    this.name = "TreeRootError";
  }
}

/** `404 not_found`: no indexed row under the folder asked for. */
export class TreeFolderMissingError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor(dir: string) {
    super(`No indexed file is under ${dir}.`);
    this.name = "TreeFolderMissingError";
  }
}

const memoryOf = (env: TreeEnv): string => path.resolve(env.paths.memory);

/** Whether the notes folder of a context exists (a missing or refused one is no root). */
function folderExists(env: TreeEnv, dir: string): boolean {
  try {
    return statWorkspacePath(homeReadScope(env.paths.home, [env.paths.memory]), dir).stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * The roots of the tree, in order: `memory/` then each enabled indexed folder (settings order); with a context, its
 * `ok` paths (its order) then its notes folder when it exists. A root under `memory/` is editable.
 */
export function treeRoots(env: TreeEnv, context?: WorkContext | null): Array<{ path: string; editable: boolean }> {
  const memory = memoryOf(env);
  const realMemory = realpathLenient(memory);
  const candidates: string[] = [];
  if (context) {
    candidates.push(...contextOkPaths(env, context).map((p) => path.resolve(p)));
    const notes = path.resolve(contextNotesDir(env.paths, context.id));
    if (folderExists(env, notes)) candidates.push(notes);
  } else {
    candidates.push(memory);
    for (const folder of env.settings.indexedFolders) if (folder.enabled) candidates.push(path.resolve(folder.path));
  }
  const out: Array<{ path: string; editable: boolean }> = [];
  for (const candidate of candidates) {
    if (out.some((r) => r.path === candidate)) continue;
    out.push({ path: candidate, editable: isInside(realMemory, realpathLenient(candidate)) });
  }
  return out;
}

/** A name as the tree orders it: accents folded, case ignored. */
const foldName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function byName(a: string, b: string): number {
  const fa = foldName(a);
  const fb = foldName(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether an entry can be edited (AC 8): outside `memory/` it cannot (`outside_memory`); `ROUTER.md` at the top of
 * `memory/` and the folders `areas/`, `journal/`, `contexts/` with what is under them are generated; a file under
 * `memory/` that is not `.md` is `not_markdown`. Decided on the path alone (the rule of `classifyNotePath`).
 */
export function entryEditability(
  memory: string,
  entry: string,
  folder: boolean,
): { editable: true } | { editable: false; reason: TreeReason } {
  const rel = path.relative(memory, entry);
  if (rel === "") return { editable: true };
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { editable: false, reason: "outside_memory" };
  const parts = rel.split(path.sep);
  const top = parts[0]!.toLowerCase();
  if (!folder && parts.length === 1 && GENERATED_FILES.has(top)) return { editable: false, reason: "generated" };
  if (GENERATED_DIRS.has(top) && (folder || parts.length > 1)) return { editable: false, reason: "generated" };
  if (!folder && path.extname(entry).toLowerCase() !== ".md") return { editable: false, reason: "not_markdown" };
  return { editable: true };
}

interface TreeRow {
  id: number;
  root: string;
  rel: string;
  name: string;
  title: string | null;
  mtime: number;
  fields: string | null;
}

/** The character after the separator: `rel >= p/ AND rel < p<next>` is every `rel` that starts with `p/`. */
const AFTER_SEP = String.fromCharCode(path.sep.charCodeAt(0) + 1);

/**
 * Every indexed row under `folder` (by real path), each with its path relative to the folder. A root of the index
 * that holds the folder gives the rows below the folder's path in it; a root that lies inside the folder gives all of
 * its rows.
 */
function rowsUnder(db: Db, folder: string): Array<{ row: TreeRow; inner: string }> {
  const realFolder = realpathLenient(folder);
  const roots = db.prepare("SELECT DISTINCT root FROM files").all() as Array<{ root: string }>;
  const select = "SELECT id, root, rel, name, title, mtime, fields FROM files WHERE root = ?";
  const out: Array<{ row: TreeRow; inner: string }> = [];
  for (const { root } of roots) {
    const realRoot = realpathLenient(root);
    if (isInside(realRoot, realFolder)) {
      const prefix = path.relative(realRoot, realFolder);
      const rows = (
        prefix === ""
          ? db.prepare(select).all(root)
          : db.prepare(`${select} AND rel >= ? AND rel < ?`).all(root, `${prefix}${path.sep}`, `${prefix}${AFTER_SEP}`)
      ) as TreeRow[];
      for (const row of rows) out.push({ row, inner: prefix === "" ? row.rel : row.rel.slice(prefix.length + 1) });
    } else if (isInside(realFolder, realRoot)) {
      const offset = path.relative(realFolder, realRoot);
      for (const row of db.prepare(select).all(root) as TreeRow[]) out.push({ row, inner: path.join(offset, row.rel) });
    }
  }
  return out;
}

/** The enabled indexed folder that owns `folder` (the longest that holds it), for the place of its `_index.md`. */
function owningRoot(env: TreeEnv, folder: string): string | null {
  let best: string | null = null;
  for (const f of env.settings.indexedFolders) {
    if (!f.enabled) continue;
    const root = path.resolve(f.path);
    if (isInside(root, folder) && (best === null || root.length > best.length)) best = root;
  }
  return best;
}

/** Where cerebro-organizar puts the index note of `folder`: beside its notes under `memory/`, under `memory/maps/` else. */
function indexNotePath(env: TreeEnv, folder: string): string | null {
  const memory = memoryOf(env);
  if (isInside(memory, folder)) return path.join(folder, INDEX_NOTE);
  const owner = owningRoot(env, folder);
  return owner ? path.join(memory, MAPS_DIR, rootSlug(owner), path.relative(owner, folder), INDEX_NOTE) : null;
}

/**
 * One level of the tree (door 1). `root` defaults to the first root; `dir` is relative to it. `400 unknown_root` for a
 * root that is not one of `treeRoots`, `404 not_found` for a `dir` outside the root or with no indexed row under it.
 */
export function memoryTree(db: Db, env: TreeEnv, query: TreeQuery = {}): MemoryTree {
  const context = query.context ?? null;
  const indexing = query.indexing ?? false;
  const memory = memoryOf(env);
  const roots: TreeRoot[] = treeRoots(env, context).map((r) => ({
    path: r.path,
    name: path.basename(r.path),
    editable: r.editable,
    indexing,
  }));
  let root: string | null;
  if (query.root !== undefined) {
    const asked = path.resolve(query.root);
    const real = realpathLenient(asked);
    const match = roots.find((r) => r.path === asked || realpathLenient(r.path) === real);
    if (!match) throw new TreeRootError(query.root);
    root = match.path;
  } else {
    root = roots[0]?.path ?? null;
  }
  const empty: MemoryTree = { roots, root, dir: "", folders: [], files: [], indexNote: null, truncated: false, omitted: 0 };
  if (root === null) return empty;

  const dirAsked = query.dir ?? "";
  const target = dirAsked === "" ? root : path.resolve(root, dirAsked);
  if (!isInside(root, target)) throw new TreeFolderMissingError(dirAsked);
  const dirRel = path.relative(root, target).split(path.sep).join("/");

  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  let within: ((row: { root: string; rel: string }) => boolean) | null = null;
  if (context) {
    // Its `ok` paths by real path (door 6 of cerebro-contextos), and its own notes folder under memory/.
    const member = contextMembership(env, context);
    const notes = path.resolve(contextNotesDir(env.paths, context.id));
    within = (row) => isInside(notes, path.join(row.root, row.rel)) || member(row);
  }

  interface FolderAcc {
    count: number;
    mtime: number;
  }
  const folders = new Map<string, FolderAcc>();
  const files: Array<{ row: TreeRow; name: string }> = [];
  for (const { row, inner } of rowsUnder(db, target)) {
    if (!policy(row) || (within && !within(row))) continue;
    const sep = inner.indexOf(path.sep);
    if (sep === -1) {
      files.push({ row, name: inner });
      continue;
    }
    const name = inner.slice(0, sep);
    const acc = folders.get(name) ?? { count: 0, mtime: 0 };
    acc.count += 1;
    acc.mtime = Math.max(acc.mtime, row.mtime);
    folders.set(name, acc);
  }
  if (dirRel !== "" && folders.size === 0 && files.length === 0) throw new TreeFolderMissingError(dirAsked);

  // The index note: the folder's `_index.md` where cerebro-organizar puts it, else the first of the usual names.
  let indexNote: number | null = null;
  const placed = indexNotePath(env, target);
  if (placed !== null) {
    const hit = db.prepare("SELECT id, root, rel FROM files WHERE path = ?").get(placed) as
      | { id: number; root: string; rel: string }
      | undefined;
    if (hit && policy(hit)) indexNote = hit.id;
  }
  if (indexNote === null) {
    for (const name of INDEX_NOTE_NAMES) {
      const hit = files.find((f) => f.name === name);
      if (hit) {
        indexNote = hit.row.id;
        break;
      }
    }
  }

  const sort = query.sort ?? "name";
  const folderNames = [...folders.keys()].sort((a, b) =>
    sort === "updated" ? folders.get(b)!.mtime - folders.get(a)!.mtime || byName(a, b) : byName(a, b),
  );
  files.sort((a, b) => (sort === "updated" ? b.row.mtime - a.row.mtime || byName(a.name, b.name) : byName(a.name, b.name)));

  const relOf = (name: string) => (dirRel === "" ? name : `${dirRel}/${name}`);
  const entryFolders: TreeFolder[] = folderNames.map((name) => ({
    rel: relOf(name),
    name,
    count: folders.get(name)!.count,
    ...entryEditability(memory, path.join(target, name), true),
  }));
  const entryFiles: TreeFile[] = files.map(({ row, name }) => ({
    id: row.id,
    rel: relOf(name),
    name,
    title: row.title ?? null,
    type: fieldsFromDb(row.fields).type ?? null,
    mtime: row.mtime,
    ...entryEditability(memory, path.join(target, name), false),
  }));
  const total = entryFolders.length + entryFiles.length;
  const keptFolders = entryFolders.slice(0, TREE_MAX_ENTRIES);
  const keptFiles = entryFiles.slice(0, Math.max(0, TREE_MAX_ENTRIES - keptFolders.length));
  const omitted = total - keptFolders.length - keptFiles.length;
  return {
    roots,
    root,
    dir: dirRel,
    folders: keptFolders,
    files: keptFiles,
    indexNote,
    truncated: omitted > 0,
    omitted,
  };
}

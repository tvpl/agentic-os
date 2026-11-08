import crypto from "node:crypto";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import type { Skill } from "../skills/types.js";
import { isInside, isInsideAny, realpathLenient } from "../security/paths.js";
import { homeReadScope, readWorkspaceText } from "../security/safeFs.js";
import { askedFolder, insideMemory, takesFolder } from "../runs/protectedFolder.js";
import { contextOkPaths } from "./contexts.js";
import { parseFrontMatter } from "./frontMatter.js";
import { storedRowFilter } from "./indexer.js";

/**
 * The map of folders and their index notes (.specs/features/cerebro-organizar, S3, doors 3, 4, 8 and 10): one entry per
 * folder of an indexed root (and per folder under `memory/notes/`) that holds an indexed file or an indexed subfolder,
 * with the digest of its direct children as the index knows them and the state of its index note (`_index.md`).
 * Everything is read from the `files` rows, judged by today's policy; the only file read is the front matter of an
 * index note, under `memory/`, through the safe reader.
 */

/** The name of an index note. */
export const INDEX_NOTE = "_index.md";
/** The index notes of the folders of the user live here, never in those folders (door 2). */
export const MAPS_DIR = "maps";
/** An index note is a short page; past this its front matter is not read. */
const MAX_INDEX_NOTE_BYTES = 256 * 1024;

export type FolderIndexState = "missing" | "stale" | "fresh";

export interface FolderMap {
  /** The folder, absolute. */
  path: string;
  /** The folder relative to its root (`""` for an indexed root itself; `notes/<…>` under `memory/`). */
  rel: string;
  /** Direct children the index knows (files and folders that are entries), without `_index.md` and dot names. */
  children: number;
  /** `sha256:` of the sorted, newline-joined `d:<name>` / `f:<name>` list of those children (door 4). */
  digest: string;
  /** The index note when there is one. */
  index: string | null;
  /** Its front matter `children-digest`, when it has one. */
  indexDigest: string | null;
  state: FolderIndexState;
  /** Where the index note is or will be (door 8). */
  indexPath: string;
}

export interface MapsEnv {
  paths: MordomoPaths;
  settings: Settings;
}

/** Door 4: `"sha256:" + hex(SHA-256(join("\n", sort(["d:" + folder] ∪ ["f:" + file]))))`. */
export function childrenDigest(dirs: Iterable<string>, files: Iterable<string>): string {
  const names = [...[...dirs].map((d) => `d:${d}`), ...[...files].map((f) => `f:${f}`)].sort();
  return `sha256:${crypto.createHash("sha256").update(names.join("\n")).digest("hex")}`;
}

/**
 * Door 8: the folder of `memory/maps/` that holds the index notes of one indexed root - its name in NFD without
 * accents, lower case, each run outside `[a-z0-9]` made `-`, no `-` at the ends, at most 40 characters (`pasta` when
 * nothing is left), then `-` and the first 8 hex of the SHA-256 of the root's absolute path.
 */
export function rootSlug(root: string): string {
  const name = path
    .basename(root)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${name || "pasta"}-${hash}`;
}

/** One root the map walks: an enabled indexed folder, or `memory/` (only its folders under `notes/`). */
interface MapRoot {
  root: string;
  memory: boolean;
}

function enabledRoots(env: MapsEnv): string[] {
  const memory = path.resolve(env.paths.memory);
  const roots: string[] = [];
  for (const folder of env.settings.indexedFolders) {
    if (!folder.enabled) continue;
    const root = path.resolve(folder.path);
    if (root !== memory && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

/**
 * Door 10: the folders the credential of a run sees on the map besides `memory/notes/` - the folder it was handed
 * (the input `folder` of a skill that takes one) and the `ok` paths of its work context, never a folder of
 * `memory/`. Empty for a run handed none.
 */
export function runMapReach(
  env: MapsEnv,
  run: { request?: { kind: string; inputs?: Record<string, string> } | null; contextId?: string | null },
  skill: Pick<Skill, "memoryAccess" | "inputs"> | null,
): string[] {
  const reach: string[] = [];
  const asked =
    skill && takesFolder(skill) && run.request?.kind === "skill" ? askedFolder(run.request.inputs) : null;
  if (asked !== null && path.isAbsolute(asked)) reach.push(realpathLenient(asked));
  const context = run.contextId ? env.settings.contexts.find((c) => c.id === run.contextId) : undefined;
  if (context) reach.push(...contextOkPaths(env, context).map((p) => realpathLenient(p)));
  return [...new Set(reach.filter((real) => !insideMemory(env.paths, real)))];
}

export interface MapsQuery {
  /** `memory`, an absolute path, or absent (every root). */
  root?: string;
  /** The folders a run's credential reaches (`runMapReach`); absent for the owner and a device. */
  reach?: string[];
}

/**
 * The map (door 4), or `null` when `root` names no root the caller may ask for: for the owner and a device, an
 * enabled indexed root or `memory`; for a run's credential, `memory` or a folder inside one it reaches (door 10).
 */
export function folderDigests(db: Db, env: MapsEnv, query: MapsQuery = {}): FolderMap[] | null {
  const memory = path.resolve(env.paths.memory);
  const reach = query.reach;
  const users = enabledRoots(env);
  let roots: MapRoot[];
  // A run's credential sees the entries of a user root only inside the folders it reaches.
  let within: string[] | null = reach ?? null;
  if (query.root === undefined) {
    roots = [{ root: memory, memory: true }, ...users.map((root) => ({ root, memory: false }))];
  } else if (query.root === "memory") {
    roots = [{ root: memory, memory: true }];
  } else {
    const asked = path.resolve(query.root);
    if (reach) {
      const real = realpathLenient(asked);
      if (!isInsideAny(reach, real)) return null;
      const owner = users.find((root) => isInside(realpathLenient(root), real));
      if (!owner) return null;
      roots = [{ root: owner, memory: false }];
      within = [real];
    } else {
      const owner = users.find((root) => root === asked || realpathLenient(root) === realpathLenient(asked));
      if (!owner) return null;
      roots = [{ root: owner, memory: false }];
    }
  }
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const scope = homeReadScope(env.paths.home, [env.paths.memory]);
  const out: FolderMap[] = [];
  for (const { root, memory: isMemory } of roots) {
    const realRoot = realpathLenient(root);
    for (const [rel, children] of foldersOf(db, root, isMemory, policy)) {
      const folder = rel === "" ? root : path.join(root, rel);
      if (!isMemory && within && !isInsideAny(within, path.join(realRoot, rel))) continue;
      const indexPath = isMemory
        ? path.join(folder, INDEX_NOTE)
        : path.join(memory, MAPS_DIR, rootSlug(root), rel, INDEX_NOTE);
      const digest = childrenDigest(children.dirs, children.files);
      const note = readIndexNote(scope, indexPath);
      out.push({
        path: folder,
        rel: rel.split(path.sep).join("/"),
        children: children.dirs.size + children.files.size,
        digest,
        index: note.exists ? indexPath : null,
        indexDigest: note.digest,
        state: !note.exists ? "missing" : note.digest === digest ? "fresh" : "stale",
        indexPath,
      });
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The folders of one root as the `files` rows know them, each with its direct children: a file's folder holds it,
 * and every folder up to the root holds the next one down. `_index.md` and any name that starts with `.` are no
 * children (a folder that holds nothing else is no entry); under `memory/` only the folders below `notes/` are walked.
 */
function foldersOf(
  db: Db,
  root: string,
  isMemory: boolean,
  policy: (row: { root: string; rel: string }) => boolean,
): Map<string, { dirs: Set<string>; files: Set<string> }> {
  const folders = new Map<string, { dirs: Set<string>; files: Set<string> }>();
  const at = (rel: string) => {
    let entry = folders.get(rel);
    if (!entry) {
      entry = { dirs: new Set(), files: new Set() };
      folders.set(rel, entry);
    }
    return entry;
  };
  // Under memory/ the walk starts below notes/: `notes/<folder>` is the shallowest entry.
  const minDepth = isMemory ? 2 : 0;
  const rows = db.prepare("SELECT rel FROM files WHERE root = ?").all(root) as Array<{ rel: string }>;
  for (const { rel } of rows) {
    if (!policy({ root, rel })) continue;
    const parts = rel.split(path.sep);
    if (parts.some((part) => part.startsWith(".") || part === "")) continue;
    if (isMemory && parts[0] !== "notes") continue;
    const name = parts.pop()!;
    if (parts.length < minDepth || name === INDEX_NOTE) continue;
    at(parts.join(path.sep)).files.add(name);
    for (let depth = parts.length; depth > minDepth; depth--) {
      at(parts.slice(0, depth - 1).join(path.sep)).dirs.add(parts[depth - 1]!);
    }
  }
  return folders;
}

/** Whether an index note exists and its `children-digest`; a note that cannot be read is there, with no digest. */
function readIndexNote(
  scope: ReturnType<typeof homeReadScope>,
  file: string,
): { exists: boolean; digest: string | null } {
  try {
    const text = readWorkspaceText(scope, file, { maxBytes: MAX_INDEX_NOTE_BYTES }).text;
    return { exists: true, digest: parseFrontMatter(text)?.childrenDigest ?? null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, digest: null };
    return { exists: true, digest: null };
  }
}

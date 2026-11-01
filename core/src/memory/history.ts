import path from "node:path";
import zlib from "node:zlib";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { EditConflictError } from "../errors.js";
import type { MordomoPaths } from "../paths.js";
import { homeReadScope, readWorkspaceFile, statWorkspacePath } from "../security/safeFs.js";
import { writeWorkspaceFile } from "../security/safeWrite.js";
import { unifiedDiff } from "../sync/diff.js";
import {
  HISTORY_LIST_LIMIT,
  MAX_VERSIONED_BYTES,
  historyMaxBytes,
  isVersionedPath,
  memoryRel,
  newestVersion,
  recordVersion,
  type VersionAuthor,
  type VersionOrigin,
} from "./historyStore.js";
import { NoteNotEditableError, classifyNotePath, versionOf } from "./notes.js";

export * from "./historyStore.js";

/**
 * The internal history of `memory/` (.specs/features/cerebro-memoria-confiavel, door 4): every change of a versioned
 * file, made by the MordomoOS or outside it, is a version with its author and its origin; the bytes are blobs, deflated
 * and stored once by their sha256. Nothing of it is written under `memory/`: it lives in `memory_versions` and
 * `memory_blobs` of the database, which the backup already copies.
 *
 * Versioned: every `.md` under `memory/` of at most 1 MiB, except `journal/`, `areas/`, `contexts/` and `ROUTER.md` at
 * the root of `memory/` (what the engine generates or only appends to). At most 50 versions per path; above
 * `settings.memory.history.maxBytes` of stored blobs the oldest versions that are not among the newest 5 of their path
 * go, and every blob no version names goes with them.
 */

export interface HistoryEnv {
  db: Db;
  paths: Pick<MordomoPaths, "home" | "memory">;
  settings: Settings;
}

/**
 * Record the bytes just written to `file`, when it is a versioned file of `memory/`. Returns the version's id, or
 * null when the file is not versioned (outside `memory/`, not `.md`, generated, or past 1 MiB).
 */
export function recordFileVersion(
  env: HistoryEnv,
  file: string,
  bytes: Uint8Array | string,
  author: VersionAuthor,
  origin: VersionOrigin,
  proposalId?: string | null,
): number | null {
  const rel = memoryRel(env.paths.memory, file);
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  if (rel === null || !isVersionedPath(rel, buf.byteLength)) return null;
  return recordVersion(env.db, { rel, bytes: buf, author, origin, proposalId: proposalId ?? null }, historyMaxBytes(env.settings));
}

/** Record that `file` is gone, when it is a versioned path whose newest version is not already `removed`. */
export function recordFileRemoved(env: HistoryEnv, file: string, author: VersionAuthor): number | null {
  const rel = memoryRel(env.paths.memory, file);
  if (rel === null || !isVersionedPath(rel, 0)) return null;
  const newest = newestVersion(env.db, rel);
  if (!newest || newest.origin === "removed") return null;
  return recordVersion(env.db, { rel, bytes: null, author, origin: "removed" }, historyMaxBytes(env.settings));
}

const memoryScope = (env: HistoryEnv) =>
  homeReadScope(env.paths.home, [env.paths.memory], env.settings.excludes);

/** The bytes of `file` through the safe reader, at most 1 MiB + 1, or null when it cannot be read. */
function readBytes(env: HistoryEnv, file: string): Buffer | null {
  try {
    return readWorkspaceFile(memoryScope(env), file, { maxBytes: MAX_VERSIONED_BYTES + 1 }).bytes;
  } catch {
    return null;
  }
}

/**
 * A move inside `memory/` (the cleanup's apply and undo): a `cleanup` version at the path it moved to, with the bytes
 * found there, and a `removed` version at the path it left.
 */
export function recordMove(env: HistoryEnv, from: string, to: string, author: VersionAuthor): void {
  const bytes = readBytes(env, to);
  if (bytes !== null) recordFileVersion(env, to, bytes, author, "cleanup");
  const rel = memoryRel(env.paths.memory, from);
  if (rel === null || !isVersionedPath(rel, 0)) return;
  recordVersion(env.db, { rel, bytes: null, author, origin: "removed" }, historyMaxBytes(env.settings));
}

// ---- reads and the restore (door 10) -------------------------------------------------------------------------------

export interface VersionView {
  id: number;
  path: string;
  at: number;
  author: string;
  origin: VersionOrigin;
  size: number | null;
  sha256: string | null;
  exists: boolean;
}

/** Whether a file is at `rel` under `memory/` now (through the safe reader's view of it). */
function existsInMemory(env: HistoryEnv, rel: string): boolean {
  try {
    return statWorkspacePath(memoryScope(env), path.join(env.paths.memory, ...rel.split("/"))).stat.isFile();
  } catch {
    return false;
  }
}

/** The versions of a path, or of all of `memory/`, newest first (`limit` at most 100). */
export function listVersions(
  env: HistoryEnv,
  q: {
    path?: string | undefined;
    limit?: number | undefined;
    /** Which paths (relative to memory/) the caller may see (cerebro-memoria-confiavel, door 12); all without it. */
    allow?: ((rel: string) => boolean) | undefined;
  },
): VersionView[] {
  const limit = Math.min(Math.max(q.limit ?? HISTORY_LIST_LIMIT, 1), HISTORY_LIST_LIMIT);
  const where = q.path !== undefined ? "WHERE v.path = ?" : "";
  const statement = env.db.prepare(
    `SELECT v.id, v.path, v.at, v.author, v.origin, v.sha256, b.size FROM memory_versions v
      LEFT JOIN memory_blobs b ON b.sha256 = v.sha256 ${where} ORDER BY v.id DESC`,
  );
  const rows: Array<Omit<VersionView, "exists">> = [];
  for (const row of statement.iterate(...(q.path !== undefined ? [q.path] : [])) as IterableIterator<
    Omit<VersionView, "exists">
  >) {
    if (q.allow && !q.allow(row.path)) continue;
    rows.push(row);
    if (rows.length >= limit) break;
  }
  const exists = new Map<string, boolean>();
  return rows.map((r) => {
    if (!exists.has(r.path)) exists.set(r.path, existsInMemory(env, r.path));
    return {
      id: r.id,
      path: r.path,
      at: r.at,
      author: r.author,
      origin: r.origin,
      size: r.size ?? null,
      sha256: r.sha256,
      exists: exists.get(r.path)!,
    };
  });
}

/** `404 not_found`: no version has this id, or it is a `removed` one (it holds no bytes). */
export class VersionNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor(id: number) {
    super(`No version of memory/ with bytes has the id ${id}.`);
    this.name = "VersionNotFoundError";
  }
}

interface StoredVersion {
  id: number;
  path: string;
  at: number;
  author: string;
  origin: VersionOrigin;
  sha256: string;
  bytes: Buffer;
}

function storedVersion(db: Db, id: number): StoredVersion {
  const row = db
    .prepare(
      `SELECT v.id, v.path, v.at, v.author, v.origin, v.sha256, b.codec, b.bytes FROM memory_versions v
        JOIN memory_blobs b ON b.sha256 = v.sha256 WHERE v.id = ?`,
    )
    .get(id) as (Omit<StoredVersion, "bytes"> & { codec: string; bytes: Buffer }) | undefined;
  if (!row) throw new VersionNotFoundError(id);
  const { codec, bytes, ...rest } = row;
  if (codec !== "deflate") throw new Error(`Unknown codec ${codec} for the blob ${rest.sha256}.`);
  return { ...rest, bytes: zlib.inflateRawSync(bytes) };
}

/** The current bytes of a path of `memory/`, through the safe reader; null when there is no file. */
function currentBytes(env: HistoryEnv, rel: string): Buffer | null {
  try {
    return readWorkspaceFile(memoryScope(env), path.join(env.paths.memory, ...rel.split("/")), {
      maxBytes: MAX_VERSIONED_BYTES + 1,
    }).bytes;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** One version: its text, the diff from the current file (or from nothing) to it, and the current file's version. */
export function getVersion(env: HistoryEnv, id: number) {
  const v = storedVersion(env.db, id);
  const current = currentBytes(env, v.path);
  const content = v.bytes.toString("utf8");
  return {
    id: v.id,
    path: v.path,
    at: v.at,
    author: v.author,
    origin: v.origin,
    content,
    diff: unifiedDiff(current === null ? "" : current.toString("utf8"), content),
    current: current === null ? null : versionOf(current),
  };
}

/**
 * Put a version's bytes back (AC 32 to 35): over the file through the guarded replace when it exists (`baseVersion`
 * must be its version), or as a new file in create mode when it does not (no `baseVersion`). Records a `restore`
 * version. A path that is not an editable note is `403 note_not_editable`; a link on the way `403 forbidden_path`.
 */
export function restoreVersion(
  env: HistoryEnv,
  input: { id: number; baseVersion?: string | undefined },
): { path: string; version: string } {
  const v = storedVersion(env.db, input.id);
  const file = path.join(env.paths.memory, ...v.path.split("/"));
  const classified = classifyNotePath({ paths: env.paths as MordomoPaths, settings: env.settings }, file);
  if (!classified.editable) throw new NoteNotEditableError(classified.reason ?? "Not an editable note of memory/.");
  const current = currentBytes(env, v.path);
  const scope = memoryScope(env);
  if (current !== null) {
    if (input.baseVersion === undefined || input.baseVersion !== versionOf(current)) throw new EditConflictError();
    writeWorkspaceFile(scope, file, v.bytes, { mode: "replace", expectSha256: input.baseVersion.slice("sha256:".length) });
  } else {
    if (input.baseVersion !== undefined) throw new EditConflictError();
    try {
      writeWorkspaceFile(scope, file, v.bytes, { mode: "create" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new EditConflictError();
      throw err;
    }
  }
  recordVersion(env.db, { rel: v.path, bytes: v.bytes, author: "owner", origin: "restore" }, historyMaxBytes(env.settings));
  return { path: v.path, version: versionOf(v.bytes) };
}


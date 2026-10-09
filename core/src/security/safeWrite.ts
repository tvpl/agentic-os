import fs from "node:fs";
import path from "node:path";
import { realpathLenient } from "./paths.js";
import {
  O_NOFOLLOW,
  O_NONBLOCK,
  NotRegularFileError,
  assertHoldsNoPrivateFolder,
  assertWritablePath,
  changed,
  hardLinked,
  listWorkspaceDir,
  openWorkspaceFile,
  resolveReadable,
  sharesInodeWithPrivateFile,
  type ReadScope,
} from "./safeFs.js";

/**
 * The write side of the safe-read primitive (`safeFs.ts`): the same door, in the other direction. A file the
 * engine writes into a folder an agent can also write to goes through `writeWorkspaceFile`, and a folder copied
 * in (a skill import) goes through `copyTreeWithoutLinks`, which reads and writes only through the two.
 *
 * What it cannot do: Node has no `openat`, so a folder on the way that becomes a link between the check and the
 * open cannot be refused before the open. The open is `O_CREAT` in every mode, so it can create a file behind the
 * new link; the whole path is resolved again right after, nothing is written when it differs, and a file this call
 * created (the name did not exist before) is removed again, but only when it is still the very file that was
 * created (same device and inode). An existing file is never truncated or changed by a refused call. An agent
 * racing the engine this way already has a shell.
 */

export type WriteMode = "replace" | "append" | "create";

export interface WriteOptions {
  /**
   * `replace` (default) rewrites the file, `append` adds to its end, `create` fails with `EEXIST` when
   * anything is there already (a dangling link included).
   */
  mode?: WriteMode;
  /** Permission bits of a file this call creates (before the umask). Default `0o666`. */
  fileMode?: number;
}

/**
 * Write a file the engine owns inside a folder an agent can also write to
 * (a router, a skill note, a journal day, a sync target, a skill copied from
 * a folder). The sibling of `openWorkspaceFile` for the other direction:
 *
 *  - the path must be inside the scope and pass the filter (`config/` and
 *    `logs/` of the home, secret names, the user's excludes), by its real path;
 *  - a link at the last component, dangling or not, is refused: a write
 *    follows a link wherever it points, and that is how a note became the token;
 *  - the file is opened `O_NOFOLLOW` (and not truncated by the open), so a link
 *    put there after the check fails the open instead of being followed;
 *  - the open descriptor must be a regular file with the inode the path names,
 *    and not a second name for a private file, and the whole path resolved
 *    again must give the same real path, before anything is changed.
 *
 * Missing parent folders are made. Returns the real path written.
 */
export function writeWorkspaceFile(
  scope: ReadScope,
  candidate: string,
  data: string | Uint8Array,
  options: WriteOptions = {},
): string {
  const mode = options.mode ?? "replace";
  const real = assertWritablePath(scope, candidate);
  fs.mkdirSync(path.dirname(real), { recursive: true });
  // The folders are made: look at the path again before the open, so a link that took a folder's place while they
  // were being made is not opened through (the window that is left is the one between this and the open).
  if (assertWritablePath(scope, candidate) !== real) throw changed(candidate);
  let existed = true;
  try {
    fs.lstatSync(real);
  } catch {
    existed = false;
  }
  const base = fs.constants.O_WRONLY | fs.constants.O_CREAT | O_NOFOLLOW | O_NONBLOCK;
  const flags =
    mode === "append" ? base | fs.constants.O_APPEND : mode === "create" ? base | fs.constants.O_EXCL : base;
  let fd: number;
  try {
    fd = fs.openSync(real, flags, options.fileMode ?? 0o666);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EMLINK") throw changed(candidate);
    throw err;
  }
  let stat: fs.Stats | null = null;
  try {
    stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new NotRegularFileError(candidate);
    if (sharesInodeWithPrivateFile(scope, stat)) throw hardLinked(candidate);
    // The window between the check and the open: `O_NOFOLLOW` covers the last component only. Resolve the whole
    // path again, as the read does, so a folder on the way that became a link (to config/, say) shows here, before
    // a byte is written (`changed` at the end of the open leaves the file as it was: nothing was truncated).
    if (assertWritablePath(scope, candidate) !== real) throw changed(candidate);
    if (process.platform !== "win32") {
      const named = fs.lstatSync(real);
      if (named.ino !== stat.ino || named.dev !== stat.dev) throw changed(candidate);
    }
    if (mode === "replace") fs.ftruncateSync(fd, 0);
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let written = 0;
    while (written < bytes.length) {
      written += fs.writeSync(fd, bytes, written, bytes.length - written, mode === "append" ? null : written);
    }
    return real;
  } catch (err) {
    if (!existed && stat?.isFile()) removeIfStillOurs(real, stat);
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}

/** Remove the file this call created and then refused, only if `real` still names that very file. */
function removeIfStillOurs(real: string, ours: fs.Stats): void {
  try {
    const named = fs.lstatSync(real);
    if (named.isFile() && named.ino === ours.ino && named.dev === ours.dev) fs.unlinkSync(real);
  } catch {
    /* gone already, or not ours to remove */
  }
}

/** A folder past the limits of `copyTreeWithoutLinks`. */
export class FolderTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = "folder_too_large";
  constructor(message: string) {
    super(message);
    this.name = "FolderTooLargeError";
  }
}

/** The most a copied tree may hold: a skill is a handful of small files, not a disk. */
export interface CopyLimits {
  maxFiles: number;
  maxFolders: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
}

export const DEFAULT_COPY_LIMITS: CopyLimits = {
  maxFiles: 2_000,
  maxFolders: 500,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDepth: 12,
};

/** The folder holds the home's `config/` or `logs/` (it is the home, or a folder above it). */
/**
 * Copy a folder the scope grants (an import source, a downloaded bundle) into
 * `target`, a folder that does not exist yet. Every file is READ through the
 * primitive and every file is WRITTEN through it, so what the copy contains is
 * what the reader may see:
 *
 *  - links, devices and pipes are left behind, and so is whatever the filter
 *    refuses (`.env`, keys, `.git`, `node_modules`, the user's excludes) at
 *    any depth, not only at the top;
 *  - a folder that holds the home's `config/` or `logs/` (the home itself, a
 *    folder above it) is refused outright;
 *  - the target is never copied into itself, when it lies inside the source;
 *  - the copy is bounded in files, bytes and depth (`CopyLimits`).
 */
export function copyTreeWithoutLinks(
  sourceScope: ReadScope,
  source: string,
  targetScope: ReadScope,
  target: string,
  limits: CopyLimits = DEFAULT_COPY_LIMITS,
): { files: number; bytes: number } {
  const root = resolveReadable(sourceScope, source).real;
  assertHoldsNoPrivateFolder(sourceScope, root);
  const realTarget = realpathLenient(path.resolve(target));
  let files = 0;
  let folders = 0;
  let bytes = 0;
  const tooBig = (what: string) =>
    new FolderTooLargeError(`Folder is too large to copy (${what}): ${source}`);
  const copyDir = (dir: string, into: string, depth: number): void => {
    if (depth > limits.maxDepth) throw tooBig(`more than ${limits.maxDepth} levels deep`);
    fs.mkdirSync(into, { recursive: true });
    for (const entry of listWorkspaceDir(sourceScope, dir)) {
      const to = path.join(into, entry.name);
      // The target is not part of what is copied (it may lie inside the source).
      if (entry.path === realTarget) continue;
      if (entry.isDirectory) {
        if (++folders > limits.maxFolders) throw tooBig(`more than ${limits.maxFolders} folders`);
        copyDir(entry.path, to, depth + 1);
        continue;
      }
      if (!entry.isFile) continue;
      if (++files > limits.maxFiles) throw tooBig(`more than ${limits.maxFiles} files`);
      const file = openWorkspaceFile(sourceScope, entry.path);
      try {
        if (file.stat.size > limits.maxFileBytes)
          throw tooBig(`${entry.name} is larger than ${limits.maxFileBytes} bytes`);
        bytes += file.stat.size;
        if (bytes > limits.maxTotalBytes) throw tooBig(`more than ${limits.maxTotalBytes} bytes`);
        writeWorkspaceFile(targetScope, to, file.readBytes(limits.maxFileBytes).bytes, { mode: "create" });
      } finally {
        file.close();
      }
    }
  };
  copyDir(root, target, 0);
  return { files, bytes };
}

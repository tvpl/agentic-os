import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EditConflictError } from "../errors.js";
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
  /**
   * `replace` only: the file must exist and its bytes must hash to this SHA-256 (hex) at the moment of the write,
   * read through the very descriptor that was opened for it; any other bytes throw `EditConflictError` before a
   * byte is changed (a missing file is `ENOENT`, never created). This is what lets a save refuse to overwrite an
   * edit it never saw.
   *
   * A guarded replace never writes into the file itself: the new bytes go to a temporary file beside it (same folder,
   * same permission bits), are flushed to the disk, are checked against the digest once more, and replace the name by
   * a `rename`. A write that fails halfway (the disk is full, the power goes) leaves the old file whole; the temporary
   * file is removed. The file is a new file afterwards (another inode: a hard link to the note keeps the old text).
   */
  expectSha256?: string;
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
  const expected = options.expectSha256;
  if (expected !== undefined && mode !== "replace") {
    throw new TypeError("expectSha256 only applies to mode 'replace'");
  }
  const real = assertWritablePath(scope, candidate);
  if (expected === undefined) fs.mkdirSync(path.dirname(real), { recursive: true });
  // The folders are made: look at the path again before the open, so a link that took a folder's place while they
  // were being made is not opened through (the window that is left is the one between this and the open).
  if (assertWritablePath(scope, candidate) !== real) throw changed(candidate);
  let existed = true;
  try {
    fs.lstatSync(real);
  } catch {
    existed = false;
  }
  // A guarded replace reads the file first, so it opens for reading too, and it never creates.
  const base =
    expected !== undefined
      ? fs.constants.O_RDWR | O_NOFOLLOW | O_NONBLOCK
      : fs.constants.O_WRONLY | fs.constants.O_CREAT | O_NOFOLLOW | O_NONBLOCK;
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
  let open = true;
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
    if (expected !== undefined && sha256OfDescriptor(fd, stat.size) !== expected)
      throw new EditConflictError();
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (expected !== undefined) {
      replaceBeside(scope, candidate, real, stat, fd, expected, bytes, () => {
        open = false;
        fs.closeSync(fd);
      });
      return real;
    }
    if (mode === "replace") fs.ftruncateSync(fd, 0);
    writeAll(fd, bytes, mode === "append");
    return real;
  } catch (err) {
    if (!existed && stat?.isFile()) removeIfStillOurs(real, stat);
    throw err;
  } finally {
    if (open) fs.closeSync(fd);
  }
}

function writeAll(fd: number, bytes: Uint8Array, append: boolean): void {
  let written = 0;
  while (written < bytes.length) {
    written += fs.writeSync(fd, bytes, written, bytes.length - written, append ? null : written);
  }
}

/**
 * The write of a guarded replace (see `WriteOptions.expectSha256`): temporary file beside the target, `fsync`, the
 * digest and the name checked again, `rename`. `fd` is the descriptor the first check read through; it is closed
 * (`closeTarget`) before the rename, since a file with an open handle cannot always be replaced on Windows.
 */
function replaceBeside(
  scope: ReadScope,
  candidate: string,
  real: string,
  stat: fs.Stats,
  fd: number,
  expected: string,
  bytes: Uint8Array,
  closeTarget: () => void,
): void {
  const temp = path.join(
    path.dirname(real),
    `.${path.basename(real)}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  let tempFd: number | undefined;
  try {
    // O_EXCL does not follow a link either: a name planted in the folder fails the save instead of being written through
    tempFd = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
      0o600,
    );
    // the bits of the file it replaces, not the umask's reading of them
    if (process.platform !== "win32") fs.fchmodSync(tempFd, stat.mode & 0o7777);
    writeAll(tempFd, bytes, false);
    fs.fsyncSync(tempFd);
    fs.closeSync(tempFd);
    tempFd = undefined;
    // Writing took time: the bytes the edit was based on must still be the ones in the file, and the name must still
    // be that file on the path that was checked
    if (sha256OfDescriptor(fd, fs.fstatSync(fd).size) !== expected) throw new EditConflictError();
    if (assertWritablePath(scope, candidate) !== real) throw changed(candidate);
    if (process.platform !== "win32") {
      const named = fs.lstatSync(real);
      if (named.ino !== stat.ino || named.dev !== stat.dev) throw changed(candidate);
    }
    closeTarget();
    fs.renameSync(temp, real);
  } catch (err) {
    if (tempFd !== undefined) {
      try {
        fs.closeSync(tempFd);
      } catch {
        /* closed already */
      }
    }
    fs.rmSync(temp, { force: true }); // the name is random and was created here: nobody else's file
    throw err;
  }
  syncFolder(path.dirname(real));
}

/** Make the rename durable. Best effort: a folder cannot be opened for this on Windows, and the data is safe already. */
function syncFolder(dir: string): void {
  if (process.platform === "win32") return;
  try {
    const fd = fs.openSync(dir, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* some file systems refuse it */
  }
}

/** SHA-256 (hex) of the first `size` bytes of an open file, read in blocks so a large file is never held in memory. */
function sha256OfDescriptor(fd: number, size: number): string {
  const hash = crypto.createHash("sha256");
  const block = Buffer.allocUnsafe(64 * 1024);
  let at = 0;
  while (at < size) {
    const n = fs.readSync(fd, block, 0, Math.min(block.length, size - at), at);
    if (n === 0) break;
    hash.update(block.subarray(0, n));
    at += n;
  }
  return hash.digest("hex");
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

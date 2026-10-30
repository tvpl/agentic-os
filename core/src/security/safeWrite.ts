import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EditConflictError, PathAccessError } from "../errors.js";
import { isInside, realpathLenient } from "./paths.js";
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
   *
   * Where a rename cannot be done (the folder is read-only for this user, the file is a mount point, another device:
   * `EACCES`, `EPERM`, `EBUSY`, `EXDEV` from creating the temporary file or from the rename) the file is rewritten in
   * place instead, after the same checks on a descriptor opened again (see `replaceInPlace`). A file replaced by
   * another one while the save ran (an editor's own atomic save) is `EditConflictError`, never overwritten.
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
      // another file under the name: for a guarded replace that is an edit this save never saw (an editor that saves
      // by replacing the file), not a path that moved
      if (named.ino !== stat.ino || named.dev !== stat.dev)
        throw expected !== undefined ? new EditConflictError() : changed(candidate);
    }
    if (expected !== undefined && sha256OfDescriptor(fd, stat.size) !== expected)
      throw new EditConflictError();
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (expected !== undefined) {
      const replaced = replaceBeside(scope, candidate, real, stat, fd, expected, bytes, () => {
        open = false;
        fs.closeSync(fd);
      });
      if (!replaced) replaceInPlace(scope, candidate, real, expected, bytes);
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
 * Why a rename cannot do what an in-place write could: the folder is not writable for this user (the note is), the file
 * is a mount point of its own (a Docker single-file mount: `EBUSY`), the folder is on another device (`EXDEV`). These
 * are the only answers that send a guarded replace to `replaceInPlace`; a full disk or a failing one is an error.
 */
const IN_PLACE_CODES = new Set(["EACCES", "EPERM", "EBUSY", "EXDEV"]);
const needsInPlace = (err: unknown): boolean => IN_PLACE_CODES.has((err as NodeJS.ErrnoException).code ?? "");

/** `.mordomo-save-<hex>.tmp`: the temporary file of a guarded replace (and, 12 hex digits, of the first build). */
export const SAVE_TEMP_PATTERN = /^\.mordomo-save-[0-9a-f]{12,32}\.tmp$/;
/** A temporary file this old belongs to a save that died (a save lasts milliseconds). */
export const STALE_SAVE_TEMP_MS = 60 * 60 * 1000;

/**
 * The write of a guarded replace (see `WriteOptions.expectSha256`): temporary file beside the target, `fsync`, the
 * digest and the name checked again, `rename`. `fd` is the descriptor the first check read through; it is closed
 * (`closeTarget`) before the rename, since a file with an open handle cannot always be replaced on Windows.
 *
 * Returns `false`, with nothing written and no temporary file left, when the folder or the file cannot take a
 * rename (`IN_PLACE_CODES`, from creating the temporary file or from the rename): the caller writes in place.
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
): boolean {
  // a short name of a fixed shape (the note's own name may already be as long as a name can be), unguessable
  const temp = path.join(path.dirname(real), `.mordomo-save-${crypto.randomBytes(16).toString("hex")}.tmp`);
  let tempFd: number | undefined;
  let created = false;
  try {
    // O_EXCL does not follow a link either: a name planted in the folder fails the save instead of being written through
    tempFd = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
      0o600,
    );
    created = true;
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
      // An editor that saves by a rename of its own put another file under the name while this one was written: its
      // text is the file now, and the digest above (read through the old descriptor) cannot see it. The same answer as
      // an edit in place.
      if (named.ino !== stat.ino || named.dev !== stat.dev) throw new EditConflictError();
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
    // only a file this call made: when the open failed with EEXIST the name belongs to somebody else
    if (created) fs.rmSync(temp, { force: true });
    if (needsInPlace(err)) return false;
    throw err;
  }
  syncFolder(path.dirname(real));
  return true;
}

/** The most a note replaced in place is held in memory to be put back if the write fails halfway. */
const RESTORE_LIMIT_BYTES = 8 * 1024 * 1024;

/**
 * The fallback of a guarded replace where a rename is not possible: the file is rewritten in place, as before the
 * temporary file existed. Every check the rename path makes is made again, on a descriptor opened now (the one the
 * first check used may be closed): not a link (`O_NOFOLLOW`), a regular file, not a name for a private file, the
 * same path, the name still that very file, and the bytes still the expected digest (a file replaced under the name
 * is `EditConflictError`). The old text is kept in memory (up to `RESTORE_LIMIT_BYTES`) and written back if
 * the write fails halfway, so a failed save does not leave a truncated note.
 */
function replaceInPlace(
  scope: ReadScope,
  candidate: string,
  real: string,
  expected: string,
  bytes: Uint8Array,
): void {
  let fd: number;
  try {
    fd = fs.openSync(real, fs.constants.O_RDWR | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EMLINK") throw changed(candidate);
    throw err;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new NotRegularFileError(candidate);
    if (sharesInodeWithPrivateFile(scope, stat)) throw hardLinked(candidate);
    if (assertWritablePath(scope, candidate) !== real) throw changed(candidate);
    if (process.platform !== "win32") {
      const named = fs.lstatSync(real);
      // the name must still be the file this descriptor holds: a write into a file that has no name any more is lost
      if (named.ino !== stat.ino || named.dev !== stat.dev) throw new EditConflictError();
    }
    const old = stat.size <= RESTORE_LIMIT_BYTES ? readAll(fd, stat.size) : null;
    const digest = old
      ? crypto.createHash("sha256").update(old).digest("hex")
      : sha256OfDescriptor(fd, stat.size);
    if (digest !== expected) throw new EditConflictError();
    try {
      fs.ftruncateSync(fd, 0);
      writeAll(fd, bytes, false);
    } catch (err) {
      try {
        fs.ftruncateSync(fd, 0);
        if (old) writeAll(fd, old, false);
      } catch {
        /* the disk that refused the new text may refuse the old one: the error below is the answer */
      }
      throw err;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** The first `size` bytes of an open file. */
function readAll(fd: number, size: number): Buffer {
  const buffer = Buffer.allocUnsafe(size);
  let at = 0;
  while (at < size) {
    const n = fs.readSync(fd, buffer, at, size - at, at);
    if (n === 0) break;
    at += n;
  }
  return buffer.subarray(0, at);
}

/**
 * Remove the temporary file of a save that died (`SAVE_TEMP_PATTERN`) when `full` is one: our name, a regular file (a
 * link is never followed), owned by this user and writable by its owner, and untouched for `STALE_SAVE_TEMP_MS`.
 * Returns whether it was removed. Never throws.
 */
export function removeStaleSaveTemp(full: string, now: number = Date.now()): boolean {
  try {
    if (!SAVE_TEMP_PATTERN.test(path.basename(full))) return false;
    const info = fs.lstatSync(full);
    if (!info.isFile() || (info.mode & 0o200) === 0) return false;
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) return false;
    if (now - info.mtimeMs < STALE_SAVE_TEMP_MS) return false;
    fs.unlinkSync(full);
    return true;
  } catch {
    return false;
  }
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

/** What `moveWorkspaceFile` did: the real paths, the bytes' SHA-256 (hex) and size, and how. */
export interface MovedFile {
  from: string;
  to: string;
  sha256: string;
  size: number;
  /** `rename` on one device, or a confirmed copy and then the removal of the origin. */
  how: "rename" | "copy";
}

/** `to` is taken (a file, a folder or a link, a dangling one included): nothing was moved. */
function destinationExists(to: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`The destination exists: ${to}`), { code: "EEXIST" });
}

/**
 * Refuse a link on the way to `candidate`, the last component included (`moveWorkspaceFile`): every component below
 * the scope's root that holds it, as given, is looked at with `lstat` and never followed. A path under no root of the
 * scope, as given, is refused.
 */
function assertNoLinkOnTheWay(scope: ReadScope, candidate: string): void {
  const full = path.resolve(candidate);
  const root = scope.roots
    .map((r) => path.resolve(r))
    .filter((r) => isInside(r, full))
    .sort((a, b) => b.length - a.length)[0];
  if (root === undefined) throw new PathAccessError(candidate);
  let at = root;
  for (const part of path.relative(root, full).split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    let info: fs.Stats;
    try {
      info = fs.lstatSync(at);
    } catch {
      return; // nothing further exists: nothing further can be a link
    }
    if (info.isSymbolicLink())
      throw new PathAccessError(candidate, `Refusing to move through a link: ${candidate}`);
  }
}

/**
 * Move a file the engine owns inside the scope (.specs/features/cerebro-faxina-guiada, door 1), never deleting one
 * without a confirmed copy:
 *
 *  - a link anywhere on the way to `from` or to `to` (the last component included) is refused, and so is a path the
 *    filter refuses (`PathAccessError`);
 *  - `to` must not exist, a dangling link included (`EEXIST`);
 *  - `from` is opened `O_NOFOLLOW` and hashed through that descriptor; other bytes than `expectSha256`, or another
 *    file under the name after the open, is `EditConflictError`, before anything moves;
 *  - on one device the file is renamed (the same inode); on another (`EXDEV`) it is written to `to` by
 *    `writeWorkspaceFile(..., { mode: "create" })`, the copy is hashed again from the disk, and only a copy with the
 *    same SHA-256 lets the origin go. A copy that differs is taken away again (only that very file, by device and
 *    inode) and `from` stays.
 *
 * Missing parent folders of `to` are made. The whole file is held in memory for a copy across devices.
 */
export function moveWorkspaceFile(
  scope: ReadScope,
  from: string,
  to: string,
  options: { expectSha256?: string } = {},
): MovedFile {
  assertNoLinkOnTheWay(scope, from);
  // the folders on the way to `to`; a name already at `to` itself, a link included, is `EEXIST`
  assertNoLinkOnTheWay(scope, path.dirname(path.resolve(to)));
  const taken = (at: string): boolean => {
    try {
      fs.lstatSync(at);
      return true;
    } catch {
      return false;
    }
  };
  if (taken(path.resolve(to))) throw destinationExists(to);
  const realTo = assertWritablePath(scope, to);
  const file = openWorkspaceFile(scope, from);
  try {
    const realFrom = file.path;
    const sha256 = file.sha256();
    if (options.expectSha256 !== undefined && sha256 !== options.expectSha256) throw new EditConflictError();
    const stillOrigin = (): boolean => {
      if (process.platform === "win32") return true;
      try {
        const named = fs.lstatSync(realFrom);
        return named.ino === file.stat.ino && named.dev === file.stat.dev;
      } catch {
        return false;
      }
    };
    // The bytes were read through the descriptor: the name must still be that file, or what moves is not what was seen.
    if (!stillOrigin()) throw new EditConflictError();
    fs.mkdirSync(path.dirname(realTo), { recursive: true });
    assertNoLinkOnTheWay(scope, path.dirname(path.resolve(to)));
    if (taken(realTo)) throw destinationExists(to);
    if (assertWritablePath(scope, to) !== realTo) throw changed(to);
    const size = file.stat.size;
    try {
      fs.renameSync(realFrom, realTo);
      return { from: realFrom, to: realTo, sha256, size, how: "rename" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    }
    // Another device: a copy, confirmed by its hash read back from the disk, and only then the origin goes.
    const { bytes } = file.readBytes(size);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== sha256) throw new EditConflictError();
    writeWorkspaceFile(scope, realTo, bytes, { mode: "create", fileMode: file.stat.mode & 0o777 });
    const copy = openWorkspaceFile(scope, realTo);
    try {
      if (copy.sha256() !== sha256 || !stillOrigin()) {
        removeIfStillOurs(realTo, copy.stat);
        throw new EditConflictError();
      }
    } finally {
      copy.close();
    }
    fs.unlinkSync(realFrom);
    return { from: realFrom, to: realTo, sha256, size, how: "copy" };
  } finally {
    file.close();
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

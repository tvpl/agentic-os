import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import { HOME_PRIVATE_DIRS, makeWorkspaceFilter, type WorkspaceFilter } from "../memory/excludes.js";
import { PathAccessError, isInside, realpathLenient } from "./paths.js";

/**
 * The one way the engine reads a file on behalf of a request, a stored record,
 * an indexed file or a directory an agent can write into.
 *
 * Why it exists: a guard written where a call is *written* (the route passes
 * the filter) protects that call and nothing else, so every new reader forgot
 * it (journal, sync plan, recall, ... each served `config/token` through a
 * symlink). The guard now sits where the file is *read*: nothing in `core/src`
 * or `apps/api/src` opens, lists or stats such a path with a raw `fs` call
 * (`tests/security-reads.test.ts` fails the build when one appears), it comes
 * here, and here it is
 *
 *  1. resolved to its REAL path (symlinks and `..` gone),
 *  2. required to sit inside a granted root of the scope,
 *  3. judged by the workspace filter on that real path (the home's `config/`
 *     and `logs/`, hard-blocked directories, secret file names, the user's
 *     excludes), so a link inside `memory/` that points at `config/token` is
 *     refused for what it is, not for where it lies,
 *  4. opened without following a final symlink (`O_NOFOLLOW`) and without
 *     blocking on a pipe (`O_NONBLOCK`),
 *  5. checked again once open (the whole path resolved again must give the
 *     same answer, and the same inode as the descriptor), which closes the
 *     window between the check and the open, and
 *  6. read through a byte cap.
 *
 * A write (`writeWorkspaceFile`) goes through the same door: the path is judged
 * as above, a link of any kind at the last component is refused (a write
 * follows a link wherever it points), the file is opened with `O_NOFOLLOW`
 * and never truncated by the open itself, and the open descriptor is checked
 * against the path before a byte is written.
 *
 * A file with more than one name is judged by what it IS and not by what it is
 * called: when the open descriptor has several links, its (device, inode) is
 * compared with every file under the home's `config/` and `logs/`, so a hard
 * link to `config/token` planted anywhere is refused, read or write.
 *
 * Not covered, and said so in `docs/security.md`: Windows (no `O_NOFOLLOW`; the
 * path checks still apply, and inode numbers are not reliable), and a program
 * the agent runs, which reads whatever its operating-system user can.
 */

/** A file the caller may not read, in a place it may not read it. */
export interface ReadScope {
  /** The MordomoOS home: its `config/` and `logs/` are never inside any scope. */
  readonly homeDir: string;
  /** The home by real path (resolved once, with `realRoots`). */
  readonly realHomeDir: string;
  /** Folders a path must lie in (as given). */
  readonly roots: readonly string[];
  /** The same folders by real path, resolved once when the scope is made (a scope lives for one request or one pass). */
  readonly realRoots: readonly string[];
  readonly filter: WorkspaceFilter;
}

export interface ReadScopeOptions {
  /** Required: without the home the filter cannot tell it from any other folder. */
  homeDir: string;
  roots: readonly string[];
  /** The user's `settings.excludes` globs. */
  excludes?: readonly string[];
  /** Platform whose file-name rules apply (tests only); defaults to this process's. */
  platform?: NodeJS.Platform;
}

export function readScope(options: ReadScopeOptions): ReadScope {
  return {
    homeDir: options.homeDir,
    realHomeDir: realpathLenient(path.resolve(options.homeDir)),
    roots: [...options.roots],
    realRoots: options.roots.map((r) => realpathLenient(path.resolve(r))),
    filter: makeWorkspaceFilter(options.excludes ?? [], {
      homeDir: options.homeDir,
      ...(options.platform ? { platform: options.platform } : {}),
    }),
  };
}

/** Scope of the folders the user granted: the home, the enabled indexed folders and `extraRoots`. */
export function grantedReadScope(
  settings: Settings,
  homeDir: string,
  extraRoots: readonly string[] = [],
  platform?: NodeJS.Platform,
): ReadScope {
  return readScope({
    homeDir,
    roots: [homeDir, ...settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path), ...extraRoots],
    excludes: settings.excludes,
    ...(platform ? { platform } : {}),
  });
}

/** Scope of folders the engine owns inside its home (`memory/`, `skills/`, `artifacts/`, ...). */
export function homeReadScope(
  homeDir: string,
  roots: readonly string[],
  excludes: readonly string[] = [],
): ReadScope {
  return readScope({ homeDir, roots, excludes });
}

/** The path is not a regular file (a directory, a device, a socket). */
export class NotRegularFileError extends Error {
  readonly statusCode = 404;
  readonly code = "not_a_file";
  constructor(public readonly attempted: string) {
    super(`Not a regular file: ${attempted}`);
    this.name = "NotRegularFileError";
  }
}

/** `strict` read of a file past its byte cap. */
export class FileTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = "file_too_large";
  constructor(
    public readonly attempted: string,
    public readonly size: number,
    public readonly maxBytes: number,
  ) {
    super(`File is larger than ${maxBytes} bytes: ${attempted}`);
    this.name = "FileTooLargeError";
  }
}

export interface PathVerdict {
  /** Real path: no symlink in it. */
  real: string;
  /** The granted root that contains it (the longest, when roots nest). */
  root: string;
  /** Path relative to that root. */
  rel: string;
  /** Why the filter refuses it (secret name, protected directory, user exclude); null when readable. */
  blockedReason: string | null;
}

function containingRoot(scope: ReadScope, real: string): string | null {
  const containing = scope.realRoots.filter((r) => isInside(r, real)).sort((a, b) => b.length - a.length);
  return containing[0] ?? null;
}

/**
 * Judge a path without reading it. Throws `PathAccessError` (403) when it lies
 * outside every root of the scope or inside the home's `config/` / `logs/`;
 * other filter verdicts come back as `blockedReason` so a preview can answer
 * "blocked" while an open or a read refuses.
 */
export function inspectPath(scope: ReadScope, candidate: string): PathVerdict {
  const real = realpathLenient(path.resolve(candidate));
  const root = containingRoot(scope, real);
  if (root === null) throw new PathAccessError(candidate);
  const rel = path.relative(root, real);
  const homePrivate = scope.filter.homePrivateReason(real);
  if (homePrivate) throw new PathAccessError(candidate, homePrivate);
  return { real, root, rel, blockedReason: scope.filter.reasonToSkip(rel, real) };
}

/** Like `inspectPath`, but any refusal throws; returns the real path. */
export function resolveReadable(scope: ReadScope, candidate: string): PathVerdict {
  const verdict = inspectPath(scope, candidate);
  if (verdict.blockedReason) throw new PathAccessError(candidate, verdict.blockedReason);
  return verdict;
}

/**
 * The working directory rule: inside a granted root, outside the home's
 * `config/` and `logs/`, and not a directory that holds them. (A run may start
 * in a `.git`-named folder or a folder the user excluded from the index; it may
 * not start next to the token.) An agent reads everything under its working
 * directory without being asked, so the home itself, and any folder the user
 * granted that contains the home, are as private as `config/` is: the answer
 * for them is 403. `RunManager` applies this to every run it creates or
 * launches, and maps the home itself to its default working directory first.
 */
export function resolveWorkspaceCwd(scope: ReadScope, cwd: string): string {
  const real = inspectPath(scope, cwd).real;
  assertHoldsNoPrivateFolder(scope, real);
  return real;
}

export const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
export const O_NONBLOCK = fs.constants.O_NONBLOCK ?? 0;

/** An open, verified file. The descriptor belongs to it: call `close()` or hand it to `createReadStream()`. */
export interface WorkspaceFile {
  /** Real path of the file. */
  readonly path: string;
  readonly root: string;
  readonly rel: string;
  /** `fstat` of the open descriptor (not of the path). */
  readonly stat: fs.Stats;
  /** Up to `maxBytes` bytes from the start; `truncated` when the file is longer. */
  readBytes(maxBytes: number): { bytes: Buffer; truncated: boolean };
  /** SHA-256 of the whole file, read in chunks (any size). */
  sha256(): string;
  /** The stream owns the descriptor and closes it at the end. */
  createReadStream(): fs.ReadStream;
  close(): void;
}

/** Most files looked at when asking whether an inode belongs to the home's private folders; past it the answer is "yes". */
const MAX_PRIVATE_WALK = 20_000;

/**
 * Whether `stat` (of an open descriptor) is one of the files under the home's
 * `config/` or `logs/`, however many names it has. Only a file with more than
 * one link can be a second name for another file, so only those pay for the
 * walk; the walk never follows a link. A tree too large to walk counts as a
 * match: the answer errs towards refusing.
 */
export function sharesInodeWithPrivateFile(scope: ReadScope, stat: fs.Stats): boolean {
  if (stat.nlink <= 1 || process.platform === "win32") return false;
  let seen = 0;
  const walk = (dir: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (++seen > MAX_PRIVATE_WALK) return true;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(full)) return true;
      } else if (entry.isFile()) {
        try {
          const other = fs.lstatSync(full);
          if (other.ino === stat.ino && other.dev === stat.dev) return true;
        } catch {
          /* removed in between */
        }
      }
    }
    return false;
  };
  return HOME_PRIVATE_DIRS.some((name) => walk(path.join(scope.realHomeDir, name)));
}

export function hardLinked(candidate: string): PathAccessError {
  return new PathAccessError(candidate, `Refusing a second name for a private file: ${candidate}`);
}

export function changed(candidate: string): PathAccessError {
  return new PathAccessError(candidate, `Path changed while it was being opened: ${candidate}`);
}

/**
 * Open a file for reading after the checks in the header comment. Throws
 * `PathAccessError` (403) when the scope does not grant it, `NotRegularFileError`
 * for a directory or device, and the plain `ENOENT` when it does not exist.
 */
export function openWorkspaceFile(scope: ReadScope, candidate: string): WorkspaceFile {
  const verdict = resolveReadable(scope, candidate);
  let fd: number;
  try {
    fd = fs.openSync(verdict.real, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ELOOP/EMLINK: the last component became a symlink after the check.
    if (code === "ELOOP" || code === "EMLINK") throw changed(candidate);
    throw err;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new NotRegularFileError(candidate);
    if (sharesInodeWithPrivateFile(scope, stat)) throw hardLinked(candidate);
    // The window between the realpath above and the open: re-resolve the whole path and require the same
    // answer, and the same inode behind it. A folder on the way or the file itself swapped for a link, or
    // the file replaced, after the first check shows here and nothing is returned.
    const again = resolveReadable(scope, candidate);
    if (again.real !== verdict.real) throw changed(candidate);
    if (process.platform !== "win32") {
      const named = fs.lstatSync(verdict.real);
      if (named.ino !== stat.ino || named.dev !== stat.dev) throw changed(candidate);
    }
    let owned = true;
    return {
      path: verdict.real,
      root: verdict.root,
      rel: verdict.rel,
      stat,
      readBytes(maxBytes) {
        const want = Math.min(stat.size, Math.max(0, maxBytes));
        const buf = Buffer.alloc(want);
        let filled = 0;
        while (filled < want) {
          const n = fs.readSync(fd, buf, filled, want - filled, filled);
          if (n === 0) break;
          filled += n;
        }
        return { bytes: buf.subarray(0, filled), truncated: stat.size > maxBytes };
      },
      sha256() {
        const hash = crypto.createHash("sha256");
        const chunk = Buffer.alloc(1024 * 1024);
        let position = 0;
        for (;;) {
          const n = fs.readSync(fd, chunk, 0, chunk.length, position);
          if (n === 0) break;
          hash.update(chunk.subarray(0, n));
          position += n;
        }
        return hash.digest("hex");
      },
      createReadStream() {
        owned = false;
        return fs.createReadStream(verdict.real, { fd, autoClose: true });
      },
      close() {
        if (!owned) return;
        owned = false;
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      },
    };
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
}

export interface ReadOptions {
  /** Bytes read at most. Required: no reader is unbounded. */
  maxBytes: number;
  /** Throw `FileTooLargeError` instead of returning a truncated read. */
  strict?: boolean;
}

export interface BytesRead {
  path: string;
  size: number;
  truncated: boolean;
  bytes: Buffer;
}

export function readWorkspaceFile(scope: ReadScope, candidate: string, options: ReadOptions): BytesRead {
  const file = openWorkspaceFile(scope, candidate);
  try {
    if (options.strict && file.stat.size > options.maxBytes) {
      throw new FileTooLargeError(candidate, file.stat.size, options.maxBytes);
    }
    const { bytes, truncated } = file.readBytes(options.maxBytes);
    return { path: file.path, size: file.stat.size, truncated, bytes };
  } finally {
    file.close();
  }
}

export interface TextRead {
  path: string;
  size: number;
  truncated: boolean;
  text: string;
}

export function readWorkspaceText(scope: ReadScope, candidate: string, options: ReadOptions): TextRead {
  const read = readWorkspaceFile(scope, candidate, options);
  return { path: read.path, size: read.size, truncated: read.truncated, text: read.bytes.toString("utf8") };
}

/** Metadata of a path the scope grants (never of a link's target outside it). */
export function statWorkspacePath(scope: ReadScope, candidate: string): { path: string; stat: fs.Stats } {
  const verdict = resolveReadable(scope, candidate);
  return { path: verdict.real, stat: fs.lstatSync(verdict.real) };
}

/**
 * A path the engine is about to WRITE (a sync target, a backup copy): it must
 * be inside the scope, pass the filter and not be a link of any kind, a
 * dangling one included, because a write follows a link wherever it points.
 * Returns the real path.
 */
export function assertWritablePath(scope: ReadScope, candidate: string): string {
  const verdict = resolveReadable(scope, candidate);
  let isLink = false;
  try {
    isLink = fs.lstatSync(path.resolve(candidate)).isSymbolicLink();
  } catch {
    /* does not exist yet: nothing to follow */
  }
  if (isLink) throw new PathAccessError(candidate, `Refusing to write through a link: ${candidate}`);
  return verdict.real;
}

export function assertHoldsNoPrivateFolder(scope: ReadScope, dir: string): void {
  // Decided by the filter, which compares names as the platform's file system does (case-folded on macOS and Windows).
  const reason = scope.filter.holdsHomePrivateDir(dir);
  if (reason) throw new PathAccessError(dir, `${reason} ${dir}`);
}

/** Whether `real` is the MordomoOS home itself (platform-aware, see `WorkspaceFilter.isHomeDir`). */
export function isHomeDirectory(scope: ReadScope, real: string): boolean {
  return scope.filter.isHomeDir(real);
}

export interface WorkspaceEntry {
  name: string;
  /** Real path of the entry (its parent's real path + its name). */
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

/**
 * The entries of a directory the scope grants, minus symlinks, minus what the
 * filter refuses (secret names, protected directories, excludes) and minus any
 * second name for a file under the home's `config/` or `logs/`. Never follows
 * a link.
 */
export function listWorkspaceDir(scope: ReadScope, candidate: string): WorkspaceEntry[] {
  const verdict = resolveReadable(scope, candidate);
  const out: WorkspaceEntry[] = [];
  for (const entry of fs.readdirSync(verdict.real, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
    const full = path.join(verdict.real, entry.name);
    if (scope.filter.reasonToSkip(path.relative(verdict.root, full), full)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue; // removed in between
    }
    if (stat.isSymbolicLink()) continue;
    if (sharesInodeWithPrivateFile(scope, stat)) continue; // a second name for a private file is not listed either
    out.push({
      name: entry.name,
      path: full,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  return out;
}

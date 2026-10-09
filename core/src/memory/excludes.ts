import path from "node:path";
import { isSecretFile, makeExcludeMatcher, realpathLenient } from "../security/paths.js";

/**
 * Workspace exclusion policy shared by the indexer, the preview and the
 * "open with OS" route, so no code path can read what another one refuses.
 *
 * Four layers, all evaluated before any content is read:
 *  1. the user's `settings.excludes` glob list (per path segment);
 *  2. a hard directory blocklist that the user cannot switch off;
 *  3. the secret-file basename patterns (`.env`, `*.pem`, `id_rsa*`, …);
 *  4. the MordomoOS home's own `config/` and `logs/` (token, VAPID key, signing
 *     key, database, prompts and outputs), decided on the real path.
 */

/** Directories never read, whatever the settings say — matched on any path segment. */
export const HARD_BLOCKED_DIRS: ReadonlyArray<string> = [
  ".git",
  ".aws",
  ".ssh",
  ".gnupg",
  ".kube",
  ".docker",
  "node_modules",
];

const HARD_BLOCKED = new Set(HARD_BLOCKED_DIRS.map((d) => d.toLowerCase()));

/**
 * Directories of the MordomoOS home that hold credentials and run output. Unlike
 * `HARD_BLOCKED_DIRS` they are matched only as direct children of the home
 * (`<home>/config`, `<home>/logs`): a `config/` folder inside a user's project
 * stays readable.
 */
export const HOME_PRIVATE_DIRS: ReadonlyArray<string> = ["config", "logs"];

/** Maximum bytes sniffed for a NUL byte when deciding text vs binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

function segmentsOf(p: string): string[] {
  return p.split(/[\\/]/).filter(Boolean);
}

/** True when any segment of `p` (absolute or relative) is on the hard blocklist. */
export function isHardBlockedPath(p: string): boolean {
  return segmentsOf(p).some((seg) => HARD_BLOCKED.has(seg.toLowerCase()));
}

/** Name of the first hard-blocked segment in `p`, or null. */
export function hardBlockedSegment(p: string): string | null {
  return segmentsOf(p).find((seg) => HARD_BLOCKED.has(seg.toLowerCase())) ?? null;
}

/**
 * Content-based binary detection: a NUL byte in the first 8 KiB. Extension
 * lists are only a hint; this check is what decides whether bytes are indexed
 * or previewed as text.
 */
export function isBinaryBuffer(buf: Uint8Array): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface WorkspaceFilterOptions {
  /**
   * The MordomoOS home. Its `config/` and `logs/` are never served. Required, so
   * that leaving it out is a type error rather than a silent hole: `null` says
   * "this filter judges names only and reads nothing" (the file watcher).
   */
  homeDir: string | null;
  /** Platform whose file-name rules apply; defaults to this process's. Case-insensitive on darwin and win32. */
  platform?: NodeJS.Platform;
}

export interface WorkspaceFilter {
  /** Why a path must not be read, or null when it may. `rel` is relative to its root. */
  reasonToSkip(rel: string, absolute?: string): string | null;
  /** Convenience boolean form of `reasonToSkip`. */
  isExcluded(rel: string, absolute?: string): boolean;
  /**
   * Why `absolute` lies inside the home's private directories, or null. Callers
   * that answer an API request turn this into a 403 rather than a "blocked" body.
   */
  homePrivateReason(absolute: string): string | null;
}

/** Segments as the platform's file system compares them: case-folded, and without the trailing dots/spaces Windows drops. */
function comparableSegments(p: string, platform: NodeJS.Platform): string[] {
  const insensitive = platform === "darwin" || platform === "win32";
  return segmentsOf(p).map((seg) => {
    const trimmed = platform === "win32" ? seg.replace(/[. ]+$/, "") : seg;
    return insensitive ? trimmed.toLowerCase() : trimmed;
  });
}

/**
 * The home's private directories as comparable segment lists, spelled both
 * lexically and by real path (a symlinked home or a symlinked `config/` is the
 * same directory under either name).
 */
function homePrivateDirs(homeDir: string, platform: NodeJS.Platform): Array<{ name: string; segs: string[] }> {
  const found = new Map<string, { name: string; segs: string[] }>();
  const realHome = realpathLenient(homeDir);
  for (const name of HOME_PRIVATE_DIRS) {
    const spellings = [
      path.join(path.resolve(homeDir), name),
      path.join(realHome, name),
      realpathLenient(path.join(homeDir, name)),
    ];
    for (const spelling of spellings) {
      const segs = comparableSegments(spelling, platform);
      found.set(segs.join("/"), { name, segs });
    }
  }
  return [...found.values()];
}

/**
 * Build the combined matcher for a settings `excludes` list. `rel` is matched
 * against the user globs and the hard blocklist; `absolute` (when given) is
 * additionally checked against the hard blocklist so a root that itself sits
 * under `.git/` or `.ssh/` is refused too, and against the home's private
 * directories. For the latter `absolute` must be the real path (callers resolve
 * symlinks first): the comparison is by path, not by name.
 */
export function makeWorkspaceFilter(
  excludes: ReadonlyArray<string>,
  options: WorkspaceFilterOptions,
): WorkspaceFilter {
  const userMatch = makeExcludeMatcher([...excludes]);
  const platform = options.platform ?? process.platform;
  const privateDirs = options.homeDir ? homePrivateDirs(options.homeDir, platform) : [];
  const homePrivateReason = (absolute: string): string | null => {
    if (privateDirs.length === 0 || !path.isAbsolute(absolute)) return null;
    const segs = comparableSegments(path.resolve(absolute), platform);
    const hit = privateDirs.find((dir) => dir.segs.every((seg, i) => segs[i] === seg));
    return hit ? `Path is inside the MordomoOS ${hit.name}/ folder, which holds credentials and is never served.` : null;
  };
  const reasonToSkip = (rel: string, absolute?: string): string | null => {
    const blocked = hardBlockedSegment(absolute ?? rel) ?? hardBlockedSegment(rel);
    if (blocked) return `Path is inside a protected directory (${blocked}/) and is never read.`;
    const homePrivate = absolute ? homePrivateReason(absolute) : null;
    if (homePrivate) return homePrivate;
    if (isSecretFile(path.basename(absolute ?? rel))) {
      return "This file matches the secret-file blocklist and is never read.";
    }
    if (rel && userMatch(rel)) return "This path matches the exclusion list in Settings.";
    return null;
  };
  return {
    reasonToSkip,
    isExcluded: (rel, absolute) => reasonToSkip(rel, absolute) !== null,
    homePrivateReason,
  };
}

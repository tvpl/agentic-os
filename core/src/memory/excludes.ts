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

// ---- the access of folders (.specs/features/cerebro-memoria-confiavel, door 12) ------------------------------------

/** The levels, from the one that lets most through to the one that lets nothing through. */
const LEVEL_ORDER = ["write", "read", "hide"] as const;
export type AccessLevel = (typeof LEVEL_ORDER)[number];

/** The stricter of two levels. */
export function stricterLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

/**
 * One entry of the access of folders, as the filter applies it: the absolute spellings that name the folder (its real
 * path and the path as written) and its level for one audience. No spelling at all covers every path (the `"*"` an
 * unreadable list reads as).
 */
export interface AccessRule {
  spellings: string[];
  level: AccessLevel;
  /** Covers every path: the entry `"*"`. */
  all?: boolean;
}

/**
 * The level the rules give a path, as comparable segments: the rule whose spelling is the longest prefix of it by whole
 * segments decides (so `notes/fin` covers `notes/fin/a.md` and not `notes/fin2/`); two rules as specific give the
 * stricter of their levels; no rule gives `write`.
 */
export function decideLevel(
  rules: ReadonlyArray<{ segs: ReadonlyArray<readonly string[]>; level: AccessLevel; all?: boolean }>,
  segs: readonly string[],
): AccessLevel {
  let best: AccessLevel | null = null;
  let bestLength = -1;
  for (const rule of rules) {
    const lengths = rule.all ? [0] : rule.segs.filter((s) => s.length <= segs.length && s.every((seg, i) => segs[i] === seg)).map((s) => s.length);
    for (const length of lengths) {
      if (length > bestLength) {
        best = rule.level;
        bestLength = length;
      } else if (length === bestLength && best !== null) {
        best = stricterLevel(best, rule.level);
      }
    }
  }
  return best ?? "write";
}

/**
 * The marker an access view of the settings adds to `excludes` (`core/src/memory/folderAccess.ts`): every filter made
 * from that list (`makeWorkspaceFilter`, so every read scope and every stored-row filter) then refuses a path the rules
 * give `hide`, and the paths of `deny` whatever the rules say. It starts with a NUL, which no glob of the owner holds and
 * no path segment matches, so a filter that did not know it would refuse nothing more and nothing less than before.
 */
const ACCESS_MARK = "\u0000folder-access:";

export interface AccessMark {
  rules: AccessRule[];
  /** Folders hidden whatever the rules say (`artifacts/exports/` for a device, G11). */
  deny: string[];
}

/** The `excludes` entry that carries `mark`. */
export function accessExclude(mark: AccessMark): string {
  return ACCESS_MARK + JSON.stringify(mark);
}

/** Whether an `excludes` entry is an access mark rather than a glob of the owner. */
export function isAccessExclude(entry: string): boolean {
  return entry.startsWith(ACCESS_MARK);
}

/**
 * The test an access mark makes of an absolute path: true when it is hidden. A mark that cannot be read hides every
 * path (fail closed), and so does a path that is not absolute: there is nothing to judge it by.
 */
function accessHider(entries: readonly string[], platform: NodeJS.Platform): ((absolute: string | undefined) => boolean) | null {
  const marks = entries.filter(isAccessExclude);
  if (marks.length === 0) return null;
  const parsed: Array<{ rules: Array<{ segs: string[][]; level: AccessLevel; all?: boolean }>; deny: string[][] } | null> =
    marks.map((entry) => {
      try {
        const mark = JSON.parse(entry.slice(ACCESS_MARK.length)) as AccessMark;
        if (!Array.isArray(mark.rules) || !Array.isArray(mark.deny)) return null;
        return {
          rules: mark.rules.map((rule) => ({
            segs: rule.spellings.map((s) => comparableSegments(path.resolve(s), platform)),
            level: LEVEL_ORDER.includes(rule.level) ? rule.level : "hide",
            ...(rule.all ? { all: true } : {}),
          })),
          deny: mark.deny.map((d) => comparableSegments(path.resolve(d), platform)),
        };
      } catch {
        return null;
      }
    });
  return (absolute) => {
    if (absolute === undefined || !path.isAbsolute(absolute)) return true;
    const segs = comparableSegments(path.resolve(absolute), platform);
    return parsed.some(
      (mark) =>
        mark === null ||
        mark.deny.some((d) => d.length <= segs.length && d.every((seg, i) => segs[i] === seg)) ||
        decideLevel(mark.rules, segs) === "hide",
    );
  };
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
  /**
   * Why a folder cannot be an agent's working directory or an import source because it HOLDS the home's private
   * directories (it is the home, or a folder above it), or null. Compared as the platform's file system compares
   * names, like `homePrivateReason`: on macOS and Windows `<base>/.MORDOMO` is the home.
   */
  holdsHomePrivateDir(absolute: string): string | null;
  /** Whether `absolute` (a real path) is the MordomoOS home itself, by the same comparison. */
  isHomeDir(absolute: string): boolean;
}

/**
 * Segments as the platform's file system compares them: case-folded, without the trailing dots/spaces Windows
 * drops, and on macOS in one Unicode form (APFS and HFS+ treat `é` written as one character or as `e` plus an
 * accent as the same name).
 */
export function comparableSegments(p: string, platform: NodeJS.Platform = process.platform): string[] {
  const insensitive = platform === "darwin" || platform === "win32";
  return segmentsOf(p).map((seg) => {
    const trimmed = platform === "win32" ? seg.replace(/[. ]+$/, "") : seg;
    const composed = platform === "darwin" ? trimmed.normalize("NFC") : trimmed;
    return insensitive ? composed.toLowerCase() : composed;
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
  const platform = options.platform ?? process.platform;
  const userMatch = makeExcludeMatcher(excludes.filter((entry) => !isAccessExclude(entry)));
  const hidden = accessHider(excludes, platform);
  const privateDirs = options.homeDir ? homePrivateDirs(options.homeDir, platform) : [];
  const homePrivateReason = (absolute: string): string | null => {
    if (privateDirs.length === 0 || !path.isAbsolute(absolute)) return null;
    const segs = comparableSegments(path.resolve(absolute), platform);
    const hit = privateDirs.find((dir) => dir.segs.every((seg, i) => segs[i] === seg));
    return hit ? `Path is inside the MordomoOS ${hit.name}/ folder, which holds credentials and is never served.` : null;
  };
  const homeSpellings = options.homeDir
    ? [path.resolve(options.homeDir), realpathLenient(options.homeDir)].map((p) => comparableSegments(p, platform))
    : [];
  const holdsHomePrivateDir = (absolute: string): string | null => {
    if (privateDirs.length === 0 || !path.isAbsolute(absolute)) return null;
    const segs = comparableSegments(path.resolve(absolute), platform);
    const hit = privateDirs.find((dir) => segs.length <= dir.segs.length && segs.every((seg, i) => dir.segs[i] === seg));
    return hit ? `Folder would hold the MordomoOS ${hit.name}/ folder, which holds credentials.` : null;
  };
  const isHomeDir = (absolute: string): boolean => {
    if (!path.isAbsolute(absolute)) return false;
    const segs = comparableSegments(path.resolve(absolute), platform);
    return homeSpellings.some((home) => home.length === segs.length && home.every((seg, i) => segs[i] === seg));
  };
  const reasonToSkip = (rel: string, absolute?: string): string | null => {
    const blocked = hardBlockedSegment(absolute ?? rel) ?? hardBlockedSegment(rel);
    if (blocked) return `Path is inside a protected directory (${blocked}/) and is never read.`;
    if (hidden?.(absolute)) return "This folder is hidden from this caller (its access in Settings › Memory).";
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
    holdsHomePrivateDir,
    isHomeDir,
  };
}

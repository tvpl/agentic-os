import path from "node:path";
import { isSecretFile, makeExcludeMatcher } from "../security/paths.js";

/**
 * Workspace exclusion policy shared by the indexer, the preview and the
 * "open with OS" route, so no code path can read what another one refuses.
 *
 * Three layers, all evaluated before any content is read:
 *  1. the user's `settings.excludes` glob list (per path segment);
 *  2. a hard directory blocklist that the user cannot switch off;
 *  3. the secret-file basename patterns (`.env`, `*.pem`, `id_rsa*`, …).
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

export interface WorkspaceFilter {
  /** Why a path must not be read, or null when it may. `rel` is relative to its root. */
  reasonToSkip(rel: string, absolute?: string): string | null;
  /** Convenience boolean form of `reasonToSkip`. */
  isExcluded(rel: string, absolute?: string): boolean;
}

/**
 * Build the combined matcher for a settings `excludes` list. `rel` is matched
 * against the user globs and the hard blocklist; `absolute` (when given) is
 * additionally checked against the hard blocklist so a root that itself sits
 * under `.git/` or `.ssh/` is refused too.
 */
export function makeWorkspaceFilter(excludes: ReadonlyArray<string>): WorkspaceFilter {
  const userMatch = makeExcludeMatcher([...excludes]);
  const reasonToSkip = (rel: string, absolute?: string): string | null => {
    const blocked = hardBlockedSegment(absolute ?? rel) ?? hardBlockedSegment(rel);
    if (blocked) return `Path is inside a protected directory (${blocked}/) and is never read.`;
    if (isSecretFile(path.basename(absolute ?? rel))) {
      return "This file matches the secret-file blocklist and is never read.";
    }
    if (rel && userMatch(rel)) return "This path matches the exclusion list in Settings.";
    return null;
  };
  return {
    reasonToSkip,
    isExcluded: (rel, absolute) => reasonToSkip(rel, absolute) !== null,
  };
}

import fs from "node:fs";
import path from "node:path";
import { PathAccessError } from "../errors.js";

export { PathAccessError };

/** True when `child` is `parent` or inside it (after resolution). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True when `candidate` is inside (or equal to) at least one of `roots`. */
export function isInsideAny(roots: string[], candidate: string): boolean {
  return roots.some((root) => isInside(root, candidate));
}

/**
 * Resolve a user-supplied path and require containment inside one of the
 * granted roots. Follows symlinks (realpath) so a link cannot escape the root.
 * Throws on violation — callers turn this into a 403.
 */
export function resolveInsideRoots(roots: readonly string[], candidate: string): string {
  const real = realpathLenient(path.resolve(candidate));
  for (const root of roots) {
    if (isInside(realpathLenient(path.resolve(root)), real)) return real;
  }
  throw new PathAccessError(candidate);
}

/**
 * The one `realpath` of the engine, for paths that may not exist yet: symlinks
 * are resolved in the deepest existing ancestor and the missing tail is
 * re-appended, so a symlinked parent directory cannot smuggle a new file
 * outside the granted roots. A path with no existing ancestor comes back
 * resolved (absolute, `..` folded) but otherwise as given.
 */
export function realpathLenient(absolute: string): string {
  const resolved = path.resolve(absolute);
  let head = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail);
    } catch {
      // A dangling symlink or a missing component: walk up to what exists.
      const parent = path.dirname(head);
      if (parent === head) return resolved;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

/**
 * Exclusion matcher. Patterns are matched against every path segment and the
 * relative path: `node_modules` excludes any segment with that name;
 * `.env.*`/`*.pem` glob against segment names.
 */
export function makeExcludeMatcher(patterns: string[]): (relPath: string) => boolean {
  const regexes = patterns.map((p) => globToRegex(p));
  return (relPath: string) => {
    const segments = relPath.split(/[\\/]/).filter(Boolean);
    return segments.some((seg) => regexes.some((re) => re.test(seg)));
  };
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.+^${}()|[\]\\?]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

/** Files that must never be read/previewed even inside granted roots. */
export const SECRET_FILE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  "*.keystore",
  "credentials*.json",
  ".credentials*",
  ".npmrc",
  ".netrc",
  "*.token",
];

const secretMatcher = makeExcludeMatcher(SECRET_FILE_PATTERNS);
export function isSecretFile(filePath: string): boolean {
  return secretMatcher(path.basename(filePath));
}

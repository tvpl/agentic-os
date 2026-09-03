import fs from "node:fs";
import path from "node:path";

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
export function resolveInsideRoots(roots: string[], candidate: string): string {
  const real = realpathLenient(path.resolve(candidate));
  for (const root of roots) {
    const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    if (isInside(realRoot, real)) return real;
  }
  throw new PathAccessError(candidate);
}

/**
 * `realpath` for paths that may not exist yet: symlinks are resolved in the
 * deepest existing ancestor and the missing tail is re-appended, so a symlinked
 * parent directory cannot smuggle a new file outside the granted roots.
 */
function realpathLenient(absolute: string): string {
  let head = absolute;
  const tail: string[] = [];
  while (!fs.existsSync(head)) {
    const parent = path.dirname(head);
    if (parent === head) return absolute;
    tail.unshift(path.basename(head));
    head = parent;
  }
  return path.join(fs.realpathSync(head), ...tail);
}

export class PathAccessError extends Error {
  /** HTTP status the API should map this to. */
  readonly statusCode = 403;
  constructor(
    public readonly attempted: string,
    message?: string,
  ) {
    super(message ?? `Path is outside the granted folders: ${attempted}`);
    this.name = "PathAccessError";
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

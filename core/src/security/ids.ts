import path from "node:path";
import { isInside } from "./paths.js";

/**
 * Identifier validation shared by every file-backed store (routines,
 * connectors, skills). An id becomes a file or directory name, so it must be
 * a single safe path segment: no separators, no `..`, no leading dot.
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}$/;

/** Thrown for ids that could escape (or be ambiguous inside) a store directory. */
export class InvalidIdError extends Error {
  readonly statusCode = 400;
  constructor(
    public readonly id: unknown,
    public readonly label = "id",
  ) {
    super(
      `Invalid ${label}: ${typeof id === "string" ? JSON.stringify(id) : String(id)} ` +
        "(use lowercase letters, digits, '.', '_' or '-'; max 81 chars; no separators)",
    );
    this.name = "InvalidIdError";
  }
}

export function isValidId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    ID_PATTERN.test(id) &&
    !id.includes("..") &&
    !id.includes("/") &&
    !id.includes("\\")
  );
}

/** Validate an id and return it typed as string; throws InvalidIdError (400). */
export function assertValidId(id: unknown, label = "id"): string {
  if (!isValidId(id)) throw new InvalidIdError(id, label);
  return id;
}

/**
 * Resolve `<dir>/<id><suffix>` and assert the result stays strictly inside
 * `dir` (defence in depth on top of the regex — e.g. against future regex
 * loosening). Returns the absolute path.
 */
export function resolveInsideDir(dir: string, id: string, suffix = "", label = "id"): string {
  assertValidId(id, label);
  const base = path.resolve(dir);
  const target = path.resolve(base, `${id}${suffix}`);
  if (target === base || !isInside(base, target) || path.dirname(target) !== base) {
    throw new InvalidIdError(id, label);
  }
  return target;
}

import type { ZodIssue, ZodTypeAny, z } from "zod";

/** One value `parseTolerant` took out of a document, and why the schema refused it. */
export interface SettingsIssue {
  /** Dot-separated path of the value (`limits.maxConcurrentRuns`, `indexedFolders.1.path`). */
  path: string;
  reason: string;
}

type Container = Record<string, unknown> | unknown[];

function valueAt(doc: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

/**
 * Parse `raw` with `schema`, taking out - not repairing, not rejecting the whole document over - every value the
 * schema refuses. A refused property is deleted (the schema's own default then applies, exactly as for a property
 * that was never written), a refused array element is removed and the others keep their order, and when the
 * refusal is a required key that is missing, the object that lacks it goes (an `indexedFolders` entry without
 * `path` is no folder). What stays is what the schema accepts, with the values the file had.
 *
 * Throws the schema's own error when nothing can be taken out (the document itself is not what the schema
 * describes), so a caller still has one failure to report. The input is not modified.
 */
export function parseTolerant<S extends ZodTypeAny>(
  schema: S,
  raw: unknown,
): { value: z.output<S>; issues: SettingsIssue[] } {
  const doc = structuredClone(raw);
  const issues: SettingsIssue[] = [];
  // Each round removes at least one value from a finite document, so the bound is only a guard.
  for (let round = 0; round < 1000; round++) {
    const parsed = schema.safeParse(doc);
    if (parsed.success) return { value: parsed.data, issues };
    const issue: ZodIssue = parsed.error.issues[0]!;
    // A missing key has nothing to delete: the object that needs it is what goes.
    let path = issue.path;
    while (path.length > 0 && valueAt(doc, path) === undefined) path = path.slice(0, -1);
    if (path.length === 0) throw parsed.error;
    const parent = valueAt(doc, path.slice(0, -1)) as Container;
    const key = path[path.length - 1]!;
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete (parent as Record<string, unknown>)[String(key)];
    issues.push({ path: path.join("."), reason: issue.message });
  }
  throw new Error("parseTolerant: the document did not settle");
}

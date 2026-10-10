import type { ZodTypeAny, z } from "zod";

/** One value `parseTolerant` took out of a document, and why the schema refused it. */
export interface SettingsIssue {
  /** Dot-separated path of the value (`limits.maxConcurrentRuns`, `indexedFolders.1.path`). */
  path: string;
  reason: string;
  /** The field is a security field: it reads as its fail-closed value, not as the schema's default. */
  closed?: true;
}

/**
 * A field whose unreadable value must read as something safer than the schema's default (see
 * `failClosed.ts`). `path` is dot-separated and `*` stands for any array index or record key; the rule also
 * fires for a value anywhere below the path (an element of a list) and for an ancestor that was dropped whole.
 * `closed` is the value to read, or a function of the unreadable value found there (undefined when a parent was
 * dropped whole) for a field whose readable part is worth keeping. `also` sets siblings of the field at the same
 * time (`sibling` is a key of the field's parent).
 */
export interface FailClosedField {
  path: string;
  closed: unknown | ((unreadable: unknown) => unknown);
  also?: ReadonlyArray<{ sibling: string; value: unknown }>;
}

export interface TolerantOptions {
  failClosed?: readonly FailClosedField[];
  /** More invalid values than this and the document is not worth repairing: it reads as the closed defaults. */
  maxInvalid?: number;
}

export const DEFAULT_MAX_INVALID = 5000;

type Path = readonly PropertyKey[];

function valueAt(doc: unknown, path: Path): unknown {
  let node: unknown = doc;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

function setAt(doc: unknown, path: Path, value: unknown): void {
  const parent = valueAt(doc, path.slice(0, -1)) as Record<PropertyKey, unknown> | undefined;
  if (parent !== undefined && parent !== null && typeof parent === "object") {
    parent[path[path.length - 1]!] = value;
  }
}

const closedValue = (rule: FailClosedField, unreadable: unknown): unknown =>
  typeof rule.closed === "function" ? (rule.closed as (value: unknown) => unknown)(unreadable) : rule.closed;
const segments = (rule: FailClosedField): string[] => rule.path.split(".");
const covers = (pattern: readonly string[], path: Path): boolean =>
  pattern.length <= path.length && pattern.every((segment, i) => segment === "*" || segment === String(path[i]));
const hasWildcard = (rule: FailClosedField): boolean => segments(rule).includes("*");

/** The closed values of the rules that sit below `path` (none with a `*`: nothing below a dropped parent has one). */
function closedBelow(
  rules: readonly FailClosedField[],
  path: Path,
  /** The document these values replace parts of, when what it holds is to be kept (a rule that keeps readable entries). */
  raw?: unknown,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const rule of rules) {
    const pattern = segments(rule);
    if (hasWildcard(rule) || pattern.length <= path.length || !path.every((key, i) => String(key) === pattern[i])) continue;
    const put = (keys: string[], value: unknown) => {
      let node = out;
      keys.slice(path.length, -1).forEach((key) => {
        node = (node[key] ??= {}) as Record<string, unknown>;
      });
      node[keys[keys.length - 1]!] = value;
    };
    put(pattern, closedValue(rule, raw === undefined ? undefined : valueAt(raw, pattern)));
    for (const also of rule.also ?? []) put([...pattern.slice(0, -1), also.sibling], also.value);
    any = true;
  }
  return any ? out : undefined;
}

/**
 * Parse `raw` with `schema`, taking out - not repairing, not rejecting the whole document over - every value the
 * schema refuses. A refused property is deleted (the schema's default then applies, exactly as for a property
 * that was never written), a refused array element is removed and the others keep their order, and when the
 * refusal is a required key that is missing, the object that lacks it goes (an `indexedFolders` entry without
 * `path` is no folder). What stays is what the schema accepts, with the values the file had.
 *
 * Except for the fields in `failClosed`: a refused value there is replaced by the field's closed value instead,
 * wherever the refusal happened (the value, a list element, or a parent that was dropped whole).
 *
 * Every pass takes out ALL the values the schema just refused (array elements from the end, so indexes hold), so
 * the work grows with the document, not with the number of invalid values. A document with more than
 * `maxInvalid` of them is not repaired: it reads as the schema's defaults with every closed value applied
 * (`overflow`). Throws the schema's own error only when the document itself is not what the schema describes.
 * The input is not modified.
 */
export function parseTolerant<S extends ZodTypeAny>(
  schema: S,
  raw: unknown,
  options: TolerantOptions = {},
): { value: z.output<S>; issues: SettingsIssue[]; overflow: boolean } {
  const rules = options.failClosed ?? [];
  const max = options.maxInvalid ?? DEFAULT_MAX_INVALID;
  const doc = structuredClone(raw);
  const issues: SettingsIssue[] = [];
  const closedAt = new Set<string>();
  for (;;) {
    const parsed = schema.safeParse(doc);
    if (parsed.success) return { value: parsed.data, issues, overflow: false };
    if (issues.length + parsed.error.issues.length > max) {
      return {
        value: closedDefaults(schema, rules, raw),
        issues: [{ path: "(document)", reason: `more than ${max} invalid values: read as the closed defaults` }],
        overflow: true,
      };
    }

    // Where each refusal lands: the value itself, or - a required key that is missing has nothing to delete - the
    // object that needs it. A refusal below another one goes with its ancestor.
    const reasons = new Map<string, { path: PropertyKey[]; reason: string }>();
    for (const issue of parsed.error.issues) {
      let path: PropertyKey[] = issue.path;
      while (path.length > 0 && valueAt(doc, path) === undefined) path = path.slice(0, -1);
      if (path.length === 0) throw parsed.error;
      const key = JSON.stringify(path);
      if (!reasons.has(key)) reasons.set(key, { path, reason: issue.message });
    }
    const targets = [...reasons.entries()].sort(([, a], [, b]) => a.path.length - b.path.length);
    const taken = new Set<string>();
    const removals = new Map<Record<PropertyKey, unknown>, Array<PropertyKey>>();
    for (const [key, { path, reason }] of targets) {
      if (path.some((_, i) => taken.has(JSON.stringify(path.slice(0, i))))) continue;
      taken.add(key);
      const text = path.join(".");
      const rule = rules.find((r) => covers(segments(r), path));
      if (rule !== undefined && !closedAt.has(key)) {
        closedAt.add(key);
        const field = path.slice(0, segments(rule).length);
        setAt(doc, field, closedValue(rule, valueAt(doc, field)));
        for (const also of rule.also ?? []) setAt(doc, [...field.slice(0, -1), also.sibling], also.value);
        issues.push({ path: text, reason, closed: true });
        continue;
      }
      const below = closedBelow(rules, path);
      if (below !== undefined && !closedAt.has(key)) {
        // A parent that is dropped whole takes its security fields with it: they read closed, not default.
        closedAt.add(key);
        setAt(doc, path, below);
        issues.push({ path: text, reason, closed: true });
        continue;
      }
      const parent = valueAt(doc, path.slice(0, -1)) as Record<PropertyKey, unknown>;
      removals.set(parent, [...(removals.get(parent) ?? []), path[path.length - 1]!]);
      issues.push({ path: text, reason });
    }
    for (const [parent, keys] of removals) {
      if (Array.isArray(parent)) {
        for (const index of keys.map(Number).sort((a, b) => b - a)) parent.splice(index, 1);
      } else {
        for (const key of keys) delete parent[key];
      }
    }
  }
}

/**
 * The schema's defaults with every closed value applied: what a document too broken to repair reads as. Given the
 * document (`raw`), the closed values that keep what is readable of it (the owner's `excludes`) do: a list of
 * thousands of bad entries still gives its good ones back, never fewer exclusions than the owner wrote.
 */
export function closedDefaults<S extends ZodTypeAny>(
  schema: S,
  rules: readonly FailClosedField[],
  raw?: unknown,
): z.output<S> {
  const candidate = closedBelow(rules, [], raw) ?? {};
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // A readable entry the schema still refuses (it is only the closed fields that are in `candidate`): taken out.
  return parseTolerant(schema, candidate, { failClosed: rules, maxInvalid: Number.POSITIVE_INFINITY }).value;
}

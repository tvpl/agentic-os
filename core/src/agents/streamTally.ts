import type { z } from "zod";
import type { RunEvent } from "./types.js";

/**
 * Reading a provider CLI's stdout against a schema, and telling the owner once
 * when lines did not match it (door 2 of adaptadores-tipados).
 *
 * A line that is JSON but matches no message the adapter knows is never read,
 * only counted; `warning()` is then the single closing `text` event that names
 * what was seen, so a CLI that changed its format says so in the trace instead
 * of finishing silently without usage, cost or file list.
 */

/** At most this many distinct labels are named: a CLI printing a new type per line must not grow the warning. */
const MAX_LABELS = 10;
/** Longest printed type name. */
const MAX_NAME = 40;

/**
 * Why a JSON object was not read: its type is not one the schema has
 * (`unknown`), the type is known but a field it needs is wrong (`invalid`), or
 * the line was not validated at all because its JSON is too big in values or
 * in one array (`oversized`, see `exceedsShapeBudget`). The three are
 * exclusive, so they are one value and not three flags.
 */
export type RejectionReason = "unknown" | "invalid" | "oversized";

/** How a rejected line names itself in the warning. */
export interface RejectedLine {
  /** Its type (`result`, `item.completed/file_change`); anything without one is "(no type)". */
  name?: string;
  reason: RejectionReason;
}

export interface UnrecognizedTally {
  /** A JSON object the schema rejected. */
  note(value: Record<string, unknown>, what: RejectedLine): void;
  /** A line nobody could read: over the size cap, or the parser threw on it. */
  noteUnreadable(): void;
  /** The closing `text` event naming what was counted; none when nothing was. */
  warning(): RunEvent[];
}

/**
 * What the CLI prints is data from a process we do not control, and the warning
 * goes to the trace and to terminals: only a short, plain alphabet survives.
 */
function printable(name: string): string {
  return name.replace(/[^\w.:/-]/g, "?").slice(0, MAX_NAME);
}

/**
 * A message a CLI printed (an error, a failed turn), made safe to put in one
 * line of the trace: escape sequences are removed, and control, format (bidi,
 * zero-width) and white-space characters (line separators included) become one
 * space, so the text can neither start a line of its own, such as a `[mordomo]`
 * notice, nor move the cursor or reorder what follows. The result is cut at
 * `max` characters with an ellipsis. Where `printable` keeps a type name to a
 * tiny alphabet, a message must stay readable.
 */
export function plainText(raw: string, max: number): string {
  const text = raw
    .slice(0, max * 8) // bound the work on a hostile megabyte before looking at it
    // eslint-disable-next-line no-control-regex -- the escape character is exactly what is being removed
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g, "")
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  // Never leave half of a surrogate pair behind.
  return `${/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut}…`;
}

export function createUnrecognizedTally(provider: string): UnrecognizedTally {
  let count = 0;
  let more = false;
  const labels = new Set<string>();
  const add = (label: string) => {
    count++;
    if (labels.size < MAX_LABELS) labels.add(label);
    else if (!labels.has(label)) more = true;
  };
  return {
    note(value, what) {
      const type = value.type;
      const raw = what.name ?? (typeof type === "string" ? type : undefined);
      const name = raw === undefined ? "(no type)" : printable(raw);
      add(
        what.reason === "oversized"
          ? `type ${name} with an oversized structure`
          : what.reason === "invalid"
            ? `known type ${name} with an invalid field`
            : `unknown type ${name}`,
      );
    },
    noteUnreadable() {
      add("an unreadable line");
    },
    warning() {
      if (count === 0) return [];
      const text =
        `[mordomo] ${provider} emitted ${count} unrecognized line(s): ${[...labels].join(", ")}${more ? ", …" : ""}. ` +
        "Usage, cost or the file list may be incomplete; check the CLI version in Settings › Providers.";
      return [{ type: "text", ts: Date.now(), stream: "stderr", text }];
    },
  };
}

/**
 * Longest array, and most values in all, a line may hold and still be checked
 * against a schema. Zod builds one issue per wrong element, synchronously, so a
 * 4 MiB line of two million `1`s where a list of objects belongs froze the
 * daemon for 14 s and took 567 MB. Real lines stay far below both: a `system`
 * init lists some hundreds of tools, a patch of a thousand files is 3000 values.
 */
export const MAX_ARRAY_ITEMS = 10_000;
export const MAX_JSON_VALUES = 50_000;

/**
 * Whether parsed JSON is too big to hand to a schema: an array over
 * `MAX_ARRAY_ITEMS`, or more than `MAX_JSON_VALUES` values (object members and
 * array elements, nested). It is a cheap pass that stops at the first excess
 * (so its own time and memory are bounded by the budget) and iterative, so deep
 * nesting cannot overflow the stack.
 */
export function exceedsShapeBudget(root: unknown): boolean {
  let values = 0;
  const pending: object[] = [];
  const enter = (value: unknown) => {
    if (value !== null && typeof value === "object") pending.push(value);
  };
  enter(root);
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (Array.isArray(node)) {
      if (node.length > MAX_ARRAY_ITEMS) return true;
      values += node.length;
      if (values > MAX_JSON_VALUES) return true;
      for (const item of node) enter(item);
    } else {
      for (const key in node) {
        if (++values > MAX_JSON_VALUES) return true;
        enter((node as Record<string, unknown>)[key]);
      }
    }
  }
  return false;
}

export type TypedLine<T> =
  /** The line matches the schema (`value` is the raw object, for what a tolerant field ignored). */
  | { ok: true; data: T; value: Record<string, unknown> }
  /** What `parseLine` returns: `null` (the runner prints the raw line as text) or `[]` (counted, nothing to show). */
  | { ok: false; events: RunEvent[] | null };

/**
 * `JSON.parse` + a size check + `schema.safeParse` + the tally, the preamble
 * every typed parser shares. Text that is not a JSON object (a banner, a bare
 * number, an array) stays visible as text; a JSON object the schema rejects, or
 * that is too big to be checked (`exceedsShapeBudget`), is counted under
 * `describe`'s name for it.
 */
export function readTypedLine<S extends z.ZodTypeAny>(
  line: string,
  schema: S,
  tally: UnrecognizedTally,
  describe: (value: Record<string, unknown>) => RejectedLine,
): TypedLine<z.output<S>> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, events: null };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, events: null };
  }
  const object = value as Record<string, unknown>;
  // Before the schema, not after: the schema's cost grows with the number of wrong values, and this line is the attacker's.
  if (exceedsShapeBudget(object)) {
    tally.note(object, { ...describe(object), reason: "oversized" });
    return { ok: false, events: [] };
  }
  const checked = schema.safeParse(object);
  if (!checked.success) {
    tally.note(object, describe(object));
    return { ok: false, events: [] };
  }
  return { ok: true, data: checked.data, value: object };
}

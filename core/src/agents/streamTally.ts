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

/** How a rejected line names itself in the warning. */
export interface RejectedLine {
  /** Its type (`result`, `item.completed/file_change`); anything without one is "(no type)". */
  name?: string;
  /** The type is one the schema has: the line failed on a field, not on its type. */
  known?: boolean;
}

export interface UnrecognizedTally {
  /** A JSON object the schema rejected. */
  note(value: Record<string, unknown>, what?: RejectedLine): void;
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
      const raw = what?.name ?? (typeof type === "string" ? type : undefined);
      const name = raw === undefined ? "(no type)" : printable(raw);
      add(what?.known ? `known type ${name} with an invalid field` : `unknown type ${name}`);
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

export type TypedLine<T> =
  /** The line matches the schema (`value` is the raw object, for what a tolerant field ignored). */
  | { ok: true; data: T; value: Record<string, unknown> }
  /** What `parseLine` returns: `null` (the runner prints the raw line as text) or `[]` (counted, nothing to show). */
  | { ok: false; events: RunEvent[] | null };

/**
 * `JSON.parse` + `schema.safeParse` + the tally, the preamble every typed
 * parser shares. Text that is not a JSON object (a banner, a bare number, an
 * array) stays visible as text; a JSON object the schema rejects is counted
 * under `describe`'s name for it.
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
  const checked = schema.safeParse(value);
  if (!checked.success) {
    const object = value as Record<string, unknown>;
    tally.note(object, describe(object));
    return { ok: false, events: [] };
  }
  return { ok: true, data: checked.data, value: value as Record<string, unknown> };
}

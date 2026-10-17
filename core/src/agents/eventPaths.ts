/**
 * The files a `tool_use` event lists in `paths` (door 5 of adaptadores-tipados)
 * are bounded where they are produced AND where they are used: the event is
 * journaled whole and its paths end up in the run row, so a producer that
 * lists thousands of files, or a path of megabytes, must not become one
 * enormous row. A third-party adapter is not bound by what the Codex adapter
 * does, so the `RunManager` applies the same function.
 */

/** At most this many paths ride on one event; the rest are ignored. */
export const MAX_EVENT_PATHS = 200;
/** A longer path, an empty one or a non-string is ignored. */
export const MAX_EVENT_PATH_CHARS = 4096;

/**
 * The usable paths of `value`, verbatim and in order: non-empty strings of at
 * most `MAX_EVENT_PATH_CHARS`, the first `MAX_EVENT_PATHS` of them. `undefined`
 * when `value` is not an array, so the caller reads the tool's `detail` instead.
 */
export function boundedPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && item.length <= MAX_EVENT_PATH_CHARS) {
      out.push(item);
      if (out.length === MAX_EVENT_PATHS) break;
    }
  }
  return out;
}

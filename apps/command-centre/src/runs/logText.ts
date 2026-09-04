/** Plain-text rendering of run events (copy log) and timeline search (pure, tested). */
import type { RunEventView } from "./useRunStream";

export function relativeOffset(ts: number, firstTs: number): string {
  return `+${((ts - firstTs) / 1000).toFixed(1)}s`;
}

export function absoluteTime(ts: number, locale = "en-GB"): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${time}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Searchable/copyable body of one event, without the timestamp. */
export function eventBody(e: RunEventView): string {
  switch (e.type) {
    case "text":
      return `${e.stream === "stderr" ? "stderr" : "stdout"}: ${String(e.text ?? "")}`;
    case "assistant":
      return `assistant: ${String(e.text ?? "")}`;
    case "tool_use":
      return `tool ${String(e.tool ?? "")}${e.detail ? ` ${String(e.detail)}` : ""}`;
    case "permission":
      return `permission: ${String(e.detail ?? "")}`;
    case "error":
      return `error: ${String(e.message ?? "")}`;
    case "started":
      return `started pid=${String(e.pid ?? "?")}`;
    case "usage":
      return `usage in=${String(e.inputTokens ?? 0)} out=${String(e.outputTokens ?? 0)}${e.costUsd != null ? ` $${String(e.costUsd)}` : ""}${e.model ? ` ${String(e.model)}` : ""}`;
    case "result":
      return `result exit=${e.exitCode == null ? "?" : String(e.exitCode)}${e.timedOut ? " timed_out" : ""}${e.summary ? `\n${String(e.summary)}` : ""}`;
    default:
      return `${e.type}: ${JSON.stringify(e)}`;
  }
}

/** Whole log as text, one event per line (multi-line bodies indented). */
export function eventsToText(events: readonly RunEventView[], locale = "en-GB"): string {
  const first = events[0]?.ts ?? 0;
  return events
    .map((e) => {
      const stamp = `${absoluteTime(e.ts, locale)} ${relativeOffset(e.ts, first).padStart(8)}`;
      const body = eventBody(e).split("\n");
      return [
        `${stamp}  ${body[0] ?? ""}`,
        ...body.slice(1).map((l) => `${" ".repeat(stamp.length + 2)}${l}`),
      ].join("\n");
    })
    .join("\n");
}

/** Indices of `texts` containing `query` (case-insensitive); empty query → no matches. */
export function searchIndices(texts: readonly string[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  texts.forEach((t, i) => {
    if (t.toLowerCase().includes(q)) out.push(i);
  });
  return out;
}

/** Split `text` into [plain, match, plain, ...] segments for highlighting (odd indices match). */
export function splitMatches(text: string, query: string): string[] {
  const q = query.trim();
  if (!q) return [text];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    parts.push(text.slice(from, at), text.slice(at, at + needle.length));
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

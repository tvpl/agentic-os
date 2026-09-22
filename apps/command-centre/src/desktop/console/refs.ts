/**
 * The console's pure parts: what `@name` and `/slug` mean while they are
 * being typed, and what the agent receives once they are sent. Kept free of
 * React so the boundary between "typing a name" and "sending a path" can be
 * pinned by plain tests.
 */
import type { Skill } from "../../api";
import type { RunEventView } from "../../runs/useRunStream";
import {
  factsFromEvents,
  recallFromEvents,
  type LearnedFact,
  type Recalled,
} from "../../runs/recallFromEvents";

const REPLY_MAX_CHARS = 900;

/**
 * Panels matching the `@word` the caret is sitting in (redesign F5, every
 * panel kind since G1). Returns `null` when the caret is not in a reference
 * at all, so the caller can tell "no matches" from "not referencing anything".
 */
export function docSuggestions<T extends { ref: string }>(
  textBeforeCaret: string,
  docs: readonly T[],
  limit = 6,
): T[] | null {
  const m = /@([\w.-]*)$/.exec(textBeforeCaret);
  if (!m) return null;
  const needle = (m[1] ?? "").toLowerCase();
  return docs.filter((d) => d.ref.toLowerCase().includes(needle)).slice(0, limit);
}

/**
 * Puts a reference into the draft. When the caret sits inside a half-typed
 * `@word` it completes that one; otherwise it appends — which is what a click
 * on a context chip means, and what the first version silently failed to do
 * on an empty prompt.
 */
export function completeReference(text: string, caret: number, ref: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const m = /@([\w.-]*)$/.exec(before);
  const inserted = `@${ref} `;
  if (!m) {
    const head = text.trimEnd();
    const next = head ? `${head} ${inserted}` : inserted;
    return { text: next, caret: next.length };
  }
  const start = before.length - m[0].length;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/**
 * Turns the `@name` references in a prompt into something the agent can act
 * on. The user sees a name; the model gets the file behind it. A panel with
 * no file (an instrument, a trace) is still recognised — `used` carries its
 * id so the desktop can tether to it — and is named for the agent by title.
 */
export function resolveReferences(
  text: string,
  panels: readonly { id: string; ref: string; path?: string; title?: string }[],
): { text: string; used: string[] } {
  const used: string[] = [];
  const files: string[] = [];
  const named: string[] = [];
  for (const panel of panels) {
    const pattern = new RegExp(`@${panel.ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    if (!pattern.test(text)) continue;
    used.push(panel.id);
    if (panel.path) files.push(panel.path);
    else named.push(`${panel.ref} (${panel.title ?? panel.ref})`);
  }
  if (used.length === 0) return { text, used };
  let out = text.trimEnd();
  if (files.length) out += `\n\nReferenced files:\n${files.map((p) => `- ${JSON.stringify(p)}`).join("\n")}`;
  if (named.length)
    out += `\n\nReferenced panels open on the desktop:\n${named.map((n) => `- ${n}`).join("\n")}`;
  return { text: out, used };
}

/** Skills whose slug starts with the `/word` being typed (empty when not completing). */
export function skillSuggestions(prompt: string, skills: readonly Skill[], limit = 6): Skill[] {
  const m = /^\/([a-z0-9-]*)$/i.exec(prompt.trim());
  if (!m) return [];
  const needle = (m[1] ?? "").toLowerCase();
  return skills.filter((s) => s.enabled && s.slug.toLowerCase().startsWith(needle)).slice(0, limit);
}

export interface FolderOption {
  path: string;
  label: string;
}

export function readFolders(settings: Record<string, unknown> | undefined): FolderOption[] {
  const raw = settings?.indexedFolders;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is { path: string; enabled?: boolean } =>
        typeof f === "object" && f !== null && typeof (f as { path?: unknown }).path === "string",
    )
    .filter((f) => f.enabled !== false)
    .map((f) => ({ path: f.path, label: f.path.split(/[\\/]/).filter(Boolean).pop() ?? f.path }));
}

/** The agent's reply as the thread shows it: the last assistant message, trimmed. */
export function replyFromEvents(events: readonly RunEventView[]): {
  text: string;
  tools: number;
  tool: string | null;
  /** Sections the agent pulled from memory (refino item 8). */
  recalled: Recalled[];
  /** Facts it wrote down about you, with a way to take them back. */
  learned: LearnedFact[];
} {
  let text = "";
  let tools = 0;
  let tool: string | null = null;
  for (const e of events) {
    if (e.type === "assistant" && typeof e.text === "string" && e.text.trim()) text = e.text.trim();
    else if (e.type === "tool_use") {
      tools += 1;
      tool = typeof e.tool === "string" ? e.tool : tool;
    } else if (e.type === "result" && typeof e.summary === "string" && !text) text = e.summary.trim();
  }
  if (text.length > REPLY_MAX_CHARS) text = `${text.slice(0, REPLY_MAX_CHARS).trimEnd()}…`;
  return { text, tools, tool, recalled: recallFromEvents(events), learned: factsFromEvents(events) };
}

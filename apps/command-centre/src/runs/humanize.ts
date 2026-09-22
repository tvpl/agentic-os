/**
 * The trace in plain words (refino item 36). A `tool_use` event carries the
 * tool's name and its raw input; a person reading the console wants "read
 * `src/app.ts`" or "ran `npm test`", with the JSON one click away. Every
 * sentence is an i18n key, the tool vocabulary covers the Claude Code
 * tools and the generic shapes the other adapters emit, and anything
 * unknown falls back to "used <tool>". Pure and tested.
 */
import type { TKey, TVars } from "../i18n";
import type { RunEventView } from "./useRunStream";

export type Translate = (key: TKey, vars?: TVars) => string;

export interface HumanEvent {
  /** The sentence, already translated. */
  text: string;
  /** What the sentence is about: a path, a command, a query. Shown in mono. */
  subject: string | null;
  /** `ok` for work, `warn` for a permission or a tool error, `danger` for an error. */
  tone: "ok" | "warn" | "danger" | "muted";
}

const MAX_SUBJECT = 96;

/** Parse the JSON the adapter stored in `detail`; a truncated blob is still useful up to its cut. */
export function toolInput(detail: unknown): Record<string, unknown> {
  if (typeof detail !== "string" || !detail.startsWith("{")) return {};
  try {
    return JSON.parse(detail) as Record<string, unknown>;
  } catch {
    // Truncated by the adapter ("…"): pull the first string fields by hand.
    const out: Record<string, unknown> = {};
    for (const m of detail.matchAll(/"(\w+)":"((?:[^"\\]|\\.)*)"/g)) out[m[1]!] = m[2]!.replace(/\\"/g, '"');
    return out;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Shorten an absolute path to what a person recognises: the last three segments. */
export function shortPath(p: string, cwd?: string | null): string {
  let s = p;
  if (cwd && s.startsWith(cwd)) s = s.slice(cwd.length).replace(/^[\\/]/, "");
  const parts = s.split(/[\\/]/).filter(Boolean);
  const tail = parts.slice(-3).join("/");
  return (parts.length > 3 ? `…/${tail}` : tail) || p;
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > MAX_SUBJECT ? `${one.slice(0, MAX_SUBJECT - 1)}…` : one;
}

/**
 * One sentence per event. `cwd` shortens paths; `t` supplies the words.
 * Returns null for events that are not worth a sentence (usage, started).
 */
export function humanizeEvent(e: RunEventView, t: Translate, cwd?: string | null): HumanEvent | null {
  switch (e.type) {
    case "tool_use":
      return humanizeTool(String(e.tool ?? "tool"), e, t, cwd);
    case "assistant": {
      const text = str(e.text);
      return text ? { text: t("trace.said"), subject: clip(text), tone: "ok" } : null;
    }
    case "permission":
      return {
        text: t("trace.permission"),
        subject: str(e.detail) ? clip(String(e.detail)) : null,
        tone: "warn",
      };
    case "error":
      return {
        text: t("trace.error"),
        subject: str(e.message) ? clip(String(e.message)) : null,
        tone: "danger",
      };
    case "result":
      return e.timedOut
        ? { text: t("trace.timedOut"), subject: null, tone: "danger" }
        : {
            text: t(e.exitCode === 0 || e.exitCode == null ? "trace.finished" : "trace.failed"),
            subject: null,
            tone: e.exitCode === 0 || e.exitCode == null ? "ok" : "danger",
          };
    default:
      return null;
  }
}

function humanizeTool(tool: string, e: RunEventView, t: Translate, cwd?: string | null): HumanEvent {
  const input = toolInput(e.detail);
  const file = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path) ?? str(input.file);
  const fileShort = file ? shortPath(file, cwd) : null;
  const name = tool.toLowerCase();
  if (name === "tool_result") {
    return {
      text: t(e.outcome === "error" ? "trace.toolError" : "trace.toolResult"),
      subject: str(e.detail) ? clip(String(e.detail).replace(/^"|"$/g, "")) : null,
      tone: e.outcome === "error" ? "warn" : "muted",
    };
  }
  if (["read", "cat", "view", "read_file", "open_file"].includes(name))
    return { text: t("trace.read"), subject: fileShort, tone: "ok" };
  if (["write", "write_file", "create_file"].includes(name))
    return { text: t("trace.wrote"), subject: fileShort, tone: "ok" };
  if (["edit", "multiedit", "str_replace_editor", "apply_patch", "edit_file", "notebookedit"].includes(name))
    return { text: t("trace.edited"), subject: fileShort, tone: "ok" };
  if (["bash", "shell", "run_command", "exec", "terminal", "run_terminal_cmd"].includes(name)) {
    const cmd =
      str(input.command) ?? str(input.cmd) ?? (Array.isArray(input.command) ? input.command.join(" ") : null);
    return { text: t("trace.ran"), subject: cmd ? clip(cmd) : null, tone: "ok" };
  }
  if (["grep", "rg", "search", "codebase_search", "grep_search"].includes(name)) {
    const q = str(input.pattern) ?? str(input.query) ?? str(input.regex);
    return { text: t("trace.searched"), subject: q ? clip(q) : fileShort, tone: "ok" };
  }
  if (["glob", "ls", "list_dir", "find"].includes(name)) {
    const q = str(input.pattern) ?? str(input.path) ?? str(input.relative_workspace_path);
    return { text: t("trace.listed"), subject: q ? clip(q) : null, tone: "ok" };
  }
  if (["webfetch", "web_fetch", "fetch"].includes(name))
    return { text: t("trace.fetched"), subject: str(input.url) ? clip(String(input.url)) : null, tone: "ok" };
  if (["websearch", "web_search"].includes(name))
    return {
      text: t("trace.webSearched"),
      subject: str(input.query) ? clip(String(input.query)) : null,
      tone: "ok",
    };
  if (["task", "agent", "subagent", "spawn"].includes(name)) {
    const d = str(input.description) ?? str(input.prompt);
    return { text: t("trace.delegated"), subject: d ? clip(d) : null, tone: "ok" };
  }
  if (["todowrite", "todo_write", "update_plan"].includes(name))
    return { text: t("trace.planned"), subject: null, tone: "muted" };
  if (["askuserquestion", "ask_user"].includes(name))
    return { text: t("trace.asked"), subject: null, tone: "warn" };
  return { text: t("trace.used", { tool }), subject: fileShort, tone: "ok" };
}

/**
 * The running narration for a live turn: the last few sentences, newest
 * last, with repeats of the same sentence and subject collapsed.
 */
export function narrate(
  events: readonly RunEventView[],
  t: Translate,
  cwd?: string | null,
  limit = 4,
): HumanEvent[] {
  const out: HumanEvent[] = [];
  for (const e of events) {
    if (e.type !== "tool_use" && e.type !== "permission" && e.type !== "error") continue;
    const h = humanizeEvent(e, t, cwd);
    if (!h || h.tone === "muted") continue;
    const last = out[out.length - 1];
    if (last && last.text === h.text && last.subject === h.subject) continue;
    out.push(h);
  }
  return out.slice(-limit);
}

/**
 * The tasks of a Markdown note (.specs/features/cerebro-paineis, door 3 and amendment 3): a `- [ ]` / `- [x]` line
 * outside the front matter and the fenced code blocks, with an optional due day (`📅 AAAA-MM-DD` or
 * `[due:: AAAA-MM-DD]`) and an optional priority (`⏫` 2, `🔼` 1). The index keeps them in `note_tasks`; the file stays
 * the source.
 */

export interface ParsedTask {
  /** 1-based, over the whole file, as `note_links.line`. */
  line: number;
  done: 0 | 1;
  text: string;
  due: string | null;
  priority: 0 | 1 | 2;
}

/** A task line: a `-` or `*` marker (indent allowed), a box of one space, `x` or `X`, a space and some text. */
const TASK_LINE = /^\s*[-*] \[( |x|X)\] (.+)$/;
const DUE_EMOJI = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const DUE_FIELD = /\[due::\s*(\d{4}-\d{2}-\d{2})\]/;
export const TASK_TEXT_MAX = 300;

/** A real calendar day as `AAAA-MM-DD`, or null. */
export function calendarDay(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? match[0] : null;
}

/** One task line's parts, or null when the line is no task. */
export function parseTaskLine(raw: string): Omit<ParsedTask, "line"> | null {
  const match = TASK_LINE.exec(raw);
  if (!match || match[2]!.trim() === "") return null;
  let text = match[2]!;
  let due: string | null = null;
  // A marker whose value is a calendar day is taken off the text; one that is not stays as it was written.
  for (const marker of [DUE_EMOJI, DUE_FIELD]) {
    const found = marker.exec(text);
    if (!found) continue;
    const day = calendarDay(found[1]);
    if (day === null) continue;
    due ??= day;
    text = text.replace(found[0], "");
  }
  let priority: 0 | 1 | 2 = 0;
  if (text.includes("⏫")) priority = 2;
  else if (text.includes("🔼")) priority = 1;
  text = text.replaceAll("⏫", "").replaceAll("🔼", "").trim();
  return { done: match[1] === " " ? 0 : 1, text: [...text].slice(0, TASK_TEXT_MAX).join(""), due, priority };
}

/** The tasks of a Markdown text, in line order. */
export function parseTasks(content: string): ParsedTask[] {
  const lines = content.split(/\r?\n/);
  let start = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? "")) {
    const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
    if (end > 0) start = end + 1;
  }
  const out: ParsedTask[] = [];
  let fence: { char: string; size: number } | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.size) fence = null;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      fence = { char: opening[1]![0]!, size: opening[1]!.length };
      continue;
    }
    const task = parseTaskLine(line);
    if (task) out.push({ line: i + 1, ...task });
  }
  return out;
}

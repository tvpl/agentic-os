import path from "node:path";

/**
 * Reading the links out of a Markdown file (.specs/features/cerebro-v2, S2): pure, no database. What it returns is what a
 * note SAYS (`note_links`, door 1): the kind, the target as text, the label and the line. Which file a target is, is
 * decided when somebody asks (`links.ts`).
 */

export type LinkKind = "markdown-link" | "wikilink";

export interface ParsedLink {
  kind: LinkKind;
  /** Markdown link: the absolute path it names. Wikilink: the key (`folder/name` without `.md`, lower case). */
  target: string;
  label: string | null;
  /** 1-based line of the link in the file. */
  line: number;
}

export const MARKDOWN_EXTENSIONS = [".md", ".markdown"];
/** A link target with a URL scheme (`https:`, `mailto:`, `file:` …) leaves the workspace: it is not a note. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Blank out what is not prose, keeping every newline (so line numbers hold): the front matter, fenced blocks, code spans. */
export function proseOf(content: string): string {
  const lines = content.split(/\r?\n/);
  let fence: { char: string; size: number } | null = null;
  let start = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? "")) {
    const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
    if (end > 0) start = end + 1;
  }
  return lines
    .map((line, i) => {
      if (i < start) return "";
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.size) fence = null;
        return "";
      }
      if (opening) {
        fence = { char: opening[1]![0]!, size: opening[1]!.length };
        return "";
      }
      // A code span: a run of backticks to the next run of the same length.
      return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1(?!`)/g, (span) => " ".repeat(span.length));
    })
    .join("\n");
}

/** The key a wikilink target is looked up by: no heading, no `.md`, forward slashes, lower case. */
export function wikilinkKey(raw: string): string {
  let target = raw.split("#")[0]!.trim().replace(/\\/g, "/");
  target = target.replace(/^\.?\/+/, "");
  for (const ext of MARKDOWN_EXTENSIONS) if (target.toLowerCase().endsWith(ext)) target = target.slice(0, -ext.length);
  return target.toLowerCase();
}

/** Every link in a Markdown file, in the order they appear. `source` is the absolute path of the file (for relative links). */
export function extractLinks(content: string, source: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const seen = new Set<string>();
  const add = (link: ParsedLink) => {
    const key = `${link.kind}\u0000${link.target}\u0000${link.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };
  const dir = path.dirname(source);
  proseOf(content)
    .split("\n")
    .forEach((text, index) => {
      const line = index + 1;
      for (const match of text.matchAll(/!?\[\[([^[\]\n]+?)\]\]/g)) {
        const inner = match[1]!.replace(/\\\|/g, "|");
        const bar = inner.indexOf("|");
        const target = wikilinkKey(bar === -1 ? inner : inner.slice(0, bar));
        if (target === "") continue; // `[[#Heading]]`: a place in this very note
        const label = bar === -1 ? null : inner.slice(bar + 1).trim() || null;
        add({ kind: "wikilink", target, label, line });
      }
      for (const match of text.matchAll(/!?\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) {
        const raw = (match[2] ?? match[3] ?? "").trim();
        const beforeFragment = raw.split(/[#?]/)[0]!;
        if (beforeFragment === "" || SCHEME.test(raw)) continue;
        let decoded: string;
        try {
          decoded = decodeURIComponent(beforeFragment);
        } catch {
          continue;
        }
        const resolved = path.resolve(dir, decoded);
        if (resolved === source) continue;
        add({ kind: "markdown-link", target: resolved, label: match[1]!.trim() || null, line });
      }
    });
  return out;
}

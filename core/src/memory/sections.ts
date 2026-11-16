/**
 * The sections of a file (.specs/features/cerebro-busca-significado, S3, door 1): the one splitter the recall opens a
 * file with and the vectors phase embeds a file with. `splitSections` is the recall's, moved here unchanged;
 * `sectionRows` reads its output as the rows of `section_vectors` (the heading path, the lines, the limit of 64), and
 * `embeddedText` is the text one row's vector is computed from.
 */

export interface Section {
  heading: string;
  body: string;
  level: number;
  /** The 1-based lines of the file the trimmed body runs from and to (absent for an empty body). */
  startLine?: number;
  endLine?: number;
}

/** Split markdown by headings (level 1-6); the preamble becomes "(top)". Non-markdown files are chunked by ~40 lines. */
export function splitSections(content: string, isMarkdown: boolean): Section[] {
  const lines = content.split(/\r?\n/);
  const out: Section[] = [];
  if (!isMarkdown) {
    for (let i = 0; i < lines.length; i += 40) {
      out.push({ heading: `lines ${i + 1}-${Math.min(lines.length, i + 40)}`, body: lines.slice(i, i + 40).join("\n"), level: 0 });
    }
    return out.length ? out : [{ heading: "(file)", body: content, level: 0 }];
  }
  let current: Section = { heading: "(top)", body: "", level: 0 };
  let buf: string[] = [];
  let bufStart = 1;
  let inFence = false;
  const flush = () => {
    current.body = buf.join("\n").trim();
    if (current.body) {
      // The lines the trimmed body runs over: its first and its last line that hold more than white space.
      const first = buf.findIndex((l) => l.trim() !== "");
      const last = buf.length - 1 - [...buf].reverse().findIndex((l) => l.trim() !== "");
      current.startLine = bufStart + first;
      current.endLine = bufStart + last;
    }
    if (current.body || current.level > 0) out.push(current);
    buf = [];
  };
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      flush();
      current = { heading: h[2]!, body: "", level: h[1]!.length };
      bufStart = i + 2;
      return;
    }
    buf.push(line);
  });
  flush();
  return out.length ? out : [{ heading: "(top)", body: content.trim(), level: 0 }];
}

/** The most rows one file has (the first 64 sections that hold a word, AC 15). */
export const MAX_SECTIONS = 64;
/** The files whose sections are embedded, and those of them split by headings. */
export const EMBEDDED_EXTENSIONS: readonly string[] = [".md", ".markdown", ".txt"];
const MARKDOWN = new Set([".md", ".markdown"]);

const hasWords = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

export interface SectionRow {
  /** 0-based, in reading order, with no gap. */
  ord: number;
  /** The titles from the outermost ancestor to the section's own, joined by " > "; `(top)` before the first heading. */
  heading: string;
  /** The parts of `heading` the embedded text names: none for the preamble and for a block of a plain-text file. */
  path: string[];
  startLine: number;
  endLine: number;
  body: string;
}

/**
 * The rows of a file: one per section that holds a letter or a digit, at most `MAX_SECTIONS`. A heading with no body
 * gives no row and still names its children; a block of 40 lines (a file that is not Markdown) has no path of its own.
 */
export function sectionRows(content: string, ext: string): SectionRow[] {
  const markdown = MARKDOWN.has(ext);
  const out: SectionRow[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  splitSections(content, markdown).forEach((section, index) => {
    let path: string[] = [];
    if (markdown && section.level > 0) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= section.level) stack.pop();
      stack.push({ level: section.level, title: section.heading });
      path = stack.map((s) => s.title);
    }
    if (out.length >= MAX_SECTIONS || !hasWords(section.body)) return;
    let { startLine, endLine } = section;
    if (!markdown) {
      // A block starts at line 40 * index + 1; its lines are those of its trimmed text, as a Markdown section's.
      const lines = section.body.split("\n");
      const first = lines.findIndex((l) => l.trim() !== "");
      const last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim() !== "");
      startLine = 40 * index + 1 + first;
      endLine = 40 * index + 1 + last;
    }
    out.push({
      ord: out.length,
      heading: path.length > 0 ? path.join(" > ") : section.heading,
      path,
      startLine: startLine!,
      endLine: endLine!,
      body: section.body.trim(),
    });
  });
  return out;
}

/**
 * What a row's vector is computed from (door 1, G12): `<área> > <título da nota> > <caminho de títulos>`, a line break
 * and the body, cut to `maxChars`. A part that is missing is left out with its separator.
 */
export function embeddedText(
  parts: { area: string | null; title: string | null; path: readonly string[] },
  body: string,
  maxChars: number,
): string {
  const head = [parts.area, parts.title, ...parts.path].filter((p): p is string => !!p && p.trim() !== "").join(" > ");
  return (head === "" ? body : `${head}\n${body}`).slice(0, maxChars);
}

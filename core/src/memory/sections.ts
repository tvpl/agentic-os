/**
 * The sections of a file (.specs/features/cerebro-busca-significado, S3, door 1): the one splitter the recall opens a
 * file with and the vectors phase embeds a file with. `splitSections` is the recall's, moved here unchanged.
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

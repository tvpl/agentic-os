/**
 * A small, safe markdown parser for the Second Brain preview (item 59).
 * Produces a block tree — never HTML — so the renderer can turn every
 * path-like token into a "select this node" button and every `/skill` token
 * into a skill-orb button. Raw HTML in the source is kept as plain text.
 */
export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; text: string; href: string }
  /** A bare token that looks like a file path or file name (`docs/a.md`, `README.md`, `./x/y.ts`). */
  | { type: "path"; text: string }
  /** A `/skill-name` token. */
  | { type: "skill"; slug: string };

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "code"; text: string; lang: string | null }
  | { type: "quote"; children: Inline[] }
  | { type: "hr" };

export interface ListItem {
  children: Inline[];
  /** "Skills:" / "Files:" / "Reference:" style label (without the colon), if the item starts with one. */
  label: string | null;
  /** `[ ]` / `[x]` task state, if any. */
  checked: boolean | null;
}

const LABELS = /^(skills?|files?|references?|see also|related|routines?|inputs?|outputs?|tags?)\s*:\s*/i;
const PATH_RE = /^(?:\.{0,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.[a-z0-9]{1,8}$/i;
const SKILL_RE = /^\/[a-z0-9][a-z0-9-]*$/i;
const FILE_EXT_RE = /\.[a-z0-9]{1,8}$/i;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    const fence = /^(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(trimmed);
    if (fence) {
      const marker = fence[1]![0]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker.repeat(3))) {
        body.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ type: "code", text: body.join("\n"), lang: fence[2] || null });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, children: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        parts.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", children: parseInline(parts.join(" ")) });
      continue;
    }
    const listMatch = listLine(line);
    if (listMatch) {
      const ordered = listMatch.ordered;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = listLine(lines[i]!);
        if (!m || m.ordered !== ordered) break;
        let text = m.text;
        i++;
        // Lazy continuation lines (indented, non-blank, not a new item).
        while (
          i < lines.length &&
          lines[i]!.trim() !== "" &&
          /^\s+/.test(lines[i]!) &&
          !listLine(lines[i]!)
        ) {
          text += " " + lines[i]!.trim();
          i++;
        }
        items.push(listItem(text));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    // Paragraph: consecutive non-blank, non-special lines.
    const parts: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      const t = l.trim();
      if (
        t === "" ||
        /^#{1,6}\s/.test(t) ||
        /^(`{3,}|~{3,})/.test(t) ||
        t.startsWith(">") ||
        listLine(l) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(t)
      )
        break;
      parts.push(t);
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(parts.join(" ")) });
  }
  return blocks;
}

function listLine(line: string): { ordered: boolean; text: string } | null {
  const m = /^\s{0,6}(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  return { ordered: m[2] !== undefined, text: m[3] ?? "" };
}

function listItem(text: string): ListItem {
  let checked: boolean | null = null;
  const task = /^\[([ xX])\]\s+/.exec(text);
  if (task) {
    checked = task[1] !== " ";
    text = text.slice(task[0].length);
  }
  let label: string | null = null;
  const lab = LABELS.exec(text);
  if (lab) {
    label = lab[0].replace(/\s*:\s*$/, "").trim();
    text = text.slice(lab[0].length);
  }
  return { children: parseInline(text), label, checked };
}

/**
 * Inline parser: code spans, links, bold, italic, then bare path / skill
 * tokens inside plain text. Everything else stays literal text.
 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) out.push(...tokenize(text));
    text = "";
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ type: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        out.push({ type: "link", text: m[1]!, href: m[2]! });
        i += m[0].length;
        continue;
      }
      const wiki = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src.slice(i));
      if (wiki) {
        flush();
        out.push({ type: "link", text: wiki[2] ?? wiki[1]!, href: wiki[1]! });
        i += wiki[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const double = src.startsWith(ch + ch, i);
      const marker = double ? ch + ch : ch;
      const end = src.indexOf(marker, i + marker.length);
      if (
        end > i + marker.length &&
        !/\s/.test(src[i + marker.length] ?? " ") &&
        !/\s/.test(src[end - 1] ?? " ")
      ) {
        flush();
        const inner = parseInline(src.slice(i + marker.length, end));
        out.push(double ? { type: "strong", children: inner } : { type: "em", children: inner });
        i = end + marker.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Split plain text into text / path / skill tokens on whitespace and separators. */
function tokenize(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const re = /[^\s,;()<>"']+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0];
    const bare = word.replace(/[.:!?]+$/, "");
    const trailing = word.slice(bare.length);
    if (SKILL_RE.test(bare)) {
      buf += text.slice(last, m.index);
      if (buf) out.push({ type: "text", text: buf });
      buf = "";
      out.push({ type: "skill", slug: bare.slice(1).toLowerCase() });
      buf += trailing;
    } else if (isPathLike(bare)) {
      buf += text.slice(last, m.index);
      if (buf) out.push({ type: "text", text: buf });
      buf = "";
      out.push({ type: "path", text: bare });
      buf += trailing;
    } else {
      buf += text.slice(last, m.index + word.length);
    }
    last = m.index + word.length;
  }
  buf += text.slice(last);
  if (buf) out.push({ type: "text", text: buf });
  return out;
}

export function isPathLike(word: string): boolean {
  if (word.length < 3 || word.length > 200) return false;
  if (/^https?:\/\//i.test(word)) return false;
  if (!PATH_RE.test(word)) return false;
  // A trailing extension is required; avoid version-like tokens ("v1.2") and plain domains ("a.io" is fine as a file, keep).
  if (/^\d+(\.\d+)+$/.test(word)) return false;
  // Bare names need a real extension (2+ chars: "e.g" is prose); paths with a slash may use short ones ("src/a.c").
  return word.includes("/") ? FILE_EXT_RE.test(word) : /\.[a-z0-9]{2,8}$/i.test(word);
}

/** Plain text of an inline run (used for labels and tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
        case "path":
          return n.text;
        case "link":
          return n.text;
        case "skill":
          return `/${n.slug}`;
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}

/** Every path / link target mentioned in a document (for dangling-reference detection). */
export function collectReferences(blocks: Block[]): string[] {
  const refs: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === "path") refs.push(n.text);
      else if (n.type === "link" && !/^[a-z]+:/i.test(n.href) && !n.href.startsWith("#")) refs.push(n.href);
      else if (n.type === "strong" || n.type === "em") walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "paragraph" || b.type === "quote") walk(b.children);
    else if (b.type === "list") for (const item of b.items) walk(item.children);
  }
  return [...new Set(refs)];
}

/**
 * Resolve a reference (path, file name or wiki target) against the graph:
 * exact `rel`, then `rel` suffix match, then bare file name (with or without
 * `.md`). Returns the node id or null.
 */
export function resolveReference(
  ref: string,
  files: ReadonlyArray<{ id: number; rel: string; name: string }>,
): number | null {
  const clean = ref.replace(/^\.\//, "").replace(/#.*$/, "").replace(/\\/g, "/").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  let suffix: number | null = null;
  let byName: number | null = null;
  for (const f of files) {
    const rel = f.rel.replace(/\\/g, "/").toLowerCase();
    if (rel === lower) return f.id;
    if (suffix === null && (rel.endsWith("/" + lower) || rel.endsWith(lower))) suffix = f.id;
    const name = f.name.toLowerCase();
    if (byName === null && (name === lower || name === lower + ".md" || name.replace(/\.md$/, "") === lower))
      byName = f.id;
  }
  return suffix ?? byName;
}

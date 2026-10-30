/**
 * The YAML-ish header a note may start with (`---` … `---`). Only what the index uses is read - `title`, `tags`, the
 * vocabulary keys of `FRONT_MATTER_FIELDS` and the `children-digest` of an index note - by a reader that is
 * deliberately small: a header it does not understand is no header (the file is indexed as if it had none), never an
 * error.
 */
export interface FrontMatter {
  title?: string;
  tags: string[];
  /** The keys of `FRONT_MATTER_FIELDS` the header holds, each a one-line text of at most 64 characters. */
  fields: Record<string, string>;
  /** `children-digest` of an index note (`_index.md`, .specs/features/cerebro-organizar door 3). */
  childrenDigest?: string;
}

/**
 * The front-matter keys that enter a file's `fields` (.specs/features/cerebro-organizar, door 6): the vocabulary of the
 * organize-brain guide. A value longer than `FRONT_MATTER_FIELD_MAX` characters is not one of these and is left out.
 */
export const FRONT_MATTER_FIELDS = [
  "type",
  "status",
  "updated",
  "last_reviewed",
  "natureza",
  "escopo",
  "review_every",
] as const;
export const FRONT_MATTER_FIELD_MAX = 64;

const MAX_HEADER_BYTES = 4096;
const FIELD_KEYS: ReadonlySet<string> = new Set(FRONT_MATTER_FIELDS);

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      /* not JSON: keep the text between the quotes */
    }
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function tagList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((tag) => unquote(tag).replace(/^#/, "").trim())
    .filter((tag) => tag !== "");
}

/** The header of a Markdown file, or `null` when it has none (or a header this reader does not understand). */
export function parseFrontMatter(content: string): FrontMatter | null {
  const head = content.slice(0, MAX_HEADER_BYTES);
  if (!/^---[ \t]*\r?\n/.test(head)) return null;
  const lines = head.split(/\r?\n/);
  const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
  if (end === -1) return null;
  const out: FrontMatter = { tags: [], fields: {} };
  for (let i = 1; i < end; i++) {
    const match = /^([a-z][a-z_-]*)[ \t]*:[ \t]*(.*)$/.exec(lines[i]!);
    if (!match) continue;
    const value = match[2]!;
    if (FIELD_KEYS.has(match[1]!)) {
      const text = unquote(value);
      if (text !== "" && text.length <= FRONT_MATTER_FIELD_MAX && !(match[1]! in out.fields)) {
        out.fields[match[1]!] = text;
      }
    } else if (match[1] === "children-digest") {
      const digest = unquote(value);
      if (digest !== "" && out.childrenDigest === undefined) out.childrenDigest = digest;
    } else if (match[1] === "title") {
      const title = unquote(value);
      if (title !== "") out.title = title;
    } else if (match[1] !== "tags") {
      continue;
    } else if (value.trim() !== "") {
      out.tags.push(...tagList(value));
    } else {
      // A block list: the "- tag" lines that follow.
      for (let j = i + 1; j < end; j++) {
        const item = /^[ \t]*-[ \t]+(.*)$/.exec(lines[j]!);
        if (!item) break;
        out.tags.push(...tagList(item[1]!));
      }
    }
  }
  return out;
}

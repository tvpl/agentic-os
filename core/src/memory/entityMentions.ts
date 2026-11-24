import path from "node:path";
import { parseInlineFields } from "./fields.js";
import { parseFrontMatter, type FrontMatter } from "./frontMatter.js";
import { extractLinks, proseOf, type ParsedLink } from "./linkParser.js";
import { mentionFold } from "./mentions.js";
import { STOPWORDS } from "./recall.js";

/**
 * Who and what a Markdown file names (.specs/features/cerebro-entidades-resumos, door 1): pure, no database. The rows a
 * pass writes into `entity_mentions` for one file, each `(line, proof, kind, name, norm)`, and the normalized name the
 * entities are compared by (door 2). Which file a link leads to is the caller's (`resolve`), as `links.ts` decides it.
 */

/** The kinds of proof of a mention (door 1): the home note itself, a link to it, a tag, a term, a name accepted by the owner. */
export const MENTION_PROOFS = ["nota", "link", "tag", "termo", "nome"] as const;
export type MentionProof = (typeof MENTION_PROOFS)[number];
/** The kinds of an entity, by precedence (door 2): a person, client or business, a project, a tag, a term. */
export const ENTITY_KINDS = ["perfil", "projeto", "tag", "termo"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
/** At most this many mentions per file, the first in text order (AC 7). */
export const ENTITY_MENTIONS_MAX = 200;

export interface ExtractedMention {
  line: number;
  proof: MentionProof;
  kind: EntityKind;
  name: string;
  norm: string;
}

/** A term found in the text, where it starts. */
export interface FoundTerm {
  name: string;
  line: number;
  column: number;
}

/** Full-width forms (U+FF01 to U+FF5E) as the ASCII they stand for (Landing 2a). */
const widthFold = (text: string): string =>
  text.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

/**
 * The normalized name (door 2, Landing 2a): NFC, full width folded, lower case without diacritics (`mentionFold`),
 * every character that is not a letter or a digit as a space, the spaces together, trimmed. `#Cliente-X` → `cliente x`.
 */
export function entityNorm(name: string): string {
  return mentionFold(widthFold(name.normalize("NFC")))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The kind a note is the home of, by its `type` (door 1): `profile` → `perfil`, `project` → `projeto`, else none. */
export function homeKindOf(type: string | undefined | null): "perfil" | "projeto" | null {
  const value = (type ?? "").trim().toLowerCase();
  return value === "profile" ? "perfil" : value === "project" ? "projeto" : null;
}

/** A note's title as the index stores it: the header's `title`, else its first `# ` heading, else null. */
export function noteTitle(content: string, header: FrontMatter | null): string | null {
  return header?.title ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

/** The inline tags of a text (`#tag`), as the index reads them. */
const INLINE_TAG = /(?:^|\s)#([\p{L}\d_-]{2,30})\b/gu;

/** A note's tags as the index stores them (`files.tags`): the header's, then the inline ones, distinct, at most 20. */
export function noteTags(content: string, header: FrontMatter | null): string[] {
  const inline = [...content.matchAll(INLINE_TAG)].map((m) => m[1]!);
  return [...new Set([...(header?.tags ?? []), ...inline])].slice(0, 20);
}

/** The shown name of a home note when it has no title: its file name without the extension. */
export const stemOf = (file: string): string => path.basename(file, path.extname(file));

/**
 * `prose` (`proseOf`: no header, no code) with the address of every link blanked, keeping every column (Landing 1a): the
 * `(…)` right after a `]` (a Markdown link's address, spaces and all) and the target of a wikilink, whose label after `|`
 * stays.
 */
function withoutAddresses(prose: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return prose
    .replace(/\[\[([^[\]\n]+?)\]\]/g, (whole, inner: string) => {
      const bar = inner.indexOf("|");
      return bar === -1 ? blank(whole) : blank(`[[${inner.slice(0, bar + 1)}`) + inner.slice(bar + 1) + "  ";
    })
    .replace(/\]\([^)\n]*\)/g, (whole) => "]" + blank(whole.slice(1)));
}

/** A word of a term (door 1, d): starts with a capital letter, letters only, at least 2 of them. */
const TERM_WORD = /(?<![\p{L}\p{M}\p{N}_#@/.\\-])\p{Lu}[\p{L}\p{M}]*(?![\p{L}\p{M}\p{N}_])/gu;
const isStopword = (word: string): boolean => {
  const lower = word.normalize("NFC").toLowerCase();
  return STOPWORDS.has(lower) || STOPWORDS.has(mentionFold(lower));
};
const letters = (word: string): number => (word.match(/\p{L}/gu) ?? []).length;

/** The terms of one line of prose: runs of 2 to 4 capitalised words separated only by spaces, leading stopwords out. */
function termsOfLine(text: string, line: number): FoundTerm[] {
  const words = [...text.matchAll(TERM_WORD)]
    .map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }))
    .filter((w) => letters(w.word) >= 2);
  const out: FoundTerm[] = [];
  let run: typeof words = [];
  const close = () => {
    let kept = run;
    // The recall's stopwords go from the start while two words stay: `O Projeto Atlas` is `Projeto Atlas`, and `São
    // Paulo` (`são` is a stopword) or `May Smith` stay names.
    while (kept.length > 2 && isStopword(kept[0]!.word)) kept = kept.slice(1);
    kept = kept.slice(0, 4);
    if (kept.length >= 2) {
      out.push({ name: text.slice(kept[0]!.start, kept[kept.length - 1]!.end), line, column: kept[0]!.start });
    }
    run = [];
  };
  for (const w of words) {
    const last = run[run.length - 1];
    if (last && !/^ +$/.test(text.slice(last.end, w.start))) close();
    run.push(w);
  }
  close();
  return out;
}

/**
 * The terms of a Markdown text (door 1, rule d; AC 5 as amended, AC 6): each run of 2 to 4 words in a row on one line,
 * each starting with a capital letter and of at least 2 letters, separated only by spaces, without the recall's stopwords
 * at its start while two words stay; never from the header, a fenced block, a code span or the address of a link. In
 * text order.
 */
export function extractTerms(content: string): FoundTerm[] {
  return withoutAddresses(proseOf(content))
    .split("\n")
    .flatMap((text, i) => termsOfLine(text, i + 1));
}

/** What a link of the file is, when it leads to the home note of an entity (door 1, rule b). */
export type HomeOf = (link: ParsedLink) => { kind: "perfil" | "projeto"; name: string } | null;

/**
 * The mentions of one Markdown file (door 1): (a) `nota` when its `type` is `profile` or `project`, its title (or file
 * name without extension) and each alias, at line 1; (b) `link`, each link `home` resolves to a home note, at its line;
 * (c) `tag`, each tag of `noteTags` at the line where it is written (the `tags:` line of the header); (d) `termo`. One row
 * per (line, proof, norm), the first 200 in text order (line, then column); a name whose norm is empty gives no row.
 */
export function extractMentions(content: string, file: string, home?: HomeOf): ExtractedMention[] {
  const header = parseFrontMatter(content);
  const found: Array<ExtractedMention & { column: number }> = [];
  const add = (line: number, column: number, proof: MentionProof, kind: EntityKind, name: string) => {
    const norm = entityNorm(name);
    if (norm !== "") found.push({ line, column, proof, kind, name, norm });
  };

  const kind = homeKindOf(parseInlineFields(content).type ?? header?.fields.type);
  if (kind !== null) {
    const names = [noteTitle(content, header) ?? stemOf(file), ...(header?.aliases ?? [])];
    names.forEach((name, i) => add(1, -1_000_000 + i, "nota", kind, name));
  }

  if (home) {
    for (const link of extractLinks(content, file)) {
      const target = home(link);
      if (target) add(link.line, link.column, "link", target.kind, target.name);
    }
  }

  const tags = noteTags(content, header);
  if (tags.length > 0) {
    const raw = content.split(/\r?\n/);
    const tagsLine = header ? raw.findIndex((l, i) => i > 0 && /^tags[ \t]*:/.test(l)) : -1;
    for (const [i, tag] of (header?.tags ?? []).entries()) {
      if (tagsLine !== -1 && tags.includes(tag)) add(tagsLine + 1, i, "tag", "tag", tag);
    }
    const wanted = new Set(tags);
    proseOf(content)
      .split("\n")
      .forEach((text, i) => {
        for (const m of text.matchAll(INLINE_TAG)) {
          if (wanted.has(m[1]!)) add(i + 1, m.index + m[0].indexOf("#"), "tag", "tag", m[1]!);
        }
      });
  }

  for (const term of extractTerms(content)) add(term.line, term.column, "termo", "termo", term.name);

  found.sort((a, b) => a.line - b.line || a.column - b.column);
  const seen = new Set<string>();
  const out: ExtractedMention[] = [];
  for (const m of found) {
    const key = `${m.line}\u0000${m.proof}\u0000${m.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ line: m.line, proof: m.proof, kind: m.kind, name: m.name, norm: m.norm });
    if (out.length === ENTITY_MENTIONS_MAX) break;
  }
  return out;
}

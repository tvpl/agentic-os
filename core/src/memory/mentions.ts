import path from "node:path";
import type { Db } from "../db/db.js";
import type { WorkContext } from "../config/schema.js";
import { EditConflictError, PathAccessError } from "../errors.js";
import { NotRegularFileError } from "../security/safeFs.js";
import type { FtsTable } from "./audienceIndex.js";
import { fileRowFromDb, storedRowFilter, type FileRow } from "./indexer.js";
import { foldName, proseOf } from "./linkParser.js";
import { linksOf } from "./links.js";
import {
  NoteMissingError,
  NoteNotEditableError,
  classifyNotePath,
  readNote,
  saveNote,
  type NoteContext,
} from "./notes.js";
import { contextFilter } from "./reviews.js";

/**
 * Unlinked mentions (.specs/features/cerebro-rituais, S8, doors 6 and 7): the lines of other notes that name a note by
 * one of its terms (its title, its file name, its `aliases`) as a whole word, outside code and links, and that do not
 * already link to it; and "Linkar", which turns the first such match on one line into a wikilink. Read from the index
 * (`files_fts` and the copies of the audiences, `note_links`); a source is opened only for the version of what is
 * answered, and written only by `saveNote`.
 */

/** A term shorter than this many characters is dropped (door 6). */
export const MENTION_TERM_MIN = 4;
/** The longest excerpt of a mention (AC 61). */
export const MENTION_EXCERPT_MAX = 160;
export const MENTIONS_DEFAULT_LIMIT = 20;

const MARKDOWN = new Set([".md", ".markdown"]);
const WORD = "[\\p{L}\\p{N}_]";

/**
 * A text as the matcher compares it (G1): each character in lower case with its accents dropped (`foldName` and then no
 * combining mark), with, for each folded unit, where its character starts and ends in the text.
 */
function folded(text: string): { out: string; from: number[]; to: number[] } {
  let out = "";
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const ch of text) {
    const f = ch.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    for (let k = 0; k < f.length; k++) {
      from.push(at);
      to.push(at + ch.length);
    }
    out += f;
    at += ch.length;
  }
  return { out, from, to };
}

/** The key two terms are the same by (G35): the matcher's fold. */
export const mentionFold = (text: string): string => folded(text.normalize("NFC")).out;

/** The fields a target's terms come from. */
export type TermSource = Pick<FileRow, "name" | "title" | "fields">;

/** The stored `aliases` of a row: the JSON list the indexer writes into `fields`, or none. */
function storedAliases(fields: Record<string, string>): string[] {
  if (fields.aliases === undefined) return [];
  try {
    const list: unknown = JSON.parse(fields.aliases);
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The terms of a note (AC 62, AC 63, G35): its `title`, its file name without the extension with `-` and `_` read as
 * spaces, and each of its `aliases`, in that order; a term of fewer than 4 characters is dropped, and terms that fold
 * the same are one, the first.
 */
export function mentionTerms(file: TermSource): string[] {
  const stem = path.basename(file.name, path.extname(file.name)).replace(/[-_]/g, " ");
  const candidates = [file.title ?? "", stem, ...storedAliases(file.fields)].map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of candidates) {
    if ([...term].length < MENTION_TERM_MIN) continue;
    const key = mentionFold(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

/** A line with every link blanked out (its text, its target, a wikilink and its alias), each character kept in place. */
function withoutLinks(line: string): string {
  const blank = (match: string) => " ".repeat(match.length);
  return line
    .replace(/!?\[\[[^[\]\n]+?\]\]/g, blank)
    .replace(/!?\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g, blank);
}

/** Each line of a Markdown text as the matcher reads it: no front matter, fenced block, code span or link. */
export function mentionLines(content: string): string[] {
  return proseOf(content).split("\n").map(withoutLinks);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Where `term` is first found in `line` as a whole word after the fold (door 6), as offsets of `line`, or null. `line`
 * is a line of `mentionLines` (what it blanked holds nothing); a combining mark right after the match is part of it.
 */
export function findMention(line: string, term: string): { start: number; end: number } | null {
  const key = mentionFold(term);
  if (key === "") return null;
  const text = folded(line);
  const match = new RegExp(`(?<!${WORD})${escapeRegExp(key)}(?!${WORD})`, "u").exec(text.out);
  if (!match) return null;
  const start = text.from[match.index]!;
  let end = text.to[match.index + match[0].length - 1]!;
  while (end < line.length) {
    const next = String.fromCodePoint(line.codePointAt(end)!);
    if (!/\p{M}/u.test(next)) break;
    end += next.length;
  }
  return { start, end };
}

/** At most `MENTION_EXCERPT_MAX` characters of `line` around the match, the match whole. */
export function mentionExcerpt(line: string, start: number, end: number): string {
  if (line.length <= MENTION_EXCERPT_MAX) return line;
  const size = end - start;
  if (size >= MENTION_EXCERPT_MAX) return line.slice(start, start + MENTION_EXCERPT_MAX);
  const from = Math.min(Math.max(0, start - Math.floor((MENTION_EXCERPT_MAX - size) / 2)), line.length - MENTION_EXCERPT_MAX);
  return line.slice(from, from + MENTION_EXCERPT_MAX);
}

export interface MentionsEnv extends NoteContext {
  db: Db;
  /** The full-text table of the caller's audience (`files_fts` for the owner, door 19). */
  index?: FtsTable | undefined;
}

export interface MentionItem {
  file: FileRow;
  line: number;
  excerpt: string;
  term: string;
  editable: boolean;
  /** The version of the source when it was answered, for "Linkar" (G24); null when it is not editable. */
  version: string | null;
}

export interface Mentions {
  file: FileRow;
  terms: string[];
  items: MentionItem[];
  total: number;
}

/**
 * The unlinked mentions of the indexed file `id` (AC 61 to AC 67): each line of another Markdown file the settings let
 * be read that holds one of its terms, outside the front matter, code and links, from a file that does not already link
 * to it, under `context` when one is given. Newest source first, then by path, then by line (G12); a line is one item,
 * with the first term (in the order of `terms`) it holds. `total` counts every item, `items` holds the first `limit`.
 * Null when `id` is no row the settings let be read.
 */
export function mentionsOf(
  env: MentionsEnv,
  query: { id: number; context?: WorkContext | null; limit?: number },
): Mentions | null {
  const allow = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const rowOf = (id: number): FileRow | null => {
    const row = env.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? fileRowFromDb(row) : null;
  };
  const target = rowOf(query.id);
  if (!target || !allow(target)) return null;
  const terms = mentionTerms(target);
  const linked = new Set((linksOf(env.db, target.id, allow)?.backlinks ?? []).map((b) => b.file.id));
  const within = query.context ? contextFilter(env, query.context) : null;

  // The candidates by the caller's own full-text index (a superset: the matcher decides), then the policy on the row.
  const table = env.index ?? "files_fts";
  const ids = new Set<number>();
  for (const term of terms) {
    try {
      const hits = env.db
        .prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`)
        .all(`content : "${term.replace(/"/g, '""')}"`) as Array<{ rowid: number }>;
      for (const hit of hits) ids.add(hit.rowid);
    } catch {
      /* a term the full-text syntax cannot hold finds nothing */
    }
  }
  const sources = [...ids]
    .map(rowOf)
    // a hit with no row of its own is no file (fail closed)
    .filter((row): row is FileRow => row !== null)
    .filter(
      (row) =>
        row.id !== target.id &&
        MARKDOWN.has(row.ext.toLowerCase()) &&
        allow(row) &&
        !linked.has(row.id) &&
        (!within || within(row)),
    )
    .sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const textOf = env.db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const found: Array<Omit<MentionItem, "editable" | "version">> = [];
  for (const source of sources) {
    const content = (textOf.get(source.id) as { content: string } | undefined)?.content ?? "";
    const raw = content.split(/\r?\n/);
    mentionLines(content).forEach((line, i) => {
      for (const term of terms) {
        const at = findMention(line, term);
        if (!at) continue;
        found.push({ file: source, line: i + 1, excerpt: mentionExcerpt(raw[i]!, at.start, at.end), term });
        return;
      }
    });
  }

  const limit = query.limit ?? MENTIONS_DEFAULT_LIMIT;
  const versions = new Map<number, { editable: boolean; version: string | null }>();
  const versionOf = (file: FileRow) => {
    let known = versions.get(file.id);
    if (!known) {
      known = { editable: false, version: null };
      try {
        if (classifyNotePath(env, file.path).editable) {
          const note = readNote(env, file.path);
          known = { editable: note.editable, version: note.editable ? note.version : null };
        }
      } catch {
        /* a source that cannot be read now is not editable from this list */
      }
      versions.set(file.id, known);
    }
    return known;
  };
  return {
    file: target,
    terms,
    items: found.slice(0, limit).map((item) => ({ ...item, ...versionOf(item.file) })),
    total: found.length,
  };
}

/** `409 mention_gone`: the line no longer holds the term outside code and links (or there is no such line). */
export class MentionGoneError extends Error {
  readonly statusCode = 409;
  readonly code = "mention_gone";
  constructor() {
    super("The line no longer holds the term outside code and links; nothing was written.");
    this.name = "MentionGoneError";
  }
}

/** `404 not_found`: the target of a link is no indexed file. */
export class MentionTargetMissingError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor() {
    super("The target file does not exist.");
    this.name = "MentionTargetMissingError";
  }
}

export interface LinkMentionInput {
  source: string;
  /** 1-based. */
  line: number;
  term: string;
  /** The id of the indexed file the link leads to. */
  target: number;
  baseVersion: string;
}

/** What a source that cannot be written through is, in this route's codes: a link on the way is no note to edit. */
function asNoteError(err: unknown): never {
  if (err instanceof PathAccessError) throw new NoteNotEditableError("The note is reached through a link or is private.");
  if (err instanceof NotRegularFileError || (err as NodeJS.ErrnoException).code === "ENOENT") {
    throw new NoteMissingError("The note does not exist.");
  }
  throw err;
}

/**
 * "Linkar" (AC 68, AC 69, door 7): the first match of `term` on `line` of `source`, outside code and links, becomes
 * `[[<target's file name without extension>]]` when what is written there equals that name after `foldName`, else
 * `[[<name>|<as written>]]`; no other byte changes, and the note is replaced by `saveNote` (a version with origin
 * `save`). Checked in order: the source is an editable note (`403 note_not_editable`), the target is a file
 * (`404 not_found`), the source exists (`404 note_missing`) and fits (`413 note_too_large`), its version (`409
 * edit_conflict`, G16), then the match (`409 mention_gone`).
 */
export function linkMention(
  env: NoteContext & { db: Db },
  input: LinkMentionInput,
): { path: string; version: string; link: string } {
  try {
    const classified = classifyNotePath(env, input.source);
    if (!classified.editable) throw new NoteNotEditableError(classified.reason ?? "This file cannot be edited.");
  } catch (err) {
    asNoteError(err);
  }
  const allow = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const row = env.db.prepare("SELECT * FROM files WHERE id = ?").get(input.target) as Record<string, unknown> | undefined;
  const target = row ? fileRowFromDb(row) : null;
  if (!target || !allow(target)) throw new MentionTargetMissingError();

  let note: ReturnType<typeof readNote>;
  try {
    note = readNote(env, input.source);
  } catch (err) {
    return asNoteError(err);
  }
  if (!note.editable) throw new NoteNotEditableError(note.reason ?? "This file cannot be edited.");
  if (note.version !== input.baseVersion) throw new EditConflictError();

  const lines = note.content.split("\n");
  const masked = mentionLines(note.content)[input.line - 1];
  const original = lines[input.line - 1]?.replace(/\r$/, "");
  const at = masked === undefined || original === undefined ? null : findMention(masked, input.term);
  if (!at || original === undefined) throw new MentionGoneError();

  const name = path.basename(target.name, path.extname(target.name));
  const written = original.slice(at.start, at.end);
  const link = foldName(written) === foldName(name) ? `[[${name}]]` : `[[${name}|${written}]]`;
  const offset = lines.slice(0, input.line - 1).reduce((n, l) => n + l.length + 1, 0);
  const content = `${note.content.slice(0, offset + at.start)}${link}${note.content.slice(offset + at.end)}`;
  let saved: { path: string; version: string };
  try {
    saved = saveNote(env, { path: input.source, content, baseVersion: input.baseVersion });
  } catch (err) {
    return asNoteError(err);
  }
  return { path: saved.path, version: saved.version, link };
}

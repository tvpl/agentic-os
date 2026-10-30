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

// ---- properties (.specs/features/cerebro-vista-notas, doors 2 and 3) ------------------------------------------------

/**
 * A property is one `key: value` line at the top level of the header, with a kind fixed by its key (door 3). The rest
 * of the header (a nested map, a multi-line string, a comment, a key this reader does not take) is "other properties",
 * kept byte for byte: writing a property changes only the lines of the keys it touches.
 */
export type PropertyKind = "text" | "list" | "date" | "status" | "select" | "interval";
export type PropertyValue = string | string[];

export interface Property {
  key: string;
  kind: PropertyKind;
  value: PropertyValue;
}

export interface NoteProperties {
  properties: Property[];
  /** The header lines the reader does not understand, as they are (joined by `\n`); null when there are none. */
  otherProperties: string | null;
  /** The offset of the first character after the closing `---` line (0 without a header). */
  bodyStart: number;
}

export const PROPERTY_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const PROPERTY_LINE = /^([a-z][a-z0-9_-]{0,39}):[ \t]*(.*)$/;
const LIST_ITEM = /^([ \t]*)-[ \t]+(.*)$/;
export const STATUS_VALUES = ["active", "draft", "paused", "done", "archived"] as const;
export const SELECT_VALUES: Readonly<Record<string, readonly string[]>> = {
  natureza: ["fato", "opiniao", "plano", "hipotese", "relato"],
  escopo: ["pessoal", "equipe", "externo"],
};
const LIST_KEYS: ReadonlySet<string> = new Set(["tags", "aliases"]);
const DATE_KEYS: ReadonlySet<string> = new Set(["created", "updated", "last_reviewed", "due"]);
const INTERVAL = /^(?:[1-9][0-9]{0,2}d|never)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A tag a property may hold (AC 30): the rule of a note's tags. */
const PROPERTY_TAG = /^[\p{L}\d_-]{2,30}$/u;
export const MAX_PROPERTY_TEXT = 500;
export const MAX_PROPERTY_LIST = 20;

/** The kind a key has, whatever its value says (door 3). */
export function propertyKind(key: string): PropertyKind {
  if (LIST_KEYS.has(key)) return "list";
  if (DATE_KEYS.has(key)) return "date";
  if (key === "status") return "status";
  if (key in SELECT_VALUES) return "select";
  if (key === "review_every") return "interval";
  return "text";
}

/** `400 validation`: a key or a value the properties route does not write. */
export class PropertyValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "PropertyValidationError";
  }
}

/** `409 front_matter_unreadable`: a header past 4 096 bytes, or one with no closing `---`. Nothing is written. */
export class FrontMatterUnreadableError extends Error {
  readonly statusCode = 409;
  readonly code = "front_matter_unreadable";
  constructor(message: string) {
    super(message);
    this.name = "FrontMatterUnreadableError";
  }
}

interface Line {
  text: string;
  eol: string;
  offset: number;
}

type Header =
  | { state: "none" }
  | { state: "unreadable"; why: string }
  | { state: "ok"; lines: Line[]; close: number; bodyStart: number; eol: string };

function splitLines(content: string, limit: number): Line[] {
  const lines: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|$)/g;
  let match: RegExpExecArray | null;
  while (lines.length < limit && (match = re.exec(content)) !== null) {
    lines.push({ text: match[1]!, eol: match[2]!, offset: match.index });
    if (match[2] === "") break;
  }
  return lines;
}

/** Where the header is: none, unreadable (past 4 096 bytes, or not closed), or its lines and where the body starts. */
function locateHeader(content: string): Header {
  if (!/^---[ \t]*\r?\n/.test(content)) return { state: "none" };
  // A header of 4 096 bytes has at most 2 049 lines; one more line to see that it went past.
  const lines = splitLines(content, 2100);
  const close = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line.text));
  if (close === -1) {
    return Buffer.byteLength(content, "utf8") > MAX_HEADER_BYTES
      ? { state: "unreadable", why: `The front matter is longer than ${MAX_HEADER_BYTES} bytes.` }
      : { state: "unreadable", why: "The front matter has no closing ---." };
  }
  const closing = lines[close]!;
  const bodyStart = closing.offset + closing.text.length + closing.eol.length;
  if (Buffer.byteLength(content.slice(0, bodyStart), "utf8") > MAX_HEADER_BYTES) {
    return { state: "unreadable", why: `The front matter is longer than ${MAX_HEADER_BYTES} bytes.` };
  }
  return { state: "ok", lines, close, bodyStart, eol: lines[0]!.eol };
}

/** Split an inline list on its commas, minding quotes: `[a, "b, c"]` is two entries. */
function inlineList(raw: string): string[] {
  let inner = raw.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) inner = inner.slice(1, -1);
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"' && i + 1 < inner.length) current += inner[++i]!;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else current += ch;
  }
  items.push(current);
  return items.map((item) => unquote(item)).filter((item) => item !== "");
}

/** A plain one-line value without its trailing ` # comment`; a quoted one without its quotes. */
function scalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) return unquote(value);
  return value.replace(/[ \t]+#.*$/, "");
}

interface Group {
  key: string;
  /** Index of the key's line and one past its last line (the key line plus its indented or `- item` lines). */
  from: number;
  to: number;
  /** Null when the reader does not understand the lines (they are other properties). */
  property: Property | null;
  /** The indentation of a block list's items, to write the list back the way it was. */
  blockIndent: string | null;
}

/** The header's lines between the two `---`, as key groups and other lines. */
function groupsOf(lines: Line[], close: number): { groups: Group[]; other: number[] } {
  const groups: Group[] = [];
  const other: number[] = [];
  const seen = new Set<string>();
  let i = 1;
  while (i < close) {
    const text = lines[i]!.text;
    const match = PROPERTY_LINE.exec(text);
    if (!match) {
      if (text.trim() !== "") other.push(i);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < close && (/^[ \t]+\S/.test(lines[j]!.text) || /^-([ \t]|$)/.test(lines[j]!.text))) j++;
    const key = match[1]!;
    const raw = match[2]!;
    const kind = propertyKind(key);
    const tail = lines.slice(i + 1, j).map((l) => l.text);
    let property: Property | null = null;
    let blockIndent: string | null = null;
    if (!seen.has(key) && !/^[|>][+-]?\d*[ \t]*(#.*)?$/.test(raw.trim())) {
      if (tail.length === 0) {
        property =
          kind === "list"
            ? { key, kind, value: raw.trim() === "" ? [] : inlineList(scalar(raw)) }
            : { key, kind, value: scalar(raw) };
      } else if (kind === "list" && raw.trim() === "" && tail.every((t) => LIST_ITEM.test(t))) {
        blockIndent = LIST_ITEM.exec(tail[0]!)![1]!;
        property = { key, kind, value: tail.map((t) => scalar(LIST_ITEM.exec(t)![2]!)).filter((v) => v !== "") };
      }
    }
    seen.add(key);
    groups.push({ key, from: i, to: j, property, blockIndent });
    if (!property) for (let k = i; k < j; k++) other.push(k);
    i = j;
  }
  return { groups, other: other.sort((a, b) => a - b) };
}

/** The properties of a note's text (door 2): an unreadable header reads as no header. */
export function parseProperties(content: string): NoteProperties {
  const header = locateHeader(content);
  if (header.state !== "ok") return { properties: [], otherProperties: null, bodyStart: 0 };
  const { groups, other } = groupsOf(header.lines, header.close);
  return {
    properties: groups.flatMap((g) => (g.property ? [g.property] : [])),
    otherProperties: other.length === 0 ? null : other.map((i) => header.lines[i]!.text).join("\n"),
    bodyStart: header.bodyStart,
  };
}

export interface PropertyChange {
  set?: Record<string, PropertyValue> | undefined;
  remove?: string[] | undefined;
}

const hasControl = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0)!;
    return (code < 32 && code !== 9) || code === 127;
  });

/** A real calendar day as `AAAA-MM-DD`. */
function isDay(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function checkText(key: string, value: string): void {
  if (/[\r\n]/.test(value) || hasControl(value)) {
    throw new PropertyValidationError(`${key}: one line, with no line break or control character`);
  }
  if ([...value].length > MAX_PROPERTY_TEXT) {
    throw new PropertyValidationError(`${key}: at most ${MAX_PROPERTY_TEXT} characters`);
  }
}

/** Door 3's refusals (AC 30, AC 56): every key and value is checked before anything is written. */
export function validatePropertyChange(change: PropertyChange): void {
  const set = change.set ?? {};
  const remove = change.remove ?? [];
  for (const key of [...Object.keys(set), ...remove]) {
    if (!PROPERTY_KEY.test(key)) {
      throw new PropertyValidationError(`${key}: a key is a lower-case letter, then up to 39 of a-z, 0-9, _ and -`);
    }
  }
  for (const key of remove) {
    if (Object.hasOwn(set, key)) throw new PropertyValidationError(`${key}: set and removed in one request`);
  }
  for (const [key, value] of Object.entries(set)) {
    const kind = propertyKind(key);
    if (kind === "list") {
      if (!Array.isArray(value)) throw new PropertyValidationError(`${key}: a list of values`);
      if (value.length > MAX_PROPERTY_LIST) {
        throw new PropertyValidationError(`${key}: at most ${MAX_PROPERTY_LIST} entries`);
      }
      for (const item of value) {
        if (key === "tags") {
          if (!PROPERTY_TAG.test(item)) throw new PropertyValidationError(`tags: each 2 to 30 letters, digits, _ or -`);
        } else {
          checkText(key, item);
          if (item.trim() === "") throw new PropertyValidationError(`${key}: an entry is not empty`);
        }
      }
      continue;
    }
    if (typeof value !== "string") throw new PropertyValidationError(`${key}: one value, not a list`);
    if (kind === "date" && !isDay(value)) throw new PropertyValidationError(`${key}: a date as AAAA-MM-DD`);
    if (kind === "status" && !(STATUS_VALUES as readonly string[]).includes(value)) {
      throw new PropertyValidationError(`status: one of ${STATUS_VALUES.join(", ")}`);
    }
    if (kind === "select" && !SELECT_VALUES[key]!.includes(value)) {
      throw new PropertyValidationError(`${key}: one of ${SELECT_VALUES[key]!.join(", ")}`);
    }
    if (kind === "interval" && !INTERVAL.test(value)) {
      throw new PropertyValidationError(`${key}: a number of days such as 30d, or never`);
    }
    if (kind === "text") checkText(key, value);
  }
}

const RESERVED = /^(?:true|false|yes|no|on|off|null|~)$/i;
/** A text written without quotes reads back the same in YAML and here; anything else is written as a JSON string. */
function plainText(value: string): string {
  return /^\p{L}[\p{L}\p{N} _.,()/'-]*$/u.test(value) && !/ $/.test(value) && !RESERVED.test(value)
    ? value
    : JSON.stringify(value);
}
const listItem = (value: string): string =>
  /^[\p{L}\p{N}_-]+$/u.test(value) && !RESERVED.test(value) && !/^[-\d]/u.test(value) ? value : JSON.stringify(value);

function renderLines(key: string, value: PropertyValue, blockIndent: string | null): string[] {
  const kind = propertyKind(key);
  if (Array.isArray(value)) {
    if (blockIndent !== null && value.length > 0) return [`${key}:`, ...value.map((v) => `${blockIndent}- ${listItem(v)}`)];
    return [`${key}: [${value.map(listItem).join(", ")}]`];
  }
  return [`${key}: ${kind === "text" ? plainText(value) : value}`];
}

const sameValue = (a: PropertyValue, b: PropertyValue): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : !Array.isArray(a) && !Array.isArray(b) && a === b;

/**
 * Write a change into a note's text (door 3): the lines of a key that is set are replaced (a block list stays a block
 * list), a key that is removed loses its line and its `- item` lines, a new key is added before the closing `---` in
 * the order of `set`, and every other byte is kept. A note with no header gets one at the top. A key set to the value it
 * already holds keeps its line as it is. Throws `PropertyValidationError` and `FrontMatterUnreadableError`.
 */
export function setProperties(content: string, change: PropertyChange): string {
  validatePropertyChange(change);
  const set = change.set ?? {};
  const remove = new Set(change.remove ?? []);
  const header = locateHeader(content);
  if (header.state === "unreadable") throw new FrontMatterUnreadableError(header.why);
  if (header.state === "none") {
    const added = Object.entries(set).flatMap(([key, value]) => renderLines(key, value, null));
    if (added.length === 0) return content;
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    return `---${eol}${added.map((l) => `${l}${eol}`).join("")}---${eol}${content}`;
  }
  const { lines, close, eol } = header;
  const { groups } = groupsOf(lines, close);
  const firstOf = new Map<string, Group>();
  for (const g of groups) if (!firstOf.has(g.key)) firstOf.set(g.key, g);
  const replaced = new Map<number, { to: number; lines: string[] }>();
  for (const g of groups) {
    if (remove.has(g.key)) replaced.set(g.from, { to: g.to, lines: [] });
    else if (Object.hasOwn(set, g.key) && firstOf.get(g.key) === g) {
      const value = set[g.key]!;
      if (g.property && sameValue(g.property.value, value)) continue;
      replaced.set(g.from, { to: g.to, lines: renderLines(g.key, value, g.blockIndent) });
    }
  }
  let out = `${lines[0]!.text}${lines[0]!.eol}`;
  for (let i = 1; i < close; ) {
    const swap = replaced.get(i);
    if (swap) {
      out += swap.lines.map((l) => `${l}${eol}`).join("");
      i = swap.to;
      continue;
    }
    out += `${lines[i]!.text}${lines[i]!.eol}`;
    i++;
  }
  for (const [key, value] of Object.entries(set)) {
    if (!firstOf.has(key)) out += renderLines(key, value, null).map((l) => `${l}${eol}`).join("");
  }
  return out + content.slice(lines[close]!.offset);
}

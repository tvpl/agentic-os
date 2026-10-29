/**
 * The Brain scene's reading helpers (immersive shell): what the reader needs
 * to make a note understandable at a glance — its outline, how long it takes
 * to read, a one-line excerpt of it (for the sky and the context rail), and
 * its context: who cites it, what it cites, what resembles it and what lives
 * next to it. Pure.
 */
import type { Block } from "../../brain/markdown";
import { inlineText } from "../../brain/markdown";

/* ---------------------------------------------------------------- text */

/** Split a leading `---` YAML block off (only flat `key: value` lines are read). */
export function stripFrontmatter(src: string): { body: string; fields: Record<string, string> } {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { body: src, fields: {} };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv && kv[2]!.trim()) fields[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { body: src.slice(m[0].length), fields };
}

/** Markdown inline syntax off: `**a**` → a, `[t](u)` → t, `[[x|y]]` → y. */
export function plainInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first real sentence(s) of a note, as plain text: not the frontmatter,
 * not a heading, not code, not a table, not a comment. Cut at a word.
 */
export function excerptOf(src: string, max = 140): string {
  const { body } = stripFrontmatter(src);
  const lines = body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const parts: string[] = [];
  let fence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (!line) {
      if (parts.length > 0 && parts.join(" ").length > max * 0.5) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line) || /^\|/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    const text = plainInline(line.replace(/^>\s?/, "").replace(/^([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?/, ""));
    if (text) parts.push(text);
    if (parts.join(" ").length >= max) break;
  }
  return cut(parts.join(" "), max);
}

export function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max - 1);
  const sp = slice.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? slice.slice(0, sp) : slice).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Minutes to read at ~220 words a minute (at least 1). */
export function readingMinutes(src: string): number {
  const words = stripFrontmatter(src)
    .body.split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.round(words / 220));
}

/* ------------------------------------------------------------- outline */

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "section"
  );
}

export interface OutlineItem {
  /** DOM id of the heading (unique within the note). */
  id: string;
  level: number;
  text: string;
  /** Index of the heading's block. */
  block: number;
}

/** The headings of a note, with unique ids. */
export function outlineOf(blocks: readonly Block[], prefix = "bs-h-"): OutlineItem[] {
  const used = new Map<string, number>();
  const out: OutlineItem[] = [];
  blocks.forEach((b, i) => {
    if (b.type !== "heading") return;
    const text = inlineText(b.children).trim();
    if (!text) return;
    const base = slugify(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    out.push({ id: `${prefix}${n ? `${base}-${n + 1}` : base}`, level: b.level, text, block: i });
  });
  return out;
}

/* ------------------------------------------------------------- context */

export type RelationKind = "backlink" | "outgoing" | "similar" | "sibling" | "other";
export const RELATION_ORDER: readonly RelationKind[] = [
  "backlink",
  "outgoing",
  "similar",
  "sibling",
  "other",
];

export interface ContextEdge {
  /** Source file index (the one that links, for markdown links). */
  a: number;
  b: number;
  kind: string;
  why: string;
}

export interface ContextEntry {
  index: number;
  relation: RelationKind;
  why: string;
}

function relationOf(kind: string, fromSelf: boolean): RelationKind {
  if (kind === "markdown-link" || kind === "wikilink") return fromSelf ? "outgoing" : "backlink";
  if (kind === "related") return "similar";
  if (kind === "same-dir") return "sibling";
  return "other";
}

/**
 * A note's context, grouped: who cites it, what it cites, what resembles it,
 * what lives beside it. A neighbour appears once, under its strongest
 * relation (a citation beats a resemblance beats a shared folder).
 */
export function contextOf(
  self: number,
  edges: readonly ContextEdge[],
  allowed: (i: number) => boolean = () => true,
): Record<RelationKind, ContextEntry[]> {
  const best = new Map<number, ContextEntry>();
  for (const e of edges) {
    if (e.a !== self && e.b !== self) continue;
    const other = e.a === self ? e.b : e.a;
    if (other === self || !allowed(other)) continue;
    const rel = relationOf(e.kind, e.a === self);
    const cur = best.get(other);
    if (!cur || RELATION_ORDER.indexOf(rel) < RELATION_ORDER.indexOf(cur.relation))
      best.set(other, { index: other, relation: rel, why: e.why });
  }
  const out: Record<RelationKind, ContextEntry[]> = {
    backlink: [],
    outgoing: [],
    similar: [],
    sibling: [],
    other: [],
  };
  for (const entry of best.values()) out[entry.relation].push(entry);
  return out;
}

/** Relation rank of a neighbour (sectors of the ego graph): lower first; unrelated last. */
export function relationRank(ctx: Record<RelationKind, ContextEntry[]>): (i: number) => number {
  const rank = new Map<number, number>();
  RELATION_ORDER.forEach((r, k) => ctx[r].forEach((e) => rank.set(e.index, k)));
  return (i) => rank.get(i) ?? RELATION_ORDER.length;
}

import type { FtsTable, RelatedTable } from "./audienceIndex.js";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import {
  grantedReadScope,
  homeReadScope,
  inspectPath,
  listWorkspaceDir,
  readWorkspaceText,
  type ReadScope,
} from "../security/safeFs.js";
import { fileRowFromDb, storedRowFilter, type FileRow } from "./indexer.js";
import { coMentionEdges, computeEntities, readCorrections, readMentions } from "./entities.js";
import { personalizedPageRank, pprOrder, pprSeeds, recallGraph } from "./pagerank.js";
import { extractLinks } from "./linkParser.js";
import { resolveWikilink } from "./links.js";
import { readEscopo, readNatureza, type Escopo, type Natureza, type Passage } from "./natureza.js";
import { areaSlug } from "./routers.js";
import { splitSections, type Section } from "./sections.js";
import { fuse, type NearSection, type NearSections, type SemanticSearch } from "./semantic.js";
import { EmbeddingError } from "./embeddings.js";
import type { LocalModels } from "../models/localModels.js";

export { splitSections, type Section };

/**
 * Layered retrieval — the deterministic `brain.js` of the second brain.
 *
 *  (a) keywords from the question (en/pt stopwords, stemming-lite, path-like
 *      tokens preserved);
 *  (b) score candidate files WITHOUT opening them: FTS index (name / rel /
 *      content), title + tags on the row, a boost for files the routers
 *      point at, a boost when a keyword names an area;
 *  (c) open only the top-K files, split them into sections by heading and
 *      score each section;
 *  (d) follow at most one level of markdown pointers out of the chosen
 *      section, keeping the pointed section when it scores higher;
 *  (e) return the sections with a token estimate (chars / 4).
 *
 * Everything is pure arithmetic over the index: same index + same question
 * → same answer, so results can be measured and compared.
 */

export interface RecallOptions {
  /** Files opened (default 3, max 10). */
  k?: number;
  /** Restrict candidates to one area. */
  area?: string;
  /** Max characters per excerpt (default 1500). */
  excerptChars?: number;
  /** Candidate rows considered from the index (default 60). */
  candidateLimit?: number;
  /** Pointer targets followed per chosen section (default 2, 0 disables). */
  pointerLimit?: number;
  /**
   * The folders recall may read. Default: the home and the enabled indexed folders. A run's credential passes
   * `memory/` only, so what it recalls is the second brain and not the owner's other folders.
   */
  scope?: ReadScope;
  /**
   * The files of a work context (.specs/features/cerebro-contextos, door 6): a candidate or a pointer target it refuses
   * is neither opened nor reported. Without it, every file the scope grants.
   */
  within?: (row: { root: string; rel: string }) => boolean;
  /**
   * Only excerpts whose nature is one of these (.specs/features/cerebro-natureza, AC 12): an excerpt with no nature is
   * not returned. A file that cannot give one is not opened; in a file that can, the best section of those natures.
   */
  natureza?: readonly Natureza[];
  /** Only excerpts of files whose scope is one of these (AC 12). */
  escopo?: readonly Escopo[];
  /** The full-text table to rank over (`SearchFilters.index`, door 19 of cerebro-memoria-confiavel); the owner's by default. */
  index?: FtsTable;
}

/** What `hybridRecall` adds (cerebro-busca-significado, S5 and S6). */
export interface HybridRecallOptions extends RecallOptions {
  /** The engine's semantic search: the sections nearest to the question join the candidates (AC 43). */
  semantic?: Pick<SemanticSearch, "nearestSections">;
  /** The engine's local models: the reranker, when it is on and ready (door 5). */
  local?: Pick<LocalModels, "reranker" | "rerank">;
  /** `rerank=false` in the query: the reranker is not called (it can only turn it off, G27). */
  rerank?: boolean;
  /**
   * The graph of the caller (cerebro-entidades-resumos, door 5), read while `memory.recall.graph.enabled` is on: its
   * related table (the owner's by default) and the co-mention edges of its entities (worked out from the index by
   * default, over the files its settings let through).
   */
  graph?: {
    relatedTable?: RelatedTable;
    coMentions?: () => ReadonlyArray<{ a: number; b: number; weight: number }>;
  };
}

export type AbstainReason = "no_match" | "weak";
export type RerankOutcome = "off" | "used" | "skipped" | "timeout" | "failed";

export interface RecallContext {
  path: string;
  /** Heading of the section (or "(top)" / "(file)"). */
  section: string;
  excerpt: string;
  score: number;
  why: string;
  /** Set when the section was reached by following a pointer. */
  via?: string;
  /** What the excerpt is (AC 11): its passage's, else the file's, else its generated section's (door 3), else null. */
  natureza: Natureza | null;
  /** The file's scope, read through the closed list; null when it has none. */
  escopo: Escopo | null;
  /** The file's place (1-based) in the personalized PageRank, while the graph is on (cerebro-entidades-resumos, door 5). */
  graph?: number;
}

export interface RecallCandidate {
  path: string;
  score: number;
  why: string;
}

export interface RecallResult {
  question: string;
  keywords: string[];
  answerContext: RecallContext[];
  tokensEstimate: number;
  candidatesConsidered: number;
  opened: number;
  /** Top candidates and their pre-open scores (for the metrics panel). */
  candidates: RecallCandidate[];
  durationMs: number;
  /** Door 4: the recall says it found nothing that answers, and why; `answerContext` is then empty. */
  abstained: boolean;
  abstainReason: AbstainReason | null;
  /** What the reranker did (door 5). */
  rerank: RerankOutcome;
}

// ------------------------------------------------------------ keywords ----

export const STOPWORDS = new Set(
  (
    "a an the and or but if then else when while of to in on at by for from with without about into over under " +
    "is are was were be been being am do does did doing have has had having can could should would will shall may might must " +
    "i me my mine you your yours he him his she her hers it its we us our ours they them their theirs this that these those " +
    "what which who whom whose where why how all any both each few more most other some such no nor not only own same so than too very " +
    "just also there here up down out off again further once s t don now please tell show find give me want need know like " +
    "o a os as um uma uns umas de do da dos das em no na nos nas por para pra com sem sobre entre até ate ao à aos às " +
    "e ou mas se então entao que quem qual quais onde quando como porque por que " +
    "é e são sao era eram foi foram ser estar está esta estão estao estava estavam ter tem têm tinha tinham há ha havia " +
    "eu tu ele ela nós nos vós eles elas meu minha meus minhas teu tua seu sua seus suas nosso nossa nossos nossas " +
    "isso isto aquilo esse essa este esta aquele aquela isso " +
    "muito muita muitos muitas pouco pouca todo toda todos todas outro outra outros outras mesmo mesma também tambem já ja ainda " +
    "sim não nao só so me te lhe diga mostre encontre quero preciso saber gostaria fala falar sobre qual"
  ).split(/\s+/),
);

const MAX_KEYWORDS = 8;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Stemming-lite: strip common en/pt suffixes from tokens long enough to survive it. */
export function stemLite(word: string): string {
  let w = word;
  if (w.length <= 4) return w;
  const rules: Array<[RegExp, string]> = [
    [/coes$/, "cao"], // ções → ção (after fold: coes → cao)
    [/oes$/, "ao"],
    [/mente$/, ""],
    [/ing$/, ""],
    [/ies$/, "y"],
    [/(ando|endo|indo)$/, ""],
    [/(ados|idos|adas|idas)$/, ""],
    [/(ado|ido|ada|ida)$/, ""],
    [/ed$/, ""],
    [/es$/, ""],
    [/s$/, ""],
  ];
  for (const [re, rep] of rules) {
    if (re.test(w)) {
      const next = w.replace(re, rep);
      if (next.length >= 3) w = next;
      break;
    }
  }
  return w;
}

function isPathLike(token: string): boolean {
  return /[/\\]/.test(token) || /^[\w.-]+\.[a-z0-9]{1,6}$/i.test(token);
}

/**
 * Keywords of a question, deterministic and de-duplicated. Path-like tokens
 * (`src/foo.ts`, `budget-2026.md`) are kept whole (folded to lower case);
 * other tokens are folded, stopword-filtered and stemmed.
 */
export function extractKeywords(question: string): string[] {
  return keywordForms(question).map((form) => form.keyword);
}

/** A keyword and the folded word it was stemmed from (null for a path-like token, kept whole). */
export interface KeywordForm {
  keyword: string;
  word: string | null;
}

/**
 * The keywords of `extractKeywords`, each with the folded word before `stemLite` (cerebro-busca-significado, G2): the
 * search's text query adds the other number of that word, which the stemmed keyword no longer shows (`jornai`).
 */
export function keywordForms(question: string): KeywordForm[] {
  const out: KeywordForm[] = [];
  const seen = new Set<string>();
  const push = (k: string, word: string | null) => {
    if (k.length < 2 || seen.has(k)) return;
    seen.add(k);
    out.push({ keyword: k, word });
  };
  for (const raw of question.split(/\s+/)) {
    const token = raw.replace(/^[^\p{L}\d/\\._~-]+|[^\p{L}\d/\\._~-]+$/gu, "");
    if (!token) continue;
    if (isPathLike(token)) {
      push(fold(token), null);
      continue;
    }
    for (const part of fold(token).split(/[^a-z0-9]+/)) {
      if (!part || STOPWORDS.has(part)) continue;
      if (/^\d+$/.test(part) && part.length < 4) continue; // bare small numbers carry nothing
      push(stemLite(part), part);
    }
  }
  return out.slice(0, MAX_KEYWORDS);
}

// ------------------------------------------------------- router pointers ----

/** Router files are small hand-readable indexes; one past this is not one. */
const MAX_ROUTER_BYTES = 1024 * 1024;

/** Absolute paths referenced by memory/ROUTER.md and memory/areas/*.md. */
export function routerPointers(paths: MordomoPaths): Map<string, string> {
  const out = new Map<string, string>();
  const scope = homeReadScope(paths.home, [paths.memory]);
  const files: string[] = [path.join(paths.memory, "ROUTER.md")];
  const areasDir = path.join(paths.memory, "areas");
  try {
    for (const entry of listWorkspaceDir(scope, areasDir).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile && entry.name.endsWith(".md")) files.push(path.join(areasDir, entry.name));
    }
  } catch {
    /* no areas folder yet, or it is not one the scope grants */
  }
  for (const file of files) {
    let content: string;
    try {
      content = readWorkspaceText(scope, file, { maxBytes: MAX_ROUTER_BYTES }).text;
    } catch {
      continue;
    }
    const label = path.relative(paths.memory, file);
    for (const m of content.matchAll(/`(\/[^`]+|[A-Za-z]:\\[^`]+)`/g)) {
      const p = path.resolve(m[1]!);
      if (!out.has(p)) out.set(p, label);
    }
    for (const m of content.matchAll(/\[[^\]]*\]\(([^)#?\s]+)\)/g)) {
      const target = m[1]!;
      if (/^[a-z]+:\/\//i.test(target)) continue;
      const p = path.resolve(path.dirname(file), target);
      if (!out.has(p)) out.set(p, label);
    }
  }
  return out;
}

function isGeneratedRouter(paths: MordomoPaths, filePath: string): boolean {
  const rel = path.relative(paths.memory, filePath);
  return rel === "ROUTER.md" || rel.startsWith(`areas${path.sep}`) || rel.startsWith(`contexts${path.sep}`);
}

// ------------------------------------------------------------ candidates ----

interface Scored {
  file: FileRow;
  score: number;
  reasons: string[];
  matched: Set<string>;
}

/** The recall's FTS term for one keyword: the keyword as a prefix, never the other number (cerebro-busca-significado, G5). */
export function ftsTerm(keyword: string): string {
  return `"${keyword.replace(/["*]/g, "")}"*`;
}

function scoreCandidates(db: Db, paths: MordomoPaths, settings: Settings, scope: ReadScope, keywords: string[], opts: RecallOptions): Scored[] {
  const limit = Math.min(Math.max(opts.candidateLimit ?? 60, 5), 500);
  const byId = new Map<number, Scored>();
  const areaFilter = opts.area ? "AND f.area = ?" : "";
  // One of three table names (`FtsTable`), never text from a caller.
  const table = opts.index ?? "files_fts";
  const stmt = db.prepare(
    `SELECT f.*, bm25(${table}, 8.0, 3.0, 1.0) AS bm
     FROM ${table} JOIN files f ON f.id = ${table}.rowid
     WHERE ${table} MATCH ? ${areaFilter}
     ORDER BY bm LIMIT ?`,
  );
  // (b1) one FTS pass per keyword: coverage (how many keywords a file matches)
  // matters more than raw term frequency.
  // Within a work context the rows of other files would fill the page: read deeper and keep `limit` of its own.
  const read = opts.within ? Math.max(limit, 5000) : limit;
  for (const kw of keywords) {
    const term = ftsTerm(kw);
    if (term === '""*') continue;
    let rows: Array<Record<string, unknown>>;
    try {
      rows = (opts.area ? stmt.all(term, opts.area, read) : stmt.all(term, read)) as Array<Record<string, unknown>>;
    } catch {
      continue;
    }
    let kept = 0;
    for (const row of rows) {
      if (kept >= limit) break;
      const file = fileRowFromDb(row);
      if (isGeneratedRouter(paths, file.path)) continue;
      // The index is old data: a row indexed before a path became private (the home's config/, a folder
      // since revoked) is judged now, not when it was written, and is neither opened nor reported.
      if (!isReadable(scope, file.path)) continue;
      if (opts.within && !opts.within(file)) continue;
      const bm = Math.max(0, -(row.bm as number)); // bm25(): lower is better, negative for matches
      const entry = byId.get(file.id) ?? { file, score: 0, reasons: [], matched: new Set<string>() };
      entry.matched.add(kw);
      entry.score += Math.min(bm, 10);
      byId.set(file.id, entry);
      kept++;
    }
  }
  // Area slugs named by the question, memoised: the configured areas are seeded
  // up front (they are the common case) and any other area a row carries is
  // resolved once, so the boost costs one pass over the keywords per slug.
  const isKeywordArea = (slug: string): boolean => keywords.some((kw) => slug.includes(kw) || kw.includes(slug));
  const areaNamed = new Map<string, boolean>(settings.areas.map((a) => [areaSlug(a), isKeywordArea(areaSlug(a))]));
  const pointers = routerPointers(paths);
  for (const entry of byId.values()) {
    const { file } = entry;
    const name = fold(file.name);
    const title = fold(file.title ?? "");
    const tags = file.tags.map(fold);
    const rel = fold(file.rel);
    const hits = { name: [] as string[], title: [] as string[], tags: [] as string[], rel: [] as string[] };
    for (const kw of keywords) {
      if (name.includes(kw)) hits.name.push(kw);
      else if (rel.includes(kw)) hits.rel.push(kw);
      if (title.includes(kw)) hits.title.push(kw);
      if (tags.some((t) => t.includes(kw) || kw.includes(t))) hits.tags.push(kw);
    }
    // (b2) row-level signals: name > title > tags > rel; then coverage.
    entry.score += hits.name.length * 6 + hits.title.length * 4 + hits.tags.length * 3 + hits.rel.length * 1.5;
    entry.score += entry.matched.size * 5;
    if (hits.name.length) entry.reasons.push(`name matches ${hits.name.join(", ")}`);
    if (hits.title.length) entry.reasons.push(`title matches ${hits.title.join(", ")}`);
    if (hits.tags.length) entry.reasons.push(`tags match ${hits.tags.join(", ")}`);
    if (hits.rel.length) entry.reasons.push(`path matches ${hits.rel.join(", ")}`);
    entry.reasons.push(`${entry.matched.size}/${keywords.length} keywords in the index`);
    // (b3) router and area boosts.
    const router = pointers.get(file.path);
    if (router) {
      entry.score += 8;
      entry.reasons.push(`listed in ${router}`);
    }
    if (file.area) {
      const slug = areaSlug(file.area);
      let named = areaNamed.get(slug);
      if (named === undefined) {
        named = isKeywordArea(slug);
        areaNamed.set(slug, named);
      }
      if (named) {
        entry.score += 4;
        entry.reasons.push(`area "${file.area}" named in the question`);
      }
    }
    entry.score = Math.round(entry.score * 100) / 100;
  }
  return [...byId.values()].sort(
    (a, b) => b.score - a.score || b.file.mtime - a.file.mtime || a.file.path.localeCompare(b.file.path),
  );
}

// -------------------------------------------------------------- sections ----

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1 && n < 50) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

export function scoreSection(section: Section, keywords: string[]): { score: number; matched: string[] } {
  const heading = fold(section.heading);
  const body = fold(section.body);
  let score = 0;
  const matched: string[] = [];
  for (const kw of keywords) {
    const inHeading = heading.includes(kw);
    const n = countOccurrences(body, kw);
    if (inHeading || n > 0) matched.push(kw);
    if (inHeading) score += 3;
    if (n > 0) score += 1 + Math.log2(1 + n);
  }
  // Coverage bonus: a section hitting more distinct keywords beats a long one repeating one word.
  score += matched.length * 2;
  // Mild length normalisation so a whole-file preamble does not win by size alone.
  const chars = section.body.length;
  if (chars > 4000) score *= 0.85;
  return { score: Math.round(score * 100) / 100, matched };
}

/** Whether the scope grants this indexed path today (real path, roots, filter). */
function isReadable(scope: ReadScope, filePath: string): boolean {
  try {
    return inspectPath(scope, filePath).blockedReason === null;
  } catch {
    return false;
  }
}

// --------------------------------------------- the nature of an excerpt ----

/**
 * Door 3 of .specs/features/cerebro-natureza: what a level-2 section of the generated files is, by its title as the
 * `consolidate-memory` skill (`<home>/memory/MEMORY.md`) and the journal (`<home>/memory/journal/YYYY-MM-DD.md`,
 * `JOURNAL_SECTIONS`) write it. `Superseded` is a `fato` with the "substituído" seal, which the section's name says.
 */
export const MEMORY_SECTION_NATURES: Readonly<Record<string, Natureza>> = {
  Facts: "fato",
  Decisions: "fato",
  "Open loops": "plano",
  Reflections: "opiniao",
  Superseded: "fato",
};
export const JOURNAL_SECTION_NATURES: Readonly<Record<string, Natureza>> = {
  Decisions: "fato",
  "Open loops": "plano",
  Today: "relato",
  Runs: "relato",
};

/** Which generated file of the memory folder `filePath` is (door 3), or null for any other file. */
export function generatedFileKind(paths: Pick<MordomoPaths, "memory">, filePath: string): "memory" | "journal" | null {
  const rel = path.relative(paths.memory, filePath);
  if (rel === "MEMORY.md") return "memory";
  const parts = rel.split(path.sep);
  if (parts.length === 2 && parts[0] === "journal" && /^\d{4}-\d{2}-\d{2}\.md$/.test(parts[1]!)) return "journal";
  return null;
}

/** The nature door 3 gives a section of a generated file: only a level-2 heading of the table; else null. */
export function generatedSectionNature(
  kind: "memory" | "journal" | null,
  section: Pick<Section, "heading" | "level">,
): Natureza | null {
  if (kind === null || section.level !== 2) return null;
  const table = kind === "memory" ? MEMORY_SECTION_NATURES : JOURNAL_SECTION_NATURES;
  return Object.hasOwn(table, section.heading) ? table[section.heading]! : null;
}

/** What the nature of an excerpt is read from: the file's passages, its own nature and which generated file it is. */
export interface NatureSource {
  passages: readonly Passage[];
  natureza: Natureza | null;
  generated: "memory" | "journal" | null;
}

/**
 * AC 11: an excerpt whose lines lie within a passage has the passage's nature; else the file's; else its section's in
 * a generated file (door 3); else null. An excerpt that holds a passage without lying within it has the file's.
 */
export function excerptNature(source: NatureSource, section: Section): Natureza | null {
  const { startLine, endLine } = section;
  if (startLine !== undefined && endLine !== undefined) {
    const passage = source.passages.find((p) => startLine >= p.startLine && endLine <= p.endLine);
    if (passage) return passage.natureza;
  }
  return source.natureza ?? generatedSectionNature(source.generated, section);
}

/** Whether a file could give an excerpt of one of `wanted`, before it is opened (its passages, its nature, door 3). */
function couldGive(source: NatureSource, wanted: readonly Natureza[]): boolean {
  if (source.passages.some((p) => wanted.includes(p.natureza))) return true;
  if (source.natureza !== null) return wanted.includes(source.natureza);
  const table =
    source.generated === "memory" ? MEMORY_SECTION_NATURES : source.generated === "journal" ? JOURNAL_SECTION_NATURES : {};
  return Object.values(table).some((n) => wanted.includes(n));
}

interface OpenedFile {
  file: FileRow;
  sections: Section[];
  best: { section: Section; score: number; matched: string[]; index: number; natureza: Natureza | null } | null;
  /** The most keywords one section with a body matches (AC 47, G29). */
  matched: number;
}

/**
 * AC 44: a fused file's vector-nearest section is taken when it scores no lower than its best text section (equal
 * counts as no lower).
 */
export function prefersVectorSection(textScore: number, vectorScore: number): boolean {
  return vectorScore >= textScore;
}

/** Whether a section of `splitSections` is the section a vector row names (its first body line; a block by its name). */
function isRowOf(section: Section, near: { heading: string; line: number }, markdown: boolean): boolean {
  return markdown ? section.startLine === near.line : section.heading === near.heading;
}

/** How a file's sections are labelled, and which labels a recall keeps (all of them without a filter). */
interface Labelling {
  source: NatureSource;
  wanted?: readonly Natureza[] | undefined;
}

function openFile(
  scope: ReadScope,
  file: FileRow,
  keywords: string[],
  maxBytes: number,
  labels: Labelling,
  near?: { heading: string; line: number },
): OpenedFile | null {
  let content: string;
  try {
    // Through the safe-read primitive: the path comes from the index, so it is checked now, on its real path.
    content = readWorkspaceText(scope, file.path, { maxBytes, strict: true }).text;
  } catch {
    return null;
  }
  if (content.includes("\0")) return null;
  const md = file.ext === ".md" || file.ext === ".markdown";
  const sections = splitSections(content, md);
  let best: OpenedFile["best"] = null;
  let vector: OpenedFile["best"] = null;
  let matched = 0;
  const titles: Array<{ level: number; title: string }> = [];
  sections.forEach((section, index) => {
    if (md && section.level > 0) {
      while (titles.length > 0 && titles[titles.length - 1]!.level >= section.level) titles.pop();
      titles.push({ level: section.level, title: section.heading });
    }
    // A matching title is navigation metadata, not usable answer context.
    // Keep sections intact for pointers, but select excerpts with actual text.
    if (!section.body.trim()) return;
    const s = scoreSection(section, keywords);
    // AC 47: what a section matches is read with its heading path (door 1's name of a section, `Banco > Pagamento`).
    const named = titles.length > 0 && section.level > 0 ? titles.map((t) => t.title).join(" > ") : section.heading;
    matched = Math.max(matched, scoreSection({ ...section, heading: named }, keywords).matched.length);
    const natureza = excerptNature(labels.source, section);
    // With a nature asked, the best section is the best of those natures (an excerpt with none is never one).
    if (labels.wanted && !(natureza !== null && labels.wanted.includes(natureza))) return;
    const candidate = { section, score: s.score, matched: s.matched, index, natureza };
    if (!best || s.score > best.score) best = candidate;
    if (near && !vector && isRowOf(section, near, md)) vector = candidate;
  });
  if (vector && best && prefersVectorSection((best as { score: number }).score, (vector as { score: number }).score))
    best = vector;
  return { file, sections, best, matched };
}

function excerptOf(section: Section, max: number): string {
  const text = section.body.trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n…(truncated)`;
}

/**
 * The files the links of one section lead to (`[x](y)` and `[[wikilink]]`, outside code), as absolute paths, at most
 * `limit`: read by the same parser as `note_links` and resolved by the same rule as the links panel, over the files
 * this recall may read (so an ambiguous name never ranks first a file it would then refuse to open).
 */
function pointerTargets(db: Db, scope: ReadScope, section: Section, from: FileRow, limit: number): string[] {
  const out: string[] = [];
  for (const link of extractLinks(section.body, from.path)) {
    if (out.length >= limit) break;
    const target =
      link.kind === "markdown-link"
        ? link.target
        : resolveWikilink(db, from, link.target, (row) => isReadable(scope, path.join(row.root, row.rel)))[0]?.path;
    if (target && target !== from.path && !out.includes(target)) out.push(target);
  }
  return out;
}

// ---------------------------------------------------------------- recall ----

/** How many sections nearest to the question join the candidates (AC 43). */
export const RECALL_VECTOR_DEPTH = 50;
/** How much of a section the reranker reads. */
const RERANK_CHARS = 2000;

/**
 * Door 4's abstention, at its own layer (AC 46-48, G29, G30): no keyword or no candidate is `no_match`, whatever
 * `abstain` says; else, with `abstain` on, `weak` when no section matches at least half of the keywords (exactly half
 * counts) and the nearest section's cosine is below the provider's `minSimilarity` (equal is not below) or there are no
 * vectors (`cosine` null).
 */
export function decideAbstention(input: {
  keywords: number;
  candidates: number;
  /** The most keywords one section of the opened files matches. */
  matched: number;
  cosine: number | null;
  minSimilarity: number;
  abstain: boolean;
}): AbstainReason | null {
  if (input.keywords === 0 || input.candidates === 0) return "no_match";
  if (!input.abstain) return null;
  if (input.matched * 2 >= input.keywords) return null;
  if (input.cosine !== null && input.cosine >= input.minSimilarity) return null;
  return "weak";
}

/**
 * AC 51, G33: the excerpts in the answer's order, each kept while the sum of their tokens (characters / 4, rounded up)
 * stays within `budget`; one that does not fit is dropped and the next ones are still tried.
 */
export function withinTokenBudget<T extends { excerpt: string }>(
  answer: readonly T[],
  budget: number,
): { kept: T[]; tokensEstimate: number } {
  const kept: T[] = [];
  let tokensEstimate = 0;
  for (const entry of answer) {
    const tokens = Math.ceil(entry.excerpt.length / 4);
    if (tokensEstimate + tokens > budget) continue;
    kept.push(entry);
    tokensEstimate += tokens;
  }
  return { kept, tokensEstimate };
}

/**
 * Door 5, AC 55-56, G26, G27, at its own layer: whether the reranker is called, or the outcome when it is not. Off when
 * the setting is off or the query says `rerank=false` (the query can only turn it off); skipped when the answer
 * abstained or no reranker is ready (or the platform has no runtime).
 */
export function rerankPlan(input: {
  enabled: boolean;
  query: boolean | undefined;
  abstained: boolean;
  ready: boolean;
}): "call" | "off" | "skipped" {
  if (!input.enabled || input.query === false) return "off";
  if (input.abstained || !input.ready) return "skipped";
  return "call";
}

/** The outcome of a reranker call that failed: past `timeoutMs` it is `timeout`, anything else (the child ended) `failed`. */
export function rerankFailure(error: unknown): "timeout" | "failed" {
  return error instanceof EmbeddingError && error.kind === "timeout" ? "timeout" : "failed";
}

/** A fused candidate: its text score and reasons (0 and none when only the vectors found it) and its nearest section. */
interface Fused extends Scored {
  near?: NearSection;
}

/** What one recall works from, before any file is opened. */
interface Prepared {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
  question: string;
  keywords: string[];
  opts: RecallOptions;
  started: number;
  k: number;
  excerptChars: number;
  pointerLimit: number;
  scope: ReadScope;
  /** The text candidates, filtered. */
  scored: Scored[];
  /** Whether a file of the index is one this recall may name (every filter of the text candidates). */
  admit: (file: FileRow) => boolean;
  open: (file: FileRow, near?: NearSection) => OpenedFile | null;
  fits: (file: FileRow) => boolean;
}

function prepare(db: Db, paths: MordomoPaths, settings: Settings, question: string, opts: RecallOptions): Prepared {
  const started = Date.now();
  const keywords = extractKeywords(question);
  const scope = opts.scope ?? grantedReadScope(settings, paths.home);
  const passagesOf = db.prepare(
    "SELECT natureza, start_line AS startLine, end_line AS endLine FROM note_passages WHERE file_id = ? ORDER BY start_line",
  );
  const sources = new Map<number, NatureSource>();
  const sourceOf = (file: FileRow): NatureSource => {
    let source = sources.get(file.id);
    if (!source) {
      source = {
        passages: passagesOf.all(file.id) as Passage[],
        natureza: readNatureza(file.fields),
        generated: generatedFileKind(paths, file.path),
      };
      sources.set(file.id, source);
    }
    return source;
  };
  // A file the filters cannot be met in is neither opened nor counted (AC 12): its scope, then whether it could give
  // an excerpt of a nature asked.
  const fits = (file: FileRow): boolean =>
    (!opts.natureza && !opts.escopo) ||
    ((!opts.escopo || opts.escopo.includes(readEscopo(file.fields) as Escopo)) &&
      (!opts.natureza || couldGive(sourceOf(file), opts.natureza)));
  const scored = keywords.length === 0 ? [] : scoreCandidates(db, paths, settings, scope, keywords, opts).filter((cand) => fits(cand.file));
  const maxBytes = settings.limits.maxIndexedFileBytes;
  const openedFiles = new Map<string, OpenedFile | null>();
  return {
    db,
    paths,
    settings,
    question,
    keywords,
    opts,
    started,
    k: Math.min(Math.max(opts.k ?? 3, 1), 10),
    excerptChars: Math.min(Math.max(opts.excerptChars ?? 1500, 200), 20_000),
    pointerLimit: Math.min(Math.max(opts.pointerLimit ?? 2, 0), 5),
    scope,
    scored,
    // The vector candidates pass the same filters as the text ones (AC 43): today's policy on the real path, the work
    // context, the area, the nature and the scope; the generated routers are never candidates.
    admit: (file) =>
      !isGeneratedRouter(paths, file.path) &&
      isReadable(scope, file.path) &&
      (!opts.within || opts.within(file)) &&
      (!opts.area || file.area === opts.area) &&
      fits(file),
    // A file is read once per recall, whichever list or link reaches it.
    open: (file, near) => {
      const key = `${file.path}\0${near ? near.ord : ""}`;
      if (!openedFiles.has(key))
        openedFiles.set(
          key,
          openFile(scope, file, keywords, maxBytes, { source: sourceOf(file), wanted: opts.natureza }, near),
        );
      return openedFiles.get(key)!;
    },
    fits,
  };
}

/**
 * The text candidates and the files of the nearest sections, fused by RRF (k 60, a tie to the lower file id); a file is
 * in the list once, with its nearest section. Without vectors the text order, unchanged.
 */
function fuseCandidates(prep: Prepared, near: NearSections | null): Fused[] {
  if (!near || near.sections.length === 0) return prep.scored;
  const nearest = new Map<number, NearSection>();
  for (const section of near.sections) if (!nearest.has(section.file.id)) nearest.set(section.file.id, section);
  const byId = new Map<number, Fused>(prep.scored.map((cand) => [cand.file.id, cand]));
  const vectorIds = [...nearest.keys()];
  return fuse([prep.scored.map((cand) => cand.file.id), vectorIds]).map(({ id }) => {
    const section = nearest.get(id);
    const cand: Fused = byId.get(id) ?? { file: section!.file, score: 0, reasons: [], matched: new Set<string>() };
    return section ? { ...cand, near: section } : cand;
  });
}

/** The answer read from the first `k` candidates of `order` and the links of their sections, up to `hops` levels. */
function answerFrom(prep: Prepared, order: readonly Fused[]): { answer: RecallContext[]; opened: number; matched: number } {
  const { db, scope, opts } = prep;
  const hops = prep.settings.memory.recall.hops;
  const answer: RecallContext[] = [];
  const openedPaths = new Set<string>();
  let opened = 0;
  let matched = 0;
  const lookup = db.prepare("SELECT * FROM files WHERE path = ?");
  // AC 50, G32: a link is followed to an indexed file the caller may read, and its best section is taken only when it
  // scores higher than the section that pointed to it; `via` is the file that pointed, and a section not taken ends
  // that branch.
  const follow = (section: Section, from: FileRow, fromScore: number, base: number, level: number): void => {
    if (level > hops) return;
    for (const target of pointerTargets(db, scope, section, from, prep.pointerLimit)) {
      if (openedPaths.has(target)) continue;
      const row = lookup.get(target) as Record<string, unknown> | undefined;
      if (!row) continue; // only indexed files — same exclusion policy as the index
      const pointedRow = fileRowFromDb(row);
      if (opts.within && !opts.within(pointedRow)) continue; // a pointer out of the work context is not followed
      if (!prep.fits(pointedRow)) continue;
      openedPaths.add(target);
      const pointed = prep.open(pointedRow);
      opened++;
      if (!pointed) continue;
      matched = Math.max(matched, pointed.matched);
      if (!pointed.best || pointed.best.score <= fromScore) continue;
      answer.push({
        path: target,
        section: pointed.best.section.heading,
        excerpt: excerptOf(pointed.best.section, prep.excerptChars),
        score: Math.round((base + pointed.best.score) * 100) / 100,
        why: `pointer from ${path.basename(from.path)} § "${section.heading}"; section "${pointed.best.section.heading}" matches ${pointed.best.matched.join(", ")}`,
        via: from.path,
        natureza: pointed.best.natureza,
        escopo: readEscopo(pointedRow.fields),
      });
      follow(pointed.best.section, pointedRow, pointed.best.score, base, level + 1);
    }
  };
  for (const cand of order.slice(0, prep.k)) {
    if (openedPaths.has(cand.file.path)) continue; // already reached by a pointer — never read a file twice
    openedPaths.add(cand.file.path);
    const file = prep.open(cand.file, cand.near);
    opened++;
    if (!file) continue;
    matched = Math.max(matched, file.matched);
    if (!file.best) continue;
    const best = file.best;
    const why = [...cand.reasons, `section "${best.section.heading}" matches ${best.matched.join(", ") || "nothing directly"}`].join("; ");
    answer.push({
      path: cand.file.path,
      section: best.section.heading,
      excerpt: excerptOf(best.section, prep.excerptChars),
      score: Math.round((cand.score + best.score) * 100) / 100,
      why,
      natureza: best.natureza,
      escopo: readEscopo(cand.file.fields),
    });
    follow(best.section, cand.file, best.score, cand.score, 1);
  }
  return { answer, opened, matched };
}

/** The result of one recall, and the fused order before opening (the eval's `hybrid`) and after the reranker. */
export interface RecallRun {
  result: RecallResult;
  fused: FileRow[];
  /** The order the graph gave (the fusion of the fused order and the PageRank's); null when it did not run. */
  graphed: FileRow[] | null;
  /** The fused order as the reranker left it; null when it was not called. */
  reranked: FileRow[] | null;
}

function candidateWhy(cand: Fused): string {
  const reasons = cand.near ? [...cand.reasons, `section "${cand.near.heading}" is near the question`] : cand.reasons;
  return reasons.join("; ");
}

export async function runRecall(
  db: Db,
  paths: MordomoPaths,
  settings: Settings,
  question: string,
  opts: HybridRecallOptions,
): Promise<RecallRun> {
  const prep = prepare(db, paths, settings, question, opts);
  const config = settings.memory.recall;
  const near =
    prep.keywords.length > 0 && opts.semantic
      ? await opts.semantic.nearestSections(question, prep.admit, RECALL_VECTOR_DEPTH)
      : null;
  const fused = fuseCandidates(prep, near);
  const first = answerFrom(prep, fused);
  const reason = decideAbstention({
    keywords: prep.keywords.length,
    candidates: fused.length,
    matched: first.matched,
    cosine: near?.best ?? null,
    minSimilarity: near?.minSimilarity ?? 0,
    abstain: config.abstain,
  });
  const reranker = opts.local?.reranker() ?? null;
  const plan = rerankPlan({
    enabled: config.rerank.enabled,
    query: opts.rerank,
    abstained: reason !== null,
    ready: reranker !== null,
  });
  let outcome: RerankOutcome = plan === "call" ? "used" : plan;
  let answered = first;
  let reranked: Fused[] | null = null;
  // cerebro-entidades-resumos, door 5 (Landing 5a): never when the recall abstains.
  const graph = reason === null && config.graph.enabled ? graphOrder(prep, fused, opts) : null;
  const order = graph?.order ?? fused;
  if (graph) answered = answerFrom(prep, graph.order);
  if (plan === "call") {
    // Door 5: the best `candidates` sections of the fused order (each fused file's section, as the answer would take
    // it), every one of a file this caller may read; reordered by the reranker's "yes", the rest after them.
    const head: Array<{ cand: Fused; text: string }> = [];
    for (const cand of order) {
      if (head.length >= config.rerank.candidates) break;
      const best = prep.open(cand.file, cand.near)?.best;
      if (best) head.push({ cand, text: best.section.body.trim().slice(0, RERANK_CHARS) });
    }
    if (head.length === 0) outcome = "skipped";
    else
      try {
      const scores = await opts.local!.rerank(reranker!, question, head.map((h) => h.text), config.rerank.timeoutMs);
      const sorted = head
        .map((h, i) => ({ cand: h.cand, score: scores[i]!, i }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((s) => s.cand);
      const taken = new Set(sorted);
      reranked = [...sorted, ...order.filter((cand) => !taken.has(cand))];
      answered = answerFrom(prep, reranked);
    } catch (error) {
      outcome = rerankFailure(error);
    }
  }
  const result = resultOf(prep, fused, answered, reason, outcome, reranked !== null);
  if (graph) {
    const byPath = new Map(graph.ppr.map((cand, i) => [cand.file.path, i + 1]));
    result.answerContext = result.answerContext.map((c) =>
      byPath.has(c.path) ? { ...c, graph: byPath.get(c.path)! } : c,
    );
  }
  return {
    result,
    fused: fused.map((c) => c.file),
    graphed: graph ? graph.order.map((c) => c.file) : null,
    reranked: reranked ? reranked.map((c) => c.file) : null,
  };
}

/**
 * Door 5 (AC 40 to AC 44, Landing 5a): the personalized PageRank from the first 20 fused files over the caller's graph,
 * its order (the fused files and at most 3 others every filter of the recall admits), and the RRF (k 60) of the fused
 * order and that one.
 */
function graphOrder(
  prep: Prepared,
  fused: readonly Fused[],
  opts: HybridRecallOptions,
): { ppr: Fused[]; order: Fused[] } {
  const { db, paths, settings, scope } = prep;
  const allowRow = storedRowFilter(settings.excludes, { homeDir: paths.home });
  const coMentions =
    opts.graph?.coMentions ?? (() => coMentionEdges(computeEntities(readMentions(db, allowRow), readCorrections(db))));
  const fusedIds = fused.map((c) => c.file.id);
  const seeds = pprSeeds(fusedIds);
  const graph = recallGraph(
    db,
    {
      allowRow,
      readable: (p) => isReadable(scope, p),
      relatedTable: opts.graph?.relatedTable ?? "file_related",
      coMentions,
    },
    seeds.keys(),
  );
  const { scores } = personalizedPageRank(graph, seeds);
  const byId = new Map<number, Fused>(fused.map((c) => [c.file.id, c]));
  const lookup = db.prepare("SELECT * FROM files WHERE id = ?");
  const admit = (id: number): boolean => {
    const row = lookup.get(id) as Record<string, unknown> | undefined;
    if (!row) return false;
    const file = fileRowFromDb(row);
    if (!prep.admit(file)) return false;
    byId.set(id, { file, score: 0, reasons: ["reached through the graph"], matched: new Set<string>() });
    return true;
  };
  const ppr = pprOrder(fusedIds, scores, admit).map((id) => byId.get(id)!);
  const order = fuse([fusedIds, ppr.map((c) => c.file.id)]).map(({ id }) => byId.get(id)!);
  return { ppr, order };
}

/** The answer as returned: today's order (by score) unless the reranker ordered it, empty when abstained, within the budget. */
function resultOf(
  prep: Prepared,
  fused: readonly Fused[],
  answered: { answer: RecallContext[]; opened: number },
  reason: AbstainReason | null,
  rerank: RerankOutcome,
  rerankOrdered: boolean,
): RecallResult {
  const answer = rerankOrdered
    ? answered.answer
    : [...answered.answer].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const budgeted = reason === null ? withinTokenBudget(answer, prep.settings.memory.recall.tokenBudget) : { kept: [], tokensEstimate: 0 };
  return {
    question: prep.question,
    keywords: prep.keywords,
    answerContext: budgeted.kept,
    tokensEstimate: budgeted.tokensEstimate,
    candidatesConsidered: fused.length,
    opened: answered.opened,
    candidates: fused.slice(0, 10).map((c) => ({ path: c.file.path, score: c.score, why: candidateWhy(c) })),
    durationMs: Date.now() - prep.started,
    abstained: reason !== null,
    abstainReason: reason,
    rerank,
  };
}

/**
 * The files the recall would open for a question, in its order before opening, at most `depth` deep, by words alone:
 * the same candidates and scores as `recall`, with no file read.
 */
export function recallOrder(db: Db, paths: MordomoPaths, settings: Settings, question: string, depth: number): FileRow[] {
  const keywords = extractKeywords(question);
  if (keywords.length === 0) return [];
  const scope = grantedReadScope(settings, paths.home);
  return scoreCandidates(db, paths, settings, scope, keywords, {})
    .slice(0, depth)
    .map((cand) => cand.file);
}

/**
 * The recall by words alone, with door 4's abstention, the links up to `memory.recall.hops` and the token budget: what
 * `hybridRecall` answers with no vectors and no reranker ready. Synchronous: nothing is embedded.
 */
export function recall(db: Db, paths: MordomoPaths, settings: Settings, question: string, opts: RecallOptions = {}): RecallResult {
  const prep = prepare(db, paths, settings, question, opts);
  const config = settings.memory.recall;
  const fused = fuseCandidates(prep, null);
  const answered = answerFrom(prep, fused);
  const reason = decideAbstention({
    keywords: prep.keywords.length,
    candidates: fused.length,
    matched: answered.matched,
    cosine: null,
    minSimilarity: 0,
    abstain: config.abstain,
  });
  const rerank = rerankPlan({ enabled: config.rerank.enabled, query: undefined, abstained: reason !== null, ready: false });
  return resultOf(prep, fused, answered, reason, rerank === "call" ? "skipped" : rerank, false);
}

/**
 * The recall of `GET /api/memory/recall`, `mordomo recall` and `mordomo eval` (cerebro-busca-significado, S5 and S6):
 * the text candidates and the files of the 50 sections nearest to the question, fused by RRF; door 4's abstention; the
 * reranker over the best fused sections when it is on and ready; the links up to `hops`; the token budget.
 */
export async function hybridRecall(
  db: Db,
  paths: MordomoPaths,
  settings: Settings,
  question: string,
  opts: HybridRecallOptions = {},
): Promise<RecallResult> {
  return (await runRecall(db, paths, settings, question, opts)).result;
}


// --------------------------------------------------------- recall stats ----

const RECALL_STATS_KEY = "recall.stats";
const MAX_TRACKED_PATHS = 500;

export interface RecallPathStat {
  path: string;
  count: number;
  lastAt: number;
}

export interface RecallStats {
  totalRecalls: number;
  totalTokens: number;
  /** Paths by recall frequency, most recalled first. */
  paths: RecallPathStat[];
  lastAt: number | null;
}

interface StoredStats {
  totalRecalls: number;
  totalTokens: number;
  lastAt: number | null;
  paths: Record<string, { count: number; lastAt: number }>;
}

function loadStats(db: Db): StoredStats {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(RECALL_STATS_KEY) as { value: string } | undefined;
  if (!row) return { totalRecalls: 0, totalTokens: 0, lastAt: null, paths: {} };
  try {
    const parsed = JSON.parse(row.value) as Partial<StoredStats>;
    return {
      totalRecalls: parsed.totalRecalls ?? 0,
      totalTokens: parsed.totalTokens ?? 0,
      lastAt: parsed.lastAt ?? null,
      paths: parsed.paths ?? {},
    };
  } catch {
    return { totalRecalls: 0, totalTokens: 0, lastAt: null, paths: {} };
  }
}

/** Record which files a recall surfaced — the "recall frequency" the consolidation skill promotes by. */
export function recordRecall(db: Db, result: RecallResult, now = Date.now()): void {
  const stats = loadStats(db);
  stats.totalRecalls++;
  stats.totalTokens += result.tokensEstimate;
  stats.lastAt = now;
  for (const ctx of result.answerContext) {
    const cur = stats.paths[ctx.path] ?? { count: 0, lastAt: 0 };
    stats.paths[ctx.path] = { count: cur.count + 1, lastAt: now };
  }
  const entries = Object.entries(stats.paths);
  if (entries.length > MAX_TRACKED_PATHS) {
    entries.sort((a, b) => b[1].count - a[1].count || b[1].lastAt - a[1].lastAt);
    stats.paths = Object.fromEntries(entries.slice(0, MAX_TRACKED_PATHS));
  }
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    RECALL_STATS_KEY,
    JSON.stringify(stats),
  );
}

export function recallStats(
  db: Db,
  limit = 50,
  /** Which paths the caller may see (today's policy, and the folders hidden from it); all without it. */
  allow?: (absolute: string) => boolean,
): RecallStats {
  const stats = loadStats(db);
  const paths = Object.entries(stats.paths)
    .filter(([p]) => !allow || allow(p))
    .map(([p, s]) => ({ path: p, count: s.count, lastAt: s.lastAt }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.path.localeCompare(b.path))
    .slice(0, limit);
  return { totalRecalls: stats.totalRecalls, totalTokens: stats.totalTokens, paths, lastAt: stats.lastAt };
}

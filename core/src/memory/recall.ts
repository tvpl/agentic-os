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
import { fileRowFromDb, type FileRow } from "./indexer.js";
import { extractLinks } from "./linkParser.js";
import { resolveWikilink } from "./links.js";
import { readEscopo, readNatureza, type Escopo, type Natureza, type Passage } from "./natureza.js";
import { areaSlug } from "./routers.js";

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
}

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
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (k.length < 2 || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const raw of question.split(/\s+/)) {
    const token = raw.replace(/^[^\p{L}\d/\\._~-]+|[^\p{L}\d/\\._~-]+$/gu, "");
    if (!token) continue;
    if (isPathLike(token)) {
      push(fold(token));
      continue;
    }
    for (const part of fold(token).split(/[^a-z0-9]+/)) {
      if (!part || STOPWORDS.has(part)) continue;
      if (/^\d+$/.test(part) && part.length < 4) continue; // bare small numbers carry nothing
      push(stemLite(part));
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

function ftsTerm(keyword: string): string {
  return `"${keyword.replace(/["*]/g, "")}"*`;
}

function scoreCandidates(db: Db, paths: MordomoPaths, settings: Settings, scope: ReadScope, keywords: string[], opts: RecallOptions): Scored[] {
  const limit = Math.min(Math.max(opts.candidateLimit ?? 60, 5), 500);
  const byId = new Map<number, Scored>();
  const areaFilter = opts.area ? "AND f.area = ?" : "";
  const stmt = db.prepare(
    `SELECT f.*, bm25(files_fts, 8.0, 3.0, 1.0) AS bm
     FROM files_fts JOIN files f ON f.id = files_fts.rowid
     WHERE files_fts MATCH ? ${areaFilter}
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
  sections.forEach((section, index) => {
    // A matching title is navigation metadata, not usable answer context.
    // Keep sections intact for pointers, but select excerpts with actual text.
    if (!section.body.trim()) return;
    const natureza = excerptNature(labels.source, section);
    // With a nature asked, the best section is the best of those natures (an excerpt with none is never one).
    if (labels.wanted && !(natureza !== null && labels.wanted.includes(natureza))) return;
    const s = scoreSection(section, keywords);
    if (!best || s.score > best.score) best = { section, score: s.score, matched: s.matched, index, natureza };
  });
  return { file, sections, best };
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

export function recall(db: Db, paths: MordomoPaths, settings: Settings, question: string, opts: RecallOptions = {}): RecallResult {
  const started = Date.now();
  const k = Math.min(Math.max(opts.k ?? 3, 1), 10);
  const excerptChars = Math.min(Math.max(opts.excerptChars ?? 1500, 200), 20_000);
  const pointerLimit = Math.min(Math.max(opts.pointerLimit ?? 2, 0), 5);
  const keywords = extractKeywords(question);
  const empty: RecallResult = {
    question,
    keywords,
    answerContext: [],
    tokensEstimate: 0,
    candidatesConsidered: 0,
    opened: 0,
    candidates: [],
    durationMs: 0,
  };
  if (keywords.length === 0) return { ...empty, durationMs: Date.now() - started };

  const scope = opts.scope ?? grantedReadScope(settings, paths.home);
  const passagesOf = db.prepare(
    "SELECT natureza, start_line AS startLine, end_line AS endLine FROM note_passages WHERE file_id = ? ORDER BY start_line",
  );
  const sourceOf = (file: FileRow): NatureSource => ({
    passages: passagesOf.all(file.id) as Passage[],
    natureza: readNatureza(file.fields),
    generated: generatedFileKind(paths, file.path),
  });
  // A file the filters cannot be met in is neither opened nor counted (AC 12): its scope, then whether it could give
  // an excerpt of a nature asked.
  const fits = (file: FileRow, source: NatureSource): boolean =>
    (!opts.escopo || opts.escopo.includes(readEscopo(file.fields) as Escopo)) &&
    (!opts.natureza || couldGive(source, opts.natureza));
  const sources = new Map<number, NatureSource>();
  const scored = scoreCandidates(db, paths, settings, scope, keywords, opts).filter((cand) => {
    if (!opts.natureza && !opts.escopo) return true;
    const source = sourceOf(cand.file);
    sources.set(cand.file.id, source);
    return fits(cand.file, source);
  });
  const labelsOf = (file: FileRow): Labelling => ({
    source: sources.get(file.id) ?? sourceOf(file),
    wanted: opts.natureza,
  });
  const maxBytes = settings.limits.maxIndexedFileBytes;
  const answer: RecallContext[] = [];
  const openedPaths = new Set<string>();
  let opened = 0;
  const lookup = db.prepare("SELECT * FROM files WHERE path = ?");

  for (const cand of scored.slice(0, k)) {
    if (openedPaths.has(cand.file.path)) continue; // already reached by a pointer — never read a file twice
    openedPaths.add(cand.file.path);
    const file = openFile(scope, cand.file, keywords, maxBytes, labelsOf(cand.file));
    opened++;
    if (!file || !file.best) continue;
    const best = file.best;
    const why = [...cand.reasons, `section "${best.section.heading}" matches ${best.matched.join(", ") || "nothing directly"}`].join("; ");
    answer.push({
      path: cand.file.path,
      section: best.section.heading,
      excerpt: excerptOf(best.section, excerptChars),
      score: Math.round((cand.score + best.score) * 100) / 100,
      why,
      natureza: best.natureza,
      escopo: readEscopo(cand.file.fields),
    });
    // (d) one level of pointers out of the chosen section.
    for (const target of pointerTargets(db, scope, best.section, cand.file, pointerLimit)) {
      if (openedPaths.has(target)) continue;
      const row = lookup.get(target) as Record<string, unknown> | undefined;
      if (!row) continue; // only indexed files — same exclusion policy as the index
      const pointedRow = fileRowFromDb(row);
      if (opts.within && !opts.within(pointedRow)) continue; // a pointer out of the work context is not followed
      if ((opts.natureza || opts.escopo) && !fits(pointedRow, sourceOf(pointedRow))) continue;
      openedPaths.add(target);
      const pointed = openFile(scope, pointedRow, keywords, maxBytes, labelsOf(pointedRow));
      opened++;
      if (!pointed || !pointed.best) continue;
      if (pointed.best.score > best.score) {
        answer.push({
          path: target,
          section: pointed.best.section.heading,
          excerpt: excerptOf(pointed.best.section, excerptChars),
          score: Math.round((cand.score + pointed.best.score) * 100) / 100,
          why: `pointer from ${path.basename(cand.file.path)} § "${best.section.heading}"; section "${pointed.best.section.heading}" matches ${pointed.best.matched.join(", ")}`,
          via: cand.file.path,
          natureza: pointed.best.natureza,
          escopo: readEscopo(pointedRow.fields),
        });
      }
    }
  }
  answer.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const tokensEstimate = answer.reduce((sum, c) => sum + Math.ceil(c.excerpt.length / 4), 0);
  return {
    question,
    keywords,
    answerContext: answer,
    tokensEstimate,
    candidatesConsidered: scored.length,
    opened,
    candidates: scored.slice(0, 10).map((c) => ({ path: c.file.path, score: c.score, why: c.reasons.join("; ") })),
    durationMs: Date.now() - started,
  };
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

export function recallStats(db: Db, limit = 50): RecallStats {
  const stats = loadStats(db);
  const paths = Object.entries(stats.paths)
    .map(([p, s]) => ({ path: p, count: s.count, lastAt: s.lastAt }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.path.localeCompare(b.path))
    .slice(0, limit);
  return { totalRecalls: stats.totalRecalls, totalTokens: stats.totalTokens, paths, lastAt: stats.lastAt };
}

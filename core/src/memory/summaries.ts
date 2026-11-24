import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { LABELLED_NATUREZAS, type RunStatus } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import { grantedReadScope, homeReadScope, readWorkspaceFile } from "../security/safeFs.js";
import { contextMembership, findContext } from "./contexts.js";
import { fieldsFromDb } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { linkEdges } from "./links.js";
import { readNatureza } from "./natureza.js";
import { splitSections } from "./sections.js";

/**
 * A summary of an area or a work context (.specs/features/cerebro-entidades-resumos, door 6): the sources a run of the
 * read-only skill `brain-summarize` is handed (up to 30 files the agents read, in the order of the context map), the
 * snapshot of each (size, mtime, SHA-256) kept in `summary_runs`, the check of `artifacts/<run>/summary.json` on read
 * (the rules of C10's door 3, the scope being the recorded sources), what a run's status means for the summary, and
 * whether a summary is still fresh. Nothing here is a note: a summary never enters `memory/`.
 */

/** The read-only skill a summary runs (door 6). */
export const SUMMARY_SKILL = "brain-summarize";
/** The most sources a summary is handed (door 6). */
export const SUMMARY_SOURCES_MAX = 30;
/** `artifacts/<run>/summary.json` is read up to this many bytes (door 6). */
export const SUMMARY_FILE_MAX_BYTES = 65_536;
/** A source is hashed up to this many bytes; a larger one reads as changed whenever its size or mtime moves. */
const SOURCE_HASH_MAX_BYTES = 64 * 1024 * 1024;

const LABELLED: ReadonlySet<string> = new Set(LABELLED_NATUREZAS);

/**
 * What the skill writes to `artifacts/<run>/summary.json` (door 6): 1 to 10 paragraphs of at most 1 200 characters, each
 * citing 1 to 6 sections of the sources. An unknown key is dropped, as the ask's answer is read.
 */
export const SummaryFileSchema = z.object({
  v: z.literal(1, { errorMap: () => ({ message: "v must be 1" }) }),
  paragraphs: z
    .array(
      z.object({
        text: z
          .string()
          .min(1, "a paragraph's text is required")
          .max(1200, "a paragraph's text has at most 1200 characters"),
        citations: z
          .array(
            z.object({
              path: z.string().min(1, "citation.path is required").max(4096),
              section: z
                .string({ required_error: "citation.section is required" })
                .min(1, "citation.section is required")
                .max(200),
            }),
          )
          .min(1, "a paragraph cites 1 to 6 sections")
          .max(6, "a paragraph cites 1 to 6 sections"),
      }),
    )
    .min(1, "1 to 10 paragraphs")
    .max(10, "1 to 10 paragraphs"),
});

export type SummaryScopeKind = "area" | "context";

/** A scope resolved against today's settings: its name, and whether an index row is inside it. */
export interface ResolvedSummaryScope {
  kind: SummaryScopeKind;
  id: string;
  /** The area's name, or the context's name. */
  name: string;
  /** The skill's `scope` input: `area:<name>` or `context:<id>`. */
  input: string;
  within: (row: { root: string; rel: string; area: string | null }) => boolean;
}

/** One recorded source (the JSON of `summary_runs.sources`). */
export interface SummarySource {
  path: string;
  size: number;
  mtime: number;
  /** Hex SHA-256 of the file's bytes when the run was started. */
  sha256: string;
}

export interface SummaryEnv {
  db: Db;
  paths: MordomoPaths;
  /** The owner's settings: the areas, the contexts and today's policy come from them. */
  settings: Settings;
  /** Whether an absolute path is hidden from agents today. */
  hidden: (absolute: string) => boolean;
}

/** The scope `kind`/`id` names today, or null when none (`404 scope_not_found`). */
export function resolveSummaryScope(
  env: Pick<SummaryEnv, "paths" | "settings">,
  kind: SummaryScopeKind,
  id: string,
): ResolvedSummaryScope | null {
  if (kind === "area") {
    if (!env.settings.areas.includes(id)) return null;
    return { kind, id, name: id, input: `area:${id}`, within: (row) => row.area === id };
  }
  // `all` is the whole index for the contexts' finder, and no context here.
  const context = id === "all" ? undefined : findContext(env.settings, id);
  if (!context) return null;
  const member = contextMembership({ paths: env.paths, settings: env.settings }, context);
  return { kind, id: context.id, name: context.name, input: `context:${context.id}`, within: member };
}

/** A file of a scope, as the index holds it. */
export interface ScopeFile {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  area: string | null;
  size: number;
  mtime: number;
}

/** The routers the engine writes into memory/: pointers to the files, never a source of their own. */
function routerTest(paths: MordomoPaths): (file: { path: string }) => boolean {
  const master = path.join(paths.memory, "ROUTER.md");
  const areas = path.join(paths.memory, "areas") + path.sep;
  const contexts = path.join(paths.memory, "contexts") + path.sep;
  return (file) => file.path === master || file.path.startsWith(areas) || file.path.startsWith(contexts);
}

/**
 * Every file of the scope a summary may read (AC 48): inside the scope, shown by today's policy, outside the folders
 * hidden from agents, and no router; ordered as the context map orders its key files (`renderContextMap`): the most
 * linked to from inside the scope first, then the most recently touched.
 */
export function summaryScopeFiles(env: SummaryEnv, scope: Pick<ResolvedSummaryScope, "within">): ScopeFile[] {
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const isRouter = routerTest(env.paths);
  const files = (
    env.db
      .prepare("SELECT id, root, rel, path, name, area, size, mtime FROM files ORDER BY mtime DESC")
      .all() as ScopeFile[]
  ).filter((f) => !isRouter(f) && scope.within(f) && policy(f) && !env.hidden(f.path));
  const inside = new Set(files.map((f) => f.id));
  const links = new Map<number, number>();
  for (const edge of linkEdges(env.db, policy)) {
    if (inside.has(edge.source) && inside.has(edge.target)) {
      links.set(edge.target, (links.get(edge.target) ?? 0) + 1);
    }
  }
  // Array.prototype.sort is stable: files linked to as often keep the most recent first.
  return files.sort((a, b) => (links.get(b.id) ?? 0) - (links.get(a.id) ?? 0));
}

/** The hex SHA-256 of a file's bytes, read through the safe reader; null when it cannot be read. */
export function sourceSha256(env: Pick<SummaryEnv, "paths" | "settings">, file: string): string | null {
  try {
    const { bytes } = readWorkspaceFile(grantedReadScope(env.settings, env.paths.home, [env.paths.memory]), file, {
      maxBytes: SOURCE_HASH_MAX_BYTES,
      strict: true,
    });
    return crypto.createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

/** The sources of a new summary (AC 47): the first 30 files of the scope, each with its size, mtime and SHA-256. */
export function chooseSummarySources(env: SummaryEnv, scope: Pick<ResolvedSummaryScope, "within">): SummarySource[] {
  const out: SummarySource[] = [];
  for (const file of summaryScopeFiles(env, scope)) {
    if (out.length === SUMMARY_SOURCES_MAX) break;
    const sha256 = sourceSha256(env, file.path);
    // A file that cannot be read now is no source the skill could read either.
    if (sha256 === null) continue;
    out.push({ path: file.path, size: file.size, mtime: file.mtime, sha256 });
  }
  return out;
}

// ---- the check of summary.json (door 6, by the rules of C10's door 3) ------------------------------------------------

export interface SummaryCitation {
  path: string;
  section: string;
  name: string;
  fileId: number;
  natureza?: (typeof LABELLED_NATUREZAS)[number];
}
export interface SummaryParagraph {
  text: string;
  citations: SummaryCitation[];
}

export type SummaryVerdict =
  | { ok: true; paragraphs: SummaryParagraph[] }
  /** `path`: the file the refusal names, when it names one (a caller that may not see it is not told of it). */
  | { ok: false; reason: string; path?: string };

export interface SummaryCheckEnv extends SummaryEnv {
  /** The recorded sources' paths: the only files a summary may cite. */
  sources: ReadonlySet<string>;
}

interface CitedRow {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  ext: string;
  fields: string | null;
}

/**
 * Accept or refuse a summary (AC 54), the whole of it, with the reason its rule gives. A cited section is looked for in
 * the text the index stores for the file, so a read opens no source file.
 */
export function checkSummary(bytes: Buffer, env: SummaryCheckEnv): SummaryVerdict {
  if (bytes.length > SUMMARY_FILE_MAX_BYTES) {
    return { ok: false, reason: `O resumo passa de ${SUMMARY_FILE_MAX_BYTES} bytes.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "O resumo não é JSON." };
  }
  const parsed = SummaryFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
    return { ok: false, reason: `O resumo não segue o formato de summary.json: ${issues}` };
  }
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const rowOf = env.db.prepare("SELECT id, root, rel, path, name, ext, fields FROM files WHERE path = ?");
  const textOf = env.db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const headings = new Map<number, Set<string>>();
  const headingsOf = (row: CitedRow): Set<string> => {
    let found = headings.get(row.id);
    if (found === undefined) {
      const text = (textOf.get(row.id) as { content: string } | undefined)?.content ?? "";
      const markdown = row.ext === ".md" || row.ext === ".markdown";
      found = new Set(splitSections(text, markdown).map((s) => s.heading));
      headings.set(row.id, found);
    }
    return found;
  };

  const paragraphs: SummaryParagraph[] = [];
  for (const [i, p] of parsed.data.paragraphs.entries()) {
    const where = `do parágrafo ${i + 1}`;
    const citations: SummaryCitation[] = [];
    for (const c of p.citations) {
      const refuse = (reason: string) => ({ ok: false as const, reason, path: c.path });
      const row = (path.isAbsolute(c.path) ? rowOf.get(path.resolve(c.path)) : undefined) as CitedRow | undefined;
      if (!row) return refuse(`A citação ${where} nomeia ${c.path}, que o índice não tem.`);
      if (!policy(row)) return refuse(`A citação ${where} nomeia ${c.path}, que a política de hoje exclui.`);
      if (env.hidden(row.path)) {
        return refuse(`A citação ${where} nomeia ${c.path}, que está numa pasta escondida dos agentes.`);
      }
      if (!env.sources.has(row.path)) {
        return refuse(`A citação ${where} nomeia ${c.path}, que não é uma das fontes gravadas do resumo.`);
      }
      if (!headingsOf(row).has(c.section)) {
        return refuse(`A citação ${where} nomeia a seção "${c.section}" de ${c.path}, que o arquivo não tem.`);
      }
      const natureza = readNatureza(fieldsFromDb(row.fields));
      citations.push({
        path: row.path,
        section: c.section,
        name: row.name,
        fileId: row.id,
        ...(natureza !== null && LABELLED.has(natureza) ? { natureza: natureza as SummaryCitation["natureza"] } : {}),
      });
    }
    paragraphs.push({ text: p.text, citations });
  }
  return { ok: true, paragraphs };
}

/** The bytes of a run's `summary.json`, or why there are none to check. */
export function readSummaryFile(
  env: Pick<SummaryEnv, "paths" | "settings">,
  runId: string,
): { bytes: Buffer } | { missing: true } | { reason: string } {
  try {
    const { bytes } = readWorkspaceFile(
      homeReadScope(env.paths.home, [env.paths.artifacts], env.settings.excludes),
      path.join(env.paths.artifacts, runId, "summary.json"),
      { maxBytes: SUMMARY_FILE_MAX_BYTES, strict: true },
    );
    return { bytes };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { missing: true };
    if (code === "file_too_large") return { reason: `O resumo passa de ${SUMMARY_FILE_MAX_BYTES} bytes.` };
    return { reason: err instanceof Error ? err.message : String(err) };
  }
}

/** A run's `summary.json` judged today (AC 54), or null when the run wrote none. */
export function judgeSummaryRun(
  env: SummaryEnv,
  runId: string,
  sources: ReadonlySet<string>,
): SummaryVerdict | null {
  const file = readSummaryFile(env, runId);
  if ("missing" in file) return null;
  if ("reason" in file) return { ok: false, reason: file.reason };
  return checkSummary(file.bytes, { ...env, sources });
}

// ---- what a run means for its scope's summary (AC 54, AC 55) ----------------------------------------------------------

const OPEN_STATUSES: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting_approval"]);

export type SummaryRunOutcome =
  | { kind: "running" }
  | { kind: "candidate"; paragraphs: SummaryParagraph[] }
  | { kind: "error"; lastError: string; path?: string };

/**
 * One run of a scope, mapped: an open one is still running (its file is not read); a `done` one is a candidate for the
 * current summary when its file passes today's check, else its reason; any other end is `A execução terminou em
 * <status>.`. `read` checks the file, or answers null when the run wrote none.
 */
export function summaryRunOutcome(status: RunStatus, read: () => SummaryVerdict | null): SummaryRunOutcome {
  if (OPEN_STATUSES.has(status)) return { kind: "running" };
  if (status !== "done") return { kind: "error", lastError: `A execução terminou em ${status}.` };
  const verdict = read();
  if (verdict === null) return { kind: "error", lastError: "A execução não escreveu summary.json." };
  if (!verdict.ok) {
    return { kind: "error", lastError: verdict.reason, ...(verdict.path !== undefined ? { path: verdict.path } : {}) };
  }
  return { kind: "candidate", paragraphs: verdict.paragraphs };
}

// ---- staleness (AC 57-60) ---------------------------------------------------------------------------------------------

export type SourceState = "same" | "changed" | "removed";

/** What staleness reads of today: a path's index row, and the SHA-256 of its bytes now (null: unreadable). */
export interface SummaryToday {
  file: (absolute: string) => { size: number; mtime: number } | undefined;
  sha256: (absolute: string) => string | null;
}

export interface SummaryStaleness {
  state: "fresh" | "stale";
  changes: { changed: number; removed: number; added: number };
  sources: Array<{ path: string; state: SourceState }>;
}

/**
 * Whether a summary is still fresh (AC 57-60): a source gone from the index or from the scope is `removed`; a source
 * whose size or mtime moved is hashed again, and is `changed` only when its SHA-256 moved too (a source whose size and
 * mtime are as recorded is never read); a file of the scope that is no source and whose mtime is after `startedAt` is
 * `added`. Any of the three makes it `stale`.
 */
export function summaryState(
  recorded: readonly SummarySource[],
  today: SummaryToday,
  scopeFiles: ReadonlyArray<{ path: string; mtime: number }>,
  startedAt: number,
): SummaryStaleness {
  const inScope = new Set(scopeFiles.map((f) => f.path));
  const changes = { changed: 0, removed: 0, added: 0 };
  const sources = recorded.map((source) => {
    const row = today.file(source.path);
    let state: SourceState = "same";
    if (row === undefined || !inScope.has(source.path)) state = "removed";
    else if (row.size !== source.size || row.mtime !== source.mtime) {
      if (today.sha256(source.path) !== source.sha256) state = "changed";
    }
    if (state === "removed") changes.removed += 1;
    if (state === "changed") changes.changed += 1;
    return { path: source.path, state };
  });
  const recordedPaths = new Set(recorded.map((s) => s.path));
  changes.added = scopeFiles.filter((f) => !recordedPaths.has(f.path) && f.mtime > startedAt).length;
  const stale = changes.changed + changes.removed + changes.added > 0;
  return { state: stale ? "stale" : "fresh", changes, sources };
}

import path from "node:path";
import {
  ASK_ANSWER_MAX_BYTES,
  AskAnswerFileSchema,
  LABELLED_NATUREZAS,
  type AskAnswer,
  type AskMode,
  type AskScope,
} from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import { realpathLenient } from "../security/paths.js";
import { grantedReadScope, readWorkspaceText } from "../security/safeFs.js";
import { CleanupContextNotFoundError, CleanupScopeRequiredError, resolveCleanupScope } from "./cleanup.js";
import { contextMembership, findContext } from "./contexts.js";
import { fieldsFromDb } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { readNatureza } from "./natureza.js";
import { splitSections } from "./sections.js";

/**
 * An ask to the second brain (.specs/features/cerebro-perguntar, doors 1-3): its scope, resolved by the rules of the
 * contexts (C2) and of the cleanup's folder (realpath equal or followed by the separator); the answer the skill
 * `brain-ask` writes to `artifacts/<run>/answer.json`, checked on read by today's policy, today's folders hidden from
 * agents and the scope, never stored already judged; and the status an ask reads from its run.
 */

/** The read-only skill an ask runs (door 2). */
export const ASK_SKILL = "brain-ask";

const LABELLED: ReadonlySet<string> = new Set(LABELLED_NATUREZAS);
/** How much of a cited file is read to find its headings. */
const CITED_MAX_BYTES = 4 * 1024 * 1024;

export interface AskEnv {
  db: Db;
  paths: MordomoPaths;
  /** The owner's settings: today's policy over the index rows comes from their excludes. */
  settings: Settings;
  /** Whether an absolute path is hidden from agents today (a folder "esconder dos agentes", one never served). */
  hidden: (absolute: string) => boolean;
}

/** `400 folder_outside_index`: the folder of a scope is outside memory/ and every indexed folder, or hidden (AC 20). */
export class AskFolderOutsideError extends Error {
  readonly statusCode = 400;
  readonly code = "folder_outside_index";
  constructor(folder: string) {
    super(`The folder ${folder} is not inside memory/ or an indexed folder that agents may read.`);
    this.name = "AskFolderOutsideError";
  }
}

/** `400 unknown_note`: a path of a notes scope is no index row today's policy shows outside the agents' hidden folders (AC 22). */
export class AskUnknownNoteError extends Error {
  readonly statusCode = 400;
  readonly code = "unknown_note";
  constructor(note: string) {
    super(`The note ${note} is no file of the index that agents may read.`);
    this.name = "AskUnknownNoteError";
  }
}

export interface ResolvedAskScope {
  /** The scope as it is stored in the run: a folder by its realpath, notes by their absolute paths. */
  scope: AskScope;
  /** The skill's `scope` input (door 2): `all`, `context:<id>`, `folder:<realpath>` or `notes:<path>;<path>…`. */
  input: string;
  /** The run's work context, for a context scope only. */
  contextId?: string;
  /** Whether an index row is inside the scope; null for the whole index. */
  within: ((row: { root: string; rel: string }) => boolean) | null;
}

interface FileRow {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  ext: string;
  fields: string | null;
}

const rowOf = (db: Db, file: string): FileRow | undefined =>
  path.isAbsolute(file)
    ? (db.prepare("SELECT id, root, rel, path, name, ext, fields FROM files WHERE path = ?").get(path.resolve(file)) as
        | FileRow
        | undefined)
    : undefined;

/** The scope of an ask (AC 17-23), or the refusal of door 1 for it. */
export function resolveAskScope(env: AskEnv, scope: AskScope): ResolvedAskScope {
  if (scope.kind === "all") return { scope, input: "all", within: null };
  if (scope.kind === "context") {
    const context = findContext(env.settings, scope.id);
    if (!context) throw new CleanupContextNotFoundError(scope.id);
    return {
      scope,
      input: `context:${context.id}`,
      contextId: context.id,
      within: contextMembership({ paths: env.paths, settings: env.settings }, context),
    };
  }
  if (scope.kind === "folder") {
    const outside = () => new AskFolderOutsideError(scope.path);
    if (!path.isAbsolute(scope.path)) throw outside();
    let within: (row: { root: string; rel: string }) => boolean;
    try {
      within = resolveCleanupScope({ paths: env.paths, settings: env.settings }, { dir: scope.path }).within;
    } catch (err) {
      if (err instanceof CleanupScopeRequiredError) throw outside();
      throw err;
    }
    const real = realpathLenient(path.resolve(scope.path));
    if (env.hidden(path.resolve(scope.path)) || env.hidden(real)) throw outside();
    return { scope: { kind: "folder", path: real }, input: `folder:${real}`, within };
  }
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const keys = new Set<string>();
  const files: string[] = [];
  for (const asked of scope.paths) {
    const row = rowOf(env.db, asked);
    if (!row || !policy(row) || env.hidden(row.path)) {
      throw new AskUnknownNoteError(asked);
    }
    keys.add(`${row.root}\0${row.rel}`);
    if (!files.includes(row.path)) files.push(row.path);
  }
  return {
    scope: { kind: "notes", paths: files },
    input: `notes:${files.join(";")}`,
    within: (row) => keys.has(`${row.root}\0${row.rel}`),
  };
}

/**
 * The sentences of a text (door 3, AC 33): each `.`, `!` or `?` followed by a space or by the end of the text ends one;
 * a dot before a digit (`2.5`) or before a letter or a colon (`Ex.:o`) does not.
 */
export function countSentences(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

export interface AskCheckEnv extends AskEnv {
  /** The scope's rows (null: the whole index). */
  within: ((row: { root: string; rel: string }) => boolean) | null;
  mode: AskMode;
}

export type AskVerdict = { ok: true; answer: AskAnswer } | { ok: false; reason: string };

type Citation = AskAnswer["paragraphs"][number]["citations"][number];

/** Accept or refuse an answer (door 3), with the reason a refusal is shown with; the whole answer, never a part. */
export function checkAskAnswer(bytes: Buffer, env: AskCheckEnv): AskVerdict {
  if (bytes.length > ASK_ANSWER_MAX_BYTES) {
    return { ok: false, reason: `A resposta passa de ${ASK_ANSWER_MAX_BYTES} bytes.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "A resposta não é JSON." };
  }
  const parsed = AskAnswerFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
    return { ok: false, reason: `A resposta não segue o formato de answer.json: ${issues}` };
  }
  const file = parsed.data;
  if (env.mode === "direct" && file.takeFeedback !== undefined) {
    return { ok: false, reason: "Uma resposta direta não traz takeFeedback." };
  }
  if (env.mode === "reason_first") {
    if (file.takeFeedback === undefined) {
      return { ok: false, reason: "Uma resposta de \"raciocine primeiro\" precisa de takeFeedback." };
    }
    const { agrees, disagrees, missing } = file.takeFeedback;
    if (agrees.length + disagrees.length + missing.length === 0) {
      return { ok: false, reason: "O takeFeedback não tem nenhum item em agrees, disagrees ou missing." };
    }
  }
  if (file.provocation !== undefined) {
    const sentences = countSentences(file.provocation.text);
    if (sentences > 2) return { ok: false, reason: `A provocação tem ${sentences} frases; no máximo 2.` };
  }

  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const scope = grantedReadScope(env.settings, env.paths.home, [env.paths.memory]);
  const headings = new Map<string, Set<string> | null>();
  const headingsOf = (row: FileRow): Set<string> | null => {
    if (!headings.has(row.path)) {
      let found: Set<string> | null = null;
      try {
        const text = readWorkspaceText(scope, row.path, { maxBytes: CITED_MAX_BYTES, strict: true }).text;
        const markdown = row.ext === ".md" || row.ext === ".markdown";
        found = new Set(splitSections(text, markdown).map((s) => s.heading));
      } catch {
        found = null;
      }
      headings.set(row.path, found);
    }
    return headings.get(row.path)!;
  };
  /** The citation as the host returns it, or the reason it may not be made. */
  const cite = (c: { path: string; section: string }, where: string): Citation | string => {
    const row = rowOf(env.db, c.path);
    if (!row) return `A citação ${where} nomeia ${c.path}, que o índice não tem.`;
    if (!policy(row)) return `A citação ${where} nomeia ${c.path}, que a política de hoje exclui.`;
    if (env.hidden(row.path)) return `A citação ${where} nomeia ${c.path}, que está numa pasta escondida dos agentes.`;
    if (env.within !== null && !env.within(row)) {
      return `A citação ${where} nomeia ${c.path}, que está fora do escopo da pergunta.`;
    }
    const sections = headingsOf(row);
    if (sections === null) return `A citação ${where} nomeia ${c.path}, que não pôde ser lido.`;
    if (!sections.has(c.section)) {
      return `A citação ${where} nomeia a seção "${c.section}" de ${c.path}, que o arquivo não tem.`;
    }
    const natureza = readNatureza(fieldsFromDb(row.fields));
    return {
      path: row.path,
      section: c.section,
      name: row.name,
      fileId: row.id,
      ...(natureza !== null && LABELLED.has(natureza) ? { natureza: natureza as Citation["natureza"] } : {}),
    };
  };
  const citeAll = (
    list: ReadonlyArray<{ path: string; section: string }>,
    where: string,
  ): Citation[] | string => {
    const out: Citation[] = [];
    for (const c of list) {
      const done = cite(c, where);
      if (typeof done === "string") return done;
      out.push(done);
    }
    return out;
  };

  const paragraphs: AskAnswer["paragraphs"] = [];
  for (const [i, p] of file.paragraphs.entries()) {
    const citations = citeAll(p.citations, `do parágrafo ${i + 1}`);
    if (typeof citations === "string") return { ok: false, reason: citations };
    paragraphs.push({ text: p.text, citations });
  }
  const answer: AskAnswer = { paragraphs };
  if (file.takeFeedback !== undefined) {
    const feedback: NonNullable<AskAnswer["takeFeedback"]> = { agrees: [], disagrees: [], missing: [] };
    for (const list of ["agrees", "disagrees", "missing"] as const) {
      for (const [i, item] of file.takeFeedback[list].entries()) {
        const citations = citeAll(item.citations, `do item ${i + 1} de ${list}`);
        if (typeof citations === "string") return { ok: false, reason: citations };
        feedback[list].push({ text: item.text, citations });
      }
    }
    answer.takeFeedback = feedback;
  }
  if (file.provocation !== undefined) {
    const citation = cite(file.provocation.citation, "da provocação");
    if (typeof citation === "string") return { ok: false, reason: citation };
    answer.provocation = { kind: file.provocation.kind, text: file.provocation.text, citation };
  }
  return { ok: true, answer };
}

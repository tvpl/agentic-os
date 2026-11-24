import path from "node:path";
import { z } from "zod";
import type { RunStatus } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import { homeReadScope, readWorkspaceFile } from "../security/safeFs.js";
import {
  activeCorrections,
  suggestionPending,
  type CorrectionRow,
  type Entity,
  type EntityView,
  type SuggestionChoice,
} from "./entities.js";
import { entityNorm } from "./entityMentions.js";
import { storedRowFilter } from "./indexer.js";
import { findMention, mentionExcerpt } from "./mentions.js";
import { routerTest } from "./summaries.js";

/**
 * The AI suggestions of entities (.specs/features/cerebro-entidades-resumos, doors 9 and 10): which notes a batch of the
 * read-only skill `brain-entities` reads (up to 20 Markdown files the agents read that changed since the last batch), the
 * durable record of the batches, the `known` names it is handed, and the check of `artifacts/<run>/entities.json` on
 * read, suggestion by suggestion (a bad one leaves alone, with its reason) and whole (the size, JSON, the schema).
 * Nothing here changes an entity: only the owner's `accept` does, through the corrections (door 10).
 */

/** The read-only skill a batch runs (door 9). */
export const SUGGESTIONS_SKILL = "brain-entities";
/** At most this many files in a batch (AC 87). */
export const SUGGESTION_BATCH_FILES_MAX = 20;
/** The service starts a batch on its own only when the last one started more than this long ago (AC 87). */
export const SUGGESTION_BATCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** `artifacts/<run>/entities.json` is read up to this many bytes (door 9). */
export const SUGGESTIONS_FILE_MAX_BYTES = 65_536;
/** At most this many suggestions in a batch (door 9). */
export const SUGGESTIONS_MAX = 50;
/** The record of the batches in `meta`: it outlives the runs, so the rhythm survives their retention (L-060). */
const BATCHES_KEY = "entities.suggestions";
/** How many batches the record keeps, newest first. */
const BATCHES_KEPT = 20;

export interface SuggestionEnv {
  db: Db;
  paths: MordomoPaths;
  /** The owner's settings: today's policy comes from them. */
  settings: Settings;
  /** Whether an absolute path is hidden from agents today. */
  hidden: (absolute: string) => boolean;
}

// ---- the batches ------------------------------------------------------------------------------------------------------

/** One batch: its run, when it was started (the clock of the rhythm) and the files it was handed. */
export interface SuggestionBatch {
  runId: string;
  startedAt: number;
  files: string[];
}

/** The recorded batches, newest first. */
export function suggestionBatches(db: Db): SuggestionBatch[] {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(BATCHES_KEY) as { value: string } | undefined;
  if (!row) return [];
  try {
    const value = JSON.parse(row.value) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (b): b is SuggestionBatch =>
        typeof b === "object" &&
        b !== null &&
        typeof (b as SuggestionBatch).runId === "string" &&
        typeof (b as SuggestionBatch).startedAt === "number" &&
        Array.isArray((b as SuggestionBatch).files),
    );
  } catch {
    return [];
  }
}

/** Record a batch as the newest (the record keeps the last 20). */
export function recordSuggestionBatch(db: Db, batch: SuggestionBatch): void {
  const all = [batch, ...suggestionBatches(db).filter((b) => b.runId !== batch.runId)].slice(0, BATCHES_KEPT);
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(BATCHES_KEY, JSON.stringify(all));
}

/**
 * The files of a new batch (AC 87): Markdown files of the index that today's policy shows and that are outside the
 * folders hidden from agents, no router, with an `mtime` after `since` (the start of the last batch; 0 for none), the
 * newest first, at most 20.
 */
export function suggestionBatchFiles(
  env: SuggestionEnv,
  since: number,
): Array<{ id: number; path: string; mtime: number }> {
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const isRouter = routerTest(env.paths);
  const rows = env.db
    .prepare(
      "SELECT id, root, rel, path, mtime FROM files WHERE ext IN ('.md', '.markdown') AND mtime > ? ORDER BY mtime DESC, id",
    )
    .all(since) as Array<{ id: number; root: string; rel: string; path: string; mtime: number }>;
  return rows
    .filter((r) => policy(r) && !env.hidden(r.path) && !isRouter(r))
    .slice(0, SUGGESTION_BATCH_FILES_MAX)
    .map((r) => ({ id: r.id, path: r.path, mtime: r.mtime }));
}

/**
 * The skill's `known` input (AC 92): the name and the aliases of every entity the agents see, then every norm the owner
 * rejected, distinct, one per line.
 */
export function suggestionKnown(entities: readonly Entity[], corrections: readonly CorrectionRow[]): string[] {
  const names = new Set<string>();
  for (const e of entities) for (const n of [e.name, ...e.aliases]) names.add(n);
  const rejected = activeCorrections(corrections)
    .filter((c) => c.action === "reject")
    .map((c) => c.a);
  return [...[...names].sort(), ...rejected.filter((n) => !names.has(n))];
}

// ---- the check of entities.json (door 9) ------------------------------------------------------------------------------

const FileSchema = z.object({
  v: z.literal(1, { errorMap: () => ({ message: "v must be 1" }) }),
  suggestions: z.array(z.unknown()).max(SUGGESTIONS_MAX, `at most ${SUGGESTIONS_MAX} suggestions`),
});

const SuggestionSchema = z.object({
  kind: z.enum(["perfil", "projeto", "termo"], {
    errorMap: () => ({ message: "kind is perfil, projeto or termo" }),
  }),
  name: z.string().min(2, "a name has 2 to 80 characters").max(80, "a name has 2 to 80 characters"),
  aliases: z.array(z.string().min(1).max(80)).max(5, "at most 5 aliases").optional(),
  mergeWith: z.string().min(1).max(300).optional(),
  evidence: z
    .array(z.object({ path: z.string().min(1).max(4096), line: z.number().int().min(1) }))
    .min(1, "1 to 3 evidence lines")
    .max(3, "1 to 3 evidence lines"),
});

/** A suggestion that passed today's check, with the lines that prove it. */
export interface CheckedSuggestion extends SuggestionChoice {
  /** `<run id>:<place in entities.json>`. */
  id: string;
  /** A suggestion is never a tag (door 9). */
  kind: "perfil" | "projeto" | "termo";
  evidence: Array<{ fileId: number; path: string; line: number; excerpt: string }>;
}

export type SuggestionsVerdict =
  | {
      ok: true;
      suggestions: CheckedSuggestion[];
      /** The record of the batch: each suggestion left out, by its place, with the reason (AC 94, AC 95). */
      dropped: Array<{ index: number; reason: string }>;
    }
  | { ok: false; reason: string };

export interface SuggestionCheckEnv extends SuggestionEnv {
  batch: SuggestionBatch;
  /** Whether an entity key exists today (`mergeWith`, AC 97). */
  keyExists: (key: string) => boolean;
}

/**
 * Accept or refuse a batch (AC 93-97): the whole of it for its size, JSON or schema (`v`, at most 50); then each
 * suggestion alone, by its shape (kind, name of 2 to 80 characters, at most 5 aliases, 1 to 3 evidence lines), its
 * `mergeWith` (a key that exists today) and each evidence line: a file of the batch, in the index, shown by today's
 * policy, outside the folders hidden from agents, a line inside the file (the text the index stores, so no file is
 * opened) that holds the name or an alias as a whole word after the fold.
 */
export function checkSuggestions(bytes: Buffer, env: SuggestionCheckEnv): SuggestionsVerdict {
  if (bytes.length > SUGGESTIONS_FILE_MAX_BYTES) {
    return { ok: false, reason: `O lote passa de ${SUGGESTIONS_FILE_MAX_BYTES} bytes.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "O lote não é JSON." };
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
    return { ok: false, reason: `O lote não segue o formato de entities.json: ${issues}` };
  }

  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const inBatch = new Set(env.batch.files);
  const rowOf = env.db.prepare("SELECT id, root, rel, path FROM files WHERE path = ?");
  const textOf = env.db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const lines = new Map<number, string[]>();
  const linesOf = (id: number): string[] => {
    let found = lines.get(id);
    if (!found) {
      // The last line break ends the last line: it opens no line of its own.
      const text = (textOf.get(id) as { content: string } | undefined)?.content ?? "";
      found = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
      lines.set(id, found);
    }
    return found;
  };

  const suggestions: CheckedSuggestion[] = [];
  const dropped: Array<{ index: number; reason: string }> = [];
  for (const [index, item] of parsed.data.suggestions.entries()) {
    const where = `A sugestão ${index + 1}`;
    const drop = (reason: string) => dropped.push({ index, reason });
    const shape = SuggestionSchema.safeParse(item);
    if (!shape.success) {
      drop(`${where} não segue o formato: ${shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const s = shape.data;
    const norm = entityNorm(s.name);
    if (norm === "") {
      drop(`${where} tem um nome sem letra nem dígito.`);
      continue;
    }
    if (s.mergeWith !== undefined && !env.keyExists(s.mergeWith)) {
      drop(`${where} junta com ${s.mergeWith}, que não é uma entidade hoje.`);
      continue;
    }
    const aliases = s.aliases ?? [];
    const names = [s.name, ...aliases];
    const evidence: CheckedSuggestion["evidence"] = [];
    let refused: string | null = null;
    for (const e of s.evidence) {
      const file = path.isAbsolute(e.path) ? path.resolve(e.path) : e.path;
      if (!inBatch.has(file)) refused = `${where} cita ${e.path}, que não é um arquivo do lote.`;
      else {
        const row = rowOf.get(file) as { id: number; root: string; rel: string; path: string } | undefined;
        if (!row) refused = `${where} cita ${e.path}, que o índice não tem.`;
        else if (!policy(row)) refused = `${where} cita ${e.path}, que a política de hoje exclui.`;
        else if (env.hidden(row.path)) refused = `${where} cita ${e.path}, que está numa pasta escondida dos agentes.`;
        else {
          const all = linesOf(row.id);
          const text = all[e.line - 1];
          if (text === undefined) {
            refused = `${where} cita a linha ${e.line} de ${e.path}, que o arquivo não tem.`;
          } else {
            const hit = names.map((n) => findMention(text, n)).find((h) => h !== null) ?? null;
            if (!hit) refused = `${where}: a linha ${e.line} de ${e.path} não contém o nome nem um apelido.`;
            else evidence.push({ fileId: row.id, path: row.path, line: e.line, excerpt: mentionExcerpt(text, hit.start, hit.end) });
          }
        }
      }
      if (refused !== null) break;
    }
    if (refused !== null) {
      drop(refused);
      continue;
    }
    suggestions.push({
      id: `${env.batch.runId}:${index}`,
      kind: s.kind,
      name: s.name,
      norm,
      aliases,
      ...(s.mergeWith !== undefined ? { mergeWith: s.mergeWith } : {}),
      evidence,
    });
  }
  return { ok: true, suggestions, dropped };
}

/** The bytes of a batch's `entities.json`, or why there are none to check. */
export function readSuggestionsFile(
  env: Pick<SuggestionEnv, "paths" | "settings">,
  runId: string,
): { bytes: Buffer } | { missing: true } | { reason: string } {
  try {
    const { bytes } = readWorkspaceFile(
      homeReadScope(env.paths.home, [env.paths.artifacts], env.settings.excludes),
      path.join(env.paths.artifacts, runId, "entities.json"),
      { maxBytes: SUGGESTIONS_FILE_MAX_BYTES, strict: true },
    );
    return { bytes };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { missing: true };
    if (code === "file_too_large") return { reason: `O lote passa de ${SUGGESTIONS_FILE_MAX_BYTES} bytes.` };
    return { reason: err instanceof Error ? err.message : String(err) };
  }
}

const OPEN_STATUSES: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting_approval"]);

/** Whether a run of a batch is still open (queued, running or waiting for approval). */
export const batchOpen = (status: RunStatus): boolean => OPEN_STATUSES.has(status);

export type BatchOutcome =
  | { kind: "running" }
  | { kind: "accepted"; suggestions: CheckedSuggestion[]; dropped: Array<{ index: number; reason: string }> }
  | { kind: "refused"; reason: string };

/**
 * A batch's run, mapped (AC 93, AC 96): an open one is still reading; a `done` one whose `entities.json` passes today's
 * check gives its suggestions; any other end, no file or a refused file gives the reason.
 */
export function batchOutcome(env: SuggestionCheckEnv, status: RunStatus): BatchOutcome {
  if (batchOpen(status)) return { kind: "running" };
  if (status !== "done") return { kind: "refused", reason: `A execução terminou em ${status}.` };
  const file = readSuggestionsFile(env, env.batch.runId);
  if ("missing" in file) return { kind: "refused", reason: "A execução não escreveu entities.json." };
  if ("reason" in file) return { kind: "refused", reason: file.reason };
  const verdict = checkSuggestions(file.bytes, env);
  if (!verdict.ok) return { kind: "refused", reason: verdict.reason };
  return { kind: "accepted", suggestions: verdict.suggestions, dropped: verdict.dropped };
}

/** The suggestions of an accepted batch still to decide today (AC 97, AC 101): none already an entity's or rejected. */
export function pendingSuggestions(
  suggestions: readonly CheckedSuggestion[],
  view: Pick<EntityView, "byKey" | "byNorm">,
  corrections: readonly CorrectionRow[],
): CheckedSuggestion[] {
  return suggestions.filter((s) => suggestionPending(view, corrections, s));
}

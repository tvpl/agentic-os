import path from "node:path";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { realpathLenient } from "../security/paths.js";
import { makeWorkspaceFilter } from "./excludes.js";

/**
 * Bi-temporal facts with provenance (.specs/features/cerebro-memoria-confiavel, doors 1 to 3).
 *
 * A fact is `subject predicate object`, valid in the world from `validFrom` until `validTo` (null = still valid), and
 * recorded at `createdAt` (`recordedAt`). Two facts are about the same thing when their keys match (`factKey`: no
 * accents, lower case, one space): asserting another object over a fact closes it, never deletes it, by the overlap rule
 * of door 2. "It was never true" is `retractedAt`, apart from "it stopped being true" (`validTo`). Every fact says where
 * it came from (a file, a run, a proposal, or the owner who typed it) and who wrote it.
 */

export const FACT_TRUSTS = ["usuario", "ferramenta", "inferido"] as const;
export type FactTrust = (typeof FACT_TRUSTS)[number];

/** `owner`, `run:<id>`, `mcp` or `unknown` (a fact older than this feature). */
export type FactAuthor = "owner" | "mcp" | "unknown" | `run:${string}`;

export interface Fact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
  validTo: number | null;
  sourceRunId: string | null;
  sourcePath: string | null;
  createdAt: number;
  /** When the fact was recorded: `createdAt`. */
  recordedAt: number;
  /** When it was found never to have been true, or null. */
  retractedAt: number | null;
  sourceLine: number | null;
  author: string;
  trust: FactTrust;
  proposalId: string | null;
  /** The `files` row whose path is `sourcePath`, or null. */
  sourceFileId: number | null;
}

export interface AssertFactInput {
  subject: string;
  predicate: string;
  object: string;
  /** Defaults to now. */
  validFrom?: number;
  /** Absent: still valid. Must be after `validFrom`. */
  validTo?: number | null | undefined;
  sourceRunId?: string | null;
  sourcePath?: string | null;
  /** A line of `sourcePath`, from 1. */
  sourceLine?: number | null | undefined;
  proposalId?: string | null | undefined;
  /** Who writes it. Defaults to `owner` (an engine call on the owner's behalf). */
  author?: FactAuthor | undefined;
  /**
   * The trust the system computed for where it came from (an accepted proposal's op, AC 56 and 64). Absent: the
   * owner's own word is `usuario`, anything else `inferido`. No request body names it.
   */
  trust?: FactTrust | undefined;
}

export interface AssertFactResult {
  fact: Fact;
  /** Facts closed or retracted by this assertion (same keys, different object). */
  invalidated: Fact[];
  /** True when an identical open fact already existed (nothing was written). */
  unchanged: boolean;
}

export interface FactQuery {
  subject?: string | undefined;
  predicate?: string | undefined;
  /** Point in time of the world: facts valid at that instant. */
  asOf?: number | undefined;
  /** Point in time of the record: what was recorded by then and not yet retracted. */
  knownAt?: number | undefined;
  /** Include closed facts too (history view). */
  includeExpired?: boolean | undefined;
  /** Include facts retracted as never true. */
  includeRetracted?: boolean | undefined;
  limit?: number | undefined;
  /** Today's policy on a fact's source (AC 20): a fact it refuses, or for which it throws, is left out. */
  allow?: ((fact: Fact) => boolean) | undefined;
}

/** `400 validation`: an assertion this layer does not take. Nothing is written. */
export class FactValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "FactValidationError";
  }
}

/** `400 provenance_required` (door 3): a fact that says neither where it came from nor that the owner wrote it. */
export class FactProvenanceError extends Error {
  readonly statusCode = 400;
  readonly code = "provenance_required";
  constructor() {
    super("A fact needs a sourcePath, a sourceRunId or a proposalId, unless the owner writes it.");
    this.name = "FactProvenanceError";
  }
}

/** `409 fact_overlap` (door 2): the new interval would split a fact of the same keys in two. Nothing is written. */
export class FactOverlapError extends Error {
  readonly statusCode = 409;
  readonly code = "fact_overlap";
  constructor(readonly fact: Fact) {
    super(`The fact ${fact.id} (${fact.object}) holds over the whole new interval; retract or close it first.`);
    this.name = "FactOverlapError";
  }
}

const MAX_TEXT = 2000;

/**
 * The key two facts are compared by (door 1): NFKD with the combining marks removed, lower case, runs of white space
 * made one space, trimmed. `Cliente  São Paulo` and `CLIENTE SÃO PAULO` are `cliente sao paulo`.
 */
export function factKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The object as two facts compare it: white space collapsed, case and accents kept (door 1). */
export function objectKey(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function norm(s: string, what: string): string {
  const v = s.trim().slice(0, MAX_TEXT);
  if (!v) throw new FactValidationError(`Fact ${what} must not be empty.`);
  return v;
}

function keyOf(s: string, what: string): string {
  const key = factKey(s);
  if (!key) throw new FactValidationError(`Fact ${what} must not be empty.`);
  return key;
}

/** Door 3: why a fact with this provenance may not be written, or null when it may. */
export function provenanceRefusal(input: {
  sourcePath?: string | null | undefined;
  sourceRunId?: string | null | undefined;
  proposalId?: string | null | undefined;
  author: string;
}): "provenance_required" | null {
  if (input.author === "owner") return null;
  if (input.sourcePath || input.sourceRunId || input.proposalId) return null;
  return "provenance_required";
}

/** The trust the system gives a fact it writes directly: the owner's own word, or what an agent inferred. */
function trustOf(author: string): FactTrust {
  return author === "owner" ? "usuario" : "inferido";
}

/** What asserting `[from, to)` does to an existing fact of the same keys and another object (door 2). */
export type OverlapAction = "close" | "retract" | "keep" | "refuse";

/**
 * The overlap rule of door 2, for an existing fact `[f.validFrom, f.validTo)` against a new `[from, to)` (null = never
 * ends):
 * - no overlap at all, or the old fact begins at or after `to` → `keep`;
 * - it begins before `from` and would outlast `to` (the new fact closed strictly inside it) → `refuse`;
 * - it begins before `from` and overlaps → `close` (its `validTo` becomes `from`);
 * - it begins at or after `from`, overlaps, and the new fact never ends → `retract`;
 * - it begins at or after `from`, before `to` (a closed new fact over its start) → `refuse`: the plan's table has no row
 *   for it, and closing, retracting or splitting would each invent a belief nobody stated (Settled mid-build).
 */
export function overlapAction(
  f: { validFrom: number; validTo: number | null },
  from: number,
  to: number | null,
): OverlapAction {
  const fEnd = f.validTo ?? Infinity;
  const end = to ?? Infinity;
  if (!(f.validFrom < end && fEnd > from)) return "keep";
  if (f.validFrom < from) return fEnd > end ? "refuse" : "close";
  if (to === null) return "retract";
  return "refuse";
}

const SELECT = "SELECT f.*, (SELECT id FROM files WHERE path = f.source_path) AS source_file_id FROM facts f";

function fromRow(row: Record<string, unknown>): Fact {
  const createdAt = row.created_at as number;
  return {
    id: row.id as number,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    validFrom: row.valid_from as number,
    validTo: (row.valid_to as number | null) ?? null,
    sourceRunId: (row.source_run_id as string | null) ?? null,
    sourcePath: (row.source_path as string | null) ?? null,
    createdAt,
    recordedAt: createdAt,
    retractedAt: (row.retracted_at as number | null) ?? null,
    sourceLine: (row.source_line as number | null) ?? null,
    author: row.author as string,
    trust: row.trust as FactTrust,
    proposalId: (row.proposal_id as string | null) ?? null,
    sourceFileId: (row.source_file_id as number | null) ?? null,
  };
}

function getFact(db: Db, id: number): Fact | null {
  const row = db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

/** What asserting a fact would do, worked out and not done (door 2): the facts it closes or retracts, or the one it refuses over. */
export interface FactPlan {
  subject: string;
  predicate: string;
  object: string;
  subjectKey: string;
  predicateKey: string;
  validFrom: number;
  validTo: number | null;
  sourcePath: string | null;
  sourceLine: number | null;
  sourceRunId: string | null;
  proposalId: string | null;
  author: FactAuthor;
  now: number;
  /** An open, unretracted fact with the same keys and object: asserting writes nothing. */
  same: Fact | null;
  /** The facts of the same keys and another object, and what asserting does to each. */
  steps: Array<{ f: Fact; action: OverlapAction }>;
}

/**
 * Work out, without writing, what `assertFact` does with `input` (cerebro-memoria-confiavel, door 2): the validation of
 * every field, the fact it would find unchanged, and what the overlap rule makes of each fact of the same keys. The
 * proposals' review shows it (`effects`) and `assertFact` applies it, so the two cannot differ.
 */
export function planFact(db: Db, input: AssertFactInput, at: number = Date.now()): FactPlan {
  const subject = norm(input.subject, "subject");
  const predicate = norm(input.predicate, "predicate");
  const object = norm(input.object, "object");
  const subjectKey = keyOf(subject, "subject");
  const predicateKey = keyOf(predicate, "predicate");
  const validFrom = input.validFrom ?? at;
  const validTo = input.validTo ?? null;
  if (validTo !== null && validTo <= validFrom) {
    throw new FactValidationError("validTo: must be after validFrom");
  }
  const sourcePath = input.sourcePath ?? null;
  const sourceLine = input.sourceLine ?? null;
  if (sourceLine !== null && (sourcePath === null || !Number.isInteger(sourceLine) || sourceLine < 1)) {
    throw new FactValidationError("sourceLine: a line of sourcePath, from 1");
  }
  const author = input.author ?? "owner";
  const sourceRunId = input.sourceRunId ?? null;
  const proposalId = input.proposalId ?? null;
  if (provenanceRefusal({ sourcePath, sourceRunId, proposalId, author })) throw new FactProvenanceError();
  const objectCompared = objectKey(object);
  const sameKeys = (
    db
      .prepare(`${SELECT} WHERE f.subject_key = ? AND f.predicate_key = ? AND f.retracted_at IS NULL ORDER BY f.id`)
      .all(subjectKey, predicateKey) as Array<Record<string, unknown>>
  ).map(fromRow);
  const same = sameKeys.find((f) => f.validTo === null && objectKey(f.object) === objectCompared) ?? null;
  const steps = sameKeys
    .filter((f) => objectKey(f.object) !== objectCompared)
    .map((f) => ({ f, action: overlapAction(f, validFrom, validTo) }));
  return {
    subject,
    predicate,
    object,
    subjectKey,
    predicateKey,
    validFrom,
    validTo,
    sourcePath,
    sourceLine,
    sourceRunId,
    proposalId,
    author,
    now: at,
    same,
    steps,
  };
}

export function assertFact(db: Db, input: AssertFactInput): AssertFactResult {
  const tx = db.transaction((): AssertFactResult => {
    const plan = planFact(db, input);
    if (plan.same) return { fact: plan.same, invalidated: [], unchanged: true };
    const refused = plan.steps.find((p) => p.action === "refuse");
    if (refused) throw new FactOverlapError(refused.f);

    const invalidated: Fact[] = [];
    for (const { f, action } of plan.steps) {
      if (action === "close") {
        db.prepare("UPDATE facts SET valid_to = ? WHERE id = ?").run(plan.validFrom, f.id);
        invalidated.push({ ...f, validTo: plan.validFrom });
      } else if (action === "retract") {
        db.prepare("UPDATE facts SET retracted_at = ? WHERE id = ?").run(plan.now, f.id);
        invalidated.push({ ...f, retractedAt: plan.now });
      }
    }
    const info = db
      .prepare(
        `INSERT INTO facts (subject, predicate, object, valid_from, valid_to, source_run_id, source_path, created_at,
           subject_key, predicate_key, retracted_at, source_line, author, trust, proposal_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        plan.subject,
        plan.predicate,
        plan.object,
        plan.validFrom,
        plan.validTo,
        plan.sourceRunId,
        plan.sourcePath,
        plan.now,
        plan.subjectKey,
        plan.predicateKey,
        plan.sourceLine,
        plan.author,
        input.trust ?? trustOf(plan.author),
        plan.proposalId,
      );
    return { fact: getFact(db, Number(info.lastInsertRowid))!, invalidated, unchanged: false };
  });
  return tx();
}

/** Why a fact is retracted: it stopped being true (`ended`, the default), or it never was (`wrong`). */
export type RetractReason = "ended" | "wrong";

/**
 * Retract a fact. `ended` (or nothing) closes it at this instant, never before its own start, and leaves a closed fact
 * as it is; `wrong` records that it was never true (`retractedAt`) and leaves its interval as it was.
 */
export function retractFact(db: Db, id: number, at = Date.now(), reason: RetractReason = "ended"): Fact | null {
  const fact = getFact(db, id);
  if (!fact) return null;
  if (reason === "wrong") {
    if (fact.retractedAt !== null) return fact;
    db.prepare("UPDATE facts SET retracted_at = ? WHERE id = ?").run(at, id);
    return { ...fact, retractedAt: at };
  }
  if (fact.validTo !== null) return fact;
  const closeAt = Math.max(at, fact.validFrom);
  db.prepare("UPDATE facts SET valid_to = ? WHERE id = ?").run(closeAt, id);
  return { ...fact, validTo: closeAt };
}

export function queryFacts(db: Db, q: FactQuery = {}): Fact[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const subject = q.subject !== undefined ? factKey(q.subject) : "";
  if (subject) {
    clauses.push("f.subject_key = ?");
    params.push(subject);
  }
  const predicate = q.predicate !== undefined ? factKey(q.predicate) : "";
  if (predicate) {
    clauses.push("f.predicate_key = ?");
    params.push(predicate);
  }
  if (q.asOf !== undefined) {
    clauses.push("f.valid_from <= ? AND (f.valid_to IS NULL OR f.valid_to > ?)");
    params.push(q.asOf, q.asOf);
  }
  if (q.knownAt !== undefined) {
    clauses.push("f.created_at <= ?");
    params.push(q.knownAt);
    if (!q.includeRetracted) {
      clauses.push("(f.retracted_at IS NULL OR f.retracted_at > ?)");
      params.push(q.knownAt);
    }
  } else if (!q.includeRetracted) {
    clauses.push("f.retracted_at IS NULL");
  }
  if (q.asOf === undefined && q.knownAt === undefined && !q.includeExpired) clauses.push("f.valid_to IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 2000);
  const order = "ORDER BY f.valid_from DESC, f.id DESC";
  if (!q.allow) {
    const rows = db.prepare(`${SELECT} ${where} ${order} LIMIT ?`).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map(fromRow);
  }
  const allow = q.allow;
  const kept: Fact[] = [];
  for (const row of db.prepare(`${SELECT} ${where} ${order}`).iterate(...params) as Iterable<Record<string, unknown>>) {
    const fact = fromRow(row);
    let shown = false;
    try {
      shown = allow(fact);
    } catch {
      shown = false; // a verdict that cannot be computed fails closed (L-061)
    }
    if (!shown) continue;
    kept.push(fact);
    if (kept.length >= limit) break;
  }
  return kept;
}

export function factStats(db: Db): { open: number; expired: number; subjects: number } {
  const open = (db.prepare("SELECT COUNT(*) c FROM facts WHERE valid_to IS NULL").get() as { c: number }).c;
  const expired = (db.prepare("SELECT COUNT(*) c FROM facts WHERE valid_to IS NOT NULL").get() as { c: number }).c;
  const subjects = (db.prepare("SELECT COUNT(DISTINCT subject) c FROM facts").get() as { c: number }).c;
  return { open, expired, subjects };
}

/**
 * Today's policy on a fact's source (AC 20): a fact with no `sourcePath` is shown; one whose source is relative, lies
 * under no enabled indexed folder nor `memory/` (no root to judge it against), or that the workspace filter refuses
 * (the owner's excludes, the hard blocklist, a secret name, the home's private folders) is not.
 */
export function factSourcePolicy(env: {
  settings: Settings;
  paths: { home: string; memory: string };
}): (fact: Pick<Fact, "sourcePath">) => boolean {
  const filter = makeWorkspaceFilter(env.settings.excludes, { homeDir: env.paths.home });
  const roots = [
    path.resolve(env.paths.memory),
    ...env.settings.indexedFolders.filter((f) => f.enabled).map((f) => path.resolve(f.path)),
  ];
  return (fact) => {
    const source = fact.sourcePath;
    if (source === null) return true;
    if (!path.isAbsolute(source)) return false;
    const full = path.resolve(source);
    const root = roots
      .filter((r) => full === r || full.startsWith(r + path.sep))
      .sort((a, b) => b.length - a.length)[0];
    if (root === undefined) return false;
    const rel = path.relative(root, full);
    return !filter.isExcluded(rel, path.join(realpathLenient(root), rel));
  };
}

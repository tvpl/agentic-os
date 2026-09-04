import type { Db } from "../db/db.js";

/**
 * Bi-temporal facts with provenance (Graphiti pattern, minimal form).
 * A fact is `subject predicate object`, valid from `validFrom` until
 * `validTo` (null = still valid). Asserting a fact that contradicts an open
 * fact with the same subject+predicate closes the old one (`valid_to`)
 * instead of deleting it, so "what did we believe on date X" stays
 * answerable and every fact points at the run / file it came from.
 */

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
}

export interface AssertFactInput {
  subject: string;
  predicate: string;
  object: string;
  /** Defaults to now. */
  validFrom?: number;
  sourceRunId?: string | null;
  sourcePath?: string | null;
}

export interface AssertFactResult {
  fact: Fact;
  /** Facts closed by this assertion (same subject+predicate, different object). */
  invalidated: Fact[];
  /** True when an identical open fact already existed (nothing was written). */
  unchanged: boolean;
}

export interface FactQuery {
  subject?: string;
  predicate?: string;
  /** Point in time: facts valid at that instant. Omit for "currently valid". */
  asOf?: number;
  /** Include closed facts too (history view). */
  includeExpired?: boolean;
  limit?: number;
}

const MAX_TEXT = 2000;

function norm(s: string, what: string): string {
  const v = s.trim().slice(0, MAX_TEXT);
  if (!v) throw new Error(`Fact ${what} must not be empty.`);
  return v;
}

function fromRow(row: Record<string, unknown>): Fact {
  return {
    id: row.id as number,
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    validFrom: row.valid_from as number,
    validTo: (row.valid_to as number | null) ?? null,
    sourceRunId: (row.source_run_id as string | null) ?? null,
    sourcePath: (row.source_path as string | null) ?? null,
    createdAt: row.created_at as number,
  };
}

export function assertFact(db: Db, input: AssertFactInput): AssertFactResult {
  const subject = norm(input.subject, "subject");
  const predicate = norm(input.predicate, "predicate");
  const object = norm(input.object, "object");
  const validFrom = input.validFrom ?? Date.now();
  const now = Date.now();
  const tx = db.transaction((): AssertFactResult => {
    const open = (
      db
        .prepare("SELECT * FROM facts WHERE subject = ? AND predicate = ? AND valid_to IS NULL ORDER BY id")
        .all(subject, predicate) as Array<Record<string, unknown>>
    ).map(fromRow);
    const same = open.find((f) => f.object === object);
    if (same) return { fact: same, invalidated: [], unchanged: true };
    const invalidated: Fact[] = [];
    for (const f of open) {
      // Close at the new fact's start (never before the old fact's own start).
      const closeAt = Math.max(validFrom, f.validFrom);
      db.prepare("UPDATE facts SET valid_to = ? WHERE id = ?").run(closeAt, f.id);
      invalidated.push({ ...f, validTo: closeAt });
    }
    const info = db
      .prepare(
        "INSERT INTO facts (subject, predicate, object, valid_from, valid_to, source_run_id, source_path, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
      )
      .run(subject, predicate, object, validFrom, input.sourceRunId ?? null, input.sourcePath ?? null, now);
    const fact = fromRow(
      db.prepare("SELECT * FROM facts WHERE id = ?").get(Number(info.lastInsertRowid)) as Record<string, unknown>,
    );
    return { fact, invalidated, unchanged: false };
  });
  return tx();
}

/** Explicitly close a fact (e.g. "no longer true", with no replacement). */
export function retractFact(db: Db, id: number, at = Date.now()): Fact | null {
  const row = db.prepare("SELECT * FROM facts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const fact = fromRow(row);
  if (fact.validTo !== null) return fact;
  const closeAt = Math.max(at, fact.validFrom);
  db.prepare("UPDATE facts SET valid_to = ? WHERE id = ?").run(closeAt, id);
  return { ...fact, validTo: closeAt };
}

export function queryFacts(db: Db, q: FactQuery = {}): Fact[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q.subject) {
    clauses.push("subject = ?");
    params.push(q.subject.trim());
  }
  if (q.predicate) {
    clauses.push("predicate = ?");
    params.push(q.predicate.trim());
  }
  if (q.asOf !== undefined) {
    clauses.push("valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)");
    params.push(q.asOf, q.asOf);
  } else if (!q.includeExpired) {
    clauses.push("valid_to IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 2000);
  const rows = db
    .prepare(`SELECT * FROM facts ${where} ORDER BY valid_from DESC, id DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map(fromRow);
}

export function factStats(db: Db): { open: number; expired: number; subjects: number } {
  const open = (db.prepare("SELECT COUNT(*) c FROM facts WHERE valid_to IS NULL").get() as { c: number }).c;
  const expired = (db.prepare("SELECT COUNT(*) c FROM facts WHERE valid_to IS NOT NULL").get() as { c: number }).c;
  const subjects = (db.prepare("SELECT COUNT(DISTINCT subject) c FROM facts").get() as { c: number }).c;
  return { open, expired, subjects };
}

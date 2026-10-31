import crypto from "node:crypto";
import path from "node:path";
import {
  PROPOSAL_KIND_VALUES,
  PROPOSAL_STATUS_VALUES,
  type ProposalOp,
} from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { EditConflictError } from "../errors.js";
import type { MordomoPaths } from "../paths.js";
import { homeReadScope, readWorkspaceFile, type ReadScope } from "../security/safeFs.js";
import { writeWorkspaceFile } from "../security/safeWrite.js";
import { unifiedDiff } from "../sync/diff.js";
import { assertFact, type Fact, type FactTrust } from "./facts.js";
import { recordFileVersion } from "./history.js";
import { localDateString } from "./journal.js";
import { createNote, newNoteText, saveNote, versionOf, type NoteContext } from "./notes.js";

/**
 * The review inbox of what an agent writes to the memory (.specs/features/cerebro-memoria-confiavel, doors 5 to 7).
 *
 * A proposal is what an agent wants written: a consolidation of the journal into `MEMORY.md` (a list of operations),
 * the bytes a run left in `MEMORY.md` (`memory_edit`, the guard's), a fact, a new note, a note's new text. It waits,
 * `pending`, until the owner accepts all of it, part of it, or none; nothing expires on its own. Accepting writes
 * through the guarded writer, records the versions of the history and asserts the facts in one database transaction:
 * a file that cannot be written leaves nothing of the database, and the files written before it are put back.
 *
 * The trust of an operation is the system's, from where its source line is (door 2, AC 56): the owner's own line of a
 * journal or a note is `usuario`, a line of the journal's `## Runs` is `ferramenta`, anything else `inferido`.
 */

export type ProposalKind = (typeof PROPOSAL_KIND_VALUES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUS_VALUES)[number];
/** `run:<id>` (a run's credential, a run's consolidation, the guard) or `mcp` (the MCP tools, through the owner's token). */
export type ProposalAuthor = "mcp" | `run:${string}`;

export const MAX_PENDING_PROPOSALS = 200;
/** The ceiling of `MEMORY.md` (door 7): what Claude Code loads of a memory file. */
export const MEMORY_MAX_LINES = 200;
export const MEMORY_MAX_BYTES = 25_000;
/** The long-term memory file, relative to `memory/`. */
export const MEMORY_FILE = "MEMORY.md";

/** Sections of `MEMORY.md` in the order a missing one is appended (G10). */
const SECTION_ORDER = ["Facts", "Decisions", "Open loops", "Reflections", "Superseded"] as const;
const SUPERSEDED = "Superseded";
const AGENT_MARK = /\(autor::\s*agente\)\s*$/;
const SOURCE_MAX_BYTES = 2 * 1024 * 1024;

export interface ProposalRecord {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  author: string;
  runId: string | null;
  createdAt: number;
  decidedAt: number | null;
  summary: string;
  opCount: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export type ProposalSummary = Pick<
  ProposalRecord,
  "id" | "kind" | "status" | "author" | "runId" | "createdAt" | "summary" | "opCount"
>;

export interface OpView {
  op: ProposalOp["op"];
  section: string | null;
  text: string;
  source: string | null;
  line: number | null;
  trust: FactTrust;
  state: "valid" | "invalid" | "conflict";
  reason?: string;
}

export interface ProposalEnv {
  db: Db;
  paths: Pick<MordomoPaths, "home" | "memory"> & MordomoPaths;
  settings: Settings;
}

// ---- errors -------------------------------------------------------------------------------------------------------

/** `429 too_many_proposals` (door 5): 200 already wait. */
export class TooManyProposalsError extends Error {
  readonly statusCode = 429;
  readonly code = "too_many_proposals";
  constructor() {
    super(`${MAX_PENDING_PROPOSALS} proposals already wait for review; decide some before proposing more.`);
    this.name = "TooManyProposalsError";
  }
}

export class ProposalNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor(id: string) {
    super(`No proposal has the id ${id}.`);
    this.name = "ProposalNotFoundError";
  }
}

export class ProposalDecidedError extends Error {
  readonly statusCode = 409;
  readonly code = "proposal_decided";
  constructor(status: string) {
    super(`The proposal was already decided (${status}).`);
    this.name = "ProposalDecidedError";
  }
}

export class MemoryOverBudgetError extends Error {
  readonly statusCode = 409;
  readonly code = "memory_over_budget";
  constructor(lines: number, bytes: number) {
    super(
      `With these operations MEMORY.md would have ${lines} lines and ${bytes} bytes, past ${MEMORY_MAX_LINES} lines or ${MEMORY_MAX_BYTES} bytes, and would not be smaller than now.`,
    );
    this.name = "MemoryOverBudgetError";
  }
}

export class ProposalValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "ProposalValidationError";
  }
}

// ---- the store (door 5) ---------------------------------------------------------------------------------------------

const KINDS: ReadonlySet<string> = new Set(PROPOSAL_KIND_VALUES);
const STATUSES: ReadonlySet<string> = new Set(PROPOSAL_STATUS_VALUES);

/** Door 5's closed set of authors: `mcp`, or `run:` and a run's id. */
export function isProposalAuthor(author: string): author is ProposalAuthor {
  return author === "mcp" || /^run:[A-Za-z0-9_-]+$/.test(author);
}

function assertClosed(kind: string, status: string, author: string): void {
  if (!KINDS.has(kind)) throw new TypeError(`Unknown proposal kind: ${kind}`);
  if (!STATUSES.has(status)) throw new TypeError(`Unknown proposal status: ${status}`);
  if (!isProposalAuthor(author)) throw new TypeError(`Unknown proposal author: ${author}`);
}

interface Row {
  id: string;
  kind: string;
  status: string;
  author: string;
  run_id: string | null;
  created_at: number;
  decided_at: number | null;
  summary: string;
  payload: string;
  result: string | null;
}

function opCountOf(kind: string, payload: Record<string, unknown>): number {
  if (kind === "consolidation") return Array.isArray(payload.ops) ? payload.ops.length : 0;
  return 1;
}

function fromRow(row: Row): ProposalRecord {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.kind as ProposalKind,
    status: row.status as ProposalStatus,
    author: row.author,
    runId: row.run_id,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    summary: row.summary,
    opCount: opCountOf(row.kind, payload),
    payload,
    result: row.result === null ? null : (JSON.parse(row.result) as Record<string, unknown>),
  };
}

export function summaryOf(record: ProposalRecord): ProposalSummary {
  const { id, kind, status, author, runId, createdAt, summary, opCount } = record;
  return { id, kind, status, author, runId, createdAt, summary, opCount };
}

export function pendingCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) c FROM memory_proposals WHERE status = 'pending'").get() as { c: number }).c;
}

/**
 * Store a pending proposal. `capped` (the request routes) refuses it with `429 too_many_proposals` when 200 already
 * wait; the consolidation hook and the guard have no caller to answer and always store (G8). A new `consolidation`
 * makes every older pending one `superseded` (door 5).
 */
export function storeProposal(
  db: Db,
  input: {
    kind: ProposalKind;
    author: string;
    runId?: string | null;
    summary: string;
    payload: Record<string, unknown>;
  },
  opts: { capped: boolean; now?: number } = { capped: true },
): ProposalRecord {
  assertClosed(input.kind, "pending", input.author);
  const now = opts.now ?? Date.now();
  const id = `mp_${crypto.randomBytes(8).toString("hex")}`;
  db.transaction(() => {
    if (opts.capped && pendingCount(db) >= MAX_PENDING_PROPOSALS) throw new TooManyProposalsError();
    if (input.kind === "consolidation") {
      db.prepare(
        "UPDATE memory_proposals SET status = 'superseded', decided_at = ? WHERE kind = 'consolidation' AND status = 'pending'",
      ).run(now);
    }
    db.prepare(
      `INSERT INTO memory_proposals (id, kind, status, author, run_id, created_at, decided_at, summary, payload, result)
       VALUES (?, ?, 'pending', ?, ?, ?, NULL, ?, ?, NULL)`,
    ).run(id, input.kind, input.author, input.runId ?? null, now, input.summary.slice(0, 2000), JSON.stringify(input.payload));
  })();
  return getProposal(db, id)!;
}

/** Write a proposal's decision; a status outside door 5's closed set (or `pending`) is refused. */
export function writeDecision(db: Db, id: string, status: ProposalStatus, at: number, result: Record<string, unknown>): void {
  if (!STATUSES.has(status) || status === "pending") throw new TypeError(`Not a decision: ${status}`);
  db.prepare("UPDATE memory_proposals SET status = ?, decided_at = ?, result = ? WHERE id = ? AND status = 'pending'").run(
    status,
    at,
    JSON.stringify(result),
    id,
  );
}

export function getProposal(db: Db, id: string): ProposalRecord | null {
  const row = db.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** The proposals newest first: `pending`, or `decided` (every other status), or all. */
export function listProposals(
  db: Db,
  q: { status?: "pending" | "decided" | undefined; limit?: number | undefined } = {},
): { items: ProposalSummary[]; total: number } {
  const where = q.status === "pending" ? "WHERE status = 'pending'" : q.status === "decided" ? "WHERE status != 'pending'" : "";
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const rows = db
    .prepare(`SELECT * FROM memory_proposals ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as Row[];
  const total = (db.prepare(`SELECT COUNT(*) c FROM memory_proposals ${where}`).get() as { c: number }).c;
  return { items: rows.map((r) => summaryOf(fromRow(r))), total };
}

// ---- the trust of an op and its source (AC 55, 56) ----------------------------------------------------------------

/**
 * The trust of an op from its source line (AC 56), never from what the agent wrote: a line of `MEMORY.md` itself, no
 * line, or a line that ends `(autor:: agente)` is `inferido`; a line under the journal's `## Runs` is `ferramenta`; any
 * other line of the journal or of a note is `usuario`.
 */
export function opTrust(src: {
  path: string;
  line?: number | null | undefined;
  text?: string | null | undefined;
  section?: string | null | undefined;
}): FactTrust {
  if (!src.line || src.text === null || src.text === undefined) return "inferido";
  if (src.path === MEMORY_FILE) return "inferido";
  if (AGENT_MARK.test(src.text)) return "inferido";
  const journal = src.path.split("/")[0] === "journal";
  if (journal && src.section === "Runs") return "ferramenta";
  return "usuario";
}

/** `<path>[#<section>]` → the path relative to memory/ and the fragment. */
export function splitSource(source: string): { rel: string; fragment: string | null } {
  const hash = source.indexOf("#");
  return hash === -1 ? { rel: source, fragment: null } : { rel: source.slice(0, hash), fragment: source.slice(hash + 1) };
}

/** The lines of a text, a final newline ending the last one rather than opening another. */
export function linesOf(text: string): string[] {
  if (text === "") return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

/** The `## ` heading a line sits under, or null. */
function sectionAt(lines: readonly string[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const h = /^##\s+(.+?)\s*$/.exec(lines[i]!);
    if (h && i !== index) return h[1]!;
  }
  return null;
}

const memoryScope = (env: Pick<ProposalEnv, "paths" | "settings">): ReadScope =>
  homeReadScope(env.paths.home, [env.paths.memory], env.settings.excludes);

type SourceVerdict =
  | { ok: true; rel: string; text: string | null; section: string | null }
  | { ok: false; reason: string };

/**
 * Whether an op's source can be cited (AC 55): a file under memory/ that today's policy lets be read, and a line within
 * it. A source that leaves memory/, or whose verdict cannot be computed, is refused (L-061).
 */
function checkSource(
  env: Pick<ProposalEnv, "paths" | "settings">,
  source: string,
  line: number | undefined,
  cache: Map<string, string | Error>,
): SourceVerdict {
  const { rel } = splitSource(source);
  const normal = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (normal === ".." || normal.startsWith("../") || normal.startsWith("/") || normal === ".") {
    return { ok: false, reason: "The source is not a file under memory/." };
  }
  let text = cache.get(normal);
  if (text === undefined) {
    try {
      text = readWorkspaceFile(memoryScope(env), path.join(env.paths.memory, ...normal.split("/")), {
        maxBytes: SOURCE_MAX_BYTES,
        strict: true,
      }).bytes.toString("utf8");
    } catch (err) {
      text = err instanceof Error ? err : new Error(String(err));
    }
    cache.set(normal, text);
  }
  if (text instanceof Error) {
    if ((text as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, reason: "The source file does not exist under memory/." };
    }
    return { ok: false, reason: "Today's policy does not let the source be read." };
  }
  if (line === undefined) return { ok: true, rel: normal, text: null, section: null };
  const lines = linesOf(text);
  if (line > lines.length) {
    return { ok: false, reason: `The source has ${lines.length} lines; line ${line} is past its end.` };
  }
  return { ok: true, rel: normal, text: lines[line - 1]!, section: sectionAt(lines, line - 1) };
}

/** Each op as the owner reviews it, against the `MEMORY.md` read now (null: there is none). */
export function evaluateOps(
  env: Pick<ProposalEnv, "paths" | "settings">,
  ops: readonly ProposalOp[],
  memory: string | null,
): OpView[] {
  const cache = new Map<string, string | Error>();
  const lines = memory === null ? [] : linesOf(memory);
  const has = (line: string) => lines.includes(line);
  const sectionOf = (line: string) => {
    const i = lines.indexOf(line);
    return i === -1 ? null : sectionAt(lines, i);
  };
  return ops.map((op): OpView => {
    if (op.op === "move_to_topic") {
      const missing = op.lines.find((l) => !has(l));
      return {
        op: op.op,
        section: `Topic ${op.topic}`,
        text: op.lines.join("\n"),
        source: null,
        line: null,
        trust: "inferido",
        ...(missing !== undefined
          ? { state: "conflict" as const, reason: "A line to move is not in MEMORY.md as written." }
          : { state: "valid" as const }),
      };
    }
    const verdict = checkSource(env, op.source, op.line, cache);
    const base = {
      op: op.op,
      source: op.source,
      line: op.line ?? null,
      trust: verdict.ok ? opTrust({ path: verdict.rel, line: op.line, text: verdict.text, section: verdict.section }) : ("inferido" as const),
    };
    const view = (section: string | null, text: string): OpView => ({ ...base, section, text, state: "valid" });
    let out: OpView;
    if (op.op === "add") out = view(op.section, op.text);
    else if (op.op === "supersede") out = view(sectionOf(op.old), op.text);
    else if (op.op === "close_loop") out = view(sectionOf(op.old), op.old);
    else out = view("Fact", `${op.subject} · ${op.predicate} · ${op.object}`);
    if (!verdict.ok) return { ...out, state: "invalid", reason: verdict.reason };
    if ((op.op === "supersede" || op.op === "close_loop") && !has(op.old)) {
      return { ...out, state: "conflict", reason: "The line is not in MEMORY.md as written." };
    }
    return out;
  });
}

// ---- the op applier and the ceiling (door 7) ----------------------------------------------------------------------

/** A line an agent adds to MEMORY.md (door 7). */
export function memoryLine(text: string, source: string, line: number | undefined, day: string): string {
  return `- ${text} (fonte:: ${source}${line !== undefined ? `:${line}` : ""}) (autor:: agente) (em:: ${day})`;
}

/** The title of a topic from its slug: `clientes` → `Clientes`, `vendas-2026` → `Vendas 2026`. */
export function topicTitle(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const HEADING = /^##\s+(.+?)\s*$/;

function headingIndex(lines: readonly string[], name: string): number {
  return lines.findIndex((l) => HEADING.exec(l)?.[1] === name);
}

function appendToSection(lines: string[], name: string, line: string): void {
  const h = headingIndex(lines, name);
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let last = h;
  for (let i = h + 1; i < end; i++) if (lines[i]!.trim() !== "") last = i;
  let at: number;
  let block: string[];
  if (last === h) {
    if (lines[h + 1] === "") {
      at = h + 2;
      block = [line];
    } else {
      at = h + 1;
      block = ["", line];
    }
  } else {
    at = last + 1;
    block = [line];
  }
  lines.splice(at, 0, ...block);
  const after = at + block.length;
  if (after < lines.length && HEADING.test(lines[after]!)) lines.splice(after, 0, "");
}

export interface Applied {
  /** The new text of MEMORY.md. */
  memory: string;
  /** The lines each topic receives, in order. */
  topics: Map<string, string[]>;
  /** The fact ops applied, by index. */
  facts: number[];
  /** Indexes of ops whose named line was gone by the time they were applied (an earlier op took it). */
  skipped: number[];
}

/**
 * Apply ops to the text of MEMORY.md (null: there is none) on the local day `day` (door 7). A section an op needs that
 * the file lacks is appended at the end in the order Facts, Decisions, Open loops, Reflections, Superseded (G10).
 */
export function applyOps(memory: string | null, ops: ReadonlyArray<{ index: number; op: ProposalOp }>, day: string): Applied {
  const lines = memory === null ? [] : linesOf(memory);
  const topics = new Map<string, string[]>();
  const facts: number[] = [];
  const skipped: number[] = [];
  // the sections the ops will write to
  const needed = new Set<string>();
  for (const { op } of ops) {
    if (op.op === "add") needed.add(op.section);
    if (op.op === "supersede") {
      needed.add(SUPERSEDED);
      const i = lines.indexOf(op.old);
      const s = i === -1 ? null : sectionAt(lines, i);
      if (s) needed.add(s);
    }
  }
  for (const name of SECTION_ORDER) {
    if (!needed.has(name) || headingIndex(lines, name) !== -1) continue;
    if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") lines.push("");
    lines.push(`## ${name}`);
  }
  for (const { index, op } of ops) {
    if (op.op === "fact") {
      facts.push(index);
      continue;
    }
    if (op.op === "add") {
      appendToSection(lines, op.section, memoryLine(op.text, op.source, op.line, day));
      continue;
    }
    if (op.op === "move_to_topic") {
      const at = op.lines.map((l) => lines.indexOf(l));
      if (at.some((i) => i === -1)) {
        skipped.push(index);
        continue;
      }
      const first = Math.min(...at);
      const pointer = `- ${topicTitle(op.topic)} → [[topics/${op.topic}]] (autor:: agente) (em:: ${day})`;
      for (const i of [...at].sort((a, b) => b - a)) lines.splice(i, 1);
      lines.splice(first, 0, pointer);
      topics.set(op.topic, [...(topics.get(op.topic) ?? []), ...op.lines]);
      continue;
    }
    const i = lines.indexOf(op.old);
    if (i === -1) {
      skipped.push(index);
      continue;
    }
    if (op.op === "close_loop") {
      lines[i] = `${op.old} → closed ${op.on}`;
      continue;
    }
    // supersede: the old line to the end of ## Superseded, the new one to the old line's section
    const section = sectionAt(lines, i);
    lines.splice(i, 1);
    const added = memoryLine(op.text, op.source, op.line, day);
    if (section) appendToSection(lines, section, added);
    else lines.splice(i, 0, added);
    appendToSection(lines, SUPERSEDED, `${op.old} (valid_to:: ${day})`);
  }
  return { memory: lines.length === 0 ? "" : `${lines.join("\n")}\n`, topics, facts, skipped };
}

/** Lines and bytes of a text as the ceiling counts them (the whole file, the titles included). */
export function memorySize(text: string): { lines: number; bytes: number } {
  return { lines: linesOf(text).length, bytes: Buffer.byteLength(text, "utf8") };
}

/**
 * The ceiling of door 7: at most 200 lines and 25 000 bytes; a result above it only when it is smaller than the file
 * is now (no more lines nor bytes, and fewer of one).
 */
export function withinBudget(current: string | null, result: string): boolean {
  const r = memorySize(result);
  if (r.lines <= MEMORY_MAX_LINES && r.bytes <= MEMORY_MAX_BYTES) return true;
  if (current === null) return false;
  const c = memorySize(current);
  return r.lines <= c.lines && r.bytes <= c.bytes && (r.lines < c.lines || r.bytes < c.bytes);
}

// ---- reading a proposal (door 10) ---------------------------------------------------------------------------------

function readMemoryFile(env: Pick<ProposalEnv, "paths" | "settings">, rel: string): Buffer | null {
  try {
    return readWorkspaceFile(memoryScope(env), path.join(env.paths.memory, ...rel.split("/")), {
      maxBytes: SOURCE_MAX_BYTES,
      strict: true,
    }).bytes;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function readNoteText(env: Pick<ProposalEnv, "paths" | "settings">, file: string): string | null {
  try {
    return readWorkspaceFile(memoryScope(env), file, { maxBytes: SOURCE_MAX_BYTES, strict: true }).bytes.toString("utf8");
  } catch {
    return null;
  }
}

const opsOf = (record: ProposalRecord): ProposalOp[] => (record.payload.ops ?? []) as ProposalOp[];

/** The single op a `fact` proposal is, for review. */
function factOpView(env: Pick<ProposalEnv, "paths" | "settings">, payload: Record<string, unknown>): OpView {
  const sourcePath = typeof payload.sourcePath === "string" ? payload.sourcePath : null;
  const line = typeof payload.sourceLine === "number" ? payload.sourceLine : null;
  let trust: FactTrust = "inferido";
  if (sourcePath !== null && line !== null && path.isAbsolute(sourcePath)) {
    const rel = path.relative(path.resolve(env.paths.memory), path.resolve(sourcePath));
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      const verdict = checkSource(env, rel.split(path.sep).join("/"), line, new Map());
      if (verdict.ok) trust = opTrust({ path: verdict.rel, line, text: verdict.text, section: verdict.section });
    }
  }
  return {
    op: "fact",
    section: "Fact",
    text: `${String(payload.subject)} · ${String(payload.predicate)} · ${String(payload.object)}`,
    source: sourcePath,
    line,
    trust,
    state: "valid",
  };
}

/** A proposal with its ops reviewed, the diff accepting it writes, and the version of the file it starts from. */
export function readProposal(env: ProposalEnv, id: string, now: Date = new Date(Date.now())) {
  const record = getProposal(env.db, id);
  if (!record) throw new ProposalNotFoundError(id);
  const p = record.payload;
  if (record.kind === "consolidation" || record.kind === "memory_edit") {
    const current = readMemoryFile(env, MEMORY_FILE);
    const currentText = current === null ? null : current.toString("utf8");
    const baseVersion = current === null ? null : versionOf(current);
    if (record.kind === "memory_edit") {
      return { ...record, ops: [], diff: unifiedDiff(currentText ?? "", String(p.content ?? "")), baseVersion };
    }
    const ops = opsOf(record);
    const views = evaluateOps(env, ops, currentText);
    const valid = views.flatMap((v, index) => (v.state === "valid" ? [{ index, op: ops[index]! }] : []));
    const applied = applyOps(currentText, valid, localDateString(now));
    const result = valid.some(({ op }) => op.op !== "fact") ? applied.memory : (currentText ?? "");
    return { ...record, ops: views, diff: unifiedDiff(currentText ?? "", result), baseVersion };
  }
  if (record.kind === "note_save") {
    const before = readNoteText(env, String(p.path));
    return {
      ...record,
      ops: [],
      diff: unifiedDiff(before ?? "", String(p.content ?? "")),
      baseVersion: typeof p.baseVersion === "string" ? p.baseVersion : null,
    };
  }
  if (record.kind === "note_create") {
    const title = String(p.title ?? "").trim();
    const text = newNoteText(p as { title: string; content?: string; frontMatter?: boolean; tags?: string[] }, title, now);
    return { ...record, ops: [], diff: unifiedDiff("", text), baseVersion: null };
  }
  return { ...record, ops: [factOpView(env, p)], diff: "", baseVersion: null };
}

// ---- deciding (door 10, AC 63 to 70) ------------------------------------------------------------------------------

export interface DecideInput {
  action: "accept" | "reject";
  ops?: number[] | undefined;
  baseVersion?: string | undefined;
}

export interface Decided {
  proposal: ProposalRecord;
  written: Array<{ path: string; version: string }>;
  facts: Fact[];
}

const sha = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");

/** A planned write of a file of memory/: its bytes before (null: it does not exist) and after. */
interface PlannedWrite {
  rel: string;
  file: string;
  before: Buffer | null;
  after: string;
}

/**
 * Write the planned files, the replaced ones first (each guarded by the bytes it was read with), then the new ones. A
 * write that fails puts back the files written before it (G6) and throws: an edit conflict as it is, anything else as
 * a plain error (`500 internal`).
 */
function writeAll(env: ProposalEnv, writes: readonly PlannedWrite[]): void {
  const scope = memoryScope(env);
  const ordered = [...writes.filter((w) => w.before !== null), ...writes.filter((w) => w.before === null)];
  const done: PlannedWrite[] = [];
  try {
    for (const w of ordered) {
      if (w.before !== null) {
        writeWorkspaceFile(scope, w.file, w.after, { mode: "replace", expectSha256: sha(w.before) });
      } else {
        try {
          writeWorkspaceFile(scope, w.file, w.after, { mode: "create" });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new EditConflictError();
          throw err;
        }
      }
      done.push(w);
    }
  } catch (err) {
    for (const w of done.reverse()) {
      if (w.before === null) continue; // no primitive removes a file of memory/: a file this decision made stays
      try {
        writeWorkspaceFile(scope, w.file, w.before, { mode: "replace", expectSha256: sha(w.after) });
      } catch {
        /* someone else's bytes are there now: leave them */
      }
    }
    if (err instanceof EditConflictError) throw err;
    throw new Error(`A file of the proposal could not be written: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function noteContext(env: ProposalEnv, author: string, proposalId: string): NoteContext {
  return {
    paths: env.paths,
    settings: env.settings,
    history: (file, bytes) => {
      recordFileVersion(env, file, bytes, author as "mcp", "proposal", proposalId);
    },
  };
}

const relOf = (env: ProposalEnv, file: string) =>
  path.relative(path.resolve(env.paths.memory), path.resolve(file)).split(path.sep).join("/");

/**
 * Accept or reject a pending proposal. Accepting a consolidation applies the chosen valid ops (all of them when none
 * are named) to `MEMORY.md` as it is now, which must be the `baseVersion` the owner saw (absent: it did not exist).
 */
export function decideProposal(
  env: ProposalEnv,
  id: string,
  input: DecideInput,
  // `Date.now()`, so a clock that only moves `Date.now` (an index pass needs it to move) gives the day
  now: Date = new Date(Date.now()),
): Decided {
  const record = getProposal(env.db, id);
  if (!record) throw new ProposalNotFoundError(id);
  if (record.status !== "pending") throw new ProposalDecidedError(record.status);
  const at = now.getTime();
  if (input.action === "reject") {
    writeDecision(env.db, id, "rejected", at, { action: "reject" });
    return { proposal: getProposal(env.db, id)!, written: [], facts: [] };
  }
  const p = record.payload;
  const author = record.author;
  if (record.kind === "fact") {
    const view = factOpView(env, p);
    const facts = env.db.transaction(() => {
      const asserted = assertFact(env.db, {
        subject: String(p.subject),
        predicate: String(p.predicate),
        object: String(p.object),
        ...(typeof p.validFrom === "number" ? { validFrom: p.validFrom } : {}),
        ...(typeof p.validTo === "number" ? { validTo: p.validTo } : {}),
        sourcePath: typeof p.sourcePath === "string" ? p.sourcePath : null,
        sourceLine: typeof p.sourceLine === "number" ? p.sourceLine : null,
        sourceRunId: typeof p.sourceRunId === "string" ? p.sourceRunId : record.runId,
        author: author as "mcp",
        trust: view.trust,
        proposalId: id,
      });
      writeDecision(env.db, id, "accepted", at, { action: "accept", facts: [asserted.fact.id] });
      return [asserted.fact];
    })();
    return { proposal: getProposal(env.db, id)!, written: [], facts };
  }
  if (record.kind === "note_create" || record.kind === "note_save") {
    return env.db.transaction((): Decided => {
      const ctx = noteContext(env, author, id);
      const note =
        record.kind === "note_create"
          ? createNote(ctx, p as { title: string }, now)
          : saveNote(ctx, { path: String(p.path), content: String(p.content), baseVersion: String(p.baseVersion) });
      const written = [{ path: relOf(env, note.path), version: note.version }];
      writeDecision(env.db, id, "accepted", at, { action: "accept", written });
      return { proposal: getProposal(env.db, id)!, written, facts: [] };
    })();
  }

  // consolidation and memory_edit: MEMORY.md as the owner saw it
  const current = readMemoryFile(env, MEMORY_FILE);
  const currentText = current === null ? null : current.toString("utf8");
  const sameBase = current === null ? input.baseVersion === undefined : input.baseVersion === versionOf(current);
  const memoryFile = path.join(env.paths.memory, MEMORY_FILE);

  if (record.kind === "memory_edit") {
    if (!sameBase) throw new EditConflictError();
    const after = String(p.content ?? "");
    return env.db.transaction((): Decided => {
      writeAll(env, [{ rel: MEMORY_FILE, file: memoryFile, before: current, after }]);
      recordFileVersion(env, memoryFile, after, author as "mcp", "proposal", id);
      const written = [{ path: MEMORY_FILE, version: versionOf(after) }];
      writeDecision(env.db, id, "accepted", at, { action: "accept", written });
      return { proposal: getProposal(env.db, id)!, written, facts: [] };
    })();
  }

  const ops = opsOf(record);
  const views = evaluateOps(env, ops, currentText);
  const validIndexes = views.flatMap((v, i) => (v.state === "valid" ? [i] : []));
  const chosen = input.ops === undefined ? validIndexes : [...new Set(input.ops)].sort((a, b) => a - b);
  for (const i of chosen) {
    if (i >= ops.length) throw new ProposalValidationError(`ops: the proposal has ${ops.length} operations; ${i} is not one`);
    if (views[i]!.state !== "valid") {
      throw new ProposalValidationError(`ops: operation ${i} is ${views[i]!.state} and cannot be applied`);
    }
  }
  if (chosen.length === 0) throw new ProposalValidationError("ops: the proposal has no valid operation to apply");
  if (!sameBase) throw new EditConflictError();
  const day = localDateString(now);
  const applied = applyOps(
    currentText,
    chosen.map((index) => ({ index, op: ops[index]! })),
    day,
  );
  if (applied.skipped.length > 0) {
    throw new ProposalValidationError(`ops: operation ${applied.skipped[0]} names a line an earlier operation took`);
  }
  const memoryChanged = applied.memory !== (currentText ?? "") && chosen.some((i) => ops[i]!.op !== "fact");
  if (memoryChanged && !withinBudget(currentText, applied.memory)) {
    const size = memorySize(applied.memory);
    throw new MemoryOverBudgetError(size.lines, size.bytes);
  }
  const writes: PlannedWrite[] = [];
  if (memoryChanged) writes.push({ rel: MEMORY_FILE, file: memoryFile, before: current, after: applied.memory });
  for (const [slug, lines] of applied.topics) {
    const rel = `topics/${slug}.md`;
    const file = path.join(env.paths.memory, "topics", `${slug}.md`);
    const before = readMemoryFile(env, rel);
    const head = before === null ? "---\ntype: memoria-topico\n---\n\n" : before.toString("utf8");
    const glue = head === "" || head.endsWith("\n") ? "" : "\n";
    writes.push({ rel, file, before, after: `${head}${glue}${lines.join("\n")}\n` });
  }
  const status: ProposalStatus = chosen.length === validIndexes.length ? "accepted" : "partial";
  return env.db.transaction((): Decided => {
    const facts: Fact[] = [];
    for (const index of applied.facts) {
      const op = ops[index] as Extract<ProposalOp, { op: "fact" }>;
      const { rel } = splitSource(op.source);
      facts.push(
        assertFact(env.db, {
          subject: op.subject,
          predicate: op.predicate,
          object: op.object,
          ...(op.validFrom !== undefined ? { validFrom: op.validFrom } : {}),
          ...(op.validTo !== undefined ? { validTo: op.validTo } : {}),
          sourcePath: path.join(env.paths.memory, ...path.posix.normalize(rel).split("/")),
          sourceLine: op.line ?? null,
          sourceRunId: record.runId,
          author: author as "mcp",
          trust: views[index]!.trust,
          proposalId: id,
        }).fact,
      );
    }
    writeAll(env, writes);
    const written = writes.map((w) => {
      recordFileVersion(env, w.file, w.after, author as "mcp", "proposal", id);
      return { path: w.rel, version: versionOf(w.after) };
    });
    writeDecision(env.db, id, status, at, { action: "accept", ops: chosen, written, facts: facts.map((f) => f.id) });
    return { proposal: getProposal(env.db, id)!, written, facts };
  })();
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import { EditConflictError, PathAccessError } from "../errors.js";
import { RestoreLock } from "../restoreLock.js";
import { isInside, realpathLenient } from "../security/paths.js";
import { NotRegularFileError, homeReadScope, listWorkspaceDir, readWorkspaceText, type ReadScope } from "../security/safeFs.js";
import { moveWorkspaceFile, writeWorkspaceFile } from "../security/safeWrite.js";
import {
  CleanupScanRunningError,
  type CleanupDecision,
  type CleanupFinding,
  type CleanupFindingFile,
  type CleanupScanRecord,
} from "./cleanupScan.js";

/**
 * The guided cleanup, after the scan (.specs/features/cerebro-faxina-guiada, S3 and S4): the owner's decisions on the
 * findings of a scan (door 3), the apply that moves what was marked to `memory/archive/AAAA-MM-DD-<id>/` with a
 * manifest (doors 1 and 4) and lists what lies outside `memory/` as proposals, and the undo that moves back what is
 * still as it was left. Nothing here deletes a user file: files only move, by `moveWorkspaceFile`.
 */

const DECISIONS: readonly CleanupDecision[] = ["keep", "archive", "merge", "snooze", "unsure"];
const MERGEABLE = new Set(["duplicate", "near-duplicate"]);

/** `404 not_found`: no scan, or no manifest, is called that. */
export class CleanupNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor(message: string) {
    super(message);
    this.name = "CleanupNotFoundError";
  }
}

/** `409 scan_stale`: a newer scan of the same scope replaced this one. */
export class CleanupScanStaleError extends Error {
  readonly statusCode = 409;
  readonly code = "scan_stale";
  constructor(scanId: string, newer: string) {
    super(`The scan ${scanId} was replaced by a newer scan of the same scope: ${newer}`);
    this.name = "CleanupScanStaleError";
  }
}

/** `400 validation`: a decision that cannot be stored, or a path that is no manifest of an archive. */
export class CleanupValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "CleanupValidationError";
  }
}

/** `409 undo_conflict`: the manifest is not one this version can undo. */
export class CleanupUndoConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "undo_conflict";
  constructor(message: string) {
    super(message);
    this.name = "CleanupUndoConflictError";
  }
}

/** What the routes need of the scans of a service (`CleanupScanner`). */
export interface CleanupScans {
  get(scanId: string): CleanupScanRecord | undefined;
  latest(scopeKey: string): CleanupScanRecord | undefined;
}

/**
 * The scan a decision or an apply names (amendment 12): `404` when there is none, `409 scan_stale` when a newer scan
 * of its scope replaced it, and for an apply `409 scan_running` while it runs.
 */
export function cleanupScanFor(scans: CleanupScans, scanId: string, use: "decide" | "apply"): CleanupScanRecord {
  const scan = scans.get(scanId);
  if (!scan) throw new CleanupNotFoundError(`No cleanup scan is called ${scanId}.`);
  if (use === "apply" && scan.status === "running") throw new CleanupScanRunningError(scan.scanId);
  const newest = scans.latest(scan.scopeKey);
  if (newest && newest.scanId !== scan.scanId) throw new CleanupScanStaleError(scan.scanId, newest.scanId);
  return scan;
}

// ---- decisions (S3) -------------------------------------------------------------------------------------------------

export interface CleanupDecisionInput {
  key: string;
  decision: string;
  keepFileId?: number | undefined;
  until?: number | undefined;
}

/**
 * Why an entry cannot be stored (AC 19, AC 21, AC 25, amendment 16), or null: a key the scan did not report, a
 * decision outside the five, a `merge` without a member to keep or on a kind that is not a duplicate, a `snooze`
 * without an `until` later than now.
 */
export function cleanupDecisionRefusal(
  findings: readonly CleanupFinding[],
  entry: CleanupDecisionInput,
  now: number,
): string | null {
  const finding = findings.find((f) => f.key === entry.key);
  if (!finding) return `The scan reported no finding with the key ${entry.key}.`;
  if (!DECISIONS.includes(entry.decision as CleanupDecision)) return `Not a decision: ${entry.decision}.`;
  if (entry.decision === "merge") {
    if (!MERGEABLE.has(finding.kind)) return `Only a duplicate or a near-duplicate can be merged, not ${finding.kind}.`;
    if (entry.keepFileId === undefined) return "A merge names the file to keep (keepFileId).";
    if (!finding.files.some((f) => f.id === entry.keepFileId)) return `File ${entry.keepFileId} is not a member of the finding.`;
  }
  if (entry.decision === "snooze") {
    if (entry.until === undefined) return "A snooze says until when (until).";
    if (!(entry.until > now)) return "A snooze ends later than now.";
  }
  return null;
}

/**
 * Store the owner's decisions on findings of a scan (door 3), one row per (scope, key), a later one replacing an earlier
 * one; all or none: one entry that cannot be stored stores nothing of the request (`400 validation`).
 */
export function saveCleanupDecisions(
  db: Db,
  scan: CleanupScanRecord,
  entries: readonly CleanupDecisionInput[],
  options: { now?: number } = {},
): { saved: number } {
  const now = options.now ?? Date.now();
  for (const entry of entries) {
    const refusal = cleanupDecisionRefusal(scan.findings, entry, now);
    if (refusal) throw new CleanupValidationError(refusal);
  }
  const upsert = db.prepare(
    "INSERT INTO cleanup_decisions (scope, key, decision, keep_file_id, until, decided_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET decision = excluded.decision, keep_file_id = excluded.keep_file_id, until = excluded.until, decided_at = excluded.decided_at",
  );
  db.transaction(() => {
    for (const e of entries) {
      upsert.run(
        scan.scopeKey,
        e.key,
        e.decision,
        e.decision === "merge" ? e.keepFileId! : null,
        e.decision === "snooze" ? e.until! : null,
        now,
      );
    }
  })();
  return { saved: entries.length };
}

// ---- apply and undo (S4) --------------------------------------------------------------------------------------------

export type CleanupSkipReason = "changed" | "missing" | "exists" | "forbidden_path";

export interface CleanupMoveDeps {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
  /** The index learns of the moved paths on its own time (AC 31). */
  indexer: { requestIndexPaths(paths: readonly string[]): Promise<void> };
}

export interface CleanupApplyResult {
  /** The manifest of the moves, or null when nothing under `memory/` moved. */
  manifest: string | null;
  moved: Array<{ from: string; to: string }>;
  skipped: Array<{ path: string; reason: CleanupSkipReason }>;
  /** The proposal list for what lies outside `memory/`, or null when there is none. */
  proposals: string | null;
}

export interface CleanupManifest {
  v: 1;
  createdAt: number;
  scope: string;
  entries: Array<{ from: string; to: string; sha256: string; size: number }>;
}

/** Why a move did not happen, as a skip reason; anything else is not a refusal and goes on as an error. */
function skipReason(err: unknown): CleanupSkipReason | null {
  if (err instanceof EditConflictError || err instanceof NotRegularFileError) return "changed";
  if (err instanceof PathAccessError) return "forbidden_path";
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "missing";
  if (code === "EEXIST") return "exists";
  return null;
}

/** The owner's day, `AAAA-MM-DD`. */
function dayOf(now: number): string {
  const d = new Date(now);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Why a finding is in the proposal list, in one phrase. */
function reasonOf(f: CleanupFinding): string {
  const d = f.detail;
  switch (f.kind) {
    case "duplicate":
      return "duplicata";
    case "near-duplicate":
      return `quase igual (${Math.round((d.similarity ?? 0) * 100)}%)`;
    case "stale":
      return d.since === "last_reviewed" ? `revisado em ${d.lastReviewed}` : `parado há ${d.ageDays} dias`;
    case "orphan":
      return "sem links";
    case "broken-link":
      return `link quebrado: ${d.target} (linha ${d.line})`;
    case "empty-folder":
      return "pasta vazia";
    case "large-file":
      return `${d.bytes} bytes`;
    case "untitled":
      return "sem título";
  }
}

/**
 * Apply what was decided on the findings of a finished scan (AC 27 to AC 31): each file under `memory/` marked
 * `archive`, or not kept by a `merge`, moves to `memory/archive/AAAA-MM-DD-<id>/<its path under memory/>` if its bytes
 * are still the ones the scan saw, and the moves are written to `manifest.json` there; a file outside `memory/`, and
 * an empty folder anywhere, is never touched and goes to the proposal list `artifacts/cleanup/AAAA-MM-DD-<id>.md`.
 * Holds the shared restore lock while it works. The index is asked for every origin and destination.
 */
export function applyCleanup(
  deps: CleanupMoveDeps,
  scan: CleanupScanRecord,
  options: { now?: number } = {},
): CleanupApplyResult {
  const now = options.now ?? Date.now();
  const lock = RestoreLock.acquire(deps.paths, 0, "shared");
  try {
    const decided = new Map(
      (
        deps.db.prepare("SELECT key, decision, keep_file_id FROM cleanup_decisions WHERE scope = ?").all(scan.scopeKey) as Array<{
          key: string;
          decision: string;
          keep_file_id: number | null;
        }>
      ).map((d) => [d.key, d]),
    );
    // What the decisions ask for, one line per file (the first finding that asks for it gives the reason).
    const plan = new Map<string, { file: CleanupFindingFile; decision: string; finding: CleanupFinding }>();
    const folders: Array<{ folder: string; decision: string; finding: CleanupFinding }> = [];
    for (const finding of scan.findings) {
      const d = decided.get(finding.key);
      if (!d || (d.decision !== "archive" && d.decision !== "merge")) continue;
      if (finding.kind === "empty-folder") {
        if (d.decision === "archive") folders.push({ folder: finding.detail.folder!, decision: d.decision, finding });
        continue;
      }
      const leaving = d.decision === "merge" ? finding.files.filter((f) => f.id !== d.keep_file_id) : finding.files;
      for (const file of leaving) if (!plan.has(file.path)) plan.set(file.path, { file, decision: d.decision, finding });
    }

    const memory = deps.paths.memory;
    const realMemory = realpathLenient(path.resolve(memory));
    const realArchive = path.join(realMemory, "archive");
    const id = crypto.randomBytes(4).toString("hex");
    const name = `${dayOf(now)}-${id}`;
    const folder = path.join(memory, "archive", name);
    const manifestPath = path.join(folder, "manifest.json");
    const scope = homeReadScope(deps.paths.home, [memory], deps.settings.excludes);
    const result: CleanupApplyResult = { manifest: null, moved: [], skipped: [], proposals: null };
    const entries: CleanupManifest["entries"] = [];
    const proposals: string[] = [];

    try {
      for (const { file, decision, finding } of plan.values()) {
        const real = realpathLenient(path.resolve(file.path));
        if (!isInside(realMemory, real) || isInside(realArchive, real)) {
          proposals.push(`- [ ] ${file.path} — ${decision} — ${reasonOf(finding)}`);
          continue;
        }
        const to = path.join(folder, path.relative(realMemory, real));
        if (to === manifestPath) {
          result.skipped.push({ path: file.path, reason: "exists" });
          continue;
        }
        try {
          const moved = moveWorkspaceFile(scope, file.path, to, { expectSha256: file.sha256 });
          entries.push({ from: file.path, to, sha256: moved.sha256, size: moved.size });
          result.moved.push({ from: file.path, to });
        } catch (err) {
          const reason = skipReason(err);
          if (reason === null) throw err;
          result.skipped.push({ path: file.path, reason });
        }
      }
    } finally {
      // The manifest is written whatever happened after the first move: it is the only way back (door 4).
      if (entries.length > 0) {
        const manifest: CleanupManifest = { v: 1, createdAt: now, scope: scan.scopeKey, entries };
        writeWorkspaceFile(scope, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: "create" });
        result.manifest = manifestPath;
        deps.indexer.requestIndexPaths(entries.flatMap((e) => [e.from, e.to])).catch(() => undefined);
      }
    }

    for (const { folder: dir, decision, finding } of folders) proposals.push(`- [ ] ${dir}${path.sep} — ${decision} — ${reasonOf(finding)}`);
    if (proposals.length > 0) {
      const artifacts = path.join(deps.paths.artifacts, "cleanup");
      const list = path.join(artifacts, `${name}.md`);
      const text = [
        `# Faxina: propostas de ${dayOf(now)}`,
        "",
        `Escopo: ${scan.scopeKey}. Nada aqui foi movido nem apagado: marque o que fizer.`,
        "",
        ...proposals,
        "",
      ].join("\n");
      writeWorkspaceFile(homeReadScope(deps.paths.home, [artifacts]), list, text, { mode: "create" });
      result.proposals = list;
    }
    return result;
  } finally {
    lock.release();
  }
}

export interface CleanupUndoResult {
  restored: Array<{ from: string; to: string }>;
  skipped: Array<{ path: string; reason: CleanupSkipReason }>;
}

/** The folder of an archive whose `manifest.json` the path names (by its spelling under `memory/archive/`), or null. */
function archiveFolderOf(paths: MordomoPaths, manifest: string): string | null {
  const archive = path.join(path.resolve(paths.memory), "archive");
  const parts = path.relative(archive, path.resolve(manifest)).split(path.sep);
  if (parts.length !== 2 || parts[1] !== "manifest.json" || parts[0] === "" || parts[0] === "..") return null;
  return path.join(archive, parts[0]!);
}

/** The manifest as door 4 writes it, every entry inside `memory/` and its `to` inside this archive; else null. */
function manifestEntries(
  data: unknown,
  memory: string,
  folder: string,
): CleanupManifest["entries"] | null {
  if (typeof data !== "object" || data === null || !Array.isArray((data as CleanupManifest).entries)) return null;
  const archive = path.join(memory, "archive");
  const out: CleanupManifest["entries"] = [];
  for (const e of (data as CleanupManifest).entries as unknown[]) {
    const entry = e as Partial<CleanupManifest["entries"][number]>;
    if (typeof entry.from !== "string" || typeof entry.to !== "string" || typeof entry.sha256 !== "string") return null;
    if (!path.isAbsolute(entry.from) || !path.isAbsolute(entry.to)) return null;
    const from = path.resolve(entry.from);
    const to = path.resolve(entry.to);
    if (!isInside(memory, from) || isInside(archive, from) || !isInside(folder, to) || to === folder) return null;
    out.push({ from, to, sha256: entry.sha256, size: Number(entry.size) || 0 });
  }
  return out;
}

/** Take away the folders of an archive the undo left with no entry at all, deepest first (`rmdir` of empty ones only). */
function removeEmptyArchive(scope: ReadScope, folder: string): void {
  const empty = (dir: string): string[] | null => {
    const order: string[] = [];
    for (const entry of listWorkspaceDir(scope, dir)) {
      if (!entry.isDirectory) return null;
      const inner = empty(entry.path);
      if (inner === null) return null;
      order.push(...inner);
    }
    order.push(dir);
    return order;
  };
  const folders = empty(folder);
  if (folders === null) return;
  for (const dir of folders) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return; // something no listing shows is there: the folder stays
    }
  }
}

/**
 * Move back what an apply moved (AC 32, AC 34, door 4): each entry of the manifest whose archived file still has the
 * recorded `sha256` and whose origin does not exist; the others are skipped with the reason. When every entry is back,
 * the manifest goes to `artifacts/cleanup/<archive name>.manifest.json` (it is the record of what was archived and
 * undone) and the archive folder, empty then, is taken away. Holds the shared restore lock while it works.
 */
export function undoCleanup(deps: CleanupMoveDeps, manifest: string): CleanupUndoResult {
  const folder = archiveFolderOf(deps.paths, manifest);
  if (folder === null) throw new CleanupValidationError("Not the manifest.json of an archive folder under memory/archive/.");
  const lock = RestoreLock.acquire(deps.paths, 0, "shared");
  try {
    const memory = path.resolve(deps.paths.memory);
    const artifacts = path.join(deps.paths.artifacts, "cleanup");
    const scope = homeReadScope(deps.paths.home, [memory, artifacts], deps.settings.excludes);
    const manifestPath = path.join(folder, "manifest.json");
    let text: string;
    try {
      text = readWorkspaceText(scope, manifestPath, { maxBytes: 16 * 1024 * 1024, strict: true }).text;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new CleanupNotFoundError(`No manifest at ${manifest}.`);
      throw err;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new CleanupUndoConflictError("The manifest is not JSON.");
    }
    if ((data as { v?: unknown } | null)?.v !== 1) {
      throw new CleanupUndoConflictError(`This version undoes a manifest of v 1, not ${JSON.stringify((data as { v?: unknown } | null)?.v)}.`);
    }
    const entries = manifestEntries(data, memory, folder);
    if (entries === null) throw new CleanupUndoConflictError("The manifest names a path outside its archive or outside memory/.");

    const result: CleanupUndoResult = { restored: [], skipped: [] };
    for (const entry of entries) {
      try {
        moveWorkspaceFile(scope, entry.to, entry.from, { expectSha256: entry.sha256 });
        result.restored.push({ from: entry.from, to: entry.to });
      } catch (err) {
        const reason = skipReason(err);
        if (reason === null) throw err;
        result.skipped.push({ path: entry.from, reason });
      }
    }
    if (result.restored.length > 0) {
      deps.indexer.requestIndexPaths(result.restored.flatMap((e) => [e.to, e.from])).catch(() => undefined);
    }
    if (result.restored.length === entries.length) {
      let aside = false;
      try {
        moveWorkspaceFile(scope, manifestPath, path.join(artifacts, `${path.basename(folder)}.manifest.json`));
        aside = true;
      } catch {
        /* the record cannot go aside: the folder stays, with its manifest */
      }
      if (aside) removeEmptyArchive(scope, folder);
    }
    return result;
  } finally {
    lock.release();
  }
}

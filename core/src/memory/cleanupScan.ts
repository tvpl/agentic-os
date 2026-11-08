import crypto from "node:crypto";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { EventBus } from "../events.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import { RestoreLock } from "../restoreLock.js";
import { isInside, realpathLenient } from "../security/paths.js";
import { listWorkspaceDir, openWorkspaceFile, readScope, type ReadScope } from "../security/safeFs.js";
import {
  ageInDays,
  cleanupRows,
  ignoredByCleanup,
  resolveCleanupScope,
  type CleanupEnv,
  type CleanupRow,
  type CleanupScope,
  type CleanupScopeView,
} from "./cleanup.js";
import { fieldsFromDb } from "./fields.js";
import { storedRowFilter } from "./indexer.js";
import { linkEdges, linksOf } from "./links.js";
import {
  MINHASH_ALGO,
  NEAR_DUPLICATE_SIMILARITY,
  minhashCandidates,
  minhashSignature,
  minhashSimilarity,
} from "./minhash.js";
import type { CleanupPhase } from "@mordomo/contracts";

/**
 * The scan of a cleanup scope (.specs/features/cerebro-faxina-guiada, S2): what in it asks a decision, as findings with
 * a stable key, less what the owner already decided. It reads the index rows, `note_links` through the link resolver,
 * the MinHash signatures it keeps in `file_minhash` (door 2), the folders through `listWorkspaceDir` and the bytes of
 * the files it names through `openWorkspaceFile`; it writes only `file_minhash`. Between blocks of at most
 * `CLEANUP_BLOCK` files it yields the event loop (AC 16).
 */

export const CLEANUP_BLOCK = 200;
const DAY = 86_400_000;

export type CleanupFindingKind =
  | "duplicate"
  | "near-duplicate"
  | "stale"
  | "orphan"
  | "broken-link"
  | "empty-folder"
  | "large-file"
  | "untitled";
export type CleanupDecision = "keep" | "archive" | "merge" | "snooze" | "unsure";

const KIND_ORDER: readonly CleanupFindingKind[] = [
  "duplicate",
  "near-duplicate",
  "stale",
  "orphan",
  "broken-link",
  "empty-folder",
  "large-file",
  "untitled",
];
const SUGGESTED: Readonly<Record<CleanupFindingKind, CleanupDecision>> = {
  duplicate: "merge",
  "near-duplicate": "merge",
  stale: "archive",
  orphan: "keep",
  "broken-link": "keep",
  "empty-folder": "archive",
  "large-file": "keep",
  untitled: "keep",
};

export interface CleanupFindingFile {
  id: number;
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}

export interface CleanupFindingDetail {
  similarity?: number;
  ageDays?: number;
  since?: "mtime" | "last_reviewed";
  lastReviewed?: string;
  target?: string;
  line?: number;
  linkKind?: "markdown-link" | "wikilink";
  folder?: string;
  bytes?: number;
  limit?: number;
}

export interface CleanupFinding {
  key: string;
  kind: CleanupFindingKind;
  files: CleanupFindingFile[];
  detail: CleanupFindingDetail;
  suggested: CleanupDecision;
}

export interface CleanupThresholds {
  staleDays: number;
  largeBytes: number;
}

export interface CleanupScanOptions {
  now?: number;
  /** Called at the start and after each block of each phase. */
  onProgress?: (phase: CleanupPhase, done: number, total: number) => void;
}

export interface CleanupScanResult {
  findings: CleanupFinding[];
  /** How many findings a stored decision hid (AC 13). */
  decided: number;
}

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The key of a finding (door 3): `<kind>:` and the SHA-256 of its members' paths and hashes, sorted, and what it names. */
export function findingKey(
  kind: CleanupFindingKind,
  members: ReadonlyArray<{ path: string; sha256: string }>,
  names: readonly string[] = [],
): string {
  const lines = members.map((m) => `${m.path}\u0000${m.sha256}`).sort();
  const material = [...lines, ...names.map((n) => `\u0001${n}`)].join("\n");
  return `${kind}:${crypto.createHash("sha256").update(material).digest("hex")}`;
}

/** A `YYYY-MM-DD` date as midnight UTC, or null for anything else (amendment 6: a date that is not one does not count). */
export function reviewDate(value: string | undefined): number | null {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const at = Date.UTC(y, m - 1, d);
  const date = new Date(at);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? at : null;
}

/** Whether a file is stale (AC 10): past `staleDays` by its `mtime`, else by its front matter's `last_reviewed`. */
export function staleDetail(row: CleanupRow, staleDays: number, now: number): CleanupFindingDetail | null {
  const age = ageInDays(row.mtime, now);
  if (age > staleDays) return { since: "mtime", ageDays: age };
  const reviewed = fieldsFromDb(row.fields).last_reviewed;
  const at = reviewDate(reviewed);
  if (at === null) return null;
  const since = Math.max(0, Math.floor((now - at) / DAY));
  return since > staleDays ? { since: "last_reviewed", ageDays: since, lastReviewed: reviewed! } : null;
}

const isMarkdown = (row: { ext: string }): boolean => row.ext === ".md" || row.ext === ".markdown";

/**
 * Bring the MinHash signatures of the rows up to date (AC 9): a row whose stored signature has the same `algo`, `mtime`
 * and `size` keeps it, any other is computed again from the text the index holds. Returns every signature by file id.
 */
export async function refreshSignatures(
  db: Db,
  rows: readonly CleanupRow[],
  progress: (done: number, total: number) => void = () => undefined,
): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const stored = db.prepare("SELECT algo, sig, mtime, size FROM file_minhash WHERE file_id = ?");
  const text = db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const upsert = db.prepare(
    "INSERT INTO file_minhash (file_id, algo, sig, mtime, size) VALUES (?, ?, ?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET algo = excluded.algo, sig = excluded.sig, mtime = excluded.mtime, size = excluded.size",
  );
  const drop = db.prepare("DELETE FROM file_minhash WHERE file_id = ?");
  progress(0, rows.length);
  for (let i = 0; i < rows.length; i += CLEANUP_BLOCK) {
    const block = rows.slice(i, i + CLEANUP_BLOCK);
    db.transaction(() => {
      for (const row of block) {
        const have = stored.get(row.id) as { algo: string; sig: Buffer; mtime: number; size: number } | undefined;
        if (have && have.algo === MINHASH_ALGO && have.mtime === row.mtime && have.size === row.size) {
          out.set(row.id, new Uint8Array(have.sig));
          continue;
        }
        const content = (text.get(row.id) as { content: string | null } | undefined)?.content ?? "";
        const sig = minhashSignature(content);
        if (sig === null) {
          if (have) drop.run(row.id);
          continue;
        }
        upsert.run(row.id, MINHASH_ALGO, Buffer.from(sig), row.mtime, row.size);
        out.set(row.id, sig);
      }
    })();
    progress(Math.min(rows.length, i + block.length), rows.length);
    await pause();
  }
  return out;
}

/** The folders under the scope's roots that hold no indexed file at any depth (AC 12): the topmost of each empty tree. */
async function emptyFolders(scope: ReadScope, roots: readonly string[], holding: ReadonlySet<string>, ignored: (p: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let seen = 0;
  const walk = async (dir: string, top: boolean): Promise<void> => {
    let entries;
    try {
      entries = listWorkspaceDir(scope, dir);
    } catch {
      return;
    }
    if (!top && !holding.has(dir) && !ignored(dir)) {
      out.push(dir);
      return;
    }
    for (const entry of entries.filter((e) => e.isDirectory).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (ignored(entry.path)) continue;
      if (++seen % CLEANUP_BLOCK === 0) await pause();
      await walk(entry.path, false);
    }
  };
  for (const root of roots) await walk(realpathLenient(root), true);
  return out;
}

/**
 * Every finding of a scope (AC 8 to AC 14), less the ones a stored decision hides. The thresholds are read from the
 * settings the scan was given.
 */
export async function scanCleanupScope(
  db: Db,
  env: CleanupEnv,
  scope: CleanupScope,
  options: CleanupScanOptions = {},
): Promise<CleanupScanResult> {
  const now = options.now ?? Date.now();
  const progress = options.onProgress ?? (() => undefined);
  const { staleDays, largeBytes } = env.settings.memory.cleanup;
  const memory = path.resolve(env.paths.memory);
  const files = readScope({
    homeDir: env.paths.home,
    roots: [...env.settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path), memory],
    excludes: env.settings.excludes,
  });

  // inventory: the scope's rows today's policy allows, less the places the scan never reports.
  progress("inventory", 0, 0);
  const rows = cleanupRows(db, env, scope).filter((row) => !ignoredByCleanup(env, path.join(row.root, row.rel)));
  progress("inventory", rows.length, rows.length);
  await pause();

  // signatures: the MinHash of each text the index holds.
  const signatures = await refreshSignatures(db, rows, (done, total) => progress("signatures", done, total));

  // links: which notes are linked either way, and the links of the scope's notes that lead nowhere.
  const notes = rows.filter(isMarkdown);
  progress("links", 0, notes.length);
  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const linked = new Set<number>();
  for (const edge of linkEdges(db, policy)) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  const holdsLinks = new Set(
    (db.prepare("SELECT DISTINCT src_id FROM note_links").all() as Array<{ src_id: number }>).map((r) => r.src_id),
  );
  const broken: Array<{ row: CleanupRow; target: string; line: number; linkKind: "markdown-link" | "wikilink" }> = [];
  for (let i = 0; i < notes.length; i += CLEANUP_BLOCK) {
    for (const row of notes.slice(i, i + CLEANUP_BLOCK)) {
      if (!holdsLinks.has(row.id)) continue;
      const links = linksOf(db, row.id, policy);
      for (const link of links?.outgoing ?? []) {
        if (link.resolved === null) broken.push({ row, target: link.target, line: link.line, linkKind: link.kind });
      }
    }
    progress("links", Math.min(notes.length, i + CLEANUP_BLOCK), notes.length);
    await pause();
  }

  // findings: the bytes of the files a finding names, the folders, and the decisions already taken.
  progress("findings", 0, rows.length);
  const hashes = new Map<number, string | null>();
  let hashed = 0;
  const hashOf = async (row: CleanupRow): Promise<string | null> => {
    if (hashes.has(row.id)) return hashes.get(row.id)!;
    let digest: string | null = null;
    try {
      const file = openWorkspaceFile(files, row.path);
      try {
        digest = file.sha256();
      } finally {
        file.close();
      }
    } catch {
      digest = null; // gone, or refused today: it is no member of anything
    }
    hashes.set(row.id, digest);
    if (++hashed % CLEANUP_BLOCK === 0) {
      progress("findings", Math.min(rows.length, hashed), rows.length);
      await pause();
    }
    return digest;
  };
  const member = async (row: CleanupRow): Promise<CleanupFindingFile | null> => {
    const sha256 = await hashOf(row);
    return sha256 === null ? null : { id: row.id, path: row.path, size: row.size, mtime: row.mtime, sha256 };
  };
  const found: Array<Omit<CleanupFinding, "key" | "suggested"> & { names?: string[] }> = [];
  const single = async (kind: CleanupFindingKind, row: CleanupRow, detail: CleanupFindingDetail, names?: string[]) => {
    const file = await member(row);
    if (file) found.push({ kind, files: [file], detail, ...(names ? { names } : {}) });
  };

  // duplicate: the same bytes (files of one size are hashed; an empty file is nobody's duplicate).
  const bySize = new Map<number, CleanupRow[]>();
  for (const row of rows) {
    if (row.size === 0) continue;
    const list = bySize.get(row.size) ?? [];
    list.push(row);
    bySize.set(row.size, list);
  }
  for (const group of bySize.values()) {
    if (group.length < 2) continue;
    const byHash = new Map<string, CleanupFindingFile[]>();
    for (const row of group) {
      const file = await member(row);
      if (!file) continue;
      const list = byHash.get(file.sha256) ?? [];
      list.push(file);
      byHash.set(file.sha256, list);
    }
    for (const same of byHash.values()) {
      if (same.length >= 2) found.push({ kind: "duplicate", files: same.sort((a, b) => (a.path < b.path ? -1 : 1)), detail: {} });
    }
  }

  // near-duplicate: an estimated Jaccard of 0.8 or more over the 5-word shingles, and not the same bytes.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const candidates = minhashCandidates([...signatures].map(([id, sig]) => ({ id, sig })));
  for (const [a, b] of candidates) {
    const similarity = minhashSimilarity(signatures.get(a)!, signatures.get(b)!);
    if (similarity < NEAR_DUPLICATE_SIMILARITY) continue;
    const fa = await member(byId.get(a)!);
    const fb = await member(byId.get(b)!);
    if (!fa || !fb || fa.sha256 === fb.sha256) continue;
    found.push({
      kind: "near-duplicate",
      files: [fa, fb].sort((x, y) => (x.path < y.path ? -1 : 1)),
      detail: { similarity },
    });
  }

  for (const row of rows) {
    const stale = staleDetail(row, staleDays, now);
    if (stale) await single("stale", row, stale);
  }
  for (const row of notes) if (!linked.has(row.id)) await single("orphan", row, {});
  for (const link of broken) {
    await single("broken-link", link.row, { target: link.target, line: link.line, linkKind: link.linkKind }, [
      `${link.linkKind}\u0000${link.target}\u0000${link.line}`,
    ]);
  }

  // empty-folder: a folder of the scope that holds no indexed file and no folder that holds one.
  const holding = new Set<string>();
  const realRoot = new Map<string, string>();
  for (const row of cleanupRows(db, env, scope)) {
    let real = realRoot.get(row.root);
    if (real === undefined) {
      real = realpathLenient(row.root);
      realRoot.set(row.root, real);
    }
    for (let dir = path.dirname(path.join(real, row.rel)); ; dir = path.dirname(dir)) {
      if (holding.has(dir)) break;
      holding.add(dir);
      if (path.dirname(dir) === dir) break;
    }
  }
  const realMemory = realpathLenient(memory);
  const ignoredFolder = (dir: string) => isInside(realMemory, dir) && ignoredByCleanup({ ...env, paths: { ...env.paths, memory: realMemory } }, dir);
  for (const folder of await emptyFolders(files, scope.roots, holding, ignoredFolder)) {
    found.push({ kind: "empty-folder", files: [], detail: { folder }, names: [`folder\u0000${folder}`] });
  }

  for (const row of rows) if (row.size > largeBytes) await single("large-file", row, { bytes: row.size, limit: largeBytes });
  for (const row of notes) if (row.title === null || row.title.trim() === "") await single("untitled", row, {});
  progress("findings", rows.length, rows.length);

  // What the owner decided hides a finding while its key holds: keep, archive, merge, or snooze until a later time.
  const decisions = new Map(
    (
      db.prepare("SELECT key, decision, until FROM cleanup_decisions WHERE scope = ?").all(scope.key) as Array<{
        key: string;
        decision: string;
        until: number | null;
      }>
    ).map((d) => [d.key, d]),
  );
  const hides = (key: string): boolean => {
    const d = decisions.get(key);
    if (!d) return false;
    if (d.decision === "keep" || d.decision === "archive" || d.decision === "merge") return true;
    return d.decision === "snooze" && d.until !== null && d.until > now;
  };
  const findings: CleanupFinding[] = [];
  let decided = 0;
  for (const { names, ...f } of found) {
    const key = findingKey(f.kind, f.files, names);
    if (hides(key)) {
      decided++;
      continue;
    }
    findings.push({ key, ...f, suggested: SUGGESTED[f.kind] });
  }
  const first = (f: CleanupFinding) => f.files[0]?.path ?? f.detail.folder ?? "";
  findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (first(a) < first(b) ? -1 : first(a) > first(b) ? 1 : 0) ||
      (a.detail.line ?? 0) - (b.detail.line ?? 0),
  );
  return { findings, decided };
}

// ---- the scans of a service ------------------------------------------------------------------------------------------

/** `409 scan_running`: a scan of the same scope runs; the message names it. */
export class CleanupScanRunningError extends Error {
  readonly statusCode = 409;
  readonly code = "scan_running";
  constructor(readonly scanId: string) {
    super(`A scan of this scope is running: ${scanId}`);
    this.name = "CleanupScanRunningError";
  }
}

export interface CleanupScanRecord {
  scanId: string;
  scope: CleanupScopeView;
  /** `context:<id>` or `dir:<path>`: the key decisions are stored under. */
  scopeKey: string;
  status: "running" | "finished" | "failed";
  phase: CleanupPhase;
  code: string | null;
  startedAt: number;
  finishedAt: number | null;
  findings: CleanupFinding[];
  decided: number;
}

/** Scans a service keeps to answer `GET /api/memory/cleanup/scans/:id`; the oldest that ended go first. */
const KEPT_SCANS = 100;

/**
 * The scans of one engine: at most one running per scope (AC 15), each holding the shared restore lock from its start
 * to its end however it ends (AC 16), announced on the engine's bus (door 6). The state is this instance's.
 */
export class CleanupScanner {
  private readonly scans = new Map<string, CleanupScanRecord>();

  constructor(
    private readonly opts: {
      db: Db;
      paths: MordomoPaths;
      bus: EventBus;
      getSettings: () => Settings;
    },
  ) {}

  /**
   * Start a scan of the scope a request names, or refuse it: the scope's refusals (`400`, `404`), `409 scan_running`
   * and `409 restore_in_progress`, each before anything starts. Returns the scan's id at once; the scan runs on.
   */
  start(request: { context?: string | undefined; dir?: string | undefined }): string {
    const env = { paths: this.opts.paths, settings: this.opts.getSettings() };
    const scope = resolveCleanupScope(env, request);
    for (const scan of this.scans.values()) {
      if (scan.scopeKey === scope.key && scan.status === "running") throw new CleanupScanRunningError(scan.scanId);
    }
    const lock = RestoreLock.acquire(this.opts.paths, 0, "shared");
    const record: CleanupScanRecord = {
      scanId: crypto.randomUUID(),
      scope: scope.view,
      scopeKey: scope.key,
      status: "running",
      phase: "inventory",
      code: null,
      startedAt: Date.now(),
      finishedAt: null,
      findings: [],
      decided: 0,
    };
    this.keep(record);
    void this.run(record, env, scope, lock);
    return record.scanId;
  }

  get(scanId: string): CleanupScanRecord | undefined {
    return this.scans.get(scanId);
  }

  /** The newest scan of a scope, by its key. */
  latest(scopeKey: string): CleanupScanRecord | undefined {
    let newest: CleanupScanRecord | undefined;
    for (const scan of this.scans.values()) if (scan.scopeKey === scopeKey) newest = scan;
    return newest;
  }

  private keep(record: CleanupScanRecord): void {
    this.scans.set(record.scanId, record);
    if (this.scans.size <= KEPT_SCANS) return;
    for (const [id, scan] of this.scans) {
      if (scan.status !== "running") {
        this.scans.delete(id);
        return;
      }
    }
  }

  private async run(record: CleanupScanRecord, env: CleanupEnv, scope: CleanupScope, lock: RestoreLock): Promise<void> {
    const { bus, db } = this.opts;
    try {
      await pause();
      const result = await scanCleanupScope(db, env, scope, {
        onProgress: (phase, done, total) => {
          record.phase = phase;
          bus.emit("cleanup.progress", { scanId: record.scanId, phase, done, total });
        },
      });
      record.findings = result.findings;
      record.decided = result.decided;
      record.status = "finished";
      record.finishedAt = Date.now();
      bus.emit("cleanup.finished", { scanId: record.scanId, findings: result.findings.length });
    } catch {
      record.status = "failed";
      record.code = "scan_failed";
      record.finishedAt = Date.now();
      bus.emit("cleanup.failed", { scanId: record.scanId, code: "scan_failed" });
    } finally {
      lock.release();
    }
  }
}

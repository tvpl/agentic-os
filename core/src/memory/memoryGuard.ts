import crypto from "node:crypto";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { EditConflictError } from "../errors.js";
import type { EventBus, OsEvent } from "../events.js";
import type { MordomoPaths } from "../paths.js";
import { homeReadScope, readWorkspaceFile, type ReadScope } from "../security/safeFs.js";
import { moveWorkspaceFile, writeWorkspaceFile } from "../security/safeWrite.js";
import { historyMaxBytes, newestVersion, recordVersion } from "./historyStore.js";
import { MEMORY_FILE, storeProposal } from "./proposals.js";

/**
 * The guard of `MEMORY.md` (.specs/features/cerebro-memoria-confiavel, door 8). A run that may write can reach
 * `memory/MEMORY.md` on disk, whatever its skill says (a home keeps the old copy of `consolidate-memory`, which wrote
 * it). So at `run.started` of a write run its bytes are kept (and recorded as a `guard` version when they differ from
 * the newest one), and at `run.finished`, when they changed and no version by the owner of `MEMORY.md` was recorded in
 * between, the start state is put back (the start bytes, or a file the run created moved to
 * `memory/archive/guard-<runId>-MEMORY.md`) and what the run wrote waits as a `memory_edit` proposal. Only the file at
 * the root of `memory/`: a `notes/MEMORY.md` is a note like any other.
 *
 * The start states live on this instance (one per engine), never in module state.
 */

export interface MemoryGuardDeps {
  db: Db;
  paths: MordomoPaths;
  getSettings: () => Settings;
  runs: {
    get(id: string): { request: { mode: string } | null; permissionProfile: string | null } | null;
  };
}

interface StartState {
  bytes: Buffer | null;
  /** The newest version id of the history when the run started. */
  mark: number;
}

const sha = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a: Buffer | null, b: Buffer | null) => (a === null ? b === null : b !== null && a.equals(b));

export class MemoryGuard {
  private readonly started = new Map<string, StartState>();

  constructor(private readonly deps: MemoryGuardDeps) {}

  private get file(): string {
    return path.join(this.deps.paths.memory, MEMORY_FILE);
  }

  private scope(): ReadScope {
    return homeReadScope(this.deps.paths.home, [this.deps.paths.memory], this.deps.getSettings().excludes);
  }

  private read(): Buffer | null {
    try {
      return readWorkspaceFile(this.scope(), this.file, { maxBytes: 4 * 1024 * 1024, strict: true }).bytes;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private record(bytes: Buffer | null, origin: "guard" | "removed"): void {
    recordVersion(
      this.deps.db,
      { rel: MEMORY_FILE, bytes, author: "system", origin },
      historyMaxBytes(this.deps.getSettings()),
    );
  }

  /** Whether the run writes: its request says so; a run with none is taken to write unless its profile only reads. */
  private writes(runId: string): boolean {
    const run = this.deps.runs.get(runId);
    if (!run) return false;
    if (run.request) return run.request.mode === "write";
    return run.permissionProfile !== "read_only";
  }

  /** Runs whose start state is kept (what a test or a caller can look at). */
  watching(): string[] {
    return [...this.started.keys()];
  }

  onStarted(runId: string): void {
    if (this.started.has(runId) || !this.writes(runId)) return;
    const bytes = this.read();
    if (bytes !== null) {
      const newest = newestVersion(this.deps.db, MEMORY_FILE);
      if (!newest || newest.sha256 !== `sha256:${sha(bytes)}`) this.record(bytes, "guard");
    }
    const mark = (this.deps.db.prepare("SELECT COALESCE(MAX(id), 0) m FROM memory_versions").get() as { m: number }).m;
    this.started.set(runId, { bytes, mark });
  }

  /** Put the start bytes back over the run's (`expectSha256` of the run's bytes). Its own method, so it can be watched. */
  putBack(start: Buffer, runBytes: Buffer): void {
    writeWorkspaceFile(this.scope(), this.file, start, { mode: "replace", expectSha256: sha(runBytes) });
  }

  onFinished(runId: string): void {
    const start = this.started.get(runId);
    if (!start) return;
    this.started.delete(runId);
    const now = this.read();
    if (same(start.bytes, now)) return;
    const owner = this.deps.db
      .prepare("SELECT 1 FROM memory_versions WHERE path = ? AND author = 'owner' AND id > ? LIMIT 1")
      .get(MEMORY_FILE, start.mark);
    if (owner) return; // the owner wrote MEMORY.md during the run: what is there is theirs (AC 73)
    if (now !== null) this.record(now, "guard");
    try {
      if (start.bytes !== null && now !== null) {
        this.putBack(start.bytes, now);
        this.record(start.bytes, "guard");
      } else if (start.bytes === null && now !== null) {
        const aside = path.join(this.deps.paths.memory, "archive", `guard-${runId}-${MEMORY_FILE}`);
        moveWorkspaceFile(this.scope(), this.file, aside, { expectSha256: sha(now) });
        this.record(null, "removed");
      } else if (start.bytes !== null) {
        // the run removed MEMORY.md: its bytes come back
        writeWorkspaceFile(this.scope(), this.file, start.bytes, { mode: "create" });
        this.record(start.bytes, "guard");
      }
    } catch (err) {
      // the file changed again after the run (G7): it stays as it is, and the run's bytes still wait for review
      if (!(err instanceof EditConflictError) && (err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    storeProposal(
      this.deps.db,
      {
        kind: "memory_edit",
        author: `run:${runId}`,
        runId,
        summary: `The run ${runId} changed MEMORY.md; the guard put the file back.`,
        payload: { path: MEMORY_FILE, content: now === null ? "" : now.toString("utf8") },
      },
      // the guard has no caller to answer a 429 to: it always stores (G8)
      { capped: false },
    );
  }

  /** Subscribe to the bus; returns the unsubscribe function. */
  install(bus: EventBus): () => void {
    return bus.subscribe((event: OsEvent) => {
      if (event.type !== "run.started" && event.type !== "run.finished") return;
      const runId = (event.payload as { runId?: unknown } | undefined)?.runId;
      if (typeof runId !== "string") return;
      try {
        if (event.type === "run.started") this.onStarted(runId);
        else this.onFinished(runId);
      } catch (err) {
        console.error(`[memory] the guard of MEMORY.md failed at ${event.type}`, err);
      }
    });
  }
}

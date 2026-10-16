import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker, type ResourceLimits } from "node:worker_threads";
import type { IndexMode, IndexPhase, IndexProgress, IndexStats } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { EventBus } from "../events.js";
import type { MordomoPaths } from "../paths.js";
import { RestoreInProgressError, RestoreLock } from "../restoreLock.js";
import { IncompleteIndexScanError, IndexCancelledError, type IndexRunner, type MemoryIndexer } from "./indexer.js";
import { WorkerMessage, type StartMessage } from "./indexProtocol.js";

/**
 * Runs the index passes of one engine (.specs/features/cerebro-v2, S3): in a `worker_thread` when the worker script is
 * there, in the service's own thread when it is not. One host per `MemoryIndexer`; nothing here is shared between
 * engines of one process (no module-level state: a worker thread has its own `globalThis`, and two engines have two
 * homes).
 *
 * A pass:
 *  - takes the SHARED restore lock for as long as it runs, so a restore cannot replace the database under it, and
 *    refuses (`RestoreInProgressError`) while a restore holds the exclusive one - before any thread starts;
 *  - is announced on the bus (`index.started`, `index.progress`, `index.finished` | `index.failed` | `index.cancelled`,
 *    each with the pass's `runId`) - the worker itself announces nothing, the host translates what it says;
 *  - can be cancelled at the next chunk (a shared flag the worker reads), and is torn down by `dispose`;
 *  - leaves a marker in `meta` while it runs, so a pass that died with the process is found at the next start and
 *    taken up again (the passes are incremental: what was committed stays, the rest is done again).
 */

/** The most heap a worker may hold; a pass that needs more than this is a bug, and it dies alone. */
export const WORKER_LIMITS: ResourceLimits = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 };
/** Sleep between two chunks of the worker: a pass is a background job, not a benchmark. */
export const WORKER_PACE_MS = 2;
/** After a cancel the worker gets this long to reach its next chunk before the thread is stopped. */
export const CANCEL_GRACE_MS = 5_000;
const RUN_MARKER_KEY = "index.run";
const MESSAGE_KINDS: ReadonlySet<string> = new Set(["progress", "done", "failed"]);

/** The worker died, ran out of memory, or said something that is not in the protocol. */
export class IndexWorkerError extends Error {
  readonly statusCode = 503;
  constructor(
    readonly code: "index_worker_crashed" | "index_worker_out_of_memory",
    message: string,
  ) {
    super(message);
    this.name = "IndexWorkerError";
  }
}

export interface IndexHostOptions {
  paths: MordomoPaths;
  db: Db;
  bus: EventBus;
  getSettings: () => Settings;
  indexer: MemoryIndexer;
  /** The worker script. Omitted: the one next to this module (`indexWorker.js`, or `.mjs` in the installer), if any. */
  workerEntry?: string | null;
  resourceLimits?: ResourceLimits;
  paceMs?: number;
  /** How long a pass waits for a restore to let go of the home (default: not at all). */
  restoreWaitMs?: number;
  /** How long a worker that was asked to stop gets to reach its next chunk before the thread is stopped. */
  cancelGraceMs?: number;
}

export interface IndexingStatus {
  state: "idle" | "running";
  mode: IndexMode;
  runId: string | null;
  phase: IndexPhase | null;
  scanned: number;
  total: number | null;
  /** A pass of the previous process died; the next one (started by `engine.start()`) takes it up. */
  interrupted: boolean;
}

interface Run {
  id: string;
  only: boolean;
  promise: Promise<IndexStats>;
  mode: IndexMode;
  flag: Int32Array;
  worker: Worker | null;
  cancelled: boolean;
  progress: Set<(p: IndexProgress) => void>;
  /** What `cancel` does to the pass, once it is running (the worker: arm the hard stop). */
  abort: (error: Error) => void;
  /** The shared restore lock this pass holds, once it has it. */
  lock: RestoreLock | null;
}

/**
 * The worker script next to a module (`moduleUrl`, normally this one): `indexWorker.js` in the compiled tree, then
 * `indexWorker.mjs` where the installer put it. `null` when there is none (a source tree, a test).
 */
export function resolveWorkerEntry(moduleUrl: string): string | null {
  for (const name of ["./indexWorker.js", "./indexWorker.mjs"]) {
    const file = fileURLToPath(new URL(name, moduleUrl));
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export class IndexWorkerHost implements IndexRunner {
  private entry: string | null | undefined;
  private current: Run | null = null;
  private waitingFull: Promise<IndexStats> | null = null;
  private disposed = false;
  private phase: IndexPhase | null = null;
  private scanned = 0;
  private total: number | null = null;
  private interrupted = false;

  constructor(private readonly opts: IndexHostOptions) {
    this.entry = opts.workerEntry;
    opts.indexer.attachRunner(this);
  }

  /** Use this worker script (tests, a packaged layout); `null` runs every pass in the service's own thread. */
  setWorkerEntry(entry: string | null): void {
    this.entry = entry;
  }

  private workerEntry(): string | null {
    if (this.entry === undefined) this.entry = resolveWorkerEntry(import.meta.url);
    return this.entry;
  }

  mode(): IndexMode {
    return this.workerEntry() === null ? "inline" : "worker";
  }

  isRunning(): boolean {
    return this.current !== null;
  }

  status(): IndexingStatus {
    return {
      state: this.current ? "running" : "idle",
      mode: this.current?.mode ?? this.mode(),
      runId: this.current?.id ?? null,
      phase: this.current ? this.phase : null,
      scanned: this.current ? this.scanned : 0,
      total: this.current ? this.total : null,
      interrupted: this.interrupted,
    };
  }

  /**
   * Run a pass (all indexed folders, or `only` these paths). A full pass asked for while a full pass runs joins it; a
   * request that arrives while a pass over paths runs waits for it.
   */
  run(request: { only?: readonly string[]; onProgress?: (p: IndexProgress) => void } = {}): Promise<IndexStats> {
    if (this.disposed) return Promise.reject(new IndexCancelledError());
    const only = request.only !== undefined;
    const joined = this.current;
    if (joined && !joined.only && !only) {
      if (request.onProgress) joined.progress.add(request.onProgress);
      return joined.promise;
    }
    if (joined) {
      // Behind the pass that runs: a second full request while one waits shares that wait.
      if (!only && this.waitingFull) return this.waitingFull;
      // When the pass ahead ends, this request runs. It must not find itself as the waiting full pass (that would wait
      // for its own end), so it is let go of before it asks again.
      const again = (): Promise<IndexStats> => {
        if (!only) this.waitingFull = null;
        return this.run(request);
      };
      const wait = joined.promise.then(again, again);
      if (!only) {
        this.waitingFull = wait;
        const clear = (): void => {
          if (this.waitingFull === wait) this.waitingFull = null;
        };
        wait.then(clear, clear);
      }
      return wait;
    }
    return this.start(request);
  }

  private start(request: { only?: readonly string[]; onProgress?: (p: IndexProgress) => void }): Promise<IndexStats> {
    const { opts } = this;
    const run: Run = {
      id: crypto.randomUUID(),
      only: request.only !== undefined,
      mode: this.mode(),
      promise: undefined as unknown as Promise<IndexStats>,
      flag: new Int32Array(new SharedArrayBuffer(4)),
      worker: null,
      cancelled: false,
      progress: new Set(request.onProgress ? [request.onProgress] : []),
      abort: () => undefined,
      lock: null,
    };
    this.current = run;
    this.phase = null;
    this.scanned = 0;
    this.total = null;
    run.promise = (async () => {
      let lock: RestoreLock;
      try {
        lock = await RestoreLock.acquireAsync(opts.paths, opts.restoreWaitMs ?? 0, "shared");
      } catch (error) {
        if (error instanceof RestoreInProgressError) {
          opts.bus.emit("index.failed", { code: error.code, previousIndexPreserved: true, runId: run.id });
        }
        throw error;
      }
      run.lock = lock;
      try {
        this.writeMarker(run.id);
        opts.bus.emit("index.started", { runId: run.id, mode: run.mode });
        const onProgress = (p: IndexProgress) => {
          this.phase = p.phase ?? this.phase;
          this.scanned = p.scanned;
          this.total = p.total ?? this.total;
          for (const listener of run.progress) listener(p);
        };
        const stats =
          run.mode === "worker"
            ? await this.runInWorker(run, request.only, onProgress)
            : await this.runInline(run, request.only, onProgress);
        this.interrupted = false;
        return stats;
      } catch (error) {
        if (error instanceof IndexCancelledError) opts.bus.emit("index.cancelled", { runId: run.id });
        throw error;
      } finally {
        this.clearMarker();
        lock.release();
        if (this.current === run) this.current = null;
      }
    })();
    return run.promise;
  }

  private runInline(run: Run, only: readonly string[] | undefined, onProgress: (p: IndexProgress) => void): Promise<IndexStats> {
    return new Promise<IndexStats>((resolve, reject) => {
      run.abort = reject;
      this.opts.indexer.runInline(run.id, onProgress, only).then(resolve, reject);
    });
  }

  private runInWorker(run: Run, only: readonly string[] | undefined, onProgress: (p: IndexProgress) => void): Promise<IndexStats> {
    const { opts } = this;
    const entry = this.workerEntry()!;
    return new Promise<IndexStats>((resolve, reject) => {
      const worker = new Worker(entry, { resourceLimits: opts.resourceLimits ?? WORKER_LIMITS });
      run.worker = worker;
      let settled = false;
      let hardStop: NodeJS.Timeout | undefined;
      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(hardStop);
        run.worker = null;
        void worker.terminate();
        finish();
      };
      const crashed = (code: "index_worker_crashed" | "index_worker_out_of_memory", message: string) =>
        settle(() => {
          opts.bus.emit("index.failed", { code, previousIndexPreserved: true, runId: run.id });
          reject(new IndexWorkerError(code, message));
        });

      worker.on("message", (raw: unknown) => {
        // A message of a kind this host does not know is not for it (a newer worker); a known kind that does not
        // fit its schema is a worker that is not ours.
        const kind = (raw as { t?: unknown } | null)?.t;
        if (typeof kind !== "string" || !MESSAGE_KINDS.has(kind)) return;
        const parsed = WorkerMessage.safeParse(raw);
        if (!parsed.success) {
          // The protocol is the only thing this thread believes: anything else is a worker that is not ours.
          crashed("index_worker_crashed", "The index worker sent a message that is not in the protocol.");
          return;
        }
        const message = parsed.data;
        if (message.t === "progress") {
          onProgress(message.progress);
          opts.bus.emit("index.progress", message.progress);
        } else if (message.t === "done") {
          settle(() => {
            opts.bus.emit("index.finished", { stats: message.stats as IndexStats, runId: run.id });
            resolve(message.stats as IndexStats);
          });
        } else if (message.code === "index_cancelled") {
          settle(() => reject(new IndexCancelledError()));
        } else {
          settle(() => {
            opts.bus.emit("index.failed", {
              code: message.code,
              previousIndexPreserved: message.previousIndexPreserved,
              runId: run.id,
            });
            reject(
              message.code === "index_scan_incomplete"
                ? new IncompleteIndexScanError()
                : new IndexWorkerError("index_worker_crashed", message.message),
            );
          });
        }
      });
      worker.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ERR_WORKER_OUT_OF_MEMORY") crashed("index_worker_out_of_memory", "The index worker ran out of memory.");
        else crashed("index_worker_crashed", error.message);
      });
      worker.on("exit", (code) => {
        if (settled) return;
        // Stopped on purpose (the engine is closing): that is a cancel, not a crash.
        if (run.cancelled) settle(() => reject(new IndexCancelledError()));
        else crashed("index_worker_crashed", `The index worker exited with code ${code} before it finished.`);
      });

      const start: StartMessage = {
        t: "start",
        runId: run.id,
        dbFile: opts.paths.dbFile,
        homeDir: opts.paths.home,
        platform: process.platform,
        settings: JSON.parse(JSON.stringify(opts.getSettings())) as Record<string, unknown>,
        implicitRoots: opts.indexer.listImplicitRoots(),
        ...(only ? { only: [...only] } : {}),
        cancel: run.flag.buffer as SharedArrayBuffer,
        paceMs: opts.paceMs ?? WORKER_PACE_MS,
      };
      worker.postMessage(start);
      // `cancel` arms the hard stop: a worker that does not reach its next chunk is stopped.
      run.abort = (error) => {
        hardStop = setTimeout(() => settle(() => reject(error)), opts.cancelGraceMs ?? CANCEL_GRACE_MS);
        hardStop.unref();
      };
    });
  }

  /**
   * Stop the pass that runs, at the next chunk. The call that started it rejects with `IndexCancelledError`, and
   * `index.cancelled` is announced. `{ cancelled: false }` when nothing runs.
   */
  cancel(): { cancelled: boolean; runId: string | null } {
    const run = this.current;
    if (!run || run.cancelled) return { cancelled: false, runId: run?.id ?? null };
    run.cancelled = true;
    Atomics.store(run.flag, 0, 1);
    if (run.mode === "inline") this.opts.indexer.cancelInline();
    else run.abort(new IndexCancelledError());
    return { cancelled: true, runId: run.id };
  }

  /**
   * The engine is closing: whatever runs is cancelled and its thread stopped now, and no pass starts again. The lock
   * is let go as soon as the pass settles (the thread is asked to stop here; Node finishes stopping it a moment later).
   */
  dispose(): void {
    this.disposed = true;
    const run = this.current;
    if (!run) return;
    run.cancelled = true;
    Atomics.store(run.flag, 0, 1);
    if (run.mode === "inline") this.opts.indexer.cancelInline();
    // Let go of the home now: a restore may start the moment this returns, and the pass is over for this engine.
    run.lock?.release();
    void run.worker?.terminate();
  }

  /** `dispose`, and wait until the pass has settled (the thread gone, the lock let go). */
  async disposeAsync(): Promise<void> {
    const run = this.current;
    this.dispose();
    await run?.promise.catch(() => undefined);
  }

  /**
   * After a crash: a pass that was running when the process died left its marker. Called once by `engine.start()`:
   * it is taken up again here (a normal pass, incremental, so what was committed is kept).
   */
  resumeInterrupted(): void {
    const row = this.opts.db.prepare("SELECT value FROM meta WHERE key = ?").get(RUN_MARKER_KEY) as { value: string } | undefined;
    if (!row || this.current || this.disposed) return;
    this.interrupted = true;
    this.opts.db.prepare("DELETE FROM meta WHERE key = ?").run(RUN_MARKER_KEY);
    this.run({}).catch(() => undefined);
  }

  private writeMarker(runId: string): void {
    this.opts.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(RUN_MARKER_KEY, JSON.stringify({ runId, startedAt: Date.now(), pid: process.pid }));
  }

  private clearMarker(): void {
    // A closed database (the engine closed first) has nothing to clear: the marker stays, which is the point.
    if (!this.opts.db.open) return;
    this.opts.db.prepare("DELETE FROM meta WHERE key = ?").run(RUN_MARKER_KEY);
  }
}

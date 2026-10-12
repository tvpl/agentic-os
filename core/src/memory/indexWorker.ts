/**
 * The index worker (.specs/features/cerebro-v2, door 6): the entry of a `worker_thread` that runs ONE index pass and
 * ends. It has a database connection of its own and nothing else of the service: it imports the indexer and the safe
 * reader and no engine, no owner lock, no restore lock (the host holds that one for it), no migrations - a worker
 * thread has its own `globalThis`, so a registry kept in a module would not be the service's.
 *
 * What it reads goes through the same safe reader and the same private-folder filter as the inline pass, because it
 * runs the same `MemoryIndexer`. It stops between two chunks when the host sets the shared flag, and tells the host
 * what it did in the messages of `indexProtocol.ts`.
 */
import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";
import type { IndexProgress } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import { IncompleteIndexScanError, MemoryIndexer } from "./indexer.js";
import { StartMessage, type WorkerMessage } from "./indexProtocol.js";

const port = parentPort;
if (!port) throw new Error("indexWorker.ts is the entry of a worker thread; it is not meant to be imported");

const post = (message: WorkerMessage): void => port.postMessage(message);

function sleep(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function run(start: StartMessage): Promise<void> {
  const db = new Database(start.dbFile, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const settings = start.settings as unknown as Settings;
    const indexer = new MemoryIndexer(db, () => settings, {
      homeDir: start.homeDir,
      ...(start.platform ? { platform: start.platform as NodeJS.Platform } : {}),
    });
    for (const folder of start.implicitRoots) indexer.addImplicitRoot(folder);
    const cancel = new Int32Array(start.cancel);
    const stopped = () => Atomics.load(cancel, 0) === 1;
    const cancelled = () => post({ t: "failed", code: "index_cancelled", message: "cancelled", previousIndexPreserved: true });
    const onProgress = (progress: IndexProgress) => post({ t: "progress", progress });
    const pass = indexer.iteratePass(onProgress, start.only, start.runId);
    let step = pass.next();
    while (!step.done) {
      if (stopped()) {
        pass.return(undefined as never);
        cancelled();
        return;
      }
      sleep(start.paceMs);
      step = pass.next();
    }
    const stats = step.value;
    // The vectors phase is async (an endpoint answers when it answers); the flag is read from a timer meanwhile.
    const abort = new AbortController();
    const watch = setInterval(() => stopped() && abort.abort(), 50);
    try {
      await indexer.runVectors(stats, start.only !== undefined, {
        signal: abort.signal,
        shouldStop: stopped,
        onProgress,
        runId: start.runId,
      });
    } finally {
      clearInterval(watch);
    }
    if (stopped()) {
      cancelled();
      return;
    }
    post({ t: "done", stats });
  } catch (error) {
    const preserved = error instanceof IncompleteIndexScanError;
    post({
      t: "failed",
      code: preserved ? error.code : "index_failed",
      message: error instanceof Error ? error.message : String(error),
      previousIndexPreserved: preserved,
    });
  } finally {
    db.close();
  }
}

port.once("message", (raw: unknown) => {
  const parsed = StartMessage.safeParse(raw);
  if (!parsed.success) {
    post({ t: "failed", code: "index_failed", message: "The start message did not fit its schema.", previousIndexPreserved: true });
    return;
  }
  void run(parsed.data);
});

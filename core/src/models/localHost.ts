import childProcess, { type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { EmbeddingError } from "../memory/embeddings.js";

/**
 * The child process of the local models (.specs/features/cerebro-busca-significado, door 2): `@huggingface/transformers`
 * and its native runtime are loaded there and never in the service, so a native fault ends the child and not the
 * service, and its memory goes when it ends. One per engine: started on the first request, ended after `idleMs` with no
 * request, started again by the next one. It speaks only the messages below.
 */

/** What the child needs to load one model from `<home>/models/<id>/`. */
export interface ChildModel {
  id: string;
  kind: "embedder" | "reranker";
  dtype: string;
  pooling?: "mean" | "last_token";
  dimensions?: number;
}

export type ChildRequest =
  | { t: "embed"; id: number; modelsDir: string; model: ChildModel; texts: string[] }
  | { t: "rerank"; id: number; modelsDir: string; model: ChildModel; query: string; texts: string[] }
  | { t: "ping"; id: number };

export type ChildReply =
  | { t: "result"; id: number; vectors?: number[][]; scores?: number[] }
  | { t: "error"; id: number; message: string };

/** How long the child lives with no request (Assumptions "Ociosidade do processo filho"). */
export const CHILD_IDLE_MS = 120_000;

/** The child's entry next to a module: `localChild.js` in the compiled tree, `localChild.mjs` where the installer put it. */
export function resolveChildEntry(moduleUrl: string): string | null {
  for (const name of ["./localChild.js", "./localChild.mjs"]) {
    const file = fileURLToPath(new URL(name, moduleUrl));
    if (fs.existsSync(file)) return file;
  }
  return null;
}

interface Pending {
  child: ChildProcess;
  resolve: (reply: ChildReply & { t: "result" }) => void;
  reject: (error: Error) => void;
}

export interface LocalHostOptions {
  /** The child's script; `null`: there is none (a source tree), and no request can be served. */
  entry: string | null;
  modelsDir: string;
  idleMs?: number;
}

export class LocalModelHost {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<number, Pending>();
  private next = 1;
  private idle: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly opts: LocalHostOptions) {}

  /** The pid of the child that runs, or null. */
  pid(): number | null {
    return this.child?.pid ?? null;
  }

  embed(model: ChildModel, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    return this.request({ t: "embed", modelsDir: this.opts.modelsDir, model, texts }, signal).then(
      (reply) => {
        if (!Array.isArray(reply.vectors) || reply.vectors.length !== texts.length)
          throw new EmbeddingError("malformed", "the local model answered no vector for each text");
        return reply.vectors;
      },
    );
  }

  /**
   * The reranker's "yes" probability for each text, in their order. A `timeoutMs` that passes rejects with a
   * `kind: "timeout"` error; the child is kept, and its late answer is ignored (G28).
   */
  rerank(model: ChildModel, query: string, texts: string[], timeoutMs?: number): Promise<number[]> {
    const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
    return this.request(
      { t: "rerank", modelsDir: this.opts.modelsDir, model, query, texts },
      signal,
      "timeout",
    ).then((reply) => {
      if (!Array.isArray(reply.scores) || reply.scores.length !== texts.length)
        throw new EmbeddingError("malformed", "the reranker answered no score for each text");
      return reply.scores;
    });
  }

  /** The child is told to go and forgotten; a request after this is refused. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.idle);
    this.stop();
    for (const [, pending] of this.pending)
      pending.reject(new EmbeddingError("local_crashed", "the engine is closing"));
    this.pending.clear();
  }

  private request(
    message:
      | { t: "embed"; modelsDir: string; model: ChildModel; texts: string[] }
      | { t: "rerank"; modelsDir: string; model: ChildModel; query: string; texts: string[] },
    signal?: AbortSignal,
    onAbort: "abort" | "timeout" = "abort",
  ): Promise<ChildReply & { t: "result" }> {
    if (this.disposed) return Promise.reject(new EmbeddingError("local_crashed", "the engine is closing"));
    if (!this.opts.entry)
      return Promise.reject(new EmbeddingError("local_crashed", "there is no local model process here"));
    clearTimeout(this.idle);
    const child = this.child ?? this.start();
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const settle = () => {
        signal?.removeEventListener("abort", aborted);
        this.pending.delete(id);
        this.armIdle();
      };
      const aborted = () => {
        // The request is forgotten, not the child: an answer that arrives later finds no one waiting (G28).
        settle();
        reject(
          onAbort === "timeout"
            ? new EmbeddingError("timeout", "the local model did not answer in time")
            : signal!.reason,
        );
      };
      this.pending.set(id, {
        child,
        resolve: (reply) => (settle(), resolve(reply)),
        reject: (error) => (settle(), reject(error)),
      });
      if (signal?.aborted) return aborted();
      signal?.addEventListener("abort", aborted, { once: true });
      child.send({ ...message, id });
    });
  }

  private start(): ChildProcess {
    const child = childProcess.fork(this.opts.entry!, [], {
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.child = child;
    child.on("message", (raw: unknown) => {
      const reply = raw as ChildReply | null;
      if (!reply || typeof reply.id !== "number") return;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      if (reply.t === "result") pending.resolve(reply);
      else pending.reject(new EmbeddingError("local_crashed", `the local model failed: ${reply.message}`));
    });
    child.on("error", () => undefined);
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      // Every request this child had is lost with it; the next one starts another child.
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      for (const [, pending] of this.pending)
        if (pending.child === child)
          pending.reject(new EmbeddingError("local_crashed", `the local model process ended (${reason})`));
    });
    return child;
  }

  private armIdle(): void {
    if (this.pending.size > 0 || !this.child) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), this.opts.idleMs ?? CHILD_IDLE_MS);
    this.idle.unref();
  }

  private stop(): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    if (child.connected) child.send({ t: "exit" });
  }
}

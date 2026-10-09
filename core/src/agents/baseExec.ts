import type { AgentRun, RunEvent, SafeInvocation } from "./types.js";
import { safeSpawn } from "../spawn/safeSpawn.js";

/**
 * Shared streaming execution used by all adapters: spawns the invocation,
 * feeds stdout lines to an adapter-specific parser and normalizes lifecycle
 * events.
 *
 * Cancellation comes from `run.signal` (owned by the RunManager): if it is
 * already aborted nothing is spawned; if it aborts later the process group is
 * killed. If the consumer stops iterating early (return/throw), the generator's
 * cleanup kills the child instead of waiting for it to finish on its own.
 */

export interface LineParser {
  /** Return events for a stdout line, or null to fall through to raw text. */
  parseLine(line: string): RunEvent[] | null;
  /** Called at the end; may extract a summary from accumulated output. */
  summarize(stdout: string, stderr: string, exitCode: number | null): string;
  /** Called once after the last stdout line, before the `result` event: closing events (e.g. a warning). */
  finish?(): RunEvent[];
  /**
   * The runner could not hand over a line: it was over `MAX_LINE_CHARS`, or
   * `parseLine` threw on it. A parser counts it with the lines it did not
   * recognize; without this the runner prints one generic note per run.
   */
  dropped?(): void;
}

/**
 * One stdout line longer than this is dropped, not parsed: a CLI that never
 * prints a newline must not grow the buffer without bound. Real stream-json
 * lines (a whole tool result or file) stay far below it.
 */
export const MAX_LINE_CHARS = 4 * 1024 * 1024;

/** A parser that throws while summarizing must not lose the `result` event. */
function summaryOf(parser: LineParser, stdout: string, stderr: string, exitCode: number | null): string {
  try {
    return parser.summarize(stdout, stderr, exitCode);
  } catch {
    return "";
  }
}

export async function* executeInvocation(
  run: AgentRun,
  invocation: SafeInvocation,
  parser: LineParser,
  allowPaths: string[] = [],
): AsyncIterable<RunEvent> {
  const signal = run.signal;
  if (signal?.aborted) {
    // Cancel arrived before spawn (e.g. during buildInvocation): do not spawn.
    yield {
      type: "result",
      ts: Date.now(),
      exitCode: null,
      summary: "Cancelled before the provider process was started.",
      durationMs: 0,
      timedOut: false,
      cancelled: true,
    };
    return;
  }

  const queue: RunEvent[] = [];
  let notify: (() => void) | null = null;
  let finished = false;

  const push = (...events: RunEvent[]) => {
    queue.push(...events);
    notify?.();
  };

  // A bad line must never take the run (or the daemon) down: the parser is
  // adapter code reading hostile input, so a throw only costs that line.
  let droppedNoted = false;
  const dropLine = () => {
    try {
      if (parser.dropped) {
        parser.dropped();
        return;
      }
    } catch {
      /* a parser that cannot even count the line falls back to the generic note */
    }
    if (!droppedNoted) {
      droppedNoted = true;
      push({
        type: "text",
        ts: Date.now(),
        stream: "stderr",
        text: "[mordomo] a line of provider output could not be read and was skipped.",
      });
    }
  };
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let parsed: RunEvent[] | null;
    try {
      parsed = parser.parseLine(line);
    } catch {
      dropLine();
      return;
    }
    if (parsed) push(...parsed);
    else push({ type: "text", ts: Date.now(), stream: "stdout", text: line });
  };

  // Chunks of the line being read; each chunk is scanned once for a newline,
  // so a long line costs time linear in its length. Past the cap the rest of
  // the line is discarded as it arrives, then counted once at its newline.
  let pending: string[] = [];
  let pendingChars = 0;
  let discarding = false;
  const handleStdout = (chunk: string) => {
    let start = 0;
    while (start <= chunk.length) {
      const newline = chunk.indexOf("\n", start);
      const end = newline === -1 ? chunk.length : newline;
      if (!discarding) {
        pendingChars += end - start;
        if (pendingChars > MAX_LINE_CHARS) {
          discarding = true;
          pending = [];
        } else if (end > start) pending.push(chunk.slice(start, end));
      }
      if (newline === -1) return;
      if (discarding) dropLine();
      else handleLine(pending.join(""));
      pending = [];
      pendingChars = 0;
      discarding = false;
      start = newline + 1;
    }
  };
  /** The last line may end without a newline. */
  const flushStdout = () => {
    if (pendingChars > 0 || discarding) handleStdout("\n");
  };

  const handle = safeSpawn(invocation.executable, invocation.args, {
    cwd: run.cwd,
    env: invocation.env,
    ...(run.dropEnv ? { dropEnv: run.dropEnv } : {}),
    timeoutMs: run.timeoutMs,
    allowPaths,
    stdin: invocation.stdin,
    onStdout: handleStdout,
    onStderr: (chunk) => {
      const text = chunk.trimEnd();
      if (text) push({ type: "text", ts: Date.now(), stream: "stderr", text });
    },
  });

  let cancelRequested = false;
  const onAbort = () => {
    cancelRequested = true;
    const reason = signal?.reason as { graceMs?: number } | undefined;
    handle.cancel("cancelled", typeof reason?.graceMs === "number" ? reason.graceMs : undefined);
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  push({ type: "started", ts: Date.now(), pid: handle.child.pid ?? null });

  const done = handle.result
    .then((res) => {
      flushStdout();
      try {
        const closing = parser.finish?.();
        if (closing?.length) push(...closing);
      } catch {
        push({
          type: "text",
          ts: Date.now(),
          stream: "stderr",
          text: "[mordomo] the output parser failed while closing the run; the trace may be incomplete.",
        });
      }
      if (res.stdoutTruncated || res.stderrTruncated) {
        push({
          type: "text",
          ts: Date.now(),
          stream: "stderr",
          text: "[mordomo] captured output exceeded the in-memory cap; only the tail was kept for the summary.",
        });
      }
      push({
        type: "result",
        ts: Date.now(),
        exitCode: res.exitCode,
        summary: summaryOf(parser, res.stdout, res.stderr, res.exitCode),
        durationMs: res.durationMs,
        timedOut: res.timedOut,
        cancelled: cancelRequested && res.exitCode !== 0,
      });
    })
    .catch((err: Error) => {
      push({ type: "error", ts: Date.now(), message: err.message });
    })
    .finally(() => {
      finished = true;
      notify?.();
    });

  try {
    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
        continue;
      }
      yield queue.shift() as RunEvent;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!finished) {
      // Consumer abandoned the stream: never leave the child running.
      handle.cancel("consumer abandoned the event stream");
    }
    await done;
  }
}

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

  let lineBuffer = "";
  const handleStdout = (chunk: string) => {
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parser.parseLine(line);
      if (parsed) push(...parsed);
      else push({ type: "text", ts: Date.now(), stream: "stdout", text: line });
    }
  };

  const handle = safeSpawn(invocation.executable, invocation.args, {
    cwd: run.cwd,
    env: invocation.env,
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
    handle.cancel("cancelled");
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  push({ type: "started", ts: Date.now(), pid: handle.child.pid ?? null });

  const done = handle.result
    .then((res) => {
      if (lineBuffer.trim()) handleStdout("\n");
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
        summary: parser.summarize(res.stdout, res.stderr, res.exitCode),
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

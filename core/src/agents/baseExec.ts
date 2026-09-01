import type { AgentRun, RunEvent, SafeInvocation } from "./types.js";
import { safeSpawn, type SpawnHandle } from "../spawn/safeSpawn.js";

/**
 * Shared streaming execution used by all adapters: spawns the invocation,
 * feeds stdout lines to an adapter-specific parser and normalizes lifecycle
 * events. Registers the handle so cancel(runId) works from anywhere.
 */

const activeHandles = new Map<string, SpawnHandle>();

export function cancelRunProcess(runId: string): boolean {
  const handle = activeHandles.get(runId);
  if (!handle) return false;
  handle.cancel();
  return true;
}

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
  activeHandles.set(run.runId, handle);
  push({ type: "started", ts: Date.now(), pid: handle.child.pid ?? null });

  const done = handle.result
    .then((res) => {
      if (lineBuffer.trim()) handleStdout("\n");
      push({
        type: "result",
        ts: Date.now(),
        exitCode: res.exitCode,
        summary: parser.summarize(res.stdout, res.stderr, res.exitCode),
        durationMs: res.durationMs,
        timedOut: res.timedOut,
      });
    })
    .catch((err: Error) => {
      push({ type: "error", ts: Date.now(), message: err.message });
    })
    .finally(() => {
      finished = true;
      activeHandles.delete(run.runId);
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
    await done;
  }
}

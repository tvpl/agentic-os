import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Controlled child-process layer.
 * - argv arrays only; never a shell string, never `eval`.
 * - executable allowlist (basenames + optional pinned absolute paths).
 * - cwd must be provided explicitly by the caller (already containment-checked).
 * - timeout kills the whole process group.
 * - stdout/stderr are accumulated in memory only up to a bounded tail
 *   (`MAX_CAPTURED_BYTES` each); streaming callbacks still see every chunk.
 */

const BASE_ALLOWLIST = new Set(["claude", "cursor-agent", "codex", "node"]);

/** Tail of stdout/stderr kept in memory for `SpawnResult` (1 MiB each). */
export const MAX_CAPTURED_BYTES = 1024 * 1024;

/** Grace between SIGTERM and SIGKILL for cancel/timeout. */
const DEFAULT_KILL_GRACE_MS = 5000;

export class ExecutableNotAllowedError extends Error {
  constructor(exe: string) {
    super(`Executable is not on the allowlist: ${exe}`);
    this.name = "ExecutableNotAllowedError";
  }
}

export interface SpawnOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Extra absolute paths allowed (e.g. a pinned provider binary). */
  allowPaths?: string[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  stdin?: string;
}

export interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Captured stdout; only the last `MAX_CAPTURED_BYTES` when `stdoutTruncated`. */
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface SpawnHandle {
  child: ChildProcess;
  result: Promise<SpawnResult>;
  /** Kill the whole process group (SIGTERM, then SIGKILL after grace). */
  cancel: (reason?: string, graceMs?: number) => void;
  /** Send one signal to the whole process group, no grace. */
  kill: (signal: NodeJS.Signals) => void;
}

export function assertAllowed(executable: string, allowPaths: string[] = []): void {
  const base = path.basename(executable);
  if (BASE_ALLOWLIST.has(base)) return;
  if (allowPaths.some((p) => path.resolve(p) === path.resolve(executable))) return;
  throw new ExecutableNotAllowedError(executable);
}

/** Signal a process group by pid (falls back to the single process). */
export function killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false; /* already gone */
    }
  }
}

/** Bounded accumulator: keeps roughly the last `max` characters, amortized. */
class TailBuffer {
  private buf = "";
  truncated = false;
  constructor(private readonly max: number) {}
  push(chunk: string): void {
    this.buf += chunk;
    if (this.buf.length > this.max * 2) {
      this.buf = this.buf.slice(-this.max);
      this.truncated = true;
    }
  }
  value(): string {
    if (this.buf.length > this.max) {
      this.truncated = true;
      this.buf = this.buf.slice(-this.max);
    }
    return this.buf;
  }
}

export function safeSpawn(executable: string, args: string[], opts: SpawnOptions): SpawnHandle {
  assertAllowed(executable, opts.allowPaths);
  const started = Date.now();
  const child = spawn(executable, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32", // own process group → group kill works
    shell: false,
    windowsHide: true,
  });

  const stdout = new TailBuffer(MAX_CAPTURED_BYTES);
  const stderr = new TailBuffer(MAX_CAPTURED_BYTES);
  let timedOut = false;
  let settled = false;
  const pendingKills = new Set<NodeJS.Timeout>();

  const killTree = (signal: NodeJS.Signals) => {
    if (child.pid == null || settled) return;
    killProcessGroup(child.pid, signal);
  };

  const scheduleKill = (signal: NodeJS.Signals, delayMs: number) => {
    const t = setTimeout(() => {
      pendingKills.delete(t);
      killTree(signal);
    }, delayMs);
    t.unref();
    pendingKills.add(t);
  };

  let timeout: NodeJS.Timeout | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      scheduleKill("SIGKILL", DEFAULT_KILL_GRACE_MS);
    }, opts.timeoutMs);
    timeout.unref();
  }

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout.push(chunk);
    opts.onStdout?.(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr.push(chunk);
    opts.onStderr?.(chunk);
  });

  if (opts.stdin != null) {
    // The child may exit before reading stdin (EPIPE); that is not our error.
    child.stdin?.on("error", () => undefined);
    child.stdin?.write(opts.stdin);
  }
  child.stdin?.end();

  const settle = () => {
    settled = true;
    if (timeout) clearTimeout(timeout);
    for (const t of pendingKills) clearTimeout(t);
    pendingKills.clear();
  };

  const result = new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (err) => {
      if (settled) return;
      settle();
      reject(err);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settle();
      resolve({
        exitCode,
        signal,
        stdout: stdout.value(),
        stderr: stderr.value(),
        timedOut,
        durationMs: Date.now() - started,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      });
    });
  });

  return {
    child,
    result,
    cancel: (_reason?: string, graceMs = DEFAULT_KILL_GRACE_MS) => {
      killTree("SIGTERM");
      scheduleKill("SIGKILL", graceMs);
    },
    kill: (signal) => killTree(signal),
  };
}

/** Convenience for short, non-streamed probes (--version, --help). */
export async function probe(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 15_000,
): Promise<SpawnResult> {
  const handle = safeSpawn(executable, args, { cwd, timeoutMs });
  return handle.result;
}

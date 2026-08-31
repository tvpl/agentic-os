import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Controlled child-process layer.
 * - argv arrays only; never a shell string, never `eval`.
 * - executable allowlist (basenames + optional pinned absolute paths).
 * - cwd must be provided explicitly by the caller (already containment-checked).
 * - timeout kills the whole process group.
 */

const BASE_ALLOWLIST = new Set(["claude", "cursor-agent", "codex", "node"]);

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
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface SpawnHandle {
  child: ChildProcess;
  result: Promise<SpawnResult>;
  /** Kill the whole process group (SIGTERM, then SIGKILL after grace). */
  cancel: (reason?: string) => void;
}

export function assertAllowed(executable: string, allowPaths: string[] = []): void {
  const base = path.basename(executable);
  if (BASE_ALLOWLIST.has(base)) return;
  if (allowPaths.some((p) => path.resolve(p) === path.resolve(executable))) return;
  throw new ExecutableNotAllowedError(executable);
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

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  const killTree = (signal: NodeJS.Signals) => {
    if (child.pid == null) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };

  let timeout: NodeJS.Timeout | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5000).unref();
    }, opts.timeoutMs);
    timeout.unref();
  }

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    opts.onStdout?.(chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    opts.onStderr?.(chunk);
  });

  if (opts.stdin != null) {
    child.stdin?.write(opts.stdin);
  }
  child.stdin?.end();

  const result = new Promise<SpawnResult>((resolve, reject) => {
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode, signal, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });

  return {
    child,
    result,
    cancel: () => {
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5000).unref();
    },
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

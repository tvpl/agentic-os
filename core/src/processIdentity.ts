import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Who a process IS, not just which number it has. A pid is handed out again once its process is gone, so a file
 * that remembers "pid 4242 owns this" cannot tell the owner from whatever program got 4242 later. The start of a
 * process does not repeat: `processStartMarker` returns an opaque string that is equal for the same process every
 * time it is read and differs for another process that reuses the pid (and for the same pid after a reboot).
 *
 *  - Linux:        `linux:<boot_id>:<starttime>`  from procfs. `starttime` is in clock ticks since boot, which no
 *                  clock adjustment moves; `boot_id` makes it unique across boots. (`ps` derives the start from
 *                  the wall clock, which a clock step moves, so Linux never uses it.)
 *  - macOS / BSD:  `ps:<epoch seconds>`  from `ps -o lstart=` read in UTC (a start time the kernel stores).
 *  - Windows:      `win:<ticks>`  the process creation time, from PowerShell.
 *
 * `null` when the platform gives no answer (no procfs, no `ps`, a process that is gone): the caller then knows
 * only the pid, and must not treat "cannot tell" as "different".
 */

/** The reads a marker needs, so each platform's parsing can be proven without that platform. */
export interface ProbeIo {
  platform: NodeJS.Platform;
  /** The text of a file, or null when it cannot be read. */
  readText(file: string): string | null;
  /** The trimmed stdout of the first candidate command that runs and exits 0, or null. */
  run(candidates: string[], args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): string | null;
}

export const realProbeIo: ProbeIo = {
  platform: process.platform,
  readText(file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  run(candidates, args, env, timeoutMs) {
    for (const command of candidates) {
      try {
        const result = spawnSync(command, args, {
          encoding: "utf8",
          env,
          timeout: timeoutMs,
          windowsHide: true,
        });
        if (result.error || result.status !== 0) continue;
        const text = result.stdout.trim();
        if (text.length > 0) return text;
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  },
};

// Absolute paths only: a program found through PATH is whatever the caller's PATH says, and this runs in the
// middle of deciding who owns the home.
const PS_CANDIDATES = ["/bin/ps", "/usr/bin/ps"];
const POWERSHELL_CANDIDATES = [
  path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  ),
];

export function processStartMarker(pid: number, io: ProbeIo = realProbeIo): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (io.platform === "linux") return linuxMarker(pid, io);
  if (io.platform === "win32") return windowsMarker(pid, io);
  return psMarker(pid, io);
}

function linuxMarker(pid: number, io: ProbeIo): string | null {
  const stat = io.readText(`/proc/${pid}/stat`);
  const boot = io.readText("/proc/sys/kernel/random/boot_id")?.trim();
  if (!stat || !boot) return null;
  // `pid (command) state ppid …`: the command may hold spaces and parentheses, so the fields start after the
  // LAST `)`. They begin at field 3 (state); starttime is field 22.
  const fields = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  const starttime = fields[22 - 3];
  return starttime !== undefined && /^\d+$/.test(starttime) ? `linux:${boot}:${starttime}` : null;
}

function psMarker(pid: number, io: ProbeIo): string | null {
  const text = io.run(
    PS_CANDIDATES,
    ["-o", "lstart=", "-p", String(pid)],
    { ...process.env, TZ: "UTC", LC_ALL: "C" },
    2000,
  );
  if (text === null) return null;
  const ms = Date.parse(`${text} UTC`);
  return Number.isNaN(ms) ? null : `ps:${Math.floor(ms / 1000)}`;
}

function windowsMarker(pid: number, io: ProbeIo): string | null {
  const text = io.run(
    POWERSHELL_CANDIDATES,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
    ],
    process.env,
    10_000,
  );
  return text !== null && /^\d+$/.test(text) ? `win:${text}` : null;
}

/** Is a process with this pid running? (`EPERM` means it is, and belongs to someone else.) */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Other MordomoOS service processes and stale builds.
 *
 * Two things go wrong on a machine that keeps a MordomoOS around: a rebuilt
 * dist while the old process keeps serving it, and a second `start
 * --foreground` (from a restart, a login service and a double-click) that
 * loses the race for the port and lingers. This module answers both
 * questions without holding state: which sibling service processes exist,
 * and is the build on disk newer than the one that is running. The pure
 * parsers are exported for tests; the process-list and kill helpers touch
 * the OS.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { cliEntry, uiDistCandidates } from "./entry.js";

export interface ServiceProcess {
  pid: number;
  command: string;
}

/** Does this command line look like a MordomoOS service (`… cli.js start --foreground`, or a packaged bundle)? */
export function isServiceCommand(command: string): boolean {
  // The entry file must be given as a path (a slash or backslash before it)
  // and be followed by the `start` verb: `… /dist/cli.js start --foreground`,
  // `… \\lib\\mordomo.mjs start`. A `grep cli.js start` never matches.
  return /[\\/][^\s]*?(cli\.js|mordomo(\.mjs|\.cjs|\.js)?)\s+start\b/.test(command);
}

/** Parse `ps -axo pid=,command=` (or any "<pid> <command>" lines) into service processes. */
export function parseProcessList(text: string): ServiceProcess[] {
  const out: ServiceProcess[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(raw);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = m[2]!.trim();
    if (Number.isInteger(pid) && pid > 0 && isServiceCommand(command)) out.push({ pid, command });
  }
  return out;
}

const PS = ["/bin/ps", "/usr/bin/ps", "ps"];
const POWERSHELL = [
  path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  ),
  "powershell.exe",
];

function firstOutput(candidates: string[], args: string[], timeout: number): string | null {
  for (const bin of candidates) {
    try {
      const res = spawnSync(bin, args, { encoding: "utf8", timeout, windowsHide: true });
      if (res.error || res.status !== 0) continue;
      return res.stdout;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Does `command` run the same entry file as `entry`? Two homes or checkouts on
 * one machine (a packaged app next to a source tree, the e2e server next to
 * the real service) are not each other's leftovers; only processes of the
 * same install are.
 */
export function sameInstall(command: string, entry: string): boolean {
  const norm = (v: string) => v.replace(/\\/g, "/").toLowerCase();
  return norm(command).includes(norm(entry));
}

/** Same as `firstOutput`, without blocking the event loop (request handlers use this). */
function firstOutputAsync(candidates: string[], args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    const tryAt = (i: number) => {
      if (i >= candidates.length) return resolve(null);
      execFile(candidates[i]!, args, { encoding: "utf8", timeout, windowsHide: true }, (err, stdout) => {
        if (err) return tryAt(i + 1);
        resolve(stdout);
      });
    };
    tryAt(0);
  });
}

const PS_ARGS = ["-axo", "pid=,command="];
const PS_WIN = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
];
// `-nP`: no DNS / service-name resolution, which is what makes lsof slow.
const LSOF = ["/usr/sbin/lsof", "/usr/bin/lsof", "lsof"];
const LSOF_LISTEN = ["-nP", "-iTCP", "-sTCP:LISTEN", "-t"];
const LISTEN_WIN = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue).OwningProcess",
];

export function parsePidList(text: string): Set<number> {
  const out = new Set<number>();
  for (const tok of text.split(/\s+/)) {
    const pid = Number(tok);
    if (Number.isInteger(pid) && pid > 0) out.add(pid);
  }
  return out;
}

export interface InstanceSnapshot {
  processes: ServiceProcess[];
  listening: Set<number>;
  at: number;
}

let snapshotCache: { at: number; value: Promise<InstanceSnapshot> } | null = null;
const SNAPSHOT_TTL_MS = 10_000;

/**
 * Process list + listening pids, gathered off the event loop and cached for
 * 10 s: the UI polls `/api/system/info`, and a `ps`/`lsof` per request must
 * never stall the server.
 */
export function instanceSnapshot(
  exceptPid = process.pid,
  ttlMs = SNAPSHOT_TTL_MS,
): Promise<InstanceSnapshot> {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.at < ttlMs) return snapshotCache.value;
  const value = (async () => {
    const win = process.platform === "win32";
    const [psText, listenText] = await Promise.all([
      win ? firstOutputAsync(POWERSHELL, PS_WIN, 10_000) : firstOutputAsync(PS, PS_ARGS, 3000),
      win ? firstOutputAsync(POWERSHELL, LISTEN_WIN, 10_000) : firstOutputAsync(LSOF, LSOF_LISTEN, 3000),
    ]);
    return {
      processes: parseProcessList(psText ?? "").filter((p) => p.pid !== exceptPid),
      listening: parsePidList(listenText ?? ""),
      at: Date.now(),
    };
  })();
  snapshotCache = { at: now, value };
  return value;
}

/** Drop the cached snapshot (after terminating processes, so the next read is fresh). */
export function invalidateInstanceSnapshot(): void {
  snapshotCache = null;
}

/** Every MordomoOS service process on this machine (any checkout or package), excluding `exceptPid`. Blocking: CLI use. */
export function listServiceProcesses(exceptPid = process.pid): ServiceProcess[] {
  const text =
    process.platform === "win32" ? firstOutput(POWERSHELL, PS_WIN, 10_000) : firstOutput(PS, PS_ARGS, 3000);
  if (!text) return [];
  return parseProcessList(text).filter((p) => p.pid !== exceptPid);
}

/**
 * Sibling services that are not the one a valid pidfile points at: leftovers
 * of a lost port race or a restart. `ownerPid` is the pidfile owner (null when
 * there is none), which is never reported as an orphan.
 */
export function orphanProcesses(
  all: ServiceProcess[],
  ownerPid: number | null,
  self = process.pid,
  entry: string | undefined = undefined,
  listening: ReadonlySet<number> = listeningPids(),
): ServiceProcess[] {
  const entryPath = entry ?? cliEntry();
  // A process that is listening on some port is a live server (another home
  // sharing this install, e.g. the e2e server next to the real one): not a leftover.
  return all.filter(
    (p) => p.pid !== self && p.pid !== ownerPid && sameInstall(p.command, entryPath) && !listening.has(p.pid),
  );
}

/** Pids of every process with a listening TCP socket (macOS/Linux via lsof, Windows via Get-NetTCPConnection). Blocking: CLI use. */
export function listeningPids(): Set<number> {
  const text =
    process.platform === "win32"
      ? firstOutput(POWERSHELL, LISTEN_WIN, 10_000)
      : firstOutput(LSOF, LSOF_LISTEN, 3000);
  return parsePidList(text ?? "");
}

/** Pid of the process listening on `port` (macOS/Linux via lsof, Windows via Get-NetTCPConnection), or null. */
export function portHolder(port: number): number | null {
  let text: string | null;
  if (process.platform === "win32") {
    text = firstOutput(
      POWERSHELL,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
      ],
      10_000,
    );
  } else {
    text = firstOutput(LSOF, ["-nP", "-iTCP:" + port, "-sTCP:LISTEN", "-t"], 3000);
  }
  const pid = Number((text ?? "").trim().split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid ? pid : null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop each process: SIGTERM first, then SIGKILL for whatever is still alive
 * after `graceMs` (an older build can hang in its own shutdown waiting on
 * open connections). Returns the pids that were signalled. Never throws.
 */
export async function terminate(processes: ServiceProcess[], graceMs = 4000): Promise<number[]> {
  const signalled: number[] = [];
  for (const p of processes) {
    try {
      process.kill(p.pid, "SIGTERM");
      signalled.push(p.pid);
    } catch {
      /* already gone or not ours */
    }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && signalled.some(alive)) await new Promise((r) => setTimeout(r, 200));
  for (const pid of signalled) {
    if (!alive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone in between */
    }
  }
  return signalled;
}

/** Newest mtime among the files that make up the build: the API entry and the UI index. */
export function installedBuildTime(): number {
  let latest = 0;
  const files = [cliEntry(), ...uiDistCandidates().map((d) => path.join(d, "index.html"))];
  for (const f of files) {
    try {
      latest = Math.max(latest, fs.statSync(f).mtimeMs);
    } catch {
      /* absent in a dev/test tree */
    }
  }
  return latest;
}

export interface BuildStatus {
  /** Epoch ms of the newest build file on disk (0 when unknown). */
  installedAt: number;
  /** When this process started. */
  startedAt: number;
  /** The files on disk are newer than the running process: a restart would pick up a newer build. */
  stale: boolean;
}

/** Pure: a build is stale when the installed files postdate the process start (2 s tolerance for the write itself). */
export function buildStatus(installedAt: number, startedAt: number, toleranceMs = 2000): BuildStatus {
  return { installedAt, startedAt, stale: installedAt > 0 && installedAt > startedAt + toleranceMs };
}

export interface ProbedServer {
  name: string;
  version: string;
  /** Build files newer than the process (reported by the server), or absent on older servers. */
  stale?: boolean;
  /** When the answering server's build files were written (0/absent when unknown). */
  installedAt?: number;
  entry?: string;
}

/**
 * Is the server that answers on the port older than the build this CLI ships
 * with? True when it reports its own files as stale, or when its build files
 * are older than ours (a packaged app launched over a checkout, or the
 * reverse). Pure over the probe result so it can be unit-tested.
 */
export function isOlderService(probe: ProbedServer, ourInstalledAt: number, toleranceMs = 2000): boolean {
  if (probe.stale) return true;
  if (typeof probe.installedAt === "number" && probe.installedAt > 0 && ourInstalledAt > 0)
    return ourInstalledAt > probe.installedAt + toleranceMs;
  return false;
}

/**
 * Is a MordomoOS answering on `port`? Used when there is no pidfile we own:
 * a server started by another checkout, by hand, or whose pidfile was removed.
 * `/api/v1/meta` needs no token and identifies the app by name and version; a
 * service older than API v1 answers it `404`, so the unversioned path is tried next.
 */
export async function probeServer(port: number, timeoutMs = 1500): Promise<ProbedServer | null> {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    let res = await fetch(`http://127.0.0.1:${port}/api/v1/meta`, { signal });
    if (res.status === 404) {
      await res.body?.cancel();
      res = await fetch(`http://127.0.0.1:${port}/api/meta`, { signal });
    }
    if (!res.ok) return null;
    const meta = (await res.json()) as {
      name?: unknown;
      version?: unknown;
      entry?: unknown;
      build?: { stale?: unknown; installedAt?: unknown };
    };
    if (typeof meta.version !== "string") return null;
    return {
      name: typeof meta.name === "string" ? meta.name : "MordomoOS",
      version: meta.version,
      stale: typeof meta.build?.stale === "boolean" ? meta.build.stale : undefined,
      installedAt: typeof meta.build?.installedAt === "number" ? meta.build.installedAt : undefined,
      entry: typeof meta.entry === "string" ? meta.entry : undefined,
    };
  } catch {
    return null;
  }
}

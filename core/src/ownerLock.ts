import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/db.js";
import { pidAlive, processStartMarker } from "./processIdentity.js";
import { realpathLenient } from "./security/paths.js";
import { EngineLockedError } from "./errors.js";

export { EngineLockedError };

/**
 * Where the registry lives: on `globalThis`, under a symbol of the global registry, so every copy of this package
 * loaded in the process (two versions in `node_modules`, a bundle and the package itself) reads and writes the same
 * one. Two copies with a registry each would each see the other's lock as stale (the pid is this process's, the token
 * is not in their map) and take it from under a running engine.
 */
const HELD_LOCKS = Symbol.for("@mordomo/core/owner-lock/held");

/**
 * The owner locks this PROCESS holds, by the identity of the lock file on disk (`dev:ino`, so another spelling of the
 * home - a link, another case on a file system that ignores it, a folder renamed while the engine runs - is the same
 * lock) -> the token it wrote. Process scoped on purpose: the question it answers - "is that lock held by a live engine of this very process?" - can only
 * be asked by someone who knows every engine of the process, and the lock file alone cannot say (it carries the same
 * pid for the engine that holds it and for one that died without releasing). A lock whose token is here is held; one
 * with this process's pid and a token that is not here is stale, as `lockIsStale` says.
 */
function heldByThisProcess(): Map<string, string> {
  const host = globalThis as { [HELD_LOCKS]?: Map<string, string> };
  return (host[HELD_LOCKS] ??= new Map<string, string>());
}

/** The identity of a file on disk, whatever name it is reached by; `null` when it cannot be read. */
function fileIdentity(file: string): string | null {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

/** The names a lock file is known by in the registry: its identity, and the real path when the identity is unreadable. */
function lockKeys(file: string): string[] {
  const keys = [fileIdentity(file)];
  keys.push(`path:${path.join(realpathLenient(path.dirname(file)), path.basename(file))}`);
  return keys.filter((key): key is string => key !== null);
}

/** A temporary file of `acquire()`: `<lock>.<pid>.<token>.tmp` (an older release wrote `<lock>.<pid>.<ms>.tmp`). */
const TEMP_NAME = /\.(\d+)\.(?:[0-9a-f]{32}|\d+)\.tmp$/;

/**
 * What `config/run/engine.lock` holds. `token` is new on every acquisition and is what a release checks; `procStart`
 * is the owner's `processStartMarker`, which is what tells the owner from a program that got its pid later. A lock
 * written before `v` 2 has only `pid` and `startedAt`.
 */
export interface LockRecord {
  v?: number;
  pid: number;
  startedAt?: number;
  token?: string;
  procStart?: string | null;
}

/** The two questions about a pid the verdict needs; injectable so every state can be proven. */
export interface ProcessProbe {
  alive(pid: number): boolean;
  startMarker(pid: number): string | null;
}

export const realProbe: ProcessProbe = { alive: pidAlive, startMarker: (pid) => processStartMarker(pid) };

/**
 * Is a lock that exists still held? Only what can be PROVED stale is: nothing readable, this very process (an
 * engine of ours that never released), a pid that is gone, or a pid whose process started at another moment than
 * the owner recorded. Where the question cannot be answered (a lock from before `procStart`, or a platform that
 * will not say when the pid started) the answer is "held": the cost of a wrong "stale" is two owners.
 */
export function lockIsStale(record: LockRecord | null, probe: ProcessProbe, selfPid: number): boolean {
  if (record === null || record.pid === selfPid) return true;
  if (!probe.alive(record.pid)) return true;
  if (typeof record.procStart !== "string") return false;
  const now = probe.startMarker(record.pid);
  return now !== null && now !== record.procStart;
}

/** The lock record in `file`, or null when it is missing or not one. */
export function readLock(file: string): LockRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> | null;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const { pid } = raw;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    return {
      ...(typeof raw.v === "number" ? { v: raw.v } : {}),
      pid,
      ...(typeof raw.startedAt === "number" ? { startedAt: raw.startedAt } : {}),
      ...(typeof raw.token === "string" ? { token: raw.token } : {}),
      ...(raw.procStart === null || typeof raw.procStart === "string" ? { procStart: raw.procStart } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The owner lock of a home: at most one process holds it, and a lock whose owner is gone is replaced without ever
 * producing two owners.
 *
 * Taking it is a critical section: read the lock, judge it, remove it if stale, create ours. Two processes doing
 * that at once would both judge the same stale lock, and the slower one would delete the lock the faster one had
 * just made. The section therefore runs inside `BEGIN IMMEDIATE` on the home's own database, so SQLite lets one
 * process in at a time (the others wait, up to the busy timeout) and releases the section by itself when a
 * process dies in it. No second file stands in for a lock that can itself be left behind.
 *
 * The lock file appears in one step: a temporary file already holding the full record is hard-linked into place,
 * which fails if the name exists, so no reader ever sees a lock without its owner.
 */
export class OwnerLock {
  private token: string | null = null;
  private key: string | null = null;

  constructor(
    private readonly file: string,
    private readonly db: Db,
    private readonly probe: ProcessProbe = realProbe,
  ) {}

  /** Take the lock, or throw `EngineLockedError` — having changed nothing — when another live process holds it. */
  acquire(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.removeOrphanTemps();
    const token = crypto.randomBytes(16).toString("hex");
    const record: LockRecord = {
      v: 2,
      pid: process.pid,
      startedAt: Date.now(),
      token,
      procStart: this.probe.startMarker(process.pid),
    };
    const temp = `${this.file}.${process.pid}.${token}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    try {
      this.db
        .transaction(() => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              fs.linkSync(temp, this.file);
              return;
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
            }
            const holder = readLock(this.file);
            if (
              holder?.token !== undefined &&
              lockKeys(this.file).some((key) => heldByThisProcess().get(key) === holder.token)
            ) {
              throw new EngineLockedError(
                process.pid,
                `Another MordomoOS engine of this process (pid ${process.pid}) owns this home; call stop() or close() on it first (an engine nobody holds a reference to any more can only be ended by ending the process).`,
              );
            }
            if (!lockIsStale(holder, this.probe, process.pid))
              throw new EngineLockedError(holder?.pid ?? null);
            try {
              fs.rmSync(this.file, { force: true });
            } catch (err) {
              // Not a file (a folder), or not ours to remove: the home cannot be owned until someone looks.
              throw new EngineLockedError(
                null,
                `${this.file} is in the way and cannot be removed (${(err as NodeJS.ErrnoException).code}); ` +
                  "remove it by hand if no MordomoOS engine is running.",
              );
            }
          }
          throw new EngineLockedError(readLock(this.file)?.pid ?? null);
        })
        .immediate();
      this.token = token;
      this.key = lockKeys(this.file)[0]!;
      heldByThisProcess().set(this.key, token);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  /** A process killed between writing its temporary file and publishing it leaves the file: sweep those of dead ones. */
  private removeOrphanTemps(): void {
    const dir = path.dirname(this.file);
    const base = path.basename(this.file);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const owner = name.startsWith(`${base}.`) ? TEMP_NAME.exec(name) : null;
      if (owner && Number(owner[1]) !== process.pid && !this.probe.alive(Number(owner[1]))) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  }

  /** Remove the lock file, but only if it is the one this object made: a lock someone else holds stays. */
  release(): void {
    if (this.token === null) return;
    const mine = this.token;
    this.token = null;
    if (this.key !== null && heldByThisProcess().get(this.key) === mine) heldByThisProcess().delete(this.key);
    this.key = null;
    if (readLock(this.file)?.token === mine) fs.rmSync(this.file, { force: true });
  }
}

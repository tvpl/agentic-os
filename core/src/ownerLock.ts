import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/db.js";
import { pidAlive, processStartMarker } from "./processIdentity.js";

/** A temporary file of `acquire()`: `<lock>.<pid>.<token>.tmp` (an older release wrote `<lock>.<pid>.<ms>.tmp`). */
const TEMP_NAME = /\.(\d+)\.(?:[0-9a-f]{32}|\d+)\.tmp$/;

/** `start()` found another live process owning this home. */
export class EngineLockedError extends Error {
  readonly code = "engine_locked";
  constructor(
    readonly holderPid: number | null,
    detail?: string,
  ) {
    super(
      detail ??
        (holderPid === null
          ? "Another MordomoOS engine owns this home."
          : `Another MordomoOS engine (pid ${holderPid}) owns this home.`),
    );
    this.name = "EngineLockedError";
  }
}

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
    if (readLock(this.file)?.token === mine) fs.rmSync(this.file, { force: true });
  }
}

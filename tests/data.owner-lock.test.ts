import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EngineLockedError,
  ObjectiveStore,
  OwnerLock,
  ProviderRegistry,
  RunManager,
  SettingsStore,
  createEngine,
  ensureDirs,
  openDb,
  processStartMarker,
  readLock,
  resolvePaths,
  type LockRecord,
  type MordomoEngine,
  type ProbeIo,
} from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { bundleChild, runChild, src } from "./helpers/childBundle.js";

/**
 * dados-v2, slice S2 (.specs/features/dados-v2): the owner lock tells its owner from a program that was given the
 * same pid later, takes a stale lock over without ever producing two owners, and releases only its own.
 */

const DEAD_PID = 2 ** 30;
const homes: string[] = [];
const engines: MordomoEngine[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop(500).catch(() => undefined);
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-lock-"));
  homes.push(home);
  ensureDirs(resolvePaths(home));
  return home;
}

function engineFor(home: string): MordomoEngine {
  const engine = createEngine({
    home,
    providers: new ProviderRegistry().register(claudeManifest, createClaudeAdapter),
    seedDir: null,
  });
  engines.push(engine);
  return engine;
}

const lockFile = (home: string) => path.join(resolvePaths(home).run, "engine.lock");
const writeLock = (home: string, record: Partial<LockRecord> & { pid: number }) =>
  fs.writeFileSync(lockFile(home), JSON.stringify(record));

async function liveChild(): Promise<ChildProcess & { pid: number }> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(child);
  await new Promise((resolve) => child.once("spawn", resolve));
  return child as ChildProcess & { pid: number };
}

/** A dispatched step whose run is queued: `start()` by the owner turns it `pending`. */
function seed(home: string): string {
  const paths = resolvePaths(home);
  const { db } = openDb(paths);
  const store = new SettingsStore(paths);
  const runs = new RunManager(
    db,
    paths,
    () => store.load(),
    () => {
      throw new Error("no adapter while seeding");
    },
    { pruneOnBoot: false },
  );
  const objectives = new ObjectiveStore(db, paths);
  const objective = objectives.create({
    title: "Seeded",
    steps: [{ title: "Step", request: { version: 1, kind: "prompt", prompt: "do it", mode: "read_only" } }],
  });
  const run = runs.create({
    origin: "manual",
    provider: "claude",
    prompt: "do it",
    cwd: home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 10_000,
    profile: "read_only",
  });
  const stepId = objective.steps[0]!.id;
  objectives.markDispatched(stepId, run.id);
  db.close();
  return stepId;
}

const stepStatus = (engine: MordomoEngine, stepId: string) =>
  (engine.db.prepare("SELECT status FROM objective_steps WHERE id = ?").get(stepId) as { status: string })
    .status;

const MARKER_KNOWN = processStartMarker(process.pid) !== null;

describe("S2 the lock knows its owner", () => {
  it("C9 the lock records the identity of its owner", () => {
    const home = tempHome();
    engineFor(home).start();
    const record = JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as Record<string, unknown>;
    expect(record).toMatchObject({ v: 2, pid: process.pid, procStart: processStartMarker(process.pid) });
    expect(typeof record.startedAt).toBe("number");
    expect(record.token).toMatch(/^[0-9a-f]{32}$/);

    const other = tempHome();
    engineFor(other).start();
    expect(JSON.parse(fs.readFileSync(lockFile(other), "utf8")).token).not.toBe(record.token);
  });

  it.skipIf(!MARKER_KNOWN)("C10 a recycled pid is taken over", async () => {
    const home = tempHome();
    const stepId = seed(home);
    const child = await liveChild();
    // The owner that wrote this lock is long gone; the pid now belongs to `child`, which started at another moment.
    writeLock(home, {
      v: 2,
      pid: child.pid,
      startedAt: 1,
      token: "0".repeat(32),
      procStart: `${processStartMarker(child.pid)}-another-process`,
    });
    const engine = engineFor(home);
    engine.start();
    expect(readLock(lockFile(home))?.pid).toBe(process.pid);
    expect(stepStatus(engine, stepId)).toBe("pending");
  });

  it.skipIf(!MARKER_KNOWN)("C11 the real owner keeps the lock", async () => {
    const home = tempHome();
    const stepId = seed(home);
    const child = await liveChild();
    writeLock(home, {
      v: 2,
      pid: child.pid,
      startedAt: 1,
      token: "0".repeat(32),
      procStart: processStartMarker(child.pid),
    });
    const engine = engineFor(home);
    let thrown: unknown;
    try {
      engine.start();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EngineLockedError);
    expect((thrown as EngineLockedError).code).toBe("engine_locked");
    expect((thrown as EngineLockedError).holderPid).toBe(child.pid);
    expect(stepStatus(engine, stepId)).toBe("dispatched");
  });

  it("C12 an unreadable start is never proof of staleness", () => {
    const home = tempHome();
    const { db } = openDb(resolvePaths(home));
    try {
      writeLock(home, {
        v: 2,
        pid: process.pid + 1,
        startedAt: 1,
        token: "1".repeat(32),
        procStart: "linux:b:7",
      });
      const before = fs.readFileSync(lockFile(home), "utf8");
      const lock = new OwnerLock(lockFile(home), db, { alive: () => true, startMarker: () => null });
      expect(() => lock.acquire()).toThrow(EngineLockedError);
      expect(fs.readFileSync(lockFile(home), "utf8")).toBe(before);
    } finally {
      db.close();
    }
  });

  it("C13 a lock without procStart keeps the old rule", async () => {
    const home = tempHome();
    const child = await liveChild();
    writeLock(home, { pid: child.pid, startedAt: Date.now() });
    expect(() => engineFor(home).start()).toThrow(EngineLockedError);

    const stale = tempHome();
    writeLock(stale, { pid: DEAD_PID, startedAt: 1 });
    engineFor(stale).start();
    expect(readLock(lockFile(stale))?.pid).toBe(process.pid);
  });

  it("C14 processStartMarker reads each platform and fails to null", () => {
    const files = new Map<string, string>();
    const io = (platform: NodeJS.Platform, output: string | null = null): ProbeIo & { ran: unknown[] } => {
      const ran: unknown[] = [];
      return {
        platform,
        ran,
        readText: (file) => files.get(file) ?? null,
        run(candidates, args, env) {
          ran.push({ candidates, args, TZ: env.TZ, LC_ALL: env.LC_ALL });
          return output;
        },
      };
    };

    // Linux: the command name holds spaces and parentheses; starttime is field 22, counted after the last ")".
    files.set(
      "/proc/4242/stat",
      "4242 (a b) (c) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 12345 67 18446744073709551615",
    );
    files.set("/proc/sys/kernel/random/boot_id", "5b489814-1457-47da-bc32-379407a21ebb\n");
    expect(processStartMarker(4242, io("linux"))).toBe("linux:5b489814-1457-47da-bc32-379407a21ebb:987654");
    files.set("/proc/4242/stat", "4242 (x) S 1 2");
    expect(processStartMarker(4242, io("linux")), "too few fields").toBeNull();
    files.set("/proc/4242/stat", "4242 (x) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 abc 1");
    expect(processStartMarker(4242, io("linux")), "not a number").toBeNull();
    files.delete("/proc/4242/stat");
    expect(processStartMarker(4242, io("linux")), "no procfs entry").toBeNull();
    files.set("/proc/4242/stat", "4242 (x) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 5 1");
    files.delete("/proc/sys/kernel/random/boot_id");
    expect(processStartMarker(4242, io("linux")), "no boot id").toBeNull();

    // macOS / BSD: `ps -o lstart=` read in UTC.
    const mac = io("darwin", "Thu Oct  9 12:00:00 2026");
    expect(processStartMarker(77, mac)).toBe(`ps:${Date.UTC(2026, 9, 9, 12, 0, 0) / 1000}`);
    expect(mac.ran).toEqual([
      {
        candidates: ["/bin/ps", "/usr/bin/ps", "ps"],
        args: ["-o", "lstart=", "-p", "77"],
        TZ: "UTC",
        LC_ALL: "C",
      },
    ]);
    expect(processStartMarker(77, io("darwin", "not a date"))).toBeNull();
    expect(processStartMarker(77, io("darwin", null))).toBeNull();

    // Windows: the creation time in ticks, from PowerShell.
    const win = io("win32", "639000000000000000");
    expect(processStartMarker(88, win)).toBe("win:639000000000000000");
    expect(JSON.stringify(win.ran)).toContain("(Get-Process -Id 88).StartTime");
    expect(processStartMarker(88, io("win32", "Get-Process: Cannot find a process"))).toBeNull();
    expect(processStartMarker(88, io("win32", null))).toBeNull();

    // A read that throws is a read that failed.
    const throwing: ProbeIo = {
      platform: "linux",
      readText: () => null,
      run: () => {
        throw new Error("boom");
      },
    };
    expect(processStartMarker(4242, throwing)).toBeNull();
    expect(processStartMarker(-1, io("linux"))).toBeNull();
  });

  it("C15 stale takeover never produces two owners", async () => {
    const home = tempHome();
    const paths = resolvePaths(home);
    openDb(paths).db.close();
    const rounds = 30;
    const contenders = 4;
    const stale: LockRecord = { v: 2, pid: DEAD_PID, startedAt: 1, token: "0".repeat(32), procStart: "x" };
    for (let r = 0; r < rounds; r++)
      fs.writeFileSync(path.join(paths.run, `round-${r}.lock`), JSON.stringify(stale));
    const script = await bundleChild(
      "owner-lock-race",
      [
        `import { openDb } from ${src("core/src/db/db.ts")};`,
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { EngineLockedError, OwnerLock } from ${src("core/src/ownerLock.ts")};`,
        "const paths = resolvePaths(process.env.HOME_DIR);",
        "const { db } = openDb(paths);",
        "const start = Number(process.env.START_AT);",
        "const locks = [];",
        "const outcomes = [];",
        "for (let r = 0; r < Number(process.env.ROUNDS); r++) {",
        "  while (Date.now() < start + r * 120) { /* every contender enters the round together */ }",
        "  const lock = new OwnerLock(`${paths.run}/round-${r}.lock`, db);",
        "  try { lock.acquire(); locks.push(lock); outcomes.push('won'); }",
        "  catch (err) { outcomes.push(err instanceof EngineLockedError ? 'locked' : 'error:' + err.message); }",
        "}",
        "process.stdout.write(JSON.stringify({ pid: process.pid, outcomes }));",
        "db.close();",
      ].join("\n"),
    );
    const startAt = String(Date.now() + 1500);
    const results = await Promise.all(
      Array.from({ length: contenders }, () =>
        runChild(script, { HOME_DIR: home, START_AT: startAt, ROUNDS: String(rounds) }),
      ),
    );
    for (const r of results) expect(r.code, r.stderr).toBe(0);
    const reports = results.map((r) => JSON.parse(r.stdout) as { pid: number; outcomes: string[] });
    const tokens = new Set<string>();
    for (let r = 0; r < rounds; r++) {
      const winners = reports.filter((report) => report.outcomes[r] === "won");
      expect(winners.length, `round ${r}`).toBe(1);
      expect(reports.filter((report) => report.outcomes[r] === "locked").length, `round ${r}`).toBe(
        contenders - 1,
      );
      const record = readLock(path.join(paths.run, `round-${r}.lock`));
      expect(record?.pid, `round ${r}`).toBe(winners[0]!.pid);
      tokens.add(record!.token!);
    }
    expect(tokens.size).toBe(rounds);
  }, 90_000);

  it("C16 a killed owner is replaced", async () => {
    const home = tempHome();
    const paths = resolvePaths(home);
    const file = path.join(paths.run, "owned.lock");
    const script = await bundleChild(
      "owner-lock-hold",
      [
        `import { openDb } from ${src("core/src/db/db.ts")};`,
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { OwnerLock } from ${src("core/src/ownerLock.ts")};`,
        "const paths = resolvePaths(process.env.HOME_DIR);",
        "const { db } = openDb(paths);",
        "new OwnerLock(process.env.LOCK_FILE, db).acquire();",
        "process.stdout.write('held\\n');",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, HOME_DIR: home, LOCK_FILE: file },
      stdio: ["ignore", "pipe", "inherit"],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("exit", (code) => reject(new Error(`holder exited ${code}`)));
    });
    const before = readLock(file)!;
    expect(before.pid).toBe(child.pid);

    const { db } = openDb(paths);
    try {
      expect(() => new OwnerLock(file, db).acquire(), "alive").toThrow(EngineLockedError);
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
      new OwnerLock(file, db).acquire();
      const after = readLock(file)!;
      expect(after.pid).toBe(process.pid);
      expect(after.token).not.toBe(before.token);
    } finally {
      db.close();
    }
  }, 30_000);

  it("C17 release removes only its own lock", async () => {
    const mine = tempHome();
    const engine = engineFor(mine);
    engine.start();
    engine.close();
    expect(fs.existsSync(lockFile(mine))).toBe(false);

    const home = tempHome();
    const second = engineFor(home);
    second.start();
    // Another owner took the lock over (this engine was judged stale): closing must not delete theirs.
    const child = await liveChild();
    const theirs: LockRecord = {
      v: 2,
      pid: child.pid,
      startedAt: Date.now(),
      token: "f".repeat(32),
      procStart: processStartMarker(child.pid),
    };
    fs.writeFileSync(lockFile(home), JSON.stringify(theirs));
    second.close();
    expect(JSON.parse(fs.readFileSync(lockFile(home), "utf8"))).toEqual(theirs);
  });
});

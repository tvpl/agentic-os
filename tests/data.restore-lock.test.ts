import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RestoreInProgressError } from "@mordomo/core";
import {
  RestoreLock,
  RestoreLockError,
  SettingsSchema,
  SettingsStore,
  createBackup,
  inspectRestoreState,
  openDb,
  recoverInterruptedRestore,
  resolvePaths,
  restoreBackup,
  verifyBackup,
  type MordomoPaths,
} from "@mordomo/core/internal";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";
import { buildManifestAsync } from "../core/src/backupManifest.js";
import { bundleChild, runChild, src } from "./helpers/childBundle.js";

/**
 * dados-v2, round 3 (.specs/features/dados-v2): the restore lock is what keeps a backup, a restore, a recovery and
 * a starting engine from working on the files of the home at the same time. These are the proofs of what it
 * claims: shared and exclusive, held for the whole of a backup and until the database is open, the same home
 * under any spelling of its path, reentrancy refused, and a lock file that cannot be one said so.
 */

const POSIX = process.platform !== "win32";
const cleanups: Array<() => void> = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const stagingFolders = (paths: MordomoPaths) =>
  fs.readdirSync(paths.home).filter((n) => n.startsWith(".restore-"));
const lockFile = (paths: MordomoPaths) => path.join(paths.run, "restore.lock");
const mode = (file: string) => fs.statSync(file).mode & 0o777;

/** SHA-256 of every file the restore can change, by path under the home: the state a refusal must leave alone. */
function liveState(paths: MordomoPaths): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(paths.home, full)] = sha(full);
    }
  };
  for (const dir of [paths.skills, paths.memory, paths.routines, paths.connectors, paths.artifacts])
    walk(dir);
  for (const file of [paths.settingsFile, paths.uiPreferencesFile, paths.syncManifest, paths.dbFile]) {
    if (fs.existsSync(file)) out[path.relative(paths.home, file)] = sha(file);
  }
  return out;
}

/**
 * A home with something in ALL ELEVEN things a restore replaces (the four folders, artifacts, settings, ui
 * preferences, the sync manifest and the database, whose sidecars are the other two), a backup of it, and live
 * files that have moved on. `drop`: artifacts and the sync manifest are gone from the live home, so a restore
 * installs targets that were not there (`hadTarget: false`).
 */
async function fullFixture(drop: boolean) {
  const home = makeTempHome("mordomo-dados-lock-");
  cleanups.push(home.cleanup);
  const { paths } = home;
  write(path.join(paths.skills, "x", "SKILL.md"), "skill v1\n");
  write(path.join(paths.memory, "note.md"), "note v1\n");
  write(path.join(paths.routines, "r.json"), '{"id":"r"}');
  write(path.join(paths.connectors, "c.json"), '{"id":"c"}');
  write(path.join(paths.artifacts, "gen", "a.txt"), "artifact v1\n");
  write(paths.syncManifest, '{"v":1}');
  write(paths.uiPreferencesFile, '{"theme":"dark"}');
  new SettingsStore(paths).save(SettingsSchema.parse({ systemName: "Backed" }));
  const first = openDb(paths);
  first.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('marker', 'backup')").run();
  const backup = await createBackup(paths, first.db, { includeArtifacts: true });
  first.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('marker', 'current')").run();
  first.db.close();
  write(path.join(paths.skills, "x", "SKILL.md"), "skill CURRENT\n");
  write(path.join(paths.memory, "note.md"), "note CURRENT\n");
  write(path.join(paths.routines, "r.json"), '{"id":"CURRENT"}');
  write(path.join(paths.connectors, "c.json"), '{"id":"CURRENT"}');
  write(paths.uiPreferencesFile, '{"theme":"light"}');
  new SettingsStore(paths).save(SettingsSchema.parse({ systemName: "Current" }));
  if (drop) {
    fs.rmSync(paths.artifacts, { recursive: true, force: true });
    fs.rmSync(paths.syncManifest);
  } else {
    write(path.join(paths.artifacts, "gen", "a.txt"), "artifact CURRENT\n");
    write(paths.syncManifest, '{"v":2}');
  }
  return { paths, backup, home: paths.home };
}

/** A child that restores and dies by SIGKILL at the k-th rename inside a staging folder, or runs to the end. */
let killScript: Promise<string> | undefined;
function killer(): Promise<string> {
  killScript ??= bundleChild(
    "restore-killed-r3",
    [
      'import fs from "node:fs";',
      `import { resolvePaths } from ${src("core/src/paths.ts")};`,
      `import { restoreBackup } from ${src("core/src/backup.ts")};`,
      "const killAt = Number(process.env.KILL_AT);",
      "let renames = 0;",
      "const real = fs.renameSync.bind(fs);",
      "fs.renameSync = ((from, to) => {",
      '  if ((String(from).includes(".restore-") || String(to).includes(".restore-")) && !String(to).includes(".removing-")) {',
      '    renames++; if (renames === killAt) process.kill(process.pid, "SIGKILL");',
      "  }",
      "  return real(from, to);",
      "});",
      "restoreBackup(resolvePaths(process.env.HOME_DIR), process.env.BACKUP_NAME);",
      "process.stdout.write(String(renames));",
    ].join("\n"),
  );
  return killScript;
}

/** A child that holds the lock (`MODE`), for ever or for `RELEASE_AFTER_MS`. */
async function startHolder(
  home: string,
  options: { mode?: "shared" | "exclusive"; releaseAfterMs?: number } = {},
): Promise<ChildProcess & { pid: number }> {
  const script = await bundleChild(
    "restore-lock-holder-r3",
    [
      `import { RestoreLock } from ${src("core/src/restoreLock.ts")};`,
      `import { resolvePaths } from ${src("core/src/paths.ts")};`,
      "const lock = RestoreLock.acquire(resolvePaths(process.env.HOME_DIR), 0, process.env.MODE);",
      'process.stdout.write("held\\n");',
      "if (process.env.RELEASE_AFTER_MS) setTimeout(() => { lock.release(); process.exit(0); }, Number(process.env.RELEASE_AFTER_MS));",
      "else setInterval(() => { void lock; }, 1000);",
    ].join("\n"),
  );
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      HOME_DIR: home,
      MODE: options.mode ?? "exclusive",
      ...(options.releaseAfterMs ? { RELEASE_AFTER_MS: String(options.releaseAfterMs) } : {}),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`holder exited ${code}`)));
  });
  return child as ChildProcess & { pid: number };
}

/** Try to take the lock from ANOTHER process: "acquired", or "refused:<error name>". */
let probeScript: Promise<string> | undefined;
async function probe(
  home: string,
  lockMode: "shared" | "exclusive" = "exclusive",
  waitMs = 0,
): Promise<string> {
  probeScript ??= bundleChild(
    "restore-lock-probe-r3",
    [
      `import { RestoreLock } from ${src("core/src/restoreLock.ts")};`,
      `import { resolvePaths } from ${src("core/src/paths.ts")};`,
      "try {",
      "  const l = RestoreLock.acquire(resolvePaths(process.env.HOME_DIR), Number(process.env.WAIT), process.env.MODE);",
      '  process.stdout.write("acquired"); l.release();',
      '} catch (e) { process.stdout.write("refused:" + e.name); }',
    ].join("\n"),
  );
  const result = await runChild(await probeScript, { HOME_DIR: home, MODE: lockMode, WAIT: String(waitMs) });
  return result.stdout;
}

const exited = (child: ChildProcess) => new Promise((resolve) => child.once("exit", resolve));

describe("S4 the restore lock keeps the files of the home from being worked on twice", () => {
  it("C77 a backup holds the lock for the whole of it: a restore started half way waits or is refused, never sealed in", async () => {
    const { paths, backup, home } = await fullFixture(false);
    // The live state a backup should capture (all of it CURRENT), written to the database while it is closed.
    const slow = await bundleChild(
      "backup-slow-r3",
      [
        'import fs from "node:fs";',
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { openDb } from ${src("core/src/db/db.ts")};`,
        `import { createBackup } from ${src("core/src/backup.ts")};`,
        "const paths = resolvePaths(process.env.HOME_DIR);",
        "const { db } = openDb(paths);",
        "db.close();",
        "const real = fs.cpSync.bind(fs);",
        "let n = 0;",
        "fs.cpSync = ((from, to, options) => {",
        "  const done = real(from, to, options);",
        "  if (++n === 1) {",
        '    process.stdout.write("mid\\n");',
        "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.DELAY_MS));",
        "  }",
        "  return done;",
        "});",
        "const info = await createBackup(paths, db);",
        'process.stdout.write("BACKUP " + info.name + "\\n");',
      ].join("\n"),
    );
    const child = spawn(process.execPath, [slow], {
      env: { ...process.env, HOME_DIR: home, DELAY_MS: "1500" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    children.push(child);
    let log = "";
    child.stdout.on("data", (d: Buffer) => (log += d.toString()));
    await expect.poll(() => log.includes("mid"), { timeout: 30_000 }).toBe(true);

    // The backup is half copied (the skills in, the rest not): a restore now is refused...
    const before = liveState(paths);
    expect(() => restoreBackup(paths, backup.name, { waitMs: 0 })).toThrow(RestoreInProgressError);
    expect(liveState(paths)).toEqual(before);
    expect(stagingFolders(paths)).toEqual([]);
    // ...and one that is willing to wait does, until the backup is done, and only then replaces the files.
    const started = Date.now();
    restoreBackup(paths, backup.name);
    expect(Date.now() - started, "the restore waited for the backup").toBeGreaterThan(500);
    await exited(child);

    const name = /BACKUP (\S+)/.exec(log)?.[1];
    expect(name, log).toBeDefined();
    const sealed = path.join(paths.backups, name!);
    // All before the restore: every file of the backup is the CURRENT one, none is the restored (v1) one.
    expect(fs.readFileSync(path.join(sealed, "skills", "x", "SKILL.md"), "utf8")).toBe("skill CURRENT\n");
    expect(fs.readFileSync(path.join(sealed, "memory", "note.md"), "utf8")).toBe("note CURRENT\n");
    expect(fs.readFileSync(path.join(sealed, "routines", "r.json"), "utf8")).toBe('{"id":"CURRENT"}');
    await verifyBackup(paths, name!);
    expect(fs.readFileSync(path.join(paths.memory, "note.md"), "utf8")).toBe("note v1\n");
  }, 90_000);

  it("C85 a restore running makes a backup wait without freezing the service, then refuses it with 409", async () => {
    const seed = makeTempHome("mordomo-dados-wait-");
    cleanups.push(seed.cleanup);
    const ctx = new AppContext(seed.paths.home);
    const app = await buildServer(ctx);
    const headers = { "x-mordomo-token": ctx.token() };
    try {
      await startHolder(seed.paths.home);
      let last = Date.now();
      let longestStall = 0;
      const timer = setInterval(() => {
        const now = Date.now();
        longestStall = Math.max(longestStall, now - last);
        last = now;
      }, 20);
      const started = Date.now();
      const busy = await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} });
      clearInterval(timer);
      expect(busy.statusCode).toBe(409);
      expect(busy.json().error.code).toBe("restore_in_progress");
      expect(Date.now() - started, "it waited a little").toBeGreaterThan(500);
      // The wait is not a block: the event loop kept turning while the request waited.
      expect(longestStall).toBeLessThan(500);
    } finally {
      await app.close();
      ctx.close();
    }
  }, 60_000);

  it("C78 a restore that died is undone whatever the spelling of the path to the home: a link, or a home that moved", async () => {
    const script = await killer();
    // Killed while restoring through a LINK to the home; undone by an engine built through the real path.
    const viaLink = await fullFixture(false);
    const beforeLink = liveState(viaLink.paths);
    if (POSIX) {
      const link = `${viaLink.home}-link`;
      fs.symlinkSync(viaLink.home, link);
      cleanups.push(() => fs.rmSync(link, { force: true }));
      const killed = await runChild(script, {
        HOME_DIR: link,
        BACKUP_NAME: viaLink.backup.name,
        KILL_AT: "12",
      });
      expect(killed.signal, killed.stderr).toBe("SIGKILL");
      expect(stagingFolders(viaLink.paths)).toHaveLength(1);
      const engine = new AppContext(viaLink.home);
      engine.close();
      expect(stagingFolders(viaLink.paths)).toEqual([]);
      expect(liveState(viaLink.paths)).toEqual(beforeLink);
    }

    // Killed through the real path; the home is moved (a folder renamed, a disk mounted elsewhere) and recovered
    // from where it is now: the journal never names a place, only what was being replaced.
    const moving = await fullFixture(false);
    const beforeMove = liveState(moving.paths);
    const killed = await runChild(script, {
      HOME_DIR: moving.home,
      BACKUP_NAME: moving.backup.name,
      KILL_AT: "12",
    });
    expect(killed.signal, killed.stderr).toBe("SIGKILL");
    const moved = `${moving.home}-moved`;
    fs.renameSync(moving.home, moved);
    cleanups.push(() => fs.rmSync(moved, { recursive: true, force: true }));
    const movedPaths = resolvePaths(moved);
    expect(stagingFolders(movedPaths)).toHaveLength(1);
    expect(recoverInterruptedRestore(movedPaths)).toHaveLength(1);
    expect(liveState(movedPaths)).toEqual(beforeMove);
    expect(stagingFolders(movedPaths)).toEqual([]);

    // The same for a backup: it never seals the half restored home reached by another spelling.
    const again = await fullFixture(false);
    const killedAgain = await runChild(script, {
      HOME_DIR: again.home,
      BACKUP_NAME: again.backup.name,
      KILL_AT: "12",
    });
    expect(killedAgain.signal, killedAgain.stderr).toBe("SIGKILL");
    const movedAgain = `${again.home}-moved`;
    fs.renameSync(again.home, movedAgain);
    cleanups.push(() => fs.rmSync(movedAgain, { recursive: true, force: true }));
    const againPaths = resolvePaths(movedAgain);
    const { db } = openDb(againPaths);
    try {
      const sealed = await createBackup(againPaths, db);
      expect(fs.readFileSync(path.join(sealed.path, "memory", "note.md"), "utf8")).toBe("note CURRENT\n");
      expect(stagingFolders(againPaths)).toEqual([]);
    } finally {
      db.close();
    }
  }, 120_000);

  it("C79 an engine built while a restore runs waits for it by default, and a restore waits for an engine that is opening the database", async () => {
    // (E1) The default wait of the engine is a wait: the restore ends in about a second, the engine mounts after.
    const slow = await bundleChild(
      "restore-slow-r3",
      [
        'import fs from "node:fs";',
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { restoreBackup } from ${src("core/src/backup.ts")};`,
        "const real = fs.renameSync.bind(fs);",
        "fs.renameSync = ((from, to) => {",
        "  real(from, to);",
        '  if (String(from).endsWith("mordomo.db") && String(to).includes(".restore-")) {',
        '    process.stdout.write("aside\\n");',
        "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.DELAY_MS));",
        "  }",
        "});",
        "restoreBackup(resolvePaths(process.env.HOME_DIR), process.env.BACKUP_NAME);",
        'process.stdout.write("done\\n");',
      ].join("\n"),
    );
    const waited = await fullFixture(false);
    const child = spawn(process.execPath, [slow], {
      env: { ...process.env, HOME_DIR: waited.home, BACKUP_NAME: waited.backup.name, DELAY_MS: "1200" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    children.push(child);
    const lines: string[] = [];
    child.stdout.on("data", (d: Buffer) => lines.push(...d.toString().split("\n").filter(Boolean)));
    await expect.poll(() => lines.includes("aside"), { timeout: 30_000 }).toBe(true);
    expect(fs.existsSync(waited.paths.dbFile)).toBe(false);
    const started = Date.now();
    const ctx = new AppContext(waited.home); // no restoreWaitMs: the default
    try {
      expect(Date.now() - started, "it waited for the restore").toBeGreaterThan(300);
      await expect.poll(() => lines.includes("done"), { timeout: 30_000 }).toBe(true);
      expect(ctx.db.prepare("SELECT value FROM meta WHERE key = 'marker'").get()).toEqual({
        value: "backup",
      });
      expect(ctx.db.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      ctx.close();
    }

    // (E2) The lock is held until the database is OPEN: a restore that arrives while an engine is on its way
    // to opening it is refused, not let through to replace the file under it.
    const opening = await bundleChild(
      "engine-opening-r3",
      [
        'import fs from "node:fs";',
        `import { MordomoEngine } from ${src("core/src/engine.ts")};`,
        `import { ProviderRegistry } from ${src("core/src/agents/registry.ts")};`,
        "let paused = false;",
        "for (const name of ['statSync', 'lstatSync', 'openSync']) {",
        "  const real = fs[name].bind(fs);",
        "  fs[name] = (target, ...rest) => {",
        '    if (!paused && String(target).endsWith("mordomo.db")) {',
        "      paused = true;",
        '      process.stdout.write("opening\\n");',
        "      while (!fs.existsSync(process.env.GO)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);",
        "    }",
        "    return real(target, ...rest);",
        "  };",
        "}",
        "const engine = new MordomoEngine({ home: process.env.HOME_DIR, providers: new ProviderRegistry(), seedDir: null });",
        'process.stdout.write("built\\n");',
        "engine.close();",
      ].join("\n"),
    );
    const racing = await fullFixture(false);
    const go = path.join(racing.home, "go");
    const engineChild = spawn(process.execPath, [opening], {
      env: { ...process.env, HOME_DIR: racing.home, GO: go },
      stdio: ["ignore", "pipe", "inherit"],
    });
    children.push(engineChild);
    let said = "";
    engineChild.stdout.on("data", (d: Buffer) => (said += d.toString()));
    await expect.poll(() => said.includes("opening"), { timeout: 30_000 }).toBe(true);
    const state = liveState(racing.paths);
    expect(() => restoreBackup(racing.paths, racing.backup.name, { waitMs: 0 })).toThrow(
      RestoreInProgressError,
    );
    expect(() => RestoreLock.acquire(racing.paths, 0)).toThrow(RestoreInProgressError);
    expect(liveState(racing.paths)).toEqual(state);
    expect(stagingFolders(racing.paths)).toEqual([]);
    fs.writeFileSync(go, "");
    await exited(engineChild);
    expect(said).toContain("built");
    // Open, and done building: the restore may go (it is now the one that waits for nothing).
    expect(() => restoreBackup(racing.paths, racing.backup.name, { waitMs: 0 })).not.toThrow();
  }, 120_000);

  it("C86 a second restore is refused while the lock is held, and the waits of recovery and restore are real waits", async () => {
    const { paths, backup } = await fullFixture(false);
    const before = liveState(paths);
    // (B2) Another process holds the lock (a restore, a backup, an engine that is starting): refused, untouched.
    const owner = await startHolder(paths.home);
    let refusal: unknown;
    try {
      restoreBackup(paths, backup.name, { waitMs: 0 });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(RestoreInProgressError);
    // The message says what may be holding it, whichever it is.
    expect((refusal as Error).message).toMatch(/backup/);
    expect((refusal as Error).message).toMatch(/starting/);
    expect((refusal as RestoreInProgressError).statusCode).toBe(409);
    expect(liveState(paths)).toEqual(before);
    expect(stagingFolders(paths)).toEqual([]);
    owner.kill("SIGKILL");
    await exited(owner);

    // (B18) The default wait of the recovery: it waits for a holder that lets go in under a second, then goes.
    const debris = path.join(paths.home, ".restore-4242-xyz789");
    fs.mkdirSync(debris);
    const brief = await startHolder(paths.home, { releaseAfterMs: 800 });
    const t0 = Date.now();
    expect(recoverInterruptedRestore(paths)).toEqual([path.basename(debris)]);
    expect(Date.now() - t0, "it waited").toBeGreaterThan(300);
    await exited(brief);

    // The restore's own default is a wait too (an engine builds, or a backup runs, for a moment).
    const another = await startHolder(paths.home, { mode: "shared", releaseAfterMs: 800 });
    const t1 = Date.now();
    restoreBackup(paths, backup.name);
    expect(Date.now() - t1, "it waited").toBeGreaterThan(300);
    await exited(another);
    expect(fs.readFileSync(path.join(paths.memory, "note.md"), "utf8")).toBe("note v1\n");
  }, 90_000);

  it("C80 the lock file is owner-only and so is the folder it lives in", () => {
    if (!POSIX) return;
    const { paths, cleanup } = makeTempHome("mordomo-dados-modes-");
    cleanups.push(cleanup);
    fs.rmSync(paths.run, { recursive: true, force: true });
    const lock = RestoreLock.acquire(paths, 0);
    lock.release();
    expect(mode(paths.run)).toBe(0o700);
    expect(mode(lockFile(paths))).toBe(0o600);
    // One an older release or a person left looser is tightened the next time.
    fs.chmodSync(lockFile(paths), 0o644);
    RestoreLock.acquire(paths, 0).release();
    expect(mode(lockFile(paths))).toBe(0o600);
    // And an engine leaves both so, whatever they were.
    fs.chmodSync(paths.run, 0o755);
    fs.chmodSync(lockFile(paths), 0o666);
    new AppContext(paths.home).close();
    expect(mode(paths.run)).toBe(0o700);
    expect(mode(lockFile(paths))).toBe(0o600);
  });

  it("C81 the lock is not reentrant, and a refused second lock does not release the first", async () => {
    const { paths, cleanup } = makeTempHome("mordomo-dados-nested-");
    cleanups.push(cleanup);
    const first = RestoreLock.acquire(paths, 0);
    expect(() => RestoreLock.acquire(paths, 0)).toThrow(/not reentrant/);
    expect(() => RestoreLock.acquire(paths, 0, "shared")).toThrow(RestoreInProgressError);
    // The first one is still held: nothing the refusals did let go of it (a descriptor opened and closed on the
    // file would have: that is how POSIX locks work).
    expect(await probe(paths.home)).toBe("refused:RestoreInProgressError");
    expect(await probe(paths.home, "shared")).toBe("refused:RestoreInProgressError");
    first.release();
    expect(await probe(paths.home)).toBe("acquired");

    // Shared locks may overlap (a backup and an engine that starts); an exclusive one waits for all of them.
    const a = RestoreLock.acquire(paths, 0, "shared");
    const b = RestoreLock.acquire(paths, 0, "shared");
    expect(() => RestoreLock.acquire(paths, 0)).toThrow(RestoreInProgressError);
    expect(await probe(paths.home, "shared")).toBe("acquired");
    expect(await probe(paths.home)).toBe("refused:RestoreInProgressError");
    a.release();
    expect(await probe(paths.home), "b still holds it").toBe("refused:RestoreInProgressError");
    b.release();
    expect(await probe(paths.home)).toBe("acquired");
    a.release(); // twice is nothing
    b.release();
  });

  it("C82 a lock file that cannot be a lock is said so, to be removed by hand, never overwritten or reported raw", async () => {
    const { paths, backup } = await fullFixture(false);
    const before = liveState(paths);
    const asks: Array<[string, () => unknown]> = [
      ["acquire", () => RestoreLock.acquire(paths, 0)],
      ["restoreBackup", () => restoreBackup(paths, backup.name)],
      ["recoverInterruptedRestore", () => recoverInterruptedRestore(paths)],
      ["engine", () => new AppContext(paths.home)],
      [
        "createBackup",
        async () => {
          const { db } = openDb(paths);
          try {
            return await createBackup(paths, db);
          } finally {
            db.close();
          }
        },
      ],
    ];
    const junk = "this is not a sqlite database, only text that is long enough to be read as one\n".repeat(4);
    for (const kind of ["bytes", "folder"] as const) {
      fs.rmSync(lockFile(paths), { recursive: true, force: true });
      if (kind === "bytes") fs.writeFileSync(lockFile(paths), junk);
      else fs.mkdirSync(lockFile(paths));
      for (const [label, ask] of asks) {
        const outcome = await Promise.resolve()
          .then(ask)
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        expect(outcome, `${kind}: ${label}`).toBeInstanceOf(RestoreLockError);
        expect((outcome as Error).message, `${kind}: ${label}`).toContain("remove it by hand");
        expect((outcome as Error).message).toContain("config/run/restore.lock");
        expect((outcome as Error).message, "no absolute path for a client").not.toContain(paths.home);
      }
      if (kind === "bytes") expect(fs.readFileSync(lockFile(paths), "utf8")).toBe(junk);
      else expect(fs.statSync(lockFile(paths)).isDirectory()).toBe(true);
      expect(liveState(paths)).toEqual(before);
    }
    // Removed by hand, as the message says: everything works again.
    fs.rmSync(lockFile(paths), { recursive: true, force: true });
    RestoreLock.acquire(paths, 0).release();
  }, 60_000);

  it("C83 a lock file deleted or replaced while someone waits for it is not a second owner: the waiter locks the file that is there", async () => {
    const waiter = await bundleChild(
      "restore-lock-waiter-r3",
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        `import { RestoreLock } from ${src("core/src/restoreLock.ts")};`,
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        "const paths = resolvePaths(process.env.HOME_DIR);",
        "const lock = RestoreLock.acquire(paths, 20000);",
        'process.stdout.write("acquired " + fs.statSync(path.join(paths.run, "restore.lock")).ino + "\\n");',
        "setInterval(() => { void lock; }, 1000);",
      ].join("\n"),
    );
    for (const change of ["replace", "delete"] as const) {
      const { paths, cleanup } = makeTempHome("mordomo-dados-swap-");
      cleanups.push(cleanup);
      const owner = await startHolder(paths.home);
      const child = spawn(process.execPath, [waiter], {
        env: { ...process.env, HOME_DIR: paths.home },
        stdio: ["ignore", "pipe", "inherit"],
      });
      children.push(child);
      let said = "";
      child.stdout.on("data", (d: Buffer) => (said += d.toString()));
      await new Promise((r) => setTimeout(r, 800)); // it is waiting on the file the owner holds
      let newIno: number | null = null;
      if (change === "replace") {
        fs.writeFileSync(`${lockFile(paths)}.next`, "");
        fs.renameSync(`${lockFile(paths)}.next`, lockFile(paths));
        newIno = fs.statSync(lockFile(paths)).ino;
      } else {
        fs.unlinkSync(lockFile(paths));
      }
      owner.kill("SIGKILL");
      await exited(owner);
      await expect.poll(() => said.includes("acquired"), { timeout: 30_000 }).toBe(true);
      const ino = Number(/acquired (\d+)/.exec(said)![1]);
      // What it holds is the file at the path now - never the one that was removed.
      expect(ino, change).toBe(fs.statSync(lockFile(paths)).ino);
      if (newIno !== null) expect(ino, change).toBe(newIno);
      expect(await probe(paths.home), `${change}: nobody else got in`).toBe("refused:RestoreInProgressError");
      child.kill("SIGKILL");
      await exited(child);
    }
  }, 90_000);

  it("C84 a restore killed at any rename is undone with all eleven targets in play, those that were not there included", async () => {
    const script = await killer();
    const SLOTS = [
      "skills",
      "memory",
      "routines",
      "connectors",
      "artifacts",
      "settings",
      "uiPreferences",
      "syncManifest",
      "dbWal",
      "dbShm",
      "db",
    ];
    for (const drop of [true, false]) {
      const dry = await fullFixture(drop);
      const finished = await runChild(script, {
        HOME_DIR: dry.home,
        BACKUP_NAME: dry.backup.name,
        KILL_AT: "0",
      });
      expect(finished.code, finished.stderr).toBe(0);
      const total = Number(finished.stdout);
      expect(total).toBeGreaterThan(15);
      // The restore did what it was asked, all eleven things of it.
      expect(fs.readFileSync(path.join(dry.paths.memory, "note.md"), "utf8")).toBe("note v1\n");
      expect(fs.readFileSync(path.join(dry.paths.artifacts, "gen", "a.txt"), "utf8")).toBe("artifact v1\n");
      expect(fs.readFileSync(dry.paths.syncManifest, "utf8")).toBe('{"v":1}');
      expect(fs.readFileSync(dry.paths.uiPreferencesFile, "utf8")).toBe('{"theme":"dark"}');

      for (let k = 1; k <= total; k++) {
        const fx = await fullFixture(drop);
        const before = liveState(fx.paths);
        const run = await runChild(script, {
          HOME_DIR: fx.home,
          BACKUP_NAME: fx.backup.name,
          KILL_AT: String(k),
        });
        expect(run.signal, `drop=${drop} k=${k}: ${run.stderr}`).toBe("SIGKILL");
        const [staging] = stagingFolders(fx.paths);
        expect(staging).toBeDefined();
        if (k === total - 2) {
          // Late in the restore: the journal names the eleven things, by name, and which of them were absent.
          const journal = JSON.parse(
            fs.readFileSync(path.join(fx.home, staging!, "JOURNAL.json"), "utf8"),
          ) as {
            phase: string;
            entries: Array<{ slot: string; hadTarget: boolean }>;
          };
          expect(journal.phase).toBe("installing");
          expect(journal.entries.map((e) => e.slot).sort()).toEqual([...SLOTS].sort());
          const had = Object.fromEntries(journal.entries.map((e) => [e.slot, e.hadTarget]));
          expect(had.artifacts).toBe(!drop);
          expect(had.syncManifest).toBe(!drop);
          // The map beside it says, for a person, which thing of the home each old-N is.
          const map = fs.readFileSync(path.join(fx.home, staging!, "MAPA.txt"), "utf8").split("\n");
          const lines = map.filter((l) => /^\d+\t(old|new)\t/.test(l));
          expect(lines).toHaveLength(SLOTS.length);
          expect(lines.map((l) => l.split("\t")[2])).toContain("artifacts");
          expect(lines.find((l) => l.endsWith("\tartifacts"))?.split("\t")[1]).toBe(drop ? "new" : "old");
          expect(lines.map((l) => l.split("\t")[2])).toContain("config/db/mordomo.db");
        }
        const undone = recoverInterruptedRestore(fx.paths);
        expect(undone, `drop=${drop} k=${k}`).toHaveLength(1);
        expect(liveState(fx.paths), `drop=${drop} k=${k}`).toEqual(before);
        expect(stagingFolders(fx.paths)).toEqual([]);
        if (drop) {
          // Absent before, absent after: what the dead restore had installed of them is gone again.
          expect(
            fs.existsSync(fx.paths.artifacts) ? fs.readdirSync(fx.paths.artifacts) : [],
            `k=${k}`,
          ).toEqual([]);
          expect(fs.existsSync(fx.paths.syncManifest), `k=${k}`).toBe(false);
        }
      }
    }
  }, 280_000);

  it("C87 a restore that finished and is killed while its staging folder is deleted leaves a home that works, restored", async () => {
    // A delete that walks the folder in either order, and dies at its k-th unlink or rmdir.
    const cleanup = await bundleChild(
      "cleanup-killed-r3",
      [
        'import fs from "node:fs";',
        'import path from "node:path";',
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { restoreBackup } from ${src("core/src/backup.ts")};`,
        "const killAt = Number(process.env.KILL_AT);",
        'const ascending = process.env.ORDER === "asc";',
        "let ops = 0;",
        "const tick = () => { ops++; if (ops === killAt) process.kill(process.pid, 'SIGKILL'); };",
        "const walk = (target) => {",
        "  if (fs.lstatSync(target).isDirectory()) {",
        "    const names = fs.readdirSync(target).sort();",
        "    if (!ascending) names.reverse();",
        "    for (const name of names) walk(path.join(target, name));",
        "    tick(); fs.rmdirSync(target);",
        "  } else { tick(); fs.unlinkSync(target); }",
        "};",
        "const real = fs.rmSync.bind(fs);",
        "fs.rmSync = (target, options) => {",
        "  if (/[.](restore|removing)-[0-9]+-[A-Za-z0-9]+$/.test(String(target))) {",
        "    if (fs.existsSync(target)) walk(String(target));",
        "    return;",
        "  }",
        "  return real(target, options);",
        "};",
        "restoreBackup(resolvePaths(process.env.HOME_DIR), process.env.BACKUP_NAME);",
        "process.stdout.write(String(ops));",
      ].join("\n"),
    );
    for (const order of ["asc", "desc"]) {
      const dry = await fullFixture(false);
      const finished = await runChild(cleanup, {
        HOME_DIR: dry.home,
        BACKUP_NAME: dry.backup.name,
        KILL_AT: "0",
        ORDER: order,
      });
      expect(finished.code, finished.stderr).toBe(0);
      const total = Number(finished.stdout);
      expect(total, "the deletion has steps to die in").toBeGreaterThan(8);
      for (let k = 1; k <= total; k++) {
        const fx = await fullFixture(false);
        const run = await runChild(cleanup, {
          HOME_DIR: fx.home,
          BACKUP_NAME: fx.backup.name,
          KILL_AT: String(k),
          ORDER: order,
        });
        expect(run.signal, `${order} k=${k}: ${run.stderr}`).toBe("SIGKILL");
        // Whatever the deletion left is debris, never a restore that looks unfinished.
        expect(inspectRestoreState(fx.paths).blockers, `${order} k=${k}`).toEqual([]);
        if (k % 2 === 0) {
          const engine = new AppContext(fx.home);
          try {
            expect(engine.db.prepare("SELECT value FROM meta WHERE key = 'marker'").get()).toEqual({
              value: "backup",
            });
          } finally {
            engine.close();
          }
        } else {
          const { db } = openDb(fx.paths);
          try {
            const sealed = await createBackup(fx.paths, db);
            expect(fs.readFileSync(path.join(sealed.path, "memory", "note.md"), "utf8")).toBe("note v1\n");
          } finally {
            db.close();
          }
        }
        expect(
          fs.readdirSync(fx.home).filter((n) => n.startsWith(".restore-") || n.startsWith(".removing-")),
          `${order} k=${k}: swept`,
        ).toEqual([]);
        expect(fs.readFileSync(path.join(fx.paths.memory, "note.md"), "utf8"), `${order} k=${k}`).toBe(
          "note v1\n",
        );
        expect(fs.readFileSync(path.join(fx.paths.skills, "x", "SKILL.md"), "utf8")).toBe("skill v1\n");
      }
    }
  }, 280_000);

  it("C88 the hash of a backup gives the event loop back in the middle of a big file, not only between files", async () => {
    const home = makeTempHome("mordomo-dados-hash-");
    cleanups.push(home.cleanup);
    const big = path.join(home.paths.home, "big");
    fs.mkdirSync(big);
    fs.writeFileSync(path.join(big, "one.bin"), Buffer.alloc(20 << 20, 7));
    let turns = 0;
    const real = globalThis.setImmediate;
    globalThis.setImmediate = ((...args: Parameters<typeof setImmediate>) => {
      turns++;
      return real(...args);
    }) as typeof setImmediate;
    try {
      await buildManifestAsync(big);
    } finally {
      globalThis.setImmediate = real;
    }
    // One file of 20 MiB: the slice is 8 MiB, so two turns inside it and one after (it used to be one in all).
    expect(turns).toBeGreaterThanOrEqual(3);
  });

  it("C90 the API answers 409 with a code for a leftover, a dead restore that cannot be undone and a lock file that cannot be one, and names no path of the home", async () => {
    const seed = makeTempHome("mordomo-dados-api409-");
    cleanups.push(seed.cleanup);
    const ctx = new AppContext(seed.paths.home);
    const app = await buildServer(ctx);
    const headers = { "x-mordomo-token": ctx.token() };
    try {
      const folder = path.join(seed.paths.home, ".restore-1-aaaaaa");
      write(path.join(folder, "old-0", "note.md"), "an original");
      write(path.join(folder, "JOURNAL.json"), "garbage");
      const leftover = await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} });
      expect(leftover.statusCode).toBe(409);
      expect(leftover.json().error.code).toBe("restore_leftover");
      expect(leftover.json().error.message).toContain(".restore-1-aaaaaa");
      expect(leftover.json().error.message).not.toContain(seed.paths.home);
      fs.rmSync(folder, { recursive: true, force: true });

      fs.rmSync(lockFile(seed.paths), { force: true });
      fs.writeFileSync(lockFile(seed.paths), "x".repeat(64));
      const unusable = await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} });
      expect(unusable.statusCode).toBe(409);
      expect(unusable.json().error.code).toBe("restore_lock_unusable");
      expect(unusable.json().error.message).not.toContain(seed.paths.home);
      fs.rmSync(lockFile(seed.paths), { force: true });

      // The statuses a client is meant to act on are in the API description.
      const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers })).json() as {
        paths: Record<string, Record<string, { responses: Record<string, { description: string }> }>>;
      };
      const post = doc.paths["/api/v1/backups"]!.post!;
      expect(post.responses["409"]!.description).toMatch(
        /restore_in_progress.*restore_leftover.*restore_recovery_failed.*restore_lock_unusable/,
      );
      expect(doc.paths["/api/v1/backups/{name}/restore"]!.post!.responses["422"]!.description).toContain(
        "backup_invalid",
      );
    } finally {
      await app.close();
      ctx.close();
    }
  }, 60_000);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  BackupVerificationError,
  MIGRATIONS,
  applyPendingRestore,
  SettingsSchema,
  SettingsStore,
  createBackup,
  listBackups,
  openDb,
  readRestorePending,
  RestoreInProgressError,
  RestoreLeftoverError,
  RestoreLock,
  RestoreRecoveryError,
  recoverInterruptedRestore,
  pruneBackups,
  restoreBackup,
  writeRestorePending,
  type MordomoPaths,
} from "@mordomo/core";
import net from "node:net";
import { AppContext } from "../apps/api/src/context.js";
import { startServer } from "../apps/api/src/server.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";
import { bundleChild, repoRoot, runChild, src } from "./helpers/childBundle.js";

/**
 * dados-v2, slice S4 (.specs/features/dados-v2): a backup carries a manifest of what is in it, a restore installs
 * only what matches it and is all-or-nothing, and the number of backups kept is configurable.
 */

const POSIX = process.platform !== "win32";
const cleanups: Array<() => void> = [];
const children: ChildProcess[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** SHA-256 of every file the restore can change, by path under the home: the state a refusal must leave alone. */
function liveState(paths: MordomoPaths): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(paths.home, full)] = sha(full);
      else if (entry.isSymbolicLink()) out[path.relative(paths.home, full)] = `link:${fs.readlinkSync(full)}`;
    }
  };
  for (const dir of [paths.skills, paths.memory, paths.routines, paths.connectors, paths.artifacts])
    walk(dir);
  for (const file of [paths.settingsFile, paths.uiPreferencesFile, paths.syncManifest, paths.dbFile]) {
    if (fs.existsSync(file)) out[path.relative(paths.home, file)] = sha(file);
  }
  return out;
}
/** Every file under a folder with its content: what a refusal must leave exactly as it was. */
const tree = (dir: string): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push([path.relative(dir, full), fs.readFileSync(full, "utf8")]);
    }
  };
  walk(dir);
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
};
const stagingFolders = (paths: MordomoPaths) =>
  fs.readdirSync(paths.home).filter((n) => n.startsWith(".restore-"));

/** A home with something in every set, a backup of it, and live files that have moved on since. */
async function fixture(options: { link?: boolean; bulk?: number } = {}) {
  const home = makeTempHome("mordomo-dados-backup-");
  cleanups.push(home.cleanup);
  const { paths } = home;
  write(path.join(paths.skills, "x", "SKILL.md"), "skill v1\n");
  write(path.join(paths.memory, "note.md"), "note v1\n");
  write(path.join(paths.routines, "r.json"), '{"id":"r"}');
  write(path.join(paths.connectors, "c.json"), '{"id":"c"}');
  if (options.link && POSIX)
    fs.symlinkSync(path.join(paths.skills, "x", "SKILL.md"), path.join(paths.skills, "x", "link"));
  for (let i = 0; i < (options.bulk ?? 0); i++) {
    write(path.join(paths.skills, "big", `f${i}.md`), `skill file ${i}\n`);
    write(path.join(paths.memory, "bulk", `n${i}.md`), `memory note ${i}\n`);
  }
  new SettingsStore(paths).save(SettingsSchema.parse({ systemName: "Backed" }));
  const { db } = openDb(paths);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('marker', 'backup')").run();
  const backup = await createBackup(paths, db);
  db.close();
  write(path.join(paths.memory, "note.md"), "note CURRENT\n");
  new SettingsStore(paths).save(SettingsSchema.parse({ systemName: "Current" }));
  return { paths, backup, home: paths.home };
}
const inBackup = (backup: { path: string }, rel: string) => path.join(backup.path, ...rel.split("/"));
const flipByte = (file: string) => {
  const bytes = fs.readFileSync(file);
  bytes[0] = bytes[0]! ^ 0xff;
  fs.writeFileSync(file, bytes);
};

/** A child that restores and dies by SIGKILL at the k-th rename (or when it starts to clean up), or runs to the end. */
let killScript: Promise<string> | undefined;
function killer(): Promise<string> {
  killScript ??= bundleChild(
    "restore-killed",
    [
      'import fs from "node:fs";',
      `import { resolvePaths } from ${src("core/src/paths.ts")};`,
      `import { restoreBackup } from ${src("core/src/backup.ts")};`,
      "const killAt = Number(process.env.KILL_AT);",
      "let renames = 0;",
      "const real = fs.renameSync.bind(fs);",
      "fs.renameSync = ((from, to) => {",
      '  if (String(from).includes(".restore-") || String(to).includes(".restore-")) {',
      '    renames++; if (renames === killAt) process.kill(process.pid, "SIGKILL");',
      "  }",
      "  return real(from, to);",
      "});",
      "const realRm = fs.rmSync.bind(fs);",
      "fs.rmSync = ((target, options) => {",
      '  if (process.env.KILL_ON_CLEANUP && /[.]restore-[0-9]+-[A-Za-z0-9]+$/.test(String(target))) process.kill(process.pid, "SIGKILL");',
      "  return realRm(target, options);",
      "});",
      "restoreBackup(resolvePaths(process.env.HOME_DIR), process.env.BACKUP_NAME);",
      "process.stdout.write(String(renames));",
    ].join("\n"),
  );
  return killScript;
}
async function crashedRestore(env: Record<string, string>, options: { bulk?: number } = {}) {
  const fx = await fixture(options);
  const before = liveState(fx.paths);
  const result = await runChild(await killer(), { HOME_DIR: fx.home, BACKUP_NAME: fx.backup.name, ...env });
  expect(result.signal, result.stderr).toBe("SIGKILL");
  expect(stagingFolders(fx.paths)).toHaveLength(1);
  return { ...fx, before };
}
/** A child that holds the restore lock until it is killed: a restore that is running in another process. */
async function startHolder(home: string): Promise<ChildProcess & { pid: number }> {
  const script = await bundleChild(
    "restore-lock-holder",
    [
      `import { RestoreLock } from ${src("core/src/restoreLock.ts")};`,
      `import { resolvePaths } from ${src("core/src/paths.ts")};`,
      "const lock = RestoreLock.acquire(resolvePaths(process.env.HOME_DIR), 0);",
      'process.stdout.write("held\\n");',
      "setInterval(() => { void lock; }, 1000);",
    ].join("\n"),
  );
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, HOME_DIR: home },
    stdio: ["ignore", "pipe", "inherit"],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error(`holder exited ${code}`)));
  });
  return child as ChildProcess & { pid: number };
}

describe("S4 backups are sealed, verified and kept in number", () => {
  it("C27 a backup carries a manifest of everything in it", async () => {
    const { backup } = await fixture({ link: true });
    const manifest = JSON.parse(fs.readFileSync(inBackup(backup, "manifest.json"), "utf8")) as {
      version: number;
      algorithm: string;
      createdAt: number;
      files: Array<{ path: string; size: number; sha256: string }>;
      links: Array<{ path: string; target: string }>;
    };
    expect(manifest).toMatchObject({ version: 1, algorithm: "sha256" });
    expect(typeof manifest.createdAt).toBe("number");

    const actualFiles: string[] = [];
    const actualLinks: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) actualLinks.push(name);
        else if (entry.isDirectory()) walk(full, name);
        else actualFiles.push(name);
      }
    };
    walk(backup.path, "");
    expect(manifest.files.map((f) => f.path).sort()).toEqual(
      actualFiles.filter((f) => f !== "manifest.json").sort(),
    );
    for (const file of manifest.files) {
      expect(file.size, file.path).toBe(fs.statSync(inBackup(backup, file.path)).size);
      expect(file.sha256, file.path).toBe(sha(inBackup(backup, file.path)));
    }
    expect(manifest.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        "memory/note.md",
        "skills/x/SKILL.md",
        "config/db/mordomo.db",
        "config/settings.json",
      ]),
    );
    expect(manifest.links.map((l) => l.path).sort()).toEqual(actualLinks.sort());
    if (POSIX) {
      expect(manifest.links).toEqual([
        { path: "skills/x/link", target: fs.readlinkSync(inBackup(backup, "skills/x/link")) },
      ]);
    }
  });

  it("C28 the staged copies are what gets verified", async () => {
    const copyOf = fs.cpSync.bind(fs);
    // A copy that changes after it is made, the original intact: refused.
    const a = await fixture();
    const stateA = liveState(a.paths);
    vi.spyOn(fs, "cpSync").mockImplementation((source, dest, options) => {
      copyOf(source, dest, options);
      if (String(dest).endsWith("new-0")) flipByte(path.join(String(dest), "x", "SKILL.md"));
    });
    expect(() => restoreBackup(a.paths, a.backup.name)).toThrow(BackupVerificationError);
    expect(liveState(a.paths)).toEqual(stateA);
    vi.restoreAllMocks();

    // The original changes after the copy was made, the copy intact: what was verified is what is installed.
    const b = await fixture();
    vi.spyOn(fs, "cpSync").mockImplementation((source, dest, options) => {
      copyOf(source, dest, options);
      if (String(dest).endsWith("new-0"))
        fs.writeFileSync(inBackup(b.backup, "skills/x/SKILL.md"), "TAMPERED AFTER COPY\n");
    });
    restoreBackup(b.paths, b.backup.name);
    expect(fs.readFileSync(path.join(b.paths.skills, "x", "SKILL.md"), "utf8")).toBe("skill v1\n");
  });

  it("C29 any difference from the manifest refuses the restore and changes nothing", async () => {
    const defects: Array<{
      name: string;
      kind: string | null;
      path: string | null;
      link?: boolean;
      apply(backup: { path: string }): void;
    }> = [
      {
        name: "byte changed",
        kind: "checksum",
        path: "memory/note.md",
        apply: (b) => flipByte(inBackup(b, "memory/note.md")),
      },
      {
        name: "truncated",
        kind: "size",
        path: "skills/x/SKILL.md",
        apply: (b) => fs.truncateSync(inBackup(b, "skills/x/SKILL.md"), 3),
      },
      {
        name: "deleted",
        kind: "missing",
        path: "routines/r.json",
        apply: (b) => fs.rmSync(inBackup(b, "routines/r.json")),
      },
      {
        name: "added",
        kind: "unexpected",
        path: "skills/x/extra.md",
        apply: (b) => write(inBackup(b, "skills/x/extra.md"), "extra"),
      },
      {
        name: "link retargeted",
        kind: "link",
        path: "skills/x/link",
        link: true,
        apply: (b) => {
          fs.rmSync(inBackup(b, "skills/x/link"));
          fs.symlinkSync("/nowhere", inBackup(b, "skills/x/link"));
        },
      },
      {
        name: "database edited but valid",
        kind: "checksum",
        path: "config/db/mordomo.db",
        apply: (b) => {
          const d = new Database(inBackup(b, "config/db/mordomo.db"));
          d.exec("INSERT INTO meta (key, value) VALUES ('edited', 'yes')");
          d.close();
        },
      },
      {
        name: "manifest unreadable",
        kind: null,
        path: null,
        apply: (b) => fs.writeFileSync(inBackup(b, "manifest.json"), "{{"),
      },
    ];
    for (const defect of defects) {
      if (defect.link && !POSIX) continue;
      const { paths, backup } = await fixture({ link: true });
      defect.apply(backup);
      const before = liveState(paths);
      const backupsBefore = listBackups(paths).length;
      let thrown: unknown;
      try {
        restoreBackup(paths, backup.name);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, defect.name).toBeInstanceOf(BackupVerificationError);
      const error = thrown as BackupVerificationError;
      expect(error.code, defect.name).toBe("backup_invalid");
      expect(error.statusCode, defect.name).toBe(422);
      if (defect.path) {
        expect(error.message, defect.name).toContain(`${defect.kind} ${defect.path}`);
        expect(error.problems, defect.name).toContainEqual({ path: defect.path, kind: defect.kind });
      }
      expect(liveState(paths), defect.name).toEqual(before);
      expect(listBackups(paths), defect.name).toHaveLength(backupsBefore);
      expect(stagingFolders(paths), defect.name).toEqual([]);
    }
  });

  it("C30 an unsealed backup needs allowUnverified", async () => {
    const { paths, backup } = await fixture();
    fs.rmSync(inBackup(backup, "manifest.json"));
    const before = liveState(paths);
    let thrown: unknown;
    try {
      restoreBackup(paths, backup.name);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BackupVerificationError);
    expect((thrown as BackupVerificationError).code).toBe("backup_unsealed");
    expect((thrown as BackupVerificationError).message).toContain("--allow-unverified");
    expect(liveState(paths)).toEqual(before);

    restoreBackup(paths, backup.name, { allowUnverified: true });
    expect(fs.readFileSync(path.join(paths.memory, "note.md"), "utf8")).toBe("note v1\n");
  });

  it("C31 a restore killed at any rename is rolled back", async () => {
    const script = await killer();
    // How many renames a complete restore makes, from a restore that is let finish.
    const dry = await fixture();
    const finished = await runChild(script, {
      HOME_DIR: dry.home,
      BACKUP_NAME: dry.backup.name,
      KILL_AT: "0",
    });
    expect(finished.code, finished.stderr).toBe(0);
    const total = Number(finished.stdout);
    expect(total).toBeGreaterThan(8);

    for (let k = 1; k <= total; k++) {
      const { paths, backup, home } = await fixture();
      const before = liveState(paths);
      const result = await runChild(script, { HOME_DIR: home, BACKUP_NAME: backup.name, KILL_AT: String(k) });
      expect(result.signal, `k=${k}`).toBe("SIGKILL");
      recoverInterruptedRestore(paths);
      expect(liveState(paths), `k=${k}`).toEqual(before);
      expect(stagingFolders(paths), `k=${k}`).toEqual([]);
    }
  }, 180_000);

  it("C55 a restore that dies after it installed everything is kept, not undone", async () => {
    const crashed = await crashedRestore({ KILL_AT: "0", KILL_ON_CLEANUP: "1" });
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(crashed.paths.home, stagingFolders(crashed.paths)[0]!, "JOURNAL.json"),
        "utf8",
      ),
    ) as { phase: string };
    expect(journal.phase).toBe("done");
    recoverInterruptedRestore(crashed.paths);
    expect(fs.readFileSync(path.join(crashed.paths.memory, "note.md"), "utf8")).toBe("note v1\n");
    expect(JSON.parse(fs.readFileSync(crashed.paths.settingsFile, "utf8")).systemName).toBe("Backed");
    expect(stagingFolders(crashed.paths)).toEqual([]);
  }, 60_000);

  it("C58 a restore that fails in this process after any install puts everything back", async () => {
    const real = fs.renameSync.bind(fs);
    const staged = (from: unknown, to: unknown) =>
      (String(from).includes(".restore-") || String(to).includes(".restore-")) &&
      !String(from).includes("JOURNAL.json") &&
      !String(to).includes("JOURNAL.json");
    const dry = await fixture();
    let total = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (staged(from, to)) total++;
      return real(from, to);
    });
    restoreBackup(dry.paths, dry.backup.name);
    vi.restoreAllMocks();
    expect(total).toBeGreaterThan(8);

    for (let k = 1; k <= total; k++) {
      const { paths, backup } = await fixture();
      const before = liveState(paths);
      let seen = 0;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (staged(from, to) && ++seen === k) throw new Error("Injected install failure");
        return real(from, to);
      });
      try {
        expect(() => restoreBackup(paths, backup.name), `k=${k}`).toThrow(/Injected/);
      } finally {
        vi.restoreAllMocks();
      }
      expect(liveState(paths), `k=${k}`).toEqual(before);
      expect(stagingFolders(paths), `k=${k}`).toEqual([]);
    }
  }, 120_000);

  it("C59 a backup whose database is empty or from a newer version is refused even when unsealed", async () => {
    for (const version of [0, 9999]) {
      const { paths, backup } = await fixture();
      fs.rmSync(inBackup(backup, "manifest.json"));
      const raw = new Database(inBackup(backup, "config/db/mordomo.db"));
      raw.pragma("wal_checkpoint(TRUNCATE)");
      raw.pragma("journal_mode = DELETE");
      raw.pragma(`user_version = ${version}`);
      raw.close();
      const before = liveState(paths);
      expect(() => restoreBackup(paths, backup.name, { allowUnverified: true }), String(version)).toThrow(
        /Invalid backup database/,
      );
      expect(liveState(paths)).toEqual(before);
    }
  });

  it("C32 a restore that is running is left alone, and its dead leftovers are undone as soon as it is gone", async () => {
    const { paths } = await fixture();
    const owner = await startHolder(paths.home);
    // What the restore has done so far: the memory folder moved aside, its copy not yet in.
    const staging = path.join(paths.home, `.restore-${owner.pid}-abc123`);
    write(path.join(staging, "old-0", "note.md"), "the original");
    fs.rmSync(paths.memory, { recursive: true });
    write(
      path.join(staging, "JOURNAL.json"),
      JSON.stringify({
        pid: owner.pid,
        phase: "installing",
        entries: [{ slot: "memory", target: paths.memory, hadTarget: true }],
      }),
    );
    expect(() => recoverInterruptedRestore(paths, 100)).toThrow(RestoreInProgressError);
    expect(fs.existsSync(path.join(staging, "old-0", "note.md"))).toBe(true);
    expect(fs.existsSync(paths.memory)).toBe(false);

    // The process dies: the kernel lets go of the lock, and the same journal is now undone.
    const exited = new Promise((resolve) => owner.once("exit", resolve));
    owner.kill("SIGKILL");
    await exited;
    expect(recoverInterruptedRestore(paths)).toEqual([path.basename(staging)]);
    expect(fs.readFileSync(path.join(paths.memory, "note.md"), "utf8")).toBe("the original");
    expect(stagingFolders(paths)).toEqual([]);
  });

  it("C53 a restore that died half way is undone by every way back into the home", async () => {
    const k = "9"; // far enough in that targets were moved aside and some installed, short of the database
    const pre = "note CURRENT\n";

    // 1. The next restore: its safety backup is the state BEFORE the dead one, not the half done one.
    const a = await crashedRestore({ KILL_AT: k });
    const second = restoreBackup(a.paths, a.backup.name);
    expect(fs.readFileSync(path.join(second.safetyBackup.path, "memory", "note.md"), "utf8")).toBe(pre);
    expect(fs.readFileSync(path.join(a.paths.memory, "note.md"), "utf8")).toBe("note v1\n");
    expect(stagingFolders(a.paths)).toEqual([]);

    // 2. The boot that applies a staged restore, with nothing staged.
    const b = await crashedRestore({ KILL_AT: k });
    expect(applyPendingRestore(b.paths).applied).toBeNull();
    expect(liveState(b.paths)).toEqual(b.before);
    expect(stagingFolders(b.paths)).toEqual([]);

    // 3. Any command that builds the engine (every CLI command does): no start, no restore.
    const c = await crashedRestore({ KILL_AT: k });
    new AppContext(c.home).close();
    expect(liveState(c.paths)).toEqual(c.before);
    expect(stagingFolders(c.paths)).toEqual([]);

    // 4. A backup: it never seals the half restored home.
    const d = await crashedRestore({ KILL_AT: k });
    const { db } = openDb(d.paths);
    try {
      const sealed = await createBackup(d.paths, db);
      expect(fs.readFileSync(path.join(sealed.path, "memory", "note.md"), "utf8")).toBe(pre);
      expect(stagingFolders(d.paths)).toEqual([]);
    } finally {
      db.close();
    }

    // 5. The CLI: `backup --list` and `backup` on the half restored home.
    ensureCli();
    const e = await crashedRestore({ KILL_AT: k });
    expect(mordomo(e.home, ["backup", "--list"]).status).toBe(0);
    expect(liveState(e.paths)).toEqual(e.before);
    const e2 = await crashedRestore({ KILL_AT: k });
    const made = mordomo(e2.home, ["backup"]);
    expect(made.status, made.stderr).toBe(0);
    const newest = listBackups(e2.paths)[0]!;
    expect(fs.readFileSync(path.join(newest.path, "memory", "note.md"), "utf8")).toBe(pre);

    // A restore that is still running (another process holds the lock) is refused, not sealed.
    const live = await fixture();
    await startHolder(live.paths.home);
    const { db: liveDb } = openDb(live.paths);
    try {
      await expect(createBackup(live.paths, liveDb)).rejects.toThrow(/restore is in progress/);
    } finally {
      liveDb.close();
    }
  }, 120_000);

  it("C56 a restore lock is released by the kernel when its process dies, with no pid to judge", async () => {
    const { paths } = await fixture();
    const owner = await startHolder(paths.home);
    expect(() => RestoreLock.acquire(paths, 0)).toThrow(RestoreInProgressError);
    const exited = new Promise((resolve) => owner.once("exit", resolve));
    owner.kill("SIGKILL");
    await exited;
    const lock = RestoreLock.acquire(paths, 0); // at once: nothing was left behind to be stale
    lock.release();
    expect(() => RestoreLock.acquire(paths, 0).release()).not.toThrow();
  });

  it("C57 a folder without a journal is debris once the lock is ours, and not before", async () => {
    const { paths } = await fixture();
    const debris = path.join(paths.home, `.restore-4242-xyz789`);
    fs.mkdirSync(debris);
    write(path.join(debris, "new-0", "x"), "x");
    const owner = await startHolder(paths.home);
    expect(() => recoverInterruptedRestore(paths, 100)).toThrow(RestoreInProgressError);
    expect(fs.existsSync(debris)).toBe(true);
    const exited = new Promise((resolve) => owner.once("exit", resolve));
    owner.kill("SIGKILL");
    await exited;
    expect(recoverInterruptedRestore(paths)).toEqual([path.basename(debris)]);
    expect(fs.existsSync(debris)).toBe(false);
  });

  it("C64 several commands finding the same dead restore at once undo it once, and lose nothing", async () => {
    const script = await bundleChild(
      "recover-together",
      [
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { recoverInterruptedRestore } from ${src("core/src/backup.ts")};`,
        `import { barrier } from ${src("tests/helpers/barrier.ts")};`,
        'barrier(process.env.BARRIER_DIR, "go", Number(process.env.PARTIES));',
        "process.stdout.write(JSON.stringify(recoverInterruptedRestore(resolvePaths(process.env.HOME_DIR), 60000)));",
      ].join("\n"),
    );
    const parties = 4;
    for (let round = 0; round < 6; round++) {
      const crashed = await crashedRestore({ KILL_AT: "9" }, { bulk: 400 });
      const barrierDir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-barrier-"));
      cleanups.push(() => fs.rmSync(barrierDir, { recursive: true, force: true }));
      const results = await Promise.all(
        Array.from({ length: parties }, () =>
          runChild(script, { HOME_DIR: crashed.home, BARRIER_DIR: barrierDir, PARTIES: String(parties) }),
        ),
      );
      for (const r of results) {
        expect(r.code, `round ${round}: ${r.stderr}`).toBe(0);
        expect(r.stderr).not.toContain("could not be undone");
      }
      const undone = results.map((r) => (JSON.parse(r.stdout) as string[]).length).sort();
      expect(undone, `round ${round}: exactly one of them undid it`).toEqual([0, 0, 0, 1]);
      expect(liveState(crashed.paths), `round ${round}`).toEqual(crashed.before);
      expect(stagingFolders(crashed.paths), `round ${round}`).toEqual([]);
    }
  }, 180_000);

  it("C65 an engine built while a restore is running in another process waits, then refuses, and never opens the database", async () => {
    const slow = await bundleChild(
      "restore-slow",
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
    const { paths, backup, home } = await fixture();
    const child = spawn(process.execPath, [slow], {
      env: { ...process.env, HOME_DIR: home, BACKUP_NAME: backup.name, DELAY_MS: "2500" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    children.push(child);
    const lines: string[] = [];
    child.stdout.on("data", (d: Buffer) => lines.push(...d.toString().split("\n").filter(Boolean)));
    await expect.poll(() => lines.includes("aside"), { timeout: 30_000 }).toBe(true);
    // The database is moved aside and its copy not in yet: a vicinity process that opened it would create an
    // empty one (and a WAL) and the restored one would end up under it.
    expect(fs.existsSync(paths.dbFile)).toBe(false);
    let thrown: unknown;
    try {
      new AppContext(home, { restoreWaitMs: 200 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RestoreInProgressError);
    expect((thrown as RestoreInProgressError).statusCode).toBe(409);
    expect(fs.existsSync(paths.dbFile)).toBe(false);
    expect(fs.existsSync(`${paths.dbFile}-wal`)).toBe(false);
    expect(fs.existsSync(`${paths.dbFile}-shm`)).toBe(false);

    await expect.poll(() => lines.includes("done"), { timeout: 30_000 }).toBe(true);
    // Afterwards the engine builds, on the restored database.
    const ctx = new AppContext(home);
    try {
      expect(ctx.db.prepare("SELECT value FROM meta WHERE key = 'marker'").get()).toEqual({
        value: "backup",
      });
      expect(ctx.db.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      ctx.close();
    }
  }, 90_000);

  it("C66 a journal this code did not write is not acted upon, and the home refuses everything while it is there", async () => {
    const { paths, backup } = await fixture();
    const outside = path.join(path.dirname(paths.home), `outside-${process.pid}`);
    fs.mkdirSync(outside, { recursive: true });
    write(path.join(outside, "precious.txt"), "do not delete");
    cleanups.push(() => fs.rmSync(outside, { recursive: true, force: true }));
    const journal = (staging: string, entries: unknown[], over: Record<string, unknown> = {}) =>
      write(
        path.join(staging, "JOURNAL.json"),
        JSON.stringify({ pid: 2 ** 30, phase: "installing", entries, ...over }),
      );
    const legit = (over: Record<string, unknown> = {}) => ({
      slot: "memory",
      target: paths.memory,
      hadTarget: true,
      ...over,
    });
    let n = 0;
    const staging = () => path.join(paths.home, `.restore-${++n}-aaaaaa`);

    // Each of these is refused (nothing deleted, nothing moved, the folder kept), and so is every caller.
    const cases: Array<[string, (dir: string) => void]> = [
      ["a slot that is not one of the eleven", (d) => journal(d, [legit({ slot: "outside" })])],
      ["a slot that is a path", (d) => journal(d, [legit({ slot: outside })])],
      ["the same slot twice", (d) => journal(d, [legit(), legit()])],
      ["hadTarget that is not a boolean", (d) => journal(d, [legit({ hadTarget: "yes" })])],
      ["a phase that is not one", (d) => journal(d, [legit()], { phase: "whenever" })],
      [
        "one legitimate entry and one outside it (all or nothing)",
        (d) => {
          write(path.join(d, "old-0", "note.md"), "the original");
          fs.rmSync(paths.memory, { recursive: true });
          journal(d, [legit(), { slot: "../../etc", target: outside, hadTarget: false }]);
        },
      ],
      ["a journal that is not JSON", (d) => write(path.join(d, "JOURNAL.json"), "{ not json")],
      [
        "a damaged journal over the originals it can no longer place (old-N are kept)",
        (d) => {
          write(path.join(d, "old-0", "note.md"), "the original");
          write(path.join(d, "old-3", "x.md"), "another original");
          write(path.join(d, "JOURNAL.json"), '{"pid":1,"phase":"insta');
        },
      ],
      ["a journal that is not an object", (d) => write(path.join(d, "JOURNAL.json"), "[1,2]")],
      [
        "no journal, but the originals (old-N) are there",
        (d) => write(path.join(d, "old-0", "note.md"), "x"),
      ],
    ];
    if (POSIX) {
      cases.push([
        "a link named like a staging folder, to a folder that holds a valid journal",
        (d) => {
          const away = path.join(outside, "away");
          journal(away, [legit({ hadTarget: false })]);
          fs.symlinkSync(away, d);
        },
      ]);
    }
    for (const [label, build] of cases) {
      const dir = staging();
      build(dir);
      const mid = liveState(paths);
      const kept = POSIX && fs.lstatSync(dir).isSymbolicLink() ? [] : tree(dir);
      const { db } = openDb(paths);
      try {
        for (const attempt of [
          () => recoverInterruptedRestore(paths),
          () => restoreBackup(paths, backup.name),
          () => new AppContext(paths.home),
          () => createBackup(paths, db),
        ]) {
          await expect(Promise.resolve().then(attempt), label).rejects.toBeInstanceOf(RestoreLeftoverError);
        }
      } finally {
        db.close();
      }
      // (an engine makes the folders it needs, memory included: what a restore replaces is compared as it was)
      const now = liveState(paths);
      for (const key of Object.keys(mid)) expect(now[key], `${label}: ${key}`).toBe(mid[key]);
      expect(POSIX && fs.lstatSync(dir).isSymbolicLink() ? [] : tree(dir), label).toEqual(kept);
      expect(fs.readFileSync(path.join(outside, "precious.txt"), "utf8"), label).toBe("do not delete");
      expect(fs.lstatSync(dir, { throwIfNoEntry: false }), label).toBeDefined();
      // The owner clears it by hand, as the message says, and the home works again.
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(paths.memory, { recursive: true });
    }
    const error = await Promise.resolve()
      .then(() => {
        write(path.join(staging(), "JOURNAL.json"), "garbage");
        return recoverInterruptedRestore(paths);
      })
      .catch((e: unknown) => e as RestoreLeftoverError);
    expect(error.message).toContain("delete the folder and try again");
    expect((error as RestoreLeftoverError).statusCode).toBe(409);
    expect((error as RestoreLeftoverError).leftovers).toHaveLength(1);
    fs.rmSync(path.join(paths.home, `.restore-${n}-aaaaaa`), { recursive: true, force: true });

    // A folder an owner made, whose name only starts like one, is not a staging folder: left alone, no error.
    const notes = path.join(paths.home, ".restore-notes");
    write(path.join(notes, "mine.txt"), "mine");
    expect(recoverInterruptedRestore(paths)).toEqual([]);
    expect(fs.readFileSync(path.join(notes, "mine.txt"), "utf8")).toBe("mine");
    const engine = new AppContext(paths.home);
    engine.close();
    expect(fs.existsSync(notes)).toBe(true);

    // The genuine thing is undone - and by index and slot, whatever the journal says of old/staged/target.
    const good = staging();
    write(path.join(good, "old-0", "note.md"), "the original");
    fs.rmSync(paths.memory, { recursive: true });
    journal(good, [
      legit({ target: path.join(outside, "elsewhere"), old: path.join(outside, "precious.txt") }),
    ]);
    expect(recoverInterruptedRestore(paths)).toEqual([path.basename(good)]);
    expect(fs.readFileSync(path.join(paths.memory, "note.md"), "utf8")).toBe("the original");
    expect(fs.readFileSync(path.join(outside, "precious.txt"), "utf8")).toBe("do not delete");
    expect(fs.existsSync(path.join(outside, "elsewhere"))).toBe(false);
  }, 120_000);

  it("C72 the API answers 409 with its code when a restore is running or the original cannot be kept", async () => {
    const { paths: seed } = makeTempHome("mordomo-dados-409-");
    cleanups.push(() => fs.rmSync(seed.home, { recursive: true, force: true }));
    const ctx = new AppContext(seed.home);
    const app = await buildServer(ctx);
    const headers = { "x-mordomo-token": ctx.token() };
    try {
      await startHolder(seed.home);
      const busy = await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} });
      expect(busy.statusCode).toBe(409);
      expect(busy.json().error.code).toBe("restore_in_progress");
      expect(busy.json().error.message).toMatch(/restore is in progress/);

      // A settings.json with an unreadable value, and no name that can hold its copy.
      const text = JSON.stringify({ version: 2, port: "abc", systemName: "Casa" });
      fs.writeFileSync(ctx.paths.settingsFile, text);
      const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
      for (const name of [
        ".invalid",
        `.invalid.${hash}`,
        ...Array.from({ length: 8 }, (_, i) => `.invalid.${hash}-${i + 1}`),
      ]) {
        fs.mkdirSync(`${ctx.paths.settingsFile}${name}`);
      }
      ctx.settingsStore.invalidate();
      const refused = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers,
        payload: { systemName: "Changed" },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe("settings_unpreserved");
      expect(fs.readFileSync(ctx.paths.settingsFile, "utf8")).toBe(text);
    } finally {
      await app.close();
      ctx.close();
    }
  });

  it("C73 a restore that cannot be undone, or is still running, is reported with its cause by the commands that find it", async () => {
    // Cannot be undone: the database was moved aside, then putting it back fails.
    const script = await killer();
    const dry = await fixture();
    const finished = await runChild(script, {
      HOME_DIR: dry.home,
      BACKUP_NAME: dry.backup.name,
      KILL_AT: "0",
    });
    const total = Number(finished.stdout);
    const stuck = await crashedRestore({ KILL_AT: String(total - 1) });
    const real = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from).includes(".restore-") && String(to) === stuck.paths.dbFile) {
        throw Object.assign(new Error("ENOENT: no such file or directory, rename"), { code: "ENOENT" });
      }
      return real(from, to);
    });
    let thrown: unknown;
    try {
      new AppContext(stuck.home);
    } catch (error) {
      thrown = error;
    } finally {
      vi.restoreAllMocks();
    }
    expect(thrown).toBeInstanceOf(RestoreRecoveryError);
    const message = (thrown as Error).message;
    expect(message).toContain("could not be undone");
    expect(message).toContain("ENOENT");
    expect(message).toContain(stagingFolders(stuck.paths)[0]!);
    expect(message).toContain("move old-N back over its target");
    expect(stagingFolders(stuck.paths)).toHaveLength(1);
    // The files are all still in the staging folder, so the same recovery finishes the job once it can.
    expect(recoverInterruptedRestore(stuck.paths)).toHaveLength(1);
    expect(liveState(stuck.paths)).toEqual(stuck.before);

    // Still running in another process: the command says so and exits 1 (the engine waits 10 s first).
    ensureCli();
    const { paths } = await fixture();
    await startHolder(paths.home);
    for (const args of [["backup", "--list"]]) {
      const run = mordomo(paths.home, args);
      expect(run.status, args.join(" ")).toBe(1);
      expect(run.stderr, args.join(" ")).toContain("restore is in progress");
    }
  }, 120_000);

  it("C74 retention that loses a race to another process never fails the backup that was made", async () => {
    // Deterministic halves: a backup that vanishes while it is listed is skipped, and a deletion that fails is
    // not the backup's failure.
    const { paths, backup: first } = await fixture();
    const { db } = openDb(paths);
    try {
      const second = await createBackup(paths, db);
      const real = fs.lstatSync.bind(fs);
      vi.spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
        if (String(p).includes(second.name) && String(p).endsWith("manifest.json")) {
          throw Object.assign(new Error("gone"), { code: "ENOENT" });
        }
        return (real as (...a: unknown[]) => fs.Stats)(p, ...rest);
      }) as typeof fs.lstatSync);
      expect(listBackups(paths).map((b) => b.name)).toEqual([first.name]);
      vi.restoreAllMocks();

      const realRm = fs.rmSync.bind(fs);
      vi.spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
        if (/[\\\\/]full-[^\\\\/]+$/.test(String(p)))
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        return (realRm as (...a: unknown[]) => void)(p, ...rest);
      }) as typeof fs.rmSync);
      await expect(createBackup(paths, db, { keep: 1 })).resolves.toMatchObject({
        name: expect.stringMatching(/^full-/),
      });
      vi.restoreAllMocks();
    } finally {
      db.close();
    }

    // And for real: four processes make and prune backups to 1 at the same moment, several times.
    const script = await bundleChild(
      "backups-together",
      [
        `import { openDb } from ${src("core/src/db/db.ts")};`,
        `import { resolvePaths } from ${src("core/src/paths.ts")};`,
        `import { createBackup, listBackups } from ${src("core/src/backup.ts")};`,
        `import { barrier } from ${src("tests/helpers/barrier.ts")};`,
        "const paths = resolvePaths(process.env.HOME_DIR);",
        "const { db } = openDb(paths);",
        "for (let i = 0; i < 4; i++) {",
        '  barrier(process.env.BARRIER_DIR, "go-" + i, Number(process.env.PARTIES));',
        "  await createBackup(paths, db, { keep: 1 });",
        "  listBackups(paths);",
        "}",
        'process.stdout.write("ok");',
        "db.close();",
      ].join("\n"),
    );
    const real2 = await fixture();
    const barrierDir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-barrier-"));
    cleanups.push(() => fs.rmSync(barrierDir, { recursive: true, force: true }));
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        runChild(script, { HOME_DIR: real2.home, BARRIER_DIR: barrierDir, PARTIES: "4" }),
      ),
    );
    for (const r of results) {
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe("ok");
    }
    expect(listBackups(real2.paths).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("C75 a restore is not an error because its done mark could not be written, and leaves nothing if its first journal cannot", async () => {
    const real = fs.renameSync.bind(fs);
    // N8: the mark that says everything is installed cannot be written.
    const a = await fixture();
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("JOURNAL.json") && fs.readFileSync(from, "utf8").includes('"phase":"done"')) {
        throw new Error("Injected: cannot write the done mark");
      }
      return real(from, to);
    });
    try {
      expect(() => restoreBackup(a.paths, a.backup.name)).not.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
    expect(fs.readFileSync(path.join(a.paths.memory, "note.md"), "utf8")).toBe("note v1\n");
    expect(stagingFolders(a.paths)).toEqual([]);

    // N10: the first journal cannot be written at all.
    const b = await fixture();
    const before = liveState(b.paths);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("JOURNAL.json")) throw new Error("Injected: no journal");
      return real(from, to);
    });
    try {
      expect(() => restoreBackup(b.paths, b.backup.name)).toThrow(/Injected: no journal/);
    } finally {
      vi.restoreAllMocks();
    }
    expect(liveState(b.paths)).toEqual(before);
    expect(stagingFolders(b.paths)).toEqual([]);
  });

  it("C76 backups are ordered by the time in their name, and the same time by name", async () => {
    const { paths, backup } = await fixture();
    const copy = (name: string, createdAt: number) => {
      const dest = path.join(paths.backups, name);
      fs.cpSync(backup.path, dest, { recursive: true });
      const manifestFile = path.join(dest, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { createdAt: number };
      manifest.createdAt = createdAt;
      fs.writeFileSync(manifestFile, JSON.stringify(manifest));
      return dest;
    };
    // Manifests and modification times say the opposite of the names; two names carry the same instant.
    const newest = "full-2026-01-01T00-00-00-000Z-bbbbbb";
    const tie = "full-2026-01-01T00-00-00-000Z-aaaaaa";
    const oldest = "full-2025-12-31T23-59-59-999Z-cccccc";
    const dirs = [copy(newest, 1), copy(tie, 2), copy(oldest, 3)];
    fs.rmSync(backup.path, { recursive: true });
    dirs.forEach((dir, i) => fs.utimesSync(dir, 5000 - i * 1000, 5000 - i * 1000));
    expect(listBackups(paths).map((b) => b.name)).toEqual([newest, tie, oldest]);
    expect(pruneBackups(paths, 1).sort()).toEqual([tie, oldest].sort());
    expect(fs.readdirSync(paths.backups)).toEqual([newest]);
  });

  it("C33 the sidecars leave before the database is replaced", async () => {
    const { paths, backup } = await fixture();
    fs.writeFileSync(`${paths.dbFile}-wal`, "wal");
    fs.writeFileSync(`${paths.dbFile}-shm`, "shm");
    const renames: Array<{ from: string; to: string }> = [];
    const real = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames.push({ from: String(from), to: String(to) });
      real(from, to);
    });
    restoreBackup(paths, backup.name);
    const at = (predicate: (r: { from: string; to: string }) => boolean) => renames.findIndex(predicate);
    const wal = at((r) => r.from === `${paths.dbFile}-wal`);
    const shm = at((r) => r.from === `${paths.dbFile}-shm`);
    const db = at((r) => r.to === paths.dbFile && r.from.includes(".restore-"));
    expect(wal).toBeGreaterThanOrEqual(0);
    expect(shm).toBeGreaterThanOrEqual(0);
    expect(db).toBeGreaterThan(Math.max(wal, shm));
  });

  it("C34 the restore route verifies before it stages", async () => {
    const { paths: seedPaths } = makeTempHome("mordomo-dados-route-");
    cleanups.push(() => fs.rmSync(seedPaths.home, { recursive: true, force: true }));
    const ctx = new AppContext(seedPaths.home);
    const app = await buildServer(ctx);
    const headers = { "x-mordomo-token": ctx.token() };
    const restore = (name: string) =>
      app.inject({ method: "POST", url: `/api/backups/${name}/restore`, headers });
    try {
      write(path.join(ctx.paths.memory, "note.md"), "note");
      const make = async () =>
        (await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} })).json()
          .name as string;

      const tampered = await make();
      flipByte(path.join(ctx.paths.backups, tampered, "memory", "note.md"));
      const refused = await restore(tampered);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error.code).toBe("backup_invalid");
      expect(fs.existsSync(path.join(ctx.paths.config, "restore-pending"))).toBe(false);

      const unsealed = await make();
      fs.rmSync(path.join(ctx.paths.backups, unsealed, "manifest.json"));
      const legacy = await restore(unsealed);
      expect(legacy.statusCode).toBe(422);
      expect(legacy.json().error.code).toBe("backup_unsealed");
      expect(fs.existsSync(path.join(ctx.paths.config, "restore-pending"))).toBe(false);

      expect((await restore("full-2000-01-01")).statusCode).toBe(404);

      const good = await make();
      ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "keep busy",
        cwd: ctx.paths.workspace,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 10_000,
        profile: "read_only",
      });
      expect((await restore(good)).statusCode).toBe(409);
      expect(fs.existsSync(path.join(ctx.paths.config, "restore-pending"))).toBe(false);
    } finally {
      await app.close();
      ctx.close();
    }

    // With no run active an intact backup is staged.
    const calm = makeTempHome("mordomo-dados-route-ok-");
    cleanups.push(calm.cleanup);
    const ok = new AppContext(calm.paths.home);
    const okApp = await buildServer(ok);
    try {
      const okHeaders = { "x-mordomo-token": ok.token() };
      const name = (
        await okApp.inject({ method: "POST", url: "/api/backups", headers: okHeaders, payload: {} })
      ).json().name as string;
      const staged = await okApp.inject({
        method: "POST",
        url: `/api/backups/${name}/restore`,
        headers: okHeaders,
      });
      expect(staged.statusCode).toBe(202);
      expect(readRestorePending(ok.paths)?.name).toBe(name);
    } finally {
      await okApp.close();
      ok.close();
    }
  });

  it("C35 a rejected staged restore does not stop the service", async () => {
    const { paths: seed } = makeTempHome("mordomo-dados-boot-");
    cleanups.push(() => fs.rmSync(seed.home, { recursive: true, force: true }));
    const ctx = new AppContext(seed.home);
    const app = await buildServer(ctx);
    const headers = { "x-mordomo-token": ctx.token() };
    let name: string;
    try {
      ctx.settingsStore.update({ systemName: "BeforeBackup" });
      write(path.join(ctx.paths.memory, "note.md"), "note");
      name = (await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} })).json()
        .name as string;
      ctx.settingsStore.update({ systemName: "AfterBackup" });
      const staged = await app.inject({ method: "POST", url: `/api/backups/${name}/restore`, headers });
      expect(staged.statusCode).toBe(202);
    } finally {
      await app.close();
      ctx.close();
    }
    flipByte(path.join(seed.backups, name, "memory", "note.md"));

    const restarted = new AppContext(seed.home, { applyPendingRestore: true });
    try {
      expect(restarted.restoredAtBoot).toBeNull();
      expect(restarted.restoreRejectedAtBoot?.name).toBe(name);
      expect(restarted.restoreRejectedAtBoot?.message).toContain(name);
      expect(restarted.settings().systemName).toBe("AfterBackup");
      expect(readRestorePending(restarted.paths)).toBeNull();
    } finally {
      restarted.close();
    }
  });

  it("C60 the service tells the owner at boot that a staged restore was refused", async () => {
    const { paths, backup } = await fixture();
    const port = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const free = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(free));
      });
    });
    const store = new SettingsStore(paths);
    store.update({ port, setupCompleted: true });
    writeRestorePending(paths, backup.name);
    flipByte(inBackup(backup, "memory/note.md"));

    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warned.push(args.join(" ")));
    const handle = await startServer(paths.home);
    try {
      expect(warned.join("\n")).toContain(`staged restore of ${backup.name} refused`);
      expect(warned.join("\n")).toContain("checksum memory/note.md");
      expect(handle.ctx.restoreRejectedAtBoot?.name).toBe(backup.name);
      expect(handle.ctx.settings().systemName).toBe("Current");
    } finally {
      await handle.close();
    }
  }, 30_000);

  it("C36 retention deletes only sealed backups beyond the newest", async () => {
    const { paths, backup: legacy } = await fixture();
    fs.rmSync(inBackup(legacy, "manifest.json")); // the oldest backup is one from before backups were sealed
    const { db } = openDb(paths);
    try {
      const make = async () => createBackup(paths, db);
      const sealed = [await make(), await make(), await make(), await make()];
      const outside = path.join(paths.home, "outside-backup");
      fs.mkdirSync(outside);
      if (POSIX) fs.symlinkSync(outside, path.join(paths.backups, "full-link"));
      // Modification times say nothing about age (a copy of the folder resets them): scramble them.
      [legacy, ...sealed].forEach((b, i) =>
        fs.utimesSync(b.path, 1000 + ((i * 7) % 5), 1000 + ((i * 7) % 5)),
      );
      writeRestorePending(paths, sealed[0]!.name); // the oldest sealed one is what a staged restore points at

      const created = await createBackup(paths, db, { keep: 2 });
      const left = fs.readdirSync(paths.backups).sort();
      const expected = [
        created.name,
        sealed[3]!.name,
        legacy.name,
        sealed[0]!.name,
        ...(POSIX ? ["full-link"] : []),
      ].sort();
      expect(left).toEqual(expected);
      expect(fs.existsSync(path.join(outside))).toBe(true);
      expect(listBackups(paths).map((b) => b.name)).toEqual([
        created.name,
        sealed[3]!.name,
        sealed[0]!.name,
        legacy.name,
      ]);
    } finally {
      db.close();
    }
  });

  it("C54 a keep that is not an integer of at least 1 deletes nothing, and backups made together all succeed", async () => {
    const { paths } = await fixture();
    const { db } = openDb(paths);
    try {
      await createBackup(paths, db);
      const before = listBackups(paths).map((b) => b.name);
      for (const keep of [Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
        await expect(createBackup(paths, db, { keep }), String(keep)).rejects.toThrow(RangeError);
        expect(() => pruneBackups(paths, keep), String(keep)).toThrow(RangeError);
      }
      expect(listBackups(paths).map((b) => b.name)).toEqual(before);

      // Three at once (the CLI and the service do this), each pruning to 1: none fails over another's deletion.
      const all = await Promise.allSettled([
        createBackup(paths, db, { keep: 1 }),
        createBackup(paths, db, { keep: 1 }),
        createBackup(paths, db, { keep: 1 }),
      ]);
      expect(all.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
      expect(listBackups(paths).length).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });

  it("C37 the route and the CLI apply the configured retention", async () => {
    const { paths } = makeTempHome("mordomo-dados-keep-");
    cleanups.push(() => fs.rmSync(paths.home, { recursive: true, force: true }));
    const ctx = new AppContext(paths.home);
    const app = await buildServer(ctx);
    try {
      ctx.settingsStore.update({ limits: { ...ctx.settings().limits, backupRetention: 2 } });
      const headers = { "x-mordomo-token": ctx.token() };
      for (let i = 0; i < 4; i++) {
        const res = await app.inject({ method: "POST", url: "/api/backups", headers, payload: {} });
        expect(res.statusCode).toBe(200);
      }
      expect(listBackups(ctx.paths)).toHaveLength(2);
    } finally {
      await app.close();
      ctx.close();
    }

    ensureCli();
    const cli = makeTempHome("mordomo-dados-keep-cli-");
    cleanups.push(cli.cleanup);
    const store = new SettingsStore(cli.paths);
    store.update({ limits: { ...store.load().limits, backupRetention: 2 } });
    const runs = [1, 2, 3].map(() => mordomo(cli.paths.home, ["backup"]));
    for (const run of runs) expect(run.status, run.stderr).toBe(0);
    expect(runs[2]!.stdout).toContain("removed 1 old backup(s)");
    expect(runs[1]!.stdout).not.toContain("removed");
    expect(listBackups(cli.paths)).toHaveLength(2);
  }, 120_000);

  it("C38 the CLI list marks unsealed backups", async () => {
    ensureCli();
    const { paths, backup } = await fixture();
    const { db } = openDb(paths);
    const sealed = await createBackup(paths, db);
    db.close();
    fs.rmSync(inBackup(backup, "manifest.json"));
    const run = mordomo(paths.home, ["backup", "--list"]);
    expect(run.status, run.stderr).toBe(0);
    const line = (name: string) => run.stdout.split("\n").find((l) => l.startsWith(name)) ?? "";
    expect(line(backup.name)).toContain("unsealed");
    expect(line(sealed.name)).not.toContain("unsealed");
    expect(line(sealed.name)).not.toBe("");
  });

  it("C39 the restore command refuses unsealed and tampered backups", async () => {
    ensureCli();
    const legacy = await fixture();
    fs.rmSync(inBackup(legacy.backup, "manifest.json"));
    const refused = mordomo(legacy.home, ["restore", legacy.backup.name]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("--allow-unverified");
    expect(fs.readFileSync(path.join(legacy.paths.memory, "note.md"), "utf8")).toBe("note CURRENT\n");
    const allowed = mordomo(legacy.home, ["restore", legacy.backup.name, "--allow-unverified"]);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(fs.readFileSync(path.join(legacy.paths.memory, "note.md"), "utf8")).toBe("note v1\n");

    const tampered = await fixture();
    flipByte(inBackup(tampered.backup, "memory/note.md"));
    const bad = mordomo(tampered.home, ["restore", tampered.backup.name]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("memory/note.md");
    expect(fs.readFileSync(path.join(tampered.paths.memory, "note.md"), "utf8")).toBe("note CURRENT\n");

    expect(mordomo(tampered.home, ["restore"]).status).toBe(2);
  }, 120_000);

  it("C40 a backup from an older schema restores and migrates", async () => {
    const home = makeTempHome("mordomo-dados-old-");
    cleanups.push(home.cleanup);
    const { paths } = home;
    const older = MIGRATIONS.slice(0, MIGRATIONS.length - 3);
    const first = openDb(paths, older);
    first.db.prepare("INSERT INTO meta (key, value) VALUES ('kept', 'row')").run();
    const backup = await createBackup(paths, first.db);
    first.db.prepare("DELETE FROM meta WHERE key = 'kept'").run();
    first.db.close();

    restoreBackup(paths, backup.name);
    const migrated = openDb(paths);
    try {
      expect(migrated.migration).toMatchObject({
        fromVersion: older.length,
        toVersion: MIGRATIONS.length,
      });
      expect(migrated.db.prepare("SELECT value FROM meta WHERE key = 'kept'").get()).toEqual({
        value: "row",
      });
    } finally {
      migrated.db.close();
    }
  });
});

// ---- the built CLI (as tests/cli.test.ts) ---------------------------------------------------------------------

const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
/**
 * The CLI proofs run the built artifact, so it is built (incrementally: nothing is rebuilt when nothing changed)
 * once per run - not trusted when it merely exists, a stale one would prove the old code.
 */
let cliBuilt = false;
function ensureCli(): void {
  if (cliBuilt) return;
  const build = spawnSync(
    "npx",
    ["tsc", "-b", "contracts", "core", "adapters/claude", "adapters/cursor", "adapters/codex", "apps/api"],
    { cwd: repoRoot, encoding: "utf8", timeout: 600_000 },
  );
  if (build.status !== 0 || !fs.existsSync(CLI)) {
    throw new Error(`building ${CLI} failed:\n${build.stdout}${build.stderr}`);
  }
  cliBuilt = true;
}
function mordomo(home: string, args: string[]) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      MORDOMO_HOME: home,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      PATH: path.dirname(process.execPath),
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
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
  processStartMarker,
  readRestorePending,
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
const stagingFolders = (paths: MordomoPaths) =>
  fs.readdirSync(paths.home).filter((n) => n.startsWith(".restore-"));

/** A home with something in every set, a backup of it, and live files that have moved on since. */
async function fixture(options: { link?: boolean } = {}) {
  const home = makeTempHome("mordomo-dados-backup-");
  cleanups.push(home.cleanup);
  const { paths } = home;
  write(path.join(paths.skills, "x", "SKILL.md"), "skill v1\n");
  write(path.join(paths.memory, "note.md"), "note v1\n");
  write(path.join(paths.routines, "r.json"), '{"id":"r"}');
  write(path.join(paths.connectors, "c.json"), '{"id":"c"}');
  if (options.link && POSIX)
    fs.symlinkSync(path.join(paths.skills, "x", "SKILL.md"), path.join(paths.skills, "x", "link"));
  new SettingsStore(paths).save(SettingsSchema.parse({ systemName: "Backed" }));
  const { db } = openDb(paths);
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
async function crashedRestore(env: Record<string, string>) {
  const fx = await fixture();
  const before = liveState(fx.paths);
  const result = await runChild(await killer(), { HOME_DIR: fx.home, BACKUP_NAME: fx.backup.name, ...env });
  expect(result.signal, result.stderr).toBe("SIGKILL");
  expect(stagingFolders(fx.paths)).toHaveLength(1);
  return { ...fx, before };
}
const MARKER_KNOWN = processStartMarker(process.pid) !== null;

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

  it("C32 a restore in progress is left alone", async () => {
    const { paths } = await fixture();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    children.push(child);
    await new Promise((resolve) => child.once("spawn", resolve));
    const staging = path.join(paths.home, `.restore-${child.pid}-abc123`);
    const moved = path.join(paths.memory);
    write(path.join(staging, "old-0", "note.md"), "the original");
    write(
      path.join(staging, "JOURNAL.json"),
      JSON.stringify({
        pid: child.pid,
        procStart: processStartMarker(child.pid!),
        phase: "installing",
        entries: [
          {
            target: moved,
            old: path.join(staging, "old-0"),
            staged: path.join(staging, "new-0"),
            hadTarget: true,
          },
        ],
      }),
    );
    const before = liveState(paths);
    expect(recoverInterruptedRestore(paths)).toEqual([]);
    expect(fs.existsSync(path.join(staging, "old-0", "note.md"))).toBe(true);
    expect(liveState(paths)).toEqual(before);

    // The same journal once its process is gone is undone.
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
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

    // A restore that is still running is refused, not sealed.
    const live = await fixture();
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    children.push(owner);
    await new Promise((resolve) => owner.once("spawn", resolve));
    write(
      path.join(live.paths.home, `.restore-${owner.pid}-abc123`, "JOURNAL.json"),
      JSON.stringify({
        pid: owner.pid,
        procStart: processStartMarker(owner.pid!),
        phase: "installing",
        entries: [],
      }),
    );
    const { db: liveDb } = openDb(live.paths);
    try {
      await expect(createBackup(live.paths, liveDb)).rejects.toThrow(/restore is in progress/);
    } finally {
      liveDb.close();
    }
  }, 120_000);

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

  it.skipIf(!MARKER_KNOWN)(
    "C56 the journal names the process by its start, so a recycled pid is not mistaken for it",
    async () => {
      // The restore that wrote this journal is dead; its pid now belongs to a live program that started later.
      const crashed = await crashedRestore({ KILL_AT: "9" });
      const staging = path.join(crashed.paths.home, stagingFolders(crashed.paths)[0]!);
      const journalFile = path.join(staging, "JOURNAL.json");
      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as { pid: number; procStart: unknown };
      expect(typeof journal.procStart).toBe("string");
      expect(String(journal.procStart)).toMatch(/^(linux:|ps:|win:)/);
      const stranger = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      children.push(stranger);
      await new Promise((resolve) => stranger.once("spawn", resolve));
      // The stranger takes the dead owner's place in the journal: a live pid whose start is not the recorded one.
      fs.writeFileSync(journalFile, JSON.stringify({ ...journal, pid: stranger.pid }));
      recoverInterruptedRestore(crashed.paths);
      expect(liveState(crashed.paths)).toEqual(crashed.before);
      expect(stagingFolders(crashed.paths)).toEqual([]);
    },
    60_000,
  );

  it("C57 a folder without a journal is debris only once its process is gone", async () => {
    const { paths } = await fixture();
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    children.push(owner);
    await new Promise((resolve) => owner.once("spawn", resolve));
    const mine = path.join(paths.home, `.restore-${owner.pid}-xyz789`);
    fs.mkdirSync(mine);
    expect(recoverInterruptedRestore(paths)).toEqual([]);
    expect(fs.existsSync(mine)).toBe(true);

    const exited = new Promise((resolve) => owner.once("exit", resolve));
    owner.kill("SIGKILL");
    await exited;
    expect(recoverInterruptedRestore(paths)).toEqual([path.basename(mine)]);
    expect(fs.existsSync(mine)).toBe(false);
  });

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
/** The CLI proofs run the built artifact: build it when it is missing instead of passing without asserting. */
function ensureCli(): void {
  if (fs.existsSync(CLI)) return;
  const build = spawnSync(
    "npx",
    ["tsc", "-b", "contracts", "core", "adapters/claude", "adapters/cursor", "adapters/codex", "apps/api"],
    { cwd: repoRoot, encoding: "utf8", timeout: 600_000 },
  );
  if (build.status !== 0 || !fs.existsSync(CLI)) {
    throw new Error(`${CLI} is missing and building it failed:\n${build.stdout}${build.stderr}`);
  }
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

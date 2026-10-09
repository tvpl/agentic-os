import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn as spawnProcess } from "node:child_process";
import type * as ChildProcess from "node:child_process";
import type { FastifyInstance } from "fastify";
import ts from "typescript";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import {
  PathAccessError,
  checkWorkspacePath,
  makeWorkspaceFilter,
  previewFile,
  resolveOpenablePath,
} from "@mordomo/core";
import { inspectRepo, runGit, GIT_NEUTRAL_ARGS, NULL_DEVICE } from "../apps/api/src/routes/git.js";
import { findOnPath, createBackup, JsonlLogger, events } from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

/**
 * Security P1 (.specs/features/seguranca-p1): the home's config/ and logs/ are
 * not served, git does not run what a repository says, the home is private to
 * its owner, and the event stream recovers from a restart.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OPENERS = new Set(["open", "xdg-open", "explorer.exe"]);
const spawned: string[] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (command: string, ...rest: unknown[]) => {
      if (OPENERS.has(command)) {
        spawned.push(command);
        const fake = new EventEmitter() as EventEmitter & { unref: () => void };
        fake.unref = () => undefined;
        return fake;
      }
      return (actual.spawn as (...a: unknown[]) => unknown)(command, ...rest);
    },
  };
});

let ctx: AppContext;
let app: FastifyInstance;
let ownerToken: string;
let deviceToken: string;
let home: string;
let userFolder: string;
let cleanup: () => void;

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const asOwner = () => ({ "x-mordomo-token": ownerToken, "content-type": "application/json" });
const asDevice = () => ({
  "x-mordomo-token": deviceToken,
  "content-type": "application/json",
  host: "mordomo.local:4777",
});

const preview = (p: string, headers: Record<string, string>) =>
  app.inject({ method: "GET", url: `/api/memory/preview?p=${encodeURIComponent(p)}`, headers });

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-sp1-");
  cleanup = tmp.cleanup;
  // Resolve once so every expectation below speaks real paths (macOS /var -> /private/var).
  home = fs.realpathSync(tmp.paths.home);
  ctx = new AppContext(tmp.paths.home);
  userFolder = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-sp1-user-"));
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.remote.allowedHosts = ["mordomo.local"];
  settings.indexedFolders = [{ path: userFolder, area: null, enabled: true }];
  ctx.settingsStore.save(settings);
  ownerToken = ctx.token();
  app = await buildServer(ctx);

  const start = await app.inject({ method: "POST", url: "/api/pair/start", headers: asOwner(), payload: {} });
  const claim = await app.inject({
    method: "POST",
    url: "/api/pair/claim",
    payload: { code: (start.json() as { code: string }).code, name: "lost phone" },
  });
  deviceToken = (claim.json() as { token: string }).token;

  // Everything the home keeps that a paired device must never read.
  write(path.join(home, "config", "vapid.json"), '{"privateKey":"VAPID-PRIVATE"}');
  write(path.join(home, "config", "registry-signing.json"), '{"secret":"SIGNING-SECRET"}');
  write(path.join(home, "config", "ui-preferences.json"), '{"theme":"x"}');
  write(path.join(home, "config", "tls", "key.pem"), "-----BEGIN PRIVATE KEY-----");
  write(path.join(home, "config", "backups", "x", "a.json"), '{"backup":true}');
  write(path.join(home, "logs", "runs.jsonl"), '{"prompt":"PROMPT-TEXT"}\n');
  // Things that stay readable.
  write(path.join(home, "memory", "note.md"), "# note\nNOTE-BODY\n");
  write(path.join(home, "skills", "x", "SKILL.md"), "# skill\nSKILL-BODY\n");
  write(path.join(home, "artifacts", "r1", "out.txt"), "ARTIFACT-BODY\n");
  write(path.join(userFolder, "config", "app.json"), '{"user":"CONFIG-OF-A-PROJECT"}');
});

afterAll(async () => {
  await ctx.runs.shutdown(2000);
  await app.close();
  ctx.close();
  fs.rmSync(userFolder, { recursive: true, force: true });
  cleanup();
});

/** The files of the home that hold credentials or run output (S1 coverage row). */
const HOME_SECRETS = [
  "config/token",
  "config/vapid.json",
  "config/registry-signing.json",
  "config/settings.json",
  "config/ui-preferences.json",
  "config/db/mordomo.db",
  "config/tls/key.pem",
  "config/backups/x/a.json",
  "logs/runs.jsonl",
];

describe("S1 the home is not readable through the API", () => {
  it("C1 no file under the home's config or logs is previewable", async () => {
    for (const rel of HOME_SECRETS) {
      expect(fs.existsSync(path.join(home, rel)), `${rel} exists`).toBe(true);
      for (const [who, headers] of [
        ["device", asDevice()],
        ["owner", asOwner()],
      ] as const) {
        const res = await preview(path.join(home, rel), headers);
        expect(res.statusCode, `${who} ${rel}`).toBe(403);
        expect(res.json().error.code, `${who} ${rel}`).toBe("forbidden_path");
        expect(res.body, `${who} ${rel}`).not.toContain(ownerToken);
        expect(res.body, `${who} ${rel}`).not.toContain("SIGNING-SECRET");
      }
    }
  });

  it("C2 path tricks do not reach the config directory", async () => {
    const aliasHome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-sp1-alias-")), "h");
    fs.symlinkSync(home, aliasHome);
    fs.symlinkSync(path.join(home, "config", "token"), path.join(home, "memory", "to-token"));
    fs.symlinkSync(path.join(home, "config"), path.join(home, "memory", "to-config"));
    try {
      const tricks: Record<string, string> = {
        "dot-dot": `${home}/config/../config/token`,
        "dot-dot via memory": `${home}/memory/../config/token`,
        "file symlink": path.join(home, "memory", "to-token"),
        "directory symlink": path.join(home, "memory", "to-config", "token"),
        "home reached through a symlink": path.join(aliasHome, "config", "token"),
        "trailing dot": `${home}/config/token.`,
        "double slash": `${home}/config//token`,
        "trailing slash on the directory": `${home}/config/`,
        "logs by dot-dot": `${home}/logs/../logs/runs.jsonl`,
      };
      for (const [name, p] of Object.entries(tricks)) {
        const res = await preview(p, asDevice());
        expect(res.statusCode, name).toBe(403);
        expect(res.json().error.code, name).toBe("forbidden_path");
      }
    } finally {
      fs.rmSync(path.dirname(aliasHome), { recursive: true, force: true });
    }

    // A case-insensitive file system (darwin, win32) is simulated through the filter's platform argument.
    const settings = ctx.settings();
    for (const platform of ["darwin", "win32"] as const) {
      for (const p of [`${home}/CONFIG/token`, `${home}/Config/Token`, `${home}/LOGS/runs.jsonl`]) {
        expect(
          () => previewFile(settings, [home], p, { homeDir: home, platform }),
          `${platform} ${p}`,
        ).toThrow(PathAccessError);
      }
    }
    // On a case-sensitive file system `CONFIG` is another directory, not the private one.
    expect(() =>
      checkWorkspacePath(settings, [home], `${home}/CONFIG/token`, { homeDir: home, platform: "linux" }),
    ).not.toThrow();
    // Windows drops trailing dots and spaces from a directory name.
    expect(() =>
      checkWorkspacePath(settings, [home], `${home}/config./token`, { homeDir: home, platform: "win32" }),
    ).toThrow(PathAccessError);
  });

  it("C3 memory, skills and artifacts stay previewable", async () => {
    const served: Record<string, string> = {
      "memory/note.md": "NOTE-BODY",
      "skills/x/SKILL.md": "SKILL-BODY",
      "artifacts/r1/out.txt": "ARTIFACT-BODY",
    };
    for (const [rel, marker] of Object.entries(served)) {
      for (const headers of [asDevice(), asOwner()]) {
        const res = await preview(path.join(home, rel), headers);
        expect(res.statusCode, rel).toBe(200);
        expect(res.json().kind, rel).toBe("text");
        expect(res.json().content, rel).toContain(marker);
      }
    }
  });

  it("C4 open and index refuse the home config; user config folders stay readable", async () => {
    // POST /api/memory/open: documents of the home's config/ and logs/ do not reach the OS opener.
    spawned.length = 0;
    for (const rel of [
      "config/token",
      "config/settings.json",
      "config/ui-preferences.json",
      "logs/x",
      "logs/runs.jsonl",
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/open",
        headers: asOwner(),
        payload: { p: path.join(home, rel) },
      });
      expect(res.statusCode, rel).toBe(403);
      expect(res.json().error.code, rel).toBe("forbidden_path");
    }
    expect(spawned).toEqual([]);
    const ok = await app.inject({
      method: "POST",
      url: "/api/memory/open",
      headers: asOwner(),
      payload: { p: path.join(home, "memory", "note.md") },
    });
    expect(ok.statusCode).toBe(200);
    expect(() =>
      resolveOpenablePath(ctx.settings(), [home], path.join(home, "config", "token"), { homeDir: home }),
    ).toThrow(PathAccessError);

    // The indexer: the home as an indexed root still skips config/ and logs/.
    write(path.join(home, "config", "note.md"), "# CONFIG-NOTE zebra\n");
    write(path.join(home, "logs", "note.md"), "# LOG-NOTE zebra\n");
    ctx.settingsStore.update({
      indexedFolders: [
        { path: userFolder, area: null, enabled: true },
        { path: home, area: null, enabled: true },
      ],
    });
    ctx.indexer.indexAll();
    const indexed = (ctx.db.prepare("SELECT path FROM files").all() as Array<{ path: string }>).map(
      (r) => r.path,
    );
    expect(indexed.some((p) => p.endsWith(path.join("memory", "note.md")))).toBe(true);
    expect(
      indexed.filter((p) => p.startsWith(path.join(home, "config")) || p.startsWith(path.join(home, "logs"))),
    ).toEqual([]);
    // door 1: a config/ folder in a user's project is indexed and previewed.
    expect(indexed).toContain(path.join(fs.realpathSync(userFolder), "config", "app.json"));
    const userConfig = await preview(path.join(userFolder, "config", "app.json"), asDevice());
    expect(userConfig.statusCode).toBe(200);
    expect(userConfig.json().content).toContain("CONFIG-OF-A-PROJECT");

    // The filter itself, member by member.
    const filter = makeWorkspaceFilter([], { homeDir: home });
    const verdicts: Array<[string, boolean]> = [
      [`${home}/config`, true],
      [`${home}/config/token`, true],
      [`${home}/config/db/mordomo.db`, true],
      [`${home}/logs/runs.jsonl`, true],
      [`${home}/memory/config/x.md`, false],
      [`${home}/projects/config/x.md`, false],
      [`${home}/configuration/x.md`, false],
      [`${home}/logs-archive/x.md`, false],
      [`${userFolder}/config/app.json`, false],
      [`${userFolder}/logs/app.log`, false],
    ];
    for (const [p, blocked] of verdicts) {
      expect(filter.isExcluded(path.relative(home, p), p), p).toBe(blocked);
    }
  });
});

describe("S1 an agent is not started inside the home's credentials folders", () => {
  it("C18 a run cannot start with its working directory in config or logs", async () => {
    // The provider must be on for the request to reach the working directory check.
    ctx.settingsStore.update({ providers: { claude: { enabled: true } } });
    for (const rel of ["config", "config/db", "config/tls", "logs"]) {
      fs.mkdirSync(path.join(home, rel), { recursive: true });
      for (const [who, headers] of [
        ["device", asDevice()],
        ["owner", asOwner()],
      ] as const) {
        const res = await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          payload: { prompt: "ls", provider: "claude", mode: "read_only", cwd: path.join(home, rel) },
        });
        expect(res.statusCode, `${who} ${rel}: ${res.body}`).toBe(403);
        expect(res.json().error.code, `${who} ${rel}`).toBe("forbidden_path");
      }
    }
    // The home itself and its content folders stay valid working directories.
    expect(ctx.resolveCwd(path.join(home, "memory"))).toBe(fs.realpathSync(path.join(home, "memory")));
  });
});

// ---------------------------------------------------------------------------
describe("S2 the diff does not run what the repository says", () => {
  const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-sp1-git-"));

  /** One recorded invocation of the fake git: its argv and the two config variables. */
  interface Call {
    args: string[];
    env: Record<string, string>;
  }
  const fakeGit = (dir: string) => {
    // A repository git is pointed at: `.git` is a real directory of the work tree (runGit refuses anything else).
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    const bin = path.join(dir, "git");
    fs.writeFileSync(
      bin,
      [
        "#!/bin/sh",
        '{ echo "#CALL"; for a in "$@"; do printf "A:%s\\n" "$a"; done;',
        '  printf "E:GIT_CONFIG_NOSYSTEM=%s\\nE:GIT_CONFIG_GLOBAL=%s\\nE:GIT_LITERAL_PATHSPECS=%s\\nE:GIT_DIR=%s\\nE:GIT_WORK_TREE=%s\\nE:GIT_COMMON_DIR=%s\\nE:GIT_INDEX_FILE=%s\\n" "$GIT_CONFIG_NOSYSTEM" "$GIT_CONFIG_GLOBAL" "$GIT_LITERAL_PATHSPECS" "$GIT_DIR" "$GIT_WORK_TREE" "$GIT_COMMON_DIR" "$GIT_INDEX_FILE"; } >> "$FAKE_GIT_LOG"',
        'for a in "$@"; do if [ "$a" = config ]; then printf "%s" "$FAKE_GIT_CONFIG"; fi; done',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const log = path.join(dir, "calls.log");
    const calls = (): Call[] =>
      (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "")
        .split("#CALL\n")
        .filter(Boolean)
        .map((block) => {
          const lines = block.split("\n").filter(Boolean);
          const args = lines.filter((l) => l.startsWith("A:")).map((l) => l.slice(2));
          const env = Object.fromEntries(
            lines.filter((l) => l.startsWith("E:")).map((l) => l.slice(2).split("=") as [string, string]),
          );
          return { args, env };
        });
    return { bin, log, calls };
  };
  /** The `-c key=value` pairs before the subcommand, and the subcommand with what follows it. */
  const split = (args: string[]) => {
    const globals: string[] = [];
    const overrides: string[] = [];
    let i = 0;
    while (args[i]?.startsWith("--")) globals.push(args[i++]!);
    while (args[i] === "-c") {
      overrides.push(args[i + 1]!);
      i += 2;
    }
    return { globals, overrides, sub: args[i]!, after: args.slice(i + 1) };
  };

  it("C5 every git call of the diff route is neutralised", async () => {
    const dir = scratch();
    const fake = fakeGit(dir);
    process.env.FAKE_GIT_LOG = fake.log;
    try {
      process.env.FAKE_GIT_CONFIG = "user.name\nfilter.evil.clean\nfilter.evil.smudge\nfilter.lfs.process\n";
      const invocations: string[][] = [
        ["diff", "--no-color", "HEAD", "--", "a.txt"],
        ["diff", "--no-color", "--", "a.txt"],
        ["status", "--porcelain", "--untracked-files=all", "--", "a.txt"],
        ["rev-parse", "HEAD"],
      ];
      for (const args of invocations) await runGit(fake.bin, dir, args);
      const calls = fake.calls();
      // Each diff/status is preceded by one config listing; rev-parse is not.
      expect(calls.map((c) => split(c.args).sub)).toEqual([
        "config",
        "diff",
        "config",
        "diff",
        "config",
        "status",
        "rev-parse",
      ]);
      for (const call of calls) {
        const { overrides } = split(call.args);
        for (const pair of [
          "core.fsmonitor=false",
          `core.hooksPath=${NULL_DEVICE}`,
          "core.sshCommand=",
          "protocol.ext.allow=never",
        ]) {
          expect(overrides, `${call.args.join(" ")}`).toContain(pair);
        }
        expect(call.env.GIT_CONFIG_NOSYSTEM).toBe("1");
        expect(call.env.GIT_CONFIG_GLOBAL).toBe(NULL_DEVICE);
        // The pathspec is literal and the repository's location is ours, on every call (C39, C40).
        expect(call.env.GIT_LITERAL_PATHSPECS).toBe("1");
        const { globals } = split(call.args);
        expect(globals, `${call.args.join(" ")}`).toEqual(
          expect.arrayContaining([
            "--literal-pathspecs",
            `--git-dir=${path.join(dir, ".git")}`,
            `--work-tree=${dir}`,
          ]),
        );
      }
      for (const call of calls.filter((c) => split(c.args).sub === "diff")) {
        const { after, overrides } = split(call.args);
        expect(after).toEqual(expect.arrayContaining(["--no-textconv", "--no-ext-diff"]));
        // Drivers the repository declares are emptied by name.
        for (const pair of [
          "filter.evil.clean=",
          "filter.evil.smudge=",
          "filter.lfs.process=",
          "filter.evil.required=false",
        ]) {
          expect(overrides).toContain(pair);
        }
      }
      // A driver name git cannot take on a -c line is refused, not run.
      fs.rmSync(fake.log);
      process.env.FAKE_GIT_CONFIG = "filter.a=b.clean\n";
      const refused = await runGit(fake.bin, dir, ["diff", "--no-color", "--", "a.txt"]);
      expect(refused.exitCode).toBeNull();
      expect(fake.calls().map((c) => split(c.args).sub)).toEqual(["config"]);
    } finally {
      delete process.env.FAKE_GIT_LOG;
      delete process.env.FAKE_GIT_CONFIG;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C40 git's own environment is not inherited from the service", async () => {
    const dir = scratch();
    const fake = fakeGit(dir);
    process.env.FAKE_GIT_LOG = fake.log;
    process.env.FAKE_GIT_CONFIG = "user.name\n";
    const hostile = {
      GIT_DIR: "/elsewhere/.git",
      GIT_WORK_TREE: "/elsewhere",
      GIT_COMMON_DIR: "/c",
      GIT_INDEX_FILE: "/i",
    };
    Object.assign(process.env, hostile);
    try {
      await runGit(fake.bin, dir, ["diff", "--no-color", "--", "a.txt"]);
      const calls = fake.calls();
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        for (const name of Object.keys(hostile))
          expect(call.env[name] ?? "", `${name} in ${call.args.join(" ")}`).toBe("");
      }
    } finally {
      for (const name of Object.keys(hostile)) delete process.env[name];
      delete process.env.FAKE_GIT_LOG;
      delete process.env.FAKE_GIT_CONFIG;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C40 a repository that points git elsewhere is refused, not run", async () => {
    const dir = scratch();
    const fake = fakeGit(dir);
    process.env.FAKE_GIT_LOG = fake.log;
    try {
      // a config that includes another file makes git parse a file the repository chose
      for (const config of [
        "include.path\n",
        "includeif.gitdir:/x/.path\n",
        "user.name\nIncludeIf.onbranch:x.Path\n",
      ]) {
        process.env.FAKE_GIT_CONFIG = config;
        fs.rmSync(fake.log, { force: true });
        const refused = await runGit(fake.bin, dir, ["diff", "--no-color", "--", "a.txt"]);
        expect(refused.exitCode, config).toBeNull();
        expect(
          fake.calls().map((c) => split(c.args).sub),
          config,
        ).toEqual(["config"]);
      }
      // where `.git` is, and what it is: a real directory, no gitfile, no link, no alternates, no commondir
      const shapes: Array<[string, (d: string) => void, boolean]> = [
        ["a real .git directory", () => undefined, true],
        [
          "a .git file (gitdir: elsewhere)",
          (d) => (
            fs.rmSync(path.join(d, ".git"), { recursive: true }),
            fs.writeFileSync(path.join(d, ".git"), "gitdir: /x\n")
          ),
          false,
        ],
        [
          "a .git symlink",
          (d) => (
            fs.rmSync(path.join(d, ".git"), { recursive: true }),
            fs.symlinkSync(os.tmpdir(), path.join(d, ".git"))
          ),
          false,
        ],
        ["no .git at all", (d) => fs.rmSync(path.join(d, ".git"), { recursive: true }), false],
        [
          "alternate object stores",
          (d) => (
            fs.mkdirSync(path.join(d, ".git", "objects", "info"), { recursive: true }),
            fs.writeFileSync(path.join(d, ".git", "objects", "info", "alternates"), "/x\n")
          ),
          false,
        ],
        [
          "a linked worktree's commondir",
          (d) => fs.writeFileSync(path.join(d, ".git", "commondir"), "../..\n"),
          false,
        ],
      ];
      for (const [name, shape, accepted] of shapes) {
        const repo = scratch();
        fs.mkdirSync(path.join(repo, ".git"));
        shape(repo);
        expect(inspectRepo(repo) !== null, name).toBe(accepted);
        fs.rmSync(repo, { recursive: true, force: true });
      }
    } finally {
      delete process.env.FAKE_GIT_LOG;
      delete process.env.FAKE_GIT_CONFIG;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C28 diff and status never enter a submodule's own repository", async () => {
    const dir = scratch();
    const fake = fakeGit(dir);
    process.env.FAKE_GIT_LOG = fake.log;
    process.env.FAKE_GIT_CONFIG = "user.name\n";
    try {
      const wanted: Array<[string, string[]]> = [
        ["diff", ["diff", "--no-color", "HEAD", "--", "a.txt"]],
        ["diff", ["diff", "--no-color", "--", "a.txt"]],
        ["status", ["status", "--porcelain", "--untracked-files=all", "--", "a.txt"]],
      ];
      for (const [, args] of wanted) await runGit(fake.bin, dir, args);
      const calls = fake.calls().filter((c) => ["diff", "status"].includes(split(c.args).sub));
      expect(calls.map((c) => split(c.args).sub)).toEqual(["diff", "diff", "status"]);
      for (const call of calls) {
        const { after, sub } = split(call.args);
        expect(after, `${sub} carries --ignore-submodules=all`).toContain("--ignore-submodules=all");
        // placed before the pathspec separator, so git reads it as an option and not as a path
        expect(after.indexOf("--ignore-submodules=all"), sub).toBeLessThan(after.indexOf("--"));
      }
    } finally {
      delete process.env.FAKE_GIT_LOG;
      delete process.env.FAKE_GIT_CONFIG;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C6 a hostile repository config does not run on diff", async () => {
    const gitPath = findOnPath("git");
    expect(gitPath, "git must be installed to prove C6").not.toBeNull();
    const dir = scratch();
    const repo = path.join(home, "hostile");
    const markers = path.join(dir, "markers");
    fs.mkdirSync(markers);
    const mark = path.join(dir, "mark.sh");
    // $1 names the vector; textconv and the external diff get a file argument to echo back.
    fs.writeFileSync(mark, `#!/bin/sh\ntouch "${markers}/$1"\n[ -f "$2" ] && cat "$2"\nexit 0\n`, {
      mode: 0o755,
    });
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: NULL_DEVICE, GIT_CONFIG_SYSTEM: NULL_DEVICE };
    const git = (...args: string[]) =>
      execFileSync(gitPath!, ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: repo,
        env: gitEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    const hook = (hooksDir: string, name: string) => {
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.writeFileSync(path.join(hooksDir, name), `#!/bin/sh\ntouch "${markers}/hook-${name}"\nexit 0\n`, {
        mode: 0o755,
      });
    };
    try {
      fs.mkdirSync(repo);
      git("init", "-q");
      write(path.join(repo, "a.txt"), "one\ntwo\n");
      write(path.join(repo, ".gitattributes"), "a.txt filter=evil diff=evil\n");
      git("add", ".");
      git("commit", "-q", "-m", "init");
      write(path.join(repo, "a.txt"), "one\nTWO-CHANGED\n");
      // Hostile config goes in after the setup commands, which must not trigger it.
      git("config", "core.fsmonitor", `${mark} fsmonitor`);
      git("config", "diff.evil.textconv", `${mark} textconv`);
      git("config", "diff.external", `${mark} external`);
      git("config", "filter.evil.clean", `${mark} filter-clean`);
      git("config", "filter.evil.smudge", `${mark} filter-smudge`);
      for (const name of ["post-index-change", "fsmonitor-watchman", "pre-commit"]) {
        hook(path.join(repo, ".git", "hooks"), name);
        hook(path.join(dir, "hooks"), name);
      }
      git("config", "core.hooksPath", path.join(dir, "hooks"));

      // Control: the unprotected commands do fire the vectors, so an empty marker directory means something.
      execFileSync(gitPath!, ["diff", "HEAD", "--", "a.txt"], { cwd: repo, env: gitEnv, stdio: "ignore" });
      // (an external diff driver replaces textconv, so textconv is exercised without it)
      execFileSync(gitPath!, ["diff", "--no-ext-diff", "HEAD", "--", "a.txt"], {
        cwd: repo,
        env: gitEnv,
        stdio: "ignore",
      });
      execFileSync(gitPath!, ["status", "--porcelain"], { cwd: repo, env: gitEnv, stdio: "ignore" });
      const fired = fs.readdirSync(markers);
      // Hook scripts never fire on diff/status (only through core.fsmonitor), so they are
      // asserted absent below but cannot be part of the control; C5 proves the hooksPath flag.
      for (const vector of ["fsmonitor", "textconv", "external", "filter-clean"])
        expect(fired, "control").toContain(vector);
      for (const name of fired) fs.rmSync(path.join(markers, name));

      const runId = ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "diff test",
        cwd: repo,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
      }).id;
      for (const headers of [asOwner(), asDevice()]) {
        const res = await app.inject({ method: "GET", url: `/api/runs/${runId}/diff?file=a.txt`, headers });
        expect(res.statusCode).toBe(200);
        expect(res.json().kind).toBe("git");
        expect(res.json().diff).toContain("+TWO-CHANGED");
      }
      // The untracked-file branch runs `status` too.
      write(path.join(repo, "new.txt"), "brand new\n");
      const untracked = await app.inject({
        method: "GET",
        url: `/api/runs/${runId}/diff?file=new.txt`,
        headers: asOwner(),
      });
      expect(untracked.statusCode).toBe(200);
      expect(fs.readdirSync(markers)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("extra: git is spawned only through the neutralising helper", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "dist") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || full.endsWith(path.join("routes", "git.ts"))) continue;
        const source = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.ESNext, true);
        const visit = (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            /^(safeSpawn|spawn|spawnSync|execFile|execFileSync|exec|execSync)$/.test(
              node.expression.getText(),
            )
          ) {
            const first = node.arguments[0]?.getText() ?? "";
            if (/git/i.test(first))
              offenders.push(`${path.relative(repoRoot, full)}: ${node.expression.getText()}(${first})`);
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    walk(path.join(repoRoot, "apps", "api", "src"));
    walk(path.join(repoRoot, "core", "src"));
    expect(offenders).toEqual([]);
    expect(GIT_NEUTRAL_ARGS).toContain("core.fsmonitor=false");
  });
});

// ---------------------------------------------------------------------------
const POSIX = process.platform !== "win32";
const modeOf = (p: string) => fs.statSync(p).mode & 0o777;

describe("S3 the home is private to its owner", () => {
  const homes: string[] = [];
  const newHome = () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-sp1-priv-"));
    homes.push(h);
    return h;
  };
  afterAll(() => {
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
  });
  /** Directories and files that must be owner-only once an engine has been mounted on `h`. */
  const privateDirs = (h: string) =>
    ["config", "config/db", "config/backups", "logs", "config/run"].map((r) => path.join(h, r));

  it("C7 a new home is private to its owner", async () => {
    if (!POSIX) return; // modes do not exist on Windows (docs/security.md)
    const previous = process.umask(0o022); // the typical shared-machine mask this fix must not depend on
    try {
      const h = newHome();
      const engine = new AppContext(h);
      try {
        engine.token();
        const logger = new JsonlLogger(engine.paths.logs, "p1", 1_000_000, 7);
        logger.append({ hello: "world" });
        const backup = await createBackup(engine.paths, engine.db);
        for (const dir of privateDirs(h)) expect(modeOf(dir).toString(8), dir).toBe("700");
        const files = [
          engine.paths.dbFile,
          path.join(engine.paths.logs, "p1.jsonl"),
          path.join(backup.path, "config", "db", "mordomo.db"),
          engine.paths.tokenFile,
          ...["-wal", "-shm"].map((x) => engine.paths.dbFile + x).filter((f) => fs.existsSync(f)),
        ];
        for (const file of files) expect(modeOf(file).toString(8), file).toBe("600");
        expect(modeOf(backup.path).toString(8)).toBe("700");
      } finally {
        engine.close();
      }
    } finally {
      process.umask(previous);
    }
  });

  it("C8 an existing home is tightened once", () => {
    if (!POSIX) return;
    const h = newHome();
    const first = new AppContext(h);
    first.token();
    new JsonlLogger(first.paths.logs, "old", 1_000_000, 7).append({ a: 1 });
    fs.mkdirSync(path.join(first.paths.backups, "old-backup", "config", "db"), { recursive: true });
    fs.writeFileSync(path.join(first.paths.backups, "old-backup", "config", "db", "mordomo.db"), "x");
    fs.writeFileSync(path.join(first.paths.backups, "mordomo.db.v1.bak"), "x");
    first.close();
    // A home made by an older version: everything with the process mask.
    const dirs = [...privateDirs(h), path.join(h, "config", "backups", "old-backup")];
    const files = [
      path.join(h, "config", "db", "mordomo.db"),
      path.join(h, "config", "token"),
      path.join(h, "logs", "old.jsonl"),
      path.join(h, "config", "backups", "mordomo.db.v1.bak"),
      path.join(h, "config", "backups", "old-backup", "config", "db", "mordomo.db"),
    ];
    for (const d of dirs) fs.chmodSync(d, 0o755);
    for (const f of files) fs.chmodSync(f, 0o644);

    const second = new AppContext(h);
    second.close();
    for (const d of dirs) expect(modeOf(d).toString(8), d).toBe("700");
    for (const f of files) expect(modeOf(f).toString(8), f).toBe("600");

    // Already right: mounting again writes nothing (no chmod, same ctime).
    // (the database folder and file change by themselves while SQLite runs; the chmod spy covers them)
    const stable = [...dirs, ...files].filter(
      (p) => !p.startsWith(path.join(h, "config", "db")) || p.includes("old-backup"),
    );
    const before = stable.map((p) => fs.statSync(p).ctimeMs);
    const chmod = vi.spyOn(fs, "chmodSync");
    try {
      const third = new AppContext(h);
      third.close();
      expect(chmod).not.toHaveBeenCalled();
    } finally {
      chmod.mockRestore();
    }
    expect(stable.map((p) => fs.statSync(p).ctimeMs)).toEqual(before);
  });

  it("C9 concurrent token creation agrees on one token", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-sp1-token-"));
    homes.push(work);
    // The children run the current source: bundle the store, not a possibly stale dist/.
    const entry = path.join(work, "entry.ts");
    fs.writeFileSync(
      entry,
      [
        `import { SettingsStore } from ${JSON.stringify(path.join(repoRoot, "core/src/config/store.ts"))};`,
        `import { resolvePaths } from ${JSON.stringify(path.join(repoRoot, "core/src/paths.ts"))};`,
        'import fs from "node:fs";',
        // A slow disk: the lookup of a missing token takes 100 ms to answer, so every process
        // finishes its "is there a token?" check before any of them has written one.
        "const realRead = fs.readFileSync;",
        "fs.readFileSync = ((p: any, ...rest: any[]) => {",
        "  try { return (realRead as any)(p, ...rest); } catch (error: any) {",
        '    if (String(p).endsWith("token") && error.code === "ENOENT") { const end = Date.now() + 100; while (Date.now() < end) { /* wait */ } }',
        "    throw error;",
        "  }",
        "}) as typeof fs.readFileSync;",
        "const startAt = Number(process.env.START_AT);",
        "while (Date.now() < startAt) { /* line the processes up so they race */ }",
        "process.stdout.write(new SettingsStore(resolvePaths(process.env.HOME_DIR)).getOrCreateToken());",
      ].join("\n"),
    );
    const { rolldown } = await import("rolldown");
    const bundle = await rolldown({
      input: entry,
      platform: "node",
      external: [/^node:/, "better-sqlite3"],
      resolve: { alias: { "@mordomo/contracts": path.join(repoRoot, "contracts/src/index.ts") } },
    });
    const script = path.join(work, "entry.mjs");
    await bundle.write({ file: script, format: "esm" });
    await bundle.close();

    for (let round = 0; round < 2; round++) {
      const h = newHome();
      fs.mkdirSync(path.join(h, "config"), { recursive: true });
      const startAt = String(Date.now() + 1500);
      const outputs = await Promise.all(
        Array.from(
          { length: 20 },
          () =>
            new Promise<string>((resolve, reject) => {
              const child = spawnProcess(process.execPath, [script], {
                env: { ...process.env, HOME_DIR: h, START_AT: startAt },
                stdio: ["ignore", "pipe", "inherit"],
              });
              let out = "";
              child.stdout.on("data", (d: Buffer) => (out += d.toString()));
              child.on("error", reject);
              child.on("close", (code) =>
                code === 0 ? resolve(out) : reject(new Error(`child exited ${code}`)),
              );
            }),
        ),
      );
      expect(new Set(outputs).size, `round ${round}`).toBe(1);
      expect(outputs[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.readFileSync(path.join(h, "config", "token"), "utf8")).toBe(`${outputs[0]}\n`);
      if (POSIX) expect(modeOf(path.join(h, "config", "token")).toString(8)).toBe("600");
    }
  });

  it("C10 private home files are git-ignored and source files are not", () => {
    const ignored = [
      "config/token",
      "config/vapid.json",
      "config/registry-signing.json",
      "config/tls/key.pem",
      "config/ui-preferences.json",
      "config/db/mordomo.db",
      "config/settings.json.v1.bak",
      "x.bak",
    ];
    const tracked = ["core/src/config/store.ts", "apps/command-centre/src/config/x.ts"];
    // --no-index: judge the patterns themselves, also for paths git already tracks.
    const isIgnored = (p: string) => {
      try {
        execFileSync("git", ["check-ignore", "--no-index", "-q", p], { cwd: repoRoot, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    for (const p of ignored) expect(isIgnored(p), `${p} is ignored`).toBe(true);
    for (const p of tracked) expect(isIgnored(p), `${p} is not ignored`).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("S4 the event stream recovers from a restart", () => {
  let base = "";
  beforeAll(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  interface Frame {
    id?: number;
    event?: string;
    data?: { id: number; type: string; v: number; payload: Record<string, unknown> };
  }
  /** Read `/api/events` for `ms`, calling `during` once the stream is open; returns its data frames in order. */
  async function readEvents(
    query: string,
    headers: Record<string, string>,
    ms: number,
    during?: () => void,
  ): Promise<{ status: number; frames: Frame[]; raw: string }> {
    const ac = new AbortController();
    // The reading window opens when the stream does: a machine busy with a whole suite can take longer than
    // `ms` just to accept the connection, and that must not eat the window. The connection has its own limit.
    let timer = setTimeout(() => ac.abort(), 15_000);
    let raw = "";
    let status = 0;
    try {
      const res = await fetch(`${base}/api/events?token=${ownerToken}${query}`, {
        headers,
        signal: ac.signal,
      });
      status = res.status;
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), ms);
      const reader = res.body!.getReader();
      if (during) setTimeout(during, 150);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += Buffer.from(value).toString("utf8");
        }
      } catch {
        /* aborted at the deadline */
      }
    } finally {
      clearTimeout(timer);
    }
    const frames: Frame[] = [];
    for (const block of raw.split("\n\n")) {
      if (!block || block.startsWith(":")) continue;
      const frame: Frame = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) frame.id = Number(line.slice(4));
        else if (line.startsWith("event: ")) frame.event = line.slice(7);
        else if (line.startsWith("data: ")) frame.data = JSON.parse(line.slice(6));
      }
      frames.push(frame);
    }
    return { status, frames, raw };
  }

  const emitSome = () =>
    [1, 2, 3].map((n) => events.emit("routine.changed", { id: `p1-${n}`, action: "test" }).id);

  it("C11 a stale resume point gets a stream reset", async () => {
    for (const how of ["Last-Event-ID", "?since"] as const) {
      emitSome();
      const ringIds = events.since(0).map((e) => e.id);
      const last = events.lastId;
      const stale = last + 1200;
      let live = 0;
      const out = await readEvents(
        how === "?since" ? `&since=${stale}` : "",
        how === "Last-Event-ID" ? { "Last-Event-ID": String(stale) } : {},
        900,
        () => {
          live = events.emit("routine.changed", { id: "p1-live", action: "after" }).id;
        },
      );
      expect(out.status, how).toBe(200);
      const [first, ...rest] = out.frames;
      expect(first?.event, how).toBe("stream.reset");
      expect(first?.data?.type).toBe("stream.reset");
      expect(first?.data?.v).toBe(1);
      expect(first?.data?.payload.lastId).toBe(last);
      expect(first?.id, "the reset moves the browser's resume point into this process's range").toBe(last);
      // The whole ring comes next, in order, and a live event arrives after it.
      const replayed = rest.filter((f) => f.id !== undefined && f.id <= last).map((f) => f.id);
      expect(replayed, how).toEqual(ringIds);
      expect(
        rest.some((f) => f.id === live && f.event === "routine.changed"),
        how,
      ).toBe(true);
      expect(out.frames.filter((f) => f.event === "stream.reset")).toHaveLength(1);
    }
  });

  it("C12 an in-range resume point replays as before", async () => {
    const [a, b, c] = emitSome() as [number, number, number];
    const last = events.lastId;
    const fromA = await readEvents("", { "Last-Event-ID": String(a) }, 500);
    expect(fromA.frames.map((f) => f.id)).toEqual([b, c]);
    const viaQuery = await readEvents(`&since=${a}`, {}, 500);
    expect(viaQuery.frames.map((f) => f.id)).toEqual([b, c]);
    // Exactly the last id is in range too: nothing to replay, no reset.
    const atLast = await readEvents("", { "Last-Event-ID": String(last) }, 400);
    expect(atLast.frames).toEqual([]);
    // No resume point: no replay, no reset.
    const none = await readEvents("", {}, 400);
    expect(none.frames).toEqual([]);
    expect(none.raw).toContain(": connected");
    for (const out of [fromA, viaQuery, atLast, none]) {
      expect(out.frames.some((f) => f.event === "stream.reset")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("S5 the security doc matches what is enforced", () => {
  it("C15 the security doc describes what is enforced", () => {
    const doc = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const notCovered = doc.slice(
      doc.indexOf("Not covered, and said plainly:"),
      doc.indexOf("## Security profiles"),
    );
    const required: Record<string, string[]> = {
      "home config and logs not served": [
        "`config/` and `logs/` are never served",
        "forbidden_path",
        "real* path",
        "direct children of the home",
      ],
      "git neutralised": [
        "core.fsmonitor=false",
        "core.hooksPath",
        "--no-textconv",
        "--no-ext-diff",
        "GIT_CONFIG_NOSYSTEM=1",
        "GIT_CONFIG_GLOBAL",
      ],
      "file modes": ["`0700`", "`0600`", "Windows does not apply POSIX modes"],
      "stream reset": ["stream.reset", "Last-Event-ID"],
    };
    for (const [what, phrases] of Object.entries(required)) {
      for (const phrase of phrases) expect(doc, `${what}: ${phrase}`).toContain(phrase);
    }
    // What is now enforced is no longer described as open.
    expect(doc).not.toContain("inherit the process umask");
    expect(notCovered).not.toMatch(/stream\.reset|0600|fsmonitor|preview/);
    expect(notCovered).toContain("Windows");
  });
});

import fs from "node:fs";
import path from "node:path";
import { safeSpawn } from "@mordomo/core/internal";

/**
 * The one way the API runs `git` inside a repository an agent may have edited.
 * The repository's own files are hostile input, and git trusts them to decide
 * three things, each closed here for every call and not for the call that was
 * written first:
 *
 *  - what RUNS: `core.fsmonitor`, a `diff` textconv/external driver, a `filter`
 *    clean command or a hook would each run as the owner the moment the diff is
 *    asked for (the neutralising `-c` pairs, `--no-textconv`, `--no-ext-diff`,
 *    each `filter.*` driver emptied by name, no system or global config);
 *  - which FILES it reads: the pathspec is a pattern language (`*`, `?`, `[.]`,
 *    `:(top)`, `:(glob)`), so the path the caller's filter judged is not the
 *    set git reads. Every call is literal (`--literal-pathspecs` and
 *    `GIT_LITERAL_PATHSPECS=1`), and the work tree and the git directory are
 *    ours, never the repository's: `core.worktree`, a `.git` file that says
 *    `gitdir:`, alternate object stores and `include` lines in the config can
 *    point git at `<home>/config`, so `--git-dir` and `--work-tree` are given
 *    explicitly and a repository that uses any of those is refused;
 *  - where the answer comes from: a repository is `<work tree>/.git`, a real
 *    directory, found by the caller; nothing is discovered by git.
 */

const GIT_TIMEOUT_MS = 10_000;

/** The platform's null device: a path git can open that holds nothing. */
export const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

/** `-c` pairs placed before the subcommand on every invocation. */
export const GIT_NEUTRAL_ARGS: readonly string[] = [
  "-c",
  "core.quotepath=off",
  "-c",
  "core.fsmonitor=false",
  "-c",
  `core.hooksPath=${NULL_DEVICE}`,
  "-c",
  "core.sshCommand=",
  "-c",
  "protocol.ext.allow=never",
];

export const GIT_NEUTRAL_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  // The pathspec is a path, never a pattern (`*`, `?`, `[.]`, `:(top)`): `--literal-pathspecs` says it too.
  GIT_LITERAL_PATHSPECS: "1",
};

/** Flags that stop `diff` and `status` from running a driver or entering a submodule's own repository. */
const SUBCOMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  diff: ["--no-ext-diff", "--no-textconv", "--ignore-submodules=all"],
  status: ["--ignore-submodules=all"],
};

export interface GitResult {
  /** `null` when the call was refused or never ran (the repository is not one we accept, or it timed out). */
  exitCode: number | null;
  stdout: string;
  truncated: boolean;
}

/** A repository we accept: `.git` is a real directory inside the work tree. */
export interface GitRepo {
  workTree: string;
  gitDir: string;
}

/** Config keys that make git read a file chosen by the repository (`[include] path`, `[includeIf] path`). */
const INCLUDE_KEY = /^include(?:if\..+)?\.path$/i;

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * `<workTree>/.git` as a real directory of the work tree, with no alternate
 * object store: the only repository shape git is ever pointed at. A `.git`
 * FILE (`gitdir: <elsewhere>`: a linked worktree, a submodule), a `.git`
 * symlink and an `objects/info/alternates` file send git outside the work tree
 * and are refused (the caller falls back to a plain snapshot of the file).
 */
export function inspectRepo(workTree: string): GitRepo | null {
  const gitDir = path.join(workTree, ".git");
  const stat = lstatOrNull(gitDir);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return null;
  if (lstatOrNull(path.join(gitDir, "objects", "info", "alternates"))) return null;
  if (lstatOrNull(path.join(gitDir, "commondir"))) return null;
  return { workTree, gitDir };
}

/** The options that fix where git reads: explicit, so `core.worktree`, `GIT_DIR` and discovery are never consulted. */
function locationArgs(repo: GitRepo): string[] {
  return [
    `--git-dir=${repo.gitDir}`,
    `--work-tree=${repo.workTree}`,
    "--literal-pathspecs",
    "--no-replace-objects",
  ];
}

async function spawnGit(gitPath: string, repo: GitRepo, args: readonly string[]): Promise<GitResult> {
  const handle = safeSpawn(gitPath, [...locationArgs(repo), ...GIT_NEUTRAL_ARGS, ...args], {
    cwd: repo.workTree,
    allowPaths: [gitPath],
    timeoutMs: GIT_TIMEOUT_MS,
    // Nothing of git's own environment is inherited (GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR, GIT_INDEX_FILE,
    // GIT_OBJECT_DIRECTORY, GIT_CONFIG_PARAMETERS, ...): the service may have been started from a git hook, and
    // each of them would move what git reads. What is set is `GIT_NEUTRAL_ENV` and nothing else.
    dropEnv: { names: [], prefixes: ["GIT_"] },
    env: { ...GIT_NEUTRAL_ENV },
  });
  const res = await handle.result;
  return { exitCode: res.exitCode, stdout: res.stdout, truncated: res.stdoutTruncated };
}

/**
 * `filter.<name>.clean` runs on every file `diff` and `status` compare, and no
 * flag turns filters off, so each driver the repository declares is emptied by
 * name. A name git cannot take on a `-c` line (`=`, newline) cannot be emptied:
 * the call is then refused (`exitCode` null) rather than run.
 */
async function filterOverrides(gitPath: string, repo: GitRepo): Promise<string[] | null> {
  const listed = await spawnGit(gitPath, repo, ["config", "--name-only", "--list"]);
  if (listed.exitCode !== 0) return null;
  const names = new Set<string>();
  for (const key of listed.stdout.split("\n")) {
    // A config that includes another file makes git parse a file the repository chose (and say what is in it).
    if (INCLUDE_KEY.test(key.trim())) return null;
    const match = /^filter\.(.+)\.(?:clean|smudge|process|required)$/i.exec(key.trim());
    if (match) names.add(match[1]!);
  }
  const args: string[] = [];
  for (const name of names) {
    if (/[=\r\n]/.test(name)) return null;
    for (const variable of ["clean", "smudge", "process"]) args.push("-c", `filter.${name}.${variable}=`);
    args.push("-c", `filter.${name}.required=false`);
  }
  return args;
}

/**
 * Run `git <args>` on the repository at `workTree` with its executable
 * settings switched off, its location fixed and every pathspec literal.
 * Resolves with `exitCode: null` (nothing run) for a repository `inspectRepo`
 * refuses or whose config cannot be neutralised.
 */
export async function runGit(gitPath: string, workTree: string, args: string[]): Promise<GitResult> {
  const refused: GitResult = { exitCode: null, stdout: "", truncated: false };
  const repo = inspectRepo(workTree);
  if (!repo) return refused;
  const [subcommand = "", ...rest] = args;
  const flags = SUBCOMMAND_FLAGS[subcommand] ?? [];
  let overrides: string[] = [];
  if (subcommand === "diff" || subcommand === "status") {
    const found = await filterOverrides(gitPath, repo);
    if (!found) return refused;
    overrides = found;
  }
  return spawnGit(gitPath, repo, [...overrides, subcommand, ...flags, ...rest]);
}

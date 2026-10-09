import { safeSpawn } from "@mordomo/core";

/**
 * The one way the API runs `git` inside a repository an agent may have edited.
 * The repository's own config is hostile input: `core.fsmonitor`, a `diff`
 * textconv/external driver or a `filter` clean command would each run as the
 * owner the moment the diff is asked for. Every call therefore carries the
 * neutralising flags and never reads the system or global config.
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
};

/** Flags that stop `diff` and `status` from running a driver or entering a submodule's own repository. */
const SUBCOMMAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  diff: ["--no-ext-diff", "--no-textconv", "--ignore-submodules=all"],
  status: ["--ignore-submodules=all"],
};

export interface GitResult {
  exitCode: number | null;
  stdout: string;
  truncated: boolean;
}

async function spawnGit(gitPath: string, cwd: string, args: readonly string[]): Promise<GitResult> {
  const handle = safeSpawn(gitPath, [...GIT_NEUTRAL_ARGS, ...args], {
    cwd,
    allowPaths: [gitPath],
    timeoutMs: GIT_TIMEOUT_MS,
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
async function filterOverrides(gitPath: string, cwd: string): Promise<string[] | null> {
  const listed = await spawnGit(gitPath, cwd, ["config", "--name-only", "--list"]);
  if (listed.exitCode !== 0) return null;
  const names = new Set<string>();
  for (const key of listed.stdout.split("\n")) {
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

/** Run `git <args>` in `cwd` with the repository's executable settings switched off. */
export async function runGit(gitPath: string, cwd: string, args: string[]): Promise<GitResult> {
  const [subcommand = "", ...rest] = args;
  const flags = SUBCOMMAND_FLAGS[subcommand] ?? [];
  let overrides: string[] = [];
  if (subcommand === "diff" || subcommand === "status") {
    const found = await filterOverrides(gitPath, cwd);
    if (!found) return { exitCode: null, stdout: "", truncated: false };
    overrides = found;
  }
  return spawnGit(gitPath, cwd, [...overrides, subcommand, ...flags, ...rest]);
}

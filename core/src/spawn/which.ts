import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Dependency-free `which`: locate an executable on PATH. */
export function findOnPath(name: string): string | null {
  return findInDirs(name, (process.env.PATH ?? "").split(path.delimiter));
}

/**
 * Locate an executable on PATH first, then in the folders where the provider
 * CLIs are usually installed. A service started by launchd, systemd or the
 * Task Scheduler runs with a minimal PATH (`/usr/bin:/bin:…`), so a CLI that
 * works in the user's terminal would otherwise be reported as "not installed".
 */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return findInDirs(name, [...(env.PATH ?? "").split(path.delimiter), ...providerSearchDirs(env)]);
}

/**
 * Folders searched after PATH, deduplicated and existing only. Covers the
 * native installers (`~/.local/bin`), Homebrew, npm/pnpm/bun/yarn global
 * prefixes, the version managers (fnm, nvm, volta, n, asdf) and the folder of
 * the Node binary running this process (global npm packages live next to it).
 */
export function providerSearchDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = env.HOME ?? env.USERPROFILE ?? os.homedir(),
): string[] {
  const dirs: string[] = [];
  const add = (...parts: string[]) => {
    const dir = path.join(...parts);
    if (!dirs.includes(dir)) dirs.push(dir);
  };
  const addVersions = (base: string, ...tail: string[]) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    // Newest version first, so a freshly updated CLI wins over a stale copy.
    for (const entry of entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => compareVersions(b.name, a.name)))
      add(base, entry.name, ...tail);
  };

  add(path.dirname(process.execPath));
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    add(appData, "npm");
    add(localAppData, "pnpm");
    add(localAppData, "Volta", "bin");
    add(localAppData, "Programs", "cursor-agent");
    add(home, ".local", "bin");
    add(home, ".bun", "bin");
    add(home, ".cargo", "bin");
    add(home, "scoop", "shims");
    add(env.ProgramFiles ?? "C:\\Program Files", "nodejs");
    addVersions(path.join(appData, "nvm"));
    addVersions(path.join(localAppData, "fnm", "node-versions"), "installation");
  } else {
    add(home, ".local", "bin");
    add(home, "bin");
    add(home, ".npm-global", "bin");
    add(home, ".bun", "bin");
    add(home, ".cargo", "bin");
    add(home, ".volta", "bin");
    add(home, ".yarn", "bin");
    add(home, "Library", "pnpm");
    add(home, ".local", "share", "pnpm");
    add(env.PNPM_HOME ?? path.join(home, ".local", "share", "pnpm"));
    add("/opt/homebrew/bin");
    add("/usr/local/bin");
    add("/home/linuxbrew/.linuxbrew/bin");
    add("/snap/bin");
    addVersions(path.join(home, ".local", "share", "fnm", "node-versions"), "installation", "bin");
    addVersions(path.join(env.FNM_DIR ?? path.join(home, ".fnm"), "node-versions"), "installation", "bin");
    addVersions(path.join(env.NVM_DIR ?? path.join(home, ".nvm"), "versions", "node"), "bin");
    addVersions(path.join(home, ".asdf", "installs", "nodejs"), "bin");
    addVersions(path.join(env.N_PREFIX ?? "/usr/local", "n", "versions", "node"), "bin");
    if (platform === "darwin")
      addVersions(
        path.join(home, "Library", "Application Support", "fnm", "node-versions"),
        "installation",
        "bin",
      );
  }
  return dirs.filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * PATH for child processes: the inherited PATH followed by the provider
 * folders that are missing from it. Provider CLIs shell out to `node`, `git`
 * and to their own helpers; a service with a bare PATH would otherwise start
 * a CLI that then fails to find its runtime.
 */
export function augmentedPath(env: NodeJS.ProcessEnv = process.env): string {
  // Called for every spawn: remember the answer for the current PATH briefly
  // so a burst of probes does not re-stat thirty folders each time.
  const key = env.PATH ?? "";
  const cached = pathCache.get(key);
  if (cached && Date.now() - cached.at < PATH_CACHE_MS) return cached.value;
  const value = computeAugmentedPath(env);
  pathCache.set(key, { at: Date.now(), value });
  return value;
}

const PATH_CACHE_MS = 30_000;
const pathCache = new Map<string, { at: number; value: string }>();

function computeAugmentedPath(env: NodeJS.ProcessEnv): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...(env.PATH ?? "").split(path.delimiter), ...providerSearchDirs(env)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(path.delimiter);
}

function findInDirs(name: string, dirs: string[]): string | null {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Natural comparison of `v22.3.0`-style folder names; non-numeric parts compare as strings. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".");
  const pb = b.replace(/^v/, "").split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = (pa[i] ?? "").localeCompare(pb[i] ?? "");
      if (cmp !== 0) return cmp;
      continue;
    }
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Extract `--flag` tokens from a CLI's --help output for capability probing. */
export function parseHelpFlags(helpText: string): string[] {
  const flags = new Set<string>();
  for (const match of helpText.matchAll(/(?:^|\s)(--[a-z][a-z0-9-]+)/gim)) {
    flags.add(match[1]!.toLowerCase());
  }
  return [...flags].sort();
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MordomoOS home resolution.
 * Default: the repository root (the directory that contains core/, skills/, config/…)
 * when running from a source checkout, otherwise the per-user data folder
 * (a packaged install lives in a read-only location such as /Applications).
 * Override with MORDOMO_HOME.
 */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && fs.existsSync(path.join(dir, "core"))) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: unknown };
        if (parsed.name === "mordomo-os") return dir;
      } catch {
        /* not our package.json: keep walking up */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Where a packaged MordomoOS keeps its data: the platform's per-user
 * application-data folder. Pure so the launchers and tests can compute it.
 */
export function defaultUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = env.HOME ?? env.USERPROFILE ?? os.homedir(),
): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "MordomoOS");
  if (platform === "win32")
    return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "MordomoOS");
  return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "mordomo-os");
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface MordomoPaths {
  home: string;
  skills: string;
  memory: string;
  routines: string;
  connectors: string;
  artifacts: string;
  logs: string;
  config: string;
  db: string;
  dbFile: string;
  backups: string;
  run: string;
  settingsFile: string;
  /** What only the Command Centre reads and writes (theme preset, layouts, HUD, Second Brain view). */
  uiPreferencesFile: string;
  tokenFile: string;
  syncManifest: string;
}

export function resolvePaths(homeOverride?: string): MordomoPaths {
  const home = path.resolve(
    homeOverride ?? process.env.MORDOMO_HOME ?? findRepoRoot(moduleDir) ?? defaultUserDataDir(),
  );
  const config = path.join(home, "config");
  const db = path.join(config, "db");
  return {
    home,
    skills: path.join(home, "skills"),
    memory: path.join(home, "memory"),
    routines: path.join(home, "routines"),
    connectors: path.join(home, "connectors"),
    artifacts: path.join(home, "artifacts"),
    logs: path.join(home, "logs"),
    config,
    db,
    dbFile: path.join(db, "mordomo.db"),
    backups: path.join(config, "backups"),
    run: path.join(config, "run"),
    settingsFile: path.join(config, "settings.json"),
    uiPreferencesFile: path.join(config, "ui-preferences.json"),
    tokenFile: path.join(config, "token"),
    syncManifest: path.join(config, "sync-manifest.json"),
  };
}

/** Directories that hold credentials, the database, backups and run output: owner only. */
export const PRIVATE_DIR_MODE = 0o700;
/** The database, its sidecars, backups of it, the token and the logs: owner only. */
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Set `target`'s permission bits to `mode` when they differ; a no-op when they
 * already match, when the path is missing, on Windows (where POSIX modes do not
 * exist; docs/security.md) and when the file is not ours to change.
 */
export function tightenMode(target: string, mode: number): boolean {
  if (process.platform === "win32") return false;
  try {
    if ((fs.statSync(target).mode & 0o777) === mode) return false;
    fs.chmodSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

export function ensureDirs(p: MordomoPaths): void {
  for (const dir of [p.skills, p.memory, p.routines, p.connectors, p.artifacts]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const dir of [p.config, p.db, p.backups, p.logs, p.run]) {
    fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
    tightenMode(dir, PRIVATE_DIR_MODE);
  }
}

/**
 * Bring the files of an existing home to owner-only, once per start: the
 * database and its WAL sidecars, the token, every log, and the backups (their
 * folders and the database inside each). Only what differs is written.
 */
export function tightenHomeFiles(p: MordomoPaths): void {
  for (const suffix of ["", "-wal", "-shm"]) tightenMode(p.dbFile + suffix, PRIVATE_FILE_MODE);
  tightenMode(p.tokenFile, PRIVATE_FILE_MODE);
  const entries = (dir: string): fs.Dirent[] => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const entry of entries(p.logs)) {
    if (entry.isFile()) tightenMode(path.join(p.logs, entry.name), PRIVATE_FILE_MODE);
  }
  for (const entry of entries(p.backups)) {
    const full = path.join(p.backups, entry.name);
    if (entry.isFile()) tightenMode(full, PRIVATE_FILE_MODE);
    else if (entry.isDirectory()) {
      tightenMode(full, PRIVATE_DIR_MODE);
      tightenMode(path.join(full, "config", "db", "mordomo.db"), PRIVATE_FILE_MODE);
    }
  }
}

/**
 * First-run seeding for a packaged install: copy the bundled skills, routines
 * and connectors that the home does not have yet. Existing entries are never
 * touched, so user edits and deletions survive every update.
 */
export function seedHome(p: MordomoPaths, seedDir: string): string[] {
  const copied: string[] = [];
  for (const [key, target] of [
    ["skills", p.skills],
    ["routines", p.routines],
    ["connectors", p.connectors],
  ] as const) {
    const source = path.join(seedDir, key);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(source);
    } catch {
      continue;
    }
    fs.mkdirSync(target, { recursive: true });
    for (const entry of entries) {
      const destination = path.join(target, entry);
      if (fs.existsSync(destination)) continue;
      fs.cpSync(path.join(source, entry), destination, { recursive: true });
      copied.push(path.join(key, entry));
    }
  }
  return copied;
}

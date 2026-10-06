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

export function ensureDirs(p: MordomoPaths): void {
  for (const dir of [
    p.skills,
    p.memory,
    p.routines,
    p.connectors,
    p.artifacts,
    p.logs,
    p.config,
    p.db,
    p.backups,
    p.run,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MordomoOS home resolution.
 * Default: the repository root (the directory that contains core/, skills/, config/…).
 * Override with MORDOMO_HOME. The Settings screen writes MORDOMO_HOME into
 * config/settings.json's `dataDir` override, which takes precedence at load time.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "core"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
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
  tokenFile: string;
  syncManifest: string;
}

export function resolvePaths(homeOverride?: string): MordomoPaths {
  const home = path.resolve(homeOverride ?? process.env.MORDOMO_HOME ?? findRepoRoot(moduleDir));
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

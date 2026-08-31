import fs from "node:fs";
import path from "node:path";
import type { MordomoPaths } from "./paths.js";

/**
 * Backup / restore of everything that defines this MordomoOS installation:
 * settings, DB, skills, memory routers, routines, connectors. Artifacts and
 * logs are excluded by default (large, reproducible); pass includeArtifacts.
 * Dependency-free directory copies — restorable by hand with `cp -r` too.
 */

const BACKUP_SETS = ["skills", "memory", "routines", "connectors"] as const;

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
}

export function createBackup(paths: MordomoPaths, includeArtifacts = false): BackupInfo {
  const name = `full-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dest = path.join(paths.backups, name);
  fs.mkdirSync(dest, { recursive: true });

  for (const set of BACKUP_SETS) {
    const src = paths[set];
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, set), { recursive: true });
  }
  if (fs.existsSync(paths.settingsFile)) {
    fs.mkdirSync(path.join(dest, "config"), { recursive: true });
    fs.copyFileSync(paths.settingsFile, path.join(dest, "config", "settings.json"));
  }
  if (fs.existsSync(paths.syncManifest)) {
    fs.mkdirSync(path.join(dest, "config"), { recursive: true });
    fs.copyFileSync(paths.syncManifest, path.join(dest, "config", "sync-manifest.json"));
  }
  if (fs.existsSync(paths.dbFile)) {
    fs.mkdirSync(path.join(dest, "config", "db"), { recursive: true });
    fs.copyFileSync(paths.dbFile, path.join(dest, "config", "db", "mordomo.db"));
  }
  if (includeArtifacts && fs.existsSync(paths.artifacts)) {
    fs.cpSync(paths.artifacts, path.join(dest, "artifacts"), { recursive: true });
  }
  return { name, path: dest, createdAt: Date.now(), sizeBytes: dirSize(dest) };
}

export function listBackups(paths: MordomoPaths): BackupInfo[] {
  if (!fs.existsSync(paths.backups)) return [];
  return fs
    .readdirSync(paths.backups, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("full-"))
    .map((e) => {
      const full = path.join(paths.backups, e.name);
      return { name: e.name, path: full, createdAt: fs.statSync(full).mtimeMs, sizeBytes: dirSize(full) };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Restore a backup. A pre-restore safety backup is created first, so a restore
 * can itself be undone.
 */
export function restoreBackup(paths: MordomoPaths, name: string): { safetyBackup: BackupInfo } {
  const src = path.join(paths.backups, name);
  if (!fs.existsSync(src) || !path.resolve(src).startsWith(path.resolve(paths.backups))) {
    throw new Error(`Backup not found: ${name}`);
  }
  const safetyBackup = createBackup(paths);

  for (const set of BACKUP_SETS) {
    const from = path.join(src, set);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(paths[set], { recursive: true, force: true });
    fs.cpSync(from, paths[set], { recursive: true });
  }
  const settingsBackup = path.join(src, "config", "settings.json");
  if (fs.existsSync(settingsBackup)) fs.copyFileSync(settingsBackup, paths.settingsFile);
  const manifestBackup = path.join(src, "config", "sync-manifest.json");
  if (fs.existsSync(manifestBackup)) fs.copyFileSync(manifestBackup, paths.syncManifest);
  const dbBackup = path.join(src, "config", "db", "mordomo.db");
  if (fs.existsSync(dbBackup)) {
    // Caller must have closed the DB before restoring.
    fs.copyFileSync(dbBackup, paths.dbFile);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = paths.dbFile + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
  }
  return { safetyBackup };
}

function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

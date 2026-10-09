import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, type MordomoPaths } from "../paths.js";
import { CURRENT_SETTINGS_VERSION, SettingsSchema, type Settings, defaultSettings } from "./schema.js";
import { events } from "../events.js";

export { atomicWrite } from "./atomicWrite.js";
import { atomicWrite } from "./atomicWrite.js";
import { migrateSettings, settingsVersion } from "./migrations.js";

/** Recursive merge for settings patches: objects merge, arrays and scalars replace. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMergeSettings<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMergeSettings(current, value) : value;
  }
  return out as T;
}

export type SettingsPatch = Partial<Settings> | ((current: Settings) => Partial<Settings>);

interface CacheEntry {
  mtimeMs: number;
  size: number;
  settings: Settings;
}

/**
 * Settings persistence. `load()` caches the parsed file keyed by mtime+size so
 * hot callers (every route, every run, every scheduler tick) pay a `stat`
 * instead of a read + JSON.parse + zod parse. Returned objects are clones:
 * mutating them never leaks into the cache.
 */
export class SettingsStore {
  private cache: CacheEntry | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly paths: MordomoPaths) {}

  load(): Settings {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.paths.settingsFile);
    } catch {
      this.cache = null;
      return defaultSettings();
    }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs && this.cache.size === stat.size) {
      return structuredClone(this.cache.settings);
    }
    try {
      const text = fs.readFileSync(this.paths.settingsFile, "utf8");
      const raw = JSON.parse(text) as Record<string, unknown>;
      const migrated = migrateSettings(raw, this.paths, text);
      if (migrated !== raw) stat = fs.statSync(this.paths.settingsFile);
      const settings = SettingsSchema.parse(migrated);
      this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, settings };
      return structuredClone(settings);
    } catch (err) {
      this.cache = null;
      // Never destroy a corrupt settings file: keep it aside and start from defaults.
      const backup = `${this.paths.settingsFile}.corrupt.${Date.now()}`;
      try {
        fs.copyFileSync(this.paths.settingsFile, backup);
      } catch {
        /* best effort */
      }
      throw new Error(
        `config/settings.json is invalid (${(err as Error).message}). ` +
          `A copy was kept at ${backup}. Fix or delete settings.json and run setup again.`,
      );
    }
  }

  /**
   * A file written by a newer MordomoOS is never overwritten: this code would
   * drop or misread what it does not know (`code: "settings_newer"`).
   */
  private refuseNewerFile(): void {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(this.paths.settingsFile, "utf8")) as Record<string, unknown>;
    } catch {
      return;
    }
    const version = settingsVersion(raw);
    if (version > CURRENT_SETTINGS_VERSION) {
      throw Object.assign(
        new Error(
          `config/settings.json was written by a newer MordomoOS (settings version ${version}); this version (${CURRENT_SETTINGS_VERSION}) will not overwrite it.`,
        ),
        { code: "settings_newer" },
      );
    }
  }

  /** Drop the in-memory cache (e.g. after a restore replaced the file). */
  invalidate(): void {
    this.cache = null;
  }

  save(settings: Settings): Settings {
    this.refuseNewerFile();
    const parsed = SettingsSchema.parse(settings);
    atomicWrite(this.paths.settingsFile, JSON.stringify(parsed, null, 2) + "\n");
    try {
      const stat = fs.statSync(this.paths.settingsFile);
      this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, settings: structuredClone(parsed) };
    } catch {
      this.cache = null;
    }
    events.emit("settings.changed", { settings: parsed });
    return parsed;
  }

  /**
   * Read-modify-write. Nested objects (e.g. `providers.claude`) are deep-merged
   * so a partial provider patch never resets its siblings to defaults; arrays
   * replace. A function patch receives the freshly loaded settings. Synchronous
   * (callers are sync), so within one process the RMW cannot interleave; see
   * `updateAsync` for callers that want ordering across awaits.
   */
  update(patch: SettingsPatch): Settings {
    const current = this.load();
    const resolved = typeof patch === "function" ? patch(current) : patch;
    return this.save(SettingsSchema.parse(deepMergeSettings(current, resolved as Record<string, unknown>)));
  }

  /**
   * Same as `update`, but serialised through an in-process promise chain so
   * concurrent async callers (e.g. two API requests) apply their patches one
   * after the other, each against the latest on-disk state.
   */
  updateAsync(patch: SettingsPatch): Promise<Settings> {
    const next = this.queue.then(() => this.update(patch));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * Local API token. Generated once, stored in config/token (0600).
   * Serves as CSRF/foreign-origin protection; it never leaves the machine.
   *
   * Of several processes starting on a home with no token, one wins and the
   * others return what it wrote, so they all agree. The winner is decided by
   * `link(2)`: the token is written in full to a private temporary file and
   * linked into place, which is atomic and exclusive, so a loser always finds a
   * complete token and nobody waits. A file system without hard links (FAT,
   * some network mounts) falls back to an exclusive create (`wx`), where the
   * winner may still be writing: the loser then polls, for at most 2 s, the one
   * time two processes start in the same instant on such a disk.
   */
  getOrCreateToken(): string {
    const existing = this.readToken();
    if (existing) return existing;
    const token = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(this.paths.tokenFile), { recursive: true, mode: PRIVATE_DIR_MODE });
    const staged = `${this.paths.tokenFile}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(staged, token + "\n", { mode: PRIVATE_FILE_MODE, flag: "wx" });
    try {
      try {
        fs.linkSync(staged, this.paths.tokenFile);
        return token;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          const winner = this.readToken();
          if (winner) return winner;
          // The file is there but empty or short (a crash mid-write of an older version): replace it, do not trust it.
          fs.renameSync(staged, this.paths.tokenFile);
          return this.readToken() ?? token;
        }
        if (code !== "EPERM" && code !== "ENOSYS" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") throw err;
      }
      return this.createTokenWithoutLinks(token);
    } finally {
      fs.rmSync(staged, { force: true });
    }
  }

  /** `getOrCreateToken` on a file system that cannot hard-link: exclusive create, then a bounded wait for a rival's write. */
  private createTokenWithoutLinks(token: string): string {
    try {
      fs.writeFileSync(this.paths.tokenFile, token + "\n", { mode: PRIVATE_FILE_MODE, flag: "wx" });
      return token;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const deadline = Date.now() + 2000;
    for (;;) {
      const written = this.readToken();
      if (written) return written;
      if (Date.now() >= deadline) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    fs.writeFileSync(this.paths.tokenFile, token + "\n", { mode: PRIVATE_FILE_MODE });
    return this.readToken() ?? token;
  }

  private readToken(): string | null {
    try {
      const value = fs.readFileSync(this.paths.tokenFile, "utf8").trim();
      return value.length >= 32 ? value : null;
    } catch {
      return null;
    }
  }
}

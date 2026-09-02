import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { MordomoPaths } from "../paths.js";
import { SettingsSchema, type Settings, defaultSettings } from "./schema.js";
import { events } from "../events.js";

/** Atomic write: write to a temp file in the same dir, then rename over. */
export function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

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
      const raw = JSON.parse(fs.readFileSync(this.paths.settingsFile, "utf8"));
      const settings = SettingsSchema.parse(raw);
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

  /** Drop the in-memory cache (e.g. after a restore replaced the file). */
  invalidate(): void {
    this.cache = null;
  }

  save(settings: Settings): Settings {
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
   */
  getOrCreateToken(): string {
    if (fs.existsSync(this.paths.tokenFile)) {
      const existing = fs.readFileSync(this.paths.tokenFile, "utf8").trim();
      if (existing.length >= 32) return existing;
    }
    const token = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(this.paths.tokenFile), { recursive: true });
    fs.writeFileSync(this.paths.tokenFile, token + "\n", { mode: 0o600 });
    return token;
  }
}

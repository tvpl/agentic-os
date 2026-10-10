import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, type MordomoPaths } from "../paths.js";
import { CURRENT_SETTINGS_VERSION, SettingsSchema, type Settings, defaultSettings } from "./schema.js";
import { events } from "../events.js";
import { JsonlLogger } from "../logs/jsonl.js";
import { SETTINGS_FAIL_CLOSED } from "./failClosed.js";
import { parseTolerant, type SettingsIssue } from "./tolerant.js";

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

/** `settings.json.corrupt.<ms>` copies kept. */
const MAX_CORRUPT_COPIES = 5;

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
      const raw = JSON.parse(text) as unknown;
      if (!isPlainObject(raw)) throw new Error("the document is not a JSON object");
      const migrated = migrateSettings(raw, this.paths, text);
      // A migration rewrites the file: what a save would replace (and `.invalid` keeps) is what is on disk now.
      const onDisk = migrated === raw ? text : fs.readFileSync(this.paths.settingsFile, "utf8");
      if (migrated !== raw) stat = fs.statSync(this.paths.settingsFile);
      // A field this version cannot read costs that field and nothing else: it reads as its default, the file
      // is left as it is, and the original is kept aside before anything can replace it.
      const { value: settings, issues } = parseTolerant(SettingsSchema, migrated, {
        failClosed: SETTINGS_FAIL_CLOSED,
      });
      if (issues.length > 0) this.reportInvalid(onDisk, issues);
      this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, settings };
      return structuredClone(settings);
    } catch (err) {
      this.cache = null;
      // Never destroy a corrupt settings file: keep it aside. Not valid JSON, or not an object at all, has no
      // field to drop: stop with the cause instead of starting from defaults that would replace the lot.
      const backup = this.keepCorrupt();
      throw new Error(
        `config/settings.json is invalid (${(err as Error).message}). ` +
          `A copy was kept at ${backup ?? "(none: it could not be written)"}. Fix or delete settings.json and run setup again.`,
      );
    }
  }

  /**
   * Keep a settings file that cannot be read at all as `settings.json.corrupt.<ms>`, unless a copy with the same
   * bytes is there already, and keep only the newest few: a command that fails on it again and again must not
   * leave one copy each time.
   */
  private keepCorrupt(): string | null {
    const prefix = `${path.basename(this.paths.settingsFile)}.corrupt.`;
    let copies: Array<{ name: string; at: number }> = [];
    try {
      copies = fs
        .readdirSync(this.paths.config)
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name, at: Number(name.slice(prefix.length)) || 0 }))
        .sort((a, b) => b.at - a.at);
    } catch {
      /* no folder, no copies */
    }
    let kept: string | null = null;
    try {
      const bytes = fs.readFileSync(this.paths.settingsFile);
      const same = copies.find((copy) => {
        try {
          return fs.readFileSync(path.join(this.paths.config, copy.name)).equals(bytes);
        } catch {
          return false;
        }
      });
      if (same) return path.join(this.paths.config, same.name);
      kept = `${this.paths.settingsFile}.corrupt.${Date.now()}`;
      fs.writeFileSync(kept, bytes, { flag: "wx", mode: PRIVATE_FILE_MODE });
    } catch {
      return kept;
    }
    for (const old of copies.slice(MAX_CORRUPT_COPIES - 1)) {
      fs.rmSync(path.join(this.paths.config, old.name), { force: true });
    }
    return kept;
  }

  /**
   * Keep the bytes of a settings file that has fields this version drops, under a name that never overwrites:
   * `settings.json.invalid`, or `settings.json.invalid.<12 hex of their SHA-256>` when that holds other bytes (and
   * `-1`, `-2`… if even that is taken by something else: a folder, a link, other bytes). `created` is false when
   * a file with exactly these bytes was there already (they were kept and reported before). `file` is null when
   * no name could be written: the caller must not let the original be replaced.
   */
  private preserveInvalid(text: string): { file: string | null; created: boolean } {
    const first = `${this.paths.settingsFile}.invalid`;
    const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
    const names = [first, `${first}.${hash}`, ...Array.from({ length: 8 }, (_, i) => `${first}.${hash}-${i + 1}`)];
    for (const target of names) {
      try {
        fs.writeFileSync(target, text, { flag: "wx", mode: PRIVATE_FILE_MODE });
        return { file: target, created: true };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") return { file: null, created: false };
        try {
          if (fs.lstatSync(target).isFile() && fs.readFileSync(target, "utf8") === text) {
            return { file: target, created: false };
          }
        } catch {
          /* a folder, a link, unreadable: the name is taken by something else, try the next */
        }
      }
    }
    return { file: null, created: false };
  }

  private lastReported: string | null = null;

  /**
   * One log line per dropped field, once per version of the file: not when these very bytes were kept before
   * (by this process or any other), and not twice in one process. The original is kept first.
   */
  private reportInvalid(text: string, issues: SettingsIssue[]): void {
    const preserved = this.preserveInvalid(text);
    const digest = crypto.createHash("sha256").update(text).digest("hex");
    if ((preserved.file !== null && !preserved.created) || this.lastReported === digest) return;
    this.lastReported = digest;
    try {
      const { logMaxFileBytes, logRetentionDays } = defaultSettings().limits;
      const log = new JsonlLogger(this.paths.logs, "settings", logMaxFileBytes, logRetentionDays);
      for (const issue of issues) {
        log.append({
          msg: "settings.invalid_field",
          path: issue.path,
          reason: issue.reason,
          ...(issue.closed ? { closed: true } : {}),
          preserved: preserved.file === null ? null : path.basename(preserved.file),
        });
      }
    } catch {
      /* the log is a courtesy: a full disk must not turn a tolerated field into a failure */
    }
  }

  /**
   * Before the file is replaced: a file written by a newer MordomoOS is never overwritten (this code would drop or
   * misread what it does not know: `code: "settings_newer"`), and one that is not valid JSON, or holds fields this
   * version drops, is kept aside first, so a save never loses what the owner wrote.
   */
  private guardCurrentFile(): void {
    let text: string;
    try {
      text = fs.readFileSync(this.paths.settingsFile, "utf8");
    } catch {
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.mustPreserve(text);
      return;
    }
    if (!isPlainObject(raw)) {
      this.mustPreserve(text);
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
    let dropsFields = false;
    try {
      dropsFields = parseTolerant(SettingsSchema, raw, { failClosed: SETTINGS_FAIL_CLOSED }).issues.length > 0;
    } catch {
      dropsFields = true;
    }
    if (dropsFields) this.mustPreserve(text);
  }

  /** `preserveInvalid`, for a file that is about to be replaced: if the original cannot be kept, it is not replaced. */
  private mustPreserve(text: string): void {
    if (this.preserveInvalid(text).file !== null) return;
    throw Object.assign(
      new Error(
        "config/settings.json holds values this version cannot read and a copy of it could not be written " +
          `(${path.basename(this.paths.settingsFile)}.invalid and its alternatives are taken or not writable); it was not replaced.`,
      ),
      { code: "settings_unpreserved" },
    );
  }

  /** Drop the in-memory cache (e.g. after a restore replaced the file). */
  invalidate(): void {
    this.cache = null;
  }

  save(settings: Settings): Settings {
    this.guardCurrentFile();
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

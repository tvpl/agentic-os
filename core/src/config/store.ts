import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { MordomoPaths } from "../paths.js";
import { SettingsSchema, type Settings, defaultSettings } from "./schema.js";

/** Atomic write: write to a temp file in the same dir, then rename over. */
export function atomicWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

export class SettingsStore {
  constructor(private readonly paths: MordomoPaths) {}

  load(): Settings {
    if (!fs.existsSync(this.paths.settingsFile)) return defaultSettings();
    try {
      const raw = JSON.parse(fs.readFileSync(this.paths.settingsFile, "utf8"));
      return SettingsSchema.parse(raw);
    } catch (err) {
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

  save(settings: Settings): Settings {
    const parsed = SettingsSchema.parse(settings);
    atomicWrite(this.paths.settingsFile, JSON.stringify(parsed, null, 2) + "\n");
    return parsed;
  }

  update(patch: Partial<Settings>): Settings {
    const current = this.load();
    return this.save(SettingsSchema.parse({ ...current, ...patch }));
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

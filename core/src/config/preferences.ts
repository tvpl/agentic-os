/**
 * `config/ui-preferences.json`: what only the Command Centre reads and writes.
 * The engine stores it and never interprets it. Same persistence rules as the
 * settings store: atomic writes, a cache keyed by mtime+size, deep-merged
 * patches (objects merge, arrays replace).
 */
import fs from "node:fs";
import type { MordomoPaths } from "../paths.js";
import { atomicWrite } from "./atomicWrite.js";
import { UiPreferencesSchema, defaultUiPreferences, type UiPreferences } from "./schema.js";
import { deepMergeSettings } from "./store.js";

export class UiPreferencesStore {
  private cache: { mtimeMs: number; size: number; prefs: UiPreferences } | null = null;

  constructor(
    private readonly paths: MordomoPaths,
    /** Called after every save (the engine announces it like a settings change). */
    private readonly onSaved: () => void = () => undefined,
  ) {}

  load(): UiPreferences {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.paths.uiPreferencesFile);
    } catch {
      return defaultUiPreferences();
    }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs && this.cache.size === stat.size) {
      return structuredClone(this.cache.prefs);
    }
    // A preference this version cannot read never takes the service down:
    // every field already degrades to its default, and a broken file reads as defaults.
    let prefs: UiPreferences;
    try {
      prefs = UiPreferencesSchema.parse(JSON.parse(fs.readFileSync(this.paths.uiPreferencesFile, "utf8")));
    } catch {
      prefs = defaultUiPreferences();
    }
    this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, prefs };
    return structuredClone(prefs);
  }

  save(prefs: UiPreferences): UiPreferences {
    const parsed = UiPreferencesSchema.parse(prefs);
    atomicWrite(this.paths.uiPreferencesFile, JSON.stringify(parsed, null, 2) + "\n");
    this.cache = null;
    this.onSaved();
    return parsed;
  }

  /** Deep-merge a partial document over the stored one, validate, save. */
  update(patch: Partial<UiPreferences>): UiPreferences {
    return this.save(UiPreferencesSchema.parse(deepMergeSettings(this.load(), patch as Record<string, unknown>)));
  }
}

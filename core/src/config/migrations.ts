/**
 * `settings.json` migrations (.specs/features/preferencias-ui). Applied on
 * read, in order, while the file's `version` is below the one this code
 * writes. The original file is kept as `settings.json.v<from>.bak` first.
 */
import fs from "node:fs";
import type { MordomoPaths } from "../paths.js";
import {
  CURRENT_SETTINGS_VERSION,
  UI_PREFERENCE_KEYS,
  UiPreferencesSchema,
  defaultUiPreferences,
} from "./schema.js";
import { atomicWrite } from "./atomicWrite.js";

type Raw = Record<string, unknown>;

export interface SettingsMigration {
  from: number;
  to: number;
  run(raw: Raw, paths: MordomoPaths): Raw;
}

export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [
  {
    // 1 → 2: what only the Command Centre uses moves to config/ui-preferences.json.
    from: 1,
    to: 2,
    run(raw, paths) {
      const moved: Raw = {};
      const kept: Raw = {};
      for (const [key, value] of Object.entries(raw)) {
        if ((UI_PREFERENCE_KEYS as readonly string[]).includes(key)) moved[key] = value;
        else kept[key] = value;
      }
      // Preferences already on disk win: a second process may have migrated first.
      if (!fs.existsSync(paths.uiPreferencesFile)) {
        const parsed = UiPreferencesSchema.safeParse(moved);
        const prefs = parsed.success ? parsed.data : { ...defaultUiPreferences(), ...pickValid(moved) };
        atomicWrite(paths.uiPreferencesFile, JSON.stringify(prefs, null, 2) + "\n");
      }
      return { ...kept, version: 2 };
    },
  },
];

/** Keep the moved values that are valid on their own; a bad one falls back to its default. */
function pickValid(moved: Raw): Raw {
  const out: Raw = {};
  for (const [key, value] of Object.entries(moved)) {
    const field = (UiPreferencesSchema.shape as Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>)[key];
    const one = field?.safeParse(value);
    if (one?.success) out[key] = one.data;
  }
  return out;
}

/** The version a raw settings document declares; a file without one is version 1. */
export function settingsVersion(raw: Raw): number {
  return typeof raw.version === "number" && Number.isInteger(raw.version) ? raw.version : 1;
}

/**
 * Bring `settings.json` up to `CURRENT_SETTINGS_VERSION`. Returns the
 * migrated raw document, or the input untouched when nothing had to run.
 */
export function migrateSettings(raw: Raw, paths: MordomoPaths, fileText: string): Raw {
  let version = settingsVersion(raw);
  if (version >= CURRENT_SETTINGS_VERSION) return raw;
  const backup = `${paths.settingsFile}.v${version}.bak`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, fileText);
  let doc = raw;
  for (const step of SETTINGS_MIGRATIONS) {
    if (step.from !== version) continue;
    doc = step.run(doc, paths);
    version = step.to;
  }
  atomicWrite(paths.settingsFile, JSON.stringify(doc, null, 2) + "\n");
  return doc;
}

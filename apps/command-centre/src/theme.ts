/**
 * Theme presets (analysis item 29): a preset is an accent + a family of
 * surface tints + a display weight. Surfaces live in theme.css under
 * `[data-preset="…"]`; this module applies the attribute, the accent-derived
 * tokens and remembers the choice.
 *
 * Source of truth: `settings.themePreset` when the backend exposes it (see the
 * request in the F-SHELL report); until then the value is mirrored in
 * localStorage so it survives reloads. The Settings picker (F-APPS) should
 * call `applyPreset(id)` and PUT `{ themePreset: id, accentColor: preset.accent }`.
 */
import { accentContrast, ensureContrast, parseColor } from "./color";

export type PresetId = "hud-orange" | "forest" | "ocean" | "mono";
export type ThemeMode = "dark" | "light";

export interface ThemePreset {
  id: PresetId;
  /** Display name (not translated: presets are product names). */
  label: string;
  accent: string;
  /** Page background per mode, used to derive `--accent-text` contrast. */
  bg: Record<ThemeMode, string>;
  /** Swatch for pickers: [ground, raised surface, accent] in dark mode. */
  swatch: [string, string, string];
  displayWeight: number;
}

export const PRESETS: readonly ThemePreset[] = [
  { id: "hud-orange", label: "HUD Orange", accent: "#f97316", bg: { dark: "#0b0a08", light: "#f5f3ee" }, swatch: ["#0b0a08", "#131109", "#f97316"], displayWeight: 900 },
  { id: "forest", label: "Forest", accent: "#4ade80", bg: { dark: "#080b09", light: "#f1f5f0" }, swatch: ["#080b09", "#0f1511", "#4ade80"], displayWeight: 900 },
  { id: "ocean", label: "Ocean", accent: "#38bdf8", bg: { dark: "#070a0f", light: "#eff3f7" }, swatch: ["#070a0f", "#0d131c", "#38bdf8"], displayWeight: 900 },
  { id: "mono", label: "Mono", accent: "#e5e5e5", bg: { dark: "#0a0a0a", light: "#f4f4f4" }, swatch: ["#0a0a0a", "#121212", "#e5e5e5"], displayWeight: 700 },
];

export const DEFAULT_PRESET: PresetId = "hud-orange";
export const PRESET_STORAGE_KEY = "mordomo.themePreset";

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && PRESETS.some((p) => p.id === value);
}

export function getPreset(id: string | null | undefined): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Last preset chosen on this browser (fallback while the backend has no field). */
export function readStoredPreset(): PresetId {
  const raw = storage()?.getItem(PRESET_STORAGE_KEY);
  return isPresetId(raw) ? raw : DEFAULT_PRESET;
}

export function currentTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Derive the accent-dependent tokens (audit item 17) for the active theme. */
export function applyAccentTokens(accent: string, theme: ThemeMode = currentTheme(), bg?: string): void {
  const root = document.documentElement.style;
  const valid = parseColor(accent) ? accent : PRESETS[0]!.accent;
  const ground = bg ?? getPreset(document.documentElement.dataset.preset).bg[theme];
  root.setProperty("--accent", valid);
  root.setProperty("--accent-contrast", accentContrast(valid));
  root.setProperty("--accent-text", ensureContrast(valid, ground, 4.5));
}

export interface ApplyPresetOptions {
  /** Persist to localStorage (default true). */
  persist?: boolean;
  /** Also apply the preset accent (default true). Pass false when the accent comes from settings. */
  accent?: boolean;
  theme?: ThemeMode;
}

/**
 * Apply a preset: `data-preset` on <html> (theme.css picks the surfaces), the
 * accent tokens and the stored choice. Unknown ids fall back to the default.
 */
export function applyPreset(id: string, opts: ApplyPresetOptions = {}): ThemePreset {
  const preset = getPreset(id);
  const html = document.documentElement;
  html.dataset.preset = preset.id;
  html.style.setProperty("--display-weight", String(preset.displayWeight));
  if (opts.accent !== false) applyAccentTokens(preset.accent, opts.theme ?? currentTheme(), preset.bg[opts.theme ?? currentTheme()]);
  if (opts.persist !== false) {
    try {
      storage()?.setItem(PRESET_STORAGE_KEY, preset.id);
    } catch {
      /* private mode */
    }
  }
  return preset;
}

/** Next preset in the list (used by the palette "cycle" action). */
export function nextPreset(current: string | null | undefined): ThemePreset {
  const i = PRESETS.findIndex((p) => p.id === current);
  return PRESETS[(i + 1) % PRESETS.length]!;
}

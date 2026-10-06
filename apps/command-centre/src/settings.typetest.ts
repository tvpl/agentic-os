/**
 * UI preferences (.specs/features/preferencias-ui, C15, C22): compiled by the
 * UI typecheck (`tsc --noEmit` includes `src`) and imported by nothing. The
 * settings document the UI reads, and the settings write it sends, carry none
 * of the seven keys that moved to the UI preferences.
 */
import { api, type MovedSettingKey, type SettingsDoc } from "./api";

type Moved = "themePreset" | "microApps" | "dashboardLayout" | "spaces" | "activeSpace" | "hud" | "brain";
type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// C15 — `SettingsDoc` has none of the seven keys.
export type SettingsDocHoldsNoPreference = Assert<IsNever<Extract<keyof SettingsDoc, Moved>>>;
// C22 — the keys the settings write refuses are exactly the seven.
export type SettingsWriteRefusesTheSeven = Assert<Same<MovedSettingKey, Moved>>;

// C22 — each moved key is refused by the settings write, literally and through a spread.
export function settingsWriteRefusesMovedKeys(text: SettingsDoc["accentColor"]): void {
  // @ts-expect-error themePreset moved to the UI preferences
  void api.putSettings({ themePreset: "jarvis" });
  // @ts-expect-error microApps moved to the UI preferences
  void api.putSettings({ microApps: [] });
  // @ts-expect-error dashboardLayout moved to the UI preferences
  void api.putSettings({ dashboardLayout: {} });
  // @ts-expect-error spaces moved to the UI preferences
  void api.putSettings({ spaces: {} });
  // @ts-expect-error activeSpace moved to the UI preferences
  void api.putSettings({ activeSpace: "work" });
  // @ts-expect-error hud moved to the UI preferences
  void api.putSettings({ hud: { l: [], r: [] } });
  // @ts-expect-error brain moved to the UI preferences
  void api.putSettings({ brain: { layout: text } });
  const fromElsewhere = { accentColor: text, themePreset: "jarvis", brain: { layout: text } };
  // @ts-expect-error a moved key arriving through a spread, after an allowed one
  void api.putSettings({ theme: "dark", ...fromElsewhere });
  // What stays in the settings still goes through.
  void api.putSettings({ theme: "dark", accentColor: text, setupCompleted: true });
}

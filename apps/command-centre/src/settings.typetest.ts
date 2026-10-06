/**
 * UI preferences (.specs/features/preferencias-ui, C15, C22, C29, C30): compiled
 * by the UI typecheck (`tsc --noEmit` includes `src`) and imported by nothing.
 * The settings document the UI reads, and the settings write it sends, carry
 * none of the seven keys that moved to the UI preferences.
 */
import {
  api,
  type MOVED_SETTING_KEYS,
  type MovedSettingKey,
  type SettingsDoc,
  type SettingsPatch,
} from "./api";
import type { SettingsView, useApiQuery, useOsSettings } from "./queries";
import type { Put } from "./views/SettingsFields";
import type { SettingsShape } from "./views/settings/shared";

type Moved = "themePreset" | "microApps" | "dashboardLayout" | "spaces" | "activeSpace" | "hud" | "brain";
type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Identical types, not just mutually assignable (`Partial<SettingsDoc>` is not `SettingsPatch`). */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// C15 — `SettingsDoc` has none of the seven keys.
export type SettingsDocHoldsNoPreference = Assert<IsNever<Extract<keyof SettingsDoc, Moved>>>;
// C22 — the keys the settings write refuses are exactly the seven.
export type SettingsWriteRefusesTheSeven = Assert<Same<MovedSettingKey, Moved>>;
// C31 — the runtime list the request guard checks is the same seven.
export type GuardListsTheSeven = Assert<Same<(typeof MOVED_SETTING_KEYS)[number], Moved>>;

// C29 — the settings query result is exactly `SettingsDoc`: no moved key and no
// index signature, so a moved key cannot be read from it in any spelling.
export type SettingsQueryIsTheDoc = Assert<
  Exact<NonNullable<ReturnType<typeof useOsSettings>["data"]>, SettingsDoc>
>;
export type SettingsViewIsTheDoc = Assert<Exact<SettingsView, SettingsDoc>>;
export type SettingsPageShapeIsTheDoc = Assert<Exact<SettingsShape, SettingsDoc>>;
export type SettingsViewHasNoIndex = Assert<IsNever<Extract<string, keyof SettingsView>>>;
export function settingsReadsRefuseMovedKeys(settingsQ: ReturnType<typeof useOsSettings>): void {
  // @ts-expect-error themePreset is read from the UI preferences
  void settingsQ.data?.themePreset;
  // @ts-expect-error activeSpace is read from the UI preferences
  void settingsQ.data?.activeSpace;
  // @ts-expect-error microApps is read from the UI preferences
  void settingsQ.data?.microApps;
  // @ts-expect-error hud is read from the UI preferences
  void settingsQ.data?.hud;
  // @ts-expect-error brain is read from the UI preferences
  void settingsQ.data?.brain;
  // @ts-expect-error dashboardLayout is read from the UI preferences
  void settingsQ.data?.dashboardLayout;
  // @ts-expect-error spaces is read from the UI preferences
  void settingsQ.data?.spaces;
  const saved = settingsQ.data;
  // @ts-expect-error a copy of the query result has no moved key either
  void saved?.themePreset;
  // @ts-expect-error nor a destructuring of it
  const { activeSpace } = settingsQ.data ?? {};
  void activeSpace;
  // What stays in the settings still reads.
  void settingsQ.data?.accentColor;
}
export function settingsPageReadRefusesMovedKeys(page: ReturnType<typeof useApiQuery<SettingsDoc>>): void {
  // @ts-expect-error the Settings page query is the same document
  void page.data?.themePreset;
}

// C30 — the settings tabs' `Put` takes the same patch as `putSettings`.
export type PutTakesTheSettingsPatch = Assert<Exact<Parameters<Put>[0], SettingsPatch>>;
export function settingsTabsRefuseMovedKeys(put: Put, accentColor: SettingsDoc["accentColor"]): void {
  // @ts-expect-error themePreset through a spread, after an allowed key
  void put({ accentColor, ...{ themePreset: "jarvis" } });
  // @ts-expect-error brain through a spread
  void put({ ...{ brain: { layout: "rings" } } }, true);
  // @ts-expect-error activeSpace literally
  void put({ activeSpace: "work" });
  void put({ accentColor }, true);
}

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

/**
 * The settings schema lives in `@mordomo/contracts` (the UI and third-party
 * clients validate against the same object); the core re-exports it so every
 * existing importer keeps working.
 */
export {
  BrainSettingsSchema,
  CURRENT_SETTINGS_VERSION,
  UI_PREFERENCE_KEYS,
  UiPreferencesSchema,
  defaultUiPreferences,
  ChannelSettingsSchema,
  DEFAULT_EXCLUDES,
  DEFAULT_HUD,
  EffortLevel,
  IndexedFolderSchema,
  MicroAppSchema,
  ProviderId,
  ProviderSettingsSchema,
  SecurityProfile,
  SentinelSettingsSchema,
  SettingsSchema,
  defaultSettings,
  detectTimezone,
  type BrainSettings,
  type ChannelSettings,
  type IndexedFolder,
  type MicroApp,
  type ProviderSettings,
  type SentinelSettings,
  type Settings,
  type UiPreferenceKey,
  type UiPreferences,
} from "@mordomo/contracts";

import type { SettingsDoc } from "../../api";

/**
 * What every settings section shares: the tab ids, the security profiles
 * and the small record shapes (split out of Settings.tsx, refino item 17).
 */
/** Internal route ("/pixel") or an http(s) URL — same rule the desktop widget applies. */
export function isValidMicroAppHref(href: string): boolean {
  const h = href.trim();
  if (h.startsWith("/")) return !h.startsWith("//");
  return /^https?:\/\/\S+$/i.test(h);
}

export interface Approval {
  id: string;
  kind: string;
  description: string;
  createdAt: number;
}

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
}

export type TabId =
  | "identity"
  | "theme"
  | "providers"
  | "memory"
  | "desktop"
  | "security"
  | "notifications"
  | "backups"
  | "diagnostics"
  | "trends";
export const TAB_IDS: TabId[] = [
  "identity",
  "theme",
  "providers",
  "memory",
  "desktop",
  "security",
  "notifications",
  "backups",
  "diagnostics",
  "trends",
];
export const PROFILES = [
  "read_only",
  "review_before_write",
  "controlled_write",
  "approved_automation",
] as const;

export type SettingsShape = SettingsDoc;

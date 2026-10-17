/**
 * The instruments a person can ask for by name (redesign G5): one of the OS's apps (`app:<kind>`) or one of the
 * desktop's readings (`pulse`, `attention`, …). The palette lists them as "panels" and opens the one chosen
 * (`CommandPalette.tsx`); this file is the list and the name of each. The pod arcs they once sat on, and the
 * Setup step that arranged them, are gone (.specs/features/limpeza-legado).
 */
import type { TKey } from "../i18n";
import { APPS, APP_KINDS, appId, appKindOf } from "./apps";

/** The readings that can be opened as a panel, besides the apps. */
const READING_IDS = [
  "pulse",
  "attention",
  "runs",
  "routines",
  "inbox",
  "cost",
  "approvals",
  "now",
  "mission",
  "sentinels",
  "facts",
  "journal",
  "health",
] as const;
type ReadingId = (typeof READING_IDS)[number];

/** Every instrument the palette offers, in order: the apps, then the readings. */
export const HUD_CATALOGUE: readonly string[] = [...APP_KINDS.map((k) => appId(k)), ...READING_IDS];

const READING_TITLE: Record<ReadingId, TKey> = {
  pulse: "desktop.widget.pulse",
  attention: "desktop.widget.attention",
  runs: "desktop.hud.runs",
  routines: "desktop.widget.routines",
  inbox: "desktop.widget.inbox",
  cost: "desktop.widget.cost",
  approvals: "desktop.widget.approvals",
  now: "now.title",
  mission: "desktop.widget.mission",
  sentinels: "desktop.widget.sentinels",
  facts: "desktop.widget.facts",
  journal: "desktop.widget.journal",
  health: "desktop.widget.health",
};

/** The instrument's name, as a locale key. */
export function hudTitleKey(id: string): TKey {
  const kind = appKindOf(id);
  if (kind) return APPS[kind].titleKey;
  return READING_TITLE[id as ReadingId] ?? "desktop.widget.now";
}

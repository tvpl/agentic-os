/**
 * The HUD (redesign G5): which instruments sit on the two pod arcs.
 *
 * An instrument is either one of the OS's apps (`app:<kind>`) or one of the
 * desktop's readings (`pulse`, `attention`, …). The user edits the arcs from
 * the dock — remove with ✕, add from the gallery — and the result is
 * persisted in `settings.hud`, so it survives a reload and a reinstall.
 * Everything here is pure: the pods component only renders what this says.
 */
import { APP_KINDS, appId } from "./apps";

export interface Hud {
  l: string[];
  r: string[];
}
export type HudSide = keyof Hud;

/** The prototype's first composition: apps on the left, readings on the right. */
export const DEFAULT_HUD: Hud = {
  l: ["app:brain", "app:skills", "app:artifacts", "app:generations", "app:connectors", "app:settings"],
  r: ["pulse", "attention", "runs", "routines", "inbox"],
};

/** The readings that can be pods, besides the apps. */
export const READING_IDS = [
  "pulse",
  "attention",
  "runs",
  "routines",
  "inbox",
  "cost",
  "approvals",
  "now",
] as const;
export type ReadingId = (typeof READING_IDS)[number];

/** Every instrument the gallery can offer, in gallery order. */
export const HUD_CATALOGUE: readonly string[] = [...APP_KINDS.map((k) => appId(k)), ...READING_IDS];

export function isHudId(id: string): boolean {
  return HUD_CATALOGUE.includes(id);
}

/**
 * A stored HUD, made safe: unknown ids dropped, duplicates removed (the
 * first side keeps it), and an empty document falling back to the default.
 */
export function normalizeHud(raw: unknown): Hud {
  const read = (side: unknown, seen: Set<string>): string[] => {
    if (!Array.isArray(side)) return [];
    const out: string[] = [];
    for (const id of side) {
      if (typeof id !== "string" || !isHudId(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  if (!raw || typeof raw !== "object") return { l: [...DEFAULT_HUD.l], r: [...DEFAULT_HUD.r] };
  const seen = new Set<string>();
  const l = read((raw as { l?: unknown }).l, seen);
  const r = read((raw as { r?: unknown }).r, seen);
  if (l.length === 0 && r.length === 0) return { l: [...DEFAULT_HUD.l], r: [...DEFAULT_HUD.r] };
  return { l, r };
}

/** Instruments not on either arc, in gallery order. */
export function freeInstruments(hud: Hud): string[] {
  const used = new Set([...hud.l, ...hud.r]);
  return HUD_CATALOGUE.filter((id) => !used.has(id));
}

export function removeFromHud(hud: Hud, id: string): Hud {
  return { l: hud.l.filter((x) => x !== id), r: hud.r.filter((x) => x !== id) };
}

/** Adds to one side; an instrument already on an arc moves there instead of doubling. */
export function addToHud(hud: Hud, side: HudSide, id: string): Hud {
  if (!isHudId(id)) return hud;
  const cleared = removeFromHud(hud, id);
  return { ...cleared, [side]: [...cleared[side], id] };
}

export function hudEquals(a: Hud, b: Hud): boolean {
  return a.l.join("|") === b.l.join("|") && a.r.join("|") === b.r.join("|");
}

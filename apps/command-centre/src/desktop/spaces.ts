/**
 * Named desktop spaces (redesign F6).
 *
 * The modes this replaces — `overview` / `focus` / `explore` — only changed
 * opacity: leaving one and coming back lost whatever you had arranged. A
 * space remembers its own windows, so putting down a context of work and
 * picking it up later is the same gesture.
 *
 * Pure: switching is a data transform, so the rule that the layout you leave
 * is the layout you find is testable without a browser.
 */
import type { WindowMap } from "./windowModel";

export interface Space {
  name: string;
  layout: WindowMap;
}
export type SpaceMap = Record<string, Space>;

export const DEFAULT_SPACE = "work";
/** How many spaces one desktop may hold; past this the dock stops being a dock. */
export const MAX_SPACES = 6;

/** The spaces to show, always including the active one even if unnamed. */
export function listSpaces(spaces: SpaceMap, active: string): Array<{ id: string; name: string }> {
  const out = Object.entries(spaces).map(([id, s]) => ({ id, name: s.name }));
  if (!spaces[active]) out.unshift({ id: active, name: active === DEFAULT_SPACE ? "Work" : active });
  return out.sort((a, b) => (a.id === DEFAULT_SPACE ? -1 : b.id === DEFAULT_SPACE ? 1 : 0));
}

export interface SwitchResult {
  spaces: SpaceMap;
  activeSpace: string;
  /** The layout the desktop should now show. */
  layout: WindowMap;
}

/**
 * Leave `active` and enter `next`: the current arrangement is written into
 * the space being left — including the very first time, so a desktop that was
 * never explicitly saved is not lost on the first switch — and the target's
 * arrangement comes back. An unknown target starts from `fallback`.
 */
export function switchSpace(
  spaces: SpaceMap,
  active: string,
  current: WindowMap,
  next: string,
  fallback: WindowMap,
): SwitchResult {
  const kept: SpaceMap = {
    ...spaces,
    [active]: { name: spaces[active]?.name ?? nameFor(active), layout: current },
  };
  if (next === active) return { spaces: kept, activeSpace: active, layout: current };
  const target = kept[next];
  return {
    spaces: target ? kept : { ...kept, [next]: { name: nameFor(next), layout: fallback } },
    activeSpace: next,
    layout: target ? target.layout : fallback,
  };
}

/** Adds a space with a fresh desktop; returns the unchanged map when full. */
export function addSpace(spaces: SpaceMap, active: string, name: string, layout: WindowMap): SwitchResult {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed || Object.keys(spaces).length >= MAX_SPACES)
    return { spaces, activeSpace: active, layout: spaces[active]?.layout ?? layout };
  const id = freeId(spaces, trimmed);
  return { spaces: { ...spaces, [id]: { name: trimmed, layout } }, activeSpace: id, layout };
}

/** Removing the space you are in moves you to another one, never to nowhere. */
export function removeSpace(spaces: SpaceMap, active: string, id: string, fallback: WindowMap): SwitchResult {
  if (!spaces[id] || Object.keys(spaces).length <= 1)
    return { spaces, activeSpace: active, layout: spaces[active]?.layout ?? fallback };
  const rest = { ...spaces };
  delete rest[id];
  if (id !== active) return { spaces: rest, activeSpace: active, layout: rest[active]?.layout ?? fallback };
  const nextId = Object.keys(rest)[0]!;
  return { spaces: rest, activeSpace: nextId, layout: rest[nextId]!.layout };
}

function nameFor(id: string): string {
  return id === DEFAULT_SPACE ? "Work" : id.charAt(0).toUpperCase() + id.slice(1);
}

function freeId(spaces: SpaceMap, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "space";
  if (!spaces[base]) return base;
  for (let n = 2; n < 100; n++) if (!spaces[`${base}-${n}`]) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}
